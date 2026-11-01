import { describe, expect, it } from 'vitest';
import type { Discovery, Interest, MuseState, PhotoSpec, PublicDiscovery, RegionKey } from '../../src/muse/contract';
import { angularDistance, homePlace, hopPlace, isDry, placeNow, regionForNewTopic } from './atlas';
import { discoveryId, instant, museId, photoId } from './ids';
import { salienceAt, wLike } from './interests';
import { BOOST_LIKED } from './policy/constants';
import { drawFor } from './rng';
import { Life, MOSS, t, topic, topicsOf, wiki } from './testing';
import { HOUR_MS, MINUTE_MS } from './time';

const BI = 'Botanical illustration';

function startTrip(life: Life, at: number, n: number, topicName: string): RegionKey {
  const region = regionForNewTopic(life.state, null, drawFor(MOSS.id, n));
  life.push(at, { kind: 'episode.started', n, plan: { activity: 'travel', trip: { kind: 'new-area', topic: topic(topicName), region, relatedTo: null, question: null } } });
  life.push(at, { kind: 'region.revealed', region, topic: topic(topicName) });
  return region;
}

describe('the hero chain: Botanical illustration → Pigment → Ultramarine', () => {
  const life = new Life();
  const day = t('2026-11-02T10:00:00-08:00');
  life.push(day, { kind: 'memory.updated', textHash: 'h', topics: topicsOf(BI) });
  const region = startTrip(life, day, 1, BI);
  life.hop(day + 40 * MINUTE_MS, 1, 0, BI, region, [
    { title: BI, score: 0.9, kept: true, topics: [BI, 'Botanical art'] },
    { title: 'Herbarium', score: 0.62 },
    { title: 'Watercolor painting', score: 0.4 },
  ]);
  life.hop(day + 80 * MINUTE_MS, 1, 1, BI, region, [
    { title: 'Pigment', score: 0.86, kept: true, topics: ['Pigment', 'Inorganic pigments'] },
    { title: 'Gum arabic', score: 0.55 },
  ]);
  life.hop(day + 125 * MINUTE_MS, 1, 2, 'Pigment', region, [
    { title: 'Ultramarine', score: 0.93, kept: true, topics: ['Ultramarine', 'Inorganic pigments'] },
    { title: 'Lapis lazuli', score: 0.7 },
  ]);
  life.push(day + 125 * MINUTE_MS, { kind: 'episode.ended', n: 1 });
  const s = life.state;
  const finds = [...s.discoveries.values()].sort((a, b) => a.at - b.at);

  it('keeps three finds, each planted where Muse stood, on dry ground', () => {
    expect(finds.map((d) => d.title)).toEqual([BI, 'Pigment', 'Ultramarine']);
    for (const d of finds) {
      expect(d.place.region).toBe(region);
      expect(isDry(MOSS.worldSeed, d.place.dir)).toBe(true);
    }
  });

  it('lays them out as a trail: each find next to the one before', () => {
    for (let k = 1; k < finds.length; k++) {
      const gap = angularDistance(finds[k - 1].place.dir, finds[k].place.dir);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.12);
    }
  });

  it('gives the topics it found a home in the same region', () => {
    expect(s.interests.get(topic('Pigment'))?.region).toBe(region);
    expect(s.interests.get(topic('Ultramarine'))?.region).toBe(region);
    expect(s.regions.get(region)).toEqual(expect.arrayContaining(topicsOf(BI, 'Pigment', 'Ultramarine')));
    expect(s.collected.has(wiki('Ultramarine'))).toBe(true);
  });

  it('holds a category back until it ties three finds together, then counts all three', () => {
    expect(s.interests.has(topic('Inorganic pigments'))).toBe(false);
    const after = new Life();
    for (const e of life.log) after.push(e.event.at, e.event);
    after.hop(day + 3 * HOUR_MS, 2, 0, 'Pigment', region, [{ title: 'Cobalt blue', score: 0.9, kept: true, topics: ['Cobalt blue', 'Inorganic pigments'] }]);
    expect(after.state.interests.get(topic('Inorganic pigments'))?.sources).toEqual([wiki('Pigment'), wiki('Ultramarine'), wiki('Cobalt blue')]);
  });

  it('remembers good pages it passed over as the frontier, and lifts them out once they get a region', () => {
    expect(s.frontier.map((f) => f.topic)).toEqual(topicsOf('Herbarium', 'Gum arabic', 'Lapis lazuli'));
    for (const f of s.frontier) expect(s.interests.has(f.from), `${f.topic} was seen from a pursued topic`).toBe(true);
    const after = new Life();
    for (const e of life.log) after.push(e.event.at, e.event);
    after.push(day + 3 * HOUR_MS, { kind: 'region.revealed', region: regionForNewTopic(s, topic('Pigment'), drawFor(MOSS.id, 2)), topic: topic('Lapis lazuli') });
    expect(after.state.frontier.map((f) => f.topic)).toEqual(topicsOf('Herbarium', 'Gum arabic'));
  });

  it('marks the region explored when it opens', () => {
    expect(s.regions.has(region)).toBe(true);
    expect(s.lastUnlockAt).toBe(day);
  });
});

describe('work pauses Muse in place', () => {
  const day = t('2026-11-03T09:00:00-08:00');

  function tripWithOneHop(): { life: Life; region: RegionKey } {
    const life = new Life();
    const region = startTrip(life, day, 1, BI);
    life.hop(day + 40 * MINUTE_MS, 1, 0, BI, region, [{ title: BI, score: 0.9, kept: true }]);
    return { life, region };
  }

  it('keeps the episode, its hops and its spot through the pause, and the next hop lands where it would have', () => {
    const { life, region } = tripWithOneHop();
    const before = life.state.episode;
    const spot = placeNow(life.state);
    life.push(day + 50 * MINUTE_MS, { kind: 'host.work', state: 'started' });
    life.push(day + 50 * MINUTE_MS, { kind: 'episode.paused', n: 1, remainingMs: 30 * MINUTE_MS });
    expect(life.state.working).toBe(true);
    expect(placeNow(life.state)).toEqual(spot);
    expect(life.state.episode).toMatchObject({ n: 1, plan: before?.plan, hops: 1, lastKept: before?.lastKept, pausedAt: day + 50 * MINUTE_MS, remainingMs: 30 * MINUTE_MS });

    life.push(day + 4 * HOUR_MS, { kind: 'host.work', state: 'ended' });
    life.push(day + 4 * HOUR_MS, { kind: 'episode.resumed', n: 1 });
    expect(life.state.episode).toMatchObject({ n: 1, hops: 1, pausedAt: null });
    expect(placeNow(life.state)).toEqual(spot);
    const uninterrupted = tripWithOneHop().life.state.episode;
    expect(life.state.episode).toMatchObject({ hops: uninterrupted?.hops, lastKept: uninterrupted?.lastKept });
    expect(placeNow(life.state)).toEqual(hopPlace(MOSS.worldSeed, region, 0, drawFor(MOSS.id, 1)));
  });

  it("counts a paused rest's active time only, and the work in between as work", () => {
    const life = new Life();
    life.push(day, { kind: 'episode.started', n: 1, plan: { activity: 'rest', until: instant(day + HOUR_MS) } });
    life.push(day + 30 * MINUTE_MS, { kind: 'host.work', state: 'started' });
    life.push(day + 30 * MINUTE_MS, { kind: 'episode.paused', n: 1, remainingMs: 30 * MINUTE_MS });
    life.push(day + 120 * MINUTE_MS, { kind: 'host.work', state: 'ended' });
    life.push(day + 120 * MINUTE_MS, { kind: 'episode.resumed', n: 1 });
    life.push(day + 140 * MINUTE_MS, { kind: 'episode.ended', n: 1 });
    expect(life.state.day.restMs).toBe(50 * MINUTE_MS);
    expect(life.state.day.workMs).toBe(90 * MINUTE_MS);
    expect(life.state.episode).toBeNull();
  });

  it('counts a visit as social time', () => {
    const life = new Life();
    life.push(day, { kind: 'episode.started', n: 1, plan: { activity: 'visit', other: museId('wren'), role: 'host', until: instant(day + 50 * MINUTE_MS) } });
    life.push(day + 50 * MINUTE_MS, { kind: 'episode.ended', n: 1 });
    expect(life.state.day.socialMs).toBe(50 * MINUTE_MS);
    expect(life.state.day.restMs).toBe(0);
  });
});

describe('owner seeds and gifts', () => {
  const day = t('2026-11-03T09:00:00-08:00');

  it("turns MEMORY.md's topics into unvisited hypotheses the owner seeded", () => {
    const life = new Life();
    life.push(day, { kind: 'memory.updated', textHash: 'h', topics: topicsOf('Jazz', BI) });
    const jazz = life.state.interests.get(topic('Jazz'));
    expect(jazz).toMatchObject({ stage: 'hypothesis', region: null, seededBy: 'owner-memory', ownerMentionAt: day, affinity: 0 });
    expect(jazz?.salience.value).toBeCloseTo(0.25, 9);
  });

  it('plants a gift near home as a find of its own, waiting for the next basket', () => {
    const life = new Life();
    const received: PublicDiscovery = {
      id: discoveryId('w-lichen'),
      url: wiki('Lichen'),
      canonicalUrl: wiki('Lichen'),
      title: 'Lichen',
      summary: 'A lichen is a composite organism.',
      topics: topicsOf('Lichen'),
    };
    life.push(day, { kind: 'hangout', other: museId('wren'), role: 'host', pleasantness: 0.7, gave: discoveryId('d:x'), received, photo: photoId(MOSS.id, 1, day, 0) });
    const [gift] = [...life.state.discoveries.values()];
    expect(gift).toMatchObject({ provenance: 'gift', title: 'Lichen', canonicalUrl: wiki('Lichen') });
    expect(angularDistance(gift.place.dir, homePlace(MOSS.worldSeed).dir)).toBeLessThan(0.1);
    expect(isDry(MOSS.worldSeed, gift.place.dir)).toBe(true);
    expect(life.state.pendingBasket).toEqual([gift.id]);
    expect(life.state.interests.get(topic('Lichen'))?.sources).toEqual([wiki('Lichen')]);
    expect(life.state.collected.has(wiki('Lichen'))).toBe(true);
  });

  it('never makes a second find of a page Muse already has, from a trip or another gift', () => {
    const life = new Life();
    const received: PublicDiscovery = { id: discoveryId('w-lichen'), url: wiki('Lichen'), canonicalUrl: wiki('Lichen'), title: 'Lichen', summary: '', topics: topicsOf('Lichen') };
    const hangout = (other: string, at: number): void => {
      life.push(at, { kind: 'hangout', other: museId(other), role: 'guest', pleasantness: 0.7, gave: discoveryId('d:x'), received, photo: photoId(MOSS.id, 1, at, 0) });
    };
    hangout('wren', day);
    hangout('juniper', day + HOUR_MS);
    const region = startTrip(life, day + 2 * HOUR_MS, 1, 'Lichen');
    life.hop(day + 3 * HOUR_MS, 1, 0, 'Lichen', region, [{ title: 'Lichen', score: 0.95, kept: true }]);
    expect([...life.state.discoveries.values()].map((d) => [d.title, d.provenance])).toEqual([['Lichen', 'gift']]);
    expect(life.state.interests.get(topic('Lichen'))?.sources).toEqual([wiki('Lichen')]);
  });

  it('lets a hangout with no gift still count as time spent with a friend', () => {
    const life = new Life();
    life.push(day, { kind: 'hangout', other: museId('wren'), role: 'host', pleasantness: 0.4, photo: photoId(MOSS.id, 1, day, 0) });
    expect(life.state.discoveries.size).toBe(0);
    expect(life.state.pendingBasket).toEqual([]);
    expect(life.state.experiencesSinceReflection).toBe(1);
  });
});

describe('the owner likes things in the garden', () => {
  const day = t('2026-11-03T09:00:00-08:00');
  const later = day + 6 * HOUR_MS;

  /** A trip that keeps Pigment (topics Pigment and Inorganic pigments) and photographs it. */
  function lived(): { life: Life; pigment: Discovery; photo: PhotoSpec } {
    const life = new Life();
    life.push(day, { kind: 'memory.updated', textHash: 'h', topics: topicsOf('Jazz') });
    const region = startTrip(life, day, 1, 'Pigment');
    const [pigment] = life.hop(day + HOUR_MS, 1, 0, 'Pigment', region, [{ title: 'Pigment', score: 0.9, kept: true, topics: ['Pigment', 'Inorganic pigments'] }]);
    const photo: PhotoSpec = { id: photoId(MOSS.id, 1, day + HOUR_MS, 0), at: instant(day + HOUR_MS), subject: 'find', planetOf: MOSS.id, dir: pigment.place.dir, forward: pigment.place.dir, zoom: 0.95, companions: [], discoveryId: pigment.id, context: 'planet' };
    life.push(day + HOUR_MS, { kind: 'photo.taken', photo });
    return { life, pigment, photo };
  }
  const salience = (s: MuseState, name: string) => salienceAt(s.interests.get(topic(name)) as Interest, later);

  it("dates each interest from when Muse took it up", () => {
    const { life } = lived();
    expect(life.state.interests.get(topic('Jazz'))?.since).toBe(day);
    expect(life.state.interests.get(topic('Pigment'))?.since).toBe(day);
  });

  it("lifts the liked find's interests by w_like and marks them liked, without making a topic of the rest", () => {
    const { life, pigment } = lived();
    const before = life.state;
    life.push(later, { kind: 'owner.liked', target: { find: pigment.id }, liked: true });
    expect(salience(life.state, 'Pigment') - salience(before, 'Pigment')).toBeCloseTo(BOOST_LIKED * wLike(before), 9);
    expect(life.state.interests.get(topic('Pigment'))?.likedAt).toBe(later);
    expect(life.state.interests.get(topic('Jazz'))).toEqual(before.interests.get(topic('Jazz')));
    expect(life.state.interests.has(topic('Inorganic pigments'))).toBe(false);
    expect(life.state.likes.get(pigment.id)).toEqual({ liked: true, firstAt: later });
  });

  it('nudges only on the first like: unliking and liking again just flip the flag', () => {
    const { life, pigment } = lived();
    life.push(later, { kind: 'owner.liked', target: { find: pigment.id }, liked: true });
    const liked = life.state;
    life.push(later + HOUR_MS, { kind: 'owner.liked', target: { find: pigment.id }, liked: false });
    expect(life.state.likes.get(pigment.id)).toEqual({ liked: false, firstAt: later });
    life.push(later + 2 * HOUR_MS, { kind: 'owner.liked', target: { find: pigment.id }, liked: true });
    expect(life.state.interests).toEqual(liked.interests);
    expect(life.state.likes.get(pigment.id)).toEqual({ liked: true, firstAt: later });
  });

  it("lets a liked photo of a find nudge the find's interests", () => {
    const { life, photo } = lived();
    const before = life.state;
    life.push(later, { kind: 'owner.liked', target: { photo: photo.id }, liked: true });
    expect(salience(life.state, 'Pigment')).toBeGreaterThan(salience(before, 'Pigment'));
    expect(life.state.likes.get(photo.id)).toEqual({ liked: true, firstAt: later });
  });

  it('records a liked photo without a find, and changes no interest', () => {
    const { life } = lived();
    const selfie: PhotoSpec = { id: photoId(MOSS.id, 2, later, 0), at: instant(later), subject: 'selfie', planetOf: MOSS.id, dir: [0, 0, 1], forward: [1, 0, 0], zoom: 0.9, companions: [], context: 'planet' };
    life.push(later, { kind: 'photo.taken', photo: selfie });
    const before = life.state;
    life.push(later, { kind: 'owner.liked', target: { photo: selfie.id }, liked: true });
    expect(life.state.interests).toEqual(before.interests);
    expect(life.state.likes.get(selfie.id)).toEqual({ liked: true, firstAt: later });
  });

  it('does nothing with a like whose target is not in the fold, or an unlike of something never liked', () => {
    const { life, pigment } = lived();
    const before = life.state;
    life.push(later, { kind: 'owner.liked', target: { find: discoveryId('d:nowhere') }, liked: true });
    life.push(later, { kind: 'owner.liked', target: { photo: photoId(MOSS.id, 9, later, 0) }, liked: true });
    life.push(later, { kind: 'owner.liked', target: { find: pigment.id }, liked: false });
    expect(life.state.interests).toEqual(before.interests);
    expect(life.state.likes.size).toBe(0);
  });
});
