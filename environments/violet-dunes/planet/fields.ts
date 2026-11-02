import { Vector3, Vector4 } from 'three';
import { clamp, smoothstep } from '../../../src/core/math';
import { gnoise } from '../../../src/planet/noise';

// Violet Dunes fields in rest space. The terrain bake (bake.frag.glsl)
// evaluates them on the GPU into two cube maps; `Fields` evaluates the same
// math on the CPU (picking, placement, flower assignment, tests). Change both
// together.
//
//   dunes      direction-space octaves weighted by their size in meters, in a
//              band about an octave wide set by the crest spacing, compressed
//              along a grain axis so crests run long. A soft ridge turns the noise's zero
//              contours into crests (rounded, so their curvature stays small
//              enough for the bake to carry them within 2 cm), and a soft floor
//              turns the troughs into flat interdune sand. The band is the same
//              in meters at every R, so crests rise and subside in place as the
//              planet grows, never slide
//   swell      broad octaves (40–250 m) under the dunes: the landform from orbit
//   habitat    a macro field in direction space (domain warped): where slate
//              breaks through and the sail-reeds and starflowers live. The dunes
//              are calmer there. Its threshold is read off the field's own
//              distribution, so `habitat` is the share of the planet it covers
//   height     BASE + dunes·(1 − calm·habitat) + swell (m). BASE keeps every
//              height above half a meter: nothing anywhere reads as water
//   patterns   sand tone and colour variant: meter-sized noise, sampled at the
//              two direction-space octaves that bracket their size (seeded by
//              octave, so a pattern never jumps as R grows)
//   clusters   where in the habitat the slate and sail-reeds gather: a
//              direction-space mask (like the habitat, so a cluster keeps its
//              place and its stones as the planet grows; its size in meters
//              grows with R, its density per m² doesn't), times the habitat
//   flora      starflowers per m² in channel 1, in the habitat, in drifts,
//              with clumps a couple of meters wide; the clusters in channel 0
//              (the far paint's wash, where the stones and plants stand)

export const RELIEF_OCTAVES = 9;
export const RELIEF_BASE_FREQ = 1.6;
/** Spread (std) of gnoise; the normalised octave pairs keep it. */
export const NOISE_STD = 0.27;
/** Dune profile: crest rounding (noise std units: crest curvature ∝ 1/ridge), the interdune floor and its softness. */
export const DUNE = { ridge: 0.42, floor: -0.85, floorSoft: 0.55 } as const;
/** Dunes are this much calmer (× (1 − k·habitat)) where the habitat is. */
export const HABITAT_CALM = 0.6;
/** Every height sits on this base (m), so the ground never dips toward the old water table at 0. */
export const BASE = 3.2;
/** Grain compression at grain = 1 (crests run ≈ 4× longer than they are apart). */
const GRAIN_MAX = 0.75;
/** Pattern sizes (m). */
export const PATTERN = { tone: 22, variant: 16, drift: 9 } as const;
/** Share of the habitat in starflower drifts, and of a drift's ground in clumps. */
export const DRIFT_COVER = 0.5;
export const CLUMP_COVER = 0.3;
/** Clump size × the patch size; what is left between the clumps of a drift (× a clump's density there). */
export const CLUMP_SCALE = 0.17;
export const CLUMP_FLOOR = 0.06;
const DRIFT_EDGE = 0.07;
const CLUMP_EDGE = 0.05;
/** Starflowers outside the habitat (× the density there). */
const STRAY = 0.04;
/** The clusters: their direction-space frequency (about 11 m across at R 128) and the share of the habitat they cover. */
export const CLUSTERS = { freq: 12, fine: 29, cover: 0.28, edge: 0.055 } as const;
/** The habitat share the home is placed against (the layout depends on the seed only, not the slider). */
export const LAYOUT_HABITAT = 0.3;
/** Seeds (added to the world's noise seed). */
const SEED = { dune: 0, swell: 40, warp: 31, habitat: 34, tone: 170, variant: 190, drift: 230, cluster: 250, clump: 400 } as const;
/** Spread of the cluster noise (two gnoise octaves, 0.7 and 0.3). */
const CLUSTER_STD = NOISE_STD * Math.hypot(0.7, 0.3);

/** Crests (the noise's zero contours) come this many times the octave's bump size apart (measured). */
const CRESTS_PER_BUMP = 0.78;

/** Weight (before normalising) of a dune octave whose bumps are w meters apart: a band about an octave wide around the size that puts crests `spacing` apart. */
export function duneSpectrum(w: number, spacing: number): number {
  const x = Math.log2((w * CRESTS_PER_BUMP) / spacing) / 0.5;
  return Math.exp(-0.5 * x * x);
}

/** Amplitude (per meter of swell) of an octave w meters apart. */
export function swellSpectrum(w: number): number {
  return smoothstep(30, 60, w) * (1 - smoothstep(160, 300, w));
}

/** The dune profile of normalised noise u: a soft ridge on its zero contour, a soft floor in the troughs (mirrors fields.glsl). */
export function duneProfile(u: number): number {
  const ridge = 1 - Math.sqrt(u * u + DUNE.ridge * DUNE.ridge);
  const d = ridge - DUNE.floor;
  return 0.5 * (ridge + DUNE.floor + Math.sqrt(d * d + DUNE.floorSoft * DUNE.floorSoft));
}

/** The profile's crest (at u = 0), and its height above the interdune floor per unit of dune amplitude. */
const DUNE_CREST = duneProfile(0);
const DUNE_SPAN = DUNE_CREST - DUNE.floor;

/** Inverse of the standard normal CDF (Acklam), for pattern thresholds. */
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
  /** Crest height above the interdune floor (m). */
  dunes: number;
  /** Distance between crests (m). */
  spacing: number;
  /** Broad swell under the dunes (m per octave). */
  swell: number;
  /** Share of the planet where slate, sail-reeds and starflowers are, 0..1. */
  habitat: number;
  /** Elongation of the crests along the grain, 0..1. */
  grain: number;
  /** Starflowers per m² on average over the habitat. */
  density: number;
  /** 0 = starflowers evenly over the habitat; 1 = all in drifts and clumps. */
  patchiness: number;
  /** Drift size (m); clumps are a sixth of it. */
  patchSize: number;
}

const habitatSamples = new Map<number, Float32Array>();

/** Sorted habitat-noise values over a fixed spherical design: its quantiles turn a share into a threshold. */
function habitatDistribution(fields: Fields): Float32Array {
  let sorted = habitatSamples.get(fields.seed);
  if (sorted) return sorted;
  const n = 4096;
  sorted = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const d = new Vector3();
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
    sorted[i] = fields.habitatNoise(d);
  }
  sorted.sort();
  habitatSamples.set(fields.seed, sorted);
  return sorted;
}

/** The habitat-noise value that a share of the planet lies above. */
export function habitatThreshold(fields: Fields, share: number): number {
  if (share <= 0) return 9;
  const sorted = habitatDistribution(fields);
  return sorted[Math.min(sorted.length - 1, Math.floor(clamp(1 - share, 0, 1) * sorted.length))];
}

/** Uniforms read by the bake (bake.frag.glsl, fields.glsl). */
export interface FieldUniforms {
  uFieldSeed: { value: number };
  /** Dune octave weights (normalised: the dune noise keeps NOISE_STD) and swell amplitudes (m). */
  uDune: { value: Float32Array };
  uSwell: { value: Float32Array };
  /** Grain axis xyz, compression. */
  uGrain: { value: Vector4 };
  /** Habitat threshold, softness, calm, dune amplitude (m). */
  uHabitat: { value: Vector4 };
  /** Octave pairs (level, t): sand tone, variant. */
  uPatternA: { value: Vector4 };
  /** Octave pair (level, t): drifts; drift threshold; patchiness. */
  uDrift: { value: Vector4 };
  /** Starflowers: density, normalisation; the clusters' threshold and edge. */
  uStar: { value: Vector4 };
}

export function createFieldUniforms(): FieldUniforms {
  return {
    uFieldSeed: { value: 0 },
    uDune: { value: new Float32Array(RELIEF_OCTAVES) },
    uSwell: { value: new Float32Array(RELIEF_OCTAVES) },
    uGrain: { value: new Vector4(0, 1, 0, 0) },
    uHabitat: { value: new Vector4(0, 0.1, HABITAT_CALM, 0) },
    uPatternA: { value: new Vector4() },
    uDrift: { value: new Vector4() },
    uStar: { value: new Vector4() },
  };
}

export class Fields {
  radius = 128;
  readonly dune = new Float32Array(RELIEF_OCTAVES);
  readonly swell = new Float32Array(RELIEF_OCTAVES);
  /** Dune amplitude (m): the profile's span times this is the crest height over the floor. */
  duneAmp = 0;
  /** Spread (m) of the swell. */
  swellStd = 0;
  habitatThreshold = 0;
  /** Half-width of the habitat margin in noise units. */
  habitatSoftness = 0.18;
  grainK = 0;
  readonly tonePair: OctavePair = { level: 0, t: 0 };
  readonly variantPair: OctavePair = { level: 0, t: 0 };
  readonly driftPair: OctavePair = { level: 0, t: 0 };
  readonly clumpPair: OctavePair = { level: 0, t: 0 };
  driftThreshold = 0;
  clumpThreshold = 0;
  patchiness = 0;
  starDensity = 0;
  starNorm = 1;
  readonly clusterThreshold = CLUSTER_STD * normalQuantile(1 - CLUSTERS.cover);
  /** Kept for the four-channel flower code: mean starflowers per m² per channel. */
  readonly speciesDensity = new Float32Array(4);
  private readonly st = new Vector3();

  constructor(
    readonly seed: number,
    /** Unit axis the crests run along (where it lies in the surface). */
    readonly grain: Vector3,
  ) {}

  /** Refresh everything that depends on R and the parameters (cheap). */
  update(radius: number, p: FieldParams): void {
    this.radius = radius;
    let dune2 = 0;
    let swell2 = 0;
    for (let k = 0; k < RELIEF_OCTAVES; k++) {
      const w = radius / (RELIEF_BASE_FREQ * 2 ** k);
      this.dune[k] = duneSpectrum(w, p.spacing);
      this.swell[k] = p.swell * swellSpectrum(w);
      dune2 += this.dune[k] ** 2;
      swell2 += this.swell[k] ** 2;
    }
    // the dune noise keeps one spread at every R (its band is always covered by an octave or two)
    const norm = dune2 > 0 ? 1 / Math.sqrt(dune2) : 0;
    for (let k = 0; k < RELIEF_OCTAVES; k++) this.dune[k] = this.dune[k] < 1e-3 ? 0 : this.dune[k] * norm;
    this.duneAmp = p.dunes / DUNE_SPAN;
    this.swellStd = NOISE_STD * Math.sqrt(swell2);
    this.grainK = GRAIN_MAX * p.grain;
    this.habitatThreshold = habitatThreshold(this, p.habitat);
    octavePair(radius, PATTERN.tone, this.tonePair);
    octavePair(radius, PATTERN.variant, this.variantPair);
    octavePair(radius, p.patchSize, this.driftPair);
    octavePair(radius, p.patchSize * CLUMP_SCALE, this.clumpPair);
    this.driftThreshold = NOISE_STD * normalQuantile(1 - DRIFT_COVER);
    this.clumpThreshold = NOISE_STD * normalQuantile(1 - CLUMP_COVER);
    this.patchiness = p.patchiness;
    this.starDensity = p.density;
    const bare = 1 - p.patchiness;
    this.starNorm = 1 / (bare + (1 - bare) * DRIFT_COVER);
    this.speciesDensity.set([0, p.density * Math.max(p.habitat, 0.05), 0, 0]);
  }

  /** Highest the natural ground can stand (m): the base, the highest crest, four swell spreads. */
  get maxHeight(): number {
    return BASE + this.duneAmp * DUNE_CREST + 4 * this.swellStd;
  }

  /** Lowest it can sit (m). */
  get minHeight(): number {
    return BASE + this.duneAmp * DUNE.floor - 4 * this.swellStd;
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

  /** The dune noise, normalised to unit spread. */
  duneNoise(dir: Vector3): number {
    let n = 0;
    let f = RELIEF_BASE_FREQ;
    for (let k = 0; k < RELIEF_OCTAVES; k++, f *= 2) if (this.dune[k] > 0) n += this.dune[k] * this.stretched(dir, f, this.seed + SEED.dune + k);
    return n / NOISE_STD;
  }

  /** The broad swell (m). */
  swellAt(dir: Vector3): number {
    let h = 0;
    let f = RELIEF_BASE_FREQ;
    for (let k = 0; k < RELIEF_OCTAVES; k++, f *= 2) if (this.swell[k] >= 1e-4) h += this.swell[k] * this.stretched(dir, f, this.seed + SEED.swell + k);
    return h;
  }

  /** The raw macro habitat noise (direction space, domain warped). */
  habitatNoise(dir: Vector3): number {
    const s = this.seed;
    const wx = gnoise(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, (s + SEED.warp) >>> 0);
    const wy = gnoise(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, (s + SEED.warp + 1) >>> 0);
    const wz = gnoise(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, (s + SEED.warp + 2) >>> 0);
    const qx = dir.x * 1.7 + wx * 0.55;
    const qy = dir.y * 1.7 + wy * 0.55;
    const qz = dir.z * 1.7 + wz * 0.55;
    return 0.72 * gnoise(qx, qy, qz, (s + SEED.habitat) >>> 0) + 0.28 * gnoise(qx * 2.2, qy * 2.2, qz * 2.2, (s + SEED.habitat + 1) >>> 0);
  }

  /** 0 on open dunes, 1 deep in the habitat. */
  habitat(dir: Vector3): number {
    return smoothstep(this.habitatThreshold - this.habitatSoftness, this.habitatThreshold + this.habitatSoftness, this.habitatNoise(dir));
  }

  /** Ground height before the homestead (m above the base sphere). */
  natural(dir: Vector3): number {
    const calm = 1 - HABITAT_CALM * this.habitat(dir);
    return BASE + this.duneAmp * duneProfile(this.duneNoise(dir)) * calm + this.swellAt(dir);
  }

  /** Sand tone, −1..1 (the bake's lushness channel). */
  tone(dir: Vector3): number {
    return clamp(this.pair(dir, this.tonePair, SEED.tone) * 2.6, -1, 1);
  }

  /** Colour variant, 0..1. */
  variant(dir: Vector3): number {
    return 0.5 + 0.5 * clamp(this.pair(dir, this.variantPair, SEED.variant) * 2.8, -1, 1);
  }

  /** Where the slate and sail-reeds gather, 0..1: the cluster mask (direction space) times the habitat. */
  clusters(dir: Vector3, habitat: number): number {
    if (habitat <= 0) return 0;
    const s = this.seed;
    const f = CLUSTERS.freq;
    const g = CLUSTERS.fine;
    const n = 0.7 * gnoise(dir.x * f, dir.y * f, dir.z * f, (s + SEED.cluster) >>> 0) + 0.3 * gnoise(dir.x * g, dir.y * g, dir.z * g, (s + SEED.cluster + 1) >>> 0);
    return habitat * smoothstep(this.clusterThreshold - CLUSTERS.edge, this.clusterThreshold + CLUSTERS.edge, n);
  }

  /**
   * Starflowers per m² at dir in channel 1, from the habitat and the drifts
   * (the baked part; clumps() multiplies in the clumps); the clusters in
   * channel 0; 2 and 3 empty.
   */
  flora(dir: Vector3, habitat: number, out: Float32Array): Float32Array {
    const bare = 1 - this.patchiness;
    const d = this.pair(dir, this.driftPair, SEED.drift);
    const drift = smoothstep(this.driftThreshold - DRIFT_EDGE, this.driftThreshold + DRIFT_EDGE, d);
    out[0] = this.clusters(dir, habitat);
    out[1] = this.starDensity * this.starNorm * (bare + (1 - bare) * drift) * (STRAY + (1 - STRAY) * habitat);
    out[2] = 0;
    out[3] = 0;
    return out;
  }

  /** What clumps() needs, frozen (a tile built over several frames keeps the clumps it started with). */
  clumpSettings(): ClumpSettings {
    const p = this.patchiness;
    return { seed: this.seed, level: this.clumpPair.level, t: this.clumpPair.t, threshold: this.clumpThreshold, patchiness: p, peak: 1 + p * (CLUMP_FLOOR + (1 - CLUMP_FLOOR) / CLUMP_COVER - 1) };
  }

  writeUniforms(u: FieldUniforms): void {
    u.uFieldSeed.value = this.seed >>> 0;
    u.uDune.value.set(this.dune);
    u.uSwell.value.set(this.swell);
    u.uGrain.value.set(this.grain.x, this.grain.y, this.grain.z, this.grainK);
    u.uHabitat.value.set(this.habitatThreshold, this.habitatSoftness, HABITAT_CALM, this.duneAmp);
    u.uPatternA.value.set(this.tonePair.level, this.tonePair.t, this.variantPair.level, this.variantPair.t);
    u.uDrift.value.set(this.driftPair.level, this.driftPair.t, this.driftThreshold, this.patchiness);
    u.uStar.value.set(this.starDensity, this.starNorm, this.clusterThreshold, CLUSTERS.edge);
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
 * The clumps at dir: a factor per channel on Fields.flora (1 on average).
 * Two noises a couple of meters across. Mirrors clumpsAt() in meadow.glsl
 * (unstretched noise: the surface shader has no grain axis).
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
