import { EASE, INSIDE, STEP, STEPS_A_CHUNK, type StrokeSegments } from './mistStrokes';

// The terraces' mist strokes (mistStrokes.ts) as a mesh to draw, each stroke a ribbon at its cloud's height (Kai: the
// clouds on a full spherical surface, each offset up or down). A ribbon runs along its stroke's spine as traced, a
// point a meter, three across: its spine and its two sides, each out to the stroke's breadth on that side and a rim
// past it. Where it bends tighter than that, its inner side is drawn in short of the bend's centre (it would fold
// over itself), easing off away from the bend as the stroke's own breadth does there (mistStrokes.ts INSIDE, EASE:
// its inner side drawn in a little less, so the ribbon holds all of it). Each vertex carries how far inside the stroke's edge it lies (as the shapes' map has it: the stroke's
// shape is its spine moved over by half its scallops, mistStrokes.ts), and the stroke's half-breadth there. It is cut
// into its chunks (each stroke's points STEPS_A_CHUNK at a time), each chunk's vertices its own, so the mist's paint
// can tell them apart (mist.frag.glsl paints each place of the clouds at a height once, by the chunk that owns it),
// and carries its height's key (clouds at the same height are one, as the shapes' map merges them). Its triangles are
// grouped by cloud and the clouds put in order of height, both ways (so the mist can draw those above the camera
// highest first and those below it lowest first, the far ones first either way). Out with it come the strokes'
// segments' owners, as the ribbons have them, for the bake of who owns which place.

/** The ribbons' mesh. */
export interface RibbonMesh {
  /** Per vertex: its direction (the strokes' space, unit). */
  readonly position: Float32Array;
  /** Per vertex: how far inside its stroke's edge (m, < 0 outside), its stroke's half-breadth there (m), its cloud's offset from the layer's sphere (m). */
  readonly ribbon: Float32Array;
  /** Per vertex: its chunk, its height's key. */
  readonly owner: Float32Array;
  /** Per segment of the strokes (StrokeSegments): its chunk, its height's key. */
  readonly segments: Float32Array;
  /** The triangles, the clouds lowest first, and highest first. */
  readonly ascending: Uint32Array;
  readonly descending: Uint32Array;
  /** The clouds' offsets (m), lowest first, and how many indices each has. */
  readonly heights: Float32Array;
  readonly counts: Uint32Array;
}

type V3 = [number, number, number];

/** How many of a stroke's points a ribbon's point is (a meter apart), and how much of a bend's radius its inner side reaches into at most (a little more than the stroke's own). */
const EVERY = 2;
const INNER = INSIDE + 0.05;
/** The heights the keys tell apart (m, either way), and how many keys (two bytes, 0 for none). */
const KEYED = 12;
const KEYS = 65535;

/** A cloud's height's key (1 … KEYS): the same for clouds at the same height. */
export function heightKey(offset: number): number {
  return 1 + Math.round(((Math.min(Math.max(offset, -KEYED), KEYED) + KEYED) / (2 * KEYED)) * (KEYS - 1));
}

/** The ribbons' mesh for a layer's strokes, the layer's radius (m), the rim past their edges (m). */
export function ribbonMesh(made: StrokeSegments, radius: number, rim: number): RibbonMesh {
  const position: number[] = [];
  const ribbon: number[] = [];
  const owner: number[] = [];
  const byCloud = new Map<number, number[]>();
  const offsets = new Map<number, number>();
  for (const r of made.ribbons) {
    const n = r.left.length;
    if (n < 2) continue;
    // (its points a meter apart, its last among them)
    const keep: number[] = [];
    for (let i = 0; i < n; i += EVERY) keep.push(i);
    if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
    const m = keep.length;
    const P: V3[] = keep.map((i) => [r.pts[3 * i], r.pts[3 * i + 1], r.pts[3 * i + 2]]);
    const L = keep.map((i) => r.left[i]);
    const Rt = keep.map((i) => r.right[i]);
    // its way and its left at each point, and how sharply it turns there (1/m, > 0 toward its left)
    const T: V3[] = [];
    const N: V3[] = [];
    const bend: number[] = [];
    for (let k = 0; k < m; k++) {
      const a = P[Math.max(k - 1, 0)];
      const b = P[Math.min(k + 1, m - 1)];
      const p = P[k];
      const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const along = d[0] * p[0] + d[1] * p[1] + d[2] * p[2];
      T.push(unit([d[0] - along * p[0], d[1] - along * p[1], d[2] - along * p[2]]));
      N.push(unit(cross(p, T[k])));
      if (k === 0 || k === m - 1) {
        bend.push(0);
        continue;
      }
      const u: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const v: V3 = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
      const lu = Math.hypot(u[0], u[1], u[2]);
      const lv = Math.hypot(v[0], v[1], v[2]);
      const c = cross(u, v);
      const sin = (c[0] * p[0] + c[1] * p[1] + c[2] * p[2]) / Math.max(lu * lv, 1e-12);
      const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.max(lu * lv, 1e-12);
      bend.push(Math.atan2(sin, cos) / Math.max(((lu + lv) / 2) * radius, 1e-6));
    }
    // how far out each side reaches: the breadth there and the rim, but short of the centre of any bend toward it,
    // easing off away from it
    const left = P.map((_, k) => L[k] + rim);
    const right = P.map((_, k) => Rt[k] + rim);
    const most = Math.max(...left, ...right);
    const apart = EVERY * STEP;
    for (let j = 0; j < m; j++) {
      if (bend[j] === 0) continue;
      const side = bend[j] > 0 ? left : right;
      const inner = INNER / Math.abs(bend[j]);
      if (inner >= most) continue;
      const near = Math.ceil((most - inner) / EASE / apart);
      for (let k = Math.max(j - near, 0); k <= Math.min(j + near, m - 1); k++) side[k] = Math.min(side[k], inner + EASE * apart * Math.abs(k - j));
    }
    const past = (k: number, sign: number): V3 => {
      const s = (sign * (Math.max(L[k], Rt[k]) + rim)) / radius;
      return unit([P[k][0] + T[k][0] * s, P[k][1] + T[k][1] * s, P[k][2] + T[k][2] * s]);
    };
    // (and none of its quads folded over, where its bends tighten faster than its rows can follow, as at a curl's
    // end: each side drawn in there until it is not; its rows a point of its spine, or past an end)
    const spine = (k: number, end: number): V3 => (end === 0 ? P[k] : past(k, end));
    const out = (p: V3, k: number, sign: number): V3 => {
      const s = (sign * (sign > 0 ? left[k] : right[k])) / radius;
      return unit([p[0] + N[k][0] * s, p[1] + N[k][1] * s, p[2] + N[k][2] * s]);
    };
    const quads: [number, number, number, number][] = [[0, -1, 0, 0]];
    for (let k = 0; k + 1 < m; k++) quads.push([k, 0, k + 1, 0]);
    quads.push([m - 1, 0, m - 1, 1]);
    for (let pass = 0; pass < 12; pass++) {
      let folded = false;
      for (const [ka, ea, kb, eb] of quads) {
        const sa = spine(ka, ea);
        const sb = spine(kb, eb);
        for (const sign of [1, -1]) {
          const xa = out(sa, ka, sign);
          const xb = out(sb, kb, sign);
          const bad = sign > 0 ? turned(sa, xa, xb) >= 0 || turned(sa, xb, sb) >= 0 : turned(sa, sb, xb) >= 0 || turned(sa, xb, xa) >= 0;
          if (!bad) continue;
          const side = sign > 0 ? left : right;
          side[ka] *= 0.75;
          side[kb] *= 0.75;
          folded = true;
        }
      }
      if (!folded) break;
    }
    // its rows of vertices, a chunk at a time (a chunk's last row again as the next one's first), and a row past each
    // end, out by the rim (all of it outside the stroke's edge, so its tip fades out)
    const tris = byCloud.get(r.cloud) ?? [];
    byCloud.set(r.cloud, tris);
    offsets.set(r.cloud, r.offset);
    const key = heightKey(r.offset);
    const row = (p: V3, k: number, cap: boolean, chunk: number): number => {
      const at = position.length / 3;
      const side = (sign: number, far: number): void => {
        const s = (sign * far) / radius;
        const q = unit([p[0] + N[k][0] * s, p[1] + N[k][1] * s, p[2] + N[k][2] * s]);
        position.push(q[0], q[1], q[2]);
      };
      position.push(p[0], p[1], p[2]);
      side(1, left[k]);
      side(-1, right[k]);
      // (inside the edge: at the spine, the nearer side's breadth, the stroke's shape centred half its scallops over)
      const half = (L[k] + Rt[k]) / 2;
      ribbon.push(cap ? -rim : Math.min(L[k], Rt[k]), half, r.offset, -rim, half, r.offset, -rim, half, r.offset);
      owner.push(chunk, key, chunk, key, chunk, key);
      return at;
    };
    const quad = (a: number, b: number): void => {
      // (spine, left, right of each row: two triangles each side)
      tris.push(a, a + 1, b + 1, a, b + 1, b, a, b, b + 2, a, b + 2, a + 2);
    };
    // (a chunk's rows the same points as its segments: STEPS_A_CHUNK of the stroke's steps)
    const per = STEPS_A_CHUNK / EVERY;
    const chunks = Math.ceil((m - 1) / per);
    for (let c = 0; c < chunks; c++) {
      const chunk = r.chunk + c;
      const from = c * per;
      const to = Math.min(from + per, m - 1);
      let prev = c === 0 ? row(past(0, -1), 0, true, chunk) : -1;
      for (let k = from; k <= to; k++) {
        const at = row(P[k], k, false, chunk);
        if (prev >= 0) quad(prev, at);
        prev = at;
      }
      if (c === chunks - 1) quad(prev, row(past(m - 1, 1), m - 1, true, chunk));
    }
  }
  // the clouds in order of height
  const clouds = [...byCloud.keys()].sort((a, b) => offsets.get(a)! - offsets.get(b)! || a - b);
  const ascending = new Uint32Array(clouds.reduce((s, c) => s + byCloud.get(c)!.length, 0));
  const descending = new Uint32Array(ascending.length);
  let at = 0;
  for (const c of clouds) {
    ascending.set(byCloud.get(c)!, at);
    at += byCloud.get(c)!.length;
  }
  at = 0;
  for (let i = clouds.length - 1; i >= 0; i--) {
    descending.set(byCloud.get(clouds[i])!, at);
    at += byCloud.get(clouds[i])!.length;
  }
  const segments = Float32Array.from(made.ids);
  for (let i = 1; i < segments.length; i += 2) segments[i] = heightKey(offsets.get(segments[i]) ?? 0);
  return {
    position: Float32Array.from(position),
    ribbon: Float32Array.from(ribbon),
    owner: Float32Array.from(owner),
    segments,
    ascending,
    descending,
    heights: Float32Array.from(clouds.map((c) => offsets.get(c)!)),
    counts: Uint32Array.from(clouds.map((c) => byCloud.get(c)!.length)),
  };
}

/** How a triangle turns against the sphere at its first corner (< 0 the way the ribbons' triangles all turn). */
function turned(a: V3, b: V3, c: V3): number {
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  return n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
