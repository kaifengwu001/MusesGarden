// The terraces' build (build/): the paddy lab's grid (src/dev/paddyLab/
// grid.ts) laid over the whole planet, only to find the outlines by: each
// cube face carries n × n samples spaced evenly in angle (so a square is
// about as wide anywhere on the face), the faces' shared edges and corners
// one sample each (one direction, one id), and each square's middle (sampled
// too, so no square is ambiguous); every square is four triangles round its
// middle, counter-clockwise seen from outside. Where a field meets a level on
// a triangle's edge is worked out on the field itself (bracketed and refined
// on the sphere, never interpolated between the samples), once per field,
// level and edge, and shared by the triangles either side and by the outline
// through it: the outlines and the surfaces they bound are one, with no seam,
// across the faces' edges as anywhere.

/** A cube face's point at (s, t) ∈ [−1, 1]², unit, into out (x, y, z). */
export function faceDirection(face: number, s: number, t: number, out: number[]): number[] {
  let x: number;
  let y: number;
  let z: number;
  if (face === 0) [x, y, z] = [1, -t, -s];
  else if (face === 1) [x, y, z] = [-1, -t, s];
  else if (face === 2) [x, y, z] = [s, 1, t];
  else if (face === 3) [x, y, z] = [s, -1, -t];
  else if (face === 4) [x, y, z] = [s, -t, 1];
  else [x, y, z] = [-s, -t, -1];
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

const QUARTER = Math.PI / 4;

/** Where a direction lies on the cube: its face and its place there, evenly in angle (a, b ∈ [−1, 1]). */
export interface FacePlace {
  face: number;
  a: number;
  b: number;
}

export function facePlace(x: number, y: number, z: number, out: FacePlace): FacePlace {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let s: number;
  let t: number;
  if (ax >= ay && ax >= az) {
    out.face = x > 0 ? 0 : 1;
    s = -z / x;
    t = x > 0 ? -y / x : y / x;
  } else if (ay >= az) {
    out.face = y > 0 ? 2 : 3;
    s = y > 0 ? x / y : -x / y;
    t = z / y;
  } else {
    out.face = z > 0 ? 4 : 5;
    s = x / z;
    t = z > 0 ? -y / z : y / z;
  }
  out.a = Math.atan(s) / QUARTER;
  out.b = Math.atan(t) / QUARTER;
  return out;
}

/** A field over the planet at a unit direction, less its level (≥ 0 its upper side). */
export type Field = (x: number, y: number, z: number) => number;

/** A corner of a piece of a triangle: a vertex (v ≥ 0), or a point on the grid's edge a–b (a < b), or inside (a = −1); the line it lies on (a slot, or −1); its point's id. */
export interface Corner {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly v: number;
  readonly a: number;
  readonly b: number;
  readonly line: number;
  readonly id: number;
}

/** A chain of points (ids into the grid's points): an outline between two regions of an index. */
export interface Chain {
  /** Its level (the index it bounds from below) and its points. */
  readonly level: number;
  readonly pts: number[];
  readonly closed: boolean;
  /** A ring's signed area (m²: > 0 round the higher index), on the plane at its middle. */
  readonly area: number;
}

const KEY = 8388608; // 2^23

export class SphereGrid {
  /** Samples per face side, squares per face side, the planet's radius (m). */
  readonly n: number;
  readonly m: number;
  readonly R: number;
  /** The samples (one per direction: a shared edge's are one), and all vertices: the samples, then the middles. */
  readonly S: number;
  readonly V: number;
  /** Every vertex's direction (x, y, z). */
  readonly dir: Float64Array;
  /** Per face, per sample (i, j): its id. */
  readonly ids: Int32Array;
  /** Per face: whether its (i, j) frame is mirrored seen from outside (its triangles turned round). */
  readonly flip: boolean[] = [];
  /** The spacing of the samples along a face's middle (m). */
  readonly spacing: number;
  /** The points found on edges and inside triangles (ids V…): x, y, z. */
  px: Float64Array = new Float64Array(3 << 16);
  private pcount = 0;
  private readonly memo = new Map<number, Map<number, number>>();
  private readonly tri = new Int32Array(12);
  private readonly place: FacePlace = { face: 0, a: 0, b: 0 };

  constructor(R: number, cell: number) {
    // (a multiple of four squares a side)
    const m = Math.max(4, 4 * Math.round((R * Math.PI) / 2 / cell / 4));
    const n = m + 1;
    this.n = n;
    this.m = m;
    this.R = R;
    this.ids = new Int32Array(6 * n * n);
    const shared = new Map<string, number>();
    const d: number[] = [0, 0, 0];
    const dirs: number[] = [];
    // (evenly in angle: tan of the angle, exactly ±1 at the face's edges, where tan(π/4) falls short of 1; (2i − m)/m is
    // exactly negated for the mirrored index and tan is odd, so the faces sharing an edge work out the very same floats there)
    const at = (i: number): number => (i === 0 ? -1 : i === m ? 1 : Math.tan((QUARTER * (2 * i - m)) / m));
    let S = 0;
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          faceDirection(f, at(i), at(j), d);
          const k = (f * n + j) * n + i;
          if (i > 0 && j > 0 && i < m && j < m) {
            this.ids[k] = S++;
            dirs.push(d[0], d[1], d[2]);
            continue;
          }
          const key = `${d[0]},${d[1]},${d[2]}`;
          const known = shared.get(key);
          if (known !== undefined) {
            this.ids[k] = known;
            continue;
          }
          shared.set(key, S);
          this.ids[k] = S++;
          dirs.push(d[0], d[1], d[2]);
        }
      }
    }
    if (6 * n * n - 12 * n + 8 !== S) throw new Error(`the terraces' grid: the faces' edges did not meet (${S} samples)`);
    this.S = S;
    this.V = S + 6 * m * m;
    if (this.V >= KEY) throw new Error("the terraces' grid: too fine");
    this.dir = new Float64Array(3 * this.V);
    this.dir.set(dirs);
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj < m; cj++) {
        for (let ci = 0; ci < m; ci++) {
          faceDirection(f, Math.tan(QUARTER * ((2 * ci + 1 - m) / m)), Math.tan(QUARTER * ((2 * cj + 1 - m) / m)), d);
          this.dir.set(d, 3 * this.middle(f, ci, cj));
        }
      }
      // mirrored: (i + 1) × (j + 1) turns the wrong way round the face's middle
      const c = this.sample(f, m >> 1, m >> 1);
      const ci = this.sample(f, (m >> 1) + 1, m >> 1);
      const cj = this.sample(f, m >> 1, (m >> 1) + 1);
      const D = this.dir;
      const ux = D[3 * ci] - D[3 * c];
      const uy = D[3 * ci + 1] - D[3 * c + 1];
      const uz = D[3 * ci + 2] - D[3 * c + 2];
      const vx = D[3 * cj] - D[3 * c];
      const vy = D[3 * cj + 1] - D[3 * c + 1];
      const vz = D[3 * cj + 2] - D[3 * c + 2];
      this.flip.push((uy * vz - uz * vy) * D[3 * c] + (uz * vx - ux * vz) * D[3 * c + 1] + (ux * vy - uy * vx) * D[3 * c + 2] < 0);
    }
    this.spacing = (R * Math.PI) / 2 / m;
  }

  sample(f: number, i: number, j: number): number {
    return this.ids[(f * this.n + j) * this.n + i];
  }

  middle(f: number, ci: number, cj: number): number {
    return this.S + (f * this.m + cj) * this.m + ci;
  }

  /** Square (ci, cj) of face f's four triangles, counter-clockwise seen from outside: [a, b, e,  b, c, e,  c, d, e,  d, a, e]. */
  triangles(f: number, ci: number, cj: number): Int32Array {
    const a = this.sample(f, ci, cj);
    const b = this.sample(f, ci + 1, cj);
    const c = this.sample(f, ci + 1, cj + 1);
    const d = this.sample(f, ci, cj + 1);
    const e = this.middle(f, ci, cj);
    if (this.flip[f]) this.tri.set([a, d, e, d, c, e, c, b, e, b, a, e]);
    else this.tri.set([a, b, e, b, c, e, c, d, e, d, a, e]);
    return this.tri;
  }

  key(u: number, v: number): number {
    return u < v ? u * KEY + v : v * KEY + u;
  }

  /** The edge a key names (a < b). */
  ends(key: number): [number, number] {
    const a = Math.floor(key / KEY);
    return [a, key - a * KEY];
  }

  /** A point's direction (a vertex's or a found point's) into out. */
  point(id: number, out: number[]): number[] {
    if (id < this.V) {
      out[0] = this.dir[3 * id];
      out[1] = this.dir[3 * id + 1];
      out[2] = this.dir[3 * id + 2];
    } else {
      const k = 3 * (id - this.V);
      out[0] = this.px[k];
      out[1] = this.px[k + 1];
      out[2] = this.px[k + 2];
    }
    return out;
  }

  get points(): number {
    return this.V + this.pcount;
  }

  /** A new point (a unit direction): its id. */
  addPoint(x: number, y: number, z: number): number {
    if (3 * (this.pcount + 1) > this.px.length) {
      const grown = new Float64Array(this.px.length * 2);
      grown.set(this.px);
      this.px = grown;
    }
    const k = 3 * this.pcount;
    this.px[k] = x;
    this.px[k + 1] = y;
    this.px[k + 2] = z;
    return this.V + this.pcount++;
  }

  /** Where field f meets zero on the edge u–v (fv: its value at a vertex, if known): one point per slot (a field and level) and edge. */
  crossing(slot: number, u: number, v: number, f: Field, fv?: (v: number) => number): number {
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
    const D = this.dir;
    const fa = fv ? fv(a) : f(D[3 * a], D[3 * a + 1], D[3 * a + 2]);
    const fb = fv ? fv(b) : f(D[3 * b], D[3 * b + 1], D[3 * b + 2]);
    const p = root(f, D[3 * a], D[3 * a + 1], D[3 * a + 2], D[3 * b], D[3 * b + 1], D[3 * b + 2], fa, fb, this.found);
    const id = this.addPoint(p[0], p[1], p[2]);
    memo.set(key, id);
    return id;
  }

  private readonly found: number[] = [0, 0, 0];

  /** Forget the crossings of a slot (a field that changed). */
  forget(slot: number): void {
    this.memo.delete(slot);
  }

  /**
   * The outlines between the regions of an index over the vertices: for each level k, the line between the
   * vertices where idx ≥ k and those where idx < k (the first on its left), its points from cross(u, v, k). Over
   * the whole planet, or over the squares given ((face · m + cj) · m + ci) only.
   */
  trace(idx: Int32Array, cross: (u: number, v: number, k: number) => number, squares?: Iterable<number>): Chain[] {
    const next = new Map<number, Map<number, number>>();
    const { m } = this;
    const square = (f: number, ci: number, cj: number): void => {
      const t = this.triangles(f, ci, cj);
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
            if (a) [s, e] = [this.key(A, B), this.key(C, A)];
            else if (b) [s, e] = [this.key(B, C), this.key(A, B)];
            else [s, e] = [this.key(C, A), this.key(B, C)];
          } else if (!a) [s, e] = [this.key(C, A), this.key(A, B)];
          else if (!b) [s, e] = [this.key(A, B), this.key(B, C)];
          else [s, e] = [this.key(B, C), this.key(C, A)];
          let lv = next.get(k);
          if (!lv) {
            lv = new Map();
            next.set(k, lv);
          }
          lv.set(s, e);
        }
      }
    };
    if (squares) {
      for (const si of squares) {
        const f = Math.floor(si / (m * m));
        const cj = Math.floor((si - f * m * m) / m);
        square(f, si - f * m * m - cj * m, cj);
      }
    } else {
      for (let f = 0; f < 6; f++) for (let cj = 0; cj < m; cj++) for (let ci = 0; ci < m; ci++) square(f, ci, cj);
    }
    const chains: Chain[] = [];
    for (const k of [...next.keys()].sort((a, b) => a - b)) {
      const lv = next.get(k) as Map<number, number>;
      const heads = new Set(lv.keys());
      for (const e of lv.values()) heads.delete(e);
      const seen = new Set<number>();
      for (const s0 of [...heads, ...lv.keys()]) {
        if (seen.has(s0)) continue;
        const pts: number[] = [];
        let e = s0;
        let closed = false;
        for (;;) {
          seen.add(e);
          const [u, v] = this.ends(e);
          pts.push(cross(u, v, k));
          const f = lv.get(e);
          if (f === undefined) break;
          if (f === s0) {
            closed = true;
            break;
          }
          e = f;
        }
        chains.push({ level: k, pts, closed, area: closed ? this.area(pts) : 0 });
      }
    }
    return chains;
  }

  /** A ring's signed area (m²), on the plane at its middle. */
  area(pts: readonly number[]): number {
    const c = this.centre(pts);
    const p: number[] = [0, 0, 0];
    const q: number[] = [0, 0, 0];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      this.point(pts[i], p);
      this.point(pts[(i + 1) % pts.length], q);
      const ax = p[0] - c[0];
      const ay = p[1] - c[1];
      const az = p[2] - c[2];
      const bx = q[0] - c[0];
      const by = q[1] - c[1];
      const bz = q[2] - c[2];
      s += (ay * bz - az * by) * c[0] + (az * bx - ax * bz) * c[1] + (ax * by - ay * bx) * c[2];
    }
    return 0.5 * s * this.R * this.R;
  }

  /** The middle of some points (unit). */
  centre(pts: readonly number[]): number[] {
    const p: number[] = [0, 0, 0];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const id of pts) {
      this.point(id, p);
      x += p[0];
      y += p[1];
      z += p[2];
    }
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
  }

  /** The square a direction lies in: its face and place (ci, cj). */
  square(x: number, y: number, z: number, out: { face: number; ci: number; cj: number }): { face: number; ci: number; cj: number } {
    const p = facePlace(x, y, z, this.place);
    const c = (t: number): number => Math.min(Math.max(Math.floor(((t + 1) / 2) * this.m), 0), this.m - 1);
    out.face = p.face;
    out.ci = c(p.a);
    out.cj = c(p.b);
    return out;
  }

  private readonly sq = { face: 0, ci: 0, cj: 0 };
  private readonly frame = new Float64Array(6);

  /** The triangle a direction lies in: 4·its square + its place there (q). */
  locate(x: number, y: number, z: number): number {
    const s = this.square(x, y, z, this.sq);
    const t = this.triangles(s.face, s.ci, s.cj);
    const e = t[2];
    // (on the plane at the square's middle: the triangle the point is most inside)
    const D = this.dir;
    const F = tangentFrame(D[3 * e], D[3 * e + 1], D[3 * e + 2], this.frame);
    const proj = (id: number): [number, number] => {
      const k = 3 * id;
      return [D[k] * F[0] + D[k + 1] * F[1] + D[k + 2] * F[2], D[k] * F[3] + D[k + 1] * F[4] + D[k + 2] * F[5]];
    };
    const px = x * F[0] + y * F[1] + z * F[2];
    const py = x * F[3] + y * F[4] + z * F[5];
    let best = -Infinity;
    let found = 0;
    for (let q = 0; q < 4; q++) {
      const [ax, ay] = proj(t[3 * q]);
      const [bx, by] = proj(t[3 * q + 1]);
      const [cx, cy] = proj(t[3 * q + 2]);
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
      const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
      const worst = Math.min(l0, l1, 1 - l0 - l1);
      if (worst > best) {
        best = worst;
        found = q;
      }
    }
    return ((s.face * this.m + s.cj) * this.m + s.ci) * 4 + found;
  }
}

/** A tangent frame at a unit direction: two unit axes (x, y, z each) into out. */
export function tangentFrame(x: number, y: number, z: number, out: Float64Array): Float64Array {
  let ax: number;
  let ay: number;
  let az: number;
  if (Math.abs(y) < 0.95) {
    ax = -z;
    ay = 0;
    az = x;
  } else {
    ax = 0;
    ay = z;
    az = -y;
  }
  const l = Math.sqrt(ax * ax + ay * ay + az * az);
  ax /= l;
  ay /= l;
  az /= l;
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
  out[3] = y * az - z * ay;
  out[4] = z * ax - x * az;
  out[5] = x * ay - y * ax;
  return out;
}

/**
 * Where f crosses zero between directions a and b (fa, fb its values there), on the sphere: regula falsi
 * (Illinois) along the arc between them, into out (unit); the middle if f does not change sign there.
 */
export function root(f: Field, ax: number, ay: number, az: number, bx: number, by: number, bz: number, fa: number, fb: number, out: number[]): number[] {
  const at = (t: number): void => {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const l = Math.sqrt(x * x + y * y + z * z);
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
  };
  if (fa >= 0 === fb >= 0) {
    at(0.5);
    return out;
  }
  let ta = 0;
  let tb = 1;
  let side = 0;
  for (let it = 0; it < 12; it++) {
    const t = (ta * fb - tb * fa) / (fb - fa);
    at(t);
    const v = f(out[0], out[1], out[2]);
    // (to within a hundredth of a millimetre of height, or a thousandth of the edge: half a millimetre)
    if (Math.abs(v) < 1e-5 || tb - ta < 1e-3) return out;
    if (v >= 0 === fb >= 0) {
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
  at((ta * fb - tb * fa) / (fb - fa));
  return out;
}

/** A side of a field's level, to cut a piece of a triangle by. */
export class Side {
  constructor(
    private readonly grid: SphereGrid,
    /** Its slot (a field and level): the crossings it shares. */
    readonly slot: number,
    readonly f: Field,
    /** Which side a vertex is on (the index the outlines were traced from, so the two agree). */
    private readonly sample: (v: number) => boolean,
    /** Keep the side at or above the level, or below it. */
    private readonly above: boolean,
    /** The field's value at a vertex, if kept. */
    private readonly fv?: (v: number) => number,
  ) {}

  /** 1 kept, 0 not, 2 on the line itself (kept, and no crossing next to it). */
  state(p: Corner): number {
    if (p.line === this.slot) return 2;
    if (p.v >= 0) return this.sample(p.v) === this.above ? 1 : 0;
    if (p.a >= 0) {
      // (on a grid edge: on the side of the level's own crossing there that its end on that side is, the side the
      // outlines were traced to; with no crossing there, its ends' side)
      const sa = this.sample(p.a);
      if (sa === this.sample(p.b)) return sa === this.above ? 1 : 0;
      const g = this.grid;
      const c = g.point(g.crossing(this.slot, p.a, p.b, this.f, this.fv), this.at);
      const D = g.dir;
      const k = 3 * p.a;
      const toCorner = (p.x - D[k]) ** 2 + (p.y - D[k + 1]) ** 2 + (p.z - D[k + 2]) ** 2;
      const toCrossing = (c[0] - D[k]) ** 2 + (c[1] - D[k + 1]) ** 2 + (c[2] - D[k + 2]) ** 2;
      return (toCorner < toCrossing ? sa : !sa) === this.above ? 1 : 0;
    }
    return this.f(p.x, p.y, p.z) >= 0 === this.above ? 1 : 0;
  }

  private readonly at: number[] = [0, 0, 0];

  /** The corner where the piece's edge p–q crosses the level: shared with the neighbour along an edge of the grid. */
  cut(p: Corner, q: Corner): Corner {
    const g = this.grid;
    const e = along(p, q);
    if (e) {
      const id = g.crossing(this.slot, e[0], e[1], this.f, this.fv);
      const d = g.point(id, [0, 0, 0]);
      return { x: d[0], y: d[1], z: d[2], v: -1, a: e[0], b: e[1], line: this.slot, id };
    }
    // (inside the triangle: found on the field along p–q)
    const d = root(this.f, p.x, p.y, p.z, q.x, q.y, q.z, this.f(p.x, p.y, p.z), this.f(q.x, q.y, q.z), [0, 0, 0]);
    return { x: d[0], y: d[1], z: d[2], v: -1, a: -1, b: -1, line: this.slot, id: g.addPoint(d[0], d[1], d[2]) };
  }
}

/** A vertex as a corner. */
export function vertexCorner(g: SphereGrid, v: number): Corner {
  const D = g.dir;
  return { x: D[3 * v], y: D[3 * v + 1], z: D[3 * v + 2], v, a: -1, b: -1, line: -1, id: v };
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
  const n = piece.length;
  const s = piece.map((p) => side.state(p));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (s[i] !== 0) out.push(piece[i]);
    if ((s[i] === 1 && s[j] === 0) || (s[i] === 0 && s[j] === 1)) out.push(side.cut(piece[i], piece[j]));
  }
  return out.length >= 3 ? out : [];
}
