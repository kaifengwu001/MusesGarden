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
import { enumerateCell, type PointClass } from '../planet/rest';
import { warpPoint, type WarpFrame } from '../render/warp';

// A scattered class (grass, flowers, stones) around the focus, built from its
// rest-space point set. The area within `radius` is covered by quadtree tiles
// of about `tileMeters`; each tile's points are enumerated by a time-sliced
// job and copied into pages of one shared instance pool, drawn in a single
// call. A tiny page-visibility texture lets the vertex shader skip whole
// tiles outside the frustum.
//
// Density falls off with distance (blades and flowers thin out toward the
// edge of the near field). Thinning keeps points in rank order, so a far
// tile only needs its points up to the thinned density: tiles are built to
// σ = ρ·R_hi²·falloff(nearest distance)·headroom and rebuilt when the need
// grows past what they hold. Re-tiling (as R changes) keeps old tiles drawn
// until their replacements are ready, so growth never opens a hole.

/** Floats per instance: direction xyz, ln(birth threshold), seed in [0, 1). */
export const SCATTER_STRIDE = 5;
const PAGE_ROWS = 256;
/** ln threshold that is never reached: unused slots. */
export const NEVER = 1e30;

export interface ScatterSpec {
  readonly name: string;
  readonly cls: PointClass;
  readonly tileMeters: number;
  readonly pageSize: number;
  /** Fixed pool size in pages (GPU buffers cannot grow in place). */
  readonly pages: number;
  /** Build headroom on σ (≥ 1): fewer rebuilds while growing, more memory. */
  readonly headroom: number;
}

export interface ScatterView {
  readonly seed: number;
  readonly radius: number;
  /** Top of the growth band (points must exist up to here to fade in). */
  readonly radiusHi: number;
  /** Points per m². */
  readonly density: number;
  readonly focus: Vector3;
  /** Near-field radius, m. */
  readonly near: number;
  /** Fraction of full density kept at distance d (m); must be non-increasing. */
  readonly falloff: (d: number) => number;
  readonly frustum: Frustum;
  readonly warp: WarpFrame;
  readonly queue: BuildQueue;
}

interface Tile {
  readonly key: string;
  readonly face: number;
  readonly level: number;
  readonly i: number;
  readonly j: number;
  readonly centre: Vector3;
  readonly alpha: number;
  pages: number[];
  count: number;
  /** σ the current pages hold, and the σ a running build will hold. */
  sigma: number;
  building: number;
  wanted: boolean;
}

const corner = new Vector3();
const sphere = new Sphere();

export class ScatterLayer {
  readonly buffer: InstancedInterleavedBuffer;
  readonly aDir: InterleavedBufferAttribute;
  readonly aBirth: InterleavedBufferAttribute;
  readonly pageTexture: DataTexture;
  /** Instances to draw (all allocated pages). */
  instanceCount = 0;
  /** Instances held in visible pages (perf stat). */
  visibleInstances = 0;
  /** Builds that had to wait because the pool was full (perf stat; no logging in the frame). */
  saturated = 0;
  private readonly pool: Float32Array;
  private readonly pageVisible: Uint8Array;
  private readonly freePages: number[] = [];
  private readonly tiles = new Map<string, Tile>();
  /** Staging buffers returned by finished builds, reused to avoid GC pauses. */
  private readonly spare: Float32Array[] = [];
  private seed = -1;

  constructor(readonly spec: ScatterSpec) {
    this.pool = new Float32Array(spec.pages * spec.pageSize * SCATTER_STRIDE);
    for (let k = 0; k < this.pool.length; k += SCATTER_STRIDE) this.pool[k + 3] = NEVER;
    for (let k = spec.pages - 1; k >= 0; k--) this.freePages.push(k);
    this.buffer = new InstancedInterleavedBuffer(this.pool, SCATTER_STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    this.aDir = new InterleavedBufferAttribute(this.buffer, 3, 0);
    this.aBirth = new InterleavedBufferAttribute(this.buffer, 2, 3);
    this.pageVisible = new Uint8Array(PAGE_ROWS * PAGE_ROWS);
    this.pageTexture = new DataTexture(this.pageVisible, PAGE_ROWS, PAGE_ROWS, RedFormat, UnsignedByteType);
    this.pageTexture.minFilter = NearestFilter;
    this.pageTexture.magFilter = NearestFilter;
    this.trackMemory();
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  update(view: ScatterView): void {
    if (view.seed !== this.seed) this.clear(view.queue);
    this.seed = view.seed;
    const R = view.radius;
    const level = clamp(Math.round(Math.log2(faceEdgeLength(R) / this.spec.tileMeters)), 0, 18);

    // 1. Which tiles cover the near field, and what density each needs.
    for (const t of this.tiles.values()) t.wanted = false;
    const reach = view.near / R;
    let allReady = true;
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
        tile = { key, face, level: l, i, j, centre, alpha, pages: [], count: 0, sigma: 0, building: 0, wanted: true };
        this.tiles.set(key, tile);
      }
      tile.wanted = true;
      const nearest = Math.max(0, gap) * R;
      const need = view.density * view.radiusHi * view.radiusHi * view.falloff(nearest);
      if (need > tile.sigma && tile.building < need) this.schedule(tile, need * this.spec.headroom, nearest, view);
      if (tile.sigma === 0 && need > 0) allReady = false;
    };
    for (let face = 0; face < 6; face++) visit(face, 0, 0, 0);

    // 2. Drop tiles nobody wants. While re-tiling, the old tiling stays (and
    //    is the only one drawn) until every new tile is ready.
    let switching = false;
    for (const t of [...this.tiles.values()]) {
      if (t.wanted) continue;
      if (t.level !== level && !allReady) {
        switching = true;
        continue;
      }
      this.release(t, view.queue);
    }

    // 3. Page visibility: whole tiles against the (warped) frustum.
    this.pageVisible.fill(0);
    let maxPage = -1;
    let visible = 0;
    for (const t of this.tiles.values()) {
      if (t.pages.length === 0) continue;
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
      const show = view.frustum.intersectsSphere(sphere) && !(switching && t.level === level);
      for (const p of t.pages) {
        this.pageVisible[p] = show ? 255 : 0;
        maxPage = Math.max(maxPage, p);
      }
      if (show) visible += t.count;
    }
    this.pageTexture.needsUpdate = true;
    this.instanceCount = (maxPage + 1) * this.spec.pageSize;
    this.visibleInstances = visible;
  }

  private schedule(tile: Tile, sigma: number, distance: number, view: ScatterView): void {
    tile.building = sigma;
    const spec = this.spec;
    const seed = view.seed;
    const alive = (): boolean => this.tiles.has(tile.key);
    const commit = (data: Float32Array): void => this.commit(tile, data, sigma);
    const take = (): Float32Array => this.spare.pop() ?? new Float32Array(16384 * SCATTER_STRIDE);
    const give = (buffer: Float32Array): void => {
      if (this.spare.length < 6) this.spare.push(buffer);
    };
    function* build(): Generator<void, void, void> {
      // a typed staging buffer from the spare pool, doubled as needed (no per-point garbage)
      let staging = take();
      let used = 0;
      // 64 sub-cells, so one step of this job stays well under the frame budget
      const sub = 3;
      const n = 1 << sub;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          enumerateCell(spec.cls, seed, tile.face, tile.level + sub, tile.i * n + a, tile.j * n + b, sigma, (p) => {
            if (used + SCATTER_STRIDE > staging.length) {
              const bigger = new Float32Array(staging.length * 2);
              bigger.set(staging);
              staging = bigger;
            }
            uvToSphere(p.face, p.u, p.v, corner);
            staging[used++] = corner.x;
            staging[used++] = corner.y;
            staging[used++] = corner.z;
            staging[used++] = Math.log(p.threshold);
            staging[used++] = p.seed / 4294967296;
          });
          yield;
        }
      }
      if (alive()) commit(staging.subarray(0, used)); // else: released while building
      give(staging);
    }
    view.queue.add(`${spec.name}:${tile.key}`, distance, build());
  }

  private commit(tile: Tile, data: Float32Array, sigma: number): void {
    const size = this.spec.pageSize;
    const count = data.length / SCATTER_STRIDE;
    // release the old pages first, then take enough for the new data
    for (const p of tile.pages) this.freePages.push(p);
    tile.pages = [];
    let needed = Math.ceil(count / size);
    if (needed > this.freePages.length) {
      needed = this.freePages.length;
      this.saturated++;
    }
    // Only add ranges: several tiles can commit in one frame, and three.js
    // clears the ranges itself once they are uploaded.
    for (let k = 0; k < needed; k++) {
      const page = this.freePages.pop()!;
      tile.pages.push(page);
      const from = k * size * SCATTER_STRIDE;
      const to = Math.min(data.length, from + size * SCATTER_STRIDE);
      const base = page * size * SCATTER_STRIDE;
      this.pool.set(data.subarray(from, to), base);
      for (let x = base + (to - from); x < base + size * SCATTER_STRIDE; x += SCATTER_STRIDE) this.pool[x + 3] = NEVER;
    }
    for (const page of tile.pages) this.buffer.addUpdateRange(page * size * SCATTER_STRIDE, size * SCATTER_STRIDE);
    this.buffer.needsUpdate = true;
    tile.count = Math.min(count, needed * size);
    // A truncated tile is not complete: leave it eligible for a rebuild once
    // pages free up, so the settled state never depends on history.
    tile.sigma = tile.count < count ? 0 : sigma;
    tile.building = 0;
  }

  private release(tile: Tile, queue: BuildQueue): void {
    queue.cancel(`${this.spec.name}:${tile.key}`);
    for (const p of tile.pages) this.freePages.push(p);
    this.tiles.delete(tile.key);
  }

  private clear(queue: BuildQueue): void {
    for (const t of [...this.tiles.values()]) this.release(t, queue);
  }

  private trackMemory(): void {
    gpuMemory.set(`${this.spec.name} instances`, this.pool.byteLength + this.pageVisible.byteLength);
  }
}
