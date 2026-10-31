// Minimal stand-ins for the domain lanes, so the engine's mechanics (ordering, work pauses, atomic commits,
// restarts) can be tested on their own. They are deliberately simple and are not the real behaviour.
import { hash32, mix, salt, unit } from '../../../src/core/hash';
import type {
  Candidate,
  CanonicalUrl,
  Draw,
  EventRef,
  Instant,
  LifePolicy,
  Mind,
  MuseId,
  MuseSeed,
  MuseState,
  ReduceCore,
  ReduceSocial,
  RegionKey,
  SocialPolicy,
  Source,
  Store,
  TopicKey,
} from '../../../src/muse/contract';
import { openMemoryStore } from '../../adapters/store/memory';
import type { EngineDeps } from '../engine';

const MIN = 60_000;

export const drawFor = (museId: MuseId, n: number): Draw => (kind, k = 0) =>
  unit(mix(mix(mix(salt(museId), n), salt(kind)), k));

export function emptyState(seed: MuseSeed): MuseState {
  return {
    seed,
    temperament: { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 },
    seq: 0,
    at: 0 as Instant,
    soulVersion: 0,
    basketTime: null,
    hidden: new Set(),
    working: false,
    episode: null,
    episodes: 0,
    interests: new Map(),
    frontier: [],
    regions: new Map(),
    home: '0:0:0' as RegionKey,
    lastUnlockAt: 0 as Instant,
    questions: new Map(),
    discoveries: new Map(),
    collected: new Set(),
    pendingBasket: [],
    baskets: [],
    photos: [],
    reflections: [],
    experiencesSinceReflection: 0,
    day: { day: '', restMs: 0, socialMs: 0, workMs: 0, photos: 0, trips: 0, baskets: 0 },
    social: { relationships: new Map(), invitations: new Map() },
  };
}

export const reduceCore: ReduceCore = (s, stored) => {
  const e = stored.event;
  const base = { ...s, seq: stored.seq, at: e.at };
  switch (e.kind) {
    case 'soul.updated':
      return { ...base, temperament: e.temperament, soulVersion: e.version };
    case 'host.work':
      return { ...base, working: e.state === 'started' };
    case 'episode.started':
      return {
        ...base,
        episodes: Math.max(s.episodes, e.n),
        episode: { n: e.n, plan: e.plan, start: e.at, hops: 0, lastKept: null, pausedAt: null, remainingMs: null },
      };
    case 'episode.paused':
      return s.episode ? { ...base, episode: { ...s.episode, pausedAt: e.at, remainingMs: e.remainingMs } } : base;
    case 'episode.resumed':
      return s.episode ? { ...base, episode: { ...s.episode, pausedAt: null, remainingMs: null } } : base;
    case 'episode.ended':
      return s.episode?.n === e.n ? { ...base, episode: null } : base;
    case 'trip.hop':
      return s.episode ? { ...base, episode: { ...s.episode, hops: s.episode.hops + 1, lastKept: e.kept[0] ?? s.episode.lastKept } } : base;
    case 'discovery.collected': {
      const discoveries = new Map(s.discoveries);
      discoveries.set(e.discovery.id, e.discovery);
      return { ...base, discoveries, collected: new Set([...s.collected, e.discovery.canonicalUrl]) };
    }
    case 'region.revealed': {
      const regions = new Map(s.regions);
      regions.set(e.region, [e.topic]);
      return { ...base, regions };
    }
    default:
      return base;
  }
};

export const reduceSocial: ReduceSocial = (s, stored) => {
  const e = stored.event;
  if (e.kind !== 'relationship.changed') return s;
  const relationships = new Map(s.relationships);
  relationships.set(e.other, {
    other: e.other,
    status: e.to,
    origin: e.origin,
    familiarity: 0,
    rapport: 0,
    rapportSinceInvite: 0,
    unpleasantStreak: 0,
    encounters: 0,
    hangouts: 0,
    lastRole: null,
    lastMetAt: null,
    lastInviteAt: null,
  });
  return { ...s, relationships };
};

const at = (n: number) => n as Instant;

export const life: LifePolicy = {
  next: (_s, _now, draw, friendFree) => (friendFree && draw('visit') < 0.3 ? 'visit' : draw('next') < 0.4 ? 'rest' : 'travel'),
  restUntil: (_s, now) => at(now + 30 * MIN),
  beyondUntil: (_s, now) => at(now + 60 * MIN),
  startTrip: (_s, _now, draw) =>
    draw('beyond') < 0.1 ? null : { kind: 'revisit', topic: 'Pigment' as TopicKey, region: '0:1:1' as RegionKey, question: null },
  serendipityRegion: () => '5:3:3' as RegionKey,
  hopMs: () => 20 * MIN,
  hopPlace: (_s, region) => ({ dir: [0, 1, 0], region }),
  keep: (js) => [...js].filter((j) => j.score >= 0.75).sort((a, b) => b.score - a.score).slice(0, 2),
  continueTrip: (_s, k) => k < 2,
  photosDuring: () => [],
  basket: () => null,
  nextBasketCheck: () => null,
  reflectionDue: () => false,
  experiences: () => [],
  validateReflection: (_s, log) => ({ kind: 'reflection.no-change', reviewed: log.slice(-1).map((e) => `${e.museId}#${e.seq}` as EventRef) }),
  privacyFilter: (labels) => labels,
  parseSoul: (text) => ({ name: null, temperament: {}, body: text }),
};

export const social: SocialPolicy = {
  chooseVisit: (_s, free, now) => (free[0] ? { other: free[0].state.seed.id, role: 'host', until: at(now + 50 * MIN) } : null),
  encounterRate: () => 0,
  encounter: () => ({ self: [], other: [] }),
  hangout: () => ({ host: [], guest: [] }),
  invitationStep: () => ({ ok: false, error: 'stub' }),
  invitationTimers: () => [],
  canVisit: () => false,
  publicProfile: (s) => ({ museId: s.seed.id, name: s.seed.name, worldSeed: s.seed.worldSeed, interests: [], discoveries: [] }),
  ownerLink: (a, b, op) => {
    const to = op === 'introduce' ? 'friends' : 'ended';
    return {
      self: [{ kind: 'relationship.changed', other: b.seed.id, to, origin: 'introduced' }],
      other: [{ kind: 'relationship.changed', other: a.seed.id, to, origin: 'introduced' }],
    };
  },
};

const page = (title: string): Candidate => ({
  origin: 'wikipedia',
  url: `https://en.wikipedia.org/wiki/${title}`,
  canonicalUrl: `https://en.wikipedia.org/wiki/${title}` as CanonicalUrl,
  title,
  summary: `About ${title}.`,
  topics: [title as TopicKey],
});

const pages = (titles: readonly string[], exclude: ReadonlySet<CanonicalUrl>) =>
  Promise.resolve(titles.map(page).filter((c) => !exclude.has(c.canonicalUrl)));
const range = (n: number, name: (i: number) => string) => Array.from({ length: n }, (_, i) => name(i));

export const source: Source = {
  search: (topic, limit, exclude) => pages(range(limit, (i) => `${topic}_${i}`), exclude),
  next: (from, limit, exclude) => pages(range(limit, (i) => `${from.title}_n${i}`), exclude),
  serendipity: (limit, seed, exclude) => pages(range(limit, (i) => `Wander_${seed % 97}_${i}`), exclude),
  resolveTopic: (label) => Promise.resolve(label as TopicKey),
};

export const mind: Mind = {
  judge: (_ctx, cs) =>
    Promise.resolve(cs.map((c) => ({ canonicalUrl: c.canonicalUrl, score: unit(hash32(salt(c.canonicalUrl))), reason: `I liked ${c.title}.` }))),
  proposeQuestion: (_ctx, topic) => Promise.resolve(`What else is there in ${topic}?`),
  reflect: () => Promise.resolve({ deltas: [], narrative: '', questions: [] }),
  extractInterests: () => Promise.resolve([]),
  estimateTemperament: () => Promise.resolve({ curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 }),
};

/** Lane B's memory store, plus a switch that makes the next commit fail like a crash would. */
export function memoryStore(inner: Store = openMemoryStore()): Store & { failNextCommit(): void } {
  let fail = false;
  return {
    ...inner,
    llmCache: inner.llmCache,
    failNextCommit: () => {
      fail = true;
    },
    commit(batch) {
      if (fail) {
        fail = false;
        throw new Error('injected crash');
      }
      inner.commit(batch);
    },
  };
}

export function stubDeps(store: Store): EngineDeps {
  return {
    store,
    life,
    social,
    reduceCore,
    reduceSocial,
    emptyState,
    drawFor,
    salienceAt: (i) => i.salience.value,
    source,
    mindFor: () => mind,
  };
}
