import { InstancedBufferGeometry, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FieldParams } from '../planet/fields';
import { generateLayout, Terrain } from '../planet/terrain';
import { CULTIVATED_BEDS, HamletScenery } from './hamletScenery';

const fields: FieldParams = { roll: 1.8, hummocks: 0.12, wetlands: 0.25, waterLevel: 0, grain: 0.4, density: 0.6, patchiness: 0.8, patchSize: 13, weights: [0, 0, 0, 0] };
function create(radius = 128): { terrain: Terrain; scenery: HamletScenery } {
  const terrain = new Terrain(generateLayout(412));
  terrain.update(radius, fields, radius / 256);
  return { terrain, scenery: new HamletScenery({}, terrain) };
}
function placed(scenery: HamletScenery, terrain: Terrain): { tree: boolean; variant: number; x: number; z: number; scale: number; direction: Vector3 }[] {
  return scenery.group.children.flatMap(object => {
    if (!(object instanceof Mesh) || !(object.geometry instanceof InstancedBufferGeometry)) return [];
    const a = object.geometry.getAttribute('aAnchor'), p = object.geometry.getAttribute('aPlacement');
    return Array.from({ length: object.geometry.instanceCount }, (_, i) => {
      const direction = new Vector3(a.getX(i), a.getY(i), a.getZ(i));
      const local = terrain.cottageLocal(direction, { x: 0, z: 0 });
      return { tree: /pine|cedar/.test(object.name), variant: p.getZ(i), ...local, scale: p.getX(i), direction };
    });
  });
}

describe('ukiyoe inhabited planting', () => {
  it('keeps substantial planted crop rows and softer grass around each dry cottage bed', () => {
    const { terrain, scenery } = create();
    const plants = placed(scenery, terrain), crops = plants.filter(p => p.variant === -2), grass = plants.filter(p => p.variant === -1);
    expect(crops.length).toBeGreaterThan(90);
    expect(grass.length).toBeGreaterThan(115);
    for (const bed of CULTIVATED_BEDS) {
      const crop = crops.filter(p => Math.abs(p.x - bed.x) < bed.width * 0.5 + 0.1 && Math.abs(p.z - bed.z) < bed.length * 0.5 + 0.1);
      expect(crop.length).toBeGreaterThan(bed.rows * bed.plants * 0.8);
      expect(grass.some(p => Math.abs(p.x - bed.x) < bed.width * 0.5 + 0.8 && Math.abs(p.z - bed.z) < bed.length * 0.5 + 0.8)).toBe(true);
    }
    scenery.dispose();
  });

  it('leaves the cottage approach, bridge and complete resident courtyard lane free of crops and grass', () => {
    for (const radius of [40, 128, 400]) {
      const { terrain, scenery } = create(radius);
      expect(scenery.triangleCount).toBeLessThan(1_500_000);
      for (const plant of placed(scenery, terrain).filter(p => p.variant < 0)) {
        const { x, z } = plant;
        expect(x > -1 && x < 6 && z > 3 && z < 31).toBe(false);
        expect(x > 6 && x < 18 && z > 8 && z < 12).toBe(false);
        expect(x > -8.7 && x < -3.3 && z > 7.1 && z < 10.9).toBe(false);
        const ground = terrain.sample(plant.direction, { height: 0, water: 0, depth: 0, clearing: 0, wet: 0 });
        expect(ground.depth).toBeLessThanOrEqual(0.03);
        expect(ground.clearing).toBeLessThanOrEqual(0.05);
      }
      scenery.dispose();
    }
  });

  it('mixes mature trees and saplings with both groves and isolated trees', () => {
    const { terrain, scenery } = create();
    const trees = placed(scenery, terrain).filter(p => p.tree);
    const local = trees.filter(p => p.direction.angleTo(terrain.layout.cottage) * terrain.radius < 36);
    expect(Math.min(...local.map(p => p.scale))).toBeLessThan(0.5);
    expect(Math.max(...local.map(p => p.scale))).toBeGreaterThan(1.2);
    const distant = trees.filter(p => p.direction.angleTo(terrain.layout.cottage) * terrain.radius > 40);
    const nearest = distant.map((p, i) => Math.min(...distant.filter((_, j) => i !== j).map(q => p.direction.angleTo(q.direction) * terrain.radius)));
    expect(nearest.filter(d => d < 6).length).toBeGreaterThan(25);
    expect(nearest.filter(d => d > 12).length).toBeGreaterThan(5);
    scenery.dispose();
  });
});
