import { describe, expect, it } from 'vitest';
import { FLOWER_PICTURES, FLOWER_SETS, HEAD_SCALE, standPicture, type Point } from './flowerPictures';

// A picture stands on its flower's stem as the screen shows it: the overlay's button sits on its head, its stem
// reaches down to its foot, and its head keeps the shape it was drawn with.

const STEMS: ReadonlyArray<{ name: string; foot: Point; head: Point; stem: number }> = [
  { name: 'upright', foot: { x: 400, y: 500 }, head: { x: 400, y: 330 }, stem: 170 },
  { name: 'leaning right', foot: { x: 400, y: 500 }, head: { x: 480, y: 360 }, stem: 170 },
  { name: 'lying left', foot: { x: 400, y: 500 }, head: { x: 330, y: 497 }, stem: 70 },
  { name: 'tipped toward you', foot: { x: 400, y: 500 }, head: { x: 395, y: 400 }, stem: 170 },
  { name: 'small, in the rail', foot: { x: 1380, y: 450 }, head: { x: 1384, y: 444 }, stem: 7 },
];

const near = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

describe.each(Object.entries(FLOWER_SETS))('a flower’s picture, %s', (_, set) => {
  for (const [species, p] of set.entries()) {
    for (const { name, foot, head, stem } of STEMS) {
      it(`of species ${species}, ${name}: stands with its foot on the stem’s foot and its bloom on its head`, () => {
        const at = standPicture(p, foot, head, stem);
        expect(near(at(p.foot[0], p.foot[1]), foot)).toBeLessThan(1e-6);
        expect(near(at(p.bloom[0], p.bloom[1]), head)).toBeLessThan(1e-6);
      });

      it(`of species ${species}, ${name}: keeps its head’s drawn shape, sized by the stem`, () => {
        const at = standPicture(p, foot, head, stem);
        const [bx, by] = p.bloom;
        const middle = at(bx, by);
        const radius = (HEAD_SCALE * stem * p.head) / Math.hypot(bx - p.foot[0], by - p.foot[1]);
        for (const [dx, dy] of [
          [p.head, 0],
          [-p.head, 0],
          [0, -p.head],
          [p.head * 0.6, -p.head * 0.8],
        ])
          expect(near(at(bx + dx, by + dy), middle) / radius).toBeCloseTo(1, 6);
      });
    }
  }
});

describe('a flower’s picture', () => {
  it('shrinks its head with its scale, still on its stem', () => {
    const p = FLOWER_PICTURES[0];
    const { foot, head, stem } = STEMS[1];
    const big = standPicture(p, foot, head, stem);
    const small = standPicture(p, foot, head, stem, HEAD_SCALE / 2);
    const top = [p.bloom[0], p.bloom[1] - p.head] as const;
    expect(near(small(...top), head) / near(big(...top), head)).toBeCloseTo(0.5, 6);
    expect(near(small(...p.foot), foot)).toBeLessThan(1e-6);
    expect(near(small(...p.bloom), head)).toBeLessThan(1e-6);
  });
});
