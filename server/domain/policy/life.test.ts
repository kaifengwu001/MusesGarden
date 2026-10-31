import { describe, expect, it } from 'vitest';
import type { Draw, Instant, Interest, MuseState, Temperament } from '../../../src/muse/contract';
import { instant } from '../ids';
import { newInterest } from '../interests';
import { drawFor } from '../rng';
import { emptyState } from '../state';
import { Life, MOSS, t, TEMPERAMENTS, topic } from '../testing';
import { HOUR_MS, localDay, MINUTE_MS } from '../time';
import { next, restUntil } from './life';
import { startTrip } from './travel';

const N = 20_000;
const draws = (salt: number): Draw[] => Array.from({ length: N }, (_, n) => drawFor(MOSS.id, salt * N + n));

function frequencies(s: MuseState, now: Instant, friendFree: boolean, salt = 0): Record<'travel' | 'rest' | 'visit', number> {
  const out = { travel: 0, rest: 0, visit: 0 };
  for (const draw of draws(salt)) out[next(s, now, draw, friendFree)]++;
  return out;
}

function expectWithin3Sigma(count: number, p: number): void {
  expect(Math.abs(count - N * p)).toBeLessThanOrEqual(3 * Math.sqrt(N * p * (1 - p)));
}

function withSalience(s: MuseState, value: number, at: Instant): MuseState {
  const i: Interest = { ...newInterest(topic('Pigment'), at, 'muse'), salience: { value, at } };
  return { ...s, interests: new Map([[i.topic, i]]) };
}

function afterWork(temperament: Temperament, workHours: number, end: Instant): MuseState {
  const life = new Life(MOSS, temperament);
  life.push(end - workHours * HOUR_MS, { kind: 'host.work', state: 'started' });
  life.push(end, { kind: 'host.work', state: 'ended' });
  return life.state;
}

describe('the next activity', () => {
  const now = t('2026-11-04T15:00:00-08:00');

  it('follows the stated weights (plan example: travel 61%, rest 9%, visit 30%)', () => {
    const s = withSalience(emptyState(MOSS, TEMPERAMENTS.hero), 0.4, now);
    const f = frequencies(s, now, true);
    // travel = 1 + 0.6 + 0.4, rest = 0.3 + 1.5·0, visit = 2·0.5·(1.5 h ÷ 1.5 h)
    expectWithin3Sigma(f.travel, 2.0 / 3.3);
    expectWithin3Sigma(f.rest, 0.3 / 3.3);
    expectWithin3Sigma(f.visit, 1.0 / 3.3);
  });

  it('follows the weights after a 6 h work stretch (travel 42%, rest 38%, visit 21%)', () => {
    const s = withSalience(afterWork(TEMPERAMENTS.hero, 6, now), 0.4, now);
    const f = frequencies(s, now, true, 1);
    expectWithin3Sigma(f.travel, 2.0 / 4.8);
    expectWithin3Sigma(f.rest, 1.8 / 4.8);
    expectWithin3Sigma(f.visit, 1.0 / 4.8);
  });

  it('never picks a visit with no friend free, nor for a Muse with no social budget', () => {
    expect(frequencies(emptyState(MOSS, TEMPERAMENTS.hero), now, false).visit).toBe(0);
    expect(frequencies(emptyState(MOSS, TEMPERAMENTS.loner), now, true).visit).toBe(0);
  });

  it('makes rest likelier the more Muse has worked in the last 12 hours', () => {
    const rests = [0, 2, 4, 6].map((h) => frequencies(afterWork(TEMPERAMENTS.hero, h, now), now, false, 2).rest);
    for (let k = 1; k < rests.length; k++) expect(rests[k]).toBeGreaterThan(rests[k - 1]);
    const longAgo = frequencies(afterWork(TEMPERAMENTS.hero, 6, instant(now - 13 * HOUR_MS)), now, false, 2).rest;
    expect(longAgo).toBe(rests[0]);
  });

  it('has no fixed night: at 03:00 Muse may set off on a trip, exactly as at 15:00', () => {
    const night = t('2026-11-04T03:00:00-08:00');
    const afternoon = t('2026-11-04T15:00:00-08:00');
    const s = emptyState(MOSS, TEMPERAMENTS.hero);
    const atNight = draws(3).map((d) => next(s, night, d, false));
    expect(atNight.filter((c) => c === 'travel').length).toBeGreaterThan(N / 2);
    expect(atNight).toEqual(draws(3).map((d) => next(s, afternoon, d, false)));
    expect(draws(3).slice(0, 50).some((d) => startTrip(s, night, d) !== null)).toBe(true);
  });
});

describe('rest', () => {
  it('never runs past 4 h per owner-day, even after heavy work, and the cap binds', () => {
    const life = new Life(MOSS, TEMPERAMENTS.hero);
    const start = t('2026-11-02T08:00:00-08:00');
    const restByDay = new Map<string, number>();
    let n = 0;
    for (let day = 0; day < 4; day++) {
      let now = start + day * 24 * HOUR_MS;
      life.push(now, { kind: 'host.work', state: 'started' });
      now += 7 * HOUR_MS;
      life.push(now, { kind: 'host.work', state: 'ended' });
      while (now < start + (day + 1) * 24 * HOUR_MS) {
        const draw = drawFor(MOSS.id, ++n);
        const rest = next(life.state, instant(now), draw, false) === 'rest';
        const until = rest ? restUntil(life.state, instant(now), draw) : instant(now + 40 * MINUTE_MS);
        life.push(now, { kind: 'episode.started', n, plan: rest ? { activity: 'rest', until } : { activity: 'beyond', until } });
        life.push(until, { kind: 'episode.ended', n });
        if (rest) restByDay.set(localDay(until, MOSS.timezone), (restByDay.get(localDay(until, MOSS.timezone)) ?? 0) + (until - now));
        now = until;
      }
    }
    expect(restByDay.size).toBeGreaterThanOrEqual(4);
    for (const ms of restByDay.values()) expect(ms).toBeLessThanOrEqual(4 * HOUR_MS);
    expect(Math.max(...restByDay.values())).toBeGreaterThan(3.5 * HOUR_MS);
  });
});
