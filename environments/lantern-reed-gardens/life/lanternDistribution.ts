import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';

export interface LanternRegion {
  centre: Vector3;
  across: Vector3;
  forward: Vector3;
  extent: number;
  richness: number;
  rockKind: number;
  turn: number;
}

/** Unequal island/grove regions, independent of the authored home's random stream. */
export function lanternRegions(seed: number, home: Vector3, bearing: Vector3): LanternRegion[] {
  let state = hash32(seed ^ 0x72c91e4);
  const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
  const east = new Vector3().crossVectors(home, bearing).normalize();
  const regions: LanternRegion[] = [];
  for (let i = 0; i < 128; i++) {
    // Stratified coverage prevents an accidentally empty hemisphere. Jitter and
    // broad abundance waves break the visible lattice into linked archipelagos.
    const y = 1 - 2 * (i + 0.18 + rand() * 0.64) / 128;
    const a = i * 2.399963229728653 + rand() * 0.9 + seed * 0.013;
    const r = Math.sqrt(1 - y * y);
    const centre = home.clone().multiplyScalar(y).addScaledVector(east, Math.cos(a) * r).addScaledVector(bearing, Math.sin(a) * r).normalize();
    if (centre.dot(home) > Math.cos(0.45)) continue;
    const abundance = Math.sin(a * 1.7 + y * 4) * Math.cos(y * 5 - a * 0.4);
    if (abundance < -0.58) continue;
    const across = new Vector3().crossVectors(centre, Math.abs(centre.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    regions.push({ centre, across, forward: new Vector3().crossVectors(across, centre).normalize(),
      extent: 0.065 + rand() * 0.085, richness: 0.55 + rand() * 0.65 + Math.max(0, abundance) * 0.5,
      rockKind: Math.floor(rand() * 3), turn: rand() * Math.PI * 2 });
  }
  return regions;
}

export function regionDirection(region: LanternRegion, x: number, z: number): Vector3 {
  const c = Math.cos(region.turn), s = Math.sin(region.turn);
  return region.centre.clone().addScaledVector(region.across, x * c - z * s)
    .addScaledVector(region.forward, x * s + z * c).normalize();
}
