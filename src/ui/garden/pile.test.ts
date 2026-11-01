import { describe, expect, it } from 'vitest';
import { PILE_SHOWN, stackSlot, underSlot, type Slot } from './pile';

/** The ground a pile covers: the span of its cards' offsets, and the smallest card. */
function footprint(slots: Slot[]): { left: number; right: number; top: number; bottom: number; tilt: number; smallest: number } {
  return {
    left: Math.min(...slots.map((s) => s.x)),
    right: Math.max(...slots.map((s) => s.x)),
    top: Math.min(...slots.map((s) => s.y)),
    bottom: Math.max(...slots.map((s) => s.y)),
    tilt: Math.max(...slots.map((s) => Math.abs(s.r))),
    smallest: Math.min(...slots.map((s) => s.s)),
  };
}

const range = (n: number): number[] => Array.from({ length: n }, (_, k) => k);
const COUNTS = [1, 2, 5, 6, 7, 12, 43, 120, 500];

describe('the stack on the table', () => {
  const six = footprint(range(PILE_SHOWN).map(stackSlot));

  it.each(COUNTS)('a stack of %i covers no more ground than a stack of six', (n) => {
    const all = footprint(range(n).map(stackSlot));
    expect(all.bottom).toBeLessThanOrEqual(six.bottom);
    expect(all.top).toBeGreaterThanOrEqual(six.top);
    expect(all.smallest).toBeGreaterThanOrEqual(six.smallest);
    expect(Math.max(Math.abs(all.left), Math.abs(all.right))).toBeLessThanOrEqual(19);
    expect(all.tilt).toBeLessThanOrEqual(5);
  });

  it.each(COUNTS)('a stack of %i shows at most six cards, the top ones', (n) => {
    const shown = range(n).filter((k) => stackSlot(k).shown);
    expect(shown).toEqual(range(Math.min(n, PILE_SHOWN)));
  });
});

describe('the pile under a card up close', () => {
  it.each(COUNTS)('with %i cards, whichever is up close, the pile covers bounded ground', (n) => {
    for (const k of new Set([0, 1, Math.floor(n / 2), n - 2, n - 1].filter((k) => k >= 0))) {
      const pile = range(n).filter((i) => i !== k);
      if (pile.length === 0) continue;
      const all = footprint(pile.map((i) => underSlot(i, k)));
      expect(all.top).toBeGreaterThanOrEqual(150);
      expect(all.bottom).toBeLessThanOrEqual(150 + (PILE_SHOWN - 1) * 4);
      expect(Math.max(Math.abs(all.left), Math.abs(all.right))).toBeLessThanOrEqual(50);
      expect(all.tilt).toBeLessThanOrEqual(5);
      expect(pile.filter((i) => underSlot(i, k).shown)).toHaveLength(Math.min(pile.length, PILE_SHOWN));
    }
  });
});
