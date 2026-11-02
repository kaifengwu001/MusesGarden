import { Matrix3, Vector3 } from 'three';
import { hash32, unit } from '../../core/hash';
import { clamp, smoothstep } from '../../core/math';
import { gnoise } from '../../planet/noise';
import { createCropSample, createPlotSample, SEASON, type CropSample, type TerracePlots } from '../plots';
import type { Grid } from './grid';

// The terraces' build, step two (build/): every sample of the planet's grid
// given a label, the paddy it lies in (or none: wild, the river, a yard).
// On the hills, a paddy is a band between two of the planet's levels (the
// same everywhere), or the lens a wide band grows along its lower wall, cut
// along its length where the cuts' field crosses a step (bent along the
// banks near them, so a cut runs into the banks rather than straight
// across); on the valleys' flat floors, a plot of a warped lattice. Then the
// label map is cleaned: a band's small island (a little round paddy round a
// bump or a dip) joins the band round it, the hills levelled into it there,
// and a small lens goes. Samples on a face's edge are never relabelled, so the faces
// still agree there. Kept with the labels: the fields each boundary is the
// zero of, so the mesh can place every crossing exactly (mesh.ts).

/** The paddies' build: the step between levels (m) and its jitter (× a step), the share of levels left out (a band two levels tall). */
export const LEVELS = { step: 0.42, jitter: 0.3, merge: 0.07 } as const;
/** A lens grows where a band is this wide (m, from … to full), this share of it, less this lead; its floor this far up its band. */
export const LENS = { wide: [4.6, 7.2], share: 0.5, lead: 0.06, floor: 0.2 } as const;
/** The cuts: their field's pattern (m) and a step of it; how far a cut bends along the banks (× a step). */
export const CUTS = { pattern: 34, step: 0.11, bend: 0.2 } as const;
/** The flats' plots: their size (m), the lattice's warp (× a plot) and its pattern (m). */
export const PLOTS = { size: 11, warp: 0.22, pattern: 38 } as const;
/** Cleaning: a band's island under this (m²) and this far across (m: a blob, not a stretch of band) joins the band round it (the hills levelled into it), as does a lens. */
export const CLEAN = { ring: 300, across: 18 } as const;

export interface Paddy {
  /** 0 a terrace's paddy, 1 a plot of the flats. */
  readonly kind: 0 | 1;
  /** Its band (a level's index) and lens (0 the band, 1 its lens), its cut (a step of the cuts' field); −1 for a plot. */
  readonly band: number;
  readonly sub: number;
  readonly cut: number;
  /** Its floor (m over the planet's base sphere), and its crop. */
  floor: number;
  readonly crop: CropSample;
}

export interface Layout {
  /** Per face, per sample: its paddy (an index into paddies), −1 none. */
  readonly label: Int32Array[];
  readonly paddies: Paddy[];
  /** Per face, per sample, the fields the boundaries are the zeros of: land (> 0 any land), flats (> 0 the hills' side), lens (< 0 in it), cuts, the plots' lattice (3 a sample). */
  readonly land: Float32Array[];
  readonly flats: Float32Array[];
  readonly lens: Float32Array[];
  readonly cuts: Float32Array[];
  readonly lattice: Float32Array[];
  /** Per face, per sample: its share across its band (0 the lower wall … 1 the upper), meters from its lower wall. */
  readonly across: Float32Array[];
  readonly rows: Float32Array[];
  readonly levels: Levels;
  readonly seed: number;
}

/** A band's offset of the cuts' steps (so the cuts of neighbouring bands do not line up). */
export function cutOffset(band: number, seed: number): number {
  return unit(hash32((Math.imul(band, 2246822519) ^ seed) >>> 0));
}

/** The planet's levels: level k at about (k + ½) steps, jittered, a few left out (the band below them two steps tall). */
export class Levels {
  constructor(private readonly seed: number) {}
  private u(k: number, salt: number): number {
    return unit(hash32((Math.imul(k, 2654435761) ^ (this.seed + salt)) >>> 0));
  }
  at(k: number): number {
    return LEVELS.step * (k + 0.5 + LEVELS.jitter * (this.u(k, 0x51) - 0.5));
  }
  kept(k: number): boolean {
    return !(this.u(k, 0x52) < LEVELS.merge && this.u(k - 1, 0x52) >= LEVELS.merge);
  }
  /** The kept level at or below h. */
  below(h: number): number {
    let k = Math.floor(h / LEVELS.step - 0.5);
    while (this.at(k + 1) <= h) k++;
    while (this.at(k) > h) k--;
    while (!this.kept(k)) k--;
    return k;
  }
  /** The next kept level above level k. */
  above(k: number): number {
    let a = k + 1;
    while (!this.kept(a)) a++;
    return a;
  }
}

/** Every sample's label (a step of work at a time). */
export function* labelGrid(grid: Grid, plots: TerracePlots, seed: number, front: number, yard: (d: Vector3) => number): Generator<void, Layout, void> {
  const { n, R, dir, hs, slope, wild, flat, area } = grid;
  const N = n * n;
  const levels = new Levels(seed);
  const v = new Vector3();
  // the plots' lattice: turned once for the planet, warped a little
  const turn = new Matrix3();
  {
    let h = hash32((seed ^ 0x9107) >>> 0);
    const r = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
    const a = r() * Math.PI * 2;
    const b = Math.acos(2 * r() - 1);
    const c = r() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const cc = Math.cos(c);
    const sc = Math.sin(c);
    turn.set(ca * cc - sa * cb * sc, -ca * sc - sa * cb * cc, sa * sb, sa * cc + ca * cb * sc, -sa * sc + ca * cb * cc, -ca * sb, sb * sc, sb * cc, cb);
  }
  const land: Float32Array[] = [];
  const flats: Float32Array[] = [];
  const lens: Float32Array[] = [];
  const cuts: Float32Array[] = [];
  const lattice: Float32Array[] = [];
  const across: Float32Array[] = [];
  const rows: Float32Array[] = [];
  const band: Int32Array[] = [];
  const sub: Uint8Array[] = [];
  const kind: Int8Array[] = [];
  const fC = R / CUTS.pattern;
  const fW = R / PLOTS.pattern;
  const q = new Vector3();
  for (let f = 0; f < 6; f++) {
    const L = new Float32Array(N);
    const F = new Float32Array(N);
    const E = new Float32Array(N);
    const C = new Float32Array(N);
    const Q = new Float32Array(N * 3);
    const A = new Float32Array(N);
    const W = new Float32Array(N);
    const B = new Int32Array(N);
    const S = new Uint8Array(N);
    const K = new Int8Array(N).fill(-1);
    const d = dir[f];
    for (let k = 0; k < N; k++) {
      v.set(d[3 * k], d[3 * k + 1], d[3 * k + 2]);
      const fl = flat[f][k];
      L[k] = Math.min(0.5 - wild[f][k], 1.5 - fl, (yard(v) - 1) / 4);
      F[k] = 0.5 - fl;
      // the plots' lattice coordinates (in plots), turned and warped
      q.copy(v).applyMatrix3(turn).multiplyScalar(R / PLOTS.size);
      Q[3 * k] = q.x + PLOTS.warp * gnoise(v.x * fW, v.y * fW, v.z * fW, (seed + 911) >>> 0) / 0.27;
      Q[3 * k + 1] = q.y + PLOTS.warp * gnoise(v.x * fW, v.y * fW, v.z * fW, (seed + 912) >>> 0) / 0.27;
      Q[3 * k + 2] = q.z + PLOTS.warp * gnoise(v.x * fW, v.y * fW, v.z * fW, (seed + 913) >>> 0) / 0.27;
      if (L[k] <= 0) continue;
      if (fl >= 0.5) {
        K[k] = 1;
        continue;
      }
      K[k] = 0;
      B[k] = levels.below(hs[f][k]);
    }
    land.push(L);
    flats.push(F);
    lens.push(E);
    cuts.push(C);
    lattice.push(Q);
    across.push(A);
    rows.push(W);
    band.push(B);
    sub.push(S);
    kind.push(K);
    yield;
  }
  // a band's small islands (a little round paddy round a bump or a dip) join the band round them, the hills
  // levelled into it there (so the walls, traced on the hills, agree with the labels: no wall is left to place)
  const reach = CLEAN.across / grid.spacing;
  for (let f = 0; f < 6; f++) {
    islands(n, area[f], (k) => kind[f][k] === 0, (k) => band[f][k], CLEAN.ring, (k, b) => {
      if (b === NONE) return;
      band[f][k] = b;
      const lo = levels.at(b);
      const hi = levels.at(levels.above(b));
      hs[f][k] = clamp(hs[f][k], lo + 0.01, hi - 0.01);
    }, reach);
    yield;
  }
  // across each band, its lens, its cuts' field (from the levelled hills)
  for (let f = 0; f < 6; f++) {
    const d = dir[f];
    for (let k = 0; k < N; k++) {
      if (kind[f][k] !== 0) continue;
      v.set(d[3 * k], d[3 * k + 1], d[3 * k + 2]);
      const b = band[f][k];
      const lo = levels.at(b);
      const hi = levels.at(levels.above(b));
      const a = clamp((hs[f][k] - lo) / (hi - lo), 0, 1);
      const w = (hi - lo) / Math.max(slope[f][k], 0.02);
      across[f][k] = a;
      rows[f][k] = a * w;
      lens[f][k] = a - (LENS.share * smoothstep(LENS.wide[0], LENS.wide[1], w) - LENS.lead);
      sub[f][k] = lens[f][k] < 0 ? 1 : 0;
      // the cuts' field, bent a little along the banks near them
      cuts[f][k] = gnoise(v.x * fC, v.y * fC, v.z * fC, (seed + 931) >>> 0) + CUTS.bend * CUTS.step * Math.tanh(3 * (a - 0.5));
    }
    // small lenses go (their field turned to say so, for the walls)
    islands(n, area[f], (k) => kind[f][k] === 0 && sub[f][k] === 1, (k) => band[f][k], CLEAN.ring, (k) => {
      sub[f][k] = 0;
      lens[f][k] = Math.max(lens[f][k], 0.01);
    }, reach);
    yield;
  }
  // the paddies: a key each, then an index
  const paddies: Paddy[] = [];
  const byKey = new Map<string, number>();
  const label: Int32Array[] = [];
  const plotSample = createPlotSample();
  const sums = new Map<number, [number, number]>();
  for (let f = 0; f < 6; f++) {
    const lab = new Int32Array(N).fill(-1);
    const d = dir[f];
    for (let k = 0; k < N; k++) {
      if (kind[f][k] < 0) continue;
      let key: string;
      let make: () => Paddy;
      if (kind[f][k] === 1) {
        const ix = Math.floor(lattice[f][3 * k]);
        const iy = Math.floor(lattice[f][3 * k + 1]);
        const iz = Math.floor(lattice[f][3 * k + 2]);
        key = `p${ix},${iy},${iz}`;
        make = () => {
          v.set(d[3 * k], d[3 * k + 1], d[3 * k + 2]);
          plotSample.id = plots.hash(0, ix, iy, iz, 53);
          plotSample.season = plots.seasonAt(v);
          return { kind: 1, band: -1, sub: 0, cut: 0, floor: 0, crop: plots.cropOf(plotSample, front, createCropSample()) };
        };
      } else {
        const b = band[f][k];
        const s = sub[f][k];
        // (the cut's step: its band's own offset, so the cuts of neighbouring bands do not line up)
        const m = Math.floor(cuts[f][k] / CUTS.step + cutOffset(b, seed));
        key = `t${b}/${s}/${m}`;
        make = () => {
          plotSample.id = plots.hash(0, b, m, s, 47);
          plotSample.season = plots.seasonOf(b + 0.5 * s, m);
          const lo = levels.at(b);
          const hi = levels.at(levels.above(b));
          const floor = s === 1 ? lo + LENS.floor * (hi - lo) : 0.5 * (lo + hi);
          return { kind: 0, band: b, sub: s, cut: m, floor, crop: plots.cropOf(plotSample, front, createCropSample(), SEASON.band) };
        };
      }
      let idx = byKey.get(key);
      if (idx === undefined) {
        idx = paddies.length;
        paddies.push(make());
        byKey.set(key, idx);
      }
      lab[k] = idx;
      if (kind[f][k] === 1) {
        const s = sums.get(idx) ?? [0, 0];
        s[0] += grid.h[f][k];
        s[1]++;
        sums.set(idx, s);
      }
    }
    label.push(lab);
    yield;
  }
  // a plot lies level with the ground under it (to 5 cm)
  for (const [idx, [s, c]] of sums) paddies[idx].floor = Math.round(s / c / 0.05) * 0.05;
  return { label, paddies, land, flats, lens, cuts, lattice, across, rows, levels, seed };
}

/** No neighbour to join (islands). */
const NONE = -0x7fffffff;

/**
 * The small islands of a face's labels: each 4-connected run of samples with one value (among those `inside`
 * admits) under `limit` m², not touching the face's edge, handed to `set` sample by sample with the value
 * most of its neighbours (inside, with another value) have, or NONE.
 */
function islands(n: number, area: Float32Array, inside: (k: number) => boolean, value: (k: number) => number, limit: number, set: (k: number, v: number) => void, across = Infinity): void {
  const N = n * n;
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  const members: number[] = [];
  const votes = new Map<number, number>();
  for (let k0 = 0; k0 < N; k0++) {
    if (seen[k0] || !inside(k0)) continue;
    const val = value(k0);
    members.length = 0;
    stack.length = 0;
    votes.clear();
    stack.push(k0);
    seen[k0] = 1;
    let size = 0;
    let edge = false;
    let i0 = n;
    let i1 = 0;
    let j0 = n;
    let j1 = 0;
    while (stack.length) {
      const k = stack.pop() as number;
      members.push(k);
      size += area[k];
      const i = k % n;
      const j = (k - i) / n;
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j);
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) edge = true;
      for (let e = 0; e < 4; e++) {
        const ii = i + (e === 0 ? 1 : e === 1 ? -1 : 0);
        const jj = j + (e === 2 ? 1 : e === 3 ? -1 : 0);
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const kk = jj * n + ii;
        if (!inside(kk)) continue;
        const w = value(kk);
        if (w === val) {
          if (!seen[kk]) {
            seen[kk] = 1;
            stack.push(kk);
          }
        } else votes.set(w, (votes.get(w) ?? 0) + 1);
      }
    }
    if (edge || size >= limit || i1 - i0 > across || j1 - j0 > across) continue;
    let best = NONE;
    let most = 0;
    for (const [w, c] of votes) {
      if (c > most) {
        most = c;
        best = w;
      }
    }
    for (const k of members) set(k, best);
  }
}
