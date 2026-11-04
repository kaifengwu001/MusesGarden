import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FieldParams } from '../../planet/fields';
import { travel } from '../../../../src/planet/geo';
import { COTTAGE_TO_POND, createGroundSample, generateLayout, POND_SHIFT, Terrain } from '../../planet/terrain';

// Constant scale and attachment: things on the planet stay human-sized and
// seated at every size. (The cottage geometry itself is built in meters
// with no reference to R; see life/props.ts.)

const PARAMS: FieldParams = {
  roll: 1.25,
  hummocks: 0.35,
  wetlands: 0.42,
  waterLevel: 0,
  grain: 0.6,
  density: 10,
  patchiness: 0.78,
  patchSize: 13,
  weights: [0.4, 0.24, 0.22, 0.14],
};
const layout = generateLayout(412);

function terrainAt(radius: number): Terrain {
  const t = new Terrain(layout);
  t.update(radius, PARAMS, (2 * radius) / 512);
  return t;
}

/** Evenly spread directions (Fibonacci sphere). */
function sphereDesign(n: number): Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    return new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
  });
}

describe('constant scale', () => {
  // Tulipwind's ground is low and dry (CONSTRUCTION.md): the meadow's pond excavation is gone from the homestead and
  // the relief is lifted clear of the water table, so the mill stands in its fields with no pond and no lakes.
  it('keeps the homestead dry where the meadow had its pond, at every size', () => {
    const s = createGroundSample();
    for (const radius of [40, 90, 128, 250, 400]) {
      const t = terrainAt(radius);
      // where the meadow's pond began (in front and to the left of the house) is dry land, as is just inside the house front
      const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing).normalize();
      const pondSide = travel(travel(layout.cottage, across, -POND_SHIFT / radius, new Vector3()), layout.homeBearing, (COTTAGE_TO_POND + 1.2) / radius, new Vector3());
      const houseSide = travel(layout.cottage, layout.homeBearing, 1.5 / radius, new Vector3());
      expect(t.sample(pondSide, s).water, `R ${radius} where the pond was`).toBeGreaterThan(0.5);
      expect(t.sample(houseSide, s).water, `R ${radius} house`).toBeGreaterThan(0.5);
    }
  });

  it('keeps the whole planet dry as it grows: no lakes in its hollows', () => {
    const dirs = sphereDesign(3000);
    for (const radius of [40, 128, 400]) {
      const t = terrainAt(radius);
      expect(dirs.filter((d) => t.fields.natural(d) < 0).length, `R ${radius}`).toBe(0);
    }
  });

  it('keeps the wetlands where they are as the planet grows (they live in rest space)', () => {
    const dirs = sphereDesign(500);
    const small = terrainAt(40);
    const large = terrainAt(400);
    for (const d of dirs) expect(large.fields.wetness(d)).toBeCloseTo(small.fields.wetness(d), 9);
  });
});

describe('everything stays attached', () => {
  it('seats the cottage on a flat clearing at every size', () => {
    const s = createGroundSample();
    const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing).normalize();
    for (const radius of [40, 128, 400]) {
      const t = terrainAt(radius);
      const heights: number[] = [];
      // the house's corners (props.ts COTTAGE: 8.6 × 5.3 m) and its middle
      for (const [x, z] of [[-4.25, -2.6], [4.25, -2.6], [4.25, 2.6], [-4.25, 2.6], [0, 0]] as const) {
        const p = travel(layout.cottage, across, x / radius, new Vector3());
        travel(p, layout.homeBearing, z / radius, p);
        heights.push(t.sample(p, s).height);
        expect(s.clearing, `R ${radius} clearing at ${x},${z}`).toBeGreaterThan(0.5);
      }
      const spread = Math.max(...heights) - Math.min(...heights);
      expect(spread, `R ${radius}`).toBeLessThan(0.02);
      expect(Math.abs(heights[4] - t.cottageLevel - 0.2)).toBeLessThan(0.02);
    }
  });

  it('keeps the cottage geometry the same size whatever the planet radius', async () => {
    const { Homestead } = await import('../../life/props');
    const a = new Box3().setFromObject(new Homestead({}, 412).group);
    const b = new Box3().setFromObject(new Homestead({}, 412).group);
    const size = a.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(5);
    expect(size.y).toBeGreaterThan(4);
    expect(b.getSize(new Vector3()).distanceTo(size)).toBe(0);
  });
});
