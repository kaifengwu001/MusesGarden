import { Vector3, Vector4 } from 'three';
import { hash32, mix, unit } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import { angleBetween, arcDistance, makeArc, slerpUnit, tangentToward, travel, type Arc } from './geo';
import { gnoise } from './noise';

// The terrain and its macro layout. Everything is defined in rest space
// (unit directions) and evaluated identically by terrain.glsl on the GPU and
// by `Terrain.sample` on the CPU (picking, placement, tests):
//
//   meadow roll   direction-space octaves weighted by their size in meters,
//                 so the meadow keeps a constant spectrum as R grows (hills
//                 rise and subside in place, never slide)
//   mountains     one ridged range along a great-circle arc (+ a spur that
//                 unlocks at A₄); height ∝ R, a landscape proportion
//   channels      splines through stable direction-space nodes, meander
//                 detail unlocking by rank as they lengthen; width in meters
//   ponds         direction-space centres, radii in meters (∝ R^0.3); pond 2+
//                 unlock at area thresholds; outline and islets in
//                 pond-normalised coordinates
//   homestead     the cottage keeps its direction; its pond and landing are
//                 laid out in meters from it, so it always sits by its pond

export const MEADOW_OCTAVES = 8;
export const MEADOW_BASE_FREQ = 1.6;
export const MAX_PONDS = 6;
export const MAX_ISLETS = 8;
export const R_REF = 128;
/** Angular half-widths of the mountain range: core and outer foothill edge. */
export const RANGE_INNER = 0.07;
export const RANGE_OUTER = 0.24;
/** Distances (m) from the cottage centre: clearing flattened, and the pond edge. */
export const COTTAGE_FLAT = 5.5;
export const COTTAGE_TO_POND = 4.6;

/** Area thresholds (m²) at which macro features bloom in. */
export const UNLOCK = {
  pond2: 120_000,
  branch: 300_000,
  spur: 600_000,
  pond3: 900_000,
  pond4: 1_400_000,
  pond5: 2_000_000,
  pond6: 2_600_000,
} as const;
const POND_UNLOCKS = [0, UNLOCK.pond2, UNLOCK.pond3, UNLOCK.pond4, UNLOCK.pond5, UNLOCK.pond6];
/** Radii (m) at which meander levels 1 and 2 unlock. */
export const MEANDER_RADII = [70, 160] as const;

export interface PondSpec {
  /** Centre direction; the homestead pond's is recomputed from the cottage each update. */
  readonly centre: Vector3;
  readonly radius0: number;
  /** Outline: amplitudes and phases of harmonics 1–3. */
  readonly shape: readonly [number, number, number, number, number, number];
  readonly isletStart: number;
  readonly isletCount: number;
  readonly unlockArea: number;
  readonly homestead: boolean;
}

export interface Layout {
  readonly seed: number;
  readonly noiseSeed: number;
  readonly cottage: Vector3;
  /** Unit tangent at the cottage pointing to its pond (and toward the range). */
  readonly homeBearing: Vector3;
  readonly range: Arc;
  readonly spur: Arc;
  readonly ponds: readonly PondSpec[];
  /** Islets in pond-normalised coordinates: x, y, radius. */
  readonly islets: ReadonlyArray<readonly [number, number, number]>;
  /** Channel centrelines per meander level (0 coarse … 2 fine). */
  readonly channels: ReadonlyArray<readonly [Vector3[], Vector3[], Vector3[]]>;
  /** Branch channel (full detail), unlocked at UNLOCK.branch. */
  readonly branch: Vector3[] | null;
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

/** Rotate tangent t at p by angle about p. */
function turn(p: Vector3, t: Vector3, angle: number): Vector3 {
  return t.clone().applyAxisAngle(p, angle).normalize();
}

/** Midpoint subdivision with sideways offsets: one more level of meander. */
function meander(points: Vector3[], amplitude: number, rand: () => number): Vector3[] {
  const out: Vector3[] = [points[0].clone()];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const m = slerpUnit(a, b, 0.5, new Vector3());
    const side = new Vector3().crossVectors(m, new Vector3().subVectors(b, a)).normalize();
    const offset = (rand() - 0.5) * 2 * amplitude * angleBetween(a, b);
    out.push(travel(m, side, offset, new Vector3()), b.clone());
  }
  return out;
}

export function generateLayout(seed: number, channelCount: number, pondCount: number): Layout {
  const rand = sequence(seed);
  const noiseSeed = hash32(mix(seed, 0x7e44a1));
  const cottage = randomDirection(rand);

  // The range rises about 105° from the cottage, spanning its horizon.
  const awayDir = tangentToward(cottage, randomDirection(rand), new Vector3());
  const rangeCentre = travel(cottage, awayDir, 1.8 + 0.25 * (rand() - 0.5), new Vector3());
  const toCottage = tangentToward(rangeCentre, cottage, new Vector3());
  const along = turn(rangeCentre, new Vector3().crossVectors(rangeCentre, toCottage).normalize(), (rand() - 0.5) * 0.8);
  const half = 0.5 + 0.18 * rand();
  const rangeA = travel(rangeCentre, along, -half, new Vector3());
  const rangeB = travel(rangeCentre, along, half, new Vector3());
  const range = makeArc(rangeA, rangeB);
  const spurStart = slerpUnit(rangeA, rangeB, 0.25 + 0.5 * rand(), new Vector3());
  const spurDir = turn(spurStart, tangentToward(spurStart, cottage, new Vector3()), (rand() < 0.5 ? -1 : 1) * (0.5 + 0.4 * rand()));
  const spur = makeArc(spurStart, travel(spurStart, spurDir, 0.42 + 0.15 * rand(), new Vector3()));

  // Homestead: the pond lies toward the range, so the landing looks over it at the mountains.
  const homeBearing = turn(cottage, tangentToward(cottage, rangeCentre, new Vector3()), (rand() - 0.5) * 1.1);

  const islets: Array<[number, number, number]> = [];
  const ponds: PondSpec[] = [];
  const shape = (): [number, number, number, number, number, number] => [
    0.06 + 0.08 * rand(),
    0.04 + 0.07 * rand(),
    0.02 + 0.04 * rand(),
    rand() * Math.PI * 2,
    rand() * Math.PI * 2,
    rand() * Math.PI * 2,
  ];
  const addIslets = (count: number): [number, number] => {
    const start = islets.length;
    for (let k = 0; k < count && islets.length < MAX_ISLETS; k++) {
      const a = rand() * Math.PI * 2;
      const r = 0.25 + 0.3 * rand();
      islets.push([Math.cos(a) * r, Math.sin(a) * r, 0.1 + 0.07 * rand()]);
    }
    return [start, islets.length - start];
  };
  {
    const [isletStart, isletCount] = addIslets(1);
    ponds.push({ centre: cottage.clone(), radius0: 8.5 + 2.5 * rand(), shape: shape(), isletStart, isletCount, unlockArea: 0, homestead: true });
  }
  const pondCentres: Vector3[] = [];
  for (let k = 1; k < Math.min(pondCount, MAX_PONDS); k++) {
    let best = new Vector3();
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 24; attempt++) {
      const c = randomDirection(rand);
      const score = Math.min(angleBetween(c, cottage) - 0.5, arcDistance(c, range) - 0.4, arcDistance(c, spur) - 0.3, ...pondCentres.map((p) => angleBetween(c, p) - 0.4));
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
      if (score > 0.1) break;
    }
    pondCentres.push(best);
    const [isletStart, isletCount] = addIslets(Math.floor(rand() * 2.6));
    ponds.push({ centre: best, radius0: 10 + 7 * rand(), shape: shape(), isletStart, isletCount, unlockArea: POND_UNLOCKS[k], homestead: false });
  }

  // Channels run from the foothills across the meadow, toward a pond or away into the meadow.
  const channels: Array<[Vector3[], Vector3[], Vector3[]]> = [];
  for (let k = 0; k < channelCount; k++) {
    const foot = slerpUnit(rangeA, rangeB, 0.12 + 0.76 * rand(), new Vector3());
    const start = travel(foot, tangentToward(foot, cottage, new Vector3()), RANGE_OUTER + 0.03, new Vector3());
    let end: Vector3;
    const target = pondCentres[k];
    if (target && angleBetween(start, target) < 2.2) end = target.clone();
    else end = travel(start, turn(start, tangentToward(start, cottage, new Vector3()), (rand() - 0.5) * 2.2), 0.9 + 0.7 * rand(), new Vector3());
    const base: Vector3[] = [];
    const nodes = 6;
    for (let i = 0; i < nodes; i++) {
      const p = slerpUnit(start, end, i / (nodes - 1), new Vector3());
      if (i > 0 && i < nodes - 1) {
        const side = new Vector3().crossVectors(p, new Vector3().subVectors(end, start)).normalize();
        travel(p, side, (rand() - 0.5) * 0.14, p);
      }
      base.push(p);
    }
    // keep the homestead clear: push nodes away from the cottage
    for (const p of base) {
      const a = angleBetween(p, cottage);
      if (a < 0.16) travel(p, tangentToward(p, cottage, new Vector3()).negate(), 0.16 - a, p);
    }
    const level1 = meander(base, 0.32, rand);
    const level2 = meander(level1, 0.36, rand);
    channels.push([base, level1, level2]);
  }
  let branch: Vector3[] | null = null;
  const trunk = channels[0]?.[2];
  if (trunk && trunk.length > 8) {
    const from = trunk[Math.floor(trunk.length * 0.45)];
    const next = trunk[Math.floor(trunk.length * 0.45) + 1];
    const dir = turn(from, tangentToward(from, next, new Vector3()), rand() < 0.5 ? 0.75 : -0.75);
    const to = travel(from, dir, 0.45 + 0.2 * rand(), new Vector3());
    const base = [from.clone(), slerpUnit(from, to, 0.5, new Vector3()), to];
    branch = meander(meander(base, 0.3, rand), 0.35, rand);
  }

  return { seed, noiseSeed, cottage, homeBearing, range, spur, ponds, islets, channels, branch };
}

// ---- R-dependent state and evaluation ------------------------------------

export interface GroundSample {
  /** Height above the base sphere R, m. */
  height: number;
  /** Signed distance to water, m (negative inside). */
  water: number;
  /** Mountain mask, 0..1. */
  mountain: number;
  /** Mountain height as a fraction of its maximum, 0..1. */
  rock: number;
  /** Cottage clearing (no grass, flowers or stones), 0..1. */
  clearing: number;
}

export interface TerrainParams {
  meadowRoll: number;
  mountainHeight: number;
  channelWidth: number;
}

/** 0 → 1 as the top of the growth band passes the radius where the area reaches `area`. */
export function unlockAtArea(lnRHi: number, area: number): number {
  return clamp((lnRHi - Math.log(Math.sqrt(area / (4 * Math.PI)))) / 0.22, 0, 1);
}

/** Meters → amplitude weight of a meadow octave whose bumps are `w` meters apart. */
export function meadowSpectrum(w: number): number {
  return smoothstep(4, 12, w) * (1 - smoothstep(110, 280, w)) * Math.sqrt(w / 40);
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpT1 = new Vector3();
const tmpT2 = new Vector3();

export class Terrain {
  radius = R_REF;
  readonly meadowAmp = new Float32Array(MEADOW_OCTAVES);
  macroAmp = 0;
  mountainH = 0;
  halfWidth = 1.3;
  meander1 = 0;
  meander2 = 0;
  branchUnlock = 0;
  spurUnlock = 0;
  /** Per pond: centre, tangent frame, radius (m, × unlock; 0 = off), water level (m). */
  readonly pondCentre: Vector3[] = Array.from({ length: MAX_PONDS }, () => new Vector3());
  readonly pondT1: Vector3[] = Array.from({ length: MAX_PONDS }, () => new Vector3());
  readonly pondRadius = new Float32Array(MAX_PONDS);
  readonly pondLevel = new Float32Array(MAX_PONDS);
  cottageLevel = 0;

  constructor(public layout: Layout) {}

  /** Refresh everything that depends on R and the growth band (cheap; every frame). */
  update(radius: number, lnRHi: number, p: TerrainParams): void {
    this.radius = radius;
    for (let k = 0; k < MEADOW_OCTAVES; k++) {
      const freq = MEADOW_BASE_FREQ * 2 ** k;
      this.meadowAmp[k] = 0.55 * p.meadowRoll * meadowSpectrum(radius / freq);
    }
    this.macroAmp = 0.004 * radius;
    this.mountainH = p.mountainHeight * radius;
    this.halfWidth = 0.5 * p.channelWidth;
    this.meander1 = clamp((lnRHi - Math.log(MEANDER_RADII[0])) / 0.3, 0, 1);
    this.meander2 = clamp((lnRHi - Math.log(MEANDER_RADII[1])) / 0.3, 0, 1);
    this.branchUnlock = this.layout.branch ? unlockAtArea(lnRHi, UNLOCK.branch) : 0;
    this.spurUnlock = unlockAtArea(lnRHi, UNLOCK.spur);

    const L = this.layout;
    for (let i = 0; i < MAX_PONDS; i++) {
      const pond = L.ponds[i];
      if (!pond) {
        this.pondRadius[i] = 0;
        continue;
      }
      const unlock = pond.unlockArea === 0 ? 1 : unlockAtArea(lnRHi, pond.unlockArea);
      const r = pond.radius0 * Math.pow(radius / R_REF, 0.3);
      if (pond.homestead) travel(L.cottage, L.homeBearing, (r + COTTAGE_TO_POND) / radius, this.pondCentre[i]);
      else this.pondCentre[i].copy(pond.centre);
      tangentToward(this.pondCentre[i], pond.homestead ? L.cottage : L.range.a, this.pondT1[i]);
      this.pondRadius[i] = r * unlock;
    }
    // Water levels: a little below the lowest meadow around each pond.
    for (let i = 0; i < MAX_PONDS; i++) {
      const r = this.pondRadius[i];
      if (r <= 0) continue;
      let low = Infinity;
      const c = this.pondCentre[i];
      tmpT2.crossVectors(c, this.pondT1[i]);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        tmpA.copy(this.pondT1[i]).multiplyScalar(Math.cos(a)).addScaledVector(tmpT2, Math.sin(a));
        travel(c, tmpA, (r * 1.15) / radius, tmpB);
        low = Math.min(low, this.landHeight(tmpB));
      }
      this.pondLevel[i] = low - 0.22;
    }
    this.cottageLevel = Math.max(this.landHeight(L.cottage), this.pondLevel[0] + 0.45);
  }

  /** Meadow roll + macro swell + mountains, before water and the clearing. */
  landHeight(dir: Vector3): number {
    return this.meadowHeight(dir) + this.mountainAt(dir, null);
  }

  meadowHeight(dir: Vector3): number {
    const seed = this.layout.noiseSeed;
    let h = 0;
    for (let k = 0; k < MEADOW_OCTAVES; k++) {
      const amp = this.meadowAmp[k];
      if (amp < 1e-4) continue;
      const f = MEADOW_BASE_FREQ * 2 ** k;
      h += amp * gnoise(dir.x * f, dir.y * f, dir.z * f, seed + k);
    }
    h += this.macroAmp * gnoise(dir.x * 1.2, dir.y * 1.2, dir.z * 1.2, seed + 20);
    // ponds and the cottage sit in calmer ground
    let calm = smoothstep(16, 7, angleBetween(dir, this.layout.cottage) * this.radius);
    for (let i = 0; i < MAX_PONDS; i++) {
      const r = this.pondRadius[i];
      if (r > 0) calm = Math.max(calm, smoothstep(r * 2.2, r * 1.1, angleBetween(dir, this.pondCentre[i]) * this.radius));
    }
    return h * (1 - 0.7 * calm);
  }

  /** Mountain height (m); writes mask and height fraction into `out` when given. */
  mountainAt(dir: Vector3, out: GroundSample | null): number {
    const L = this.layout;
    const seed = L.noiseSeed;
    const wobble = 0.05 * gnoise(dir.x * 5, dir.y * 5, dir.z * 5, seed + 30);
    const d = arcDistance(dir, L.range) + wobble;
    let mask = smoothstep(RANGE_OUTER, RANGE_INNER, d);
    let crest = 1 - smoothstep(0, RANGE_OUTER, d);
    if (this.spurUnlock > 0) {
      const ds = arcDistance(dir, L.spur) + wobble;
      const ms = smoothstep(RANGE_OUTER * 0.8, RANGE_INNER * 0.6, ds) * this.spurUnlock;
      if (ms > mask) {
        mask = ms;
        crest = (1 - smoothstep(0, RANGE_OUTER * 0.8, ds)) * 0.7;
      }
    }
    let h = 0;
    if (mask > 0) {
      let ridge = 0;
      for (let o = 0; o < 5; o++) {
        const f = 3.5 * 2 ** o;
        const n = 1 - Math.abs(gnoise(dir.x * f, dir.y * f, dir.z * f, seed + 40 + o));
        ridge += n * n * 0.55 ** o;
      }
      ridge /= 2.07;
      h = this.mountainH * mask * (0.22 + 0.78 * crest ** 1.5) * (0.3 + 0.7 * ridge);
    }
    if (out) {
      out.mountain = mask;
      out.rock = this.mountainH > 0 ? h / this.mountainH : 0;
    }
    return h;
  }

  /** Signed distance to channel water, m. */
  channelDistance(dir: Vector3): number {
    const L = this.layout;
    let d0 = 0.25;
    let d1 = 0.25;
    let d2 = 0.25;
    for (const [l0, l1, l2] of L.channels) {
      d0 = Math.min(d0, polylineDistance(dir, l0));
      d1 = Math.min(d1, polylineDistance(dir, l1));
      d2 = Math.min(d2, polylineDistance(dir, l2));
    }
    const d = mixf(mixf(d0, d1, this.meander1), d2, this.meander2);
    let s = d * this.radius - this.halfWidth;
    if (L.branch) {
      const db = polylineDistance(dir, L.branch);
      s = Math.min(s, db * this.radius - this.halfWidth * 0.8 * this.branchUnlock + (1 - this.branchUnlock) * 0.5);
    }
    return s;
  }

  /** Signed distance to pond i (m), islets excluded; 1e6 when the pond is off, a lower bound when far. */
  pondDistance(dir: Vector3, i: number): number {
    const r = this.pondRadius[i];
    const pond = this.layout.ponds[i];
    if (r <= 0 || !pond) return 1e6;
    const c = this.pondCentre[i];
    const cosA = dir.dot(c);
    // far from the pond (outline reaches at most ~1.4 r): a cheap lower bound
    const away = 2 * Math.asin(Math.min(1, 0.5 * dir.distanceTo(c))) * this.radius - 1.45 * r;
    if (cosA < 0 || away > 2) return Math.max(away, 2);
    tmpT2.crossVectors(c, this.pondT1[i]);
    tmpA.copy(dir).addScaledVector(c, -cosA);
    const x = (tmpA.dot(this.pondT1[i]) * this.radius) / r;
    const y = (tmpA.dot(tmpT2) * this.radius) / r;
    const rho = Math.hypot(x, y);
    const th = Math.atan2(y, x);
    const [a1, a2, a3, p1, p2, p3] = pond.shape;
    let sdf = (rho - (1 + a1 * Math.cos(th - p1) + a2 * Math.cos(2 * th - p2) + a3 * Math.cos(3 * th - p3))) * r;
    for (let k = 0; k < pond.isletCount; k++) {
      const [ix, iy, ir] = this.layout.islets[pond.isletStart + k];
      sdf = Math.max(sdf, -(Math.hypot(x - ix, y - iy) - ir) * r);
    }
    return sdf;
  }

  /** Full ground sample at a direction. Mirrors sampleGround() in terrain.glsl. */
  sample(dir: Vector3, out: GroundSample): GroundSample {
    let h = this.meadowHeight(dir) + this.mountainAt(dir, out);
    const dc = angleBetween(dir, this.layout.cottage) * this.radius;
    const flat = smoothstep(COTTAGE_FLAT + 3.5, COTTAGE_FLAT, dc);
    h += (this.cottageLevel - h) * flat;
    out.clearing = smoothstep(COTTAGE_FLAT, COTTAGE_FLAT - 1.2, dc);
    const sc = this.channelDistance(dir) + 4 * out.mountain + 6 * flat;
    let water = sc;
    h -= 0.24 * smoothstep(0.7, -0.2, sc);
    for (let i = 0; i < MAX_PONDS; i++) {
      const sp = this.pondDistance(dir, i);
      if (sp > 1e5) continue;
      water = Math.min(water, sp);
      const bank = smoothstep(0.6, -0.35, sp);
      h += (this.pondLevel[i] - h) * bank;
    }
    out.height = h;
    out.water = water;
    return out;
  }

  height(dir: Vector3): number {
    return this.sample(dir, scratch).height;
  }

  /** Uniform values for terrain.glsl (shared by every material that samples the ground). */
  writeUniforms(u: TerrainUniforms): void {
    const L = this.layout;
    u.uTerrainSeed.value = L.noiseSeed;
    u.uMeadowAmp.value.set(this.meadowAmp);
    u.uMacroAmp.value = this.macroAmp;
    u.uMountain.value.set(this.mountainH, this.spurUnlock, 0, 0);
    u.uRangeA.value.copy(L.range.a);
    u.uRangeB.value.copy(L.range.b);
    u.uSpurA.value.copy(L.spur.a);
    u.uSpurB.value.copy(L.spur.b);
    u.uWater.value.set(this.halfWidth, this.meander1, this.meander2, L.branch ? this.branchUnlock : 0);
    for (let i = 0; i < MAX_PONDS; i++) {
      const pond = L.ponds[i];
      const c = this.pondCentre[i];
      u.uPondA.value[i].set(c.x, c.y, c.z, pond ? this.pondRadius[i] : 0);
      const t = this.pondT1[i];
      u.uPondB.value[i].set(t.x, t.y, t.z, this.pondLevel[i]);
      const s = pond?.shape ?? [0, 0, 0, 0, 0, 0];
      u.uPondC.value[i].set(s[0], s[1], s[2], pond?.isletStart ?? 0);
      u.uPondD.value[i].set(s[3], s[4], s[5], pond?.isletCount ?? 0);
    }
    for (let k = 0; k < MAX_ISLETS; k++) {
      const islet = L.islets[k];
      u.uIslets.value[k].set(islet?.[0] ?? 0, islet?.[1] ?? 0, islet?.[2] ?? 0, 0);
    }
    u.uCottage.value.set(L.cottage.x, L.cottage.y, L.cottage.z, this.cottageLevel);
  }
}

const scratch: GroundSample = { height: 0, water: 0, mountain: 0, rock: 0, clearing: 0 };
const mixf = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Angular distance from p to a polyline of great-circle segments (capped at 0.25 rad). */
export function polylineDistance(p: Vector3, points: readonly Vector3[]): number {
  let best = 0.25;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    // cheap reject: far from both ends and the segment is short
    best = Math.min(best, arcDistance(p, { a, b, n: tmpT1.crossVectors(a, b).normalize() }));
  }
  return best;
}

export interface TerrainUniforms {
  uTerrainSeed: { value: number };
  uMeadowAmp: { value: Float32Array };
  uMacroAmp: { value: number };
  uMountain: { value: Vector4 };
  uRangeA: { value: Vector3 };
  uRangeB: { value: Vector3 };
  uSpurA: { value: Vector3 };
  uSpurB: { value: Vector3 };
  uWater: { value: Vector4 };
  uPondA: { value: Vector4[] };
  uPondB: { value: Vector4[] };
  uPondC: { value: Vector4[] };
  uPondD: { value: Vector4[] };
  uIslets: { value: Vector4[] };
  uCottage: { value: Vector4 };
}

export function createTerrainUniforms(): TerrainUniforms {
  const v4s = (n: number): Vector4[] => Array.from({ length: n }, () => new Vector4());
  return {
    uTerrainSeed: { value: 0 },
    uMeadowAmp: { value: new Float32Array(MEADOW_OCTAVES) },
    uMacroAmp: { value: 0 },
    uMountain: { value: new Vector4() },
    uRangeA: { value: new Vector3(1, 0, 0) },
    uRangeB: { value: new Vector3(0, 1, 0) },
    uSpurA: { value: new Vector3(1, 0, 0) },
    uSpurB: { value: new Vector3(0, 0, 1) },
    uWater: { value: new Vector4(1.3, 0, 0, 0) },
    uPondA: { value: v4s(MAX_PONDS) },
    uPondB: { value: v4s(MAX_PONDS) },
    uPondC: { value: v4s(MAX_PONDS) },
    uPondD: { value: v4s(MAX_PONDS) },
    uIslets: { value: v4s(MAX_ISLETS) },
    uCottage: { value: new Vector4(0, 1, 0, 0) },
  };
}
