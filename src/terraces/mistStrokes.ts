import { hash32, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { gnoise } from '../planet/noise';

// The terraces' mist as strokes (Kai, 2026-11-02, against the blue-green landscape: the bands' meanders "too
// simplistic and mechanical", their widths not growing and shrinking "as dynamically as the painting"). Each band is
// a stroke of its own, as the painting's ribbons are brushed. It runs along the wind, the wind's way twisted across
// the globe by a broad pattern of its own (Kai: off the latitude lines), and meanders as a river does (a
// sine-generated curve, Kinoshita's, its sinuosity and wavelength wandering along it: mostly long calm runs, as the
// painting's are, now and then a coiling stretch that folds back on itself; its bends lean). It is steered round the
// hills its layer meets (toward the side where it clears the ground more, ahead), so it winds along the valleys
// between them, and now and then ends in a curl. Its breadth swells into broad bodies and pinches to thin necks along
// it, scalloped along one edge, tapering to a point at its tail. Some fork, a branch peeling off; some run with a
// sibling stacked beside them, as the painting's ribbons lie in parallel runs. They lie anywhere over the layer's
// sphere (Kai: "a full spherical surface"), as many as asked for, each where it does not pile on another and is not
// mostly under the ground (or, the sphere crowded, where it piles on the others least). Each cloud (a stroke with its
// branch and its sibling) floats at its own height, offset up or down from the sphere at random within its range
// (Kai). Out come their ribbons (their spines and breadths, for mist.ts to draw, each at its cloud's height) and
// their segments (their shapes, for mist.ts to bake), both numbered by cloud and by 8 m chunk along each stroke.

/** A layer's strokes (mist.ts MIST). */
export interface StrokeParams {
  /** How many (the panel's Cloud count; each with its branch or sibling, if any). */
  readonly strokes: number;
  /** How far each is offset up or down from the layer's sphere, at most (m: the panel's Cloud height range). */
  readonly range: number;
  /** Their half-breadth (m, about: each its own, and swelling and thinning along it). */
  readonly half: number;
  /** Their length (m, from … to). */
  readonly length: readonly [number, number];
  /** Their meanders' wavelength along them (m) and their greatest turn (rad), each from … to, wandering along a stroke. */
  readonly wavelength: readonly [number, number];
  readonly sinuosity: readonly [number, number];
  /** The shares ending in a curl, with a branch, with a stacked sibling. */
  readonly curl: number;
  readonly branch: number;
  readonly stack: number;
  /** The scallops' spacing along a stroke's edge (m). */
  readonly lobe: number;
  /** How hard a stroke steers round the hills (rad per m, for each m more its layer clears the ground on one side than the other). */
  readonly steer: number;
  /** How far the strokes' way turns off the wind's across the globe (0 … 1: up to about 110° either way; 0.6, about 70°), by a broad pattern (TWIST). */
  readonly twist: number;
}

/**
 * A stroke to draw: its spine's points as traced (unit directions, x y z …), its breadth to each side at each (m: to
 * its left, toward the spine's direction crossed with its way, and to its right), its cloud (from 1) and that cloud's
 * offset from the layer's sphere (m), the number of its first chunk (its points STEPS_A_CHUNK at a time, numbered on
 * from there).
 */
export interface Ribbon {
  readonly pts: Float32Array;
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly cloud: number;
  readonly offset: number;
  readonly chunk: number;
}

/**
 * A layer's strokes: their ribbons, and as segments (per segment its ends, unit directions, and its half-breadth at
 * each, m: A.xyz, B.xyz, hA, hB; beside them in `ids` its chunk and its cloud).
 */
export interface StrokeSegments {
  readonly ribbons: Ribbon[];
  readonly data: Float32Array;
  readonly ids: Float32Array;
  readonly count: number;
  /** How many strokes (and of those, branches and siblings), how many clouds they make, and their area (m²). */
  readonly strokes: number;
  readonly children: number;
  readonly clouds: number;
  readonly area: number;
}

type V3 = [number, number, number];

/** How far apart a stroke's points are (m), and how many of its steps make a chunk (8 m). */
export const STEP = 0.5;
export const STEPS_A_CHUNK = 16;
/** The pattern twisting the strokes' way off the wind's: its two scales (m), the finer's share. */
const TWIST = { broad: 220, fine: 85, fineShare: 0.3 } as const;
/** How near the wind's poles a stroke comes (m: there it ends, pointed over its last TIP m; the wind swirls round them, twisted into a whirlpool), and starts. */
const POLE = 10;
const TIP = 6;
/**
 * How far inside a bend a stroke's inner side reaches at most (× the bend's radius: so its ribbon, mistRibbons.ts,
 * can hold it), and how fast that eases off along the stroke away from the bend (m a m).
 */
export const INSIDE = 0.8;
export const EASE = 0.5;
/** Kinoshita's skew and flatness of a meander's bends. */
const SKEW = 1 / 32;
const FLAT = 1 / 192;

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A stroke as traced: its points (unit), its heading at each relative to the wind (rad), its two half-breadths at each (m), its offset from the layer's sphere (m). */
interface Traced {
  readonly pts: V3[];
  readonly alpha: number[];
  readonly left: number[];
  readonly right: number[];
  readonly offset: number;
}

/**
 * A layer's strokes for a seed (the same first strokes whatever their number). `radius`: the layer's radius (m).
 * `axis`: the wind's (the strokes run round it). `clearance`: how far the layer's sphere lies over the ground at a
 * direction (m; a stroke's own by its offset).
 */
export function makeStrokes(P: StrokeParams, seed: number, radius: number, axis: V3, clearance: (d: V3) => number): StrokeSegments {
  let h = hash32(seed >>> 0) || 1;
  const rnd = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
  const between = (r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rnd();
  const noise = (s: number, o: number): number => gnoise(s, o, 0.5, (seed + 0x2b1) >>> 0);
  const R = radius;
  /** The strokes' way at a direction (unit, square to it): round the wind's axis (swirling round its poles), turned by the twist's pattern there (off the latitude lines). */
  const windAt = (p: V3): V3 => {
    let w = cross(axis, p);
    const l = Math.hypot(w[0], w[1], w[2]);
    w = l < 1e-9 ? norm(cross(p, Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])) : [w[0] / l, w[1] / l, w[2] / l];
    if (P.twist <= 0) return w;
    const b = R / TWIST.broad;
    const f = R / TWIST.fine;
    const n = (1 - TWIST.fineShare) * gnoise(p[0] * b + 5.1, p[1] * b, p[2] * b, (seed + 0x7a1) >>> 0) + TWIST.fineShare * gnoise(p[0] * f, p[1] * f + 2.3, p[2] * f, (seed + 0x7a2) >>> 0);
    const turn = P.twist * 1.25 * Math.PI * n;
    const side = cross(p, w);
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    return [w[0] * c + side[0] * sn, w[1] * c + side[1] * sn, w[2] * c + side[2] * sn];
  };
  /** Whether a direction lies within d m of the wind's poles. */
  const nearPole = (p: V3, d: number): boolean => Math.hypot(...cross(axis, p)) < Math.sin(d / R);
  /** A heading a (rad) off the wind at a direction, as a unit tangent there. */
  const headingAt = (p: V3, a: number): V3 => {
    const wind = windAt(p);
    const side = cross(p, wind);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    return [wind[0] * c + side[0] * sn, wind[1] * c + side[1] * sn, wind[2] * c + side[2] * sn];
  };

  /**
   * Trace a stroke from p0 heading alpha0 off the wind: its meander (wavelength, sinuosity, their noise's offsets),
   * its length, its breadth (half at full, the scalloped side), its tail and end (a curl or a point); `ramp` (m) eases
   * the meander in from straight (a branch peels off before it bends), `follow` a heading to keep to instead (a sibling
   * runs beside its stroke).
   */
  const trace = (p0: V3, alpha0: number, Ls: number, half: number, ramp: number, start: number, follow: number[] | null, offset: number): Traced => {
    const o = [rnd() * 97, rnd() * 97, rnd() * 97, rnd() * 97, rnd() * 97, rnd() * 97];
    const skew = rnd() < 0.5 ? 1 : -1;
    const scallopRight = rnd() < 0.5;
    const curl = rnd() < P.curl;
    const curlLen = curl ? Math.min(8 + 5 * rnd(), 0.3 * Ls) : 0;
    const curlR = 3.2 + 1.3 * rnd();
    const curlSide = rnd() < 0.5 ? 1 : -1;
    const tin = (0.12 + 0.18 * rnd()) * Ls;
    const tout = (0.08 + 0.14 * rnd()) * Ls;
    const swellOver = 20 + 10 * rnd();
    const pts: V3[] = [];
    const alpha: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    let p = p0;
    let phi = rnd() * Math.PI * 2;
    let curled = 0;
    let steered = 0;
    let M = P.wavelength[0];
    let w0 = P.sinuosity[0];
    const n = Math.max(2, Math.floor(Ls / STEP) + 1);
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      // its heading: the meander (a sine-generated curve, its sinuosity and wavelength wandering), eased in over `ramp`
      // (its wavelength and sinuosity wander over 60–90 m: worked out every 2 m)
      if (i % 4 === 0) {
        M = P.wavelength[0] + (P.wavelength[1] - P.wavelength[0]) * (0.5 + 0.5 * Math.max(-1, Math.min(1, 1.6 * noise(s / 90 + o[0], o[1]))));
        w0 = P.sinuosity[0] + (P.sinuosity[1] - P.sinuosity[0]) * Math.pow(smoothstep(-0.3, 0.5, noise(s / 60 + o[2], o[3])), 2.2);
      }
      const w = w0 * smoothstep(0, Math.max(ramp, 1e-3), s);
      phi += (2 * Math.PI * STEP) / M;
      let a = follow ? follow[Math.min(i, follow.length - 1)] : alpha0 + w * Math.sin(phi) + w * w * w * skew * (SKEW * Math.cos(3 * phi) - FLAT * Math.sin(3 * phi));
      // (its end curled: the last of it turning tighter and tighter, a scroll's hook)
      const c = s - (Ls - curlLen);
      if (curl && c > 0) {
        const u = c / curlLen;
        curled += (STEP / (curlR * (1 - 0.75 * u))) * curlSide;
      }
      // (steered: every meter, toward the side where its layer clears the ground more, 4 m ahead; never more than a
      // quarter turn either way in all)
      if (P.steer > 0 && i % 2 === 0) {
        const ahead = (d: number): number => {
          const t = headingAt(p, a + steered + d);
          return Math.min(clearance(norm([p[0] + (t[0] * 4) / R, p[1] + (t[1] * 4) / R, p[2] + (t[2] * 4) / R])) + offset, 5);
        };
        steered = Math.max(-1.6, Math.min(1.6, steered + Math.max(-0.12, Math.min(0.12, P.steer * (ahead(0.6) - ahead(-0.6)))) * 2 * STEP));
      }
      a += curled + steered;
      // its breadth: swelling into long broad bodies, pinching to necks (thin through its tightest bends, as the
      // painting's turns are), its tail pointed, its end a point or thinning into its curl
      const swell = Math.min(0.5 + 1.2 * Math.pow(smoothstep(-0.5, 0.6, noise(s / swellOver + o[4], 3.1) + 0.3 * noise(s / 6 + o[5], 7.7)), 1.3), 1.7 - 0.9 * smoothstep(0.8, 1.35, w));
      const tail = start + (1 - start) * Math.pow(smoothstep(0, tin, s), 0.75);
      const end = curl ? (c < 0 ? 0.45 + 0.55 * smoothstep(-6, -0.01, -c) : 0.45 - 0.37 * (c / curlLen)) : Math.pow(smoothstep(Ls, Ls - tout, s), 0.75);
      const b = half * swell * tail * end;
      const scallop = 1 - Math.min(1.7 * Math.abs(noise(s / P.lobe + o[0] * 0.37, 11.3)), 1);
      pts.push(p);
      alpha.push(a);
      left.push(b * (scallopRight ? 1 : 1 + 0.35 * scallop));
      right.push(b * (scallopRight ? 1 + 0.35 * scallop : 1));
      // a step along its heading
      const t = headingAt(p, a);
      p = norm([p[0] + (t[0] * STEP) / R, p[1] + (t[1] * STEP) / R, p[2] + (t[2] * STEP) / R]);
      // (ended short of the wind's poles, pointed)
      if (nearPole(p, POLE)) {
        for (let j = pts.length - 1, k = 0; j >= 0 && k * STEP < TIP; j--, k++) {
          const f = Math.pow(smoothstep(0, TIP, k * STEP), 0.75);
          left[j] *= f;
          right[j] *= f;
        }
        break;
      }
    }
    // its inner side thinned through its tightest bends, short of their centres, easing off away from them (a
    // meter's turn either side of a point: > 0 toward its left)
    const m = pts.length;
    const bend = pts.map((q, i) => {
      if (i < 2 || i > m - 3) return 0;
      const a = pts[i - 2];
      const b = pts[i + 2];
      const u: V3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      const v: V3 = [b[0] - q[0], b[1] - q[1], b[2] - q[2]];
      const c = cross(u, v);
      const lu = Math.hypot(u[0], u[1], u[2]);
      const lv = Math.hypot(v[0], v[1], v[2]);
      const sin = (c[0] * q[0] + c[1] * q[1] + c[2] * q[2]) / Math.max(lu * lv, 1e-12);
      const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.max(lu * lv, 1e-12);
      return Math.atan2(sin, cos) / Math.max(((lu + lv) / 2) * R, 1e-6);
    });
    const most = Math.max(...left, ...right);
    const reach = Math.ceil(most / EASE / STEP);
    for (let j = 0; j < m; j++) {
      if (bend[j] === 0) continue;
      const side = bend[j] > 0 ? left : right;
      const inner = INSIDE / Math.abs(bend[j]);
      if (inner >= most) continue;
      for (let i = Math.max(j - reach, 0); i <= Math.min(j + reach, m - 1); i++) side[i] = Math.min(side[i], inner + EASE * STEP * Math.abs(i - j));
    }
    return { pts, alpha, left, right, offset };
  };

  // (where strokes lie already: cells of the layer's shell a few meters across)
  const CELL = 3;
  const taken = new Set<number>();
  const cellOf = (p: V3, dx = 0, dy = 0, dz = 0): number =>
    ((Math.floor((p[0] * R) / CELL) + dx + 512) * 1024 + (Math.floor((p[1] * R) / CELL) + dy + 512)) * 1024 + (Math.floor((p[2] * R) / CELL) + dz + 512);
  const mark = (t: Traced): void => {
    t.pts.forEach((p, i) => {
      if (i % 2) return;
      const r = Math.ceil((Math.max(t.left[i], t.right[i]) + 1) / CELL);
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) taken.add(cellOf(p, a, b, c));
    });
  };
  const overlap = (t: Traced): number => t.pts.reduce((n, p) => n + (taken.has(cellOf(p)) ? 1 : 0), 0) / t.pts.length;
  /** A try's likely pile on the others and clearance, cheaply: its straight run along its heading, a point every 4 m. */
  const probe = (start: V3, alpha0: number, length: number, offset: number): [number, number] => {
    const t = headingAt(start, alpha0);
    let pile = 0;
    let ok = 0;
    let n = 0;
    for (let s = 0; s <= length; s += 4, n++) {
      const c = Math.cos(s / R);
      const sn = Math.sin(s / R);
      const p: V3 = [start[0] * c + t[0] * sn, start[1] * c + t[1] * sn, start[2] * c + t[2] * sn];
      if (taken.has(cellOf(p))) pile++;
      if (clearance(p) + offset > 1) ok++;
    }
    return [pile / n, ok / n];
  };
  const clear = (t: Traced): number => {
    let ok = 0;
    for (let i = 0; i < t.pts.length; i += 4) if (clearance(t.pts[i]) + t.offset > 1) ok++;
    return ok / Math.ceil(t.pts.length / 4);
  };

  const strokes: Traced[] = [];
  /** Each stroke's cloud (from 1). */
  const cloudOf: number[] = [];
  let children = 0;
  let clouds = 0;
  for (let k = 0; k < P.strokes; k++) {
    // a stroke anywhere over the sphere, at its own height: the first of a few tries that neither piles on another
    // nor lies mostly under the ground (none traced that its straight run says would); failing that, the sphere
    // crowded with as many as the panel asks for, the try that piles on the others least
    let found: Traced | null = null;
    let least: [V3, number, number, number, number] | null = null;
    let leastPile = 2;
    for (let tries = 0; tries < 24 && !found; tries++) {
      const z = 2 * rnd() - 1;
      const a = 2 * Math.PI * rnd();
      const r = Math.sqrt(1 - z * z);
      const start: V3 = [r * Math.cos(a), r * Math.sin(a), z];
      const alpha0 = (rnd() - 0.5) * 0.6;
      const length = between(P.length);
      const half = P.half * (0.7 + 0.6 * rnd());
      const offset = P.range * (2 * rnd() - 1);
      if (nearPole(start, 2 * POLE)) continue;
      const [pile, ok] = probe(start, alpha0, length, offset);
      if (ok < 0.45) continue;
      if (pile < leastPile) {
        least = [start, alpha0, length, half, offset];
        leastPile = pile;
      }
      if (pile > 0.25) continue;
      const t = trace(start, alpha0, length, half, 0, 0, null, offset);
      if (clear(t) >= 0.5 && overlap(t) <= 0.2) found = t;
    }
    if (!found && least) found = trace(least[0], least[1], least[2], least[3], 0, 0, null, least[4]);
    if (!found) continue;
    clouds++;
    strokes.push(found);
    cloudOf.push(clouds);
    mark(found);
    const parent = found;
    const at = (f: number): number => Math.min(Math.floor(f * parent.pts.length), parent.pts.length - 1);
    // a branch peeling off it, now and then
    if (rnd() < P.branch) {
      const i = at(0.25 + 0.4 * rnd());
      const turn = (0.45 + 0.35 * rnd()) * (rnd() < 0.5 ? 1 : -1);
      const b = trace(parent.pts[i], parent.alpha[i] + turn, (0.3 + 0.25 * rnd()) * STEP * parent.pts.length, 0.7 * P.half * (0.7 + 0.6 * rnd()), 8, 0.5, null, parent.offset);
      strokes.push(b);
      cloudOf.push(clouds);
      mark(b);
      children++;
    }
    // a sibling stacked beside it, running with it a while
    if (rnd() < P.stack) {
      const i = at(0.1 + 0.3 * rnd());
      const side = rnd() < 0.5 ? 1 : -1;
      const p = parent.pts[i];
      const a = parent.alpha[i];
      const nrm = cross(p, headingAt(p, a));
      const gap = (side > 0 ? parent.left[i] : parent.right[i]) + 1.2 + 1.4 * rnd() + 0.8 * P.half;
      const start = norm([p[0] + (nrm[0] * side * gap) / R, p[1] + (nrm[1] * side * gap) / R, p[2] + (nrm[2] * side * gap) / R]);
      const s = trace(start, a, (0.35 + 0.35 * rnd()) * STEP * parent.pts.length, P.half * (0.55 + 0.3 * rnd()), 0, 0, parent.alpha.slice(i), parent.offset);
      strokes.push(s);
      cloudOf.push(clouds);
      mark(s);
      children++;
    }
  }

  // their ribbons and segments, each stroke's spine moved over by half its scallops (its two sides' breadths differ);
  // its chunks numbered on from the last stroke's, two apart
  const out: number[] = [];
  const ids: number[] = [];
  const ribbons: Ribbon[] = [];
  let area = 0;
  let chunk = 1;
  strokes.forEach((t, k) => {
    const cloud = cloudOf[k];
    let prev: V3 | null = null;
    let prevH = 0;
    const pts = new Float32Array(3 * t.pts.length);
    t.pts.forEach((p, i) => {
      const nrm = cross(p, headingAt(p, t.alpha[i]));
      const shift = (t.left[i] - t.right[i]) / 2 / R;
      const c = norm([p[0] + nrm[0] * shift, p[1] + nrm[1] * shift, p[2] + nrm[2] * shift]);
      const hh = (t.left[i] + t.right[i]) / 2;
      pts.set(p, 3 * i);
      if (prev && (hh > 0.04 || prevH > 0.04)) {
        out.push(prev[0], prev[1], prev[2], c[0], c[1], c[2], prevH, hh);
        ids.push(chunk + Math.floor((i - 1) / STEPS_A_CHUNK), cloud);
        area += STEP * (hh + prevH);
      }
      prev = c;
      prevH = hh;
    });
    ribbons.push({ pts, left: Float32Array.from(t.left), right: Float32Array.from(t.right), cloud, offset: t.offset, chunk });
    chunk += Math.ceil(Math.max(t.pts.length - 1, 1) / STEPS_A_CHUNK) + 2;
  });
  return { ribbons, data: Float32Array.from(out), ids: Float32Array.from(ids), count: out.length / 8, strokes: strokes.length, children, clouds, area };
}
