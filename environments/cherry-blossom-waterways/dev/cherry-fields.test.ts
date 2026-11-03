import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Fields, type FieldParams } from '../planet/fields';
import { Fields as MeadowFields } from '../../../src/planet/fields';
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

describe('cherry garden land and water', () => {
  it("lays out the meadow's own lakes for the same seed, at every size and wetland share", () => {
    const points = directions(512);
    for (const seed of [412, 17, 905]) {
      const layout = generateLayout(seed);
      const cherry = new Fields(layout.noiseSeed, layout.grain);
      const meadow = new MeadowFields(layout.noiseSeed, layout.grain);
      for (const [radius, wetlands] of [[40, 0.45], [128, 0.45], [400, 0.45], [128, 0.2], [128, 0.8]]) {
        const p = { ...params, wetlands };
        cherry.update(radius, p);
        meadow.update(radius, p);
        for (const dir of points) {
          expect(cherry.natural(dir), `seed ${seed} R${radius} wetlands ${wetlands}`).toBe(meadow.natural(dir));
          expect(cherry.wetness(dir)).toBe(meadow.wetness(dir));
        }
      }
    }
  });

  it('keeps open water and dry banks on every side of the planet', () => {
    const points = directions();
    for (const seed of [412, 17, 905]) {
      const layout = generateLayout(seed);
      const fields = new Fields(layout.noiseSeed, layout.grain);
      fields.update(128, params);
      const heights = points.map((dir) => fields.natural(dir));
      const water = heights.filter((height) => height < 0).length / points.length;
      expect(water).toBeGreaterThan(0.05);
      expect(water).toBeLessThan(0.5);
      expect(heights.filter((height) => height > 0.3).length / points.length).toBeGreaterThan(0.4);
    }
  });
});
