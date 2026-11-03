import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cherrySites, MAX_TREES, ROOT_SPREAD, type CherrySite } from '../life/cherryDistribution';
import { makeCherryGeometry } from '../life/cherryGeometry';
import { schema } from '../params';
import type { FieldParams } from '../planet/fields';
import { createGroundSample, generateLayout, HOUSE_FOOTPRINT, PIER_AREA, STEPS_AREA, TERRACE_AREA, Terrain } from '../planet/terrain';

const PARAMS: FieldParams = {
  roll: schema.terrain.roll.def,
  hummocks: schema.terrain.hummocks.def,
  wetlands: schema.terrain.wetlands.def,
  waterLevel: schema.terrain.waterLevel.def,
  grain: schema.terrain.grain.def,
  density: schema.flowers.density.def,
  patchiness: schema.flowers.patchiness.def,
  patchSize: schema.flowers.patchSize.def,
  weights: [schema.flowers.pink.def, schema.flowers.star.def, schema.flowers.yellow.def, schema.flowers.blue.def],
};

function world(radius: number, seed = 412): Terrain {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, PARAMS, 2 * radius / 512);
  return terrain;
}

function identity(sites: CherrySite[]): unknown[] {
  return sites.map(s => [s.id, s.dir.toArray(), s.height, s.scale, s.turn, s.variant]);
}

function distanceToRectangle(x: number, z: number, box: readonly number[]): number {
  return Math.hypot(Math.max(box[0] - x, 0, x - box[1]), Math.max(box[2] - z, 0, z - box[3]));
}

describe('cherry grove distribution', () => {
  it('regenerates exactly without shared mutable randomness and changes with the world seed', () => {
    const original = cherrySites(world(128));
    const other = cherrySites(world(128, 771));
    const again = cherrySites(world(128));
    expect(identity(again)).toEqual(identity(original));
    expect(identity(other)).not.toEqual(identity(original));
    expect(new Set(original.map(s => s.id)).size).toBe(original.length);
    expect(original.every(s => Math.abs(s.dir.length() - 1) < 1e-10)).toBe(true);
    expect(original.every(s => Number.isFinite(s.height + s.turn + s.scale))).toBe(true);
  });

  it('keeps dry rooted trees, pedestrian openings and the actual pavilion footprint clear at all planet sizes', () => {
    const roots = Array.from({ length: 4 }, (_, variant) => {
      const geometry = makeCherryGeometry(variant);
      // The geometry records the five buttress ends immediately after the trunk tip.
      const tips = (geometry.userData.branchTips as number[][]).slice(1, 6).map(p => new Vector3(p[0], p[1], p[2]));
      geometry.dispose();
      return tips;
    });
    const footprints = [[-HOUSE_FOOTPRINT.halfX, HOUSE_FOOTPRINT.halfX, -HOUSE_FOOTPRINT.halfZ, HOUSE_FOOTPRINT.halfZ], TERRACE_AREA, PIER_AREA, STEPS_AREA];
    for (const radius of [40, 128, 400]) {
      const terrain = world(radius), sites = cherrySites(terrain), sample = createGroundSample();
      expect(sites.length, `R${radius} grove population`).toBeGreaterThan(12);
      expect(sites.length).toBeLessThanOrEqual(MAX_TREES);
      for (const site of sites) {
        terrain.sample(site.dir, sample);
        expect(sample.depth, `R${radius} site${site.id} submerged trunk`).toBe(0);
        expect(sample.height).toBeGreaterThan(0.2);
        expect(site.height).toBeLessThan(sample.height);
        // On a gentle slope the trunk stands at its lowest root probe: its centre sinks by at most the footprint's rise.
        expect(sample.height - site.height).toBeLessThan(ROOT_SPREAD + 0.07);
        if (site.dir.distanceTo(terrain.layout.cottage) * radius < 45) {
          const p = { x: 0, z: 0 };
          terrain.cottageLocal(site.dir, p);
          for (const box of footprints) expect(distanceToRectangle(p.x, p.z, box), `R${radius} site${site.id} pavilion support`).toBeGreaterThan(site.scale);
          if (p.z > -6) expect(Math.abs(p.x - (8.5 + Math.sin(p.z * 0.075) * 3)), `R${radius} site${site.id} path`).toBeGreaterThan(2.3);
        }
      }
      // Independently transform every authored root tip for a representative spread of sites.
      // This checks final geometry support rather than reasserting the placement probe condition.
      const stride = Math.max(1, Math.floor(sites.length / 40));
      for (let i = 0; i < sites.length; i += stride) {
        const site = sites[i], up = site.dir;
        const x = new Vector3().crossVectors(Math.abs(up.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), up).normalize();
        const z = new Vector3().crossVectors(x, up);
        const xx = x.clone().multiplyScalar(Math.cos(site.turn)).addScaledVector(z, Math.sin(site.turn));
        const zz = z.clone().multiplyScalar(Math.cos(site.turn)).addScaledVector(x, -Math.sin(site.turn));
        for (const root of roots[site.variant]) {
          const point = up.clone().multiplyScalar(radius + site.height + root.y * site.scale).addScaledVector(xx, root.x * site.scale).addScaledVector(zz, root.z * site.scale);
          const height = point.length() - radius;
          terrain.sample(point.normalize(), sample);
          expect(sample.depth).toBe(0);
          expect(height - sample.height, `R${radius} site${site.id} floating root toe`).toBeLessThan(0.06);
          // Uphill toes run into a slope by up to the footprint's rise, besides their own scaled depth.
          expect(height - sample.height).toBeGreaterThan(-(ROOT_SPREAD + 0.07 + 0.13 * site.scale));
        }
      }
    }
  });

  it('has local and remote groves with unequal occupancy rather than a uniform lattice', () => {
    const terrain = world(128), sites = cherrySites(terrain);
    const local = sites.filter(s => s.dir.distanceTo(terrain.layout.cottage) * 128 < 65);
    const remote = sites.filter(s => s.dir.distanceTo(terrain.layout.cottage) * 128 > 100);
    expect(local.length).toBeGreaterThan(5);
    expect(remote.length).toBeGreaterThan(40);
    const sectors = new Array<number>(8).fill(0);
    for (const site of sites) sectors[(site.dir.x > 0 ? 1 : 0) + (site.dir.y > 0 ? 2 : 0) + (site.dir.z > 0 ? 4 : 0)]++;
    expect(sectors.filter(count => count > 0).length).toBe(8);
    expect(Math.max(...sectors) / Math.max(1, Math.min(...sectors))).toBeGreaterThan(1.4);
    expect(new Set(sites.map(s => s.variant)).size).toBe(4);
    expect(cherrySites(world(400)).length).toBeGreaterThan(cherrySites(world(40)).length);
  });
});
