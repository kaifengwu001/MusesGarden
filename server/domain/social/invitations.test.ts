import { describe, expect, it } from 'vitest';
import type { Invitation, InvitationId, InvitationState, MuseEventBody, MuseId, MuseState } from '../../../src/muse/contract';
import { socialPolicy as policy } from './policy';
import { DAY, HOUR, T0, apply, at, draws, fold, muse, ofKind, topics } from './testkit';

const HOST = 'ada' as MuseId;
const GUEST = 'bo' as MuseId;
const ID = 'inv-1' as InvitationId;
const sent = at(T0 + HOUR);

const invitation = (state: InvitationState, usedAt: number | null = null): Invitation => ({
  id: ID,
  host: HOST,
  guest: GUEST,
  state,
  sentAt: sent,
  usedAt: usedAt === null ? null : at(usedAt),
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
});

describe('the record in both logs', () => {
  it('folds sent, then used, keeping when each happened', () => {
    const replay = (self: MuseId) => {
      let s = muse(self);
      s = fold(s, [event('sent')], sent);
      s = fold(s, [event('used')], at(sent + 3 * DAY));
      return s.social.invitations.get(ID);
    };
    for (const self of [HOST, GUEST]) expect(replay(self)).toEqual({ id: ID, host: HOST, guest: GUEST, state: 'used', sentAt: sent, usedAt: sent + 3 * DAY });
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
