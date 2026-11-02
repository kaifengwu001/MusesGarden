import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { hash32, unit } from '../../core/hash';
import { smoothstep } from '../../core/math';
import { gnoise } from '../../planet/noise';
import type { Grid } from './grid';
import { CUTS, cutOffset, type Layout } from './labels';

// The terraces' build, step three (build/): the label map made into
// geometry, square by square of the grid (each as two triangles). Where a
// triangle's corners lie in different paddies, the boundary crosses its
// edges at points placed on the field that boundary is the zero of (the
// hills' height at the wall's level, the cuts' field, the lens's, the land's,
// the plots' lattice); each crossing point is worked out once from its
// edge's two samples and kept by that edge, so the triangles either side of
// it share it exactly: the floors tile without a gap. The boundaries' pieces
// are then joined into lines (across the faces' edges too) and each line
// built along its length: a riser down to the lower floor with a bund along
// the higher one's edge, a ridge where two paddies of one level meet, a
// skirt where the land ends. Per vertex, as the terraces' shaders read it
// (terrace.vert.glsl): position, normal, aPart, aPaddy (its paddy's crop
// constants), aFloor (its floor, fallow or a path's share, its share across
// its band, meters from its band's lower wall).

export const PART = { floor: 0, riser: 1, bundTop: 2, bundSide: 3, skirt: 4, ridge: 5 } as const;
/** A riser's batter (m across per m of height), a bund's width and height (m) and its flat top's share, a ridge's height (× a bund's), how far a skirt reaches down (m). */
export const WALL = { batter: 0.45, bund: 0.2, bundHeight: 0.19, crest: 0.45, ridge: 0.8, skirt: 3 } as const;
/** Paths along a share of the levels' walls, on the stretches a pattern (m) picks, their tops this wide (m). */
export const PATHS = { share: 0.16, width: 1.25, pattern: 46 } as const;
/** Chunks per face side (a mesh each, culled on its own). */
export const CHUNKS = 4;

const NONE = [0, 0, 0, 0];

class Chunk {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly part: number[] = [];
  readonly paddy: number[] = [];
  readonly floor: number[] = [];
  readonly index: number[] = [];
  vertex(p: Vector3, n: Vector3, part: number, paddy: readonly number[], floor: readonly number[]): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.part.push(part);
    this.paddy.push(paddy[0], paddy[1], paddy[2], paddy[3]);
    this.floor.push(floor[0], floor[1], floor[2], floor[3]);
    return this.pos.length / 3 - 1;
  }
  geometry(): BufferGeometry | null {
    if (this.index.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 1));
    g.setAttribute('aPaddy', new BufferAttribute(new Float32Array(this.paddy), 4));
    g.setAttribute('aFloor', new BufferAttribute(new Float32Array(this.floor), 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(this.index), 1) : new BufferAttribute(new Uint16Array(this.index), 1));
    g.computeBoundingSphere();
    return g;
  }
}

interface Point {
  /** Its direction (unit), its share across its band and meters from its lower wall (a floor's). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly across: number;
  readonly rows: number;
  /** The face and chunk it was first made in (a line built from it goes there). */
  readonly chunk: number;
}

interface Segment {
  /** From, to (points), the higher label on the left (or, two of a level, the larger), the other. */
  a: number;
  b: number;
  readonly left: number;
  readonly right: number;
}

/** The terraces' meshes from the label map: a geometry per chunk (6 faces × CHUNKS²), a step of work at a time. */
export function* buildMesh(grid: Grid, layout: Layout, seed: number): Generator<void, Array<BufferGeometry | null>, void> {
  const { n, R, dir, gid } = grid;
  const { label, paddies } = layout;
  const chunks = Array.from({ length: 6 * CHUNKS * CHUNKS }, () => new Chunk());
  const chunkOf = (f: number, i: number, j: number): number => f * CHUNKS * CHUNKS + Math.min(Math.floor((j * CHUNKS) / (n - 1)), CHUNKS - 1) * CHUNKS + Math.min(Math.floor((i * CHUNKS) / (n - 1)), CHUNKS - 1);
  const floorOf = (l: number): number => (l < 0 ? -1e9 : paddies[l].floor);
  const paddyData = (l: number): number[] => {
    const c = paddies[l].crop;
    return [c.variant, c.delay, c.hv, c.wv];
  };
  // the crossing points, each kept by its edge (the edge's two samples' ids)
  const points: Point[] = [];
  const byEdge = new Map<number, number>();
  const G = 1 << 26;
  const crossing = (f: number, ka: number, kb: number, chunk: number): number => {
    const ga = gid[f][ka];
    const gb = gid[f][kb];
    const key = ga < gb ? ga * G + gb : gb * G + ga;
    const known = byEdge.get(key);
    if (known !== undefined) return known;
    // (worked out from the lower id's side, so either face or triangle gets the same point)
    const [k0, k1] = ga < gb ? [ka, kb] : [kb, ka];
    const t = crossAt(grid, layout, f, k0, k1);
    const d = dir[f];
    const x = d[3 * k0] + (d[3 * k1] - d[3 * k0]) * t;
    const y = d[3 * k0 + 1] + (d[3 * k1 + 1] - d[3 * k0 + 1]) * t;
    const z = d[3 * k0 + 2] + (d[3 * k1 + 2] - d[3 * k0 + 2]) * t;
    const l = Math.hypot(x, y, z);
    const A = layout.across[f];
    const W = layout.rows[f];
    points.push({ x: x / l, y: y / l, z: z / l, across: A[k0] + (A[k1] - A[k0]) * t, rows: W[k0] + (W[k1] - W[k0]) * t, chunk });
    byEdge.set(key, points.length - 1);
    return points.length - 1;
  };
  const segments: Segment[] = [];
  const v = new Vector3();
  const up = new Vector3();
  // a floor's vertex: a sample's, or a point's, at its paddy's floor
  const sampleVertex = (c: Chunk, f: number, k: number, l: number): number => {
    const d = dir[f];
    up.set(d[3 * k], d[3 * k + 1], d[3 * k + 2]);
    const P = paddies[l];
    v.copy(up).multiplyScalar(R + P.floor);
    return c.vertex(v, up, PART.floor, paddyData(l), [P.floor, P.crop.fallow ? 1 : 0, layout.across[f][k], layout.rows[f][k]]);
  };
  const pointVertex = (c: Chunk, p: number, l: number): number => {
    const q = points[p];
    up.set(q.x, q.y, q.z);
    const P = paddies[l];
    v.copy(up).multiplyScalar(R + P.floor);
    return c.vertex(v, up, PART.floor, paddyData(l), [P.floor, P.crop.fallow ? 1 : 0, q.across, q.rows]);
  };
  // a junction where three paddies meet in one triangle: the mean of its three crossings
  const junction = (pa: number, pb: number, pc: number, chunk: number): number => {
    const a = points[pa];
    const b = points[pb];
    const c = points[pc];
    const x = a.x + b.x + c.x;
    const y = a.y + b.y + c.y;
    const z = a.z + b.z + c.z;
    const l = Math.hypot(x, y, z);
    points.push({ x: x / l, y: y / l, z: z / l, across: (a.across + b.across + c.across) / 3, rows: (a.rows + b.rows + c.rows) / 3, chunk });
    return points.length - 1;
  };
  /** A boundary piece from p to q between labels la (on one side) and lb, oriented with the higher (or larger) on its left, `ref` a direction on la's side. */
  const boundary = (p: number, q: number, la: number, lb: number, ref: Vector3): void => {
    const ha = floorOf(la);
    const hb = floorOf(lb);
    const aHigh = ha > hb + 1e-4 || (Math.abs(ha - hb) <= 1e-4 && la > lb);
    // left of p→q (looking down from outside): la's side if ref is to the left
    const P = points[p];
    const Q = points[q];
    const tx = Q.x - P.x;
    const ty = Q.y - P.y;
    const tz = Q.z - P.z;
    const rx = ref.x - P.x;
    const ry = ref.y - P.y;
    const rz = ref.z - P.z;
    // (up · (t × r) > 0: r on the left)
    const side = P.x * (ty * rz - tz * ry) + P.y * (tz * rx - tx * rz) + P.z * (tx * ry - ty * rx);
    const laLeft = side > 0;
    const high = aHigh ? la : lb;
    const low = aHigh ? lb : la;
    if (laLeft === aHigh) segments.push({ a: p, b: q, left: high, right: low });
    else segments.push({ a: q, b: p, left: high, right: low });
  };
  const refOf = (f: number, k: number, out: Vector3): Vector3 => out.set(dir[f][3 * k], dir[f][3 * k + 1], dir[f][3 * k + 2]);
  const ref = new Vector3();
  // 1. floors, triangle by triangle
  for (let f = 0; f < 6; f++) {
    const lab = label[f];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const k0 = j * n + i;
        const corners = [k0, k0 + 1, k0 + n + 1, k0 + n];
        const ch = chunkOf(f, i, j);
        const c = chunks[ch];
        for (const tri of [
          [0, 1, 2],
          [0, 2, 3],
        ]) {
          const ks = tri.map((t) => corners[t]);
          const ls = ks.map((k) => lab[k]);
          if (ls[0] === ls[1] && ls[1] === ls[2]) {
            if (ls[0] < 0) continue;
            const vs = ks.map((k) => sampleVertex(c, f, k, ls[0]));
            c.index.push(vs[0], vs[1], vs[2]);
            continue;
          }
          if (ls[0] !== ls[1] && ls[1] !== ls[2] && ls[0] !== ls[2]) {
            // three paddies: each corner's region to the crossings either side of it and the junction between
            const x01 = crossing(f, ks[0], ks[1], ch);
            const x12 = crossing(f, ks[1], ks[2], ch);
            const x20 = crossing(f, ks[2], ks[0], ch);
            const g = junction(x01, x12, x20, ch);
            const regions = [
              [0, x01, x20],
              [1, x12, x01],
              [2, x20, x12],
            ] as const;
            for (const [corner, pa, pb] of regions) {
              const l = ls[corner];
              if (l < 0) continue;
              const a = sampleVertex(c, f, ks[corner], l);
              const b = pointVertex(c, pa, l);
              const m = pointVertex(c, g, l);
              const e = pointVertex(c, pb, l);
              c.index.push(a, b, m, a, m, e);
            }
            boundary(x01, g, ls[0], ls[1], refOf(f, ks[0], ref));
            boundary(x12, g, ls[1], ls[2], refOf(f, ks[1], ref));
            boundary(x20, g, ls[2], ls[0], refOf(f, ks[2], ref));
            continue;
          }
          // two paddies: the odd corner's triangle, the other two's quad
          const odd = ls[0] === ls[1] ? 2 : ls[1] === ls[2] ? 0 : 1;
          const o = ks[odd];
          const a = ks[(odd + 1) % 3];
          const b = ks[(odd + 2) % 3];
          const lo = ls[odd];
          const lr = ls[(odd + 1) % 3];
          const xa = crossing(f, o, a, ch);
          const xb = crossing(f, o, b, ch);
          if (lo >= 0) {
            const vo = sampleVertex(c, f, o, lo);
            c.index.push(vo, pointVertex(c, xa, lo), pointVertex(c, xb, lo));
          }
          if (lr >= 0) {
            const va = sampleVertex(c, f, a, lr);
            const vb = sampleVertex(c, f, b, lr);
            const pa = pointVertex(c, xa, lr);
            const pb = pointVertex(c, xb, lr);
            c.index.push(pa, va, vb, pa, vb, pb);
          }
          boundary(xa, xb, lo, lr, refOf(f, o, ref));
        }
      }
      if (j % 16 === 15) yield;
    }
  }
  yield;
  // 2. the boundaries joined into lines (a line runs on while the same two paddies lie either side of it)
  const from = new Map<number, number[]>();
  segments.forEach((s, i) => {
    const list = from.get(s.a) ?? [];
    list.push(i);
    from.set(s.a, list);
  });
  const used = new Uint8Array(segments.length);
  const lines: Array<{ pts: number[]; closed: boolean; left: number; right: number }> = [];
  const nextOf = (s: Segment): number => {
    const list = from.get(s.b);
    if (!list) return -1;
    for (const i of list) if (!used[i] && segments[i].left === s.left && segments[i].right === s.right) return i;
    return -1;
  };
  const to = new Map<number, number[]>();
  segments.forEach((s, i) => {
    const list = to.get(s.b) ?? [];
    list.push(i);
    to.set(s.b, list);
  });
  const prevOf = (s: Segment): number => {
    const list = to.get(s.a);
    if (!list) return -1;
    for (const i of list) if (!used[i] && segments[i].left === s.left && segments[i].right === s.right) return i;
    return -1;
  };
  for (let i0 = 0; i0 < segments.length; i0++) {
    if (used[i0]) continue;
    used[i0] = 1;
    const s0 = segments[i0];
    const pts = [s0.a, s0.b];
    // forward, then back
    let s = s0;
    let closed = false;
    for (;;) {
      const nx = nextOf(s);
      if (nx < 0) break;
      used[nx] = 1;
      s = segments[nx];
      if (s.b === pts[0]) {
        closed = true;
        break;
      }
      pts.push(s.b);
    }
    if (!closed) {
      s = s0;
      for (;;) {
        const pv = prevOf(s);
        if (pv < 0) break;
        used[pv] = 1;
        s = segments[pv];
        pts.unshift(s.a);
      }
    }
    lines.push({ pts, closed, left: s0.left, right: s0.right });
    if (lines.length % 4000 === 0) yield;
  }
  yield;
  // 3. each line built along its length
  const U = new Vector3();
  const T = new Vector3();
  const N = new Vector3();
  const p = new Vector3();
  const nrm = new Vector3();
  const fP = R / PATHS.pattern;
  const pathShare = (level: number): boolean => unit(hash32((Math.imul(level, 2654435761) ^ (seed + 0x51a7)) >>> 0)) < PATHS.share;
  let built = 0;
  for (const line of lines) {
    const { pts, closed, left, right } = line;
    const m = pts.length;
    if (m < 2) continue;
    const c = chunks[points[pts[0]].chunk];
    const hi = floorOf(left);
    const lo = floorOf(right);
    const kind = right < 0 ? 'skirt' : hi - lo > 0.02 ? 'wall' : 'ridge';
    // (a path along the wall of a level the paths take)
    const H = paddies[left];
    const L = paddies[right];
    const level = kind === 'wall' && H.kind === 0 && L && L.kind === 0 && L.band !== H.band ? H.band : null;
    const paths = level !== null && pathShare(level);
    const ring: number[][] = [];
    for (let q = 0; q < m; q++) {
      const P = points[pts[q]];
      U.set(P.x, P.y, P.z);
      const a = points[pts[closed ? (q - 1 + m) % m : Math.max(q - 1, 0)]];
      const b = points[pts[closed ? (q + 1) % m : Math.min(q + 1, m - 1)]];
      T.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      // the left (the higher side): up × along
      N.crossVectors(U, T).normalize();
      const pw = paths ? smoothstep(-0.05, 0.12, gnoise(P.x * fP, P.y * fP, P.z * fP, (0x7a75 + level) >>> 0)) : 0;
      const bw = WALL.bund + (PATHS.width - WALL.bund) * pw;
      const cr = WALL.crest + (0.85 - WALL.crest) * pw;
      const top = hi + WALL.bundHeight;
      const fl = [hi, pw, 0, 0];
      const at = (h: number, out: number): Vector3 => p.copy(U).multiplyScalar(R + h).addScaledVector(N, out);
      if (kind === 'ridge') {
        // a low ridge over the boundary, sloping to the floors either side
        const crest = hi + WALL.ridge * WALL.bundHeight;
        const w = 0.5 * WALL.bund;
        nrm.copy(U);
        ring.push([
          c.vertex(at(lo - 0.02, -w), nrm, PART.ridge, NONE, [lo, 0, 0, 0]),
          c.vertex(at(crest, -0.3 * w), nrm, PART.ridge, NONE, [lo, 0, 0, 0]),
          c.vertex(at(crest, 0.3 * w), nrm, PART.ridge, NONE, [hi, 0, 0, 0]),
          c.vertex(at(hi - 0.02, w), nrm, PART.ridge, NONE, [hi, 0, 0, 0]),
        ]);
        continue;
      }
      // a riser (or a skirt) from below up to the bund along the higher floor's edge
      const below = kind === 'skirt' ? hi - WALL.skirt : lo - 0.05;
      const batter = kind === 'skirt' ? 0 : WALL.batter * (top - below);
      nrm.copy(N).negate().addScaledVector(U, WALL.batter).normalize();
      const part = kind === 'skirt' ? PART.skirt : PART.riser;
      const v0 = c.vertex(at(below, -batter), nrm, part, NONE, fl);
      const v1 = c.vertex(at(top, 0), nrm, part, NONE, fl);
      const v2 = c.vertex(at(top, 0), U, PART.bundTop, NONE, fl);
      const v3 = c.vertex(at(top, cr * bw), U, PART.bundTop, NONE, fl);
      nrm.copy(N).multiplyScalar(WALL.bundHeight).addScaledVector(U, (1 - cr) * bw).normalize();
      const v4 = c.vertex(at(top, cr * bw), nrm, PART.bundSide, NONE, fl);
      const v5 = c.vertex(at(hi - 0.02, bw), nrm, PART.bundSide, NONE, fl);
      ring.push([v0, v1, v2, v3, v4, v5]);
    }
    const count = closed ? m : m - 1;
    for (let q = 0; q < count; q++) {
      const r0 = ring[q];
      const r1 = ring[(q + 1) % m];
      for (let s = 0; s + 1 < r0.length; s += kind === 'ridge' ? 1 : 2) c.index.push(r0[s], r1[s], r1[s + 1], r0[s], r1[s + 1], r0[s + 1]);
    }
    if (++built % 2000 === 0) yield;
  }
  return chunks.map((c) => c.geometry());
}

/** Where the boundary between the paddies of samples k0 and k1 of face f crosses their edge (0 at k0 … 1). */
/** How many crossings fell on their boundary's zero, and how many on the edge's middle (no zero between: a label the fields disagree with), by kind (tests). */
export const CROSSINGS: Record<string, [number, number]> = {};
let kindNow = '';
function crossAt(grid: Grid, layout: Layout, f: number, k0: number, k1: number): number {
  const la = layout.label[f][k0];
  const lb = layout.label[f][k1];
  const zero = (a: number, b: number): number => {
    const s = (CROSSINGS[kindNow] ??= [0, 0]);
    if (a * b < 0) s[0]++;
    else s[1]++;
    return a * b < 0 ? Math.min(Math.max(a / (a - b), 0.02), 0.98) : 0.5;
  };
  const A0 = la >= 0 ? layout.paddies[la] : null;
  const B0 = lb >= 0 ? layout.paddies[lb] : null;
  kindNow = !A0 || !B0 ? 'land' : A0.kind !== B0.kind ? 'flats' : A0.kind === 1 ? 'plots' : A0.band !== B0.band ? `band${Math.abs(A0.band - B0.band)}` : A0.sub !== B0.sub ? 'lens' : 'cut';
  if (la < 0 || lb < 0) return zero(layout.land[f][k0], layout.land[f][k1]);
  const A = layout.paddies[la];
  const B = layout.paddies[lb];
  if (A.kind !== B.kind) return zero(layout.flats[f][k0], layout.flats[f][k1]);
  if (A.kind === 1) {
    // the plots: the first of the lattice's coordinates they differ in
    const Q = layout.lattice[f];
    for (let c = 0; c < 3; c++) {
      const qa = Q[3 * k0 + c];
      const qb = Q[3 * k1 + c];
      if (Math.floor(qa) === Math.floor(qb)) continue;
      const edge = Math.max(Math.floor(qa), Math.floor(qb));
      return zero(qa - edge, qb - edge);
    }
    return 0.5;
  }
  if (A.band !== B.band) {
    const level = layout.levels.at(layout.levels.above(Math.min(A.band, B.band)));
    return zero(grid.hs[f][k0] - level, grid.hs[f][k1] - level);
  }
  if (A.sub !== B.sub) return zero(layout.lens[f][k0], layout.lens[f][k1]);
  // two paddies of one band: where the cuts' field crosses the step between them
  const C = layout.cuts[f];
  const edge = (Math.max(A.cut, B.cut) - cutOffset(A.band, layout.seed)) * CUTS.step;
  return zero(C[k0] - edge, C[k1] - edge);
}
