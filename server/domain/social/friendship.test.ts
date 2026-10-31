import { describe, expect, it } from 'vitest';
import type { MuseEventBody, MuseState } from '../../../src/muse/contract';
import { socialPolicy as policy } from './policy';
import { DAY, HOUR, T0, apply, at, constant, draws, find, interest, muse, ofKind, topics } from './testkit';

const shared = ['Lichen', 'Moss', 'Fern'];

function pair(sociability: number, a = shared, b = shared): [MuseState, MuseState] {
  return [muse('ada', { sociability, interests: topics(...a) }), muse('bo', { sociability, interests: topics(...b) })];
}

/** Encounters beyond until the two become friends; returns how many it took. */
function meetUntilFriends(a: MuseState, b: MuseState, seed: number | null, limit = 200): number {
  for (let n = 1; n <= limit; n++) {
    const now = at(T0 + n * HOUR);
    const out = policy.encounter(a, b, now, seed === null ? constant(0) : draws(seed * 1000 + n));
    [a, b] = apply(a, b, out, now);
    if (a.social.relationships.get(b.seed.id)?.status === 'friends') return n;
  }
  return Infinity;
}

describe('meeting strangers beyond', () => {
  it('meets friends at rate 0, and strangers only when they share something public', () => {
    let [a, b] = pair(0.8);
    expect(policy.encounterRate(a, b)).toBeGreaterThan(0);
    [a, b] = apply(a, b, policy.ownerLink(a, b, 'introduce', T0), T0);
    expect(policy.encounterRate(a, b)).toBe(0);
    expect(policy.encounterRate(b, a)).toBe(0);

    const [c, d] = pair(0.8, ['Lichen'], ['Jazz']);
    expect(policy.encounterRate(c, d)).toBe(0);
  });

  it('meets more often the more sociable each Muse is', () => {
    const rates = [0.2, 0.5, 0.9].map((s) => policy.encounterRate(muse('ada', { sociability: s, interests: topics(...shared) }), muse('bo', { sociability: 0.6, interests: topics(...shared) })));
    expect(rates[0]).toBeLessThan(rates[1]);
    expect(rates[1]).toBeLessThan(rates[2]);
  });

  it('meets more often the more their public interests match', () => {
    const others = [['Jazz', 'Opera', 'Blues'], ['Lichen', 'Opera', 'Blues'], ['Lichen', 'Moss', 'Blues'], shared];
    const rates = others.map((theirs) => policy.encounterRate(...pair(0.7, shared, theirs)));
    expect(rates[0]).toBe(0);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });

  it('judges similarity only from what each Muse shares publicly', () => {
    const privateOnly = { interests: [interest('Lichen', { seededBy: 'owner-memory', stage: 'emerging' })] };
    expect(policy.encounterRate(muse('ada', privateOnly), muse('bo', privateOnly))).toBe(0);
  });
});

describe('becoming friends', () => {
  it('takes an introvert pair more encounters than an extrovert pair', () => {
    expect(meetUntilFriends(...pair(0.2), null)).toBeGreaterThan(meetUntilFriends(...pair(0.9), null));

    const mean = (sociability: number) => {
      const counts = Array.from({ length: 40 }, (_, seed) => meetUntilFriends(...pair(sociability), seed));
      return counts.reduce((s, n) => s + n, 0) / counts.length;
    };
    expect(mean(0.25)).toBeGreaterThan(mean(0.9));
  });

  it('never befriends at a first meeting, however sociable', () => {
    const [a, b] = pair(1);
    const out = policy.encounter(a, b, T0, constant(0));
    expect(ofKind(out.self, 'relationship.changed')).toEqual([]);
  });

  it('sends both owners a photo of the two whenever a friendship starts beyond', () => {
    let befriended = 0;
    for (let seed = 0; seed < 30; seed++) {
      let [a, b] = pair(0.7);
      for (let n = 1; n <= 40; n++) {
        const now = at(T0 + n * HOUR);
        const out = policy.encounter(a, b, now, draws(seed * 100 + n));
        if (ofKind(out.self, 'relationship.changed').some((e) => e.to === 'friends')) {
          befriended++;
          expect(ofKind(out.self, 'relationship.changed')).toEqual([{ kind: 'relationship.changed', other: b.seed.id, to: 'friends', origin: 'met-beyond' }]);
          expect(ofKind(out.other, 'relationship.changed')).toEqual([{ kind: 'relationship.changed', other: a.seed.id, to: 'friends', origin: 'met-beyond' }]);
          const [mine] = ofKind(out.self, 'photo.taken');
          const [theirs] = ofKind(out.other, 'photo.taken');
          expect(mine.photo).toMatchObject({ subject: 'new-friend', companions: [b.seed.id], at: now });
          expect(theirs.photo).toMatchObject({ id: mine.photo.id, subject: 'new-friend', companions: [a.seed.id] });
          break;
        }
        expect(ofKind(out.self, 'photo.taken')).toEqual([]);
        [a, b] = apply(a, b, out, now);
      }
    }
    expect(befriended).toBeGreaterThan(20);
  });
});

describe('friendships ending', () => {
  const withFinds = (id: string, names: string[]) =>
    muse(id, { sociability: 0.6, interests: topics(...names), discoveries: names.map((n) => find(`${id}-${n}`, [n])) });

  function friends(a: MuseState, b: MuseState): [MuseState, MuseState] {
    return apply(a, b, policy.ownerLink(a, b, 'introduce', T0), T0);
  }

  /** Hangouts until the friendship ends: returns how many ended it, after `pleasant` good ones first. */
  function hangoutsUntilEnded(pleasant: number): number {
    let [a, b] = friends(withFinds('ada', shared), withFinds('bo', shared));
    let t = T0;
    for (let i = 0; i < pleasant; i++) {
      t = at(t + DAY);
      const out = policy.hangout(a, b, t, draws(i));
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, t);
    }
    expect(a.social.relationships.get(b.seed.id)?.status).toBe('friends');
    b = { ...b, interests: new Map(topics('Jazz', 'Opera').map((x) => [x.topic, x])) };
    for (let n = 1; n <= 20; n++) {
      t = at(t + DAY);
      const out = policy.hangout(a, b, t, draws(100 + n));
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, t);
      const ended = ofKind(out.host, 'relationship.changed').find((e) => e.to === 'ended');
      if (ended) {
        expect(ended.reason).toBe('drifted-apart');
        expect(ofKind(out.guest, 'relationship.changed')).toEqual([{ ...ended, other: a.seed.id }]);
        expect(b.social.relationships.get(a.seed.id)?.status).toBe('ended');
        return n;
      }
    }
    return Infinity;
  }

  it('ends after k unpleasant hangouts in a row, and k grows with rapport', () => {
    expect(hangoutsUntilEnded(0)).toBe(2);
    // Seven hangouts at p = 0.6 give rapport 4.2: k = 2 + floor(4.2 / 2) = 4.
    expect(hangoutsUntilEnded(7)).toBe(4);
  });

  it('starts the count over after a pleasant hangout', () => {
    let [a, b] = friends(withFinds('ada', shared), withFinds('bo', shared));
    const close = b;
    const drifted = { ...b, interests: new Map(topics('Jazz').map((x) => [x.topic, x])) };
    const ends: boolean[] = [];
    [drifted, close, drifted].forEach((guest, i) => {
      const t = at(T0 + (i + 1) * DAY);
      const out = policy.hangout(a, { ...guest, social: b.social }, t, draws(i));
      ends.push(ofKind(out.host, 'relationship.changed').length > 0);
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, t);
    });
    expect(ends).toEqual([false, false, false]);
  });

  it('never ends from time apart: after a 30-day gap the friendship and its rapport are intact', () => {
    let [a, b] = friends(withFinds('ada', shared), withFinds('bo', shared));
    for (let i = 1; i <= 3; i++) {
      const out = policy.hangout(a, b, at(T0 + i * HOUR), draws(i));
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, at(T0 + i * HOUR));
    }
    const before = a.social.relationships.get(b.seed.id);

    const later = at(T0 + 30 * DAY);
    expect(policy.chooseVisit(a, [{ state: b }], later, draws(9))?.other).toBe(b.seed.id);
    const out = policy.hangout(a, b, later, draws(7));
    expect(ofKind(out.host, 'relationship.changed')).toEqual([]);
    [a, b] = apply(a, b, { self: out.host, other: out.guest }, later);
    const after = a.social.relationships.get(b.seed.id);
    expect(after?.status).toBe('friends');
    expect(after?.rapport).toBeCloseTo((before?.rapport ?? 0) + ofKind(out.host, 'hangout')[0].pleasantness);
  });

  it('keeps a day-one introduction alive before either Muse has anything public', () => {
    let [a, b] = friends(muse('ada', { sociability: 0.6 }), muse('bo', { sociability: 0.6 }));
    for (let i = 1; i <= 6; i++) {
      const out = policy.hangout(a, b, at(T0 + i * HOUR), draws(i));
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, at(T0 + i * HOUR));
    }
    expect(a.social.relationships.get(b.seed.id)?.status).toBe('friends');
  });
});

describe('owners introducing and unsharing', () => {
  it('makes introduced Muses friends at once, in both logs', () => {
    const [a, b] = pair(0.3, ['Lichen'], ['Jazz']);
    const [a2, b2] = apply(a, b, policy.ownerLink(a, b, 'introduce', T0), T0);
    expect(a2.social.relationships.get(b.seed.id)).toMatchObject({ status: 'friends', origin: 'introduced' });
    expect(b2.social.relationships.get(a.seed.id)).toMatchObject({ status: 'friends', origin: 'introduced' });
  });

  it('ends an introduced friendship when an owner unshares, and nothing more crosses', () => {
    let [a, b] = pair(0.6);
    [a, b] = apply(a, b, policy.ownerLink(a, b, 'introduce', T0), T0);
    const out = policy.ownerLink(a, b, 'unshare', at(T0 + HOUR));
    expect(ofKind(out.self, 'relationship.changed')).toEqual([{ kind: 'relationship.changed', other: b.seed.id, to: 'ended', origin: 'introduced', reason: 'owner-unshared' }]);
    expect(ofKind(out.other, 'relationship.changed')).toEqual([{ kind: 'relationship.changed', other: a.seed.id, to: 'ended', origin: 'introduced', reason: 'owner-unshared' }]);
    [a, b] = apply(a, b, out, at(T0 + HOUR));

    expect(a.social.relationships.get(b.seed.id)?.status).toBe('ended');
    expect(b.social.relationships.get(a.seed.id)?.status).toBe('ended');
    expect(policy.encounterRate(a, b)).toBe(0);
    expect(policy.chooseVisit(a, [{ state: b }], at(T0 + 2 * HOUR), draws(1))).toBeNull();
    expect(policy.hangout(a, b, at(T0 + 2 * HOUR), draws(1))).toEqual({ host: [], guest: [] });
  });

  it('withdraws a live invitation when an owner unshares, so the window never opens', () => {
    let [a, b] = pair(0.9);
    [a, b] = apply(a, b, policy.ownerLink(a, b, 'introduce', T0), T0);
    let invitation: Extract<MuseEventBody, { kind: 'invitation' }> | undefined;
    for (let i = 1; !invitation && i < 20; i++) {
      const out = policy.hangout(a, b, at(T0 + i * HOUR), draws(i));
      [a, b] = apply(a, b, { self: out.host, other: out.guest }, at(T0 + i * HOUR));
      invitation = ofKind(out.host, 'invitation')[0];
    }
    expect(invitation).toBeDefined();
    const out = policy.ownerLink(b, a, 'unshare', at(T0 + 3 * HOUR));
    expect(ofKind(out.self, 'invitation')).toEqual([{ ...invitation, to: 'declined' }]);
    expect(ofKind(out.other, 'invitation')).toEqual([{ ...invitation, to: 'declined' }]);
    const [unsharer, other] = apply(b, a, out, at(T0 + 3 * HOUR));
    expect(unsharer.social.invitations.get(invitation!.id)?.state).toBe('declined');
    const inv = other.social.invitations.get(invitation!.id)!;
    expect(inv.state).toBe('declined');
    expect(policy.invitationStep(inv, 'approve', at(T0 + 3 * HOUR)).ok).toBe(false);
    expect(policy.invitationTimers(inv)).toEqual([]);
  });
});
