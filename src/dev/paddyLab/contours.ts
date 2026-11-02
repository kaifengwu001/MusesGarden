import type { TerraceField } from './field';

// The paddy lab's outlines: the terrace field sampled on a grid over the
// canvas (each square split into four triangles round its middle, sampled
// too, so no square is ambiguous), and where each level crosses each
// triangle's edge found on the field itself (bracketed and refined, not
// interpolated), once per edge, shared by the triangles either side. The
// crossings, linked, are the outlines: closed rings, or chains from the
// canvas's edge to its edge, each with its level's higher ground on its left.
// A ring smaller than `minArea` is levelled into the band round it (the
// field capped inside it), so no little round paddy sits on a hilltop or in
// a hollow. The same crossings bound each band's top (its fill), so the tops
// and the outlines are one.

export interface Chain {
  /** Its level (an index into `levels`); its points (x, y, …: m). */
  readonly level: number;
  readonly xy: number[];
  /** A ring, or a chain from the canvas's edge to its edge. */
  readonly closed: boolean;
  /** A ring's signed area (m²: > 0 round higher ground, < 0 round a hollow). */
  readonly area: number;
}

export interface Contours {
  readonly levels: number[];
  readonly chains: Chain[];
  /** Rings levelled away (smaller than minArea). */
  readonly dropped: number;
  /** Per band (between levels k and k + 1): its top's triangles (x, y, …: m). */
  readonly fill: number[][];
  /** The canvas's edge split where the levels cross it: x0, y0, x1, y1, band, … */
  readonly edges: number[];
  /** The field's range over the canvas (m). */
  readonly lo: number;
  readonly hi: number;
}

/** Keys: an edge's two vertices (u < v); a crossing's edge and level. */
const V_BITS = 2097152;
const L_BITS = 1024;

/** The outlines of the field cut at its levels over a canvas `half` m each way of its middle, sampled every `cell` m. */
export function traceContours(field: TerraceField, half: number, cell: number, minArea: number): Contours {
  const n = Math.round((2 * half) / cell) + 1;
  const m = n - 1;
  const N = n * n + m * m;
  if (N >= V_BITS) throw new Error('the paddy lab: too fine a grid');
  const X = new Float64Array(N);
  const Y = new Float64Array(N);
  const T = new Float64Array(N);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = j * n + i;
      X[id] = -half + i * cell;
      Y[id] = -half + j * cell;
    }
  }
  for (let cj = 0; cj < m; cj++) {
    for (let ci = 0; ci < m; ci++) {
      const id = n * n + cj * m + ci;
      X[id] = -half + (ci + 0.5) * cell;
      Y[id] = -half + (cj + 0.5) * cell;
    }
  }
  for (let id = 0; id < N; id++) {
    T[id] = field.terrace(X[id], Y[id]);
    lo = Math.min(lo, T[id]);
    hi = Math.max(hi, T[id]);
  }
  const levels = field.levels(lo, hi);
  const L = levels.length;
  if (L >= L_BITS) throw new Error('the paddy lab: too many levels');
  // the field as cut: the true field, but capped inside the rings levelled away
  const W = T.slice();

  // a triangle's corners (counter-clockwise), the four of each square
  const tri = new Int32Array(12);
  const triangles = (ci: number, cj: number): Int32Array => {
    const a = cj * n + ci;
    const b = a + 1;
    const c = a + n + 1;
    const d = a + n;
    const e = n * n + cj * m + ci;
    tri.set([a, b, e, b, c, e, c, d, e, d, a, e]);
    return tri;
  };
  const edgeKey = (u: number, v: number): number => (u < v ? u * V_BITS + v : v * V_BITS + u);
  /** The first level above w. */
  const above = (w: number): number => {
    let a = 0;
    let b = L;
    while (a < b) {
      const c = (a + b) >> 1;
      if (levels[c] > w) b = c;
      else a = c + 1;
    }
    return a;
  };

  // each crossing once: its edge's point where the field meets the level, refined on the field itself
  const px: number[] = [];
  const py: number[] = [];
  const cache = new Map<number, number>();
  const crossing = (u: number, v: number, k: number): number => {
    const key = edgeKey(u, v) * L_BITS + k;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const a = Math.min(u, v);
    const b = Math.max(u, v);
    const t = refine(a, b, levels[k]);
    px.push(X[a] + (X[b] - X[a]) * t);
    py.push(Y[a] + (Y[b] - Y[a]) * t);
    cache.set(key, px.length - 1);
    return px.length - 1;
  };
  const refine = (a: number, b: number, z: number): number => {
    let fa = T[a] - z;
    let fb = T[b] - z;
    if (fa * fb > 0 || fa === fb) {
      // (an edge into a levelled ring: the cut field's own crossing)
      const wa = W[a] - z;
      const wb = W[b] - z;
      return Math.min(Math.max(wa / (wa - wb), 0), 1);
    }
    // (regula falsi, Illinois)
    let ta = 0;
    let tb = 1;
    let side = 0;
    for (let it = 0; it < 8; it++) {
      const t = (ta * fb - tb * fa) / (fb - fa);
      const f = field.terrace(X[a] + (X[b] - X[a]) * t, Y[a] + (Y[b] - Y[a]) * t) - z;
      if (f === 0) return t;
      if (f * fb > 0) {
        tb = t;
        fb = f;
        if (side === -1) fa /= 2;
        side = -1;
      } else {
        ta = t;
        fa = f;
        if (side === 1) fb /= 2;
        side = 1;
      }
    }
    return (ta * fb - tb * fa) / (fb - fa);
  };

  // the outlines: per level, each triangle's piece of it, from the edge it enters by to the edge it leaves by
  // (the higher ground on its left), linked
  const trace = (): Chain[] => {
    const next = levels.map(() => new Map<number, number>());
    for (let cj = 0; cj < m; cj++) {
      for (let ci = 0; ci < m; ci++) {
        const t = triangles(ci, cj);
        for (let q = 0; q < 12; q += 3) {
          const A = t[q];
          const B = t[q + 1];
          const C = t[q + 2];
          const wa = W[A];
          const wb = W[B];
          const wc = W[C];
          const top = Math.max(wa, wb, wc);
          for (let k = above(Math.min(wa, wb, wc)); k < L && levels[k] <= top; k++) {
            const z = levels[k];
            const ia = wa >= z;
            const ib = wb >= z;
            const ic = wc >= z;
            let s: number;
            let e: number;
            if (+ia + +ib + +ic === 1) {
              if (ia) [s, e] = [edgeKey(A, B), edgeKey(C, A)];
              else if (ib) [s, e] = [edgeKey(B, C), edgeKey(A, B)];
              else [s, e] = [edgeKey(C, A), edgeKey(B, C)];
            } else if (!ia) [s, e] = [edgeKey(C, A), edgeKey(A, B)];
            else if (!ib) [s, e] = [edgeKey(A, B), edgeKey(B, C)];
            else [s, e] = [edgeKey(B, C), edgeKey(C, A)];
            next[k].set(s, e);
          }
        }
      }
    }
    const chains: Chain[] = [];
    for (let k = 0; k < L; k++) {
      const nx = next[k];
      const heads = new Set(nx.keys());
      for (const e of nx.values()) heads.delete(e);
      const seen = new Set<number>();
      for (const s0 of [...heads, ...nx.keys()]) {
        if (seen.has(s0)) continue;
        const xy: number[] = [];
        let e = s0;
        let closed = false;
        for (;;) {
          seen.add(e);
          const u = Math.floor(e / V_BITS);
          const p = crossing(u, e - u * V_BITS, k);
          xy.push(px[p], py[p]);
          const f = nx.get(e);
          if (f === undefined) break;
          if (f === s0) {
            closed = true;
            break;
          }
          e = f;
        }
        let area = 0;
        if (closed) {
          for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) area += xy[j] * xy[i + 1] - xy[i] * xy[j + 1];
          area /= 2;
        }
        chains.push({ level: k, xy, closed, area });
      }
    }
    return chains;
  };

  // the small rings levelled into the band round them: the field capped inside each (the largest ring
  // round a point has the last word), so its crossings are gone from every edge into it
  const all = trace();
  const small = all.filter((c) => c.closed && Math.abs(c.area) < minArea).sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
  const delta = 1e-4;
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
    const z = levels[r.level];
    const level = (id: number): void => {
      if (!inside(r.xy, X[id], Y[id])) return;
      W[id] = r.area > 0 ? Math.min(T[id], z - delta) : Math.max(T[id], z + delta);
    };
    for (let j = Math.max(0, Math.ceil((y0 + half) / cell)); j <= Math.min(n - 1, Math.floor((y1 + half) / cell)); j++) {
      for (let i = Math.max(0, Math.ceil((x0 + half) / cell)); i <= Math.min(n - 1, Math.floor((x1 + half) / cell)); i++) level(j * n + i);
    }
    for (let cj = Math.max(0, Math.ceil((y0 + half) / cell - 0.5)); cj <= Math.min(m - 1, Math.floor((y1 + half) / cell - 0.5)); cj++) {
      for (let ci = Math.max(0, Math.ceil((x0 + half) / cell - 0.5)); ci <= Math.min(m - 1, Math.floor((x1 + half) / cell - 0.5)); ci++) level(n * n + cj * m + ci);
    }
  }
  const chains = small.length > 0 ? trace().filter((c) => !c.closed || Math.abs(c.area) >= minArea) : all;

  // each band's top: per triangle, the piece of it between the band's two levels, its corners the
  // triangle's own and the crossings on its edges (in order round it), fanned
  const band = new Int32Array(N);
  for (let id = 0; id < N; id++) band[id] = above(W[id]) - 1;
  const fill: number[][] = levels.map(() => []);
  const poly: number[] = [];
  for (let cj = 0; cj < m; cj++) {
    for (let ci = 0; ci < m; ci++) {
      const t = triangles(ci, cj);
      const a = t[0];
      const b = t[1];
      const c = t[4];
      const d = t[7];
      const e = t[2];
      const k = band[a];
      if (band[b] === k && band[c] === k && band[d] === k && band[e] === k) {
        fill[k].push(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[a], Y[a], X[c], Y[c], X[d], Y[d]);
        continue;
      }
      for (let q = 0; q < 12; q += 3) {
        const corner = [t[q], t[q + 1], t[q + 2]];
        const k0 = Math.min(band[corner[0]], band[corner[1]], band[corner[2]]);
        const k1 = Math.max(band[corner[0]], band[corner[1]], band[corner[2]]);
        for (let bk = k0; bk <= k1; bk++) {
          poly.length = 0;
          for (let s = 0; s < 3; s++) {
            const U = corner[s];
            const V = corner[(s + 1) % 3];
            if (band[U] === bk) poly.push(X[U], Y[U]);
            const lower = (W[U] >= levels[bk]) !== (W[V] >= levels[bk]);
            const upper = bk + 1 < L && (W[U] >= levels[bk + 1]) !== (W[V] >= levels[bk + 1]);
            const order = W[U] <= W[V] ? [lower ? bk : -1, upper ? bk + 1 : -1] : [upper ? bk + 1 : -1, lower ? bk : -1];
            for (const lk of order) {
              if (lk < 0) continue;
              const p = crossing(U, V, lk);
              poly.push(px[p], py[p]);
            }
          }
          for (let i = 2; i + 3 < poly.length; i += 2) fill[bk].push(poly[0], poly[1], poly[i], poly[i + 1], poly[i + 2], poly[i + 3]);
        }
      }
    }
  }

  // the canvas's edge, split where the levels cross it
  const edges: number[] = [];
  const edge = (U: number, V: number): void => {
    let x = X[U];
    let y = Y[U];
    let k = band[U];
    const step = W[U] <= W[V] ? 1 : -1;
    while (k !== band[V]) {
      const lk = step > 0 ? k + 1 : k;
      const p = crossing(U, V, lk);
      edges.push(x, y, px[p], py[p], k);
      x = px[p];
      y = py[p];
      k += step;
    }
    edges.push(x, y, X[V], Y[V], k);
  };
  for (let i = 0; i < m; i++) {
    edge(i, i + 1);
    edge((n - 1) * n + i + 1, (n - 1) * n + i);
    edge((i + 1) * n, i * n);
    edge(i * n + n - 1, (i + 1) * n + n - 1);
  }
  return { levels, chains, dropped: small.length, fill, edges, lo, hi };
}

/** Whether (x, y) lies inside a ring (x, y, …). */
function inside(xy: number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
    const yi = xy[i + 1];
    const yj = xy[j + 1];
    if (yi > y !== yj > y && x < ((xy[j] - xy[i]) * (y - yi)) / (yj - yi) + xy[i]) c = !c;
  }
  return c;
}
