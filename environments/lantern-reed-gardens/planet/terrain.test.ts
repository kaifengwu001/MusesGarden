import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { FieldParams } from './fields';
import { BANK, createGroundSample, generateLayout, Terrain } from './terrain';
import { residentDirection, ResidentLife } from '../life/residentLife';

const params: FieldParams = { roll: 1.5, hummocks: 0.25, wetlands: 0.58, waterLevel: 0, grain: 0.5, density: 0.5, patchiness: 0.9, patchSize: 13, weights: [0.1, 0.7, 0.1, 0.1] };
function terrain(radius = 128, seed = 412, patch: Partial<FieldParams> = {}): Terrain {
  const t = new Terrain(generateLayout(seed));
  t.update(radius, { ...params, ...patch }, 0.5);
  return t;
}
function direction(i: number, n = 600): Vector3 {
  const y = 1 - 2 * (i + 0.5) / n;
  const r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  return new Vector3(r * Math.cos(a), y, r * Math.sin(a));
}

describe('Lantern Reed Gardens terrain', () => {
  it('has both dry mineral islands and finite shallow pools at one water level', () => {
    for (const radius of [40, 128, 400]) {
      const t = terrain(radius), sample = createGroundSample();
      let wet = 0, dry = 0;
      for (let k = 0; k < 600; k++) {
        const g = t.sample(direction(k), sample);
        expect(Object.values(g).every(Number.isFinite)).toBe(true);
        expect(g.height).toBeGreaterThanOrEqual(0);
        expect(g.depth).toBeLessThanOrEqual(1.1 + BANK.height + 1e-8);
        if (g.depth > 0.05) { wet++; expect(g.height).toBe(0); expect(g.water).toBeLessThan(0); }
        if (g.water > 1) dry++;
      }
      expect(wet).toBeGreaterThan(30);
      expect(dry).toBeGreaterThan(125);
    }
  });

  it('keeps shelter, deck and steps on their authored level', () => {
    for (const seed of [5, 412, 9999]) for (const radius of [40, 128, 400]) {
      const t = terrain(radius, seed);
      for (const [x, z] of [[0, 0], [-4, 2], [4, 2], [2.9, 5.7], [-7.2, 4.6]]) {
        const g = t.sample(residentDirection(t, x, z), createGroundSample());
        expect(g.water).toBeGreaterThan(1);
        expect(g.depth).toBe(0);
        expect(g.height).toBeGreaterThan(0.85);
      }
      expect(t.height(t.layout.cottage)).toBeCloseTo(t.cottageGround, 6);
    }
  });

  it('protects all three resident walking lanes from flooding across seeds and radii', () => {
    const homes = [[-7.2, 12], [0, 17], [7.2, 12]];
    for (const seed of [5, 412, 9999]) for (const radius of [40, 128, 400]) {
      const t = terrain(radius, seed, { waterLevel: 1, wetlands: 0.9 });
      for (const [x, z] of homes) for (let k = 0; k < 48; k++) {
        const a = k / 48 * 2 * Math.PI;
        const g = t.sample(residentDirection(t, x + Math.cos(a) * 2.25, z + Math.sin(a) * 1.8), createGroundSample());
        expect(g.water).toBeGreaterThan(1);
        expect(g.height).toBeCloseTo(0.8 + BANK.height, 5);
        expect(g.depth).toBe(0);
      }
    }
  });

  it('lets every resident walk safely instead of falling back to a frozen wet point', () => {
    for (const radius of [40, 128, 400]) {
      const t = terrain(radius), camera = t.layout.cottage.clone().multiplyScalar(radius + 8);
      for (let index = 0; index < 3; index++) {
        const life = new ResidentLife(index);
        const first = life.at(0, t, camera).dir.clone();
        let moved = 0;
        for (let time = 0; time <= 90; time += 0.5) {
          const lifeAt = life.at(time, t, camera);
          const g = t.sample(lifeAt.dir, createGroundSample());
          expect(g.water).toBeGreaterThan(1);
          expect(lifeAt.height).toBeCloseTo(g.height, 7);
          moved = Math.max(moved, first.angleTo(lifeAt.dir) * radius);
        }
        expect(moved).toBeGreaterThan(2);
      }
    }
  });

  it('has a conservative height bound at every supported terrain extreme', () => {
    for (const radius of [40, 128, 400]) for (const level of [-1, 1]) {
      const t = terrain(radius, 412, { roll: 4, hummocks: 1.5, wetlands: 0.9, waterLevel: level });
      for (let k = 0; k < 600; k++) expect(t.height(direction(k))).toBeLessThan(t.maxHeight);
    }
  });

  it('keeps flattened-ground shortcuts identical to the complete terrain calculation', () => {
    for (const radius of [40, 128, 400]) for (const seed of [5, 412, 9999]) {
      const t = terrain(radius, seed), sample = createGroundSample();
      for (let x = -16; x <= 16; x += 2) for (let z = -10; z <= 26; z += 2) {
        const dir = residentDirection(t, x, z);
        expect(t.height0(dir)).toBeCloseTo(t.homestead(dir, t.fields.natural(dir)), 12);
        expect(t.sample(dir, sample).wet).toBeCloseTo(t.fields.wetness(dir), 12);
      }
    }
  });

  it('repeats exactly for a seed and after a radius round trip', () => {
    const a = terrain(), b = terrain();
    const samples = Array.from({ length: 100 }, (_, k) => a.height(direction(k, 100)));
    a.update(400, params, 0.5);
    a.update(128, params, 0.5);
    samples.forEach((h, k) => {
      expect(a.height(direction(k, 100))).toBe(h);
      expect(b.height(direction(k, 100))).toBe(h);
    });
  });
});
