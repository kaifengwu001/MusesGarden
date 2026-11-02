import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { travel } from '../../../src/planet/geo';
import { createGroundSample, type Terrain } from '../planet/terrain';

export interface CherrySite {
  dir: Vector3;
  height: number;
  scale: number;
  turn: number;
  variant: number;
  id: number;
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
  const admit = (dir: Vector3, id: number, scale: number, turn: number, variant: number): void => {
    terrain.sample(dir, sample);
    if (sample.depth > 0 || sample.water < 0.9 || sample.clearing > 0.02 || sample.height < 0.24) return;
    const dc = dir.distanceTo(L.cottage) * R;
    if (dc < 13) {
      terrain.cottageLocal(dir, local);
      if (Math.abs(local.x) < 6.7 && local.z > -5.5 && local.z < 12) return;
    }
    // Keep a generous pedestrian opening from the pavilion along its right bank.
    if (dc < 45) {
      terrain.cottageLocal(dir, local);
      const pathX = 8.5 + Math.sin(local.z * 0.075) * 3;
      if (local.z > -6 && Math.abs(local.x - pathX) < 2.3) return;
    }
    const h = sample.height;
    side.crossVectors(dir, Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    ahead.crossVectors(dir, side);
    // The actual five root toes reach about one scaled meter from the trunk.
    // Eight probes enclose their footprint; checking only half a meter admitted
    // trees whose low-side toes hovered over the steep canal bank.
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      probeAxis.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(ahead, Math.sin(angle));
      terrain.sample(travel(dir, probeAxis, 1.1 * scale / R, support), sample);
      if (sample.depth > 0 || Math.abs(sample.height - h) > 0.105) return;
    }
    if (sites.some(s => s.dir.distanceToSquared(dir) * R * R < Math.pow(3.5 * Math.min(scale, s.scale), 2))) return;
    sites.push({ dir: dir.clone(), height: h - 0.065, scale, turn, variant, id });
  };

  // Authored banks around the water garden, with unequal group spacing and open views.
  for (let i = 0; i < 145; i++) {
    const a = rand() * Math.PI * 2;
    const r = 12 + Math.pow(rand(), 0.65) * 49;
    const x = Math.cos(a) * r - 5, z = Math.sin(a) * r + 12;
    const dir = travel(travel(L.cottage, east, x / R, new Vector3()), L.homeBearing, z / R, new Vector3());
    admit(dir, i, 0.78 + rand() * 0.43, rand() * Math.PI * 2, i % 13 === 0 ? 3 : i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0);
  }
  // Broad correlated groves, not an evenly spaced lattice. Candidate identities persist with growth.
  for (let i = 0; i < 5400; i++) {
    const y = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - y * y);
    const dir = new Vector3(s * Math.cos(a), y, s * Math.sin(a));
    const birth = rand(), abundance = rand(), scale = 0.73 + rand() * 0.44, turn = rand() * Math.PI * 2;
    if (birth > Math.min(1, 0.55 * (R / 128) ** 2)) continue;
    if (dir.distanceTo(L.cottage) * R < 54) continue;
    const grove = 0.52 + 0.25 * Math.sin(dir.x * 8 + dir.z * 4) * Math.sin(dir.y * 7 - dir.x * 2);
    const bank = terrain.fields.waterwayDistance(dir);
    if (abundance > (bank < 0.13 ? 0.94 : grove)) continue;
    admit(dir, 1000 + i, scale, turn, i % 17 === 0 && bank < 0.1 ? 3 : i % 7 === 0 ? 2 : i % 4 === 0 ? 1 : 0);
    if (sites.length >= 1800) break;
  }
  return sites;
}
