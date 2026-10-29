import type { Vector3 } from 'three';
import { hash32, mix, unit } from '../core/hash';
import { clamp } from '../core/math';
import { AREA_ELEMENT_UV_MAX, areaElementUv } from './cubesphere';

// REST SPACE. Every scattered feature is a point of a progressive point set:
// a stable face position, a seed and a birth rank, none of which ever depend
// on the planet's size.
//
// Each face holds a quadtree with exactly one point per cell at every level.
// Going one level down, the parent's point stays in the child that contains
// it and the other three children get a new jittered point, so every complete
// level is stratified. New points of a level are born child-slot first, then
// parent cell in Owen-scrambled, digit-reversed Morton order, so any prefix
// covers the face evenly. A point's global rank n gives its birth density
// (n + ½) per unit of face uv; dividing by the uv area element J gives the
// unit-sphere density σ (points per steradian) at which it appears. A class
// with density ρ (per m²) shows a point once ρR² ≥ σ, i.e. at its birth
// radius R_i = √(σ_i / ρ). Visible count = ρ · 4πR² = ρA, exactly.

export interface PointClass {
  /** Hash salt that makes this class's points distinct from every other's. */
  readonly salt: number;
  /** Fraction of a cell a new point may wander from the cell centre (0..1). */
  readonly jitter: number;
}

/** One emitted point. The visitor gets a reused record; copy what you keep. */
export interface RestPoint {
  face: number;
  /** Level and cell where the point was born: its identity. */
  level: number;
  i: number;
  j: number;
  /** Face uv ∈ [0, 1]². */
  u: number;
  v: number;
  /** Global birth rank on its face. */
  rank: number;
  /** Unit-sphere density at which the point is born, per steradian. */
  threshold: number;
  seed: number;
}

export type PointVisitor = (p: RestPoint) => void;

const POW4 = new Float64Array(33).map((_, k) => 4 ** k);
const POW2 = new Float64Array(33).map((_, k) => 2 ** k);
const MAX_LEVEL = 24;

function cellHash(base: number, face: number, level: number, i: number, j: number): number {
  return mix(mix(mix(mix(base, face), level), i), j);
}

/** Which child (bit 0: +u, bit 1: +v) of cell (level, ci, cj) contains (u, v). */
function childOf(u: number, v: number, level: number, ci: number, cj: number): number {
  const s = POW2[level + 1];
  const cx = clamp(Math.floor(u * s) - 2 * ci, 0, 1);
  const cy = clamp(Math.floor(v * s) - 2 * cj, 0, 1);
  return cx | (cy << 1);
}

/** Birth order of the three new children: the diagonal opposite first, then the other two. */
function slotOf(inherited: number, child: number, parentHash: number): number {
  if (child === (inherited ^ 3)) return 0;
  const swap = ((parentHash >>> 3) & 1) === 1;
  return (child === (inherited ^ 1)) !== swap ? 1 : 2;
}

/**
 * Visit every point of `cls` that lies in quadtree cell (L, I, J) of `face`
 * and is born at or below unit-sphere density `sigmaMax`. Cost is linear in
 * the number of points visited; nothing outside the cell is enumerated.
 */
export function enumerateCell(
  cls: PointClass,
  worldSeed: number,
  face: number,
  L: number,
  I: number,
  J: number,
  sigmaMax: number,
  visit: PointVisitor,
): void {
  // A bound that is not a finite positive density would never stop descending.
  if (!(sigmaMax > 0 && sigmaMax < Number.POSITIVE_INFINITY)) return;
  const base = mix(cls.salt, worldSeed);
  const jitter = cls.jitter;
  // No point with a rank above this can be born by sigmaMax anywhere on the face.
  const rankCap = sigmaMax * AREA_ELEMENT_UV_MAX;
  const p: RestPoint = { face, level: 0, i: 0, j: 0, u: 0, v: 0, rank: 0, threshold: 0, seed: 0 };

  const place = (level: number, ci: number, cj: number, h: number): void => {
    const inv = 1 / POW2[level];
    p.u = (ci + 0.5 + jitter * (unit(h) - 0.5)) * inv;
    p.v = (cj + 0.5 + jitter * (unit(hash32(h ^ 0x68e31da4)) - 0.5)) * inv;
    p.seed = hash32(h ^ 0xb5297a4d);
  };
  const emit = (): void => {
    p.threshold = (p.rank + 0.5) / areaElementUv(p.u, p.v);
    if (p.threshold <= sigmaMax) visit(p);
  };

  // 1. Descend from the face root to the cell, tracking the point that
  //    occupies each ancestor and the ancestor's progressive index Q.
  place(0, 0, 0, cellHash(base, face, 0, 0, 0));
  p.level = 0;
  p.i = 0;
  p.j = 0;
  p.rank = 0;
  let Q = 0;
  for (let m = 0; m < L; m++) {
    const ci = I >> (L - m);
    const cj = J >> (L - m);
    const ti = I >> (L - m - 1);
    const tj = J >> (L - m - 1);
    const c = (ti & 1) | ((tj & 1) << 1);
    const hp = cellHash(base, face, m, ci, cj);
    const inherited = childOf(p.u, p.v, m, ci, cj);
    if (c !== inherited) {
      p.rank = POW4[m] * (1 + slotOf(inherited, c, hp)) + Q;
      p.level = m + 1;
      p.i = ti;
      p.j = tj;
      place(m + 1, ti, tj, cellHash(base, face, m + 1, ti, tj));
    }
    Q += (c ^ (hp & 3)) * POW4[m];
  }

  // 2. The cell's own point, wherever it was born.
  const ownU = p.u;
  const ownV = p.v;
  emit();

  // 3. Everything born deeper inside the cell.
  const descend = (m: number, ci: number, cj: number, pu: number, pv: number, q: number): void => {
    if (POW4[m] > rankCap || m >= MAX_LEVEL) return; // births at level m+1 rank ≥ 4^m
    const hp = cellHash(base, face, m, ci, cj);
    const inherited = childOf(pu, pv, m, ci, cj);
    const scramble = hp & 3;
    for (let c = 0; c < 4; c++) {
      const ti = 2 * ci + (c & 1);
      const tj = 2 * cj + (c >> 1);
      const qc = q + (c ^ scramble) * POW4[m];
      if (c === inherited) {
        descend(m + 1, ti, tj, pu, pv, qc);
        continue;
      }
      p.rank = POW4[m] * (1 + slotOf(inherited, c, hp)) + q;
      p.level = m + 1;
      p.i = ti;
      p.j = tj;
      place(m + 1, ti, tj, cellHash(base, face, m + 1, ti, tj));
      const cu = p.u;
      const cv = p.v;
      if (p.rank <= rankCap) emit();
      descend(m + 1, ti, tj, cu, cv, qc);
    }
  };
  descend(L, I, J, ownU, ownV, Q);
}

/** ln of the radius at which a point with this threshold is born, for density ρ. */
export function birthLnRadius(threshold: number, density: number): number {
  return 0.5 * Math.log(threshold / density);
}

// ---- growth fades ---------------------------------------------------------

/** Seconds over which a new point fades in during steady growth. */
export const FADE_SECONDS = 1.5;
/** Minimum fade band in ln R, so the band never collapses to a hard step. */
export const FADE_MIN_BAND = 0.015;

/**
 * The fade band. R_lag follows R with a 1.5 s exponential lag in log space,
 * and a point's fade is where its birth radius sits between them:
 *
 *   v = clamp((hi − ln R_i) / max(hi − lo, W_min)),  hi/lo = max/min(ln R, ln R_lag)
 *
 * Steady growth fades every new point in over exactly 1.5 s; shrinking runs
 * the same band backwards; at rest the frame is a pure function of R.
 * rest.glsl evaluates the same expression from the uniform this writes.
 */
export class GrowthBand {
  lnR = 0;
  lnRLag = 0;
  private started = false;

  update(radius: number, dt: number): void {
    const ln = Math.log(radius);
    this.lnR = ln;
    if (!this.started) {
      this.lnRLag = ln;
      this.started = true;
      return;
    }
    this.lnRLag += (ln - this.lnRLag) * (1 - Math.exp(-dt / FADE_SECONDS));
    if (Math.abs(ln - this.lnRLag) < 1e-6) this.lnRLag = ln;
  }

  /** Close the band: the frame becomes a pure function of R. */
  settle(): void {
    this.lnRLag = this.lnR;
  }

  get hi(): number {
    return Math.max(this.lnR, this.lnRLag);
  }

  get lo(): number {
    return Math.min(this.lnR, this.lnRLag);
  }

  /** Radius up to which points are at least partly visible (top of the band). */
  get radiusHi(): number {
    return Math.exp(this.hi);
  }

  fade(lnBirthRadius: number): number {
    return clamp((this.hi - lnBirthRadius) / Math.max(this.hi - this.lo, FADE_MIN_BAND), 0, 1);
  }

  /** (hi, lo, 1/width) for the uGrowthBand uniform. */
  write(out: Vector3): Vector3 {
    return out.set(this.hi, this.lo, 1 / Math.max(this.hi - this.lo, FADE_MIN_BAND));
  }
}
