import { DataTexture, FloatType, NearestFilter, RedFormat, RGBAFormat, Sphere, UnsignedByteType, Vector3, type Frustum } from 'three';
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
// The pool is a float texture, a page a row, and the draw covers only the
// pages of tiles in view: a short list of them (in pool order) tells each
// instance which page and slot to read (through iteration 13 the pool was a
// vertex buffer drawn up to its highest page, the pages out of view culled
// one instance at a time: 911k instances drawn for 320k blades in view on
// High, 1.3–1.7 ms a frame). Tiles in view are built before those out of
// it, nearest first.
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
/** ln threshold that is never reached: unused slots. */
export const NEVER = 1e30;
/** Build order: tiles out of view wait behind those in view as if this much farther away (m). */
const OUT_OF_VIEW_M = 60;
/** Build order: tiles built ahead (beyond the near field's edge) wait behind every tile in it; the frame loop does not count them as a backlog. */
export const AHEAD = 1000;
/** Build order: the tiles where the camera is headed wait behind its own as if this much farther away (m). */
const HEADED_M = 10;

export interface ScatterSpec {
  readonly name: string;
  readonly cls: PointClass;
  readonly tileMeters: number;
  readonly pageSize: number;
  /** Fixed pool size in pages, per channel (GPU buffers cannot grow in place). */
  readonly pages: number;
  /** Build headroom on σ (≥ 1): fewer rebuilds while growing, more memory. */
  readonly headroom: number;
  /** Floats per instance (SCATTER_STRIDE to 8); extras (up to three) follow the seed. */
  readonly stride?: number;
  /** Separate pools, each drawn by its own mesh. */
  readonly channels?: number;
  /** Keep a map of which tiles hold their instances (builtMap), for the ground's paint to wait on. */
  readonly mapBuilt?: boolean;
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

/** A camera's near field: around its focus, as its (warped) frustum sees it. */
export interface ScatterLook {
  readonly focus: Vector3;
  /** Near-field radius, m. */
  readonly near: number;
  /** Fraction of full density kept at distance d (m); must be non-increasing. */
  readonly falloff: (d: number) => number;
  readonly frustum: Frustum;
  readonly warp: WarpFrame;
}

export interface ScatterView extends ScatterLook {
  readonly seed: number;
  readonly radius: number;
  /** Top of the growth band (points must exist up to here to fade in). */
  readonly radiusHi: number;
  /** Points per m² (the mean, for a classified layer). */
  readonly density: number;
  readonly queue: BuildQueue;
  readonly classifier?: ScatterClassifier;
  /** Where the camera is headed (a glide, a zoom, a named view): the tiles it will see are built on the way. */
  readonly ahead?: ScatterLook;
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
  /** This update: inside the camera's own near field (drawn), the density it needs and how soon (lower first). */
  current: boolean;
  need: number;
  priority: number;
}

/**
 * One channel's instances, in two RGBA float textures a page a row: `main`
 * holds each instance's direction and ln birth threshold; `rest` its seed
 * (four to a texel) or, with extras, its seed and up to three extras (a
 * texel each). `list` holds the pages to draw, four to a texel.
 */
interface Pool {
  readonly main: Float32Array;
  readonly mainTexture: DataTexture;
  readonly rest: Float32Array;
  readonly restTexture: DataTexture;
  readonly list: Float32Array;
  readonly listTexture: DataTexture;
  readonly free: number[];
}

/** An RGBA float texture over `data`, read with texelFetch; its first upload sends one row (the rest is allocated, and written as pages fill). */
function poolTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.addUpdateRange(0, width * 4);
  texture.needsUpdate = true;
  return texture;
}

const corner = new Vector3();
const centreAt = new Vector3();
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
  /** Per channel, for the vertex shaders: the pool's textures and the list of pages drawn (see Pool). */
  readonly mainTextures: DataTexture[] = [];
  readonly restTextures: DataTexture[] = [];
  readonly listTextures: DataTexture[] = [];
  /** Instances to draw per channel (the pages in the list). */
  readonly instanceCounts: number[];
  /** Instances held in visible pages, all channels (perf stat). */
  visibleInstances = 0;
  /**
   * With `mapBuilt`: a texel per tile at the current level (a face's
   * builtCells × builtCells, the six faces stacked in v, face-major), 255
   * where the tile's instances are in the pool and drawn (or would be, in
   * view). Sent only when it changes.
   */
  builtMap: DataTexture | null = null;
  builtCells = 0;
  private builtPrev = new Uint8Array(0);
  /** Builds that had to truncate because a pool was full (perf stat; no logging in the frame). */
  saturated = 0;
  private readonly pools: Pool[] = [];
  private readonly tiles = new Map<string, Tile>();
  /** Staging buffers returned by finished builds, reused to avoid GC pauses. */
  private readonly spare: Float32Array[] = [];
  /** The pages drawn this frame, per channel (reused). */
  private readonly drawn: number[][];
  private seed = -1;

  constructor(readonly spec: ScatterSpec) {
    this.stride = spec.stride ?? SCATTER_STRIDE;
    this.channels = spec.channels ?? 1;
    this.instanceCounts = new Array<number>(this.channels).fill(0);
    this.drawn = Array.from({ length: this.channels }, () => []);
    const size = spec.pageSize; // a multiple of 4
    const packed = this.stride === SCATTER_STRIDE;
    for (let c = 0; c < this.channels; c++) {
      const main = new Float32Array(spec.pages * size * 4);
      for (let k = 3; k < main.length; k += 4) main[k] = NEVER;
      const rest = new Float32Array(spec.pages * size * (packed ? 1 : 4));
      const listWidth = Math.ceil(spec.pages / 4);
      const list = new Float32Array(listWidth * 4);
      const free: number[] = [];
      for (let k = spec.pages - 1; k >= 0; k--) free.push(k);
      const pool: Pool = {
        main,
        mainTexture: poolTexture(main, size, spec.pages),
        rest,
        restTexture: poolTexture(rest, packed ? size / 4 : size, spec.pages),
        list,
        listTexture: poolTexture(list, listWidth, 1),
        free,
      };
      this.pools.push(pool);
      this.mainTextures.push(pool.mainTexture);
      this.restTextures.push(pool.restTexture);
      this.listTextures.push(pool.listTexture);
    }
    let bytes = 0;
    for (const p of this.pools) bytes += p.main.byteLength + p.rest.byteLength + p.list.byteLength;
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

    // 1. Which tiles the near field needs, at what density, how soon: the camera's own, with a ring a
    //    tile wide beyond its edge (built last, drawn once inside it: walking, the tiles at the edge are
    //    ready before they show), and where the camera is headed (only what it will see there, so it
    //    is built on the way: a glide, a named view, the way down from orbit).
    for (const t of this.tiles.values()) {
      t.wanted = false;
      t.current = false;
      t.need = 0;
      t.priority = Number.POSITIVE_INFINITY;
    }
    this.visit(view, view, level, this.spec.tileMeters, 0);
    if (view.ahead) this.visit(view, view.ahead, level, 0, HEADED_M);
    for (const t of this.tiles.values()) {
      if (!t.wanted) continue;
      if (t.building > 0) view.queue.reprioritise(`${this.spec.name}:${t.key}`, t.priority);
      if (!(t.need > 0)) continue; // an empty near field (or a degenerate falloff) needs nothing built
      const grow = t.need > t.sigma && t.building < t.need;
      const stale = t.version !== version && t.buildingVersion !== version;
      if (grow) this.schedule(t, t.need * this.spec.headroom, t.priority, view);
      else if (stale) this.schedule(t, Math.max(t.need * this.spec.headroom, t.sigma), t.priority, view);
    }

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

    if (this.spec.mapBuilt) this.mapBuilt(level, hidden);

    // 3. The pages drawn: those of whole tiles in the (warped) frustum, in the near field (or kept over
    //    it while re-tiling), in pool order (as the pool was drawn before, so the blades are drawn in
    //    the same order).
    const drawn = this.drawn;
    for (const d of drawn) d.length = 0;
    let visible = 0;
    for (const t of this.tiles.values()) {
      if (t.count === 0 || (t.wanted && !t.current) || hidden.has(t) || !this.inFrustum(t.centre, t.alpha, R, view)) continue;
      for (let c = 0; c < this.channels; c++) for (const p of t.pages[c]) drawn[c].push(p);
      visible += t.count;
    }
    for (let c = 0; c < this.channels; c++) {
      const pool = this.pools[c];
      const d = drawn[c].sort((a, b) => a - b);
      for (let k = 0; k < d.length; k++) pool.list[k] = d[k];
      pool.listTexture.needsUpdate = true;
      this.instanceCounts[c] = d.length * this.spec.pageSize;
    }
    this.visibleInstances = visible;
  }

  /** Mark the tiles whose instances are ready (built, and not hidden under an old tile while re-tiling) at the current level. */
  private mapBuilt(level: number, hidden: Set<Tile>): void {
    const n = 1 << level;
    if (this.builtCells !== n || !this.builtMap) {
      this.builtMap?.dispose();
      this.builtMap = new DataTexture(new Uint8Array(n * n * 6), n, n * 6, RedFormat, UnsignedByteType);
      this.builtMap.minFilter = NearestFilter;
      this.builtMap.magFilter = NearestFilter;
      this.builtMap.needsUpdate = true;
      this.builtCells = n;
      this.builtPrev = new Uint8Array(n * n * 6);
    }
    const data = this.builtMap.image.data as Uint8Array;
    data.fill(0);
    for (const t of this.tiles.values()) {
      if (!(t.sigma > 0 || t.count > 0) || hidden.has(t)) continue;
      const shift = level - t.level;
      if (shift >= 0) {
        // a tile at the level or coarser (kept while re-tiling) covers s × s cells
        const s = 1 << shift;
        for (let b = 0; b < s; b++) data.fill(255, (t.face * n + t.j * s + b) * n + t.i * s, (t.face * n + t.j * s + b) * n + t.i * s + s);
      } else data[(t.face * n + (t.j >> -shift)) * n + (t.i >> -shift)] = 255;
    }
    let same = true;
    for (let k = 0; k < data.length && same; k++) same = data[k] === this.builtPrev[k];
    if (same) return;
    this.builtPrev.set(data);
    this.builtMap.needsUpdate = true;
  }

  /**
   * Visit the tiles of one near field (`look`, out to `margin` m beyond its
   * edge), marking what each needs: the density there and how soon (`delay`
   * m later than its own distance). The camera's own near field (`look` is
   * the view) is drawn; any other is where it is headed, and only what it
   * will see there is wanted.
   */
  private visit(view: ScatterView, look: ScatterLook, level: number, margin: number, delay: number): void {
    const R = view.radius;
    const reach = (look.near + margin) / R;
    const own = look === view;
    const full = view.density * view.radiusHi * view.radiusHi;
    const at = (face: number, l: number, i: number, j: number): void => {
      const n = 2 ** l;
      // (one scratch vector: a node uses its centre before visiting its children)
      const centre = uvToSphere(face, (i + 0.5) / n, (j + 0.5) / n, centreAt);
      let cosAlpha = 1;
      for (let c = 0; c < 4; c++) cosAlpha = Math.min(cosAlpha, uvToSphere(face, (i + (c & 1)) / n, (j + (c >> 1)) / n, corner).dot(centre));
      const alpha = Math.acos(clamp(cosAlpha, -1, 1)) * 1.02;
      const gap = Math.acos(clamp(centre.dot(look.focus), -1, 1)) - alpha;
      if (gap > reach) return;
      if (l < level) {
        for (let c = 0; c < 4; c++) at(face, l + 1, 2 * i + (c & 1), 2 * j + (c >> 1));
        return;
      }
      const inView = this.inFrustum(centre, alpha, R, look);
      if (!own && !inView) return;
      const key = `${l}/${face}/${i}/${j}`;
      let tile = this.tiles.get(key);
      if (!tile) {
        const pages = Array.from({ length: this.channels }, () => [] as number[]);
        tile = { key, face, level: l, i, j, centre: centre.clone(), alpha, pages, count: 0, sigma: 0, building: 0, version: '', buildingVersion: '', wanted: true, current: false, need: 0, priority: Number.POSITIVE_INFINITY };
        this.tiles.set(key, tile);
      }
      tile.wanted = true;
      const nearest = Math.max(0, gap) * R;
      const inside = nearest <= look.near;
      if (own && inside) tile.current = true;
      tile.priority = Math.min(tile.priority, nearest + (inView ? 0 : OUT_OF_VIEW_M) + (inside ? 0 : AHEAD) + delay);
      tile.need = Math.max(tile.need, full * look.falloff(nearest));
    };
    for (let face = 0; face < 6; face++) at(face, 0, 0, 0);
  }

  /** A tile (its centre direction and angular radius) against a look's (warped) frustum, by its bounding sphere. */
  private inFrustum(centre: Vector3, alpha: number, R: number, look: ScatterLook): boolean {
    sphere.center.copy(centre).multiplyScalar(R);
    sphere.radius = 2 * R * Math.sin(alpha / 2) + 3;
    const w = look.warp;
    if (w.k !== 0) {
      const tx = sphere.center.x - w.focus.x;
      const ty = sphere.center.y - w.focus.y;
      const tz = sphere.center.z - w.focus.z;
      const along = tx * w.up.x + ty * w.up.y + tz * w.up.z;
      const tLen = Math.hypot(tx - along * w.up.x, ty - along * w.up.y, tz - along * w.up.z);
      warpPoint(w, sphere.center, sphere.center);
      sphere.radius += 2 * Math.abs(w.k) * tLen * sphere.radius;
    }
    return look.frustum.intersectsSphere(sphere);
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
      // 256 sub-cells, so one step of this job stays well under the frame budget
      const sub = 4;
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
      pool.free.sort((a, b) => b - a); // pop() returns the lowest index: the pages in use stay together
      tile.pages[c] = [];
      let needed = Math.ceil(count / size);
      if (needed > pool.free.length) {
        needed = pool.free.length;
        truncated = true;
      }
      for (let k = 0; k < needed; k++) {
        const page = pool.free.pop()!;
        tile.pages[c].push(page);
        this.writePage(pool, page, data[c], k * size, Math.min(count - k * size, size));
      }
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

  /**
   * Copy `n` instances from `stride`-float records, starting at instance
   * `first`, into a page (a row of each texture); the page's other slots are
   * never born. Only ranges are added: several tiles can commit in one frame,
   * and three.js clears the ranges itself once they are uploaded.
   */
  private writePage(pool: Pool, page: number, records: Float32Array, first: number, n: number): void {
    const size = this.spec.pageSize;
    const stride = this.stride;
    const packed = stride === SCATTER_STRIDE;
    const { main, rest } = pool;
    let m = page * size * 4;
    let r = page * size * (packed ? 1 : 4);
    let o = first * stride;
    for (let i = 0; i < size; i++, m += 4, o += stride) {
      if (i >= n) {
        main[m + 3] = NEVER;
        continue;
      }
      main[m] = records[o];
      main[m + 1] = records[o + 1];
      main[m + 2] = records[o + 2];
      main[m + 3] = records[o + 3];
      if (packed) rest[r++] = records[o + 4];
      else {
        for (let e = 0; e < 4; e++) rest[r + e] = 4 + e < stride ? records[o + 4 + e] : 0;
        r += 4;
      }
    }
    pool.mainTexture.addUpdateRange(page * size * 4, size * 4);
    pool.restTexture.addUpdateRange(page * size * (packed ? 1 : 4), size * (packed ? 1 : 4));
    pool.mainTexture.needsUpdate = true;
    pool.restTexture.needsUpdate = true;
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
