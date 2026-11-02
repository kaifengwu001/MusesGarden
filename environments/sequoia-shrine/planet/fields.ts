import { Vector3, Vector4 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { clamp, smoothstep } from '../../../src/core/math';
import { gnoise } from '../../../src/planet/noise';

// Meadow fields in rest space. The terrain bake (bake.frag.glsl) evaluates
// them on the GPU into two cube maps; `Fields` evaluates the same math on the
// CPU (picking, placement, flower assignment, tests). Change both together.
//
//   twirls     every field below is sampled through a few twirls: the
//              direction turned about a centre by an angle that fades with the
//              distance from it, like a marbler's comb. Hills, lakes, islands
//              and the flower drifts curve and swirl instead of lying about
//              as plain noise. Direction space only, so they too stay put as
//              R grows
//   relief     direction-space octaves weighted by their size in meters, so
//              the meadow keeps a constant spectrum as R grows (hills rise and
//              subside in place, never slide); compressed along a grain axis
//              so hills, islands and inlets run long, like a glaciated plain
//   wetness    a macro field in direction space (domain warped): where the
//              meadow sinks toward the water table. The threshold is read off
//              the field's own distribution, so `coverage` is what you get
//   height     relief + lift − (lift + sink)·wetness − water level (m). The
//              water table is h = 0: lakes are wherever the ground dips under
//              it, so every shore follows a contour of the hills. The sink is
//              small and hummocks grow in the wetlands, so a wetland is lace:
//              islands, spits and inlets rather than open water. In the
//              wetlands the ground also flattens toward a plateau a little
//              above the water, so islands are flat turf with a short bank
//   patterns   lushness, colour variant and richness: meter-sized noise,
//              sampled at the two direction-space octaves that bracket their
//              size (seeded by octave, so a pattern never jumps as R grows)
//   flora      flowers per m² for each species, in three scales: drifts
//              (where the meadow flowers at all: about half the ground, long
//              along the grain), colonies (which species hold a stretch of a
//              drift, by their weights) and clumps a couple of meters wide
//              (dense knots, and the gaps between them). Damp ground suits the
//              pink cups. Drifts and colonies are baked (bake.frag.glsl);
//              clumps are too fine for the bake, so the paint and the near
//              flowers evaluate them where they stand (clumps(), clumpsAt())

export const RELIEF_OCTAVES = 9;
export const RELIEF_BASE_FREQ = 1.6;
/** Spread (std) of gnoise; the normalised octave pairs keep it. */
export const NOISE_STD = 0.27;
/** Hummocks are this much taller (× (1 + k·wetness)) out in the wetlands. */
export const WET_HUMMOCKS = 1.4;
/** Wetland ground flattens toward this height above (and depth below) the water (m), keeping this much of its slope. */
export const WET_PLATEAU = { height: 0.55, keep: 0.12 } as const;
/** Grain compression at grain = 1 (hills and islands run ≈ 3× longer than wide). */
const GRAIN_MAX = 0.7;
/** Pattern sizes (m). */
export const PATTERN = { lush: 22, variant: 16, richness: 40, drift: 18 } as const;
/** Share of the ground in flower drifts, and of a drift's ground in clumps. */
export const DRIFT_COVER = 0.55;
export const CLUMP_COVER = 0.3;
/** Clump size × the patch size; what is left between the clumps of a drift (× a clump's density there). */
export const CLUMP_SCALE = 0.17;
export const CLUMP_FLOOR = 0.06;
const DRIFT_EDGE = 0.07;
const CLUMP_EDGE = 0.05;
/** Colony size per species, × the patch-size parameter: pink drifts are broad, blue clusters small. */
export const COLONY_SCALE = [1.3, 0.95, 0.8, 0.55] as const;
/** Seeds (added to the world's noise seed). */
const SEED = { relief: 0, warp: 31, wet: 34, lush: 170, rich: 180, variant: 190, colony: 200, drift: 230, detail: 300, clump: 400, twirl: 500 } as const;
/** Twirls: how many, and the range of their angular radii (rad) and turns (rad at the centre). */
export const TWIRLS = 4;
const TWIRL = { radius: [0.42, 0.95], turn: [1.2, 2.3] } as const;

export interface Twirl {
  readonly centre: Vector3;
  /** Angular radius (rad): the turn has fallen to 1/e here. */
  readonly radius: number;
  /** Turn at the centre (rad), either way. */
  readonly turn: number;
}

/** The world's twirls: centres spread over the sphere, two broad ones and two tighter. */
export function makeTwirls(seed: number): Twirl[] {
  let state = hash32((seed + SEED.twirl) >>> 0);
  const rand = (): number => unit((state = hash32((state + 0x9e3779b9) >>> 0)));
  const twirls: Twirl[] = [];
  while (twirls.length < TWIRLS) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const centre = new Vector3(r * Math.cos(a), r * Math.sin(a), z);
    if (twirls.some((t) => t.centre.dot(centre) > 0.2)) continue;
    const broad = twirls.length < 2;
    const radius = broad ? TWIRL.radius[0] + 0.55 * (TWIRL.radius[1] - TWIRL.radius[0]) + 0.45 * (TWIRL.radius[1] - TWIRL.radius[0]) * rand() : TWIRL.radius[0] + 0.4 * (TWIRL.radius[1] - TWIRL.radius[0]) * rand();
    const turn = (TWIRL.turn[0] + (TWIRL.turn[1] - TWIRL.turn[0]) * rand()) * (rand() < 0.5 ? -1 : 1);
    twirls.push({ centre, radius, turn });
  }
  return twirls;
}

const tw = new Vector3();

/** A direction turned through the twirls (mirrors twirl() in fields.glsl). `out` may alias `dir`. */
export function twirl(twirls: readonly Twirl[], dir: Vector3, out: Vector3): Vector3 {
  out.copy(dir);
  for (const t of twirls) {
    const c = t.centre;
    const cos = clamp(out.dot(c), -1, 1);
    const th = Math.acos(cos) / t.radius;
    const a = t.turn * Math.exp(-th * th);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    tw.crossVectors(c, out);
    out.multiplyScalar(ca).addScaledVector(tw, sa).addScaledVector(c, cos * (1 - ca));
  }
  return out;
}
const COLONY_EDGE = 0.06;
const DETAIL = 0.3;

/** Amplitude (per meter of roll) of a relief octave whose bumps are w meters apart. */
export function rollSpectrum(w: number): number {
  return smoothstep(14, 30, w) * (1 - smoothstep(120, 260, w)) * Math.sqrt(w / 60);
}

/** Amplitude (per meter of hummock) of a relief octave w meters apart. */
export function hummockSpectrum(w: number): number {
  return smoothstep(4.5, 7, w) * (1 - smoothstep(11, 19, w));
}

/** Inverse of the standard normal CDF (Acklam), for colony thresholds. */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q0 = clamp(p, 1e-6, 1 - 1e-6);
  if (q0 < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (q0 > 1 - 0.02425) return -normalQuantile(1 - q0);
  const q = q0 - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** The two octaves that bracket a pattern of `meters` on a planet of radius R. */
export interface OctavePair {
  /** Level of the coarser octave: frequency 2^level, noise seed offset level + 16. */
  level: number;
  /** Blend toward the finer octave. */
  t: number;
}

export function octavePair(radius: number, meters: number, out: OctavePair = { level: 0, t: 0 }): OctavePair {
  const level = Math.log2(radius / meters);
  out.level = Math.floor(level);
  out.t = level - out.level;
  return out;
}

export interface FieldParams {
  /** Rolling hills amplitude (m) and hummocks (m). */
  roll: number;
  hummocks: number;
  /** Share of the planet that is wetland, 0..1. */
  wetlands: number;
  /** Water table offset (m): raising it floods the hollows. */
  waterLevel: number;
  /** Elongation of hills and colonies along the grain, 0..1. */
  grain: number;
  /** Flowers per m² on average. */
  density: number;
  /** 0 = flowers evenly scattered; 1 = all in drifts, colonies and clumps over bare ground. */
  patchiness: number;
  /** Colony size (m); clumps are a sixth of it. */
  patchSize: number;
  /** Species weights: pink, star, yellow, blue (normalised here). */
  weights: readonly [number, number, number, number];
}

const wetSamples = new Map<number, Float32Array>();

/** Sorted wetness-noise values over a fixed spherical design: its quantiles turn coverage into a threshold. */
function wetDistribution(seed: number, fields: Fields): Float32Array {
  let sorted = wetSamples.get(seed);
  if (sorted) return sorted;
  const n = 4096;
  sorted = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const d = new Vector3();
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
    sorted[i] = fields.wetNoise(d);
  }
  sorted.sort();
  wetSamples.set(seed, sorted);
  return sorted;
}

/** Uniforms read by the bake (bake.frag.glsl, fields.glsl). */
export interface FieldUniforms {
  uFieldSeed: { value: number };
  /** Rolling-hill and hummock amplitude per octave (m). */
  uRelief: { value: Float32Array };
  uHummock: { value: Float32Array };
  /** Grain axis xyz, compression. */
  uGrain: { value: Vector4 };
  /** Wetness threshold, softness, lift (m), drop (m) = lift + sink. */
  uWet: { value: Vector4 };
  /** Water level (m), -, -, -. */
  uLevel: { value: Vector4 };
  /** Octave pairs (level, t): lush, variant. */
  uPatternA: { value: Vector4 };
  /** Octave pair (level, t): richness; -; patchiness. */
  uPatternB: { value: Vector4 };
  /** Octave pair (level, t): drifts; drift threshold; -. */
  uDrift: { value: Vector4 };
  /** Per species: density normalisation (the mean stays the density setting). */
  uSpeciesNorm: { value: Vector4 };
  uColonyLevel: { value: Vector4 };
  uColonyT: { value: Vector4 };
  uDetailLevel: { value: Vector4 };
  uDetailT: { value: Vector4 };
  uColonyThreshold: { value: Vector4 };
  uColonyCover: { value: Vector4 };
  /** Mean density per species (per m²). */
  uSpeciesDensity: { value: Vector4 };
  /** Twirls: centre xyz, turn (rad); and their angular radii. */
  uTwirl: { value: Vector4[] };
  uTwirlRadius: { value: Vector4 };
}

export function createFieldUniforms(): FieldUniforms {
  return {
    uFieldSeed: { value: 0 },
    uRelief: { value: new Float32Array(RELIEF_OCTAVES) },
    uHummock: { value: new Float32Array(RELIEF_OCTAVES) },
    uGrain: { value: new Vector4(0, 1, 0, 0) },
    uWet: { value: new Vector4(0, 0.1, 0, 0) },
    uLevel: { value: new Vector4() },
    uPatternA: { value: new Vector4() },
    uPatternB: { value: new Vector4() },
    uDrift: { value: new Vector4() },
    uSpeciesNorm: { value: new Vector4(1, 1, 1, 1) },
    uColonyLevel: { value: new Vector4() },
    uColonyT: { value: new Vector4() },
    uDetailLevel: { value: new Vector4() },
    uDetailT: { value: new Vector4() },
    uColonyThreshold: { value: new Vector4() },
    uColonyCover: { value: new Vector4(0.25, 0.25, 0.25, 0.25) },
    uSpeciesDensity: { value: new Vector4() },
    uTwirl: { value: Array.from({ length: TWIRLS }, () => new Vector4(0, 1, 0, 0)) },
    uTwirlRadius: { value: new Vector4(1, 1, 1, 1) },
  };
}

export class Fields {
  radius = 128;
  readonly relief = new Float32Array(RELIEF_OCTAVES);
  readonly hummock = new Float32Array(RELIEF_OCTAVES);
  /** Spread (m) of relief + hummocks; lift and sink are multiples of it. */
  reliefStd = 0;
  wetThreshold = 0;
  /** Half-width of the wetland margin in noise units: wide, so hills interlace with water across it. */
  wetSoftness = 0.2;
  lift = 0;
  drop = 0;
  level = 0;
  grainK = 0;
  readonly lushPair: OctavePair = { level: 0, t: 0 };
  readonly variantPair: OctavePair = { level: 0, t: 0 };
  readonly richPair: OctavePair = { level: 0, t: 0 };
  readonly driftPair: OctavePair = { level: 0, t: 0 };
  readonly clumpPair: OctavePair = { level: 0, t: 0 };
  driftThreshold = 0;
  clumpThreshold = 0;
  readonly speciesNorm = new Float32Array(4);
  readonly colonyPairs: OctavePair[] = COLONY_SCALE.map(() => ({ level: 0, t: 0 }));
  readonly detailPairs: OctavePair[] = COLONY_SCALE.map(() => ({ level: 0, t: 0 }));
  readonly colonyThreshold = new Float32Array(4);
  readonly colonyCover = new Float32Array(4);
  readonly speciesDensity = new Float32Array(4);
  patchiness = 0;
  readonly twirls: readonly Twirl[];
  private readonly st = new Vector3();
  private readonly td = new Vector3();

  constructor(
    readonly seed: number,
    /** Unit axis the hills and colonies run along (where it lies in the surface). */
    readonly grain: Vector3,
  ) {
    this.twirls = makeTwirls(seed);
  }

  /** Refresh everything that depends on R and the parameters (cheap). */
  update(radius: number, p: FieldParams): void {
    this.radius = radius;
    let var2 = 0;
    for (let k = 0; k < RELIEF_OCTAVES; k++) {
      const w = radius / (RELIEF_BASE_FREQ * 2 ** k);
      this.relief[k] = p.roll * rollSpectrum(w);
      this.hummock[k] = p.hummocks * hummockSpectrum(w);
      var2 += this.relief[k] ** 2 + this.hummock[k] ** 2;
    }
    this.reliefStd = NOISE_STD * Math.sqrt(var2);
    this.grainK = GRAIN_MAX * p.grain;
    const sorted = wetDistribution(this.seed, this);
    this.wetThreshold = sorted[Math.min(sorted.length - 1, Math.floor(clamp(1 - p.wetlands, 0, 1) * sorted.length))];
    if (p.wetlands <= 0) this.wetThreshold = 9;
    // uplands stand clear of the water (a kettle pond in the deepest hollows);
    // in a wetland the table sits near the middle of the relief: half land, half water
    this.lift = 1.9 * this.reliefStd + 0.05;
    this.drop = this.lift + 0.1 * this.reliefStd + 0.05;
    this.level = p.waterLevel;
    octavePair(radius, PATTERN.lush, this.lushPair);
    octavePair(radius, PATTERN.variant, this.variantPair);
    octavePair(radius, PATTERN.richness, this.richPair);
    octavePair(radius, PATTERN.drift, this.driftPair);
    octavePair(radius, p.patchSize * CLUMP_SCALE, this.clumpPair);
    this.driftThreshold = NOISE_STD * Math.hypot(1, 0.5) * normalQuantile(1 - DRIFT_COVER);
    this.clumpThreshold = NOISE_STD * normalQuantile(1 - CLUMP_COVER);
    const wsum = Math.max(p.weights[0] + p.weights[1] + p.weights[2] + p.weights[3], 1e-6);
    this.patchiness = p.patchiness;
    for (let s = 0; s < 4; s++) {
      const share = p.weights[s] / wsum;
      octavePair(radius, p.patchSize * COLONY_SCALE[s], this.colonyPairs[s]);
      octavePair(radius, (p.patchSize * COLONY_SCALE[s]) / 2.7, this.detailPairs[s]);
      const cover = 0.18 + 0.5 * share;
      this.colonyCover[s] = cover;
      this.colonyThreshold[s] = NOISE_STD * Math.sqrt(1 + DETAIL * DETAIL) * normalQuantile(1 - cover);
      this.speciesDensity[s] = p.density * share;
      const bare = 1 - p.patchiness;
      this.speciesNorm[s] = 1 / (bare + (1 - bare) * DRIFT_COVER * cover);
    }
  }

  /** Noise at dir·f, compressed along the grain. */
  private stretched(dir: Vector3, f: number, seed: number): number {
    const g = this.grain;
    const k = this.grainK * dir.dot(g);
    this.st.set((dir.x - g.x * k) * f, (dir.y - g.y * k) * f, (dir.z - g.z * k) * f);
    return gnoise(this.st.x, this.st.y, this.st.z, seed >>> 0);
  }

  /** A pattern at its two bracketing octaves, blended and renormalised (std stays NOISE_STD). */
  private pair(dir: Vector3, pr: OctavePair, base: number): number {
    const f0 = 2 ** pr.level;
    const a = this.stretched(dir, f0, this.seed + base + pr.level + 16);
    const b = this.stretched(dir, 2 * f0, this.seed + base + pr.level + 17);
    return (a * (1 - pr.t) + b * pr.t) / Math.sqrt((1 - pr.t) ** 2 + pr.t ** 2);
  }

  /** Rolling hills plus hummocks, the hummocks raised by `wet` (m). */
  reliefAt(dir: Vector3, wet: number): number {
    return this.reliefTwirled(twirl(this.twirls, dir, this.td), wet);
  }

  private reliefTwirled(dir: Vector3, wet: number): number {
    let h = 0;
    const lift = 1 + WET_HUMMOCKS * wet;
    for (let k = 0; k < RELIEF_OCTAVES; k++) {
      const amp = this.relief[k] + this.hummock[k] * lift;
      if (amp < 1e-4) continue;
      h += amp * this.stretched(dir, RELIEF_BASE_FREQ * 2 ** k, this.seed + SEED.relief + k);
    }
    return h;
  }

  /** The raw macro wetness noise (direction space, twirled and domain warped). */
  wetNoise(dir: Vector3): number {
    return this.wetTwirled(twirl(this.twirls, dir, this.td));
  }

  private wetTwirled(dir: Vector3): number {
    const s = this.seed;
    const wx = gnoise(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, (s + SEED.warp) >>> 0);
    const wy = gnoise(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, (s + SEED.warp + 1) >>> 0);
    const wz = gnoise(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, (s + SEED.warp + 2) >>> 0);
    const qx = dir.x * 1.7 + wx * 0.55;
    const qy = dir.y * 1.7 + wy * 0.55;
    const qz = dir.z * 1.7 + wz * 0.55;
    return 0.72 * gnoise(qx, qy, qz, (s + SEED.wet) >>> 0) + 0.28 * gnoise(qx * 2.2, qy * 2.2, qz * 2.2, (s + SEED.wet + 1) >>> 0);
  }

  /** 0 on dry upland, 1 deep in a wetland. */
  wetness(dir: Vector3): number {
    return this.wetnessTwirled(twirl(this.twirls, dir, this.td));
  }

  private wetnessTwirled(dir: Vector3): number {
    return smoothstep(this.wetThreshold - this.wetSoftness, this.wetThreshold + this.wetSoftness, this.wetTwirled(dir));
  }

  /** Ground height above the water table before the homestead and the banks (m). */
  natural(dir: Vector3): number {
    const t = twirl(this.twirls, dir, this.td);
    const wet = this.wetnessTwirled(t);
    const h = this.reliefTwirled(t, wet) + this.lift - this.drop * wet - this.level;
    return plateau(h, wet);
  }

  lush(dir: Vector3): number {
    return clamp(this.pair(twirl(this.twirls, dir, this.td), this.lushPair, SEED.lush) * 2.6, -1, 1);
  }

  /** Colony colour/size variant, 0..1. */
  variant(dir: Vector3): number {
    return 0.5 + 0.5 * clamp(this.pair(twirl(this.twirls, dir, this.td), this.variantPair, SEED.variant) * 2.8, -1, 1);
  }

  /**
   * Flowers per m² for each species at dir, from the drifts and colonies (the
   * baked part; clumps() multiplies in the clumps). Wetness is passed in, as
   * it is needed alongside.
   */
  flora(dir: Vector3, wet: number, out: Float32Array): Float32Array {
    dir = twirl(this.twirls, dir, this.td);
    const bare = 1 - this.patchiness;
    const d = this.pair(dir, this.driftPair, SEED.drift) + 0.5 * this.pair(dir, this.richPair, SEED.rich);
    const drift = smoothstep(this.driftThreshold - DRIFT_EDGE, this.driftThreshold + DRIFT_EDGE, d);
    for (let s = 0; s < 4; s++) {
      const c = this.pair(dir, this.colonyPairs[s], SEED.colony + s * 32) + DETAIL * this.pair(dir, this.detailPairs[s], SEED.detail + s * 32);
      const thr = this.colonyThreshold[s];
      const colony = smoothstep(thr - COLONY_EDGE, thr + COLONY_EDGE, c);
      out[s] = this.speciesDensity[s] * this.speciesNorm[s] * (bare + (1 - bare) * drift * colony) * damp(s, wet);
    }
    return out;
  }

  /** What clumps() needs, frozen (a tile built over several frames keeps the clumps it started with). */
  clumpSettings(): ClumpSettings {
    const p = this.patchiness;
    return { seed: this.seed, level: this.clumpPair.level, t: this.clumpPair.t, threshold: this.clumpThreshold, patchiness: p, peak: 1 + p * (CLUMP_FLOOR + (1 - CLUMP_FLOOR) / CLUMP_COVER - 1) };
  }

  writeUniforms(u: FieldUniforms): void {
    u.uFieldSeed.value = this.seed >>> 0;
    u.uRelief.value.set(this.relief);
    u.uHummock.value.set(this.hummock);
    u.uGrain.value.set(this.grain.x, this.grain.y, this.grain.z, this.grainK);
    u.uWet.value.set(this.wetThreshold, this.wetSoftness, this.lift, this.drop);
    u.uLevel.value.set(this.level, 0, 0, 0);
    u.uPatternA.value.set(this.lushPair.level, this.lushPair.t, this.variantPair.level, this.variantPair.t);
    u.uPatternB.value.set(this.richPair.level, this.richPair.t, 0, this.patchiness);
    u.uDrift.value.set(this.driftPair.level, this.driftPair.t, this.driftThreshold, 0);
    u.uSpeciesNorm.value.fromArray(this.speciesNorm);
    const cp = this.colonyPairs;
    const dp = this.detailPairs;
    u.uColonyLevel.value.set(cp[0].level, cp[1].level, cp[2].level, cp[3].level);
    u.uColonyT.value.set(cp[0].t, cp[1].t, cp[2].t, cp[3].t);
    u.uDetailLevel.value.set(dp[0].level, dp[1].level, dp[2].level, dp[3].level);
    u.uDetailT.value.set(dp[0].t, dp[1].t, dp[2].t, dp[3].t);
    u.uColonyThreshold.value.fromArray(this.colonyThreshold);
    u.uColonyCover.value.fromArray(this.colonyCover);
    u.uSpeciesDensity.value.fromArray(this.speciesDensity);
    this.twirls.forEach((t, i) => {
      u.uTwirl.value[i].set(t.centre.x, t.centre.y, t.centre.z, t.turn);
      u.uTwirlRadius.value.setComponent(i, t.radius);
    });
  }
}

export interface ClumpSettings {
  seed: number;
  level: number;
  t: number;
  threshold: number;
  patchiness: number;
  /** The most clumps() can multiply by. */
  peak: number;
}

/**
 * The clumps at dir: a factor per species on Fields.flora (1 on average).
 * Two noises a couple of meters across; pink clumps where the first is high,
 * stars where the second is, buttons and blues where they are low, so pink
 * and stars mix, pink and buttons never share a clump. Mirrors clumpsAt() in
 * meadow.glsl (unstretched noise: the surface shader has no grain axis).
 */
export function clumps(c: ClumpSettings, dir: Vector3, out: Float32Array): Float32Array {
  const f0 = 2 ** c.level;
  const s = (c.seed + SEED.clump + c.level + 16) >>> 0;
  const norm = 1 / Math.sqrt((1 - c.t) ** 2 + c.t ** 2);
  const at = (seed: number, f: number): number => gnoise(dir.x * f, dir.y * f, dir.z * f, seed >>> 0);
  const a = (at(s, f0) * (1 - c.t) + at(s + 1, 2 * f0) * c.t) * norm;
  const b = (at(s + 64, f0) * (1 - c.t) + at(s + 65, 2 * f0) * c.t) * norm;
  const thr = c.threshold;
  const k = (n: number): number => 1 + c.patchiness * (CLUMP_FLOOR + ((1 - CLUMP_FLOOR) * smoothstep(thr - CLUMP_EDGE, thr + CLUMP_EDGE, n)) / CLUMP_COVER - 1);
  out[0] = k(a);
  out[1] = k(b);
  out[2] = k(-a);
  out[3] = k(-b);
  return out;
}

/** Wetland ground flattened toward a plateau just above the water (mirrors bake.frag.glsl). */
export function plateau(h: number, wet: number): number {
  const s = WET_PLATEAU.height;
  return h + (s * Math.tanh(h / s) + WET_PLATEAU.keep * h - h) * wet;
}

/** How much each species likes damp ground (wetness 0..1); about 1 on average. */
export function damp(species: number, wet: number): number {
  switch (species) {
    case 0:
      return 0.7 + 0.8 * wet;
    case 1:
      return 1.1 - 0.3 * wet;
    case 2:
      return 1.15 - 0.45 * wet;
    default:
      return 0.9 + 0.25 * wet;
  }
}

