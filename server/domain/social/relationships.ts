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
import { withdrawAll } from './invitations';
import { overlap, publicProfile, similarity, stretch } from './profile';

export function relationshipWith(s: MuseState, other: MuseId): Relationship | undefined {
  return s.social.relationships.get(other);
}

export function areFriends(a: MuseState, b: MuseState): boolean {
  return relationshipWith(a, b.seed.id)?.status === 'friends' && relationshipWith(b, a.seed.id)?.status === 'friends';
}

/** How the two get on right now, judged only from what each shares publicly. */
export function chemistry(a: MuseState, b: MuseState): { readonly similarity: number; readonly pleasantness: number } {
  const pa = publicProfile(a);
  const pb = publicProfile(b);
  if (pa.interests.length === 0 || pb.interests.length === 0) {
    // Nothing public to compare yet (day one, before any interest is public): the pair's sociability stands in,
    // so an owner introduction isn't judged "drifted apart" before either Muse has anything to share.
    return { similarity: 0, pleasantness: (a.temperament.sociability + b.temperament.sociability) / 2 };
  }
  const sim = similarity(pa, pb);
  return { similarity: sim, pleasantness: SOCIAL.pleasantSimilarity * sim + SOCIAL.pleasantStretch * stretch(overlap(pa, pb)) };
}

export function familiarityNeeded(t: Temperament): number {
  return SOCIAL.familiarityBase + SOCIAL.familiaritySpan * (1 - t.sociability);
}

export function befriendChance(sim: number, t: Temperament): number {
  return sim * (SOCIAL.befriendBase + (1 - SOCIAL.befriendBase) * t.sociability);
}

export function isUnpleasant(pleasantness: number): boolean {
  return pleasantness < SOCIAL.unpleasantBelow;
}

/** k: this many unpleasant hangouts in a row end a friendship, so close friends ride out longer bad patches. */
export function toleratedStreak(rapport: number): number {
  return SOCIAL.streakBase + Math.floor(rapport / SOCIAL.streakRapportStep);
}

function changed(other: MuseId, to: 'friends' | 'ended', origin: RelationshipOrigin, reason?: 'drifted-apart' | 'owner-unshared'): MuseEventBody {
  const event = { kind: 'relationship.changed', other, to, origin } as const;
  return reason ? { ...event, reason } : event;
}

/** The friendship between a and b ends; any invitation still live between them is withdrawn. */
export function ending(a: MuseState, b: MuseState, reason: 'drifted-apart' | 'owner-unshared'): PairOutcome {
  const origin = relationshipWith(a, b.seed.id)?.origin ?? 'met-beyond';
  const withdrawn = withdrawAll(a, b.seed.id);
  return {
    self: [changed(b.seed.id, 'ended', origin, reason), ...withdrawn],
    other: [changed(a.seed.id, 'ended', origin, reason), ...withdrawn],
  };
}

export function befriended(a: MuseState, b: MuseState, origin: RelationshipOrigin): PairOutcome {
  return { self: [changed(b.seed.id, 'friends', origin)], other: [changed(a.seed.id, 'friends', origin)] };
}

/**
 * a's owner introduced b (with b's owner's share code) or unshared it. Unsharing ends any live relationship,
 * whatever its origin, because it is the owner's privacy control.
 */
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
