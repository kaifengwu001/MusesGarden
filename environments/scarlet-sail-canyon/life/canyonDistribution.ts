import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';

export const CANYON_ROCK_SITE_LIMIT = 384;

export interface CanyonRockSite {
  /** Canonical sphere frame: x=across, y=home, z=forward. */
  direction: Vector3;
  /** Broad regional abundance, useful for correlated vegetation choices. */
  richness: number;
  /** Correlated colony scale with smaller individual variation. */
  sizeHint: number;
  cluster: number;
}

/** Seeded colonies and open basins; terrain support and home clearance belong to the caller. */
export function generateCanyonRockSites(seed: number): CanyonRockSite[] {
  let state = hash32(seed ^ 0x43ca7e21);
  const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
  const sphere = (): Vector3 => {
    const y = 2 * rand() - 1;
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y);
    return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  };
  // A few broad provinces correlate density across many colonies. Parent
  // centres are sampled from this field, rather than arranged on a sphere grid.
  const provinces = Array.from({ length: 4 }, () => ({
    direction: sphere(), threshold: Math.cos(0.8 + rand() * 0.45),
  }));
  const basins = Array.from({ length: 2 }, () => ({
    direction: sphere(), radius: 0.34 + rand() * 0.17,
  }));
  const inBasin = (direction: Vector3, margin = 0): boolean => basins.some(basin =>
    direction.dot(basin.direction) > Math.cos(basin.radius + margin));
  const abundance = (direction: Vector3): number => Math.min(1, provinces.reduce((sum, province) => {
    const t = Math.max(0, (direction.dot(province.direction) - province.threshold) / (1 - province.threshold));
    return sum + t * t * (3 - 2 * t);
  }, 0));
  const sites: CanyonRockSite[] = [];
  // Reject coincident/near-coincident assembly roots across colonies too.
  // At the default 128 m radius this is 5.76 m, not just float epsilon.
  const minimumDot = Math.cos(0.045);
  let cluster = 0;
  for (let candidate = 0; candidate < 4096 && cluster < 64 && sites.length < CANYON_ROCK_SITE_LIMIT; candidate++) {
    const center = sphere();
    const richness = abundance(center);
    if (inBasin(center, 0.06) || rand() > 0.14 + richness * 0.86) continue;
    const axis = new Vector3().crossVectors(center, Math.abs(center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const cross = new Vector3().crossVectors(center, axis).normalize();
    const turn = rand() * Math.PI * 2;
    const along = axis.clone().multiplyScalar(Math.cos(turn)).addScaledVector(cross, Math.sin(turn));
    const across = new Vector3().crossVectors(center, along).normalize();
    const reach = 0.065 + rand() * 0.15;
    const narrowness = 0.3 + rand() * 0.55;
    const bend = (rand() - 0.5) * 0.7;
    const scale = 0.78 + rand() * 0.4;
    const count = 1 + Math.floor(Math.pow(rand(), 1.1) * 9);
    for (let member = 0; member < count && sites.length < CANYON_ROCK_SITE_LIMIT; member++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        // Unequal radial distances avoid the repeated satellite rings of a
        // fixed-radius scatter. Elliptical, bent colonies form broken seams.
        const angle = rand() * Math.PI * 2;
        const radial = reach * Math.pow(rand(), 0.7);
        const u = Math.cos(angle) * radial;
        const v = Math.sin(angle) * radial * narrowness + bend * u * u / reach;
        const direction = center.clone().addScaledVector(along, u).addScaledVector(across, v).normalize();
        if (inBasin(direction) || sites.some(site => site.direction.dot(direction) > minimumDot)) continue;
        sites.push({ direction, richness, sizeHint: scale * (0.9 + rand() * 0.2), cluster });
        break;
      }
    }
    cluster++;
  }
  return sites;
}
