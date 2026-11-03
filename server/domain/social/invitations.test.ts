import { describe, expect, it } from 'vitest';
import type { Invitation, InvitationId, InvitationState, MuseEventBody, MuseId, MuseState } from '../../../src/muse/contract';
import { socialPolicy as policy } from './policy';
import { DAY, HOUR, T0, apply, at, draws, fold, muse, ofKind, topics } from './testkit';

const HOST = 'ada' as MuseId;
const GUEST = 'bo' as MuseId;
const ID = 'inv-1' as InvitationId;
const sent = at(T0 + HOUR);

const invitation = (state: InvitationState, usedAt: number | null = null, returnedAt: number | null = null): Invitation => ({
  id: ID,
  host: HOST,
  guest: GUEST,
  state,
  sentAt: sent,
  usedAt: usedAt === null ? null : at(usedAt),
  returnedAt: returnedAt === null ? null : at(returnedAt),
});
const event = (to: InvitationState): MuseEventBody => ({ kind: 'invitation', id: ID, host: HOST, guest: GUEST, to });

describe('an invitation received: Travel now or Keep for later', () => {
  it('lets the guest’s owner use a sent invitation, once, writing the same event to both logs', () => {
    expect(policy.invitationStep(invitation('sent'), 'use', GUEST, at(sent + 5 * 60_000))).toEqual({ ok: true, event: event('used') });
  });

  it('never expires: a kept invitation still works a year on', () => {
    expect(policy.invitationStep(invitation('sent'), 'use', GUEST, at(sent + 365 * DAY))).toEqual({ ok: true, event: event('used') });
  });

  it('treats a second use within 2 h as the same visit, and refuses one after', () => {
    const used = invitation('used', sent + DAY);
    expect(policy.invitationStep(used, 'use', GUEST, at(sent + DAY + HOUR))).toEqual({ ok: true, event: null });
    expect(policy.invitationStep(used, 'use', GUEST, at(sent + DAY + 2 * HOUR))).toMatchObject({ ok: false, status: 409 });
  });

  it('lets only the guest’s owner use it', () => {
    for (const as of [HOST, 'cy' as MuseId]) expect(policy.invitationStep(invitation('sent'), 'use', as, sent)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a withdrawn invitation', () => {
    expect(policy.invitationStep(invitation('withdrawn'), 'use', GUEST, sent)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('withdrawing', () => {
  it('lets only the host’s owner withdraw, and only before it is used', () => {
    expect(policy.invitationStep(invitation('sent'), 'withdraw', HOST, at(sent + 30 * DAY))).toEqual({ ok: true, event: event('withdrawn') });
    expect(policy.invitationStep(invitation('sent'), 'withdraw', GUEST, sent)).toMatchObject({ ok: false, status: 403 });
    expect(policy.invitationStep(invitation('used', sent), 'withdraw', HOST, sent)).toMatchObject({ ok: false, status: 409 });
  });

  it('withdrawing twice changes nothing', () => {
    expect(policy.invitationStep(invitation('withdrawn'), 'withdraw', HOST, sent)).toEqual({ ok: true, event: null });
  });
});

describe('the visit view', () => {
  it('is the guest’s alone, for 2 h after they used the invitation', () => {
    const usedAt = sent + DAY;
    expect(policy.visitUntil(invitation('used', usedAt), GUEST)).toBe(usedAt + 2 * HOUR);
    expect(policy.visitUntil(invitation('used', usedAt), HOST)).toBeNull();
    expect(policy.visitUntil(invitation('sent'), GUEST)).toBeNull();
    expect(policy.visitUntil(invitation('withdrawn'), GUEST)).toBeNull();
    expect(policy.visitUntil(undefined, GUEST)).toBeNull();
  });

  it('closes when the guest returned, whether early or at the 2 h', () => {
    const usedAt = sent + DAY;
    expect(policy.visitUntil(invitation('returned', usedAt, usedAt + 40 * 60_000), GUEST)).toBe(usedAt + 40 * 60_000);
    expect(policy.visitUntil(invitation('returned', usedAt, usedAt + 2 * HOUR), GUEST)).toBe(usedAt + 2 * HOUR);
    expect(policy.visitUntil(invitation('returned', usedAt, usedAt + 40 * 60_000), HOST)).toBeNull();
  });
});

describe('coming home from a trip', () => {
  const usedAt = sent + DAY;

  it('lets the guest’s owner return from a trip under way, writing the same event to both logs', () => {
    expect(policy.invitationStep(invitation('used', usedAt), 'return', GUEST, at(usedAt + HOUR))).toEqual({ ok: true, event: event('returned') });
  });

  it('lets only the guest’s owner return', () => {
    for (const as of [HOST, 'cy' as MuseId]) expect(policy.invitationStep(invitation('used', usedAt), 'return', as, at(usedAt))).toMatchObject({ ok: false, status: 403 });
  });

  it('returning twice changes nothing', () => {
    expect(policy.invitationStep(invitation('returned', usedAt, usedAt + HOUR), 'return', GUEST, at(usedAt + HOUR))).toEqual({ ok: true, event: null });
  });

  it('refuses to return from a trip never taken, or a withdrawn one', () => {
    expect(policy.invitationStep(invitation('sent'), 'return', GUEST, at(usedAt))).toMatchObject({ ok: false, status: 409 });
    expect(policy.invitationStep(invitation('withdrawn'), 'return', GUEST, at(usedAt))).toMatchObject({ ok: false, status: 409 });
  });

  it('ends the ticket: once returned it can’t be used again, even inside the 2 h, nor withdrawn', () => {
    const returned = invitation('returned', usedAt, usedAt + 30 * 60_000);
    expect(policy.invitationStep(returned, 'use', GUEST, at(usedAt + HOUR))).toMatchObject({ ok: false, status: 409, error: 'this invitation is returned' });
    expect(policy.invitationStep(returned, 'withdraw', HOST, at(usedAt + HOUR))).toMatchObject({ ok: false, status: 409 });
  });
});

describe('the record in both logs', () => {
  it('folds sent, then used, then returned, keeping when each happened', () => {
    const replay = (self: MuseId, steps: readonly [InvitationState, number][]) => {
      let s = fold(muse(self), [event('sent')], sent);
      for (const [to, t] of steps) s = fold(s, [event(to)], at(t));
      return s.social.invitations.get(ID);
    };
    const used = sent + 3 * DAY;
    for (const self of [HOST, GUEST]) {
      expect(replay(self, [])).toEqual({ id: ID, host: HOST, guest: GUEST, state: 'sent', sentAt: sent, usedAt: null, returnedAt: null });
      expect(replay(self, [['used', used]])).toEqual({ id: ID, host: HOST, guest: GUEST, state: 'used', sentAt: sent, usedAt: used, returnedAt: null });
      expect(replay(self, [['used', used], ['returned', used + HOUR]])).toEqual({ id: ID, host: HOST, guest: GUEST, state: 'returned', sentAt: sent, usedAt: used, returnedAt: used + HOUR });
    }
  });

  it('ignores a step for an invitation it never saw sent', () => {
    expect(fold(muse('ada'), [event('used')], sent).social.invitations.size).toBe(0);
  });
});

describe('sending an invitation', () => {
  const like = topics('Lichen', 'Moss', 'Fern');

  function hangOut(host: MuseState, guest: MuseState, days: number) {
    let [a, b] = apply(host, guest, policy.ownerLink(host, guest, 'introduce', T0), T0);
    const invitations: { day: number; event: Extract<MuseEventBody, { kind: 'invitation' }> }[] = [];
    for (let day = 1; day <= days; day++) {
      const now = at(T0 + day * DAY);
      const out = policy.hangout(a, b, now, draws(day));
      for (const e of ofKind(out.host, 'invitation')) {
        invitations.push({ day, event: e });
        expect(ofKind(out.guest, 'invitation')).toEqual([e]);
      }
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, now);
    }
    return invitations;
  }

  it('needs more rapport from an introverted host', () => {
    const firstDay = (sociability: number) => hangOut(muse('ada', { sociability, interests: like }), muse('bo', { interests: like }), 10)[0]?.day ?? Infinity;
    expect(firstDay(0.2)).toBeGreaterThan(firstDay(0.9));
  });

  it('goes straight to the guest’s owner, whatever their time zones', () => {
    const host = muse('ada', { sociability: 0.9, interests: like, timezone: 'Etc/UTC' });
    const guest = muse('bo', { interests: like, timezone: 'Pacific/Auckland' });
    const [first] = hangOut(host, guest, 5);
    expect(first.event).toMatchObject({ host: host.seed.id, guest: guest.seed.id, to: 'sent' });
  });

  it('waits 14 days between invitations, however well the hangouts go', () => {
    const invitations = hangOut(muse('ada', { sociability: 0.9, interests: like }), muse('bo', { interests: like }), 40);
    expect(invitations.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < invitations.length; i++) expect(invitations[i].day - invitations[i - 1].day).toBeGreaterThanOrEqual(14);
  });
});
