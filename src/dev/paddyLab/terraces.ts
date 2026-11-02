import { smoothstep } from "../../core/math";
import type { TerraceField } from "./field";
import { inRing, type Chain, type Grid } from "./grid";
import { hash01, type Grad2 } from "./noise";

// The paddy lab's terraces on the grid. A level's own field (the terrace
// field less the level, less the level's own wander, plus its paddies'
// shifts) is ≥ 0 above its bank; a point's band is the highest level whose
// field is ≥ 0 there (so where a band pinches out to nothing, the band above
// meets the band below). Rings smaller than `minArea` are levelled into the
// band round them.
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

/** A field per level over the canvas, given the terrace field's value there (t). */
export type LevelField = (k: number, x: number, y: number, t: number) => number;

export class Bands {
  /** Each sample's band (the levels' index of the band it lies in). */
  readonly band: Int32Array;
  chains: Chain[] = [];
  dropped = 0;

  constructor(
    readonly grid: Grid,
    readonly levels: readonly number[],
    private readonly G: LevelField,
    /** The terrace field (m), at the samples and anywhere. */
    T: Float64Array,
    private readonly terrace: (x: number, y: number) => number,
    private readonly slot: number,
  ) {
    this.band = new Int32Array(grid.N);
    for (let v = 0; v < grid.N; v++)
      this.band[v] = this.bandAt(grid.X[v], grid.Y[v], T[v]);
  }

  private g(k: number, x: number, y: number, t: number): number {
    if (k < 0) return Infinity;
    if (k >= this.levels.length) return -Infinity;
    return this.G(k, x, y, t);
  }

  /** ≥ 0 where the band is k or above. */
  H(k: number, x: number, y: number): number {
    const t = this.terrace(x, y);
    return Math.max(this.g(k, x, y, t), this.g(k + 1, x, y, t));
  }

  /** The band at (x, y), where the terrace field is t (m). */
  bandAt(x: number, y: number, t: number = this.terrace(x, y)): number {
    // (near the terrace field's own band there: a level's wander and shift move it a step at most)
    let a = 0;
    let b = this.levels.length;
    while (a < b) {
      const c = (a + b) >> 1;
      if (this.levels[c] > t) b = c;
      else a = c + 1;
    }
    const guess = a - 1;
    for (let k = guess + 2; k > guess - 3; k--)
      if (this.g(k, x, y, t) >= 0) return k;
    return guess - 3;
  }

  /** Where level k's bank crosses the edge u–v. */
  cross = (u: number, v: number, k: number): number =>
    this.grid.crossing(this.slot + k, u, v, (x, y) => this.H(k, x, y), 0);

  trace(): Chain[] {
    this.chains = this.grid.trace(this.band, this.cross);
    return this.chains;
  }

  /** Level the rings under minArea into the band round them (the largest ring round a sample has the last word), and trace again. */
  levelSmall(minArea: number): void {
    const { grid } = this;
    const small = this.chains
      .filter((c) => c.closed && Math.abs(c.area) < minArea)
      .sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
    this.dropped = small.length;
    if (small.length === 0) return;
    const was = this.band.slice();
    for (const r of small) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < r.xy.length; i += 2) {
        x0 = Math.min(x0, r.xy[i]);
        x1 = Math.max(x1, r.xy[i]);
        y0 = Math.min(y0, r.xy[i + 1]);
        y1 = Math.max(y1, r.xy[i + 1]);
      }
      const set = (v: number): void => {
        if (inRing(r.xy, grid.X[v], grid.Y[v]))
          this.band[v] =
            r.area > 0
              ? Math.min(was[v], r.level - 1)
              : Math.max(was[v], r.level);
      };
      const { n, m, cell, half } = grid;
      for (
        let j = Math.max(0, Math.ceil((y0 + half) / cell));
        j <= Math.min(n - 1, Math.floor((y1 + half) / cell));
        j++
      ) {
        for (
          let i = Math.max(0, Math.ceil((x0 + half) / cell));
          i <= Math.min(n - 1, Math.floor((x1 + half) / cell));
          i++
        )
          set(j * n + i);
      }
      for (
        let cj = Math.max(0, Math.ceil((y0 + half) / cell - 0.5));
        cj <= Math.min(m - 1, Math.floor((y1 + half) / cell - 0.5));
        cj++
      ) {
        for (
          let ci = Math.max(0, Math.ceil((x0 + half) / cell - 0.5));
          ci <= Math.min(m - 1, Math.floor((x1 + half) / cell - 0.5));
          ci++
        )
          set(n * n + cj * m + ci);
      }
    }
    this.trace();
  }
}

/** A cut: the band it divides, the bank (an unshifted chain) it starts on and where along it (m). */
export interface Cut {
  readonly band: number;
  readonly chain: number;
  readonly s: number;
}

/** A cut as built: the band it divides and its line across it (x, y, …), from its bank up to the next. */
export interface CutLine {
  readonly band: number;
  readonly xy: number[];
}

const CELL = 2;
const REACH = 4;

export class Cuts {
  readonly cuts: Cut[] = [];
  /** Per chain: its cuts' places along it (m), in order. */
  private readonly at: number[][];
  private readonly cum: Float64Array[];
  private readonly index = new Map<number, number[]>();
  private readonly g: Grad2 = { x: 0, y: 0 };

  constructor(
    private readonly field: TerraceField,
    /** The banks traced without shifts (the cuts' places along them). */
    private readonly chains: readonly Chain[],
    private readonly base: Bands,
    private readonly p: CutParams,
    /** Whether a point is terraced (not woods, not flats). */
    private readonly terraced: (x: number, y: number) => boolean,
    minArea: number,
  ) {
    this.at = chains.map(() => []);
    this.cum = chains.map((c) => {
      const n = c.xy.length / 2 + (c.closed ? 1 : 0);
      const cum = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        const a = 2 * (i - 1);
        const b = 2 * (i % (c.xy.length / 2));
        cum[i] =
          cum[i - 1] + Math.hypot(c.xy[b] - c.xy[a], c.xy[b + 1] - c.xy[a + 1]);
      }
      return cum;
    });
    chains.forEach((c, ci) => {
      const segs = c.xy.length / 2 - (c.closed ? 0 : 1);
      for (let i = 0; i < segs; i++) {
        const a = 2 * i;
        const b = 2 * ((i + 1) % (c.xy.length / 2));
        const x0 = Math.floor(Math.min(c.xy[a], c.xy[b]) / CELL);
        const x1 = Math.floor(Math.max(c.xy[a], c.xy[b]) / CELL);
        const y0 = Math.floor(Math.min(c.xy[a + 1], c.xy[b + 1]) / CELL);
        const y1 = Math.floor(Math.max(c.xy[a + 1], c.xy[b + 1]) / CELL);
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            const key = this.cellKey(c.level, cx, cy);
            const list = this.index.get(key);
            if (list) list.push(ci, i);
            else this.index.set(key, [ci, i]);
          }
        }
      }
    });
    this.place(minArea);
  }

  private cellKey(k: number, cx: number, cy: number): number {
    return (k * 512 + (cy + 256)) * 512 + (cx + 256);
  }

  private length(ci: number): number {
    const c = this.cum[ci];
    return c[c.length - 1];
  }

  /** The point s m along chain ci. */
  pointAt(ci: number, s: number): [number, number] {
    const c = this.chains[ci];
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
    const i = 2 * a;
    const j = 2 * (b % (c.xy.length / 2));
    return [
      c.xy[i] + (c.xy[j] - c.xy[i]) * f,
      c.xy[i + 1] + (c.xy[j + 1] - c.xy[i + 1]) * f,
    ];
  }

  /** The nearest point on a level-k bank within REACH: its chain and place along it, or null. */
  nearest(
    k: number,
    x: number,
    y: number,
  ): { chain: number; s: number; d: number } | null {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const R = Math.ceil(REACH / CELL);
    let best: { chain: number; s: number; d: number } | null = null;
    // (ring by ring outward: once the nearest so far is nearer than the next ring can be, done)
    for (let r = 0; r <= R; r++) {
      if (best && best.d <= (r - 1) * CELL) break;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const list = this.index.get(this.cellKey(k, cx + dx, cy + dy));
          if (!list) continue;
          for (let q = 0; q < list.length; q += 2) {
            const ci = list[q];
            const i = list[q + 1];
            const c = this.chains[ci];
            const a = 2 * i;
            const b = 2 * ((i + 1) % (c.xy.length / 2));
            const ex = c.xy[b] - c.xy[a];
            const ey = c.xy[b + 1] - c.xy[a + 1];
            const ll = ex * ex + ey * ey;
            const t =
              ll > 0
                ? Math.min(
                    Math.max(
                      ((x - c.xy[a]) * ex + (y - c.xy[a + 1]) * ey) / ll,
                      0,
                    ),
                    1,
                  )
                : 0;
            const d = Math.hypot(
              c.xy[a] + ex * t - x,
              c.xy[a + 1] + ey * t - y,
            );
            if (d <= REACH && (!best || d < best.d))
              best = { chain: ci, s: this.cum[ci][i] + t * Math.sqrt(ll), d };
          }
        }
      }
    }
    return best;
  }

  /** How far (× the step) level k's bank is shifted at (x, y): its paddy's own, swung to the next one's at each cut. */
  shift(k: number, x: number, y: number): number {
    const near = this.nearest(k, x, y);
    if (!near) return 0;
    const cuts = this.at[near.chain];
    const closed = this.chains[near.chain].closed;
    const L = this.length(near.chain);
    const own = (seg: number): number =>
      this.p.shift *
      (2 * hash01(near.chain * 7919 + seg, this.field.p.seed + 4242) - 1);
    if (cuts.length === 0) return own(0);
    const s = near.s;
    // the paddy it lies in: after the last cut before it
    let i = 0;
    while (i < cuts.length && cuts[i] <= s) i++;
    const seg = closed ? (i - 1 + cuts.length) % cuts.length : i;
    // the nearest cut, and the paddies either side of it
    const prev = i - 1;
    const next = i;
    const before =
      prev >= 0
        ? s - cuts[prev]
        : closed
          ? s - (cuts[cuts.length - 1] - L)
          : Infinity;
    const after =
      next < cuts.length ? cuts[next] - s : closed ? cuts[0] + L - s : Infinity;
    const half = this.p.blend / 2;
    if (Math.min(before, after) >= half) return own(seg);
    if (before <= after) {
      const left = closed ? (seg - 1 + cuts.length) % cuts.length : seg - 1;
      return (
        own(left) + (own(seg) - own(left)) * smoothstep(-half, half, before)
      );
    }
    const right = closed ? (seg + 1) % cuts.length : seg + 1;
    return own(seg) + (own(right) - own(seg)) * smoothstep(-half, half, -after);
  }

  /** Walk the fall line from (x, y), up (dir 1) or down (−1), until f turns ≥ 0 (or < 0 when `drop`): the crossing, refined, or null. */
  walk(
    x: number,
    y: number,
    dir: number,
    f: (x: number, y: number) => number,
    drop: boolean,
    max: number,
    path?: number[],
    within?: (x: number, y: number) => boolean,
  ): [number, number] | null {
    const step = 0.1;
    let px = x;
    let py = y;
    const hit = (qx: number, qy: number): boolean => f(qx, qy) >= 0 !== drop;
    if (hit(px, py)) return [px, py];
    for (let i = 0; i < max / step; i++) {
      this.field.terrace(px, py, this.g);
      const l = Math.hypot(this.g.x, this.g.y);
      if (l < 1e-6) return null;
      const qx = px + (dir * step * this.g.x) / l;
      const qy = py + (dir * step * this.g.y) / l;
      // (the land stops being terraced, or the canvas ends: no further)
      if (within && !within(qx, qy)) return path ? [px, py] : null;
      if (hit(qx, qy)) {
        let ax = px;
        let ay = py;
        let bx = qx;
        let by = qy;
        for (let it = 0; it < 12; it++) {
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          if (hit(mx, my)) {
            bx = mx;
            by = my;
          } else {
            ax = mx;
            ay = my;
          }
        }
        path?.push(bx, by);
        return [bx, by];
      }
      px = qx;
      py = qy;
      path?.push(px, py);
    }
    return null;
  }

  /** Place the cuts: along each bank a span apart, each cascading up and down the fall line while chance allows. */
  private place(minArea: number): void {
    const { p, chains } = this;
    const seed = this.field.p.seed;
    let r = (seed * 2654435761) >>> 0 || 1;
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
    const level = (k: number) => (x: number, y: number) => this.base.H(k, x, y);
    const order = chains
      .map((_, i) => i)
      .filter((i) => {
        const c = chains[i];
        return (
          c.level >= 1 &&
          c.level + 1 < L &&
          (!c.closed || Math.abs(c.area) >= minArea)
        );
      });
    for (const ci of order) {
      const len = this.length(ci);
      for (
        let s = rand() * p.spacing[1];
        s < len - (chains[ci].closed ? 0 : 1);
        s += p.spacing[0] + rand() * (p.spacing[1] - p.spacing[0])
      ) {
        const [x, y] = this.pointAt(ci, s);
        if (!this.terraced(x, y) || !free(ci, s, gap)) continue;
        add(ci, s);
        // the cascade: up the fall line, band after band, then down
        for (const dir of [1, -1]) {
          let k = chains[ci].level;
          let [cx, cy] = [x, y];
          while (rand() < p.cascade) {
            k += dir;
            if (k < 1 || k + 1 >= L) break;
            // (up: to where level k's bank begins; down: to where level k's ends below)
            const hit =
              dir > 0
                ? this.walk(cx, cy, 1, level(k), false, 12)
                : this.walk(cx, cy, -1, level(k), true, 12);
            if (!hit) break;
            const near = this.nearest(k, hit[0], hit[1]);
            if (!near || near.d > 0.3) break;
            const s2 = near.s + p.drift * (2 * rand() - 1);
            [cx, cy] = this.pointAt(near.chain, s2);
            if (!this.terraced(cx, cy) || !free(near.chain, s2, gap * 0.6))
              break;
            add(near.chain, s2);
          }
        }
      }
    }
  }

  /** The cuts' lines across their bands, on the final banks: from where the cut's bank now runs up to the next bank (or to where the terraces end). */
  lines(final: Bands, within: (x: number, y: number) => boolean): CutLine[] {
    const out: CutLine[] = [];
    for (const cut of this.cuts) {
      const [x, y] = this.pointAt(cut.chain, cut.s);
      const k = cut.band;
      const own = (qx: number, qy: number): number => final.H(k, qx, qy);
      const up = (qx: number, qy: number): number => final.H(k + 1, qx, qy);
      // its bank, as shifted: down the fall line if the bank moved out, up if it moved in
      const lo =
        own(x, y) >= 0
          ? this.walk(x, y, -1, own, true, 4)
          : this.walk(x, y, 1, own, false, 4);
      if (!lo) continue;
      const xy = [lo[0], lo[1]];
      const hi = this.walk(lo[0], lo[1], 1, up, false, 15, xy, within);
      if (!hi) continue;
      let len = 0;
      for (let i = 2; i < xy.length; i += 2)
        len += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
      if (len < 0.4) continue;
      out.push({ band: k, xy });
    }
    return out;
  }
}
