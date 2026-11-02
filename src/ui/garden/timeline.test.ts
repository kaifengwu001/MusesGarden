import { describe, expect, it } from 'vitest';
import { dayLabel, MIN_SPREAD, nearestDot, timelineLayout } from './timeline';

/** The track under the basket on a 390 px phone. */
const W = 330;

function run(from: string, count: number, step = 1): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, k) => new Date(start + k * step * 86_400_000).toISOString().slice(0, 10));
}

/** 50 days in a row, a hundred days with none, then ten more in a row. */
const CLUSTERS = [...run('2026-03-01', 50), ...run('2026-07-29', 10)];
const CASES = [
  { name: 'five baskets', days: run('2026-09-27', 5, 7) },
  { name: 'sixty, in two dense runs with a gap', days: CLUSTERS },
  { name: 'a year of them', days: run('2025-11-01', 365) },
];

/** The dots in day order. */
const sorted = (days: readonly string[], xs: readonly number[]): number[] =>
  days
    .map((d, i) => [d, xs[i]] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, x]) => x);

const focuses = (step: number): number[] => Array.from({ length: Math.floor((W + 40) / step) + 1 }, (_, k) => -20 + k * step);

describe('the day timeline', () => {
  it('puts a lone basket in the middle, with no months to mark', () => {
    for (const focus of [null, 0, 100, W]) expect(timelineLayout(['2026-10-31'], focus, W)).toEqual({ xs: [W / 2], ticks: [] });
  });

  it.each(CASES)('places $name by day, the oldest at the left end and the newest at the right, however the lens sits', ({ days }) => {
    for (const focus of [null, ...focuses(3)]) {
      const xs = sorted(days, timelineLayout(days, focus, W).xs);
      expect(xs[0]).toBe(0);
      expect(xs[xs.length - 1]).toBe(W);
      for (let k = 1; k < xs.length; k++) expect(xs[k], `focus ${focus}, dot ${k}`).toBeGreaterThan(xs[k - 1]);
    }
  });

  it('without a lens, spaces the dots as their days are spaced', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-11', '2026-10-31'];
    expect(timelineLayout(days, null, 300).xs).toEqual([0, 10, 100, 300]);
  });

  it('takes the days in any order', () => {
    const days = CLUSTERS;
    const shuffled = days.map((d, i) => ({ d, k: Math.sin(i * 12.9898) })).sort((a, b) => a.k - b.k).map((e) => e.d);
    const a = timelineLayout(days, 120, W);
    const b = timelineLayout(shuffled, 120, W);
    const at = new Map(days.map((d, i) => [d, a.xs[i]]));
    shuffled.forEach((d, i) => expect(b.xs[i]).toBeCloseTo(at.get(d) ?? NaN, 9));
  });

  it('leaves a roomy track as its days put it', () => {
    const days = CASES[0].days;
    const plain = timelineLayout(days, null, W).xs;
    for (const focus of focuses(1)) timelineLayout(days, focus, W).xs.forEach((x, i) => expect(x).toBeCloseTo(plain[i], 6));
  });

  it.each(CASES.slice(1))('with $name, spreads the day nearest the focus and two either side of it at least 28 px apart', ({ days }) => {
    const plain = timelineLayout(days, null, W);
    for (const focus of focuses(1)) {
      const xs = sorted(days, timelineLayout(days, focus, W).xs);
      const near = sorted(days, days.map((_, i) => i)).indexOf(nearestDot(plain, focus));
      for (let k = Math.max(1, near - 1); k <= Math.min(xs.length - 1, near + 2); k++) expect(xs[k] - xs[k - 1], `focus ${focus}, dots ${k - 1}–${k}`).toBeGreaterThanOrEqual(MIN_SPREAD - 1e-6);
    }
  });

  it('near an end, spreads every day between the focus and that end, so the newest and oldest stay easy to hit', () => {
    const days = CASES[2].days;
    for (const [focus, from, to] of [
      [327, 361, 364],
      [W, 362, 364],
      [3, 0, 3],
      [0, 0, 2],
    ] as const) {
      const xs = sorted(days, timelineLayout(days, focus, W).xs);
      for (let k = from + 1; k <= to; k++) expect(xs[k] - xs[k - 1], `focus ${focus}, dots ${k - 1}–${k}`).toBeGreaterThanOrEqual(MIN_SPREAD - 1e-6);
    }
  });

  it('keeps the day under the pointer under it, away from the ends', () => {
    const days = CASES[2].days;
    const plain = timelineLayout(days, null, W);
    for (const focus of [140, 165, 190]) {
      const under = nearestDot(plain, focus);
      expect(Math.abs(timelineLayout(days, focus, W).xs[under] - focus)).toBeLessThan(MIN_SPREAD / 2);
    }
  });

  it('moves the dots smoothly as the focus moves, with no jumps', () => {
    const days = CASES[2].days;
    for (const focus of focuses(7)) {
      const a = timelineLayout(days, focus, W).xs;
      const b = timelineLayout(days, focus + 0.01, W).xs;
      expect(Math.max(...a.map((x, i) => Math.abs(x - b[i])))).toBeLessThan(1);
    }
  });

  it('marks where each month starts, through the lens as the dots go, named once there is room', () => {
    const days = CASES[2].days;
    for (const focus of [null, 40, 165, 300]) {
      const layout = timelineLayout(days, focus, W);
      const firsts = days.flatMap((d, i) => (d.endsWith('-01') && d !== days[0] ? [layout.xs[i]] : []));
      expect(layout.ticks.map((t) => t.x)).toEqual(firsts);
      const named = layout.ticks.filter((t) => t.label !== null);
      expect(named[0].label).toBe(layout.ticks[0].label);
      for (let k = 1; k < named.length; k++) expect(named[k].x - named[k - 1].x).toBeGreaterThanOrEqual(32);
    }
    // on a wide track every month is named, January with its year
    expect(timelineLayout(days, null, 1200).ticks.map((t) => t.label)).toEqual(['Dec', 'Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  });

  it('marks months in a long gap with no baskets in it', () => {
    const ticks = timelineLayout(CLUSTERS, null, W).ticks;
    expect(ticks).toHaveLength(5);
    // April to July fall in the gap: evenly along it, as days do
    const gaps = ticks.slice(1).map((t, k) => t.x - ticks[k].x);
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(31 / 28 + 1e-9);
  });
});

describe('the label over a day', () => {
  const now = new Date(2026, 10, 1, 12);
  it('names the day and its date, and the basket’s title when it has one', () => {
    expect(dayLabel('2026-11-01', 'Ferns and ink', now)).toBe('Today, Nov 1 Sun · Ferns and ink');
    expect(dayLabel('2026-10-31', undefined, now)).toBe('Yesterday, Oct 31 Sat');
    expect(dayLabel('2026-10-28', 'Rain on the pond', now)).toBe('Oct 28 Wed · Rain on the pond');
    expect(dayLabel('2026-10-21', 'Ferns and ink', now)).toBe('Oct 21 Wed · Ferns and ink');
  });
});
