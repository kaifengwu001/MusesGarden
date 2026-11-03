import { describe, expect, it } from 'vitest';
import { globeFacing, handSize, parseBoard, TALLY_MOST, tallyGroups, winningLine, type Vec3 } from './postcardBack';

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Directions all over the planet, the poles among them. */
const DIRS: Vec3[] = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [0, 0, -1],
  unit([-0.9817, -0.1822, 0.0547]),
  ...Array.from({ length: 60 }, (_, k): Vec3 => {
    const y = 1 - (2 * (k + 0.5)) / 60;
    const r = Math.sqrt(1 - y * y);
    return [r * Math.cos(k * 2.39996), y, r * Math.sin(k * 2.39996)];
  }),
];

describe('the planet drawn small on a postcard', () => {
  it('turns the planet so the X faces you, off the middle but well inside the disc', () => {
    for (const dir of DIRS) {
      for (const [lean, turn] of [
        [0.3, 0],
        [0.48, 2],
        [0.4, 4.5],
      ]) {
        const x = globeFacing(dir, lean, turn)(dir);
        expect(x.z, `${dir.join(',')}`).toBeGreaterThan(0.85);
        const off = Math.hypot(x.x, x.y);
        expect(off).toBeGreaterThan(0.25);
        expect(off).toBeLessThan(0.5);
      }
    }
  });

  it('hides the other side of the planet, and keeps every point on the disc', () => {
    for (const dir of DIRS) {
      const globe = globeFacing(dir, 0.4, 1);
      expect(globe([-dir[0], -dir[1], -dir[2]]).z).toBeLessThan(0);
      for (const p of DIRS) {
        const q = globe(p);
        expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(1, 6);
        expect(Math.hypot(q.x, q.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('keeps north up: of two spots side by side, the one nearer the north pole is drawn higher', () => {
    const dir = unit([0.6, 0.1, 0.8]);
    const globe = globeFacing(dir, 0.3, 1);
    const north = globe(unit([0.6, 0.3, 0.8]));
    const south = globe(unit([0.6, -0.1, 0.8]));
    expect(north.y).toBeGreaterThan(south.y);
  });
});

describe('noughts and crosses on a postcard', () => {
  it('reads the board row by row: Muse’s crosses, the friend’s noughts and empty cells', () => {
    expect(parseBoard('xo..ox.o.')).toEqual(['x', 'o', null, null, 'o', 'x', null, 'o', null]);
  });

  it('reads a board written in capitals, too short or with other marks, cell by cell', () => {
    expect(parseBoard('XO')).toEqual(['x', 'o', null, null, null, null, null, null, null]);
    expect(parseBoard('x?o-x o!x')).toEqual(['x', null, 'o', null, 'x', null, 'o', null, 'x']);
    expect(parseBoard('xxxxxxxxxxxx')).toHaveLength(9);
  });

  it('finds the line someone won with, and none in a draw', () => {
    expect(winningLine(parseBoard('xo..ox.o.'))).toEqual([1, 4, 7]);
    expect(winningLine(parseBoard('xxxoo....'))).toEqual([0, 1, 2]);
    expect(winningLine(parseBoard('o.x.ox..o'))).toEqual([0, 4, 8]);
    expect(winningLine(parseBoard('xoxoxooxo'))).toBeNull();
    expect(winningLine(parseBoard('.........'))).toBeNull();
  });
});

describe('a tally on a postcard', () => {
  it('counts in fives, the last group what is left over', () => {
    expect(tallyGroups(12)).toEqual([5, 5, 2]);
    expect(tallyGroups(5)).toEqual([5]);
    expect(tallyGroups(3)).toEqual([3]);
    expect(tallyGroups(15)).toEqual([5, 5, 5]);
  });

  it('draws nothing for nothing, or for a count that is not one', () => {
    expect(tallyGroups(0)).toEqual([]);
    expect(tallyGroups(-4)).toEqual([]);
    expect(tallyGroups(Number.NaN)).toEqual([]);
  });

  it('stops drawing marks at the most it has room for', () => {
    const groups = tallyGroups(52);
    expect(groups.reduce((a, b) => a + b, 0)).toBe(TALLY_MOST);
    expect(groups.every((g) => g === 5)).toBe(true);
  });
});

describe('Muse’s hand', () => {
  const steps = [
    [20, 19],
    [40, 16],
    [64, 14],
    [Infinity, 12.5],
  ] as const;

  it('writes longer words no larger than shorter ones', () => {
    let last = Infinity;
    for (let n = 0; n <= 120; n++) {
      const size = handSize(n, steps);
      expect(size).toBeLessThanOrEqual(last);
      last = size;
    }
    expect(handSize(10, steps)).toBe(19);
    expect(handSize(90, steps)).toBe(12.5);
  });
});
