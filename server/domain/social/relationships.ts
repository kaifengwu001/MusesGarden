import type {
  Instant,
  MuseEventBody,
  MuseId,
  MuseState,
  PairOutcome,
  Relationship,
  RelationshipOrigin,
  Temperament,
} from '../../../src/muse/contract';
import { SOCIAL } from './constants';
import { overlap, publicProfile, similarity, stretch } from './profile';

export function relationshipWith(s: MuseState, other: MuseId): Relationship | undefined {
  return s.social.relationships.get(other);
}

export function areFriends(a: MuseState, b: MuseState): boolean {
  return relationshipWith(a, b.seed.id)?.status === 'friends' && relationshipWith(b, a.seed.id)?.status === 'friends';
}

export function chemistry(a: MuseState, b: MuseState): { readonly similarity: number; readonly pleasantness: number } {
  const pa = publicProfile(a);
  const pb = publicProfile(b);
  const warmth = (a.temperament.sociability + b.temperament.sociability) / 2;
  const sim = similarity(pa, pb);
  const shared = SOCIAL.pleasantSimilarity * sim + SOCIAL.pleasantStretch * stretch(overlap(pa, pb));
  return { similarity: sim, pleasantness: SOCIAL.pleasantWarmth * warmth + (1 - SOCIAL.pleasantWarmth) * shared };
}

export function familiarityNeeded(t: Temperament): number {
  return SOCIAL.familiarityBase + SOCIAL.familiaritySpan * (1 - t.sociability);
}

export function befriendChance(sim: number, t: Temperament): number {
  return sim * (SOCIAL.befriendBase + (1 - SOCIAL.befriendBase) * t.sociability);
}

/**
 * Unpleasant means worse than this pair usually is, not merely different: friends with unrelated interests stay
 * friends. Unpleasant hangouts make a pair distant; only a long unbroken run of them ends it.
 */
export function isUnpleasant(pleasantness: number, r: Pick<Relationship, 'rapport' | 'hangouts'> | undefined): boolean {
  if (!r || r.hangouts < SOCIAL.unpleasantAfterHangouts) return false;
  return pleasantness < SOCIAL.unpleasantVsAverage * (r.rapport / r.hangouts);
}

export function distanceAfter(distance: number, unpleasant: boolean): number {
  return unpleasant ? distance + SOCIAL.distantStep * (SOCIAL.distanceMax - distance) : distance * SOCIAL.closerKeep;
}

function changed(other: MuseId, to: 'friends' | 'ended', origin: RelationshipOrigin, reason?: 'drifted-apart' | 'owner-unshared'): MuseEventBody {
  const event = { kind: 'relationship.changed', other, to, origin } as const;
  return reason ? { ...event, reason } : event;
}

export function ending(a: MuseState, b: MuseState, reason: 'drifted-apart' | 'owner-unshared'): PairOutcome {
  const origin = relationshipWith(a, b.seed.id)?.origin ?? 'met-beyond';
  return { self: [changed(b.seed.id, 'ended', origin, reason)], other: [changed(a.seed.id, 'ended', origin, reason)] };
}

export function befriended(a: MuseState, b: MuseState, origin: RelationshipOrigin): PairOutcome {
  return { self: [changed(b.seed.id, 'friends', origin)], other: [changed(a.seed.id, 'friends', origin)] };
}

// Unsharing ends a friendship of any origin: it is the owner's privacy control.
export function ownerLink(a: MuseState, b: MuseState, op: 'introduce' | 'unshare', _now: Instant): PairOutcome {
  const status = relationshipWith(a, b.seed.id)?.status;
  const record: MuseEventBody = { kind: op === 'introduce' ? 'owner.introduced' : 'owner.unshared', other: b.seed.id };
  if (op === 'introduce') {
    if (status === 'friends') return { self: [], other: [] };
    const made = befriended(a, b, 'introduced');
    return { self: [record, ...made.self], other: made.other };
  }
  if (status === undefined || status === 'ended') return { self: [], other: [] };
  const ended = ending(a, b, 'owner-unshared');
  return { self: [record, ...ended.self], other: ended.other };
}
