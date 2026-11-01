import type { Instant, MuseId, ReduceSocial, Relationship, RelationshipOrigin, SocialState } from '../../../src/muse/contract';
import { distanceAfter, isUnpleasant } from './relationships';

export function emptySocial(): SocialState {
  return { relationships: new Map(), invitations: new Map() };
}

function fresh(other: MuseId, origin: RelationshipOrigin): Relationship {
  return {
    other,
    status: 'acquainted',
    origin,
    familiarity: 0,
    rapport: 0,
    rapportSinceInvite: 0,
    unpleasantStreak: 0,
    distance: 0,
    encounters: 0,
    hangouts: 0,
    lastRole: null,
    lastMetAt: null,
    lastInviteAt: null,
  };
}

function withRelationship(s: SocialState, other: MuseId, origin: RelationshipOrigin, update: (r: Relationship) => Relationship): SocialState {
  const relationships = new Map(s.relationships);
  relationships.set(other, update(s.relationships.get(other) ?? fresh(other, origin)));
  return { ...s, relationships };
}

const befriend = (origin: RelationshipOrigin) => (r: Relationship): Relationship => ({ ...r, status: 'friends', origin, unpleasantStreak: 0 });
const end = (r: Relationship): Relationship => (r.status === 'ended' ? r : { ...r, status: 'ended' });

export const reduceSocial: ReduceSocial = (s, stored, self) => {
  const e = stored.event;
  const at: Instant = e.at;
  switch (e.kind) {
    case 'encounter':
      return withRelationship(s, e.other, 'met-beyond', (r) => ({
        ...r,
        familiarity: r.familiarity + e.pleasantness,
        encounters: r.encounters + 1,
        lastMetAt: at,
      }));
    case 'hangout':
      return withRelationship(s, e.other, 'met-beyond', (r) => ({
        ...r,
        rapport: r.rapport + e.pleasantness,
        rapportSinceInvite: r.rapportSinceInvite + e.pleasantness,
        unpleasantStreak: isUnpleasant(e.pleasantness, r) ? r.unpleasantStreak + 1 : 0,
        distance: distanceAfter(r.distance, isUnpleasant(e.pleasantness, r)),
        hangouts: r.hangouts + 1,
        lastRole: e.role,
        lastMetAt: at,
      }));
    case 'relationship.changed':
      if (e.to === 'friends') return withRelationship(s, e.other, e.origin, befriend(e.origin));
      if (e.to === 'ended') return s.relationships.has(e.other) ? withRelationship(s, e.other, e.origin, end) : s;
      return withRelationship(s, e.other, e.origin, (r) => ({ ...r, status: 'acquainted' }));
    case 'owner.introduced':
      return withRelationship(s, e.other, 'introduced', befriend('introduced'));
    case 'owner.unshared':
      return s.relationships.has(e.other) ? withRelationship(s, e.other, 'introduced', end) : s;
    case 'invitation': {
      const previous = s.invitations.get(e.id);
      if (e.to !== 'sent' && !previous) return s;
      const invitations = new Map(s.invitations);
      invitations.set(
        e.id,
        previous
          ? { ...previous, state: e.to, usedAt: e.to === 'used' ? at : previous.usedAt }
          : { id: e.id, host: e.host, guest: e.guest, state: 'sent', sentAt: at, usedAt: null },
      );
      const next = { ...s, invitations };
      if (e.to !== 'sent') return next;
      const other = e.host === self ? e.guest : e.host;
      return withRelationship(next, other, 'met-beyond', (r) => ({ ...r, rapportSinceInvite: 0, lastInviteAt: at }));
    }
    default:
      return s;
  }
};
