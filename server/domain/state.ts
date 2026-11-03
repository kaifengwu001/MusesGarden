// The fold: MuseState from a Muse's own log, one event at a time. Social state is lane A2's (social/state.ts).
import type {
  DayCounters,
  Discovery,
  DiscoveryId,
  EpisodeState,
  Instant,
  Interest,
  InterestDelta,
  LikeTarget,
  MuseEventBody,
  MuseSeed,
  MuseState,
  PhotoId,
  ReduceCore,
  RegionKey,
  StoredEvent,
  Temperament,
  TopicKey,
} from '../../src/muse/contract';
import { homeRegion, nearHome } from './atlas';
import { eventRef, giftId, instant } from './ids';
import { boost, gateAll, newInterest, wLike, wOwner, withSource } from './interests';
import {
  BOOST_GIFT,
  BOOST_KEPT,
  BOOST_LIKED,
  BOOST_LOOKED,
  BOOST_OWNER,
  FRONTIER_MAX,
  FRONTIER_MIN_SCORE,
  KEEP_THRESHOLD,
  RECENT_WORK_WINDOW_MS,
  CATEGORY_THEME_MIN_FINDS,
} from './policy/constants';
import { drawFor } from './rng';
import { localDay } from './time';

export const NEUTRAL_TEMPERAMENT: Temperament = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 };

const freshDay = (day: string): DayCounters => ({ day, restMs: 0, socialMs: 0, workMs: 0, photos: 0, trips: 0, baskets: 0 });

/** Before anything happens: only the house and garden are explored. SOUL.md's soul.updated sets the temperament. */
export function emptyState(seed: MuseSeed, temperament: Temperament = NEUTRAL_TEMPERAMENT): MuseState {
  const home = homeRegion(seed.worldSeed);
  return {
    seed,
    temperament,
    seq: 0,
    at: instant(0),
    soulVersion: 0,
    basketTime: null,
    hidden: new Set(),
    reach: 'shared',
    working: false,
    episode: null,
    episodes: 0,
    interests: new Map(),
    frontier: [],
    regions: new Map([[home, []]]),
    home,
    lastUnlockAt: instant(0),
    questions: new Map(),
    discoveries: new Map(),
    collected: new Set(),
    pendingBasket: [],
    baskets: [],
    photos: [],
    reflections: [],
    experiencesSinceReflection: 0,
    likes: new Map(),
    favoritePhotos: new Set(),
    day: freshDay(''),
    social: { relationships: new Map(), invitations: new Map(), likedPhotos: new Set(), knownOn: new Map() },
    workSince: null,
    recentWork: [],
    lastReflectionAt: instant(0),
  };
}

export const reduceCore: ReduceCore = (prev, stored) => {
  const s0 = prev;
  const at = stored.event.at;
  const day = localDay(at, s0.seed.timezone);
  const s: MuseState = {
    ...s0,
    seq: stored.seq,
    at,
    day: s0.day.day === day ? s0.day : freshDay(day),
    // Muse's life starts with its first event: home counts as unlocked then, and the reflection clock starts.
    ...(s0.seq === 0 ? { lastUnlockAt: at, lastReflectionAt: at } : {}),
  };
  return fold(s, stored);
};

function fold(s: MuseState, stored: StoredEvent): MuseState {
  const e = stored.event;
  const at = e.at;
  switch (e.kind) {
    case 'host.work':
      return work(s, e.state, at);
    case 'soul.updated':
      return { ...s, temperament: e.temperament, soulVersion: e.version, interests: ownerMention(s, e.topics, 'soul', at) };
    case 'memory.updated':
      return { ...s, interests: ownerMention(s, e.topics, 'owner-memory', at) };
    case 'owner.settings': {
      const hidden = new Set(s.hidden);
      for (const r of e.hide ?? []) hidden.add(r);
      for (const r of e.unhide ?? []) hidden.delete(r);
      return { ...s, hidden, basketTime: e.basketTime === undefined ? s.basketTime : e.basketTime, reach: e.reach ?? s.reach };
    }
    case 'episode.started':
      return startEpisode(s, e, at);
    case 'episode.paused': {
      const ep = s.episode;
      if (!ep || ep.n !== e.n || ep.pausedAt !== null) return s;
      return { ...attribute(s, ep, at), episode: { ...ep, pausedAt: at, remainingMs: e.remainingMs, activeSince: null } };
    }
    case 'episode.resumed': {
      const ep = s.episode;
      if (!ep || ep.n !== e.n || ep.pausedAt === null) return s;
      return { ...s, episode: { ...ep, pausedAt: null, remainingMs: null, activeSince: at } };
    }
    case 'episode.ended': {
      const ep = s.episode;
      if (!ep || ep.n !== e.n) return s;
      return { ...(ep.pausedAt === null ? attribute(s, ep, at) : s), episode: null };
    }
    case 'trip.hop':
      return hop(s, e, at);
    case 'region.revealed': {
      const known = s.interests.get(e.topic);
      const interest = known ? (known.region ? known : { ...known, region: e.region }) : { ...newInterest(e.topic, at, 'muse'), region: e.region };
      return settle({ ...s, interests: new Map(s.interests).set(e.topic, interest) }, e.region, [e.topic], at);
    }
    case 'discovery.collected':
      return collect(s, e.discovery, e.discovery.provenance === 'gift' ? BOOST_GIFT : BOOST_KEPT);
    case 'question.opened':
      return { ...s, questions: new Map(s.questions).set(e.question.id, e.question) };
    case 'question.closed': {
      const questions = new Map(s.questions);
      questions.delete(e.id);
      return { ...s, questions };
    }
    case 'photo.taken':
      // The owner receives a photo when its event lands, so the daily cap counts by delivery, not by when it was taken.
      return { ...s, photos: [...s.photos, e.photo], day: { ...s.day, photos: s.day.photos + 1 } };
    case 'photo.written':
      // Only the garden reads a postcard's back; nothing of Muse's does.
      return s;
    case 'basket.delivered':
      return { ...s, baskets: [...s.baskets, e.basket], pendingBasket: [], day: { ...s.day, baskets: s.day.baskets + 1 } };
    case 'reflection.committed':
      return reflect(s, stored, e.deltas, e.narrative);
    case 'reflection.no-change':
      return { ...s, experiencesSinceReflection: 0, lastReflectionAt: at };
    case 'encounter':
      return { ...s, experiencesSinceReflection: s.experiencesSinceReflection + 1 };
    case 'hangout':
      return gift(s, stored, e);
    case 'owner.liked':
      return like(s, e.target, e.liked, at);
    case 'owner.favorited': {
      const favoritePhotos = new Set(s.favoritePhotos);
      if (e.favorite) favoritePhotos.add(e.photo);
      else favoritePhotos.delete(e.photo);
      return { ...s, favoritePhotos };
    }
    case 'owner.introduced':
    case 'owner.unshared':
    case 'owners.connected':
    case 'relationship.changed':
    case 'invitation':
      return s;
  }
}

function work(s: MuseState, state: 'started' | 'ended', at: Instant): MuseState {
  if (state === 'started') return s.working ? s : { ...s, working: true, workSince: at };
  if (!s.working) return s;
  const start = s.workSince ?? at;
  const recentWork = [...s.recentWork, { start, end: at }].filter((w) => w.end >= at - RECENT_WORK_WINDOW_MS);
  return { ...s, working: false, workSince: null, recentWork, day: { ...s.day, workMs: s.day.workMs + (at - start) } };
}

/** Counts the episode's active time since it last started or resumed into today's rest or social time. */
function attribute(s: MuseState, ep: EpisodeState, until: Instant): MuseState {
  const ms = Math.max(0, until - (ep.activeSince ?? ep.start));
  switch (ep.plan.activity) {
    case 'rest':
      return { ...s, day: { ...s.day, restMs: s.day.restMs + ms } };
    case 'visit':
      return { ...s, day: { ...s.day, socialMs: s.day.socialMs + ms } };
    case 'travel':
    case 'beyond':
      return s;
  }
}

function startEpisode(s: MuseState, e: Extract<MuseEventBody, { kind: 'episode.started' }>, at: Instant): MuseState {
  const episode: EpisodeState = { n: e.n, plan: e.plan, start: at, hops: 0, lastKept: null, pausedAt: null, remainingMs: null, activeSince: at };
  const next: MuseState = { ...s, episode, episodes: Math.max(s.episodes, e.n) };
  if (e.plan.activity !== 'travel') return next;
  const trip = e.plan.trip;
  return {
    ...next,
    day: { ...s.day, trips: s.day.trips + 1 },
    interests: trip.kind === 'serendipity' ? s.interests : pursue(s.interests, trip.topic, at),
  };
}

function pursue(interests: ReadonlyMap<TopicKey, Interest>, topic: TopicKey, at: Instant): ReadonlyMap<TopicKey, Interest> {
  const i = interests.get(topic);
  return i ? new Map(interests).set(topic, { ...i, lastPursued: at }) : interests;
}

function ownerMention(s: MuseState, topics: readonly TopicKey[], seededBy: Interest['seededBy'], at: Instant): ReadonlyMap<TopicKey, Interest> {
  const amount = BOOST_OWNER * wOwner(s);
  const interests = new Map(s.interests);
  for (const t of topics) {
    const i = interests.get(t) ?? newInterest(t, at, seededBy);
    interests.set(t, { ...boost(i, amount, at), ownerMentionAt: at });
  }
  return interests;
}

export const likeKey = (target: LikeTarget): DiscoveryId | PhotoId => ('find' in target ? target.find : target.photo);

/** The find a like is about: the liked find, or the find a liked photo shows. */
export function likedFind(s: MuseState, target: LikeTarget): Discovery | undefined {
  const id = 'find' in target ? target.find : s.photos.find((p) => p.id === target.photo)?.discoveryId;
  return id === undefined ? undefined : s.discoveries.get(id);
}

/**
 * A like or an unlike from the garden. Only the first like of a thing nudges Muse, the way praise would: the
 * topics of the find it is about that are already interests gain salience and count as liked for the topic pick.
 * Unliking and liking again only flip the flag, and a like whose target isn't in the fold does nothing.
 */
function like(s: MuseState, target: LikeTarget, liked: boolean, at: Instant): MuseState {
  const id = likeKey(target);
  const known = s.likes.get(id);
  if (known) return { ...s, likes: new Map(s.likes).set(id, { ...known, liked }) };
  const exists = 'find' in target ? s.discoveries.has(target.find) : s.photos.some((p) => p.id === target.photo);
  if (!liked || !exists) return s;
  const interests = new Map(s.interests);
  const amount = BOOST_LIKED * wLike(s);
  for (const t of likedFind(s, target)?.topics ?? []) {
    const i = interests.get(t);
    if (i) interests.set(t, { ...boost(i, amount, at), likedAt: at });
  }
  return { ...s, interests, likes: new Map(s.likes).set(id, { liked: true, firstAt: at }) };
}

function hop(s: MuseState, e: Extract<MuseEventBody, { kind: 'trip.hop' }>, at: Instant): MuseState {
  const ep = s.episode;
  const episode = ep && ep.n === e.n ? { ...ep, hops: Math.max(ep.hops, e.k + 1), lastKept: e.kept[0] ?? ep.lastKept } : ep;
  const interests = new Map(pursue(s.interests, e.topic, at));
  const passed = e.looked.filter((v) => !v.kept);
  for (const t of new Set(passed.flatMap((v) => v.topics))) {
    const i = interests.get(t);
    if (i) interests.set(t, boost(i, BOOST_LOOKED, at));
  }
  const frontier = [...s.frontier];
  for (const v of passed) {
    const t = v.topics.at(0);
    if (v.score < FRONTIER_MIN_SCORE || !t || interests.get(t)?.region || frontier.some((f) => f.topic === t)) continue;
    frontier.push({ topic: t, from: e.topic });
  }
  return { ...s, episode, interests, frontier: frontier.slice(Math.max(0, frontier.length - FRONTIER_MAX)) };
}

/** `topics` now live in `region`; a region seen for the first time is an unlock and its fog lifts. */
function settle(s: MuseState, region: RegionKey, topics: readonly TopicKey[], at: Instant): MuseState {
  const known = s.regions.get(region);
  const living = [...(known ?? [])];
  for (const t of topics) if (!living.includes(t)) living.push(t);
  const placed = new Set(topics);
  return {
    ...s,
    regions: new Map(s.regions).set(region, living),
    lastUnlockAt: known ? s.lastUnlockAt : at,
    frontier: s.frontier.filter((f) => !placed.has(f.topic)),
  };
}

/** A URL becomes a find once: one source counts once. Each topic gains the source and a salience boost. */
function collect(s: MuseState, d: Discovery, amount: number): MuseState {
  if (s.collected.has(d.canonicalUrl) || s.discoveries.has(d.id)) return s;
  const own = d.provenance === 'own';
  const interests = new Map(s.interests);
  const placed: TopicKey[] = [];
  for (const [k, t] of d.topics.entries()) {
    const i = interests.get(t) ?? themeOrTopic(s, d, t, k);
    if (!i) continue;
    if (!i.region) placed.push(t);
    interests.set(t, {
      ...withSource(boost(i, amount, d.at), d.canonicalUrl),
      region: i.region ?? d.place.region,
      lastPursued: own ? d.at : i.lastPursued,
    });
  }
  const next: MuseState = {
    ...s,
    interests,
    discoveries: new Map(s.discoveries).set(d.id, d),
    collected: new Set(s.collected).add(d.canonicalUrl),
    pendingBasket: [...s.pendingBasket, d.id],
    experiencesSinceReflection: s.experiencesSinceReflection + (own ? 1 : 0),
  };
  return settle(next, d.place.region, placed, d.at);
}

/**
 * A find's own topic becomes an interest at once. One of its categories becomes an interest only once it ties
 * several finds together, a theme rather than a catalogue label, and then with all of those finds as sources.
 */
function themeOrTopic(s: MuseState, d: Discovery, t: TopicKey, k: number): Interest | null {
  if (k === 0) return newInterest(t, d.at, 'muse');
  const sharing = [...s.discoveries.values()].filter((x) => x.topics.includes(t));
  if (sharing.length + 1 < CATEGORY_THEME_MIN_FINDS) return null;
  return sharing.reduce((i, x) => withSource(i, x.canonicalUrl), newInterest(t, d.at, 'muse'));
}

/** The gift a hangout brought becomes a find of Muse's own, planted near home. */
function gift(s: MuseState, stored: StoredEvent, e: Extract<MuseEventBody, { kind: 'hangout' }>): MuseState {
  const at = stored.event.at;
  const g = e.received;
  const met = { ...s, experiencesSinceReflection: s.experiencesSinceReflection + 1 };
  if (!g) return met;
  if (s.collected.has(g.canonicalUrl)) {
    const interests = new Map(s.interests);
    for (const t of g.topics) {
      const i = interests.get(t);
      if (i) interests.set(t, boost(i, BOOST_GIFT, at));
    }
    return { ...met, interests };
  }
  const d: Discovery = {
    id: giftId(e.other, g.id),
    url: g.url,
    canonicalUrl: g.canonicalUrl,
    title: g.title,
    summary: g.summary,
    topics: g.topics,
    because: [eventRef(s.seed.id, stored.seq)],
    reason: 'A gift from a friend.',
    keepScore: KEEP_THRESHOLD,
    provenance: 'gift',
    place: nearHome(s.seed.worldSeed, drawFor(s.seed.id, stored.seq)),
    at,
    media: g.media,
    pursuing: g.pursuing,
  };
  return collect(met, d, BOOST_GIFT);
}

/**
 * The evidence gate. Each delta must still be backed by the fold: a topic with a source, a stage the source
 * counts support. A reflection left with nothing is not counted as a version, so a log stripped of its
 * experiences folds back to its seed-only state.
 */
function reflect(s: MuseState, stored: StoredEvent, deltas: readonly InterestDelta[], narrative: string): MuseState {
  const at = stored.event.at;
  const { interests, applied } = gateAll(s, deltas, at);
  const base: MuseState = { ...s, experiencesSinceReflection: 0, lastReflectionAt: at };
  if (applied.length === 0) return base;
  const record = { ref: eventRef(s.seed.id, stored.seq), version: s.reflections.length + 1, at, narrative, deltas: applied };
  return { ...base, interests, reflections: [...s.reflections, record] };
}
