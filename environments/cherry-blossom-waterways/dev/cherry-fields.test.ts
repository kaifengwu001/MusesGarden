import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Fields, type FieldParams } from '../planet/fields';
import { generateLayout } from '../planet/terrain';

const params: FieldParams = { roll: 1.25, hummocks: 0.8, wetlands: 0.45, waterLevel: 0, grain: 0.9, density: 0, patchiness: 0.95, patchSize: 13, weights: [0.7, 0.3, 0, 0] };

function directions(count = 2048): Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / count;
    const r = Math.sqrt(1 - y * y);
    return new Vector3(r * Math.cos(i * golden), y, r * Math.sin(i * golden));
  });
}

function fieldsFor(seed: number): Fields {
  const layout = generateLayout(seed);
  const fields = new Fields(layout.noiseSeed, layout.grain);
  fields.update(128, params);
  return fields;
}

describe('cherry garden waterways', () => {
  it('keeps broad clear waterways and low garden banks across different seeds', () => {
    const points = directions();
    for (const seed of [412, 17, 905]) {
      const fields = fieldsFor(seed);
      const heights = points.map((dir) => fields.natural(dir));
      const water = heights.filter((height) => height < 0).length / points.length;
      expect(water).toBeGreaterThan(0.15);
      expect(water).toBeLessThan(0.36);
      expect(Math.min(...heights)).toBeGreaterThan(-1.8);
      expect(Math.max(...heights)).toBeLessThan(3.2);
      for (const axis of ['x', 'y', 'z'] as const) {
        for (const sign of [-1, 1]) {
          expect(points.some((dir, i) => dir[axis] * sign > 0.4 && heights[i] < -0.5)).toBe(true);
        }
      }
    }
  });

  it('keeps the same canal identity and shoreline while the planet grows', () => {
    const fields = fieldsFor(412);
    const points = directions(512);
    const reference = points.map((dir) => fields.waterwayDistance(dir));
    for (const radius of [40, 56, 90, 128, 160, 400]) {
      fields.update(radius, params);
      for (let i = 0; i < points.length; i++) {
        expect(fields.waterwayDistance(points[i])).toBe(reference[i]);
        expect(fields.natural(points[i]) < 0).toBe(reference[i] < 0);
      }
    }
  });

  it('widens connected water without moving or replacing the seeded canal plan', () => {
    const fields = fieldsFor(412);
    const points = directions(512);
    fields.update(128, { ...params, wetlands: 0.2 });
    const narrow = points.map((dir) => fields.waterwayDistance(dir));
    fields.update(128, { ...params, wetlands: 0.8 });
    const broad = points.map((dir) => fields.waterwayDistance(dir));
    expect(broad.filter((d) => d < 0).length).toBeGreaterThan(narrow.filter((d) => d < 0).length);
    for (let i = 0; i < points.length; i++) expect(broad[i]).toBeLessThan(narrow[i]);
  });
});
