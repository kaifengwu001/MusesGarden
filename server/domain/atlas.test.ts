import { describe, expect, it } from 'vitest';
import { angularDistance, besidePlace, homePlace, hopPlace, isDry, nearHome, neighbours, REGIONS, regionCentre, regionOf } from './atlas';
import { museId, regionKey } from './ids';
import { drawFor } from './rng';

const WORLD = 412;

describe('regions', () => {
  it('tile the planet in 96 cells, each finding itself from its centre', () => {
    expect(REGIONS).toHaveLength(96);
    for (const r of REGIONS) expect(regionOf(regionCentre(r))).toBe(r);
  });

  it('each have four edge neighbours, across face edges too, and the relation is symmetric', () => {
    for (const r of REGIONS) {
      const ns = neighbours(r);
      expect(ns, r).toHaveLength(4);
      for (const n of ns) {
        expect(neighbours(n)).toContain(r);
        expect(angularDistance(regionCentre(r), regionCentre(n))).toBeLessThan(0.5);
      }
    }
    expect(neighbours(regionKey(0, 0, 0)).some((n) => !n.startsWith('0:'))).toBe(true);
  });
});

describe('the ground', () => {
  it('puts home at the cottage, on dry land', () => {
    const home = homePlace(WORLD);
    expect(regionOf(home.dir)).toBe(home.region);
    expect(isDry(WORLD, nearHome(WORLD, drawFor(museId('moss'), 1)).dir)).toBe(true);
  });

  it('puts every hop of a trip inside its region, on dry land, one step from the last', () => {
    for (const region of REGIONS) {
      const draw = drawFor(museId('moss'), REGIONS.indexOf(region));
      const spots = [0, 1, 2, 3, 4, 5].map((k) => hopPlace(WORLD, region, k, draw));
      for (const p of spots) {
        expect(regionOf(p.dir)).toBe(region);
        expect(p.region).toBe(region);
        expect(isDry(WORLD, p.dir), region).toBe(true);
      }
      for (let k = 1; k < spots.length; k++) expect(angularDistance(spots[k - 1].dir, spots[k].dir)).toBeLessThan(0.12);
    }
  });

  it('places the same hop in the same spot every time', () => {
    const r = REGIONS[40];
    expect(hopPlace(WORLD, r, 2, drawFor(museId('moss'), 9))).toEqual(hopPlace(WORLD, r, 2, drawFor(museId('moss'), 9)));
  });
});

describe('finds kept on the same hop', () => {
  it('never share an anchor: the second is planted beside the first, close by and on dry ground', () => {
    for (const region of REGIONS.slice(0, 24)) {
      const hop = hopPlace(412, region, 1, drawFor(museId('moss'), 7));
      const second = besidePlace(412, hop, 1);
      const third = besidePlace(412, hop, 2);
      expect(besidePlace(412, hop, 0)).toEqual(hop);
      for (const p of [second, third]) {
        const d = angularDistance(hop.dir, p.dir);
        expect(d).toBeGreaterThan(0.008);
        expect(d).toBeLessThan(0.06);
      }
      expect(angularDistance(second.dir, third.dir)).toBeGreaterThan(0.008);
      if (isDry(412, hop.dir)) expect(isDry(412, second.dir)).toBe(true);
    }
  });
});

