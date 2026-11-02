// The paddy lab's grid over the canvas: samples every `cell` m, each square
// split into four triangles round its middle (sampled too, so no square is
// ambiguous). Every outline in the lab is found on it the same way: where a
// field meets a level on a triangle's edge is worked out on the field itself
// (bracketed and refined, not interpolated), once per field, level and edge,
// and shared by the triangles either side; linked, those points are the
// outlines, and the same points bound the pieces each triangle is cut into.
// So the outlines and the surfaces they bound are one, with no seam.

export interface Chain {
  /** Its level (the index it bounds from below); its points (x, y, …: m). */
  readonly level: number;
  readonly xy: number[];
  /** A ring, or a chain from the canvas's edge to its edge. */
  readonly closed: boolean;
  /** A ring's signed area (m²: > 0 round the higher index, < 0 round a hollow of it). */
  readonly area: number;
}

/** A field over the canvas. */
export type Field = (x: number, y: number) => number;

/** A corner of a piece of a triangle: a sample (v ≥ 0), or a point on the grid's edge a–b (a < b), or inside (a = −1). */
export interface Corner {
  readonly x: number;
  readonly y: number;
  readonly v: number;
  readonly a: number;
  readonly b: number;
}

const V_BITS = 2097152;

export class Grid {
  readonly n: number;
  readonly m: number;
  readonly N: number;
  readonly X: Float64Array;
  readonly Y: Float64Array;
  /** The crossings found so far. */
  readonly px: number[] = [];
  readonly py: number[] = [];
  private readonly memo = new Map<number, Map<number, number>>();
  private readonly tri = new Int32Array(12);

  constructor(
    readonly half: number,
    readonly cell: number,
  ) {
    this.n = Math.round((2 * half) / cell) + 1;
    this.m = this.n - 1;
    this.N = this.n * this.n + this.m * this.m;
    if (this.N >= V_BITS) throw new Error('the paddy lab: too fine a grid');
    this.X = new Float64Array(this.N);
    this.Y = new Float64Array(this.N);
    const { n, m } = this;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.X[j * n + i] = -half + i * cell;
        this.Y[j * n + i] = -half + j * cell;
      }
    }
    for (let cj = 0; cj < m; cj++) {
      for (let ci = 0; ci < m; ci++) {
        this.X[n * n + cj * m + ci] = -half + (ci + 0.5) * cell;
        this.Y[n * n + cj * m + ci] = -half + (cj + 0.5) * cell;
      }
    }
  }

  /** Square (ci, cj)'s four triangles, counter-clockwise round its middle: [a, b, e,  b, c, e,  c, d, e,  d, a, e]. */
  triangles(ci: number, cj: number): Int32Array {
    const { n, m } = this;
    const a = cj * n + ci;
    const b = a + 1;
    const c = a + n + 1;
    const d = a + n;
    const e = n * n + cj * m + ci;
    this.tri.set([a, b, e, b, c, e, c, d, e, d, a, e]);
    return this.tri;
  }

  key(u: number, v: number): number {
    return u < v ? u * V_BITS + v : v * V_BITS + u;
  }

  /** The edge a key names (a < b). */
  ends(key: number): [number, number] {
    const a = Math.floor(key / V_BITS);
    return [a, key - a * V_BITS];
  }

  /** Where f meets `level` on the edge u–v: one point per slot (a field and level) and edge. */
  crossing(slot: number, u: number, v: number, f: Field, level: number): number {
    let memo = this.memo.get(slot);
    if (!memo) {
      memo = new Map();
      this.memo.set(slot, memo);
    }
    const key = this.key(u, v);
    const known = memo.get(key);
    if (known !== undefined) return known;
    // (from the lower id, so both triangles sharing the edge get the same point)
    const a = Math.min(u, v);
    const b = Math.max(u, v);
    const t = root(f, level, this.X[a], this.Y[a], this.X[b], this.Y[b]);
    this.px.push(this.X[a] + (this.X[b] - this.X[a]) * t);
    this.py.push(this.Y[a] + (this.Y[b] - this.Y[a]) * t);
    memo.set(key, this.px.length - 1);
    return this.px.length - 1;
  }

  /** The crossing on u–v as a corner. */
  corner(slot: number, u: number, v: number, f: Field, level: number): Corner {
    const i = this.crossing(slot, u, v, f, level);
    return { x: this.px[i], y: this.py[i], v: -1, a: Math.min(u, v), b: Math.max(u, v) };
  }

  /** The square holding (x, y). */
  square(x: number, y: number): [number, number] {
    const c = (t: number): number => Math.min(Math.max(Math.floor((t + this.half) / this.cell), 0), this.m - 1);
    return [c(x), c(y)];
  }

  /**
   * The outlines between the regions of an index over the samples: for each level k, the line between the
   * samples where idx ≥ k and those where idx < k (the first on its left), its points from cross(u, v, k).
   */
  trace(idx: Int32Array, cross: (u: number, v: number, k: number) => number): Chain[] {
    const next = new Map<number, Map<number, number>>();
    const key = (u: number, v: number): number => this.key(u, v);
    for (let cj = 0; cj < this.m; cj++) {
      for (let ci = 0; ci < this.m; ci++) {
        const t = this.triangles(ci, cj);
        for (let q = 0; q < 12; q += 3) {
          const A = t[q];
          const B = t[q + 1];
          const C = t[q + 2];
          const ia = idx[A];
          const ib = idx[B];
          const ic = idx[C];
          const top = Math.max(ia, ib, ic);
          for (let k = Math.min(ia, ib, ic) + 1; k <= top; k++) {
            const a = ia >= k;
            const b = ib >= k;
            const c = ic >= k;
            let s: number;
            let e: number;
            if (+a + +b + +c === 1) {
              if (a) [s, e] = [key(A, B), key(C, A)];
              else if (b) [s, e] = [key(B, C), key(A, B)];
              else [s, e] = [key(C, A), key(B, C)];
            } else if (!a) [s, e] = [key(C, A), key(A, B)];
            else if (!b) [s, e] = [key(A, B), key(B, C)];
            else [s, e] = [key(B, C), key(C, A)];
            let lv = next.get(k);
            if (!lv) {
              lv = new Map();
              next.set(k, lv);
            }
            lv.set(s, e);
          }
        }
      }
    }
    const chains: Chain[] = [];
    for (const k of [...next.keys()].sort((a, b) => a - b)) {
      const lv = next.get(k) as Map<number, number>;
      const heads = new Set(lv.keys());
      for (const e of lv.values()) heads.delete(e);
      const seen = new Set<number>();
      for (const s0 of [...heads, ...lv.keys()]) {
        if (seen.has(s0)) continue;
        const xy: number[] = [];
        let e = s0;
        let closed = false;
        for (;;) {
          seen.add(e);
          const [u, v] = this.ends(e);
          const p = cross(u, v, k);
          xy.push(this.px[p], this.py[p]);
          const f = lv.get(e);
          if (f === undefined) break;
          if (f === s0) {
            closed = true;
            break;
          }
          e = f;
        }
        chains.push({ level: k, xy, closed, area: closed ? signedArea(xy) : 0 });
      }
    }
    return chains;
  }
}

/** The fraction along a→b where f = level (regula falsi, Illinois); the middle if f does not bracket it there. */
export function root(f: Field, level: number, ax: number, ay: number, bx: number, by: number): number {
  let fa = f(ax, ay) - level;
  let fb = f(bx, by) - level;
  if ((fa >= 0) === (fb >= 0)) return 0.5;
  let ta = 0;
  let tb = 1;
  let side = 0;
  for (let it = 0; it < 10; it++) {
    const t = (ta * fb - tb * fa) / (fb - fa);
    const v = f(ax + (bx - ax) * t, ay + (by - ay) * t) - level;
    if (v === 0) return t;
    if ((v >= 0) === (fb >= 0)) {
      tb = t;
      fb = v;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      ta = t;
      fa = v;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return (ta * fb - tb * fa) / (fb - fa);
}

export function signedArea(xy: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) a += xy[j] * xy[i + 1] - xy[i] * xy[j + 1];
  return a / 2;
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

/** A side of a field's level, to cut a piece of a triangle by. */
export class Side {
  constructor(
    private readonly grid: Grid,
    /** Its slot (a field and level): the crossings it shares. */
    private readonly slot: number,
    private readonly f: Field,
    private readonly level: number,
    /** Which side a sample is on (the index the outlines were traced from, so the two agree). */
    private readonly sample: (v: number) => boolean,
    /** Keep the side at or above the level, or below it. */
    private readonly above: boolean,
  ) {}

  keep(p: Corner): boolean {
    return (p.v >= 0 ? this.sample(p.v) : this.f(p.x, p.y) >= this.level) === this.above;
  }

  /** The corner where the piece's edge p–q crosses the level: shared with the neighbour along an edge of the grid. */
  cut(p: Corner, q: Corner): Corner {
    const e = along(p, q);
    if (e) return this.grid.corner(this.slot, e[0], e[1], this.f, this.level);
    const t = root(this.f, this.level, p.x, p.y, q.x, q.y);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, v: -1, a: -1, b: -1 };
  }
}

/** The edge of the grid two corners of a piece both lie on, if any. */
function along(p: Corner, q: Corner): [number, number] | null {
  if (p.v >= 0 && q.v >= 0) return p.v < q.v ? [p.v, q.v] : [q.v, p.v];
  if (p.v >= 0 && q.a >= 0 && (q.a === p.v || q.b === p.v)) return [q.a, q.b];
  if (q.v >= 0 && p.a >= 0 && (p.a === q.v || p.b === q.v)) return [p.a, p.b];
  if (p.a >= 0 && p.a === q.a && p.b === q.b) return [p.a, p.b];
  return null;
}

/** A piece cut down to one side. */
export function clip(piece: Corner[], side: Side): Corner[] {
  const out: Corner[] = [];
  const keep = piece.map((p) => side.keep(p));
  for (let i = 0; i < piece.length; i++) {
    const j = (i + 1) % piece.length;
    if (keep[i]) out.push(piece[i]);
    if (keep[i] !== keep[j]) out.push(side.cut(piece[i], piece[j]));
  }
  return out;
}
