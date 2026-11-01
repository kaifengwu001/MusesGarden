import { Vector3, Vector4, type Texture } from 'three';
import { hash32, mix, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { Fields, habitatThreshold, LAYOUT_HABITAT, type FieldParams } from './fields';
import { sunAt } from '../render/palette';
import { localSun } from '../../../src/render/sun';
import { angleBetween, tangentToward, travel } from '../../../src/planet/geo';

// The ground: dry dunes (fields.ts holds the dunes themselves), plus the
// homestead, laid out in meters around the shelter. The GPU reads the dunes
// from the bake and applies the rest in terrain.glsl; `Terrain.sample` is the
// CPU mirror (picking, placement, tests).
//
//   dry        there is no water anywhere: no table, no shore, no bank lip.
//              The ground sample still carries the shore distance the shared
//              shaders read, as a constant far from any shore
//   homestead  the shelter keeps its direction; a flat pad at the home level,
//              blended into the dunes over a few meters, with the dunes calmed
//              for a few meters more, laid out in meters from it, so it sits
//              the same way whatever the size of the planet

export const R_REF = 128;
/** The hour the shelter is turned to face (the one light for now, params light.timeOfDay). */
const LAYOUT_SUN_HOURS = 11.5;
/** Distances (m) from the shelter's centre: the pad is flat inside `flat`, blends into the dunes by `blend`, and the dunes are calmed out to `calm`. */
export const HOME = { flat: 4.8, blend: 7.2, calm: 12, calmKeep: 0.78 } as const;
/** How far around the anchor the home level averages the natural ground (m). */
const HOME_LEVEL_REACH = 8;
/** Authored dune ridges behind the settlement; same meter-space recipe in terrain.glsl. */
export const ORCHARD_DUNES = [
  [28, -28, 10, 16, 30],
  [-25, -62, 11, 15, 30],
  [25, -95, 15, 16, 40],
] as const;
const ORCHARD_REACH = 112;
const ORCHARD_MAX = 36;
/** The shelter's plinth (props.ts PLINTH): half sizes (m). */
export const PLINTH_HALF = { x: 2.5, z: 2.4 } as const;
/** The approach to the door, left unplanted: x0, x1, z0, z1 (m, shelter-local). */
export const APPROACH_AREA = [-1.5, 1.5, 2.4, 15] as const;
/** Muse's apron in front of the plinth: x0, x1, z0, z1 (m). */
export const MUSE_APRON = [-2.6, 2.6, 2.4, 3.8] as const;
/** The clearing reaches no farther than this from the shelter's centre (m). */
export const CLEARING_REACH = 17;
/** A dry world's distance to the shore (m): far from any, and well inside half-float range. */
export const DRY_SHORE = 100;
/** The old bank lip, kept at zero height for the shared shaders that apply it (uBank). */
export const BANK = { height: 0, width: 0.3, minSlope: 0.04 } as const;
/** The shelter's shadow volume: its plinth top, walls (half sizes) up to the canvas's outer edge, roof from that edge's overhang to the ridge (m). */
export const SHELTER_SHADOW = { plinth: 0.25, wall: [2.2, 1.8], eave: 2.2, roof: [2.5, 2.3], ridge: 3.45 } as const;

export interface Layout {
  readonly seed: number;
  readonly noiseSeed: number;
  readonly cottage: Vector3;
  /** Unit tangent at the shelter its door faces (toward the habitat). */
  readonly homeBearing: Vector3;
  /** Axis the dune crests run along: at the shelter, 70° from its front axis toward its right, so they lie across the light. */
  readonly grain: Vector3;
}

function sequence(seed: number): () => number {
  let state = hash32((seed ^ 0x5bd1e995) >>> 0);
  return () => unit((state = hash32((state + 0x9e3779b9) >>> 0)));
}

function randomDirection(rand: () => number, out = new Vector3()): Vector3 {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return out.set(s * Math.cos(t), s * Math.sin(t), z);
}

/** The crests near home run at this angle from the shelter's front axis toward its right (assets.json dune_guide; board 01 draws them across the view from the front). */
const CREST_DEGREES = 70;

/**
 * The world's layout from its seed. The shelter goes on open sand near the
 * edge of a habitat (so slate and plants are in view), facing the most
 * habitat-rich way within 70° of the sun with the sun to the left of ahead
 * (the late-morning sun that place sees, render/sun.ts), so its front is lit.
 * The grain is set from the shelter's own frame, so the crests near home run
 * the way the reference patch draws them.
 */
export function generateLayout(seed: number): Layout {
  const rand = sequence(seed);
  const noiseSeed = hash32(mix(seed, 0x7e44a1));
  // the habitat field doesn't depend on the grain: probe it with any
  const probe = new Fields(noiseSeed, new Vector3(0, 1, 0));
  const edge = habitatThreshold(probe, LAYOUT_HABITAT) - 0.06;
  let cottage = randomDirection(rand);
  let best = Infinity;
  for (let k = 0; k < 24; k++) {
    const c = randomDirection(rand);
    const score = Math.abs(probe.habitatNoise(c) - edge);
    if (score < best) {
      best = score;
      cottage = c;
    }
  }
  const north = tangentToward(cottage, new Vector3(0.31, 0.83, 0.47), new Vector3());
  const east = new Vector3().crossVectors(north, cottage);
  const t = new Vector3();
  const p = new Vector3();
  const sun = sunAt(LAYOUT_SUN_HOURS);
  const towardSun = tangentToward(cottage, localSun(cottage, sun.elevation, sun.azimuth, new Vector3()), new Vector3());
  let bearing = towardSun.clone();
  let richest = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
    // the sun ahead and to the left (the front lit, the right end in shade)
    if (t.dot(towardSun) < Math.cos((70 * Math.PI) / 180) || p.crossVectors(cottage, t).dot(towardSun) > -Math.sin((15 * Math.PI) / 180)) continue;
    const w = probe.habitatNoise(travel(cottage, t, 0.35, p));
    if (w > richest) {
      richest = w;
      bearing = t.clone();
    }
  }
  const across = new Vector3().crossVectors(cottage, bearing).normalize();
  const crest = (CREST_DEGREES * Math.PI) / 180;
  const grain = across.multiplyScalar(Math.sin(crest)).addScaledVector(bearing, Math.cos(crest)).normalize();
  return { seed, noiseSeed, cottage, homeBearing: bearing, grain };
}

// ---- R-dependent state and evaluation ------------------------------------

export interface GroundSample {
  /** Ground height above the base sphere R, m. */
  height: number;
  /** Distance to the shore, m: a dry world has none (DRY_SHORE). */
  water: number;
  /** Water depth, m: always 0. */
  depth: number;
  /** The shelter's clearing (no plants or slate), 0..1. */
  clearing: number;
  /** Habitat, 0..1. */
  wet: number;
}

export function createGroundSample(): GroundSample {
  return { height: 0, water: DRY_SHORE, depth: 0, clearing: 0, wet: 0 };
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const ring = new Vector3();
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/** The tangent frame at dir every ground gradient uses (matches terrain.glsl). */
export function gradientFrame(dir: Vector3, a: Vector3, b: Vector3): void {
  a.crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : X).normalize();
  b.crossVectors(dir, a);
}

export class Terrain {
  radius = R_REF;
  fields: Fields;
  /** The pad's height (m): the natural ground averaged around the anchor. */
  cottageLevel = 0;
  /** Step (m) of the finite-difference gradient the GPU takes; at least a bake texel. */
  gradStep = 0.75;

  constructor(public layout: Layout) {
    this.fields = new Fields(layout.noiseSeed, layout.grain);
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
    this.fields = new Fields(layout.noiseSeed, layout.grain);
  }

  /** Refresh everything that depends on R and the parameters (cheap). */
  update(radius: number, p: FieldParams, bakeTexelMeters: number): void {
    this.radius = radius;
    this.fields.update(radius, p);
    this.cottageLevel = this.homeLevel();
    this.gradStep = Math.max(0.6, bakeTexelMeters);
  }

  /** The natural ground averaged over the anchor and two rings around it. */
  private homeLevel(): number {
    const L = this.layout;
    const across = tmpB.crossVectors(L.cottage, L.homeBearing).normalize();
    let sum = this.fields.natural(L.cottage);
    let n = 1;
    for (const r of [HOME_LEVEL_REACH / 2, HOME_LEVEL_REACH]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        tmpA.copy(L.homeBearing).multiplyScalar(Math.cos(a)).addScaledVector(across, Math.sin(a));
        sum += this.fields.natural(travel(L.cottage, tmpA, r / this.radius, ring));
        n++;
      }
    }
    return sum / n;
  }

  /**
   * Where the homestead shapes or shades the ground, as discs (direction,
   * radius in m) for the surface's two draws (chunks.ts LodView.home): its
   * calmed dunes, or as far as the shelter's shadow reaches if farther (the
   * sweep per meter of height: uCottageSun; terrain.glsl's cottageShadow).
   * The GPU measures them in shelter-local meters, a little shorter than
   * these arcs: a couple of meters to spare. The second disc repeats the first.
   */
  homeAreas(sweepX: number, sweepZ: number, out: Array<{ dir: Vector3; reach: number }>): void {
    const S = SHELTER_SHADOW;
    const shadow = Math.min(60, Math.hypot(S.roof[0], S.roof[1]) + S.ridge * Math.hypot(sweepX, sweepZ) + 0.5);
    const reach = Math.max(ORCHARD_REACH, CLEARING_REACH, shadow) + 2;
    for (const area of out) {
      area.dir.copy(this.layout.cottage);
      area.reach = reach;
    }
  }

  /** Shelter-local coordinates (m): x across, z toward the door's front. Mirrors cottageLocal() in GLSL. */
  cottageLocal(dir: Vector3, out: { x: number; z: number }): { x: number; z: number } {
    const L = this.layout;
    tmpA.subVectors(dir, L.cottage);
    tmpB.crossVectors(L.cottage, L.homeBearing);
    out.x = tmpA.dot(tmpB) * this.radius;
    out.z = tmpA.dot(L.homeBearing) * this.radius;
    return out;
  }

  /** The homestead's calmed dunes and flat pad, applied to the natural height h. */
  homestead(dir: Vector3, h: number): number {
    const dc = angleBetween(dir, this.layout.cottage) * this.radius;
    if (dc < ORCHARD_REACH) {
      const c = this.cottageLocal(dir, localTmp);
      let dunes = 0;
      for (const [x, z, amplitude, width, length] of ORCHARD_DUNES) {
        const dx = (c.x - x) / length;
        const bend = 0.22 * (c.x - x) + 0.006 * (c.x - x) ** 2;
        const dz = c.z - z - bend;
        const q = dz / (dz < 0 ? width * 2.2 : width);
        const profile = Math.max(0, 1 - Math.sqrt(q * q + 0.0009));
        dunes += amplitude * profile * Math.exp(-(dx ** 2));
      }
      h += dunes * smoothstep(14, 24, dc) * (1 - smoothstep(90, ORCHARD_REACH, dc));
    }
    if (dc > HOME.calm) return h;
    const level = this.cottageLevel;
    h = level + (h - level) * (HOME.calmKeep + (1 - HOME.calmKeep) * smoothstep(HOME.blend, HOME.calm, dc));
    return h + (level - h) * smoothstep(HOME.blend, HOME.flat, dc);
  }

  /** Ground height (m above the base sphere). */
  height0(dir: Vector3): number {
    return this.homestead(dir, this.fields.natural(dir));
  }

  /** Full ground sample at a direction. Mirrors sampleGround() in terrain.glsl. */
  sample(dir: Vector3, out: GroundSample): GroundSample {
    out.height = this.height0(dir);
    out.water = DRY_SHORE;
    out.depth = 0;
    out.clearing = this.clearingAt(dir, angleBetween(dir, this.layout.cottage) * this.radius);
    out.wet = this.fields.habitat(dir);
    return out;
  }

  height(dir: Vector3): number {
    return this.height0(dir);
  }

  /** Where the shelter stands: its pad. */
  get cottageGround(): number {
    return this.cottageLevel;
  }

  /** Highest the ground can stand above the base sphere anywhere (m), for culling. */
  get maxHeight(): number {
    return this.fields.maxHeight + ORCHARD_MAX + 0.3;
  }

  /** No plants or slate: under the plinth, on Muse's apron and along the approach. */
  clearingAt(dir: Vector3, dc: number): number {
    if (dc > CLEARING_REACH) return 0;
    const c = this.cottageLocal(dir, localTmp);
    const dx = Math.abs(c.x) - PLINTH_HALF.x;
    const dz = Math.abs(c.z) - PLINTH_HALF.z;
    const plinth = smoothstep(0.3, 0, Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0));
    const area = (a: readonly [number, number, number, number]): number => smoothstep(0.35, 0, Math.max(a[0] - c.x, c.x - a[1], a[2] - c.z, c.z - a[3]));
    return Math.max(plinth, area(APPROACH_AREA), area(MUSE_APRON));
  }

  /** Uniform values for terrain.glsl (shared by every material that samples the ground). */
  writeUniforms(u: TerrainUniforms): void {
    const L = this.layout;
    u.uTerrainSeed.value = L.noiseSeed;
    u.uBank.value.set(BANK.height, BANK.width, this.gradStep, BANK.minSlope);
    u.uCottage.value.set(L.cottage.x, L.cottage.y, L.cottage.z, this.cottageLevel);
    u.uCottageB.value.set(L.homeBearing.x, L.homeBearing.y, L.homeBearing.z, 0);
    u.uDuneGrain.value.set(L.grain.x, L.grain.y, L.grain.z, 0);
    const f = this.fields;
    u.uClumps.value.set(f.clumpPair.level, f.clumpPair.t, f.clumpThreshold, f.patchiness);
  }
}

const localTmp = { x: 0, z: 0 };

export interface TerrainUniforms {
  uTerrainSeed: { value: number };
  /** Natural height (m), sand tone, habitat, colour variant (bake.ts). */
  uTerrainBake: { value: Texture | null };
  /** Starflowers per m² in channel 1 (bake.ts). */
  uFloraBake: { value: Texture | null };
  /** Bank height (0 m), bank width (m), gradient step (m), minimum slope. */
  uBank: { value: Vector4 };
  /** The shelter's direction and its pad's level (m). */
  uCottage: { value: Vector4 };
  /** Toward the shelter's front (xyz). */
  uCottageB: { value: Vector4 };
  /** Shadow sweep per meter of height in shelter-local x, z (sun direction / its elevation). */
  uCottageSun: { value: Vector4 };
  /** Starflower clumps (Fields.clumps): octave level, blend, threshold, patchiness. */
  uClumps: { value: Vector4 };
  /** The axis the crests run along (the sand's ripples follow it). */
  uDuneGrain: { value: Vector4 };
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uTerrainSeed: { value: 0 },
    uTerrainBake: { value: null },
    uFloraBake: { value: null },
    uBank: { value: new Vector4(BANK.height, BANK.width, 0.75, BANK.minSlope) },
    uCottage: { value: new Vector4(0, 1, 0, 0) },
    uCottageB: { value: new Vector4(1, 0, 0, 0) },
    uCottageSun: { value: new Vector4(0, 0, 0, 0) },
    uClumps: { value: new Vector4(0, 0, 0, 0) },
    uDuneGrain: { value: new Vector4(0, 1, 0, 0) },
  };
}
