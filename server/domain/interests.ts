// Interests: fast salience that events boost and time decays, slow affinity that only validated reflection
// moves, and the stage gates that sources must back.
import type { CanonicalUrl, Instant, Interest, InterestDelta, InterestStage, MuseState, TopicKey } from '../../src/muse/contract';
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  EMERGING_SOURCES,
  ESTABLISHED_DAYS,
  ESTABLISHED_SOURCES,
  FADING_IDLE_MS,
  MAX_AFFINITY_DELTA,
  SALIENCE_MAX,
  SALIENCE_TAU_MS,
  W_LIKE_BASE,
  W_LIKE_FLOOR,
  W_OWNER_BASE,
  W_OWNER_DECAY,
} from './policy/constants';
import { localDay } from './time';

export function salienceAt(i: Interest, now: number): number {
  return i.salience.value * Math.exp(-Math.max(0, now - i.salience.at) / SALIENCE_TAU_MS);
}

/** MEMORY.md's and SOUL.md's pull on Muse, fading toward 0 with every reflection Muse commits (the garden soul version). */
export function wOwner(s: MuseState): number {
  return W_OWNER_BASE / (1 + W_OWNER_DECAY * s.reflections.length);
}

/** A like's pull on Muse: praise from the garden fades as Muse matures, at the same rate, but never below W_LIKE_FLOOR of it. */
export function wLike(s: MuseState): number {
  return W_LIKE_BASE * (W_LIKE_FLOOR + (1 - W_LIKE_FLOOR) / (1 + W_OWNER_DECAY * s.reflections.length));
}

export function newInterest(topic: TopicKey, at: Instant, seededBy: Interest['seededBy']): Interest {
  return {
    topic,
    region: null,
    salience: { value: 0, at },
    affinity: 0,
    stage: 'hypothesis',
    sources: [],
    lastPursued: null,
    seededBy,
    ownerMentionAt: null,
    likedAt: null,
    since: at,
  };
}

export function boost(i: Interest, amount: number, at: Instant): Interest {
  return { ...i, salience: { value: Math.min(SALIENCE_MAX, salienceAt(i, at) + amount), at } };
}

export function withSource(i: Interest, url: CanonicalUrl): Interest {
  return i.sources.includes(url) ? i : { ...i, sources: [...i.sources, url] };
}

/** Owner-local days on which Muse came by this interest's sources. */
function sourceDays(s: MuseState, i: Interest): number {
  const days = new Set<string>();
  for (const d of s.discoveries.values()) {
    if (i.sources.includes(d.canonicalUrl)) days.add(localDay(d.at, s.seed.timezone));
  }
  return days.size;
}

/** Whether the current fold's evidence supports moving `i` to `stage` at `now`. */
export function stageAllowed(s: MuseState, i: Interest, stage: InterestStage, now: number): boolean {
  switch (stage) {
    case 'hypothesis':
      return true;
    case 'emerging':
      return i.sources.length >= EMERGING_SOURCES;
    case 'established':
      return i.sources.length >= ESTABLISHED_SOURCES && sourceDays(s, i) >= ESTABLISHED_DAYS;
    case 'fading':
      return now - (i.lastPursued ?? i.salience.at) >= FADING_IDLE_MS;
  }
}

/**
 * The evidence gate, shared by the validator and the reducer: a delta survives only for a topic with at
 * least one source in the fold, with Δaffinity clamped and any stage move the sources don't back removed.
 */
export function gateDelta(s: MuseState, d: InterestDelta, now: number): InterestDelta | null {
  const i = s.interests.get(d.topic);
  if (!i || i.sources.length === 0) return null;
  const dAffinity = Math.max(-MAX_AFFINITY_DELTA, Math.min(MAX_AFFINITY_DELTA, d.dAffinity));
  const moves = d.stage !== undefined && d.stage !== i.stage && stageAllowed(s, i, d.stage, now);
  if (dAffinity === 0 && !moves) return null;
  const { stage: _stage, ...rest } = d;
  return { ...rest, dAffinity, ...(moves ? { stage: d.stage } : {}) };
}

/** Gates and applies deltas in order, each against the interests the ones before it left. */
export function gateAll(
  s: MuseState,
  deltas: readonly InterestDelta[],
  now: number,
): { readonly interests: ReadonlyMap<TopicKey, Interest>; readonly applied: readonly InterestDelta[] } {
  const interests = new Map(s.interests);
  const applied: InterestDelta[] = [];
  for (const d of deltas) {
    const gated = gateDelta({ ...s, interests }, d, now);
    const i = interests.get(d.topic);
    if (!gated || !i) continue;
    interests.set(d.topic, {
      ...i,
      affinity: Math.max(AFFINITY_MIN, Math.min(AFFINITY_MAX, i.affinity + gated.dAffinity)),
      stage: gated.stage ?? i.stage,
    });
    applied.push(gated);
  }
  return { interests, applied };
}
