import type {
  Instant,
  Invitation,
  InvitationId,
  InvitationState,
  MuseEventBody,
  MuseId,
  MuseState,
  SocialPolicy,
  Window,
} from '../../../src/muse/contract';
import { localClock } from './clock';
import { SOCIAL } from './constants';

type Action = Parameters<SocialPolicy['invitationStep']>[1];
type StepResult = ReturnType<SocialPolicy['invitationStep']>;
type Timer = ReturnType<SocialPolicy['invitationTimers']>[number];

const hostDeadline = (inv: Invitation) => (inv.window.start - SOCIAL.hostAnswerBeforeStartMs) as Instant;
const windowStart = (inv: Invitation) => inv.window.start;
const windowEnd = (inv: Invitation) => inv.window.end;

/** One transition: legal only when `due ≤ now < before`. */
interface Edge {
  readonly to: InvitationState;
  readonly due?: (inv: Invitation) => Instant;
  readonly before?: (inv: Invitation) => Instant;
}

/**
 * proposed ─approve─► sent ─accept─► accepted ─window-start─► open ─window-end─► closed
 * Either owner can decline their step. No host answer by start − 1 h, or no guest answer by start, expires it.
 * `visited` records the guest owner's visit and leaves it open. closed, declined and expired are final.
 */
const CHART: Readonly<Record<InvitationState, Partial<Record<Action, Edge>>>> = {
  proposed: {
    approve: { to: 'sent', before: hostDeadline },
    'decline-send': { to: 'declined' },
    deadline: { to: 'expired', due: hostDeadline },
  },
  sent: {
    accept: { to: 'accepted', before: windowStart },
    decline: { to: 'declined' },
    deadline: { to: 'expired', due: windowStart },
  },
  accepted: { 'window-start': { to: 'open', due: windowStart } },
  open: {
    'window-end': { to: 'closed', due: windowEnd },
    visited: { to: 'open', due: windowStart, before: windowEnd },
  },
  closed: {},
  declined: {},
  expired: {},
};

function transition(inv: Invitation, to: InvitationState, visited?: true): MuseEventBody {
  const event = { kind: 'invitation', id: inv.id, host: inv.host, guest: inv.guest, to, window: inv.window } as const;
  return visited ? { ...event, visited } : event;
}

export function invitationStep(inv: Invitation, action: Action, now: Instant): StepResult {
  const edge = CHART[inv.state][action];
  if (!edge) return { ok: false, error: `cannot ${action} an invitation that is ${inv.state}` };
  if (edge.due && now < edge.due(inv)) return { ok: false, error: `${action} is not due until ${edge.due(inv)}` };
  if (edge.before && now >= edge.before(inv)) return { ok: false, error: `too late to ${action}` };
  if (action === 'visited' && inv.visited) return { ok: true, host: [], guest: [] };
  const event = transition(inv, edge.to, action === 'visited' ? true : undefined);
  return { ok: true, host: [event], guest: [event] };
}

const RANK: Readonly<Record<InvitationState, number>> = {
  proposed: 0,
  sent: 1,
  accepted: 2,
  open: 3,
  closed: Infinity,
  declined: Infinity,
  expired: Infinity,
};

/**
 * Every timer still ahead of the invitation's state. A timer that no longer applies when it fires is rejected by
 * invitationStep, so the engine may schedule these once at proposal or again after each transition.
 */
export function invitationTimers(inv: Invitation): readonly Timer[] {
  const timers: readonly (Timer & { readonly upTo: number })[] = [
    { at: hostDeadline(inv), action: 'deadline', upTo: RANK.proposed },
    { at: windowStart(inv), action: 'deadline', upTo: RANK.sent },
    { at: windowStart(inv), action: 'window-start', upTo: RANK.accepted },
    { at: windowEnd(inv), action: 'window-end', upTo: RANK.open },
  ];
  return timers.filter((t) => RANK[inv.state] <= t.upTo).map(({ at, action }) => ({ at, action }));
}

export function canVisit(inv: Invitation | undefined, requester: MuseId, now: Instant): boolean {
  return inv !== undefined && inv.state === 'open' && requester === inv.guest && inv.window.start <= now && now < inv.window.end;
}

/** The earliest 2 h slot within the next 3 days that sits inside 09:00–21:00 for both owners. */
export function visitWindow(hostZone: string, guestZone: string, now: Instant): Window | null {
  const step = SOCIAL.windowStepMs;
  const first = Math.ceil((now + SOCIAL.windowLeadMs) / step) * step;
  const last = now + SOCIAL.windowSearchMs - SOCIAL.windowMs;
  for (let start = first; start <= last; start += step) {
    const window = { start: start as Instant, end: (start + SOCIAL.windowMs) as Instant };
    if (isDaytime(window, hostZone) && isDaytime(window, guestZone)) return window;
  }
  return null;
}

function isDaytime(w: Window, zone: string): boolean {
  const from = localClock(w.start, zone).minute;
  const to = localClock(w.end, zone).minute;
  return from >= SOCIAL.windowDayStart && to <= SOCIAL.windowDayEnd && to > from;
}

/** The host Muse proposes inviting the guest's owner over; null when the owners share no daytime slot soon. */
export function propose(host: MuseState, guest: MuseState, now: Instant): MuseEventBody | null {
  const window = visitWindow(host.seed.timezone, guest.seed.timezone, now);
  if (!window) return null;
  const id = `inv:${host.seed.id}:${guest.seed.id}:${now}` as InvitationId;
  return { kind: 'invitation', id, host: host.seed.id, guest: guest.seed.id, to: 'proposed', window };
}

/** Withdraws every live invitation between `s` and `other`: the same events go to both logs. */
export function withdrawAll(s: MuseState, other: MuseId): readonly MuseEventBody[] {
  const events: MuseEventBody[] = [];
  for (const inv of s.social.invitations.values()) {
    const between = (inv.host === s.seed.id && inv.guest === other) || (inv.host === other && inv.guest === s.seed.id);
    if (!between || RANK[inv.state] === Infinity) continue;
    events.push(transition(inv, inv.state === 'open' ? 'closed' : 'declined'));
  }
  return events;
}
