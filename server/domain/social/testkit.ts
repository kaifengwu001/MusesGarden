import { hash32, mix, salt, unit } from '../../../src/core/hash';
import type {
  CanonicalUrl,
  Discovery,
  DiscoveryId,
  Draw,
  HiddenRef,
  Instant,
  Interest,
  MuseEventBody,
  MuseId,
  MuseState,
  PhotoId,
  RegionKey,
  TopicKey,
} from '../../../src/muse/contract';
import { reduceSocial, emptySocial } from './state';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const T0 = Date.parse('2026-11-02T08:00:00Z') as Instant;
export const at = (ms: number) => ms as Instant;

export const wiki = (title: string) => `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}` as CanonicalUrl;
const HOME = '0:1:1' as RegionKey;

export function interest(topic: string, over: Partial<Interest> = {}): Interest {
  return {
    topic: topic as TopicKey,
    region: HOME,
    salience: { value: 0.5, at: T0 },
    affinity: 0.5,
    stage: 'emerging',
    sources: [wiki(topic)],
    lastPursued: T0,
    seededBy: 'muse',
    ownerMentionAt: null,
    ...over,
  };
}

export function find(id: string, topics: readonly string[], over: Partial<Discovery> = {}): Discovery {
  return {
    id: id as DiscoveryId,
    url: wiki(id),
    canonicalUrl: wiki(id),
    title: id,
    summary: `About ${id}.`,
    topics: topics as TopicKey[],
    because: [],
    reason: 'It glowed.',
    keepScore: 0.8,
    provenance: 'own',
    place: { dir: [0, 1, 0], region: HOME },
    at: T0,
    ...over,
  };
}

export interface MuseSpec {
  readonly sociability?: number;
  readonly timezone?: string;
  readonly interests?: readonly Interest[];
  readonly discoveries?: readonly Discovery[];
  readonly hidden?: readonly HiddenRef[];
  readonly collected?: readonly string[];
  readonly socialMsToday?: number;
}

export function muse(id: string, spec: MuseSpec = {}): MuseState {
  return {
    seed: { id: id as MuseId, name: id[0].toUpperCase() + id.slice(1), worldSeed: salt(id), timezone: spec.timezone ?? 'America/Los_Angeles' },
    temperament: { curiosity: 0.5, focus: 0.5, sociability: spec.sociability ?? 0.5, whimsy: 0.5, novelty: 0.5 },
    seq: 0,
    at: T0,
    soulVersion: 0,
    basketTime: null,
    hidden: new Set(spec.hidden ?? []),
    working: false,
    episode: null,
    episodes: 0,
    interests: new Map((spec.interests ?? []).map((i) => [i.topic, i])),
    frontier: [],
    regions: new Map([[HOME, []]]),
    home: HOME,
    lastUnlockAt: T0,
    questions: new Map(),
    discoveries: new Map((spec.discoveries ?? []).map((d) => [d.id, d])),
    collected: new Set((spec.collected ?? []).map((u) => wiki(u))),
    pendingBasket: [],
    baskets: [],
    photos: [],
    reflections: [],
    experiencesSinceReflection: 0,
    day: { day: '2026-11-02', restMs: 0, socialMs: spec.socialMsToday ?? 0, workMs: 0, photos: 0, trips: 0, baskets: 0 },
    social: emptySocial(),
  };
}

export const topics = (...names: string[]) => names.map((n) => interest(n));

export function draws(seed: number): Draw {
  return (kind, k = 0) => unit(hash32(mix(mix(salt(kind), k), seed)));
}

export const constant = (u: number): Draw => () => u;

export function pastHangout(other: MuseState, role: 'host' | 'guest', pleasantness: number): MuseEventBody {
  const gift = find(`${other.seed.id}-gift`, []);
  const received = { id: gift.id, url: gift.url, canonicalUrl: gift.canonicalUrl, title: gift.title, summary: gift.summary, topics: gift.topics };
  return { kind: 'hangout', other: other.seed.id, role, pleasantness, gave: 'given' as DiscoveryId, received, photo: 'photo' as PhotoId };
}

export function fold(s: MuseState, events: readonly MuseEventBody[], now: Instant): MuseState {
  let next = s;
  for (const event of events) {
    const seq = next.seq + 1;
    next = { ...next, seq, at: now, social: reduceSocial(next.social, { museId: s.seed.id, seq, event: { ...event, at: now } }, s.seed.id) };
  }
  return next;
}

export function apply(a: MuseState, b: MuseState, out: { readonly self: readonly MuseEventBody[]; readonly other: readonly MuseEventBody[] }, now: Instant): [MuseState, MuseState] {
  return [fold(a, out.self, now), fold(b, out.other, now)];
}

export function ofKind<K extends MuseEventBody['kind']>(events: readonly MuseEventBody[], kind: K): Extract<MuseEventBody, { kind: K }>[] {
  return events.filter((e): e is Extract<MuseEventBody, { kind: K }> => e.kind === kind);
}
