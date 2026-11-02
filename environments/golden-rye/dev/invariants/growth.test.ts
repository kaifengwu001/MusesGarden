import { describe, expect, it } from 'vitest';
import { defaultParams, RADIUS_MAX, RADIUS_MIN } from '../../params';
import { areaAt, ease, easeInverse, growthForArea, growthState, radiusOfArea } from '../../../../src/planet/growth';
import { formatArea, worldLine } from '../../ui/format';

const p = defaultParams();
const { areaMin, areaMax } = p.world;

describe('growth model', () => {
  it('maps g = 0 and g = 1 to the area bounds', () => {
    expect(areaAt(0, areaMin, areaMax)).toBe(areaMin);
    expect(areaAt(1, areaMin, areaMax)).toBe(areaMax);
  });

  it('spans R = 40 → 400 m by default', () => {
    expect(growthState(0, areaMin, areaMax).radius).toBeCloseTo(RADIUS_MIN, 2);
    expect(growthState(1, areaMin, areaMax).radius).toBeCloseTo(RADIUS_MAX, 2);
  });

  it('derives the radius from surface area: R = √(A / 4π)', () => {
    for (const g of [0, 0.1, 0.37, 0.5, 0.82, 1]) {
      const s = growthState(g, areaMin, areaMax);
      expect(4 * Math.PI * s.radius ** 2).toBeCloseTo(s.area, 6);
    }
  });

  it('grows strictly and smoothly with g', () => {
    let last = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const r = radiusOfArea(areaAt(i / 1000, areaMin, areaMax));
      expect(r).toBeGreaterThan(last);
      last = r;
    }
  });

  it('inverts exactly', () => {
    for (let i = 0; i <= 100; i++) {
      const g = i / 100;
      expect(easeInverse(ease(g))).toBeCloseTo(g, 9);
      expect(growthForArea(areaAt(g, areaMin, areaMax), areaMin, areaMax)).toBeCloseTo(g, 9);
    }
  });

  it('starts the default world at R 128 m, 206,000 m², seed 0412', () => {
    const s = growthState(p.world.growth, areaMin, areaMax);
    expect(Math.round(s.radius)).toBe(128);
    expect(formatArea(s.area)).toBe('206,000');
    expect(worldLine(p, s)).toBe('Golden harvest · R 128 m · 206,000 m² · seed 0412');
  });
});
