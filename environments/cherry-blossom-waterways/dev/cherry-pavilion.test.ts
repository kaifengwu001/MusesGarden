import { describe, expect, it } from 'vitest';
import { type Mesh, Raycaster, Vector3 } from 'three';
import { FLOOR, Homestead, PIER, ROOF, STEPS, TERRACE } from '../life/props';

describe('open riverside pavilion', () => {
  it('keeps the inherited landing and step navigation heights physically supported', () => {
    const pavilion = new Homestead({}, 412);
    const support = pavilion.group.children.filter(o => o.name.endsWith('landing') || o.name.endsWith('wood')) as Mesh[];
    const ray = new Raycaster();
    const floorAt = (x: number, z: number): number => {
      // Start immediately above the walking plane, below posts/seating/roof.
      ray.set(new Vector3(x, FLOOR + 0.005, z), new Vector3(0, -1, 0));
      const hits = ray.intersectObjects(support, false);
      expect(hits.length).toBeGreaterThan(0);
      return hits[0].point.y;
    };
    expect(floorAt(0, 0)).toBeCloseTo(FLOOR, 5);
    expect(floorAt(2.8, 3.6)).toBeCloseTo(FLOOR, 5);
    expect(floorAt(TERRACE.x0 + 0.2, TERRACE.z1 - 0.2)).toBeCloseTo(FLOOR, 5);
    expect(floorAt(PIER.x0 + 0.4, PIER.z0 + 0.14)).toBeCloseTo(FLOOR, 5);
    for (let k = 0; k < STEPS.count; k++) {
      expect(floorAt((STEPS.x0 + STEPS.x1) / 2, TERRACE.z1 + STEPS.tread * (k + 0.5))).toBeCloseTo(FLOOR - STEPS.rise * (k + 1), 5);
    }
  });

  it('keeps a compact roof with raised corners and an open interior', () => {
    const pavilion = new Homestead({}, 412);
    const roof = pavilion.group.children.find(o => o.name.endsWith('roof')) as Mesh;
    roof.geometry.computeBoundingBox();
    const bounds = roof.geometry.boundingBox!;
    expect(bounds.max.y).toBeLessThan(5.3);
    expect(bounds.max.x).toBeGreaterThan(ROOF.ex - 0.05);
    const p = roof.geometry.getAttribute('position');
    let corner = -Infinity;
    let middle = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i)) > ROOF.ez - 0.05) {
        if (Math.abs(p.getX(i)) > ROOF.ex - 0.1) corner = Math.max(corner, p.getY(i));
        if (Math.abs(p.getX(i)) < 0.2) middle = Math.min(middle, p.getY(i));
      }
    }
    expect(corner - middle).toBeGreaterThan(0.25);
    const across = new Raycaster(new Vector3(1.2, FLOOR + 1.2, 8), new Vector3(0, 0, -1), 0, 16);
    expect(across.intersectObject(pavilion.group, true)).toHaveLength(0);
  });
});
