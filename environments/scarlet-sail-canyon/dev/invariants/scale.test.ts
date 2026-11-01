import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CHALK_STEP, DRY_SHORE, chalkHeight, type FieldParams } from '../../planet/fields';
import { travel } from '../../../../src/planet/geo';
import { createGroundSample, generateLayout, Terrain } from '../../planet/terrain';

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

describe('dry chalk terrain', () => {
  it('stays dry everywhere at every supported planet size', () => {
    const s = createGroundSample();
    const dirs = sphereDesign(600);
    for (const radius of [40, 90, 128, 250, 400]) {
      const t = terrainAt(radius);
      for (const d of dirs) {
        t.sample(d, s);
        expect(s.height).toBeGreaterThan(0);
        expect(s.water).toBe(DRY_SHORE);
        expect(s.depth).toBe(0);
        expect(s.wet).toBe(0);
      }
    }
  });

  it('cannot flood when legacy meadow controls change', () => {
    const t = terrainAt(128);
    const dirs = sphereDesign(80);
    const before = dirs.map((d) => t.height(d));
    t.update(128, { ...PARAMS, wetlands: 0.9, waterLevel: 4 }, 0.5);
    dirs.forEach((d, i) => {
      expect(t.height(d)).toBe(before[i]);
      expect(t.fields.wetness(d)).toBe(0);
    });
  });

  it('bounds every height conservatively across seeds, growth and maximum relief', () => {
    const dirs = sphereDesign(400);
    for (const seed of [1, 412, 9128, 0xffffffff]) {
      const t = new Terrain(generateLayout(seed));
      for (const radius of [40, 128, 400]) {
        t.update(radius, { ...PARAMS, roll: 4, hummocks: 1.5 }, (2 * radius) / 512);
        expect(t.maxHeight).toBeGreaterThan(t.cottageGround);
        for (const dir of dirs) expect(t.height(dir)).toBeLessThanOrEqual(t.maxHeight);
      }
    }
  });

  it('joins adjacent bedding shelves continuously without vertical terrain jumps', () => {
    for (let band = -12; band <= 12; band++) {
      const h = band * CHALK_STEP;
      expect(Math.abs(chalkHeight(h - 1e-6, 20) - chalkHeight(h + 1e-6, 20))).toBeLessThan(2e-6);
    }
  });

  it('removes the former pond and channel while keeping the terrace dry', () => {
    const s = createGroundSample();
    for (const radius of [40, 128, 400]) {
      const t = terrainAt(radius);
      const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing).normalize();
      for (const [x, z] of [[-7.2, 4.6], [-7, 8], [0, 17], [3, 5]] as const) {
        const p = travel(travel(layout.cottage, across, x / radius, new Vector3()), layout.homeBearing, z / radius, new Vector3());
        t.sample(p, s);
        expect(s.water).toBe(DRY_SHORE);
        expect(s.depth).toBe(0);
        expect(s.height).toBeGreaterThan(0);
      }
    }
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
