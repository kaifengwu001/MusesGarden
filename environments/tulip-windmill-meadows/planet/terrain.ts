import { Vector3, Vector4, type Texture } from 'three';
import { hash32, mix, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { Fields, type FieldParams } from './fields';
import { sunAt } from '../render/palette';
import { localSun } from '../../../src/render/sun';
import { angleBetween, tangentToward, travel } from '../../../src/planet/geo';
import { FARM_LIMIT, farmSites, type FarmSite } from '../life/farmLayout';

// The ground: a rolling meadow with lakes in its hollows (fields.ts holds the
// meadow itself), plus the homestead, laid out in meters around the cottage.
// The GPU reads the meadow from the bake and applies the rest in terrain.glsl;
// `Terrain.sample` is the CPU mirror (picking, placement, tests).
//
//   water      one water table at h = 0. Lakes are wherever the ground dips
//              below it, so shores follow the hills' contours. A bank lip
//              (tanh of the distance to the shore) lifts the land a little
//              at the edge and drops the water off, like a cut turf bank
//   homestead  the cottage keeps its direction; a dry plateau, its clearing,
//              its pond (in front and to the left, under its pier, as in
//              the painting) and terrace are laid out in meters from it, so
//              it always sits by its pond whatever the size of the planet

export const R_REF = 128;
/** The hour the cottage is turned to face (the one light for now, params light.timeOfDay). */
const LAYOUT_SUN_HOURS = 11.5;
/** Distances (m) from the cottage centre: clearing flattened, the pond's near edge in front, and how far left of the middle the pond lies. */
export const COTTAGE_FLAT = 7.5;
export const COTTAGE_TO_POND = 4.3;
export const POND_SHIFT = 7;
/** The cottage clearing stands this high above the water (m): its landing is a terrace over the pond. */
export const HOME_LEVEL = 1.5;
/** The house's footprint (half sizes, m), and its terrace with the steps and its pier (props.ts COTTAGE, TERRACE, STEPS, PIER: x0, x1, z0, z1): cleared of plants. */
export const HOUSE_FOOTPRINT = { halfX: 4.45, halfZ: 2.75 } as const;
export const TERRACE_AREA = [-4.5, 4.2, -0.2, 4.8] as const;
export const STEPS_AREA = [1.9, 3.9, 4.6, 5.85] as const;
export const PIER_AREA = [-8.3, -3.3, 1.75, 5.7] as const;
/** The channel cut under the pier's arch (props.ts ARCH), so the water runs in under its vault: centre x, z and half sizes (m). */
export const CULVERT = { x: -7.2, z: 4.6, halfX: 0.5, halfZ: 1.3 } as const;
/** Dry plateau around the homestead (m): full inside, none outside. */
export const PLATEAU = { inner: 10, outer: 26 } as const;
/** The homestead pond's bed: slope from its edge (m/m) and deepest point (m); its banks: a steep cut turf slope (m/m). */


const POND_BANK = 0.9;
/** Bank lip: height (m) and the distance (m) over which it rises from the waterline. */
export const BANK = { height: 0.2, width: 0.3, minSlope: 0.04 } as const;

export interface HomePond {
  readonly radius0: number;
  /** Outline: amplitudes and phases of harmonics 1–3, angle 0 toward the cottage. */
  readonly shape: readonly [number, number, number, number, number, number];
  /** One islet in pond-normalised coordinates: x, y, radius. */
  readonly islet: readonly [number, number, number];
}

export interface Layout {
  readonly seed: number;
  readonly noiseSeed: number;
  readonly cottage: Vector3;
  /** Unit tangent at the cottage pointing to its pond (and toward the nearest wetland). */
  readonly homeBearing: Vector3;
  /** Axis the hills, islands and colonies run along. */
  readonly grain: Vector3;
  readonly pond: HomePond;
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

/**
 * The world's layout from its seed. The cottage goes on dry ground near the
 * edge of a wetland (so lakes are in view), facing the wettest way within
 * 70° of the sun with the sun to the left of ahead (the late-morning sun
 * that place sees, render/sun.ts; the painting's light), so
 * its front and its pond are in the light, seen from across the water.
 */
export function generateLayout(seed: number): Layout {
  const rand = sequence(seed);
  const noiseSeed = hash32(mix(seed, 0x7e44a1));
  const grain = randomDirection(rand);
  const probe = new Fields(noiseSeed, grain);
  let cottage = randomDirection(rand);
  let best = Infinity;
  for (let k = 0; k < 24; k++) {
    const c = randomDirection(rand);
    const score = Math.abs(probe.wetNoise(c) + 0.12);
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
  let wettest = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
    // the sun ahead and to the left (as in the painting: the front lit, the right end in shade)
    if (t.dot(towardSun) < Math.cos((70 * Math.PI) / 180) || p.crossVectors(cottage, t).dot(towardSun) > -Math.sin((15 * Math.PI) / 180)) continue;
    const w = probe.wetNoise(travel(cottage, t, 0.35, p));
    if (w > wettest) {
      wettest = w;
      bearing = t.clone();
    }
  }
  const shape: [number, number, number, number, number, number] = [
    0.06 + 0.08 * rand(),
    0.04 + 0.07 * rand(),
    0.02 + 0.04 * rand(),
    rand() * Math.PI * 2,
    rand() * Math.PI * 2,
    rand() * Math.PI * 2,
  ];
  const ia = Math.PI * (0.6 + 0.8 * rand());
  const ir = 0.3 + 0.25 * rand();
  // (the pond twice the size it was through iteration 9; its islet the same size in meters)
  const pond: HomePond = { radius0: 17 + 5 * rand(), shape, islet: [Math.cos(ia) * ir, Math.sin(ia) * ir, 0.05 + 0.035 * rand()] };
  return { seed, noiseSeed, cottage, homeBearing: bearing, grain, pond };
}

// ---- R-dependent state and evaluation ------------------------------------

export interface GroundSample {
  /** Ground (or water surface) height above the base sphere R, m. */
  height: number;
  /** Signed distance to the shore, m (negative on the water). */
  water: number;
  /** Water depth under the surface, m (0 on land). */
  depth: number;
  /** Cottage clearing (no grass, flowers or stones), 0..1. */
  clearing: number;
  /** Macro wetness, 0..1. */
  wet: number;
}

export function createGroundSample(): GroundSample {
  return { height: 0, water: 0, depth: 0, clearing: 0, wet: 0 };
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const t1 = new Vector3();
const t2 = new Vector3();
const d1 = new Vector3();
const d2 = new Vector3();
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
  pondRadius = 0;
  /** Pond centre (m) along the bearing from the cottage, how far from the cottage the pond can reach, and how far from its own centre it can shape the ground (m). */
  pondCentre = 0;
  pondReach = 0;
  pondShapeReach = 0;
  readonly cottageLevel = HOME_LEVEL;
  /** Step (m) of the finite-difference gradient behind the bank lip; at least a bake texel. */
  gradStep = 0.75;
  private farmRadius=NaN;
  private farmSeed=NaN;
  private farmCache:FarmSite[]=[];

  get farms():FarmSite[]{
    if(this.farmRadius!==this.radius||this.farmSeed!==this.layout.seed){
      this.farmRadius=this.radius;this.farmSeed=this.layout.seed;
      this.farmCache=farmSites(this.layout,this.radius);
    }
    return this.farmCache;
  }

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
    const pond = this.layout.pond;
    const r = pond.radius0 * Math.pow(radius / R_REF, 0.3);
    const [a1, a2, a3, p1, p2, p3] = pond.shape;
    const edge = r * (1 + a1 * Math.cos(p1) + a2 * Math.cos(p2) + a3 * Math.cos(p3));
    this.pondRadius = r;
    this.pondCentre = edge + COTTAGE_TO_POND;
    // past its widest outline, its banks rise above any ground there is
    this.pondShapeReach = r * (1 + a1 + a2 + a3) + Math.max(this.maxHeight, HOME_LEVEL) / POND_BANK + 0.5;
    // everything the homestead shapes: its plateau, and the pond as far as it shapes the ground
    this.pondReach = Math.max(PLATEAU.outer, Math.hypot(this.pondCentre, POND_SHIFT) + this.pondShapeReach);
    this.gradStep = Math.max(0.6, bakeTexelMeters);
  }

  /**
   * Where the homestead shapes or shades the ground, as discs (direction,
   * radius in m) for the surface's two draws (chunks.ts LodView.home): its
   * plateau, or as far as the cottage's shadow reaches if farther (the sweep
   * per meter of height: uCottageSun; terrain.glsl's cottageShadow, from its
   * eaves at 4.75 × 3.08 m to its ridge at 6.2 m), and its pond (homePond).
   * The GPU measures them in cottage-local meters, a little shorter than
   * these arcs: a couple of meters to spare.
   */
  homeAreas(sweepX: number, sweepZ: number, out: Array<{ dir: Vector3; reach: number }>): void {
    const L = this.layout;
    const R = this.radius;
    const shadow = Math.min(60, Math.hypot(4.75, 3.08) + 6.2 * Math.hypot(sweepX, sweepZ) + 0.5);
    out[0].dir.copy(L.cottage);
    out[0].reach = Math.max(PLATEAU.outer, shadow) + 2;
    tmpB.crossVectors(L.cottage, L.homeBearing);
    out[1].dir.copy(L.cottage).addScaledVector(tmpB, -POND_SHIFT / R).addScaledVector(L.homeBearing, this.pondCentre / R).normalize();
    out[1].reach = this.pondShapeReach + 2;
  }

  /** Cottage local coordinates (m): x across, z toward the pond. Mirrors cottageLocal() in GLSL. */
  cottageLocal(dir: Vector3, out: { x: number; z: number }): { x: number; z: number } {
    const L = this.layout;
    tmpA.subVectors(dir, L.cottage);
    tmpB.crossVectors(L.cottage, L.homeBearing);
    out.x = tmpA.dot(tmpB) * this.radius;
    out.z = tmpA.dot(L.homeBearing) * this.radius;
    return out;
  }

  /** Signed distance (m) to the homestead pond's outline, islet excluded. */
  homePond(dir: Vector3): number {
    const r = this.pondRadius;
    const c = this.cottageLocal(dir, localTmp);
    // pond-normalised, x toward the cottage
    const x = -(c.z - this.pondCentre) / r;
    const y = (c.x + POND_SHIFT) / r;
    const th = Math.atan2(y, x);
    const [a1, a2, a3, p1, p2, p3] = this.layout.pond.shape;
    const sdf = (Math.hypot(x, y) - (1 + a1 * Math.cos(th - p1) + a2 * Math.cos(2 * th - p2) + a3 * Math.cos(3 * th - p3))) * r;
    const [ix, iy, ir] = this.layout.pond.islet;
    return Math.max(sdf, -(Math.hypot(x - ix, y - iy) - ir) * r);
  }

  /** The homestead's plateau, clearing and pond, applied to the natural height h. */
  homestead(dir: Vector3, h: number): number {
    const dc=angleBetween(dir,this.layout.cottage)*this.radius;
    return h+(this.cottageLevel-h)*smoothstep(14,7.5,dc);
  }

  /** Ground height before the bank lip (m above the water table). */
  height0(dir: Vector3): number {
    return this.homestead(dir, this.fields.natural(dir));
  }

  /** Full ground sample at a direction. Mirrors sampleGround() in terrain.glsl. */
  sample(dir: Vector3, out: GroundSample): GroundSample {
    const h0 = this.height0(dir);
    gradientFrame(dir, t1, t2);
    const e = this.gradStep / this.radius;
    const h1 = this.height0(d1.copy(dir).addScaledVector(t1, e).normalize());
    const h2 = this.height0(d2.copy(dir).addScaledVector(t2, e).normalize());
    const slope = Math.hypot(h1 - h0, h2 - h0) / this.gradStep;
    out.water = h0 / Math.max(slope, BANK.minSlope);
    const hb = h0 + BANK.height * Math.tanh(out.water / BANK.width);
    out.height = Math.max(hb, 0);
    out.depth = Math.max(-hb, 0);
    out.clearing = this.clearingAt(dir, angleBetween(dir, this.layout.cottage) * this.radius);
    out.wet = this.fields.wetness(dir);
    return out;
  }

  height(dir: Vector3): number {
    return this.sample(dir, scratch).height;
  }

  /** Where the cottage stands: its clearing plus the full bank lip (it is far from any shore). */
  get cottageGround(): number {
    return this.cottageLevel + BANK.height;
  }

  /** Highest the ground can stand above the water table anywhere (m), for culling. */
  get maxHeight(): number {
    return Math.max(6,this.fields.lift + 4 * this.fields.reliefStd + BANK.height + 0.5);
  }

  /** No grass, flowers or stones: inside the house and on the landing. */
  clearingAt(dir: Vector3, dc: number): number {
    if (dc > 9) return 0;
    const c = this.cottageLocal(dir, localTmp);
    const H = HOUSE_FOOTPRINT;
    const dx = Math.abs(c.x) - H.halfX;
    const dz = Math.abs(c.z) - H.halfZ;
    const house = smoothstep(0.3, 0, Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0));
    const area = (a: readonly [number, number, number, number]): number => smoothstep(0.35, 0, Math.max(a[0] - c.x, c.x - a[1], a[2] - c.z, c.z - a[3]));
    return Math.max(house, area(TERRACE_AREA), area(STEPS_AREA), area(PIER_AREA));
  }

  /** Uniform values for terrain.glsl (shared by every material that samples the ground). */
  writeUniforms(u: TerrainUniforms): void {
    const L = this.layout;
    u.uFarmCount.value=this.farms.length;
    for(const [i,s] of this.farms.entries()){
      u.uFarmUp.value[i].set(s.direction.x,s.direction.y,s.direction.z,s.scale);
      u.uFarmAcross.value[i].set(s.across.x,s.across.y,s.across.z,s.gate);
      u.uFarmAlong.value[i].set(s.along.x,s.along.y,s.along.z,s.minDot);
    }
    u.uTerrainSeed.value = L.noiseSeed;
    u.uBank.value.set(BANK.height, BANK.width, this.gradStep, BANK.minSlope);
    u.uCottage.value.set(L.cottage.x, L.cottage.y, L.cottage.z, this.cottageLevel);
    u.uCottageB.value.set(L.homeBearing.x, L.homeBearing.y, L.homeBearing.z, 0);
    u.uHomePond.value.set(this.pondRadius, this.pondCentre, this.pondReach, POND_SHIFT);
    const [a1, a2, a3, p1, p2, p3] = L.pond.shape;
    u.uHomeShape.value.set(a1, a2, a3, this.pondShapeReach);
    u.uHomePhase.value.set(p1, p2, p3, 0);
    u.uHomeIslet.value.set(L.pond.islet[0], L.pond.islet[1], L.pond.islet[2], 0);
    const f = this.fields;
    u.uClumps.value.set(f.clumpPair.level, f.clumpPair.t, f.clumpThreshold, f.patchiness);
  }
}

const scratch = createGroundSample();
const localTmp = { x: 0, z: 0 };

export interface TerrainUniforms {
  uFarmCount:{value:number};
  uFarmUp:{value:Vector4[]};
  uFarmAcross:{value:Vector4[]};
  uFarmAlong:{value:Vector4[]};
  uTerrainSeed: { value: number };
  /** Natural height (m), lushness, wetness, colour variant (bake.ts). */
  uTerrainBake: { value: Texture | null };
  /** Flowers per m²: pink, star, yellow, blue (bake.ts). */
  uFloraBake: { value: Texture | null };
  /** Bank height (m), bank width (m), gradient step (m), minimum slope. */
  uBank: { value: Vector4 };
  uCottage: { value: Vector4 };
  /** Toward the pond (xyz). */
  uCottageB: { value: Vector4 };
  /** Homestead pond: radius (m), centre along the bearing (m), reach (m). */
  uHomePond: { value: Vector4 };
  uHomeShape: { value: Vector4 };
  uHomePhase: { value: Vector4 };
  uHomeIslet: { value: Vector4 };
  /** Shadow sweep per meter of height in cottage-local x, z (sun direction / its elevation). */
  uCottageSun: { value: Vector4 };
  /** Flower clumps (Fields.clumps): octave level, blend, threshold, patchiness. */
  uClumps: { value: Vector4 };
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uFarmCount:{value:0},
    uFarmUp:{value:Array.from({length:FARM_LIMIT},()=>new Vector4())},
    uFarmAcross:{value:Array.from({length:FARM_LIMIT},()=>new Vector4())},
    uFarmAlong:{value:Array.from({length:FARM_LIMIT},()=>new Vector4())},
    uTerrainSeed: { value: 0 },
    uTerrainBake: { value: null },
    uFloraBake: { value: null },
    uBank: { value: new Vector4(BANK.height, BANK.width, 0.75, BANK.minSlope) },
    uCottage: { value: new Vector4(0, 1, 0, HOME_LEVEL) },
    uCottageB: { value: new Vector4(1, 0, 0, 0) },
    uHomePond: { value: new Vector4(9, 14, 28, 0) },
    uHomeShape: { value: new Vector4() },
    uHomePhase: { value: new Vector4() },
    uHomeIslet: { value: new Vector4() },
    uCottageSun: { value: new Vector4(0, 0, 0, 0) },
    uClumps: { value: new Vector4(0, 0, 0, 0) },
  };
}
