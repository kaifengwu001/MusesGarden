import { hash32, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { gnoise } from '../planet/noise';

// The terraces' mist as strokes (Kai, 2026-11-02, against the blue-green landscape: the bands' meanders "too
// simplistic and mechanical", their widths not growing and shrinking "as dynamically as the painting"). Each band is
// a stroke of its own, as the painting's ribbons are brushed: it runs along the wind, meandering as a river does (a
// sine-generated curve, Kinoshita's, its sinuosity and wavelength wandering along it: mostly long calm runs, as the
// painting's are, now and then a coiling stretch that folds back on itself; its bends lean), steered round the hills its layer meets (toward the side where it clears the
// ground more, ahead), so it winds along the valleys between them, now and then ending in a curl; its breadth swells into broad bodies and pinches to
// thin necks along it, scalloped along one edge, tapering to a point at its tail. Some fork, a branch peeling off; some
// run with a sibling stacked beside them, as the painting's ribbons lie in parallel runs; the rest merge where they
// cross. Each is kept where its layer clears the ground along most of it, and where it does not pile on another.
// Out come its segments, for the bake (mist.ts) to draw into its layer's cube map as distances.

/** A layer's strokes (mist.ts MIST_LAYERS). */
export interface StrokeParams {
  /** How many, at the panel's default coverage (each with its branch or sibling, if any). */
  readonly strokes: number;
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
}

/** A layer's strokes as segments: per segment its ends (unit directions) and its half-breadth at each (m): A.xyz, B.xyz, hA, hB. */
export interface StrokeSegments {
  readonly data: Float32Array;
  readonly count: number;
  /** How many strokes (and of those, branches and siblings), and their area (m²). */
  readonly strokes: number;
  readonly children: number;
  readonly area: number;
}

type V3 = [number, number, number];

/** How far apart a stroke's points are (m). */
const STEP = 0.5;
/** Kinoshita's skew and flatness of a meander's bends. */
const SKEW = 1 / 32;
const FLAT = 1 / 192;

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A stroke as traced: its points (unit), its heading at each relative to the wind (rad), its two half-breadths at each (m). */
interface Traced {
  readonly pts: V3[];
  readonly alpha: number[];
  readonly left: number[];
  readonly right: number[];
}

/**
 * A layer's strokes for a seed. `radius`: the layer's radius (m). `axis`: the wind's (the strokes run round it).
 * `clearance`: how far the layer lies over the ground at a direction (m). `shown`: the share of the strokes drawn
 * (the panel's coverage), the same strokes always first.
 */
export function makeStrokes(P: StrokeParams, seed: number, radius: number, axis: V3, clearance: (d: V3) => number, shown: number): StrokeSegments {
  let h = hash32(seed >>> 0) || 1;
  const rnd = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
  const between = (r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rnd();
  const noise = (s: number, o: number): number => gnoise(s, o, 0.5, (seed + 0x2b1) >>> 0);
  const R = radius;
  /** The wind's way at a direction (unit, square to it): round its axis. */
  const windAt = (p: V3): V3 => {
    const w = cross(axis, p);
    const l = Math.hypot(w[0], w[1], w[2]);
    if (l < 0.05) return norm(cross(p, Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    return [w[0] / l, w[1] / l, w[2] / l];
  };
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
  const trace = (p0: V3, alpha0: number, Ls: number, half: number, ramp: number, start: number, follow: number[] | null): Traced => {
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
          return Math.min(clearance(norm([p[0] + (t[0] * 4) / R, p[1] + (t[1] * 4) / R, p[2] + (t[2] * 4) / R])), 5);
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
    }
    return { pts, alpha, left, right };
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
  const clear = (t: Traced): number => {
    let ok = 0;
    for (let i = 0; i < t.pts.length; i += 4) if (clearance(t.pts[i]) > 1) ok++;
    return ok / Math.ceil(t.pts.length / 4);
  };

  const strokes: Traced[] = [];
  let children = 0;
  // (the same strokes first whatever the share shown: at the panel's default, 0.625 of them)
  const want = Math.round((P.strokes / 0.625) * Math.min(Math.max(shown, 0), 1));
  for (let k = 0; k < want; k++) {
    // a stroke where its layer clears the ground and it does not pile on another (a few tries)
    let found: Traced | null = null;
    for (let tries = 0; tries < 30 && !found; tries++) {
      const z = 2 * rnd() - 1;
      const a = 2 * Math.PI * rnd();
      const r = Math.sqrt(1 - z * z);
      const start: V3 = [r * Math.cos(a), r * Math.sin(a), z];
      const alpha0 = (rnd() - 0.5) * 0.6;
      const length = between(P.length);
      const half = P.half * (0.7 + 0.6 * rnd());
      // (none traced that starts under the ground)
      if (clearance(start) <= 1) continue;
      const t = trace(start, alpha0, length, half, 0, 0, null);
      if (clear(t) >= 0.55 && overlap(t) <= 0.2) found = t;
    }
    if (!found) continue;
    strokes.push(found);
    mark(found);
    const parent = found;
    const at = (f: number): number => Math.min(Math.floor(f * parent.pts.length), parent.pts.length - 1);
    // a branch peeling off it, now and then
    if (rnd() < P.branch) {
      const i = at(0.25 + 0.4 * rnd());
      const turn = (0.45 + 0.35 * rnd()) * (rnd() < 0.5 ? 1 : -1);
      const b = trace(parent.pts[i], parent.alpha[i] + turn, (0.3 + 0.25 * rnd()) * STEP * parent.pts.length, 0.7 * P.half * (0.7 + 0.6 * rnd()), 8, 0.5, null);
      strokes.push(b);
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
      const s = trace(start, a, (0.35 + 0.35 * rnd()) * STEP * parent.pts.length, P.half * (0.55 + 0.3 * rnd()), 0, 0, parent.alpha.slice(i));
      strokes.push(s);
      mark(s);
      children++;
    }
  }

  // their segments, each stroke's spine moved over by half its scallops (its two sides' breadths differ)
  const out: number[] = [];
  let area = 0;
  for (const t of strokes) {
    let prev: V3 | null = null;
    let prevH = 0;
    t.pts.forEach((p, i) => {
      const nrm = cross(p, headingAt(p, t.alpha[i]));
      const shift = (t.left[i] - t.right[i]) / 2 / R;
      const c = norm([p[0] + nrm[0] * shift, p[1] + nrm[1] * shift, p[2] + nrm[2] * shift]);
      const hh = (t.left[i] + t.right[i]) / 2;
      if (prev && (hh > 0.04 || prevH > 0.04)) {
        out.push(prev[0], prev[1], prev[2], c[0], c[1], c[2], prevH, hh);
        area += STEP * (hh + prevH);
      }
      prev = c;
      prevH = hh;
    });
  }
  return { data: Float32Array.from(out), count: out.length / 8, strokes: strokes.length, children, area };
}
