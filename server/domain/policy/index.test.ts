import { describe, expect, it } from 'vitest';
import type { Candidate, Judgment, ReflectionProposal } from '../../../src/muse/contract';
import { hash32, salt, unit } from '../../../src/core/hash';
import { discoveryId, eventRef, instant, topicKey } from '../ids';
import { metrics } from '../metrics';
import { drawFor } from '../rng';
import { shelf } from '../shelf';
import { Life, MOSS, t, TEMPERAMENTS, topicsOf, wiki } from '../testing';
import { DAY_MS, localDay } from '../time';
import { freshCandidates } from './travel';
import { lifePolicy as life } from './index';

const START = t('2026-11-02T07:00:00-08:00');
const OWNER = topicsOf('Botanical illustration', 'Jazz', 'Tide');

/** A stand-in Source and Mind: eight pages per topic, scored by a hash of their title. */
function pages(topic: string): Candidate[] {
  return Array.from({ length: 8 }, (_, k) => {
    const title = `${topic} ${k}`;
    return { origin: 'wikipedia', url: wiki(title), canonicalUrl: wiki(title), title, summary: '', topics: topicsOf(title, topic) };
  });
}
const judge = (cs: readonly Candidate[]): Judgment[] => cs.map((c) => ({ canonicalUrl: c.canonicalUrl, score: unit(hash32(salt(c.title))), reason: 'good' }));

/** A week of free time driven entirely by lifePolicy, folded the way the engine writes events. */
function aWeek(): Life {
  const muse = new Life(MOSS, TEMPERAMENTS.hero);
  muse.push(START, { kind: 'memory.updated', textHash: 'h', topics: OWNER });
  let now: number = START;
  let n = 0;
  const photos = (activity: 'rest' | 'travel' | 'beyond', from: number, to: number, n: number): void => {
    for (const photo of life.photosDuring(muse.state, activity, instant(from), instant(to), drawFor(MOSS.id, n))) muse.push(to, { kind: 'photo.taken', photo });
  };
  while (now < START + 7 * DAY_MS) {
    const draw = drawFor(MOSS.id, ++n);
    const at = instant(now);
    if (life.next(muse.state, at, draw, 'none') === 'rest') {
      if (life.reflectionDue(muse.state, at)) {
        const kept = life.experiences(muse.state, muse.log).filter((x) => x.kind === 'kept');
        const proposal: ReflectionProposal = {
          deltas: kept.map((x) => ({ topic: x.topics[1] ?? x.topics[0], dAffinity: 0.1, stage: 'emerging', evidence: [x.ref], reason: 'again' })),
          narrative: 'More of the same, and gladly.',
          questions: [],
        };
        muse.push(now, life.validateReflection(muse.state, muse.log, proposal, at));
      }
      const until = life.restUntil(muse.state, at, draw);
      muse.push(now, { kind: 'episode.started', n, plan: { activity: 'rest', until } });
      photos('rest', now, until, n);
      muse.push(until, { kind: 'episode.ended', n });
      now = Math.max(until, now + 60_000);
      continue;
    }
    const trip = life.startTrip(muse.state, at, draw);
    if (trip === null) {
      const until = life.beyondUntil(muse.state, at, draw);
      muse.push(now, { kind: 'episode.started', n, plan: { activity: 'beyond', until } });
      photos('beyond', now, until, n);
      muse.push(until, { kind: 'episode.ended', n });
      now = until;
      continue;
    }
    muse.push(now, { kind: 'episode.started', n, plan: { activity: 'travel', trip } });
    let topic = trip.kind === 'serendipity' ? topicKey(`Far place ${n}`) : trip.topic;
    if (trip.kind !== 'revisit' && !muse.state.regions.has(trip.region)) muse.push(now, { kind: 'region.revealed', region: trip.region, topic });
    for (let k = 0; ; k++) {
      const since = now;
      now += life.hopMs(muse.state, draw);
      const judgments = judge(freshCandidates(muse.state, pages(topic)));
      const kept = life.keep(judgments);
      const place = life.hopPlace(muse.state, trip.region, k, draw);
      const ids = kept.map((_, i) => discoveryId(`d:${n}:${k}:${i}`));
      const looked = judgments.map((j) => ({ canonicalUrl: j.canonicalUrl, title: j.canonicalUrl, topics: [topic], score: j.score, reason: j.reason, kept: kept.includes(j) }));
      const hop = muse.push(now, { kind: 'trip.hop', n, k, topic, place, looked, kept: ids });
      kept.forEach((j, i) => {
        const c = pages(topic).find((p) => p.canonicalUrl === j.canonicalUrl)!;
        const discovery = { ...c, id: ids[i], because: [eventRef(MOSS.id, hop.seq)], reason: j.reason, keepScore: j.score, provenance: 'own' as const, place, at: instant(now) };
        muse.push(now, { kind: 'discovery.collected', discovery });
      });
      photos('travel', since, now, n);
      const b = life.basket(muse.state, instant(now));
      if (b) muse.push(now, { kind: 'basket.delivered', basket: b });
      const best = Math.max(0, ...judgments.map((j) => j.score));
      if (!life.continueTrip(muse.state, k, best, draw) || k >= 7) break;
      topic = kept[0] ? topicKey(pages(topic).find((p) => p.canonicalUrl === kept[0].canonicalUrl)!.title) : topic;
    }
    muse.push(now, { kind: 'episode.ended', n });
  }
  return muse;
}

describe('a week of free time under lifePolicy', () => {
  const muse = aWeek();
  const rows = metrics(muse.state, muse.log);

  it('keeps every daily cap', () => {
    for (const r of rows) {
      expect(r.restHours, r.day).toBeLessThanOrEqual(4);
      expect(r.photos, r.day).toBeLessThanOrEqual(5);
    }
    const perDay = new Map<string, number>();
    for (const b of muse.state.baskets) {
      perDay.set(localDay(b.at, MOSS.timezone), (perDay.get(localDay(b.at, MOSS.timezone)) ?? 0) + 1);
      expect(b.items.length).toBeLessThanOrEqual(7);
    }
    expect([...perDay.values()].every((c) => c === 1)).toBe(true);
    expect(shelf(muse.state, muse.state.at).length).toBeLessThanOrEqual(10);
  });

  it('lives a full life: finds, new areas, revisits, rest, photos, baskets and reflection', () => {
    const total = (k: 'finds' | 'newAreas' | 'revisits' | 'photos' | 'restHours') => rows.reduce((sum, r) => sum + r[k], 0);
    expect(total('finds')).toBeGreaterThan(14);
    expect(total('newAreas')).toBeGreaterThanOrEqual(4);
    expect(total('revisits')).toBeGreaterThan(0);
    expect(total('photos')).toBeGreaterThan(0);
    expect(total('restHours')).toBeGreaterThan(0);
    expect(muse.state.baskets.length).toBeGreaterThanOrEqual(3);
    expect(muse.state.reflections.length).toBeGreaterThanOrEqual(1);
  });

  it("starts out following the owner's interests", () => {
    expect(rows[0].ownerDrivenShare).toBeGreaterThan(0);
  });
});

