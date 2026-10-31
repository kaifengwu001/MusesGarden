import { describe, expect, it } from 'vitest';
import type { Instant, Invitation, InvitationId, InvitationState, MuseEventBody, MuseId, MuseState, SocialPolicy } from '../../../src/muse/contract';
import { socialPolicy as policy } from './policy';
import { reduceSocial, emptySocial } from './state';
import { DAY, HOUR, T0, apply, at, draws, muse, ofKind, topics } from './testkit';

type Action = Parameters<SocialPolicy['invitationStep']>[1];
const ACTIONS: readonly Action[] = ['approve', 'decline-send', 'accept', 'decline', 'deadline', 'window-start', 'window-end', 'visited'];
const QUARTER = 15 * 60_000;
const STATES: readonly InvitationState[] = ['proposed', 'sent', 'accepted', 'open', 'closed', 'declined', 'expired'];

const HOST = 'ada' as MuseId;
const GUEST = 'bo' as MuseId;
const start = at(T0 + 10 * HOUR);
const end = at(start + 2 * HOUR);
const invitation = (state: InvitationState, visited = false): Invitation => ({
  id: 'inv-1' as InvitationId,
  host: HOST,
  guest: GUEST,
  state,
  window: { start, end },
  proposedAt: T0,
  visited,
});

describe('the invitation statechart', () => {
  const legal: readonly [InvitationState, Action, Instant, InvitationState][] = [
    ['proposed', 'approve', at(T0 + HOUR), 'sent'],
    ['proposed', 'decline-send', at(T0 + HOUR), 'declined'],
    ['proposed', 'deadline', at(start - HOUR), 'expired'],
    ['sent', 'accept', at(T0 + 2 * HOUR), 'accepted'],
    ['sent', 'decline', at(T0 + 2 * HOUR), 'declined'],
    ['sent', 'deadline', start, 'expired'],
    ['accepted', 'window-start', start, 'open'],
    ['open', 'window-end', end, 'closed'],
    ['open', 'visited', at(start + HOUR), 'open'],
  ];

  it.each(legal)('%s --%s--> %s writes the same transition to both logs', (from, action, now, to) => {
    const result = policy.invitationStep(invitation(from), action, now);
    const event = { kind: 'invitation', id: 'inv-1', host: HOST, guest: GUEST, to, window: { start, end }, ...(action === 'visited' ? { visited: true } : {}) };
    expect(result).toEqual({ ok: true, host: [event], guest: [event] });
  });

  it('rejects every other action in every state, at any time', () => {
    const times = [T0, at(start - HOUR), start, at(start + HOUR), end, at(end + DAY)];
    for (const state of STATES) {
      for (const action of ACTIONS) {
        if (legal.some(([s, a]) => s === state && a === action)) continue;
        for (const now of times) expect(policy.invitationStep(invitation(state), action, now)).toMatchObject({ ok: false });
      }
    }
  });

  it('rejects a legal action at the wrong time', () => {
    const wrongTime: readonly [InvitationState, Action, Instant][] = [
      ['proposed', 'approve', at(start - HOUR)],
      ['proposed', 'deadline', at(start - HOUR - 1)],
      ['sent', 'accept', start],
      ['sent', 'deadline', at(start - 1)],
      ['accepted', 'window-start', at(start - 1)],
      ['open', 'window-end', at(end - 1)],
      ['open', 'visited', end],
    ];
    for (const [state, action, now] of wrongTime) expect(policy.invitationStep(invitation(state), action, now)).toMatchObject({ ok: false });
  });

  it('records a visit once', () => {
    const again = policy.invitationStep(invitation('open', true), 'visited', at(start + HOUR));
    expect(again).toEqual({ ok: true, host: [], guest: [] });
  });
});

describe('an invitation over time', () => {
  type Answer = { readonly at: Instant; readonly action: Action };

  /**
   * A tiny engine: owners' answers plus the policy's timers, in time order, folded into the host's log. It either
   * schedules every timer once at proposal, or cancels and reschedules them after each transition.
   */
  function live(answers: readonly Answer[], style: 'once' | 'reschedule'): { readonly state: InvitationState; readonly visited: boolean; readonly trail: string[] } {
    const proposed: MuseEventBody = { kind: 'invitation', id: 'inv-1' as InvitationId, host: HOST, guest: GUEST, to: 'proposed', window: { start, end } };
    let social = reduceSocial(emptySocial(), { museId: HOST, seq: 1, event: { ...proposed, at: T0 } }, HOST);
    let seq = 1;
    const current = () => social.invitations.get('inv-1' as InvitationId)!;
    let pending: Answer[] = [...answers];
    let timers: Answer[] = [...policy.invitationTimers(current())];
    const trail: string[] = [];
    for (let next = earliest(); next; next = earliest()) {
      const result = policy.invitationStep(current(), next.action, next.at);
      if (!result.ok) continue;
      for (const event of result.host) {
        social = reduceSocial(social, { museId: HOST, seq: ++seq, event: { ...event, at: next.at } }, HOST);
        trail.push(`${current().state}@${(next.at - T0) / HOUR}h`);
      }
      if (style === 'reschedule' && result.host.length > 0) timers = [...policy.invitationTimers(current())].filter((t) => t.at >= next.at);
    }
    return { state: current().state, visited: current().visited, trail };

    function earliest(): Answer | undefined {
      const all = [...pending, ...timers].sort((x, y) => x.at - y.at);
      const next = all[0];
      pending = pending.filter((a) => a !== next);
      timers = timers.filter((t) => t !== next);
      return next;
    }
  }

  const paths: readonly [string, readonly Answer[], InvitationState, string[], boolean][] = [
    ['no host answer', [], 'expired', ['expired@9h'], false],
    ['host declines', [{ at: at(T0 + HOUR), action: 'decline-send' }], 'declined', ['declined@1h'], false],
    ['no guest answer', [{ at: at(T0 + HOUR), action: 'approve' }], 'expired', ['sent@1h', 'expired@10h'], false],
    ['guest declines', [{ at: at(T0 + HOUR), action: 'approve' }, { at: at(T0 + 2 * HOUR), action: 'decline' }], 'declined', ['sent@1h', 'declined@2h'], false],
    [
      'accepted, nobody shows up',
      [{ at: at(T0 + HOUR), action: 'approve' }, { at: at(T0 + 2 * HOUR), action: 'accept' }],
      'closed',
      ['sent@1h', 'accepted@2h', 'open@10h', 'closed@12h'],
      false,
    ],
    [
      'accepted and visited',
      [{ at: at(T0 + HOUR), action: 'approve' }, { at: at(T0 + 2 * HOUR), action: 'accept' }, { at: at(start + HOUR), action: 'visited' }],
      'closed',
      ['sent@1h', 'accepted@2h', 'open@10h', 'open@11h', 'closed@12h'],
      true,
    ],
    ['an answer after the deadline', [{ at: at(start - HOUR / 2), action: 'approve' }], 'expired', ['expired@9h'], false],
  ];

  it.each(paths)('%s', (_name, answers, final, trail, visited) => {
    for (const style of ['once', 'reschedule'] as const) {
      const run = live(answers, style);
      expect(run.state).toBe(final);
      expect(run.trail).toEqual(trail);
      expect(run.visited).toBe(visited);
    }
  });

  it('is single use: once closed nothing reopens it and it schedules nothing more', () => {
    const closed = invitation('closed', true);
    expect(policy.invitationTimers(closed)).toEqual([]);
    for (const action of ACTIONS) expect(policy.invitationStep(closed, action, start).ok).toBe(false);
    expect(policy.canVisit(closed, GUEST, at(start + HOUR))).toBe(false);
  });
});

describe('who may visit', () => {
  const open = invitation('open');

  it('lets only the invited owner in, only while open and inside the window', () => {
    expect(policy.canVisit(open, GUEST, start)).toBe(true);
    expect(policy.canVisit(open, GUEST, at(end - 1))).toBe(true);

    expect(policy.canVisit(open, GUEST, at(start - 1))).toBe(false);
    expect(policy.canVisit(open, GUEST, end)).toBe(false);
    expect(policy.canVisit(open, HOST, at(start + HOUR))).toBe(false);
    expect(policy.canVisit(open, 'cy' as MuseId, at(start + HOUR))).toBe(false);
    for (const state of STATES.filter((s) => s !== 'open')) expect(policy.canVisit(invitation(state), GUEST, at(start + HOUR))).toBe(false);
    expect(policy.canVisit(undefined, GUEST, at(start + HOUR))).toBe(false);
  });
});

describe('proposing an invitation', () => {
  const like = topics('Lichen', 'Moss', 'Fern');

  /** Daily hangouts hosted by ada; returns the proposals with the day each was made. */
  function hangOut(host: MuseState, guest: MuseState, days: number) {
    let [a, b] = apply(host, guest, policy.ownerLink(host, guest, 'introduce', T0), T0);
    const proposals: { day: number; event: Extract<MuseEventBody, { kind: 'invitation' }> }[] = [];
    for (let day = 1; day <= days; day++) {
      const now = at(T0 + day * DAY);
      const out = policy.hangout(a, b, now, draws(day));
      for (const event of ofKind(out.host, 'invitation')) {
        proposals.push({ day, event });
        expect(ofKind(out.guest, 'invitation')).toEqual([event]);
      }
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, now);
    }
    return proposals;
  }

  const local = (instant: number, timeZone: string) => {
    const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant).split(':').map(Number);
    return h * 60 + m;
  };

  it('needs more rapport from an introverted host', () => {
    const firstDay = (sociability: number) => hangOut(muse('ada', { sociability, interests: like }), muse('bo', { interests: like }), 10)[0]?.day ?? Infinity;
    expect(firstDay(0.2)).toBeGreaterThan(firstDay(0.9));
  });

  it('proposes the earliest 2 h slot in daytime for both owners, within 3 days', () => {
    const host = muse('ada', { sociability: 0.9, interests: like, timezone: 'America/Los_Angeles' });
    const guest = muse('bo', { interests: like, timezone: 'Asia/Tokyo' });
    const [{ day, event }] = hangOut(host, guest, 5);
    const now = T0 + day * DAY;
    const { start: s, end: e } = event.window;
    expect(event).toMatchObject({ host: host.seed.id, guest: guest.seed.id, to: 'proposed' });
    expect(e - s).toBe(2 * HOUR);
    expect(s).toBeGreaterThan(now);
    expect(e).toBeLessThanOrEqual(now + 3 * DAY);
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(local(s, zone)).toBeGreaterThanOrEqual(9 * 60);
      expect(local(e, zone)).toBeLessThanOrEqual(21 * 60);
      expect(local(e, zone)).toBeGreaterThan(local(s, zone));
    }
    // Every earlier quarter-hour start that leaves the owners 2 h to answer falls outside someone's daytime.
    const daytime = (from: number) =>
      ['America/Los_Angeles', 'Asia/Tokyo'].every((z) => local(from, z) >= 9 * 60 && local(from + 2 * HOUR, z) <= 21 * 60 && local(from + 2 * HOUR, z) > local(from, z));
    for (let earlier = s - QUARTER; earlier >= now + 2 * HOUR; earlier -= QUARTER) expect(daytime(earlier)).toBe(false);
  });

  it('proposes nothing when the owners share no daytime slot', () => {
    const host = muse('ada', { sociability: 0.9, interests: like, timezone: 'Etc/UTC' });
    const guest = muse('bo', { interests: like, timezone: 'Pacific/Auckland' });
    expect(hangOut(host, guest, 10)).toEqual([]);
  });

  it('waits 14 days between invitations, however well the hangouts go', () => {
    const proposals = hangOut(muse('ada', { sociability: 0.9, interests: like }), muse('bo', { interests: like }), 40);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < proposals.length; i++) expect(proposals[i].day - proposals[i - 1].day).toBeGreaterThanOrEqual(14);
  });
});
