import { describe, expect, it } from 'vitest';
import type { CanonicalUrl, DiscoveryId, Instant, MuseId, PhotoId, PhotoSpec, StoredEvent, TopicKey, TripReport } from '../../src/muse/contract';
import { agentSoulText, clampTemperament, composedBasket, nextMidnight, planTrip, stopsOf, waitingBasket } from './agent';
import { anyPlan } from './policy/postcard';
import { parseSoul } from './soul';
import { emptyState } from './state';
import { find } from './social/testkit';

const T0 = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const TZ = 'America/Los_Angeles';
const A = 'https://example.org/a';
const B = 'https://example.org/b';
const report = (over: Partial<TripReport> = {}): TripReport => ({ thread: 'blue', path: [A, B], kept: [{ url: A, why: 'Blue.' }, { url: `${B}/x`, why: 'Bluer.', from: B }], ...over });

describe('a trip report', () => {
  it('pairs each kept link with the page it was found on', () => {
    expect(planTrip(report())).toEqual({
      ok: true,
      trip: { thread: 'blue', question: null, path: [A, B], kept: [{ url: A, why: 'Blue.', page: A }, { url: `${B}/x`, why: 'Bluer.', page: B }] },
    });
  });

  it('refuses a kept link off the path, one kept twice, three from one page, and an empty or long path', () => {
    expect(planTrip(report({ kept: [{ url: `${B}/x`, why: 'x', from: 'https://elsewhere.org/' }] }))).toMatchObject({ ok: false, status: 400 });
    expect(planTrip(report({ kept: [{ url: A, why: 'x' }, { url: A, why: 'y' }] }))).toMatchObject({ ok: false, status: 400 });
    const three = ['1', '2', '3'].map((k) => ({ url: `${B}/${k}`, why: k, from: B }));
    expect(planTrip(report({ kept: three }))).toMatchObject({ ok: false, status: 400 });
    expect(planTrip(report({ path: [] }))).toMatchObject({ ok: false, status: 400 });
    expect(planTrip(report({ path: Array.from({ length: 9 }, (_, i) => `${A}/${i}`) }))).toMatchObject({ ok: false, status: 400 });
    expect(planTrip(report({ path: ['javascript:alert(1)'] }))).toMatchObject({ ok: false, status: 400 });
  });

  it('turns intake’s outcomes into stops in path order, refusing what failed, what Muse keeps already and what has no topic', () => {
    const planned = planTrip(report({ kept: [{ url: A, why: 'a' }, { url: `${B}/x`, why: 'x', from: B }, { url: `${B}/y`, why: 'y', from: B }] }));
    if (!planned.ok) throw new Error(planned.error);
    const c = (url: string, topics: string[]) => ({ url, canonicalUrl: url as CanonicalUrl, title: url, summary: '', topics: topics as TopicKey[], media: { kind: 'article', network: 'web' } as const });
    const s = { ...emptyState({ id: 'm' as never, name: 'M', worldSeed: 1, timezone: TZ }), collected: new Set([`${B}/x` as CanonicalUrl]) };
    const { stops, refused } = stopsOf(planned.trip, [{ ok: true, url: A, candidate: c(A, []) }, { ok: true, url: `${B}/x`, candidate: c(`${B}/x`, ['Jazz']) }, { ok: true, url: `${B}/y`, candidate: c(`${B}/y`, ['Jazz']) }], s);
    expect(stops).toEqual([{ url: B, kept: [{ candidate: c(`${B}/y`, ['Jazz']), why: 'y' }] }]);
    expect(refused.map((r) => r.url)).toEqual([A, `${B}/x`]);
  });
});

describe('a real Muse’s soul and basket', () => {
  it('writes a SOUL.md the soul parser reads back, its traits clamped', () => {
    const t = clampTemperament({ curiosity: 2, focus: 0.4, sociability: 0.6, whimsy: -3, novelty: 0.5 });
    expect(t).toEqual({ curiosity: 1, focus: 0.4, sociability: 0.6, whimsy: 0, novelty: 0.5 });
    expect(clampTemperament({ curiosity: 1 })).toBeNull();
    const parsed = parseSoul(agentSoulText('Pooh', t!, ['Jazz', 'Lucid dream']));
    expect(parsed).toMatchObject({ name: 'Pooh', temperament: t });
    expect(parsed.body).toContain('Pooh keeps jazz and lucid dream.');
  });

  it('sends the composed basket at the owner’s time, once a day, with only the finds it still keeps', () => {
    const seed = { id: 'm' as never, name: 'M', worldSeed: 1, timezone: TZ };
    const one = find('one', ['Jazz']);
    const s = { ...emptyState(seed), basketTime: '18:00', discoveries: new Map([[one.id, one]]) };
    const composed = { kind: 'basket.composed', finds: [one.id, 'gone' as DiscoveryId], note: '', at: T0 } as const;
    const log: StoredEvent[] = [{ museId: seed.id, seq: 1, event: composed }];
    expect(waitingBasket(log)).toBe(composed);
    expect(composedBasket(s, composed, T0)).toBeNull();
    const six = Date.parse('2026-11-02T18:00:00-08:00') as Instant;
    expect(composedBasket(s, composed, six)).toMatchObject({ at: six, items: [one.id] });
    const sent = { ...s, baskets: [{ id: 'b' as never, at: six, items: [one.id] }] };
    expect(composedBasket(sent, composed, (six + 60_000) as Instant)).toBeNull();
    expect(waitingBasket([...log, { museId: seed.id, seq: 2, event: { kind: 'basket.delivered', basket: sent.baskets[0], at: six } }])).toBeNull();
    expect(nextMidnight(T0, TZ)).toBe(Date.parse('2026-11-03T00:00:00-08:00'));
  });
});

describe('a back of any kind', () => {
  const seed = { id: 'm' as MuseId, name: 'M', worldSeed: 1, timezone: TZ };
  const photo: PhotoSpec = { id: 'p:m:1' as PhotoId, at: T0, subject: 'sky', context: 'planet', planetOf: seed.id, dir: [0, 1, 0], forward: [1, 0, 0], zoom: 0.5, companions: [] };
  const draw = () => 0.3;

  it('presses the find Muse names, else its newest, else none; and plays a solo photo’s game with its closest friend', () => {
    const [old, recent] = [find('old', ['Jazz'], { at: T0 }), find('recent', ['Jazz'], { at: (T0 + 1) as Instant })];
    const s = { ...emptyState(seed), discoveries: new Map([[old.id, old], [recent.id, recent]]) };
    expect(anyPlan('pressed', s, photo, draw, old.id)).toEqual({ kind: 'pressed', find: old.id });
    expect(anyPlan('pressed', s, photo, draw, 'nope' as DiscoveryId)).toEqual({ kind: 'pressed', find: recent.id });
    expect(anyPlan('pressed', emptyState(seed), photo, draw)).toEqual({ kind: 'pressed', find: '' });
    const friend = (other: string, rapport: number) => [other as MuseId, { other: other as MuseId, status: 'friends', rapport }] as const;
    const social = { ...s.social, relationships: new Map([friend('ada', 1), friend('bo', 3)]) as never };
    const game = anyPlan('game', { ...s, social }, photo, draw);
    expect(game.kind === 'game' && [game.friend, /^[xo.]{9}$/.test(game.board)]).toEqual(['bo', true]);
    expect(anyPlan('map', s, photo, draw)).toEqual({ kind: 'map', dir: [0, 1, 0] });
    expect(anyPlan('line', s, photo, draw)).toEqual({ kind: 'line' });
  });
});
