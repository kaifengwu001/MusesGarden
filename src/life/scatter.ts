import {
  DataTexture,
  DynamicDrawUsage,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  NearestFilter,
  RedFormat,
  Sphere,
  UnsignedByteType,
  Vector3,
  type Frustum,
} from 'three';
import type { BuildQueue } from '../core/buildQueue';
import { gpuMemory } from '../core/gpuMemory';
import { clamp } from '../core/math';
import { faceEdgeLength } from '../planet/chunks';
import { uvToSphere } from '../planet/cubesphere';
import { enumerateCell, type PointClass, type RestPoint } from '../planet/rest';
import { warpPoint, type WarpFrame } from '../render/warp';

// A scattered class (grass, flowers, stones) around the focus, built from its
// rest-space point set. The area within `radius` is covered by quadtree tiles
// of about `tileMeters`; each tile's points are enumerated by a time-sliced
// job and copied into pages of a fixed instance pool, drawn in a single call.
// A tiny page-visibility texture lets the vertex shader skip whole tiles
// outside the frustum.
//
// Density falls off with distance (blades and flowers thin out toward the
// edge of the near field). Thinning keeps points in rank order, so a far
// tile only needs its points up to the thinned density: tiles are built to
// σ = ρ·R_hi²·falloff(nearest distance)·headroom and rebuilt when the need
// grows past what they hold. Re-tiling (as R changes) keeps old tiles drawn
// until their replacements are ready, so growth never opens a hole.
//
// A classifier (flowers) sorts each tile's points into several pools (one
// per species mesh) and drops the ones the local density does not want, so
// every draw holds only its own instances. It sees the whole tile first, so
// it can say how far above the mean density the tile goes (the enumeration
// bound), and it can write extra floats per instance.

/** Floats per instance without extras: direction xyz, ln(birth threshold), seed in [0, 1). */
export const SCATTER_STRIDE = 5;
const PAGE_ROWS = 256;
/** ln threshold that is never reached: unused slots. */
export const NEVER = 1e30;

export interface ScatterSpec {
  readonly name: string;
  readonly cls: PointClass;
  readonly tileMeters: number;
  readonly pageSize: number;
  /** Fixed pool size in pages, per channel (GPU buffers cannot grow in place). */
  readonly pages: number;
  /** Build headroom on σ (≥ 1): fewer rebuilds while growing, more memory. */
  readonly headroom: number;
  /** Floats per instance (≥ SCATTER_STRIDE); extras follow the seed. */
  readonly stride?: number;
  /** Separate pools, each drawn by its own mesh. */
  readonly channels?: number;
}

/** Sorts a tile's points into channels, thins them by local density and writes their extras. */
export interface ScatterClassifier<S = unknown> {
  /** Everything the classification depends on: tiles rebuild when it changes. */
  readonly version: string;
  /** Per-tile state for one build, and how far the local density rises above the mean in the tile. */
  prepare(face: number, level: number, i: number, j: number): { state: S; boost: number };
  /**
   * Channel for a point, or −1 to drop it. `record` holds its standard floats
   * at `o` (direction, ln threshold, seed); write extras from o + 5, and the
   * threshold may be rewritten (divided by the local density's ratio to the
   * mean). σ: the tile's build density, in mean-density units.
   */
  classify(state: S, p: RestPoint, sigma: number, record: Float32Array, o: number): number;
}

export interface ScatterView {
  readonly seed: number;
  readonly radius: number;
  /** Top of the growth band (points must exist up to here to fade in). */
  readonly radiusHi: number;
  /** Points per m² (the mean, for a classified layer). */
  readonly density: number;
  readonly focus: Vector3;
  /** Near-field radius, m. */
  readonly near: number;
  /** Fraction of full density kept at distance d (m); must be non-increasing. */
  readonly falloff: (d: number) => number;
  readonly frustum: Frustum;
  readonly warp: WarpFrame;
  readonly queue: BuildQueue;
  readonly classifier?: ScatterClassifier;
}

interface Tile {
  readonly key: string;
  readonly face: number;
  readonly level: number;
  readonly i: number;
  readonly j: number;
  readonly centre: Vector3;
  readonly alpha: number;
  /** Pages per channel. */
  pages: number[][];
  count: number;
  /** σ the current pages hold, and the σ a running build will hold. */
  sigma: number;
  building: number;
  /** Classifier version the pages hold, and the one a running build will hold. */
  version: string;
  buildingVersion: string;
  wanted: boolean;
}

interface Pool {
  readonly data: Float32Array;
  readonly buffer: InstancedInterleavedBuffer;
  readonly visible: Uint8Array;
  readonly texture: DataTexture;
  readonly free: number[];
}

const corner = new Vector3();
const sphere = new Sphere();

/** Do two quadtree tiles (any levels) cover overlapping parts of the same face? */
function overlaps(a: Tile, b: Tile): boolean {
  if (a.face !== b.face) return false;
  const [lo, hi] = a.level <= b.level ? [a, b] : [b, a];
  const shift = hi.level - lo.level;
  return hi.i >> shift === lo.i && hi.j >> shift === lo.j;
}

export class ScatterLayer {
  readonly stride: number;
  readonly channels: number;
  /** Per channel: the attributes to bind and the page-visibility texture. */
  readonly aDir: InterleavedBufferAttribute[] = [];
  readonly aBirth: InterleavedBufferAttribute[] = [];
  /** Extra floats (stride > 5): up to four, as one attribute. */
  readonly aExtra: InterleavedBufferAttribute[] = [];
  readonly pageTextures: DataTexture[] = [];
  /** Instances to draw per channel (all allocated pages). */
  readonly instanceCounts: number[];
  /** Instances held in visible pages, all channels (perf stat). */
  visibleInstances = 0;
  /** Builds that had to truncate because a pool was full (perf stat; no logging in the frame). */
  saturated = 0;
  private readonly pools: Pool[] = [];
  private readonly tiles = new Map<string, Tile>();
  /** Staging buffers returned by finished builds, reused to avoid GC pauses. */
  private readonly spare: Float32Array[] = [];
  private readonly maxPage: number[];
  private seed = -1;

  constructor(readonly spec: ScatterSpec) {
    this.stride = spec.stride ?? SCATTER_STRIDE;
    this.channels = spec.channels ?? 1;
    this.instanceCounts = new Array<number>(this.channels).fill(0);
    this.maxPage = new Array<number>(this.channels).fill(-1);
    for (let c = 0; c < this.channels; c++) {
      const data = new Float32Array(spec.pages * spec.pageSize * this.stride);
      for (let k = 0; k < data.length; k += this.stride) data[k + 3] = NEVER;
      const free: number[] = [];
      for (let k = spec.pages - 1; k >= 0; k--) free.push(k);
      const buffer = new InstancedInterleavedBuffer(data, this.stride, 1);
      buffer.setUsage(DynamicDrawUsage);
      const visible = new Uint8Array(PAGE_ROWS * PAGE_ROWS);
      const texture = new DataTexture(visible, PAGE_ROWS, PAGE_ROWS, RedFormat, UnsignedByteType);
      texture.minFilter = NearestFilter;
      texture.magFilter = NearestFilter;
      this.pools.push({ data, buffer, visible, texture, free });
      this.aDir.push(new InterleavedBufferAttribute(buffer, 3, 0));
      this.aBirth.push(new InterleavedBufferAttribute(buffer, 2, 3));
      if (this.stride > SCATTER_STRIDE) this.aExtra.push(new InterleavedBufferAttribute(buffer, Math.min(this.stride - SCATTER_STRIDE, 4), SCATTER_STRIDE));
      this.pageTextures.push(texture);
    }
    let bytes = 0;
    for (const p of this.pools) bytes += p.data.byteLength + p.visible.byteLength;
    gpuMemory.set(`${spec.name} instances`, bytes);
  }

  /** Total instances drawn over all channels. */
  get instanceCount(): number {
    let n = 0;
    for (const c of this.instanceCounts) n += c;
    return n;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  update(view: ScatterView): void {
    if (view.seed !== this.seed) this.clear(view.queue);
    this.seed = view.seed;
    const R = view.radius;
    const level = clamp(Math.round(Math.log2(faceEdgeLength(R) / this.spec.tileMeters)), 0, 18);
    const version = view.classifier?.version ?? '';

    // 1. Which tiles cover the near field, and what density each needs.
    for (const t of this.tiles.values()) t.wanted = false;
    const reach = view.near / R;
    const visit = (face: number, l: number, i: number, j: number): void => {
      const n = 2 ** l;
      const centre = uvToSphere(face, (i + 0.5) / n, (j + 0.5) / n, new Vector3());
      let cosAlpha = 1;
      for (let c = 0; c < 4; c++) cosAlpha = Math.min(cosAlpha, uvToSphere(face, (i + (c & 1)) / n, (j + (c >> 1)) / n, corner).dot(centre));
      const alpha = Math.acos(clamp(cosAlpha, -1, 1)) * 1.02;
      const gap = Math.acos(clamp(centre.dot(view.focus), -1, 1)) - alpha;
      if (gap > reach) return;
      if (l < level) {
        for (let c = 0; c < 4; c++) visit(face, l + 1, 2 * i + (c & 1), 2 * j + (c >> 1));
        return;
      }
      const key = `${l}/${face}/${i}/${j}`;
      let tile = this.tiles.get(key);
      if (!tile) {
        const pages = Array.from({ length: this.channels }, () => [] as number[]);
        tile = { key, face, level: l, i, j, centre, alpha, pages, count: 0, sigma: 0, building: 0, version: '', buildingVersion: '', wanted: true };
        this.tiles.set(key, tile);
      }
      tile.wanted = true;
      const nearest = Math.max(0, gap) * R;
      const need = view.density * view.radiusHi * view.radiusHi * view.falloff(nearest);
      if (!(need > 0)) return; // an empty near field (or a degenerate falloff) needs nothing built
      const grow = need > tile.sigma && tile.building < need;
      const stale = tile.version !== version && tile.buildingVersion !== version;
      if (grow) this.schedule(tile, need * this.spec.headroom, nearest, view);
      else if (stale) this.schedule(tile, Math.max(need * this.spec.headroom, tile.sigma), nearest, view);
    };
    for (let face = 0; face < 6; face++) visit(face, 0, 0, 0);

    // 2. Re-tiling swaps region by region: an old-level tile stays (and keeps
    //    drawing) until every wanted new tile over its area is ready; a new
    //    tile stays hidden while an old one still covers it. Under pool
    //    pressure the old tiles go first: a brief thin patch, never a stall.
    const hidden = new Set<Tile>();
    let pressed = false;
    for (const p of this.pools) pressed ||= p.free.length < 4;
    for (const t of [...this.tiles.values()]) {
      if (t.wanted) continue;
      if (t.level === level || pressed) {
        this.release(t, view.queue);
        continue;
      }
      let covered = true;
      let overlapping = 0;
      for (const n of this.tiles.values()) {
        if (!n.wanted || !overlaps(t, n)) continue;
        overlapping++;
        if (n.sigma === 0) covered = false;
      }
      if (overlapping === 0 || covered) {
        this.release(t, view.queue);
        continue;
      }
      for (const n of this.tiles.values()) if (n.wanted && overlaps(t, n)) hidden.add(n);
    }

    // 3. Page visibility: whole tiles against the (warped) frustum.
    for (const p of this.pools) p.visible.fill(0);
    const maxPage = this.maxPage.fill(-1);
    let visible = 0;
    for (const t of this.tiles.values()) {
      if (t.count === 0) continue;
      sphere.center.copy(t.centre).multiplyScalar(R);
      sphere.radius = 2 * R * Math.sin(t.alpha / 2) + 3;
      const w = view.warp;
      if (w.k !== 0) {
        const tx = sphere.center.x - w.focus.x;
        const ty = sphere.center.y - w.focus.y;
        const tz = sphere.center.z - w.focus.z;
        const along = tx * w.up.x + ty * w.up.y + tz * w.up.z;
        const tLen = Math.hypot(tx - along * w.up.x, ty - along * w.up.y, tz - along * w.up.z);
        warpPoint(w, sphere.center, sphere.center);
        sphere.radius += 2 * Math.abs(w.k) * tLen * sphere.radius;
      }
      const show = view.frustum.intersectsSphere(sphere) && !hidden.has(t);
      for (let c = 0; c < this.channels; c++) {
        for (const p of t.pages[c]) {
          this.pools[c].visible[p] = show ? 255 : 0;
          maxPage[c] = Math.max(maxPage[c], p);
        }
      }
      if (show) visible += t.count;
    }
    for (let c = 0; c < this.channels; c++) {
      this.pools[c].texture.needsUpdate = true;
      this.instanceCounts[c] = (maxPage[c] + 1) * this.spec.pageSize;
    }
    this.visibleInstances = visible;
  }

  private schedule(tile: Tile, sigma: number, distance: number, view: ScatterView): void {
    const classifier = view.classifier;
    const version = classifier?.version ?? '';
    tile.building = sigma;
    tile.buildingVersion = version;
    const spec = this.spec;
    const stride = this.stride;
    const channels = this.channels;
    const seed = view.seed;
    const alive = (): boolean => this.tiles.has(tile.key);
    const commit = (data: Float32Array[], used: number[]): void => this.commit(tile, data, used, sigma, version);
    const take = (): Float32Array => this.spare.pop() ?? new Float32Array(8192 * stride);
    const give = (buffer: Float32Array): void => {
      if (this.spare.length < 6 * channels) this.spare.push(buffer);
    };
    function* build(): Generator<void, void, void> {
      // typed staging buffers from the spare pool, doubled as needed (no per-point garbage)
      const staging = Array.from({ length: channels }, take);
      const used = new Array<number>(channels).fill(0);
      const record = new Float32Array(stride);
      let state: unknown = null;
      let bound = sigma;
      if (classifier) {
        const prepared = classifier.prepare(tile.face, tile.level, tile.i, tile.j);
        state = prepared.state;
        bound = sigma * prepared.boost;
        yield;
      }
      // 64 sub-cells, so one step of this job stays well under the frame budget
      const sub = 3;
      const n = 1 << sub;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          enumerateCell(spec.cls, seed, tile.face, tile.level + sub, tile.i * n + a, tile.j * n + b, bound, (p) => {
            uvToSphere(p.face, p.u, p.v, corner);
            record[0] = corner.x;
            record[1] = corner.y;
            record[2] = corner.z;
            record[3] = Math.log(p.threshold);
            record[4] = p.seed / 4294967296;
            const c = classifier ? classifier.classify(state, p, sigma, record, 0) : 0;
            if (c < 0) return;
            if (used[c] + stride > staging[c].length) {
              const bigger = new Float32Array(staging[c].length * 2);
              bigger.set(staging[c]);
              staging[c] = bigger;
            }
            staging[c].set(record, used[c]);
            used[c] += stride;
          });
          yield;
        }
      }
      if (alive()) commit(staging, used); // else: released while building
      for (const s of staging) give(s);
    }
    view.queue.add(`${spec.name}:${tile.key}`, distance, build());
  }

  private commit(tile: Tile, data: Float32Array[], used: number[], sigma: number, version: string): void {
    const size = this.spec.pageSize;
    const stride = this.stride;
    let truncated = false;
    let total = 0;
    for (let c = 0; c < this.channels; c++) {
      const pool = this.pools[c];
      const count = used[c] / stride;
      // release the old pages first, then take enough for the new data
      for (const p of tile.pages[c]) pool.free.push(p);
      pool.free.sort((a, b) => b - a); // pop() returns the lowest index: the draw range stays tight
      tile.pages[c] = [];
      let needed = Math.ceil(count / size);
      if (needed > pool.free.length) {
        needed = pool.free.length;
        truncated = true;
      }
      // Only add ranges: several tiles can commit in one frame, and three.js
      // clears the ranges itself once they are uploaded.
      for (let k = 0; k < needed; k++) {
        const page = pool.free.pop()!;
        tile.pages[c].push(page);
        const from = k * size * stride;
        const to = Math.min(used[c], from + size * stride);
        const base = page * size * stride;
        pool.data.set(data[c].subarray(from, to), base);
        for (let x = base + (to - from); x < base + size * stride; x += stride) pool.data[x + 3] = NEVER;
        pool.buffer.addUpdateRange(base, size * stride);
      }
      if (needed > 0) pool.buffer.needsUpdate = true;
      total += Math.min(count, needed * size);
    }
    if (truncated) this.saturated++;
    tile.count = total;
    // A truncated tile is not complete: leave it eligible for a rebuild once
    // pages free up, so the settled state never depends on history.
    tile.sigma = truncated ? 0 : sigma;
    tile.version = truncated ? '' : version;
    tile.building = 0;
    tile.buildingVersion = '';
  }

  private release(tile: Tile, queue: BuildQueue): void {
    queue.cancel(`${this.spec.name}:${tile.key}`);
    for (let c = 0; c < this.channels; c++) {
      const pool = this.pools[c];
      for (const p of tile.pages[c]) pool.free.push(p);
      pool.free.sort((a, b) => b - a);
    }
    this.tiles.delete(tile.key);
  }

  private clear(queue: BuildQueue): void {
    for (const t of [...this.tiles.values()]) this.release(t, queue);
  }
}
