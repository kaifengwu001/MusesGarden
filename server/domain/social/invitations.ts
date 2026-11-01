import type { Instant, Invitation, InvitationId, InvitationState, MuseEventBody, MuseId, MuseState, SocialPolicy } from '../../../src/muse/contract';
import { SOCIAL } from './constants';

type Action = Parameters<SocialPolicy['invitationStep']>[1];
type StepResult = ReturnType<SocialPolicy['invitationStep']>;

const ACTOR: Readonly<Record<Action, 'host' | 'guest'>> = { use: 'guest', withdraw: 'host' };

const CHART: Readonly<Record<InvitationState, Partial<Record<Action, InvitationState>>>> = {
  sent: { use: 'used', withdraw: 'withdrawn' },
  used: {},
  withdrawn: {},
};

export function visitUntil(inv: Invitation | undefined, requester: MuseId): Instant | null {
  if (!inv || inv.state !== 'used' || inv.usedAt === null || requester !== inv.guest) return null;
  return (inv.usedAt + SOCIAL.visitViewMs) as Instant;
}

export function invitationStep(inv: Invitation, action: Action, as: MuseId, now: Instant): StepResult {
  const actor = ACTOR[action];
  if (inv[actor] !== as) return { ok: false, status: 403, error: `only the ${actor}'s owner can ${action} this invitation` };
  const to = CHART[inv.state][action];
  if (to) return { ok: true, event: { kind: 'invitation', id: inv.id, host: inv.host, guest: inv.guest, to } };
  const until = visitUntil(inv, as);
  const sameVisit = action === 'use' && until !== null && now < until;
  if (sameVisit || (action === 'withdraw' && inv.state === 'withdrawn')) return { ok: true, event: null };
  return { ok: false, status: 409, error: `this invitation is ${inv.state}` };
}

export function invite(host: MuseState, guest: MuseState, now: Instant): MuseEventBody {
  const id = `inv:${host.seed.id}:${guest.seed.id}:${now}` as InvitationId;
  return { kind: 'invitation', id, host: host.seed.id, guest: guest.seed.id, to: 'sent' };
}
