import { DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3, Vector4 } from 'three';
import { hash32, mix, salt, unit } from '../core/hash';
import { uvToSphere } from '../planet/cubesphere';
import { angleBetween, travel } from '../planet/geo';
import { enumerateCell } from '../planet/rest';
import { gradientFrame } from './fields';
import { createTerraceSample, type TerraceTerrain } from './terrain';

// Villages (ARCHITECTURE.md, "Land use", 6). Sites come from a progressive
// point set (a constant number per km² as the planet grows) and are kept on
// a valley's flat floor near the foot of the hills (Kai's note after the
// second pass: villages on the flatter land), among its plots. Houses stand
// round the site, each level on the plot under it, its front facing down the
// valley's gentle fall. Its ground is courtyard, not paddy (ground.glsl and
// the ground's paint read the houses).

export const VILLAGES = { density: 1 / 15000, max: 8, houses: [3, 6], spacing: 0, reach: 26, search: 64 } as const;
/** Kai's house models (houses.ts): each one's footprint with its yard (× its height), and its height (m). */
export const HOUSE_MODELS = [
  { x: 1.88, z: 1.82, height: 6.2 },
  { x: 1.36, z: 1.19, height: 8.4 },
  { x: 1.18, z: 1.47, height: 8.0 },
  { x: 1.65, z: 1.75, height: 6.6 },
  { x: 1.03, z: 1.45, height: 7.4 },
] as const;
export const MAX_HOUSES = 96;
/** A house's courtyard (cleared of plots, painted packed earth) covers this share of its model's footprint: the model's own yard covers the rest. */
export const YARD = 0.7;
export const villageClass = { salt: salt('villages'), jitter: 0.9 } as const;

export interface House {
  /** Its middle (unit direction), its length's way (along the contour) and its front's (downhill), unit tangents. */
  readonly dir: Vector3;
  readonly along: Vector3;
  readonly front: Vector3;
  /** The terrace floor it stands on (m), and its length, depth (with its yard) and walls' height (m). */
  readonly floor: number;
  readonly length: number;
  readonly depth: number;
  readonly wall: number;
  readonly seed: number;
  /** Which of Kai's house models stands there (HOUSE_MODELS), and its height (m). */
  readonly model: number;
  readonly height: number;
}

export interface Village {
  readonly dir: Vector3;
  /** How far from its site its houses and courtyards reach (m). */
  readonly radius: number;
  readonly houses: House[];
}

const s = createTerraceSample();
const base = { natural: 0, slope: 0, wild: 0, flat: 0 };
const a = new Vector3();
const b = new Vector3();
const q = new Vector3();
const up = new Vector3();

/** The uphill way at a direction (unit tangent), from the hills' own height. */
function uphill(terrain: TerraceTerrain, d: Vector3, out: Vector3): Vector3 {
  gradientFrame(d, a, b);
  const e = 2 / terrain.radius;
  const h0 = terrain.fields.natural(d);
  const ha = terrain.fields.natural(q.copy(d).addScaledVector(a, e).normalize()) - h0;
  const hb = terrain.fields.natural(q.copy(d).addScaledVector(b, e).normalize()) - h0;
  out.copy(a).multiplyScalar(ha).addScaledVector(b, hb);
  return out.lengthSq() > 1e-12 ? out.normalize() : out.copy(a);
}

/** Whether a spot suits a village: a valley's flat floor, the foot of the hills near uphill, no peak near. */
function suits(terrain: TerraceTerrain, d: Vector3): boolean {
  const R = terrain.radius;
  const b = terrain.fields.base(d, base);
  // (on the flats, not in the river: 1 … 2 there)
  if (b.wild > 0.15 || b.flat < 0.75 || b.flat > 1) return false;
  for (const pk of terrain.fields.peaks) if (angleBetween(d, pk.dir) * R < pk.radius * 1.6 + 12) return false;
  uphill(terrain, d, up);
  for (let dist = 10; dist <= 60; dist += 10) {
    if (terrain.fields.base(travel(d, up, dist / R, q), base).flat < 0.3) return true;
  }
  return false;
}

/** A spot near a site that suits a village (the site itself first, then a loose spiral out from it), or null. */
function spotNear(terrain: TerraceTerrain, site: Vector3, out: Vector3): Vector3 | null {
  const R = terrain.radius;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const t0 = new Vector3();
  gradientFrame(site, a, b);
  for (let k = 0; k < 36; k++) {
    const r = VILLAGES.search * Math.sqrt(k / 36);
    t0.copy(a).multiplyScalar(Math.cos(golden * k)).addScaledVector(b, Math.sin(golden * k));
    travel(site, t0, r / R, out);
    if (suits(terrain, out)) return out;
  }
  return null;
}

/**
 * The houses round a site: candidates on a loose spiral out from it, kept on
 * the flat floor where they clear the others, each level on the plot under it.
 */
function housesAt(terrain: TerraceTerrain, site: Vector3, seed: number): House[] {
  const R = terrain.radius;
  let h = hash32(seed ^ 0x2545f491);
  const rand = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
  const want = VILLAGES.houses[0] + Math.floor(rand() * (VILLAGES.houses[1] - VILLAGES.houses[0] + 1));
  const houses: House[] = [];
  const t0 = new Vector3();
  const dirTo = new Vector3();
  const c = new Vector3();
  const corner = new Vector3();
  const golden = Math.PI * (3 - Math.sqrt(5));
  gradientFrame(site, a, b);
  for (let k = 0; k < 40 && houses.length < want; k++) {
    const angle = golden * k + rand() * 0.6;
    // (Kai: the villages close together, the houses in a huddle, not dispersed)
    const r = k === 0 ? 0 : 3 + 4.4 * Math.sqrt(k) + rand() * 1.5;
    if (r > VILLAGES.reach) break;
    t0.copy(a).multiplyScalar(Math.cos(angle)).addScaledVector(b, Math.sin(angle));
    travel(site, t0, r / R, c);
    terrain.terraceAt(c, s);
    // (on the flats, never in the river: 1 … 2 there)
    if (s.wild > 0.2 || s.flatness < 0.6 || s.flatness > 1) continue;
    const floor = s.natural;
    const model = Math.floor(rand() * HOUSE_MODELS.length);
    const M = HOUSE_MODELS[model];
    const height = M.height * (0.9 + 0.2 * rand());
    const length = M.x * height;
    const depth = M.z * height;
    const wall = 0.45 * height;
    uphill(terrain, c, up);
    const front = up.clone().negate();
    const along = new Vector3().crossVectors(c, front).normalize();
    // (neighbours' yards may meet and overlap a little: a huddle, the houses themselves apart)
    const clear = houses.every((o) => angleBetween(o.dir, c) * R > 0.4 * (Math.max(o.length, o.depth) + Math.max(length, depth)) + VILLAGES.spacing);
    if (!clear) continue;
    // and all of its yard on dry, tame ground: its corners too off the river and out of the woods
    let dry = true;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      t0.copy(along).multiplyScalar(u * length).addScaledVector(front, v * depth);
      const len = t0.length();
      if (len > 1e-6) travel(c, t0.divideScalar(len), len / R, corner);
      terrain.terraceAt(corner, s);
      if (s.flatness > 1 || s.wild > 0.45) dry = false;
    }
    if (!dry) continue;
    dirTo.copy(c);
    houses.push({ dir: dirTo.clone(), along, front, floor, length, depth, wall, seed: hash32(h ^ k), model, height });
  }
  return houses;
}

/** The villages of a planet at its size (sites born by the point set, kept where they suit). */
export function placeVillages(terrain: TerraceTerrain): Village[] {
  const R = terrain.radius;
  const seed = terrain.layout.noiseSeed;
  const sites: Array<{ dir: Vector3; threshold: number; seed: number }> = [];
  const d = new Vector3();
  for (let face = 0; face < 6; face++) {
    enumerateCell(villageClass, seed, face, 0, 0, 0, VILLAGES.density * R * R, (p) => {
      uvToSphere(p.face, p.u, p.v, d);
      sites.push({ dir: d.clone(), threshold: p.threshold, seed: p.seed });
    });
  }
  sites.sort((x, y) => x.threshold - y.threshold);
  const villages: Village[] = [];
  let count = 0;
  const spot = new Vector3();
  for (const site of sites) {
    if (villages.length >= VILLAGES.max) break;
    if (!spotNear(terrain, site.dir, spot)) continue;
    if (villages.some((v) => angleBetween(v.dir, spot) * R < 70)) continue;
    const houses = housesAt(terrain, spot, mix(site.seed, 7));
    if (houses.length < VILLAGES.houses[0] || count + houses.length > MAX_HOUSES) continue;
    count += houses.length;
    let reach = 0;
    for (const hs of houses) reach = Math.max(reach, angleBetween(spot, hs.dir) * R + 0.5 * hs.length + 4);
    villages.push({ dir: spot.clone(), radius: reach, houses });
  }
  return villages;
}

const off = new Vector3();

/** Distance (m) from a direction to the nearest house's footprint, 1e9 in no village (village.glsl houseDistance's twin). */
export function houseDistance(villages: readonly Village[], dir: Vector3, R: number): number {
  let best = 1e9;
  for (const v of villages) {
    if (angleBetween(dir, v.dir) * R > v.radius) continue;
    for (const h of v.houses) {
      off.subVectors(dir, h.dir).multiplyScalar(R);
      const qx = Math.abs(off.dot(h.along)) - 0.5 * YARD * h.length;
      const qy = Math.abs(off.dot(h.front)) - 0.5 * YARD * h.depth;
      best = Math.min(best, Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0));
    }
  }
  return best;
}

/** The villages for the ground shader: discs (direction, reach in m) and each one's houses (first, count), and the houses' texture. */
export interface VillageUniforms {
  uVillages: { value: Vector4[] };
  uVillageHouses: { value: Vector4[] };
  uHouses: { value: DataTexture };
}

export function createVillageUniforms(): VillageUniforms {
  const texture = new DataTexture(new Float32Array(3 * MAX_HOUSES * 4), 3, MAX_HOUSES, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  return {
    uVillages: { value: Array.from({ length: VILLAGES.max }, () => new Vector4(0, 1, 0, -1)) },
    uVillageHouses: { value: Array.from({ length: VILLAGES.max }, () => new Vector4()) },
    uHouses: { value: texture },
  };
}

/** Write the villages and their houses (texels: direction and floor; along and length; front and depth). */
export function writeVillageUniforms(villages: readonly Village[], u: VillageUniforms): void {
  const data = u.uHouses.value.image.data as Float32Array;
  data.fill(0);
  let n = 0;
  for (let i = 0; i < VILLAGES.max; i++) {
    const v = villages[i];
    if (!v) {
      u.uVillages.value[i].set(0, 1, 0, -1);
      u.uVillageHouses.value[i].set(0, 0, 0, 0);
      continue;
    }
    u.uVillages.value[i].set(v.dir.x, v.dir.y, v.dir.z, v.radius);
    u.uVillageHouses.value[i].set(n, v.houses.length, 0, 0);
    for (const h of v.houses) {
      data.set([h.dir.x, h.dir.y, h.dir.z, h.floor, h.along.x, h.along.y, h.along.z, YARD * h.length, h.front.x, h.front.y, h.front.z, YARD * h.depth], n * 12);
      n++;
    }
  }
  u.uHouses.value.needsUpdate = true;
}
