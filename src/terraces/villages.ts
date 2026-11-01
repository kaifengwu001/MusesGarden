import { DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3, Vector4 } from 'three';
import { hash32, mix, salt, unit } from '../core/hash';
import { uvToSphere } from '../planet/cubesphere';
import { angleBetween, travel } from '../planet/geo';
import { enumerateCell } from '../planet/rest';
import { gradientFrame } from './fields';
import { createTerraceSample, TERRACE, type TerraceTerrain } from './terrain';

// Villages (ARCHITECTURE.md, "Land use", 6). Sites come from a progressive
// point set (a constant number per km² as the planet grows) and are kept on
// gentle terraced ground just below a forest edge, as the Hani lay them out:
// the forest above, the village, the terraces below. Houses stand on terrace
// floors round the site: each level is flat, so a house stands level on it,
// along the contour, its front facing downhill. Its ground is courtyard, not
// paddy (ground.glsl reads the houses).

export const VILLAGES = { density: 1 / 9000, max: 12, houses: [3, 9], spacing: 2.6, reach: 26, search: 64 } as const;
export const MAX_HOUSES = 96;
export const villageClass = { salt: salt('villages'), jitter: 0.9 } as const;

export interface House {
  /** Its middle (unit direction), its length's way (along the contour) and its front's (downhill), unit tangents. */
  readonly dir: Vector3;
  readonly along: Vector3;
  readonly front: Vector3;
  /** The terrace floor it stands on (m), and its length, depth and walls' height (m). */
  readonly floor: number;
  readonly length: number;
  readonly depth: number;
  readonly wall: number;
  readonly seed: number;
}

export interface Village {
  readonly dir: Vector3;
  /** How far from its site its houses and courtyards reach (m). */
  readonly radius: number;
  readonly houses: House[];
}

const s = createTerraceSample();
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

/** Whether a spot suits a village: gentle terraced ground on the slopes (floors wide enough for a house), a forest edge above it, no peak near. */
function suits(terrain: TerraceTerrain, d: Vector3): boolean {
  const R = terrain.radius;
  terrain.terraceAt(d, s);
  if (s.wild > 0.15 || s.slope < 0.03 || s.slope > 0.21 || s.natural < 2.5) return false;
  for (const pk of terrain.fields.peaks) if (angleBetween(d, pk.dir) * R < pk.radius * 1.6 + 12) return false;
  uphill(terrain, d, up);
  for (let dist = 8; dist <= 56; dist += 6) {
    terrain.terraceAt(travel(d, up, dist / R, q), s);
    if (s.wild > 0.6) return true;
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
 * The houses round a site: candidates on a loose spiral out from it, each
 * moved across its band to the middle of the floor, kept where the floor is
 * deep enough for it and it clears the others.
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
  const golden = Math.PI * (3 - Math.sqrt(5));
  gradientFrame(site, a, b);
  for (let k = 0; k < 40 && houses.length < want; k++) {
    const angle = golden * k + rand() * 0.6;
    const r = k === 0 ? 0 : 3 + 3.4 * Math.sqrt(k) + rand() * 2;
    if (r > VILLAGES.reach) break;
    t0.copy(a).multiplyScalar(Math.cos(angle)).addScaledVector(b, Math.sin(angle));
    travel(site, t0, r / R, c);
    terrain.terraceAt(c, s);
    if (s.wild > 0.25) continue;
    const band = TERRACE.step / Math.max(s.slope, 0.01);
    const wr = Math.min(Math.min(TERRACE.riser, 0.33 * band) / band, 0.6);
    const wb = Math.min(TERRACE.bund / band, 0.3);
    const floorWidth = band * (1 - wr - wb);
    const depth = 2.8 + 0.9 * rand();
    if (floorWidth < depth + 0.9) continue;
    // to the middle of the floor, across the band
    const level = s.level;
    const target = wb + 0.5 * (1 - wr - wb);
    uphill(terrain, c, up);
    travel(c, up, ((target - s.f) * band) / R, c);
    terrain.terraceAt(c, s);
    if (s.level !== level || s.wild > 0.25 || s.rise > 0.02 || s.bund > 0.02) continue;
    const length = 4.4 + 3.2 * rand();
    const wall = 2.5 + 0.6 * rand();
    uphill(terrain, c, up);
    const front = up.clone().negate();
    const along = new Vector3().crossVectors(c, front).normalize();
    const clear = houses.every((o) => angleBetween(o.dir, c) * R > 0.5 * (Math.max(o.length, o.depth) + Math.max(length, depth)) + VILLAGES.spacing);
    if (!clear) continue;
    dirTo.copy(c);
    houses.push({ dir: dirTo.clone(), along, front, floor: s.floorH, length, depth, wall, seed: hash32(h ^ k) });
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
      data.set([h.dir.x, h.dir.y, h.dir.z, h.floor, h.along.x, h.along.y, h.along.z, h.length, h.front.x, h.front.y, h.front.z, h.depth], n * 12);
      n++;
    }
  }
  u.uHouses.value.needsUpdate = true;
}
