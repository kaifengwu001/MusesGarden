import { Vector3, Vector4, type Texture } from 'three';
import { hash32, mix, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { Fields, type FieldParams } from './fields';
import { angleBetween, tangentToward, travel } from './geo';

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
//              its pond and landing are laid out in meters from it, so it
//              always sits by its pond whatever the size of the planet

export const R_REF = 128;
/** Distances (m) from the cottage centre: clearing flattened, and the pond's near edge. */
export const COTTAGE_FLAT = 5.5;
export const COTTAGE_TO_POND = 4.6;
/** The cottage clearing stands this high above the water (m). */
export const HOME_LEVEL = 0.5;
/** Dry plateau around the homestead (m): full inside, none outside. */
export const PLATEAU = { inner: 10, outer: 26 } as const;
/** The homestead pond's bed: slope from its edge (m/m) and deepest point (m). */
const POND_SLOPE = 0.3;
const POND_DEPTH = 1.4;
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
 * edge of a wetland (so lakes are in view), facing the wettest way.
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
  let bearing = north.clone();
  let wettest = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
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
  const pond: HomePond = { radius0: 8.5 + 2.5 * rand(), shape, islet: [Math.cos(ia) * ir, Math.sin(ia) * ir, 0.1 + 0.07 * rand()] };
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
  /** Pond centre (m) along the bearing from the cottage, and how far the pond can reach. */
  pondCentre = 0;
  pondReach = 0;
  readonly cottageLevel = HOME_LEVEL;
  /** Step (m) of the finite-difference gradient behind the bank lip; at least a bake texel. */
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
    const pond = this.layout.pond;
    const r = pond.radius0 * Math.pow(radius / R_REF, 0.3);
    const [a1, a2, a3, p1, p2, p3] = pond.shape;
    const edge = r * (1 + a1 * Math.cos(p1) + a2 * Math.cos(p2) + a3 * Math.cos(p3));
    this.pondRadius = r;
    this.pondCentre = edge + COTTAGE_TO_POND;
    this.pondReach = this.pondCentre + r * 1.45 + 1;
    this.gradStep = Math.max(0.6, bakeTexelMeters);
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
    const y = c.x / r;
    const th = Math.atan2(y, x);
    const [a1, a2, a3, p1, p2, p3] = this.layout.pond.shape;
    const sdf = (Math.hypot(x, y) - (1 + a1 * Math.cos(th - p1) + a2 * Math.cos(2 * th - p2) + a3 * Math.cos(3 * th - p3))) * r;
    const [ix, iy, ir] = this.layout.pond.islet;
    return Math.max(sdf, -(Math.hypot(x - ix, y - iy) - ir) * r);
  }

  /** The homestead's plateau, clearing and pond, applied to the natural height h. */
  homestead(dir: Vector3, h: number): number {
    const dc = angleBetween(dir, this.layout.cottage) * this.radius;
    if (dc > this.pondReach && dc > PLATEAU.outer) return h;
    const dry = smoothstep(PLATEAU.outer, PLATEAU.inner, dc);
    h += (Math.max(h, 0.4) * 0.5 + 0.25 - h) * dry;
    const flat = smoothstep(COTTAGE_FLAT + 3.5, COTTAGE_FLAT, dc);
    h += (this.cottageLevel - h) * flat;
    return Math.min(h, Math.max(this.homePond(dir) * POND_SLOPE, -POND_DEPTH));
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
    return this.fields.lift + 4 * this.fields.reliefStd + BANK.height + 0.5;
  }

  /** No grass, flowers or stones: right around the house and on the landing. */
  clearingAt(dir: Vector3, dc: number): number {
    const disc = smoothstep(3.6, 2.9, dc);
    if (dc > 9) return disc;
    const c = this.cottageLocal(dir, localTmp);
    const rect = smoothstep(0.35, 0, Math.max(-2.6 - c.x, c.x - 1.3, -0.2 - c.z, c.z - 5.9));
    return Math.max(disc, rect);
  }

  /** Uniform values for terrain.glsl (shared by every material that samples the ground). */
  writeUniforms(u: TerrainUniforms): void {
    const L = this.layout;
    u.uTerrainSeed.value = L.noiseSeed;
    u.uBank.value.set(BANK.height, BANK.width, this.gradStep, BANK.minSlope);
    u.uCottage.value.set(L.cottage.x, L.cottage.y, L.cottage.z, this.cottageLevel);
    u.uCottageB.value.set(L.homeBearing.x, L.homeBearing.y, L.homeBearing.z, 0);
    u.uHomePond.value.set(this.pondRadius, this.pondCentre, this.pondReach, 0);
    const [a1, a2, a3, p1, p2, p3] = L.pond.shape;
    u.uHomeShape.value.set(a1, a2, a3, 0);
    u.uHomePhase.value.set(p1, p2, p3, 0);
    u.uHomeIslet.value.set(L.pond.islet[0], L.pond.islet[1], L.pond.islet[2], 0);
    const f = this.fields;
    u.uClumps.value.set(f.clumpPair.level, f.clumpPair.t, f.clumpThreshold, f.patchiness);
  }
}

const scratch = createGroundSample();
const localTmp = { x: 0, z: 0 };

export interface TerrainUniforms {
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
