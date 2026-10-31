import { describe, expect, it } from 'vitest';
import type { Discovery } from '../../../src/muse/contract';
import { homePlace } from '../atlas';
import { discoveryId, instant } from '../ids';
import { Life, MOSS, t, topicsOf, wiki } from '../testing';
import { DAY_MS, HOUR_MS, localDay } from '../time';
import { basket, nextBasketCheck } from './basket';

const DAY1 = t('2026-11-02T09:00:00-08:00');

function find(k: number, at: number, keepScore: number): Discovery {
  const title = `Find ${k}`;
  return {
    id: discoveryId(`d:${k}`),
    url: wiki(title),
    canonicalUrl: wiki(title),
    title,
    summary: '',
    topics: topicsOf(title),
    because: [],
    reason: '',
    keepScore,
    provenance: 'own',
    place: homePlace(MOSS.worldSeed),
    at: instant(at),
  };
}

function deliverIfDue(life: Life, at: number): void {
  const b = basket(life.state, instant(at));
  if (b) life.push(at, { kind: 'basket.delivered', basket: b });
}

describe('baskets', () => {
  it('come at most once per owner-day with at most 7 finds, the best by keep score, and every one is kept', () => {
    const life = new Life();
    for (let k = 0; k < 12; k++) {
      life.push(DAY1 + k * 10 * 60_000, { kind: 'discovery.collected', discovery: find(k, DAY1 + k * 10 * 60_000, 0.75 + k * 0.02) });
      deliverIfDue(life, DAY1 + k * 10 * 60_000 + 1);
    }
    for (let k = 12; k < 20; k++) {
      life.push(DAY1 + 3 * HOUR_MS + k * 60_000, { kind: 'discovery.collected', discovery: find(k, DAY1 + 3 * HOUR_MS + k * 60_000, 0.99) });
      deliverIfDue(life, DAY1 + 3 * HOUR_MS + k * 60_000 + 1);
    }
    for (let k = 20; k < 24; k++) {
      life.push(DAY1 + DAY_MS + k * 60_000, { kind: 'discovery.collected', discovery: find(k, DAY1 + DAY_MS + k * 60_000, 0.8) });
      deliverIfDue(life, DAY1 + DAY_MS + k * 60_000 + 1);
    }
    const baskets = life.state.baskets;
    expect(baskets.map((b) => localDay(b.at, MOSS.timezone))).toEqual(['2026-11-02', '2026-11-03']);
    expect(baskets[0].items).toEqual([discoveryId('d:2'), discoveryId('d:1'), discoveryId('d:0')]);
    expect(baskets[1].items).toHaveLength(7);
    expect(baskets[1].items).toEqual([12, 13, 14, 15, 16, 17, 18].map((k) => discoveryId(`d:${k}`)));
    // the second day's basket came with its first find; the three after it wait for tomorrow
    expect(life.state.pendingBasket).toEqual([21, 22, 23].map((k) => discoveryId(`d:${k}`)));
  });

  it('bring a lone find once three days have passed since the last basket', () => {
    const life = new Life();
    life.push(DAY1, { kind: 'discovery.collected', discovery: find(1, DAY1, 0.8) });
    expect(basket(life.state, instant(DAY1 + 2 * DAY_MS))).toBeNull();
    expect(basket(life.state, instant(DAY1 + 3 * DAY_MS))?.items).toEqual([discoveryId('d:1')]);
  });

  it("wait for the owner's chosen time, and say when that is next", () => {
    const life = new Life();
    life.push(DAY1, { kind: 'owner.settings', basketTime: '18:30' });
    for (let k = 0; k < 3; k++) life.push(DAY1, { kind: 'discovery.collected', discovery: find(k, DAY1, 0.8) });
    expect(basket(life.state, instant(DAY1 + HOUR_MS))).toBeNull();
    const at = nextBasketCheck(life.state, instant(DAY1));
    expect(at).toBe(t('2026-11-02T18:30:00-08:00'));
    expect(basket(life.state, at!)?.items).toHaveLength(3);
    expect(nextBasketCheck(life.state, at!)).toBe(t('2026-11-03T18:30:00-08:00'));
    life.push(DAY1, { kind: 'owner.settings', basketTime: null });
    expect(nextBasketCheck(life.state, instant(DAY1))).toBeNull();
  });
});
