import type { Instant, Invitation, InvitationId, InvitationState, MuseEventBody, MuseId, MuseState, SocialPolicy } from '../../../src/muse/contract';
import { SOCIAL } from './constants';

type Action = Parameters<SocialPolicy['invitationStep']>[1];
type StepResult = ReturnType<SocialPolicy['invitationStep']>;

const ACTOR: Readonly<Record<Action, 'host' | 'guest'>> = { use: 'guest', withdraw: 'host', return: 'guest' };

const CHART: Readonly<Record<InvitationState, Partial<Record<Action, InvitationState>>>> = {
  sent: { use: 'used', withdraw: 'withdrawn' },
  used: { return: 'returned' },
  returned: {},
  withdrawn: {},
};

/** The trip ends when the guest returns, or 2 h after they used the ticket; its view is readable until then. */
export function visitUntil(inv: Invitation | undefined, requester: MuseId): Instant | null {
  if (!inv || (inv.state !== 'used' && inv.state !== 'returned') || inv.usedAt === null || requester !== inv.guest) return null;
  return inv.returnedAt ?? ((inv.usedAt + SOCIAL.visitViewMs) as Instant);
}

export function invitationStep(inv: Invitation, action: Action, as: MuseId, now: Instant): StepResult {
  const actor = ACTOR[action];
  if (inv[actor] !== as) return { ok: false, status: 403, error: `only the ${actor}'s owner can ${action} this invitation` };
  const to = CHART[inv.state][action];
  if (to) return { ok: true, event: { kind: 'invitation', id: inv.id, host: inv.host, guest: inv.guest, to } };
  const until = visitUntil(inv, as);
  const sameVisit = action === 'use' && inv.state === 'used' && until !== null && now < until;
  const again = (action === 'withdraw' && inv.state === 'withdrawn') || (action === 'return' && inv.state === 'returned');
  if (sameVisit || again) return { ok: true, event: null };
  return { ok: false, status: 409, error: `this invitation is ${inv.state}` };
}

export function invite(host: MuseState, guest: MuseState, now: Instant): MuseEventBody {
  const id = `inv:${host.seed.id}:${guest.seed.id}:${now}` as InvitationId;
  return { kind: 'invitation', id, host: host.seed.id, guest: guest.seed.id, to: 'sent' };
}
