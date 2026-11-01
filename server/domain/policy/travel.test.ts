import { describe, expect, it } from 'vitest';
import type { Candidate, Interest, Judgment, MuseState, Temperament, TripStart } from '../../../src/muse/contract';
import { angularDistance, neighbours, regionCentre } from '../atlas';
import { instant } from '../ids';
import { newInterest } from '../interests';
import { drawFor } from '../rng';
import { emptyState } from '../state';
import { Life, MOSS, t, TEMPERAMENTS, topic, topicsOf, wiki } from '../testing';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../time';
import { continueTrip, freshCandidates, keep, startTrip } from './travel';

const START = t('2026-11-02T08:00:00-08:00');
const OWNER_TOPICS = topicsOf('Jazz', 'Botany', 'Origami', 'Tide', 'Sourdough', 'Moss', 'Lichen', 'Fern', 'Kite', 'Pottery', 'Birdwatching', 'Chess');

/** Free days of trips, one every 90 minutes, each folded the way the engine writes it. Returns the unlock times. */
function freeDays(temperament: Temperament, days: number): { unlocks: number[]; life: Life } {
  const life = new Life(MOSS, temperament);
  life.push(START, { kind: 'memory.updated', textHash: 'h', topics: OWNER_TOPICS });
  const unlocks: number[] = [];
  let n = 0;
  for (let now = START + HOUR_MS; now < START + days * DAY_MS; now += 90 * MINUTE_MS) {
    const trip = startTrip(life.state, now, drawFor(MOSS.id, ++n));
    if (trip === null) {
      life.push(now, { kind: 'episode.started', n, plan: { activity: 'beyond', until: instant(now + HOUR_MS) } });
    } else {
      life.push(now, { kind: 'episode.started', n, plan: { activity: 'travel', trip } });
      if (trip.kind !== 'revisit' && !life.state.regions.has(trip.region)) {
        life.push(now, { kind: 'region.revealed', region: trip.region, topic: trip.kind === 'serendipity' ? topic(`Serendipity ${n}`) : trip.topic });
        unlocks.push(now);
      }
    }
    life.push(now + HOUR_MS, { kind: 'episode.ended', n });
  }
  return { unlocks, life };
}

describe('new areas', () => {
  it('open more often the more Muse loves novelty', () => {
    const counts = [0, 0.5, 1].map((novelty) => freeDays({ ...TEMPERAMENTS.homebody, novelty }, 20).unlocks.length);
    expect(counts[0]).toBeLessThanOrEqual(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    expect(counts[0]).toBeLessThan(counts[2]);
  });

  it('keep opening for a homebody: the unlock pressure opens one within every few free days', () => {
    const { unlocks } = freeDays(TEMPERAMENTS.homebody, 14);
    expect(unlocks.length).toBeGreaterThanOrEqual(4);
    const gaps = unlocks.slice(1).map((at, k) => at - unlocks[k]);
    expect(Math.max(...gaps, (START + 14 * DAY_MS) - (unlocks.at(-1) ?? 0))).toBeLessThan(4 * DAY_MS);
  });

  it("open MEMORY.md's interests first, in fogged regions next to home", () => {
    const { life } = freeDays(TEMPERAMENTS.explorer, 1);
    const first = life.log.find((e) => e.event.kind === 'region.revealed');
    expect(first?.event.kind === 'region.revealed' && OWNER_TOPICS.includes(first.event.topic)).toBe(true);
    if (first?.event.kind !== 'region.revealed') return;
    expect(first.event.region).not.toBe(life.state.home);
    expect(angularDistance(regionCentre(first.event.region), regionCentre(life.state.home))).toBeLessThan(0.6);
  });

  it('open a frontier topic next to the topic it was glimpsed from', () => {
    const life = new Life(MOSS, { ...TEMPERAMENTS.explorer, curiosity: 0 });
    const r = neighbours(life.state.home)[0];
    life.push(START, { kind: 'episode.started', n: 1, plan: { activity: 'travel', trip: { kind: 'new-area', topic: topic('Pigment'), region: r, relatedTo: null, question: null } } });
    life.push(START, { kind: 'region.revealed', region: r, topic: topic('Pigment') });
    life.hop(START + HOUR_MS, 1, 0, 'Pigment', r, [{ title: 'Lapis lazuli', score: 0.7 }]);
    life.push(START + HOUR_MS, { kind: 'episode.ended', n: 1 });
    const trips = Array.from({ length: 200 }, (_, n) => startTrip(life.state, START + 2 * HOUR_MS, drawFor(MOSS.id, 100 + n)));
    const lapis = trips.filter((x): x is Extract<TripStart, { kind: 'new-area' }> => x?.kind === 'new-area');
    expect(lapis.length).toBeGreaterThan(0);
    for (const x of lapis) {
      expect(x).toMatchObject({ topic: topic('Lapis lazuli'), relatedTo: topic('Pigment') });
      expect(angularDistance(regionCentre(x.region), regionCentre(r))).toBeLessThan(0.6);
      expect(life.state.regions.has(x.region)).toBe(false);
    }
  });

  it('send serendipity far from home', () => {
    const s = emptyState(MOSS, { ...TEMPERAMENTS.explorer, curiosity: 1, sociability: 0 });
    const far = Array.from({ length: 400 }, (_, n) => startTrip(s, START, drawFor(MOSS.id, n))).filter((x) => x?.kind === 'serendipity');
    expect(far.length).toBeGreaterThan(0);
    for (const x of far) expect(angularDistance(regionCentre(x.region), regionCentre(s.home))).toBeGreaterThanOrEqual(Math.PI / 2);
  });
});

describe('beyond the planet', () => {
  it('happens with P = 0.25 · curiosity · sociability', () => {
    const n = 20_000;
    const s = emptyState(MOSS, TEMPERAMENTS.hero);
    let beyond = 0;
    for (let k = 0; k < n; k++) if (startTrip(s, START, drawFor(MOSS.id, k)) === null) beyond++;
    const p = 0.25 * 0.6 * 0.5;
    expect(Math.abs(beyond - n * p)).toBeLessThanOrEqual(3 * Math.sqrt(n * p * (1 - p)));
  });
});

describe('revisits', () => {
  /** A Muse with three explored topics and no pull to new areas or beyond. */
  function settled(scores: readonly [number, number][]): MuseState {
    const s = emptyState(MOSS, { curiosity: 0, focus: 0.5, sociability: 0, whimsy: 0.5, novelty: 0 });
    const now = START;
    const interests = new Map(
      scores.map(([affinity, salience], k): [Interest['topic'], Interest] => {
        const i = newInterest(topic(`T${k}`), now, 'muse');
        return [i.topic, { ...i, region: s.home, affinity, salience: { value: salience, at: now } }];
      }),
    );
    return { ...s, interests, lastUnlockAt: now };
  }

  it('pick a topic by softmax over its score (plan example: 0.55, 0.45, 0.10 → 64%, 33%, 3%)', () => {
    const s = settled([
      [1, 2 / 3],
      [1, 1 / 3],
      [0, 1 / 3],
    ]);
    const n = 20_000;
    const counts = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const trip = startTrip(s, START, drawFor(MOSS.id, k));
      if (trip?.kind === 'revisit') counts[Number(trip.topic.slice(1))]++;
    }
    const e = [Math.exp(0.55 / 0.15), Math.exp(0.45 / 0.15), Math.exp(0.1 / 0.15)];
    const total = e[0] + e[1] + e[2];
    e.forEach((x, k) => {
      const p = x / total;
      expect(Math.abs(counts[k] - n * p)).toBeLessThanOrEqual(3 * Math.sqrt(n * p * (1 - p)));
    });
  });

  it('lean toward a topic the owner liked within the week by 0.20 · w_like, and let it go after', () => {
    const base = settled([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    const liked = { ...base, interests: new Map(base.interests).set(topic('T1'), { ...(base.interests.get(topic('T1')) as Interest), likedAt: START }) };
    const share = (s: MuseState, now: number): number => {
      const revisits = Array.from({ length: 20_000 }, (_, k) => startTrip(s, now, drawFor(MOSS.id, k))).filter((trip) => trip?.kind === 'revisit');
      return revisits.filter((trip) => trip.topic === topic('T1')).length / revisits.length;
    };
    const lean = Math.exp((0.2 * 0.5) / 0.15);
    expect(share(liked, START + DAY_MS)).toBeCloseTo(lean / (1 + lean), 1);
    expect(share(liked, START + 8 * DAY_MS)).toBeCloseTo(0.5, 1);
  });

  it('look only at pages Muse has not collected, and go back to where the topic lives', () => {
    const life = new Life(MOSS, { ...TEMPERAMENTS.homebody, sociability: 0 });
    const r = neighbours(life.state.home)[1];
    life.push(START, { kind: 'episode.started', n: 1, plan: { activity: 'travel', trip: { kind: 'new-area', topic: topic('Pigment'), region: r, relatedTo: null, question: null } } });
    life.push(START, { kind: 'region.revealed', region: r, topic: topic('Pigment') });
    life.hop(START + HOUR_MS, 1, 0, 'Pigment', r, [{ title: 'Pigment', score: 0.9, kept: true }]);
    life.push(START + HOUR_MS, { kind: 'episode.ended', n: 1 });
    const back = startTrip(life.state, START + 2 * HOUR_MS, drawFor(MOSS.id, 2));
    expect(back).toMatchObject({ kind: 'revisit', topic: topic('Pigment'), region: r });
    const page = (title: string): Candidate => ({ origin: 'wikipedia', url: wiki(title), canonicalUrl: wiki(title), title, summary: '', topics: [topic(title)] });
    expect(freshCandidates(life.state, [page('Pigment'), page('Ultramarine')]).map((c) => c.title)).toEqual(['Ultramarine']);
  });
});

describe('hops', () => {
  const j = (score: number, title: string): Judgment => ({ canonicalUrl: wiki(title), score, reason: '' });

  it('keep at most two pages scoring at least 0.75, best first', () => {
    expect(keep([j(0.8, 'a'), j(0.74, 'b'), j(0.95, 'c'), j(0.9, 'd')]).map((x) => x.score)).toEqual([0.95, 0.9]);
    expect(keep([j(0.7, 'a')])).toEqual([]);
  });

  it('continue with P = focus × best score', () => {
    const rate = (focus: number, best: number): number => {
      const s = { ...emptyState(MOSS), temperament: { ...TEMPERAMENTS.hero, focus } };
      let yes = 0;
      for (let k = 0; k < 4000; k++) if (continueTrip(s, 1, best, drawFor(MOSS.id, k))) yes++;
      return yes / 4000;
    };
    expect(rate(0, 1)).toBe(0);
    expect(rate(1, 1)).toBe(1);
    expect(rate(0.7, 0.9)).toBeCloseTo(0.63, 1);
  });
});

