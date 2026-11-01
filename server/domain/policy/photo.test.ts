import { describe, expect, it } from 'vitest';
import type { MuseState, Relationship, Temperament } from '../../../src/muse/contract';
import { instant, museId } from '../ids';
import { drawFor } from '../rng';
import { Life, MOSS, t, TEMPERAMENTS, topic } from '../testing';
import { HOUR_MS, localDay, MINUTE_MS } from '../time';
import { photosDuring } from './photo';

const START = t('2026-11-02T00:30:00-08:00');
const WREN = museId('wren');

const friend: Relationship = {
  other: WREN,
  status: 'friends',
  origin: 'introduced',
  friendsSince: null,
  familiarity: 0,
  rapport: 2,
  rapportSinceInvite: 0,
  unpleasantStreak: 0,
  distance: 0,
  encounters: 0,
  hangouts: 2,
  lastRole: null,
  lastMetAt: null,
  lastInviteAt: null,
  fondness: 0,
};

/** Three days beyond the planet in 90-minute trips, photos folded as the engine would. Photos per owner-day. */
function threeDaysBeyond(temperament: Temperament, withFriend: boolean): Map<string, number> {
  const life = new Life(MOSS, temperament);
  const befriend = <S extends MuseState>(s: S): S => (withFriend ? { ...s, social: { ...s.social, relationships: new Map([[WREN, friend]]) } } : s);
  let n = 0;
  for (let now: number = START; now < START + 72 * HOUR_MS; now += 90 * MINUTE_MS) {
    n++;
    const until = now + 90 * MINUTE_MS;
    life.push(now, { kind: 'episode.started', n, plan: { activity: 'beyond', until: instant(until) } });
    life.state = befriend(life.state);
    for (const photo of photosDuring(life.state, 'beyond', now, until, drawFor(MOSS.id, n))) life.push(until, { kind: 'photo.taken', photo });
    life.push(until, { kind: 'episode.ended', n });
  }
  const perDay = new Map<string, number>();
  for (const p of life.state.photos) perDay.set(localDay(p.at, MOSS.timezone), (perDay.get(localDay(p.at, MOSS.timezone)) ?? 0) + 1);
  return perDay;
}

describe('photos', () => {
  it('never pass 5 per owner-day, and a keen photographer hits the cap', () => {
    const perDay = threeDaysBeyond(TEMPERAMENTS.shutterbug, false);
    expect([...perDay.values()].every((c) => c <= 5)).toBe(true);
    expect(Math.max(...perDay.values())).toBe(5);
  });

  it('leave room for the hangout photos today still has time for', () => {
    // sociability 0.5: 1.5 h of social time left, so two 50-minute hangouts' photos are set aside
    const perDay = threeDaysBeyond(TEMPERAMENTS.shutterbug, true);
    expect(Math.max(...perDay.values())).toBe(3);
  });

  it('scale with whimsy: a Muse with none takes none', () => {
    const perDay = threeDaysBeyond({ ...TEMPERAMENTS.shutterbug, whimsy: 0 }, false);
    expect(perDay.size).toBe(0);
  });

  it('show the find Muse just kept, where it stood', () => {
    const life = new Life(MOSS, TEMPERAMENTS.shutterbug);
    const now = t('2026-11-02T10:00:00-08:00');
    const region = life.state.home;
    life.push(now, { kind: 'episode.started', n: 1, plan: { activity: 'travel', trip: { kind: 'revisit', topic: topic('Pigment'), region, question: null } } });
    const [find] = life.hop(now + HOUR_MS, 1, 0, 'Pigment', region, [{ title: 'Pigment', score: 0.9, kept: true }]);
    const photos = Array.from({ length: 40 }, (_, k) => photosDuring(life.state, 'travel', now + k * 6 * HOUR_MS, now + (k + 1) * 6 * HOUR_MS, drawFor(MOSS.id, 1))).flat();
    const ofFind = photos.filter((p) => p.subject === 'find');
    expect(ofFind.length).toBeGreaterThan(0);
    for (const p of ofFind) expect(p).toMatchObject({ discoveryId: find.id, dir: find.place.dir, planetOf: MOSS.id });
  });
});
