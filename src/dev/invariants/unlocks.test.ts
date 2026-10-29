import { describe, expect, it } from 'vitest';
import { radiusOfArea } from '../../planet/growth';
import { generateLayout, Terrain, UNLOCK } from '../../planet/terrain';

// Macro features bloom in by rank as the surface area passes their
// thresholds, and fold away again when it shrinks.

const PARAMS = { meadowRoll: 1.4, mountainHeight: 0.18, channelWidth: 3.2 };

function at(area: number): Terrain {
  const t = new Terrain(generateLayout(412, 3, 4));
  const r = radiusOfArea(area);
  t.update(r, Math.log(r), PARAMS);
  return t;
}

describe('macro unlocks', () => {
  it('opens pond 2 only past its area threshold', () => {
    expect(at(UNLOCK.pond2 * 0.9).pondRadius[1]).toBe(0);
    expect(at(UNLOCK.pond2 * 1.6).pondRadius[1]).toBeGreaterThan(5);
  });

  it('adds the channel branch and the mountain spur in rank order', () => {
    const before = at(UNLOCK.branch * 0.95);
    expect(before.branchUnlock).toBe(0);
    expect(before.spurUnlock).toBe(0);
    const mid = at(UNLOCK.branch * 1.7);
    expect(mid.branchUnlock).toBe(1);
    expect(mid.spurUnlock).toBe(0);
    expect(at(UNLOCK.spur * 1.7).spurUnlock).toBe(1);
  });

  it('meanders more as channels lengthen', () => {
    const small = at(4 * Math.PI * 50 * 50);
    const big = at(4 * Math.PI * 300 * 300);
    expect(small.meander2).toBe(0);
    expect(big.meander1).toBe(1);
    expect(big.meander2).toBe(1);
  });
});
