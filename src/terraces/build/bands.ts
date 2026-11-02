import { hash32, unit } from '../../core/hash';
import { smoothstep } from '../../core/math';
import type { PlanetField } from './field';
import { tangentFrame, type Chain, type Field, type SphereGrid } from './sphere';

// The terraces' build (build/): the paddy lab's bands and cuts (src/dev/
// paddyLab/terraces.ts) on the planet. A level's own field (the terrace field
// less the level, less the level's own wander, plus its paddies' shifts) is
// ≥ 0 above its bank; a point's band is the highest level whose field is ≥ 0
// there (so where a band pinches out to nothing, the band above meets the
// band below). Rings smaller than `minArea` are levelled into the band round
// them. Every field is worked out exactly wherever it is asked.
//
// The cuts (Cuts) divide each band into paddies along its bank. They are
// placed along the banks traced without shifts, a span apart, and each
// cascades: it follows the slope's fall line up to the next bank and on,
// and down, band after band, while chance allows. Each paddy's bank then
// sits a little in or out of the next one's (its shift), swinging from one to
// the other over a short blend at the cut, so a paddy's bank curves in to the
// cut that completes it; the cross-bank runs from there up the band.

export interface CutParams {
  /** How far apart cuts are placed along a bank (m: from … to). */
  readonly spacing: readonly [number, number];
  /** The chance a cut carries on into the next band (up and down). */
  readonly cascade: number;
  /** How far a cut moves along the bank from band to band (m, ±). */
  readonly drift: number;
  /** How far a paddy's bank sits in or out (× the step), and over how much of the bank it swings to the next paddy's (m). */
  readonly shift: number;
  readonly blend: number;
}

/** Level k's field at a direction where the terrace field is t (≥ 0 above its bank). */
export type LevelField = (k: number, x: number, y: number, z: number, t: number) => number;

/** (k past the levels: always above, or always below) */
const BEYOND = 1e6;

export class Bands {
  /** Each vertex's band (the levels' index of the band it lies in). */
  readonly band: Int32Array;
  chains: Chain[] = [];
  dropped = 0;
  private readonly fields = new Map<number, [Field, (v: number) => number]>();

  constructor(
    readonly grid: SphereGrid,
    readonly levels: readonly number[],
    private readonly G: LevelField,
    /** The same at a vertex (kept). */
    private readonly Gv: (k: number, v: number) => number,
    /** The terrace field (m) at the vertices, and anywhere. */
    T: Float64Array,
    private readonly terrace: Field,
    private readonly slot: number,
  ) {
    this.band = new Int32Array(grid.V);
    for (let v = 0; v < grid.V; v++) this.band[v] = this.scan(T[v], (k) => this.gv(k, v));
  }

  g(k: number, x: number, y: number, z: number, t: number): number {
    if (k < 0) return BEYOND;
    if (k >= this.levels.length) return -BEYOND;
    return this.G(k, x, y, z, t);
  }

  gv(k: number, v: number): number {
    if (k < 0) return BEYOND;
    if (k >= this.levels.length) return -BEYOND;
    return this.Gv(k, v);
  }

  /** The field ≥ 0 where the band is k or above (the greater of levels k's and k + 1's), and its value at a vertex. */
  H(k: number): [Field, (v: number) => number] {
    let f = this.fields.get(k);
    if (!f) {
      f = [
        (x, y, z) => {
          const t = this.terrace(x, y, z);
          return Math.max(this.g(k, x, y, z, t), this.g(k + 1, x, y, z, t));
        },
        (v) => Math.max(this.gv(k, v), this.gv(k + 1, v)),
      ];
      this.fields.set(k, f);
    }
    return f;
  }

  /** H(k) at a direction. */
  Hat(k: number, x: number, y: number, z: number): number {
    return this.H(k)[0](x, y, z);
  }

  /** The highest level whose field is ≥ 0, near the terrace field's own (t) there: a level's wander and shift move it a step at most. */
  private scan(t: number, g: (k: number) => number): number {
    let a = 0;
    let b = this.levels.length;
    while (a < b) {
      const c = (a + b) >> 1;
      if (this.levels[c] > t) b = c;
      else a = c + 1;
    }
    const guess = a - 1;
    for (let k = guess + 2; k > guess - 3; k--) if (g(k) >= 0) return k;
    return guess - 3;
  }

  /** The band at a direction. */
  bandAt(x: number, y: number, z: number): number {
    const t = this.terrace(x, y, z);
    return this.scan(t, (k) => this.g(k, x, y, z, t));
  }

  /** Where level k's bank crosses the edge u–v. */
  cross = (u: number, v: number, k: number): number => {
    const [f, fv] = this.H(k);
    return this.grid.crossing(this.slot + k, u, v, f, fv);
  };

  trace(): Chain[] {
    this.chains = this.grid.trace(this.band, this.cross);
    return this.chains;
  }

  /** Level the rings under minArea into the band round them (the largest ring round a vertex has the last word), and trace again. */
  levelSmall(minArea: number): void {
    const small = this.chains.filter((c) => c.closed && Math.abs(c.area) < minArea).sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
    this.dropped = small.length;
    if (small.length === 0) return;
    const was = this.band.slice();
    for (const r of small) {
      for (const v of insideRing(this.grid, r.pts)) this.band[v] = r.area > 0 ? Math.min(was[v], r.level - 1) : Math.max(was[v], r.level);
    }
    // (the fields are as they were, so their crossings stand: only the bands round the levelled rings change)
    this.trace();
  }
}

/** The vertices inside a small ring (its points' ids), tested on the plane at its middle. */
export function insideRing(grid: SphereGrid, pts: readonly number[]): number[] {
  const c = grid.centre(pts);
  const F = tangentFrame(c[0], c[1], c[2], new Float64Array(6));
  const p: number[] = [0, 0, 0];
  const xy: number[] = [];
  const boxes = new Map<number, [number, number, number, number]>();
  const sq = { face: 0, ci: 0, cj: 0 };
  for (const id of pts) {
    grid.point(id, p);
    xy.push(p[0] * F[0] + p[1] * F[1] + p[2] * F[2], p[0] * F[3] + p[1] * F[4] + p[2] * F[5]);
    grid.square(p[0], p[1], p[2], sq);
    const b = boxes.get(sq.face) ?? [Infinity, -Infinity, Infinity, -Infinity];
    b[0] = Math.min(b[0], sq.ci);
    b[1] = Math.max(b[1], sq.ci);
    b[2] = Math.min(b[2], sq.cj);
    b[3] = Math.max(b[3], sq.cj);
    boxes.set(sq.face, b);
  }
  const out = new Set<number>();
  const D = grid.dir;
  const { m } = grid;
  for (const [f, b] of boxes) {
    for (let cj = Math.max(b[2] - 1, 0); cj <= Math.min(b[3] + 1, m - 1); cj++) {
      for (let ci = Math.max(b[0] - 1, 0); ci <= Math.min(b[1] + 1, m - 1); ci++) {
        for (const v of [grid.sample(f, ci, cj), grid.sample(f, ci + 1, cj), grid.sample(f, ci, cj + 1), grid.sample(f, ci + 1, cj + 1), grid.middle(f, ci, cj)]) {
          if (out.has(v)) continue;
          // (on the near side of the planet only: the plane's projection folds the far side over)
          if (D[3 * v] * c[0] + D[3 * v + 1] * c[1] + D[3 * v + 2] * c[2] < 0.9) continue;
          const x = D[3 * v] * F[0] + D[3 * v + 1] * F[1] + D[3 * v + 2] * F[2];
          const y = D[3 * v] * F[3] + D[3 * v + 1] * F[4] + D[3 * v + 2] * F[5];
          if (inRing(xy, x, y)) out.add(v);
        }
      }
    }
  }
  return [...out];
}

/** Whether (x, y) lies inside a ring (x, y, …). */
export function inRing(xy: readonly number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
    const yi = xy[i + 1];
    const yj = xy[j + 1];
    if (yi > y !== yj > y && x < ((xy[j] - xy[i]) * (y - yi)) / (yj - yi) + xy[i]) c = !c;
  }
  return c;
}

/** A cut: the band it divides, the bank (an unshifted chain) it starts on and where along it (m). */
export interface Cut {
  readonly band: number;
  readonly chain: number;
  readonly s: number;
}

/** A cut as built: the band it divides and its line across it (x, y, z unit, …), from its bank up to the next. */
export interface CutLine {
  readonly band: number;
  readonly pts: number[];
}

/** The banks' index: cells this wide (m), searched this far (m); how far round a segment its clearance is looked for (m). */
const CELL = 1.5;
const REACH = 4;
const CLEAR = 1.5;
const SPAN = 1024;
const OFF = 512;

export class Cuts {
  readonly cuts: Cut[] = [];
  /** Per chain: its points (x, y, z), its length along each point (m), its cuts' places along it (m), in order. */
  private readonly xyz: Float64Array[];
  private readonly cum: Float64Array[];
  private readonly at: number[][];
  /**
   * Per chain, per segment: how near (m) any other bank of its level comes to it (or its own chain, farther along it
   * than a search reaches), capped. A point no farther from the segment than half this is nearest to it.
   */
  private readonly clear: Float32Array[];
  private readonly index = new Map<number, number[]>();
  private readonly R: number;
  private readonly grad = new Float64Array(3);
  /** The nearest point closest() found: its chain, place along it, distance (m). */
  private readonly found = { chain: -1, s: 0, d: Infinity };

  constructor(
    grid: SphereGrid,
    private readonly field: PlanetField,
    /** The banks traced without shifts (the cuts' places along them). */
    private readonly chains: readonly Chain[],
    private readonly base: Bands,
    private readonly p: CutParams,
    private readonly seed: number,
    /** Whether a direction is terraced (not woods, not flats). */
    private readonly terraced: (x: number, y: number, z: number) => boolean,
    minArea: number,
  ) {
    this.R = grid.R;
    const q: number[] = [0, 0, 0];
    this.xyz = chains.map((c) => {
      const a = new Float64Array(3 * c.pts.length);
      c.pts.forEach((id, i) => a.set(grid.point(id, q), 3 * i));
      return a;
    });
    this.cum = chains.map((c, ci) => {
      const P = this.xyz[ci];
      const n = c.pts.length + (c.closed ? 1 : 0);
      const cum = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        const a = 3 * (i - 1);
        const b = 3 * (i % c.pts.length);
        cum[i] = cum[i - 1] + this.R * Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
      }
      return cum;
    });
    this.at = chains.map(() => []);
    chains.forEach((c, ci) => {
      const P = this.xyz[ci];
      const segs = c.pts.length - (c.closed ? 0 : 1);
      for (let i = 0; i < segs; i++) {
        const a = 3 * i;
        const b = 3 * ((i + 1) % c.pts.length);
        const lo = [0, 1, 2].map((d) => Math.floor((Math.min(P[a + d], P[b + d]) * this.R) / CELL));
        const hi = [0, 1, 2].map((d) => Math.floor((Math.max(P[a + d], P[b + d]) * this.R) / CELL));
        for (let x = lo[0]; x <= hi[0]; x++) {
          for (let y = lo[1]; y <= hi[1]; y++) {
            for (let z = lo[2]; z <= hi[2]; z++) {
              const key = this.cellKey(c.level, x, y, z);
              const list = this.index.get(key);
              if (list) list.push(ci, i);
              else this.index.set(key, [ci, i]);
            }
          }
        }
      }
    });
    this.clear = chains.map((c) => new Float32Array(c.pts.length).fill(CLEAR));
    chains.forEach((c, ci) => {
      const P = this.xyz[ci];
      const segs = c.pts.length - (c.closed ? 0 : 1);
      for (let i = 0; i < segs; i++) {
        const a = 3 * i;
        const b = 3 * ((i + 1) % c.pts.length);
        const mx = (P[a] + P[b]) / 2;
        const my = (P[a + 1] + P[b + 1]) / 2;
        const mz = (P[a + 2] + P[b + 2]) / 2;
        const half = (this.R * Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2])) / 2;
        const reach = CLEAR + half;
        const lo = [Math.floor((mx * this.R - reach) / CELL), Math.floor((my * this.R - reach) / CELL), Math.floor((mz * this.R - reach) / CELL)];
        const hi = [Math.floor((mx * this.R + reach) / CELL), Math.floor((my * this.R + reach) / CELL), Math.floor((mz * this.R + reach) / CELL)];
        let near = CLEAR;
        for (let x = lo[0]; x <= hi[0]; x++) {
          for (let y = lo[1]; y <= hi[1]; y++) {
            for (let z = lo[2]; z <= hi[2]; z++) {
              const list = this.index.get(this.cellKey(c.level, x, y, z));
              if (!list) continue;
              for (let q = 0; q < list.length; q += 2) {
                const cj = list[q];
                const j = list[q + 1];
                // (its own chain within a search's reach along it is the walk's to find)
                if (cj === ci && this.alongChain(ci, i, j) < 3 * REACH) continue;
                near = Math.min(near, this.toSegment(cj, j, mx, my, mz, this.seg) - half);
              }
            }
          }
        }
        this.clear[ci][i] = Math.max(near, 0);
      }
    });
    this.place(minArea);
  }

  /** How far apart (m) segments i and j of chain ci lie along it. */
  private alongChain(ci: number, i: number, j: number): number {
    const d = Math.abs(this.cum[ci][i] - this.cum[ci][j]);
    return this.chains[ci].closed ? Math.min(d, this.length(ci) - d) : d;
  }

  private cellKey(k: number, x: number, y: number, z: number): number {
    return ((k * SPAN + (x + OFF)) * SPAN + (y + OFF)) * SPAN + (z + OFF);
  }

  private length(ci: number): number {
    const c = this.cum[ci];
    return c[c.length - 1];
  }

  /** The point s m along chain ci (unit). */
  pointAt(ci: number, s: number): [number, number, number] {
    const c = this.chains[ci];
    const P = this.xyz[ci];
    const cum = this.cum[ci];
    const L = this.length(ci);
    const t = c.closed ? ((s % L) + L) % L : Math.min(Math.max(s, 0), L);
    let a = 0;
    let b = cum.length - 1;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if (cum[mid] <= t) a = mid;
      else b = mid;
    }
    const f = (t - cum[a]) / Math.max(cum[b] - cum[a], 1e-12);
    const i = 3 * a;
    const j = 3 * (b % c.pts.length);
    const x = P[i] + (P[j] - P[i]) * f;
    const y = P[i + 1] + (P[j + 1] - P[i + 1]) * f;
    const z = P[i + 2] + (P[j + 2] - P[i + 2]) * f;
    const l = Math.sqrt(x * x + y * y + z * z);
    return [x / l, y / l, z / l];
  }

  /** The nearest point on a level-k bank within REACH: its chain, place along it and distance (m), or null. */
  nearest(k: number, x: number, y: number, z: number): { chain: number; s: number; d: number } | null {
    return this.closest(k, x, y, z) ? { chain: this.found.chain, s: this.found.s, d: this.found.d } : null;
  }

  /** Per level, the last nearest segment found (chain, segment): the next point asked is mostly beside it. */
  private readonly last = new Map<number, [number, number]>();

  /** The distance (m) from a direction to segment i of chain ci, and where along the chain its nearest point lies (m), into seg. */
  private toSegment(ci: number, i: number, x: number, y: number, z: number, seg: number[]): number {
    const R = this.R;
    const P = this.xyz[ci];
    const a = 3 * i;
    const b = 3 * ((i + 1) % this.chains[ci].pts.length);
    const ex = P[b] - P[a];
    const ey = P[b + 1] - P[a + 1];
    const ez = P[b + 2] - P[a + 2];
    const ll = ex * ex + ey * ey + ez * ez;
    const t = ll > 0 ? Math.min(Math.max(((x - P[a]) * ex + (y - P[a + 1]) * ey + (z - P[a + 2]) * ez) / ll, 0), 1) : 0;
    const qx = P[a] + ex * t - x;
    const qy = P[a + 1] + ey * t - y;
    const qz = P[a + 2] + ez * t - z;
    seg[0] = this.cum[ci][i] + t * R * Math.sqrt(ll);
    return R * Math.sqrt(qx * qx + qy * qy + qz * qz);
  }

  private readonly seg = [0];

  private closest(k: number, x: number, y: number, z: number): boolean {
    const best = this.found;
    best.chain = -1;
    best.d = Infinity;
    // (from the last nearest segment of this level, along its chain while it comes nearer: an upper bound on the
    // distance, then only the cells within it searched)
    const last = this.last.get(k);
    if (last) {
      const [ci, i0] = last;
      const c = this.chains[ci];
      const segs = c.pts.length - (c.closed ? 0 : 1);
      let i = i0;
      let d = this.toSegment(ci, i, x, y, z, this.seg);
      for (const dir of [1, -1]) {
        for (let n = 0; n < 64; n++) {
          let j = i + dir;
          if (c.closed) j = (j + segs) % segs;
          else if (j < 0 || j >= segs) break;
          const dj = this.toSegment(ci, j, x, y, z, this.seg);
          if (dj >= d) break;
          d = dj;
          i = j;
        }
      }
      if (d <= REACH) {
        best.chain = ci;
        best.d = this.toSegment(ci, i, x, y, z, this.seg);
        best.s = this.seg[0];
        this.lastSeg = i;
        // (nothing else of this level comes near enough to be nearer: done; else the cells within the distance)
        if (2 * best.d > this.clear[ci][i] || this.alongChain(ci, i0, i) > 2 * REACH) this.scan(k, x, y, z, best.d);
        this.last.set(k, [best.chain, this.lastSeg]);
        return true;
      }
    }
    this.shells(k, x, y, z);
    if (best.chain >= 0) this.last.set(k, [best.chain, this.lastSeg]);
    return best.chain >= 0;
  }

  /** The nearest level-k segment within REACH, shell of cells by shell outward from the direction's own cell, into `found`. */
  private shells(k: number, x: number, y: number, z: number): void {
    const R = this.R;
    const best = this.found;
    const cx = Math.floor((x * R) / CELL);
    const cy = Math.floor((y * R) / CELL);
    const cz = Math.floor((z * R) / CELL);
    // (how near the point lies to its own cell's walls: nothing outside the cells searched out to r is nearer
    // than this plus r − 1 cells)
    const fx = (x * R) / CELL - cx;
    const fy = (y * R) / CELL - cy;
    const fz = (z * R) / CELL - cz;
    const wall = CELL * Math.min(fx, 1 - fx, fy, 1 - fy, fz, 1 - fz);
    const reach = Math.ceil(REACH / CELL);
    for (let r = 0; r <= reach; r++) {
      if (best.chain >= 0 && r > 0 && best.d <= wall + (r - 1) * CELL) break;
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const list = this.index.get(this.cellKey(k, cx + dx, cy + dy, cz + dz));
            if (!list) continue;
            for (let q = 0; q < list.length; q += 2) {
              const d = this.toSegment(list[q], list[q + 1], x, y, z, this.seg);
              if (d <= REACH && d < best.d) {
                best.chain = list[q];
                best.s = this.seg[0];
                best.d = d;
                this.lastSeg = list[q + 1];
              }
            }
          }
        }
      }
    }
  }

  /** The segment the last search found nearest. */
  private lastSeg = 0;

  /** Every level-k segment in the cells within `reach` (m) of a direction: the nearest of them into `found`, if nearer. */
  private scan(k: number, x: number, y: number, z: number, reach: number): void {
    const R = this.R;
    const best = this.found;
    const lo = [Math.floor((x * R - reach) / CELL), Math.floor((y * R - reach) / CELL), Math.floor((z * R - reach) / CELL)];
    const hi = [Math.floor((x * R + reach) / CELL), Math.floor((y * R + reach) / CELL), Math.floor((z * R + reach) / CELL)];
    for (let cz = lo[2]; cz <= hi[2]; cz++) {
      for (let cy = lo[1]; cy <= hi[1]; cy++) {
        for (let cx = lo[0]; cx <= hi[0]; cx++) {
          const list = this.index.get(this.cellKey(k, cx, cy, cz));
          if (!list) continue;
          for (let q = 0; q < list.length; q += 2) {
            const d = this.toSegment(list[q], list[q + 1], x, y, z, this.seg);
            if (d <= REACH && d < best.d) {
              best.chain = list[q];
              best.s = this.seg[0];
              best.d = d;
              this.lastSeg = list[q + 1];
            }
          }
        }
      }
    }
  }

  /** How far (× the step) level k's bank is shifted at a direction: its paddy's own, swung to the next one's at each cut. */
  shift(k: number, x: number, y: number, z: number): number {
    if (!this.closest(k, x, y, z)) return 0;
    const chain = this.found.chain;
    const cuts = this.at[chain];
    const closed = this.chains[chain].closed;
    const L = this.length(chain);
    const own = (seg: number): number => this.p.shift * (2 * unit(hash32((Math.imul(chain, 7919) + seg) ^ (this.seed + 4242))) - 1);
    if (cuts.length === 0) return own(0);
    const s = this.found.s;
    // the paddy it lies in: after the last cut before it
    let i = 0;
    while (i < cuts.length && cuts[i] <= s) i++;
    const seg = closed ? (i - 1 + cuts.length) % cuts.length : i;
    // the nearest cut, and the paddies either side of it
    const prev = i - 1;
    const next = i;
    const before = prev >= 0 ? s - cuts[prev] : closed ? s - (cuts[cuts.length - 1] - L) : Infinity;
    const after = next < cuts.length ? cuts[next] - s : closed ? cuts[0] + L - s : Infinity;
    const half = this.p.blend / 2;
    if (Math.min(before, after) >= half) return own(seg);
    if (before <= after) {
      const left = closed ? (seg - 1 + cuts.length) % cuts.length : seg - 1;
      return own(left) + (own(seg) - own(left)) * smoothstep(-half, half, before);
    }
    const right = closed ? (seg + 1) % cuts.length : seg + 1;
    return own(seg) + (own(right) - own(seg)) * smoothstep(-half, half, -after);
  }

  /**
   * Walk the fall line from a direction, up (dir 1) or down (−1), until f turns ≥ 0 (or < 0 when `drop`): the
   * crossing, refined, or null (the walk's points, from its second, into path).
   */
  walk(x: number, y: number, z: number, dir: number, f: Field, drop: boolean, max: number, path?: number[], within?: (x: number, y: number, z: number) => boolean): [number, number, number] | null {
    const step = 0.1 / this.R;
    let px = x;
    let py = y;
    let pz = z;
    const hit = (qx: number, qy: number, qz: number): boolean => f(qx, qy, qz) >= 0 !== drop;
    if (hit(px, py, pz)) return [px, py, pz];
    const g = this.grad;
    for (let i = 0; i < max / 0.1; i++) {
      // (the terrace field's own way uphill there)
      this.field.terrace(px, py, pz, g);
      const l = Math.hypot(g[0], g[1], g[2]);
      if (l < 1e-6) return null;
      let qx = px + (dir * step * g[0]) / l;
      let qy = py + (dir * step * g[1]) / l;
      let qz = pz + (dir * step * g[2]) / l;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
      qx /= ql;
      qy /= ql;
      qz /= ql;
      // (the land stops being terraced: no further)
      if (within && !within(qx, qy, qz)) return path ? [px, py, pz] : null;
      if (hit(qx, qy, qz)) {
        let [ax, ay, az] = [px, py, pz];
        let [bx, by, bz] = [qx, qy, qz];
        for (let it = 0; it < 12; it++) {
          let mx = (ax + bx) / 2;
          let my = (ay + by) / 2;
          let mz = (az + bz) / 2;
          const ml = Math.sqrt(mx * mx + my * my + mz * mz);
          mx /= ml;
          my /= ml;
          mz /= ml;
          if (hit(mx, my, mz)) [bx, by, bz] = [mx, my, mz];
          else [ax, ay, az] = [mx, my, mz];
        }
        path?.push(bx, by, bz);
        return [bx, by, bz];
      }
      [px, py, pz] = [qx, qy, qz];
      path?.push(px, py, pz);
    }
    return null;
  }

  /** Place the cuts: along each bank a span apart, each cascading up and down the fall line while chance allows. */
  private place(minArea: number): void {
    const { p, chains } = this;
    let r = Math.imul(this.seed, 2654435761) >>> 0 || 1;
    const rand = (): number => {
      r ^= r << 13;
      r >>>= 0;
      r ^= r >>> 17;
      r ^= r << 5;
      r >>>= 0;
      return r / 4294967296;
    };
    const L = this.base.levels.length;
    const free = (ci: number, s: number, gap: number): boolean => {
      const len = this.length(ci);
      for (const c of this.at[ci]) {
        let d = Math.abs(c - s);
        if (chains[ci].closed) d = Math.min(d, len - d);
        if (d < gap) return false;
      }
      return true;
    };
    const add = (ci: number, s: number): void => {
      const list = this.at[ci];
      list.push(s);
      list.sort((a, b) => a - b);
      this.cuts.push({ band: chains[ci].level, chain: ci, s });
    };
    const gap = 0.45 * p.spacing[0];
    const order = chains
      .map((_, i) => i)
      .filter((i) => {
        const c = chains[i];
        return c.level >= 1 && c.level + 1 < L && (!c.closed || Math.abs(c.area) >= minArea);
      });
    for (const ci of order) {
      const len = this.length(ci);
      for (let s = rand() * p.spacing[1]; s < len - (chains[ci].closed ? 0 : 1); s += p.spacing[0] + rand() * (p.spacing[1] - p.spacing[0])) {
        const [x, y, z] = this.pointAt(ci, s);
        if (!this.terraced(x, y, z) || !free(ci, s, gap)) continue;
        add(ci, s);
        // the cascade: up the fall line, band after band, then down
        for (const dir of [1, -1]) {
          let k = chains[ci].level;
          let [cx, cy, cz] = [x, y, z];
          while (rand() < p.cascade) {
            k += dir;
            if (k < 1 || k + 1 >= L) break;
            // (up: to where level k's bank begins; down: to where level k's ends below)
            const level = this.base.H(k)[0];
            const hit = dir > 0 ? this.walk(cx, cy, cz, 1, level, false, 12) : this.walk(cx, cy, cz, -1, level, true, 12);
            if (!hit) break;
            const near = this.nearest(k, hit[0], hit[1], hit[2]);
            if (!near || near.d > 0.3) break;
            const s2 = near.s + p.drift * (2 * rand() - 1);
            [cx, cy, cz] = this.pointAt(near.chain, s2);
            if (!this.terraced(cx, cy, cz) || !free(near.chain, s2, gap * 0.6)) break;
            add(near.chain, s2);
          }
        }
      }
    }
  }

  /** The cuts' lines across their bands, on the final banks: from where the cut's bank now runs up to the next bank (or to where the terraces end); none that would end at nothing. */
  lines(final: Bands, within: (x: number, y: number, z: number) => boolean): CutLine[] {
    const out: CutLine[] = [];
    this.deadEnds = 0;
    for (const cut of this.cuts) {
      const [x, y, z] = this.pointAt(cut.chain, cut.s);
      const k = cut.band;
      const own = final.H(k)[0];
      const up = final.H(k + 1)[0];
      // its bank, as shifted: down the fall line if the bank moved out, up if it moved in
      const lo = own(x, y, z) >= 0 ? this.walk(x, y, z, -1, own, true, 4) : this.walk(x, y, z, 1, own, false, 4);
      if (!lo) continue;
      const pts = [lo[0], lo[1], lo[2]];
      const hi = this.walk(lo[0], lo[1], lo[2], 1, up, false, 15, pts, within);
      if (!hi) continue;
      // (a cut up to the next level's bank where that ring was levelled into its band, a hilltop's small top: it would
      // stop in the middle of the paddy, a dead end (Kai: "dead-end divisions going over a local hilltop's flat"))
      if (up(hi[0], hi[1], hi[2]) >= 0 && !this.banked(final, k + 1, hi)) {
        this.deadEnds++;
        continue;
      }
      let len = 0;
      for (let i = 3; i < pts.length; i += 3) len += this.R * Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
      if (len < 0.4) continue;
      out.push({ band: k, pts });
    }
    return out;
  }

  /** The cuts lines() left out: those that would have ended at nothing. */
  deadEnds = 0;
  private readonly sq = { face: 0, ci: 0, cj: 0 };

  /** Whether a point of level k's bank bounds band k as the final bands have it (not a ring levelled into the band round it): a vertex of the grid's square a little up the fall line from it in band k or above. */
  private banked(final: Bands, k: number, at: readonly number[]): boolean {
    const g = this.grad;
    this.field.terrace(at[0], at[1], at[2], g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    const s = 0.4 / this.R;
    let qx = at[0] + (s * g[0]) / l;
    let qy = at[1] + (s * g[1]) / l;
    let qz = at[2] + (s * g[2]) / l;
    const ql = Math.hypot(qx, qy, qz);
    qx /= ql;
    qy /= ql;
    qz /= ql;
    const { face, ci, cj } = final.grid.square(qx, qy, qz, this.sq);
    const t = final.grid.triangles(face, ci, cj);
    for (const v of [t[0], t[3], t[6], t[9], t[2]]) if (final.band[v] >= k) return true;
    return false;
  }
}
