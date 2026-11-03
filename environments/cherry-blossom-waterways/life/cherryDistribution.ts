import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { travel } from '../../../src/planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { HOMESTEAD_VIEW } from '../view/homestead';

export interface CherrySite {
  dir: Vector3;
  height: number;
  scale: number;
  turn: number;
  variant: number;
  id: number;
}

/** The most trees a planet holds; the scenery, shadow and petal batches are sized to it. */
export const MAX_TREES = 3200;
/**
 * Tree sizes (× the habit's template, 6.7–10.1 m tall at 1): each tree's one
 * uniform size draw spreads evenly across this range, so young saplings and
 * broad old giants grow side by side.
 */
export const TREE_SCALE = [0.75, 2.05] as const;
/** The most the ground may rise across a root footprint (m). */
export const ROOT_SPREAD = 0.35;
/** Shore distances (m) within which groves fill in, and willows may stand. */
const BANK = { grove: 16, willow: 12.5 } as const;
const treeScale = (u: number): number => TREE_SCALE[0] + u * (TREE_SCALE[1] - TREE_SCALE[0]);
/**
 * Near the pavilion, the opening view looks across the banks at it. Within
 * `reach` (m) of that sight line, in plan, no tree stands over the first
 * `open` of it from the pavilion (the blossom clouds would hide it), and
 * nearer the camera a tree grows no larger than `scale`, framing the view.
 * Elsewhere a crown reaches about `crown` (m × scale) and stops short of the
 * pavilion's roof, the box trunks already keep out of (cottage-local x, z, m).
 */
const HOME = { reach: 7, open: 0.8, scale: 0.95, crown: 5, roof: [-6.7, 6.7, -5.5, 12] } as const;
const SIGHT = {
  x: HOMESTEAD_VIEW.at[0], z: HOMESTEAD_VIEW.at[2],
  dx: HOMESTEAD_VIEW.distance * Math.sin(HOMESTEAD_VIEW.azimuth), dz: HOMESTEAD_VIEW.distance * Math.cos(HOMESTEAD_VIEW.azimuth),
} as const;

/**
 * The largest a tree at cottage-local (x, z) may grow, or 0 where none may
 * stand: off the opening view's sight line, its crown off the roof.
 */
export function homeScaleLimit(x: number, z: number): number {
  const along = Math.min(1, Math.max(0, ((x - SIGHT.x) * SIGHT.dx + (z - SIGHT.z) * SIGHT.dz) / (SIGHT.dx ** 2 + SIGHT.dz ** 2)));
  const sight = Math.hypot(x - SIGHT.x - along * SIGHT.dx, z - SIGHT.z - along * SIGHT.dz);
  if (sight < HOME.reach && along < HOME.open) return 0;
  const roof = Math.hypot(Math.max(HOME.roof[0] - x, 0, x - HOME.roof[1]), Math.max(HOME.roof[2] - z, 0, z - HOME.roof[3]));
  return Math.max(TREE_SCALE[0], Math.min(sight < HOME.reach ? HOME.scale : Infinity, roof / HOME.crown));
}

/** Stable direction candidates. The support surface admits trees, never their crowns. */
export function cherrySites(terrain: Terrain): CherrySite[] {
  const R = terrain.radius, L = terrain.layout;
  let state = hash32(L.seed ^ 0xcca491);
  const rand = (): number => unit(state = hash32(state + 0x9e3779b9));
  const sites: CherrySite[] = [], sample = createGroundSample();
  const east = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
  const support = new Vector3(), side = new Vector3(), ahead = new Vector3(), probeAxis = new Vector3();
  const local = { x: 0, z: 0 };
  // Admitted trunks bucketed by direction in cells as wide as the widest spacing,
  // so the spacing test reads only the 27 cells about a candidate.
  const cell = 1.75 * 2 * TREE_SCALE[1] / R, cells = new Map<string, CherrySite[]>();
  const cellOf = (dir: Vector3, dx = 0, dy = 0, dz = 0): string => `${Math.floor(dir.x / cell) + dx},${Math.floor(dir.y / cell) + dy},${Math.floor(dir.z / cell) + dz}`;
  const crowded = (dir: Vector3, scale: number): boolean => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const s of cells.get(cellOf(dir, dx, dy, dz)) ?? []) {
        if (s.dir.distanceToSquared(dir) * R * R < Math.pow(1.75 * (scale + s.scale), 2)) return true;
      }
    }
    return false;
  };
  const admit = (dir: Vector3, id: number, drawn: number, turn: number, variant: number): void => {
    terrain.sample(dir, sample);
    if (sample.depth > 0 || sample.water < 0.9 || sample.clearing > 0.02 || sample.height < 0.24) return;
    const dc = dir.distanceTo(L.cottage) * R;
    let scale = drawn;
    if (dc < 13) {
      terrain.cottageLocal(dir, local);
      if (local.x > HOME.roof[0] && local.x < HOME.roof[1] && local.z > HOME.roof[2] && local.z < HOME.roof[3]) return;
    }
    // Keep a generous pedestrian opening from the pavilion along its right bank, and the opening view clear.
    if (dc < 45) {
      terrain.cottageLocal(dir, local);
      const pathX = 8.5 + Math.sin(local.z * 0.075) * 3;
      if (local.z > -6 && Math.abs(local.x - pathX) < 2.3) return;
      const limit = homeScaleLimit(local.x, local.z);
      if (limit === 0) return;
      scale = Math.min(scale, limit);
    }
    const h = sample.height;
    // Trunks keep apart by their mean size, so a sapling never stands inside a giant's roots.
    if (crowded(dir, scale)) return;
    side.crossVectors(dir, Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    ahead.crossVectors(dir, side);
    // The actual five root toes reach about one scaled meter from the trunk.
    // Eight probes enclose their footprint; checking only half a meter admitted
    // trees whose low-side toes hovered over a steep bank. On a gentle slope the
    // trunk stands at its lowest probe, so no toe floats and the uphill roots
    // run into the ground; a steeper footprint is rejected.
    let low = h, high = h;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      probeAxis.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(ahead, Math.sin(angle));
      terrain.sample(travel(dir, probeAxis, 1.1 * scale / R, support), sample);
      if (sample.depth > 0) return;
      low = Math.min(low, sample.height); high = Math.max(high, sample.height);
      if (high - low > ROOT_SPREAD) return;
    }
    const site = { dir: dir.clone(), height: low - 0.065, scale, turn, variant, id };
    sites.push(site);
    const key = cellOf(dir), bucket = cells.get(key);
    if (bucket) bucket.push(site); else cells.set(key, [site]);
  };

  // Authored banks around the water garden, with unequal group spacing and open views.
  for (let i = 0; i < 145; i++) {
    const a = rand() * Math.PI * 2;
    const r = 12 + Math.pow(rand(), 0.65) * 49;
    const x = Math.cos(a) * r - 5, z = Math.sin(a) * r + 12;
    const dir = travel(travel(L.cottage, east, x / R, new Vector3()), L.homeBearing, z / R, new Vector3());
    admit(dir, i, treeScale(rand()), rand() * Math.PI * 2, i % 13 === 0 ? 3 : i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0);
  }
  // Broad correlated groves, not an evenly spaced lattice. Candidate identities persist with growth.
  for (let i = 0; i < 9000; i++) {
    const y = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - y * y);
    const dir = new Vector3(s * Math.cos(a), y, s * Math.sin(a));
    const birth = rand(), abundance = rand(), scale = treeScale(rand()), turn = rand() * Math.PI * 2;
    if (birth > Math.min(1, 0.55 * (R / 128) ** 2)) continue;
    if (dir.distanceTo(L.cottage) * R < 54) continue;
    const grove = 0.66 + 0.25 * Math.sin(dir.x * 8 + dir.z * 4) * Math.sin(dir.y * 7 - dir.x * 2);
    // Groves crowd the shores: within BANK m of the water nearly every candidate stands, willows nearest.
    const bank = terrain.sample(dir, sample).water;
    if (abundance > (bank < BANK.grove ? 0.94 : grove)) continue;
    admit(dir, 1000 + i, scale, turn, i % 17 === 0 && bank < BANK.willow ? 3 : i % 7 === 0 ? 2 : i % 4 === 0 ? 1 : 0);
    if (sites.length >= MAX_TREES) break;
  }
  return sites;
}
