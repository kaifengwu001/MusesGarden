import { DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3, Vector4 } from 'three';
import { hash32, mix, salt, unit } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { uvToSphere } from '../planet/cubesphere';
import { makeTwirls, normalQuantile, octavePair, twirl, type OctavePair, type Twirl } from '../planet/fields';
import { gnoise } from '../planet/noise';
import { enumerateCell } from '../planet/rest';

// The terraces' fields in rest space, as the meadow's are (planet/fields.ts):
// the bake (bake.frag.glsl) evaluates them on the GPU into two cube maps and
// `TerraceFields` evaluates the same math on the CPU (the camera, picking,
// placement, tests). Change both together.
//
//   hills      direction-space octaves weighted by their size in meters, so
//              the hills keep their size as R grows; twirled and drawn out a
//              little along a grain axis, so ridges and spurs swirl; finer
//              octaves down to a few meters, small, so the contours (and the
//              terraces along them) turn a little as hillsides do
//   valleys    the hills' hollows flattened (a soft floor), so the valleys
//              are broad and level, paddies from side to side
//   peaks      karst towers: a progressive point set (a constant number per
//              km² as the planet grows, born in rank order), kept where a
//              macro range field allows them; steep round-topped towers on a
//              wide skirt, a few meters to ~50 m tall
//   wild       what is left to the forest, as the Hani terraces keep it: the
//              hilltops (crowns: where the hills' finer octaves stand well
//              above their surroundings, high over the valley floors), the
//              gullies (well below them, on a slope), slopes too steep to
//              terrace, the peaks, and stretches of whole hillside (woods: a
//              share of the hills, by a macro noise)
//   flat       where the valleys' floors are flat enough that the fields
//              are plots, not terraces along the contours (the hills
//              well under their soft floor)
//   life       the fog's two drifting layers, the season's spread over the
//              hillsides and the paddies' colour regions (the second bake)

export const HILL_OCTAVES = 8;
export const HILL_BASE_FREQ = 1.2;
/** Spread (std) of gnoise; the normalised octave pairs keep it. */
export const NOISE_STD = 0.27;
/** Grain compression (hills run about 1.5× longer than wide). */
const GRAIN = 0.4;
/** Pattern sizes (m). */
export const PATTERN = { forest: 110, forestDetail: 38, fogA: 55, fogB: 150, season: 80, region: 34 } as const;
/** How much the forest's detail octave adds to its broad one. */
export const FOREST_DETAIL = 0.45;
/** Seeds (added to the world's noise seed). */
const SEED = { hills: 600, forest: 640, forestDetail: 650, fogA: 680, fogB: 690, season: 700, region: 710, range: 720, twirl: 730 } as const;

/** The terraces' cells (cells.glsl, cells.ts): about this wide (m), their lattice warped by this much (in cells); a cell's frame read this far (m) either side of its middle. */
export const CELLS = { meters: 56, warp: 0.6, frame: 6 } as const;

/** The cells' lattice frequency in direction space at R (a power of two: they re-tile only an octave apart). */
export function cellFrequency(radius: number): number {
  return 2 ** Math.round(Math.log2(radius / CELLS.meters));
}

/** Karst peaks: per m² (before the ranges keep some), the share of the planet in ranges, and their sizes. */
export const PEAKS = { density: 1 / 3200, ranges: 0.32, height: [16, 54], radius: [13, 27], max: 96 } as const;
export const peakClass = { salt: salt('karst peaks'), jitter: 0.9 } as const;

/** Where the land use turns wild: crowns and gullies in spreads of the hills' local relief, the hilltops' least height (m), the steepest terrace. */
export const WILD = { crown: [0.7, 1.1], crownHeight: [5, 9], gully: [-0.85, -1.25], gullySlope: [0.1, 0.22], steep: [0.72, 0.86] } as const;

export interface TerraceFieldParams {
  /** Hill amplitude (m). */
  hills: number;
  /** Share of the terraceable hills left to forest, 0..1. */
  forest: number;
}

export interface Peak {
  readonly dir: Vector3;
  /** Height (m) and base radius (m). */
  readonly height: number;
  readonly radius: number;
}

/** The finer octaves' amplitude at 30 m (per meter of hills), falling as (w / 30)^1.3 below it to a few meters. */
export const HILL_DETAIL = 0.155;

/** Amplitude (per meter of hills) of an octave whose bumps are w meters apart. */
export function hillSpectrum(w: number): number {
  const broad = smoothstep(14, 30, w) * (1 - smoothstep(220, 420, w)) * Math.sqrt(w / 90);
  // (the small turns of a hillside, a few meters to a couple of dozen: a contour wanders about a meter on a terraced slope)
  const fine = HILL_DETAIL * (w / 30) ** 1.3 * smoothstep(2.5, 5, w);
  return Math.max(broad, fine);
}

/** The valleys' flat floors: the hills this far under their soft floor (in its softness) are plots, not terraces (fully by the first). */
export const FLAT = [-1.7, -0.7] as const;

/**
 * A karst tower's profile at s = distance / base radius: a round top on
 * steep sides (a super-Gaussian), standing on a wide, low skirt.
 */
export function peakProfile(s: number): number {
  const q = s / 0.66;
  return Math.exp(-q * q * q) + 0.16 * Math.exp(-((s / 1.35) ** 2));
}

/** How far out (× the base radius) a peak still rises: past it, it is left out. */
export const PEAK_REACH = 2.6;

/** Uniforms read by the terraces' bake (fields.glsl). */
export interface TerraceFieldUniforms {
  /** The planet's radius (m): the peaks and the slope are measured in meters. */
  uRadius: { value: number };
  uTSeed: { value: number };
  uHill: { value: Float32Array };
  /** Grain axis xyz, compression. */
  uTGrain: { value: Vector4 };
  /** Valley floor (m), its softness (m), the spread of the hills' local relief (m), -. */
  uTFloor: { value: Vector4 };
  /** Forest threshold, its softness, steepest terraced slope (start, full). */
  uTForest: { value: Vector4 };
  /** Octave pairs (level, t): forest, forest detail. */
  uTPairsA: { value: Vector4 };
  /** The flat floors' edge (FLAT); octave pair: region. */
  uTPairsB: { value: Vector4 };
  /** Octave pairs: fog A, fog B. */
  uTPairsC: { value: Vector4 };
  /** Octave pair: season; -. */
  uTPairsD: { value: Vector4 };
  uPeaks: { value: DataTexture | null };
  uPeakCount: { value: number };
  uTTwirl: { value: Vector4[] };
  uTTwirlRadius: { value: Vector4 };
  /** The cells: lattice frequency, warp, the frame's half step (m). */
  uCells: { value: Vector4 };
}

export function createTerraceFieldUniforms(): TerraceFieldUniforms {
  return {
    uRadius: { value: 128 },
    uTSeed: { value: 0 },
    uHill: { value: new Float32Array(HILL_OCTAVES) },
    uTGrain: { value: new Vector4(0, 1, 0, 0) },
    uTFloor: { value: new Vector4() },
    uTForest: { value: new Vector4() },
    uTPairsA: { value: new Vector4() },
    uTPairsB: { value: new Vector4() },
    uTPairsC: { value: new Vector4() },
    uTPairsD: { value: new Vector4() },
    uPeaks: { value: null },
    uPeakCount: { value: 0 },
    uTTwirl: { value: Array.from({ length: 4 }, () => new Vector4(0, 1, 0, 0)) },
    uTTwirlRadius: { value: new Vector4(1, 1, 1, 1) },
    uCells: { value: new Vector4(2, CELLS.warp, CELLS.frame, 0) },
  };
}

const tw = new Vector3();
const hillOut = { total: 0, local: 0 };

export interface WildParts {
  woods: number;
  steep: number;
  crown: number;
  gully: number;
  tower: number;
}
const wildOut: WildParts = { woods: 0, steep: 0, crown: 0, gully: 0, tower: 0 };
const landBase: TerraceBase = { natural: 0, slope: 0, wild: 0, flat: 0 };
const baseTw = new Vector3();
const d1 = new Vector3();
const d2 = new Vector3();
const t1 = new Vector3();
const t2 = new Vector3();
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
/** The finite-difference step (m) of the baked slope; the CPU uses the same. */
export const SLOPE_STEP = 1.5;

/** Everything the bake writes for one direction (pass 0). */
export interface TerraceBase {
  natural: number;
  slope: number;
  wild: number;
  /** 0 on the hills … 1 on a valley's flat floor (plots, not terraces). */
  flat: number;
}

export class TerraceFields {
  radius = 128;
  readonly hill = new Float32Array(HILL_OCTAVES);
  hillStd = 1;
  /** Spread (m) of the hills' finer octaves (their local relief: crests above it, gullies below). */
  localStd = 1;
  floor = 0;
  floorSoft = 1;
  forestThreshold = 0;
  forestSoft = 0.05;
  readonly steep = WILD.steep;
  readonly forestPair: OctavePair = { level: 0, t: 0 };
  readonly forestDetailPair: OctavePair = { level: 0, t: 0 };
  readonly regionPair: OctavePair = { level: 0, t: 0 };
  readonly fogAPair: OctavePair = { level: 0, t: 0 };
  readonly fogBPair: OctavePair = { level: 0, t: 0 };
  readonly seasonPair: OctavePair = { level: 0, t: 0 };
  readonly twirls: readonly Twirl[];
  /** Peaks born on the planet at this size, in birth order (at most PEAKS.max). */
  peaks: Peak[] = [];
  readonly peakTexture: DataTexture;
  private peaksFor = '';
  private readonly st = new Vector3();

  constructor(
    readonly seed: number,
    readonly grain: Vector3,
  ) {
    this.twirls = makeTwirls((seed + SEED.twirl) >>> 0);
    this.peakTexture = new DataTexture(new Float32Array(2 * PEAKS.max * 4), 2, PEAKS.max, RGBAFormat, FloatType);
    this.peakTexture.minFilter = NearestFilter;
    this.peakTexture.magFilter = NearestFilter;
  }

  /** Refresh everything that depends on R and the parameters (cheap, but for the peaks once per size). */
  update(radius: number, p: TerraceFieldParams): void {
    this.radius = radius;
    let var2 = 0;
    for (let k = 0; k < HILL_OCTAVES; k++) {
      const w = radius / (HILL_BASE_FREQ * 2 ** k);
      this.hill[k] = p.hills * hillSpectrum(w);
      var2 += this.hill[k] ** 2;
    }
    this.hillStd = Math.max(NOISE_STD * Math.sqrt(var2), 1e-3);
    this.localStd = Math.max(NOISE_STD * Math.sqrt(var2 - this.hill[0] ** 2), 1e-3);
    // the lowest third of the hills levels out into broad valley floors
    this.floor = -0.42 * this.hillStd;
    this.floorSoft = 0.3 * this.hillStd;
    this.forestThreshold = NOISE_STD * Math.hypot(1, FOREST_DETAIL) * normalQuantile(1 - clamp(p.forest, 0, 1));
    if (p.forest <= 0) this.forestThreshold = 9;
    octavePair(radius, PATTERN.forest, this.forestPair);
    octavePair(radius, PATTERN.forestDetail, this.forestDetailPair);
    octavePair(radius, PATTERN.region, this.regionPair);
    octavePair(radius, PATTERN.fogA, this.fogAPair);
    octavePair(radius, PATTERN.fogB, this.fogBPair);
    octavePair(radius, PATTERN.season, this.seasonPair);
    this.placePeaks(radius);
  }

  /**
   * The peaks born at this size: the point set's points with ρR² past their
   * birth density, kept where the ranges are. Their directions never move;
   * as the planet grows new ones are born between them.
   */
  private placePeaks(radius: number): void {
    const key = `${this.seed}/${radius.toFixed(3)}`;
    if (key === this.peaksFor) return;
    this.peaksFor = key;
    const sigmaMax = PEAKS.density * radius * radius;
    const found: Array<{ dir: Vector3; threshold: number; seed: number }> = [];
    const d = new Vector3();
    const rangeThreshold = NOISE_STD * Math.hypot(1, 0.5) * normalQuantile(1 - PEAKS.ranges);
    for (let face = 0; face < 6; face++) {
      enumerateCell(peakClass, this.seed, face, 0, 0, 0, sigmaMax, (pt) => {
        uvToSphere(pt.face, pt.u, pt.v, d);
        if (this.range(d) < rangeThreshold) return;
        found.push({ dir: d.clone(), threshold: pt.threshold, seed: pt.seed });
      });
    }
    found.sort((a, b) => a.threshold - b.threshold);
    this.peaks = found.slice(0, PEAKS.max).map((f) => {
      const h = hash32(f.seed);
      // a few tall towers, many small ones
      const tall = unit(h) ** 1.6;
      return {
        dir: f.dir,
        height: PEAKS.height[0] + (PEAKS.height[1] - PEAKS.height[0]) * tall,
        radius: PEAKS.radius[0] + (PEAKS.radius[1] - PEAKS.radius[0]) * (0.35 * unit(mix(h, 1)) + 0.65 * tall),
      };
    });
    const data = this.peakTexture.image.data as Float32Array;
    data.fill(0);
    this.peaks.forEach((pk, i) => {
      data.set([pk.dir.x, pk.dir.y, pk.dir.z, pk.height], i * 8);
      // radius, cos of the reach angle
      data.set([pk.radius, Math.cos(Math.min(Math.PI, (PEAK_REACH * pk.radius) / radius)), 0, 0], i * 8 + 4);
    });
    this.peakTexture.needsUpdate = true;
  }

  /** The macro field that says where peaks may stand (direction space: ranges stay put as R grows). */
  range(dir: Vector3): number {
    const s = this.seed + SEED.range;
    return gnoise(dir.x * 1.9, dir.y * 1.9, dir.z * 1.9, s >>> 0) + 0.5 * gnoise(dir.x * 4.3, dir.y * 4.3, dir.z * 4.3, (s + 1) >>> 0);
  }

  /** Noise at dir·f, compressed along the grain. */
  private stretched(dir: Vector3, f: number, seed: number): number {
    const g = this.grain;
    const k = GRAIN * dir.dot(g);
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

  /** The hills' raw height at a twirled direction (m, mean 0). */
  private hillsTwirled(t: Vector3): number {
    return this.hillParts(t).total;
  }

  /** The hills' raw height (m, mean 0) and their local relief: the part of it in the finer octaves. */
  private hillParts(t: Vector3): { total: number; local: number } {
    let h = 0;
    let local = 0;
    for (let k = 0; k < HILL_OCTAVES; k++) {
      if (this.hill[k] < 1e-4) continue;
      const v = this.hill[k] * this.stretched(t, HILL_BASE_FREQ * 2 ** k, this.seed + SEED.hills + k);
      h += v;
      if (k > 0) local += v;
    }
    hillOut.total = h;
    hillOut.local = local;
    return hillOut;
  }

  /** The hills on their valley floor: a soft floor under the hollows (m, ≥ 0). */
  valleyFloor(h: number): number {
    const k = this.floorSoft;
    const x = (h - this.floor) / k;
    return x > 30 ? h - this.floor : k * Math.log1p(Math.exp(x));
  }

  /** The peaks at a direction (m): the tallest one rising there. */
  peaksAt(dir: Vector3): number {
    const R = this.radius;
    let h = 0;
    for (const pk of this.peaks) {
      const c = dir.dot(pk.dir);
      if (c < Math.cos(Math.min(Math.PI, (PEAK_REACH * pk.radius) / R))) continue;
      const chord = 2 * Math.asin(Math.min(1, 0.5 * Math.sqrt(Math.max(0, 2 - 2 * c))));
      h = Math.max(h, pk.height * peakProfile((chord * R) / pk.radius));
    }
    return h;
  }

  /** Natural height (m above the planet's base sphere): hills on their valley floors, plus the peaks. */
  natural(dir: Vector3): number {
    const t = twirl(this.twirls, dir, tw);
    return this.valleyFloor(this.hillsTwirled(t)) + this.peaksAt(dir);
  }

  /** Everything the bake's terrain pass writes for a direction (mirrors bake.frag.glsl). */
  base(dir: Vector3, out: TerraceBase): TerraceBase {
    const t = twirl(this.twirls, dir, baseTw);
    const parts = this.hillParts(t);
    const raw = parts.total;
    const local = parts.local;
    const peak = this.peaksAt(dir);
    const h = this.valleyFloor(raw) + peak;
    gradientFrame(dir, t1, t2);
    const e = SLOPE_STEP / this.radius;
    const h1 = this.natural(d1.copy(dir).addScaledVector(t1, e).normalize());
    const h2 = this.natural(d2.copy(dir).addScaledVector(t2, e).normalize());
    const slope = Math.hypot(h1 - h, h2 - h) / SLOPE_STEP;
    out.natural = h;
    out.slope = slope;
    out.wild = this.wildAt(t, h, local, peak, slope);
    out.flat = this.flatAt(raw);
    return out;
  }

  /**
   * 0 where the land is terraced, 1 where it is left wild: the crowns of the
   * hills, the gullies, slopes too steep to terrace, the peaks and the woods.
   * h: the natural height; local: the hills' local relief (m).
   */
  private wildAt(t: Vector3, h: number, local: number, peak: number, slope: number): number {
    const w = this.wildParts(t, h, local, peak, slope, wildOut);
    return Math.max(w.woods, w.steep, w.crown, w.gully, w.tower);
  }

  /** Each reason the land is left wild, 0..1 (land use: the woods, steep slopes, the hills' crowns, the gullies, the peaks). */
  wildParts(t: Vector3, h: number, local: number, peak: number, slope: number, out: WildParts): WildParts {
    const n = this.pair(t, this.forestPair, SEED.forest) + FOREST_DETAIL * this.pair(t, this.forestDetailPair, SEED.forestDetail);
    out.woods = smoothstep(this.forestThreshold - this.forestSoft, this.forestThreshold + this.forestSoft, n);
    out.steep = smoothstep(this.steep[0], this.steep[1], slope);
    const s = this.localStd;
    out.crown = smoothstep(WILD.crown[0] * s, WILD.crown[1] * s, local) * smoothstep(WILD.crownHeight[0], WILD.crownHeight[1], h);
    out.gully = smoothstep(WILD.gully[0] * s, WILD.gully[1] * s, local) * smoothstep(WILD.gullySlope[0], WILD.gullySlope[1], slope);
    out.tower = smoothstep(1.2, 3.5, peak);
    return out;
  }

  /** Why the land at a direction is wild (or not): each reason 0..1. */
  landUse(dir: Vector3, out: WildParts): WildParts {
    const t = twirl(this.twirls, dir, baseTw);
    const parts = this.hillParts(t);
    const raw = parts.total;
    const local = parts.local;
    const peak = this.peaksAt(dir);
    const h = this.valleyFloor(raw) + peak;
    const b = this.base(dir, landBase);
    return this.wildParts(twirl(this.twirls, dir, baseTw), h, local, peak, b.slope, out);
  }

  /** 0 on the hills … 1 on a valley's flat floor, from the hills' raw height under their soft floor. */
  flatAt(raw: number): number {
    return 1 - smoothstep(FLAT[0], FLAT[1], (raw - this.floor) / this.floorSoft);
  }

  /** The season's spread over the hillsides, 0..1 (the life pass's third channel): where paddies are planted early or late. */
  season(dir: Vector3): number {
    return clamp(0.5 + 1.7 * this.pair(twirl(this.twirls, dir, tw), this.seasonPair, SEED.season), 0, 1);
  }

  writeUniforms(u: TerraceFieldUniforms): void {
    u.uRadius.value = this.radius;
    u.uTSeed.value = this.seed >>> 0;
    u.uHill.value.set(this.hill);
    u.uTGrain.value.set(this.grain.x, this.grain.y, this.grain.z, GRAIN);
    u.uTFloor.value.set(this.floor, this.floorSoft, this.localStd, 0);
    u.uTForest.value.set(this.forestThreshold, this.forestSoft, this.steep[0], this.steep[1]);
    u.uTPairsA.value.set(this.forestPair.level, this.forestPair.t, this.forestDetailPair.level, this.forestDetailPair.t);
    u.uTPairsB.value.set(FLAT[0], FLAT[1], this.regionPair.level, this.regionPair.t);
    u.uTPairsC.value.set(this.fogAPair.level, this.fogAPair.t, this.fogBPair.level, this.fogBPair.t);
    u.uTPairsD.value.set(this.seasonPair.level, this.seasonPair.t, 0, 0);
    u.uPeaks.value = this.peakTexture;
    u.uPeakCount.value = this.peaks.length;
    this.twirls.forEach((tw, i) => {
      u.uTTwirl.value[i].set(tw.centre.x, tw.centre.y, tw.centre.z, tw.turn);
      u.uTTwirlRadius.value.setComponent(i, tw.radius);
    });
    u.uCells.value.set(cellFrequency(this.radius), CELLS.warp, CELLS.frame, 0);
  }

  /** Highest the natural ground can stand (m), for culling and the reflections' march. */
  get maxHeight(): number {
    let peak = 0;
    for (const pk of this.peaks) peak = Math.max(peak, pk.height);
    return this.valleyFloor(4 * this.hillStd) + peak * 1.05 + 1;
  }
}

/** The tangent frame at dir every ground gradient uses (matches gradientFrame in the shaders). */
export function gradientFrame(dir: Vector3, a: Vector3, b: Vector3): void {
  a.crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : X).normalize();
  b.crossVectors(dir, a);
}
