import { describe, expect, it } from 'vitest';
import type { DiscoveryId, MuseEventBody, MuseState, PhotoId } from '../../../src/muse/contract';
import { socialPolicy as policy } from './policy';
import { DAY, HOUR, T0, apply, at, draws, find, fold, muse, ofKind, pastHangout, topics, type MuseSpec } from './testkit';

function introduce(a: MuseState, b: MuseState): [MuseState, MuseState] {
  return apply(a, b, policy.ownerLink(a, b, 'introduce', T0), T0);
}

/** Introduced, and they have met once since. */
function acquainted(a: MuseState, b: MuseState): [MuseState, MuseState] {
  const [a1, b1] = introduce(a, b);
  return [fold(a1, [pastHangout(b1, 'host', 0.6)], T0), fold(b1, [pastHangout(a1, 'guest', 0.6)], T0)];
}

describe('every hangout', () => {
  const host = muse('ada', {
    interests: topics('Lichen', 'Moss'),
    discoveries: [
      find('Lichen dyes', ['Lichen']),
      find('Lichen and moss', ['Lichen', 'Moss']),
      find('Lichen, moss and fern', ['Lichen', 'Moss', 'Fern']),
      find('Moss gardens', ['Moss']),
    ],
  });
  const guestSpec: MuseSpec = {
    interests: topics('Lichen', 'Jazz'),
    discoveries: [find('Lichen in jazz', ['Lichen', 'Jazz']), find('Bebop', ['Jazz'])],
  };

  it('exchanges a gift each way and takes one photo of the two on the host planet, in both logs', () => {
    const [a, b] = introduce(host, muse('bo', guestSpec));
    const now = at(T0 + 5 * HOUR);
    const out = policy.hangout(a, b, now, draws(1));

    const [hostPhoto] = ofKind(out.host, 'photo.taken');
    const [guestPhoto] = ofKind(out.guest, 'photo.taken');
    expect(hostPhoto.photo).toMatchObject({ subject: 'friend', context: 'planet', planetOf: a.seed.id, companions: [b.seed.id], at: now });
    expect(guestPhoto.photo).toEqual({ ...hostPhoto.photo, companions: [a.seed.id] });

    const [hostSide] = ofKind(out.host, 'hangout');
    const [guestSide] = ofKind(out.guest, 'hangout');
    expect(hostSide).toMatchObject({ other: b.seed.id, role: 'host', photo: hostPhoto.photo.id });
    expect(guestSide).toMatchObject({ other: a.seed.id, role: 'guest', photo: hostPhoto.photo.id, pleasantness: hostSide.pleasantness });
    expect(policy.publicProfile(a).discoveries).toContainEqual(guestSide.received);
    expect(policy.publicProfile(b).discoveries).toContainEqual(hostSide.received);
    expect(hostSide.gave).toBe(guestSide.received?.id);
    expect(guestSide.gave).toBe(hostSide.received?.id);
  });

  it('gives the find that best stretches the other: some overlap with what it shares, not total', () => {
    const [a, b] = introduce(host, muse('bo', guestSpec));
    const out = policy.hangout(a, b, at(T0 + HOUR), draws(2));
    expect(ofKind(out.guest, 'hangout')[0].received?.title).toBe('Lichen and moss');
    expect(ofKind(out.host, 'hangout')[0].received?.title).toBe('Lichen in jazz');
  });

  it('skips a find the other already has', () => {
    const [a, b] = introduce(host, muse('bo', { ...guestSpec, collected: ['Lichen and moss'] }));
    const out = policy.hangout(a, b, at(T0 + HOUR), draws(3));
    expect(ofKind(out.guest, 'hangout')[0].received?.title).toBe('Lichen, moss and fern');
  });

  it('still takes the photo when a Muse has nothing public to give', () => {
    const [a, b] = introduce(host, muse('bo', { interests: topics('Jazz') }));
    const out = policy.hangout(a, b, at(T0 + HOUR), draws(4));
    expect(ofKind(out.host, 'photo.taken')).toHaveLength(1);
    expect(ofKind(out.guest, 'photo.taken')).toHaveLength(1);
    const [hostSide] = ofKind(out.host, 'hangout');
    const [guestSide] = ofKind(out.guest, 'hangout');
    expect(guestSide.received?.id).toBe(hostSide.gave);
    expect(guestSide.gave).toBeUndefined();
    expect(hostSide.received).toBeUndefined();
  });
});

describe('choosing whom to visit', () => {
  const like = topics('Lichen', 'Moss', 'Fern');
  const make = (id: string, sociability = 0.6, day = '2026-11-02') => {
    const s = muse(id, { sociability, interests: like });
    return { ...s, day: { ...s.day, day } };
  };

  function circle(): { self: MuseState; friends: MuseState[] } {
    let self = make('ada');
    const friends: MuseState[] = [];
    for (const [id, hangouts] of [['bo', 6], ['cy', 3], ['di', 1]] as const) {
      let friend = make(id);
      [self, friend] = introduce(self, friend);
      self = fold(self, Array.from({ length: hangouts }, () => pastHangout(friend, 'host', 0.9)), T0);
      friends.push(friend);
    }
    return { self, friends };
  }

  it('favours closer friends', () => {
    const { self, friends } = circle();
    const free = friends.map((state) => ({ state }));
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 3000; seed++) {
      const choice = policy.chooseVisit(self, free, at(T0 + 10 * HOUR), draws(seed));
      if (choice) counts.set(choice.other, (counts.get(choice.other) ?? 0) + 1);
    }
    // Closeness 1, 1/2 and 1/6 at temperature 0.2 give weights e^5, e^2.5 and e^0.83: about 91%, 7.5% and 1.4%.
    const [bo, cy, di] = ['bo', 'cy', 'di'].map((id) => (counts.get(id) ?? 0) / 3000);
    expect(bo).toBeGreaterThan(0.85);
    expect(cy).toBeGreaterThan(di);
    expect(di).toBeGreaterThan(0);
    expect(bo + cy + di).toBe(1);
  });

  it('favours a friend whose photos the owner liked, counting each photo once', () => {
    const { self, friends } = circle();
    const [, cy] = friends;
    const like = (photo: string, liked = true): MuseEventBody => ({ kind: 'owner.liked', target: { photo: photo as PhotoId }, liked, friend: cy.seed.id });
    const notOfAFriend: MuseEventBody = { kind: 'owner.liked', target: { photo: 'p3' as PhotoId }, liked: true };
    const aFind: MuseEventBody = { kind: 'owner.liked', target: { find: 'd' as DiscoveryId }, liked: true, friend: cy.seed.id };
    const fond = fold(self, [like('p1'), like('p1', false), like('p1'), like('p2'), notOfAFriend, aFind], T0);
    expect(fond.social.relationships.get(cy.seed.id)?.fondness).toBe(2);
    expect(fond.social.relationships.get(friends[0].seed.id)?.fondness).toBe(0);

    const share = (s: MuseState) => {
      let n = 0;
      for (let seed = 0; seed < 3000; seed++) if (policy.chooseVisit(s, friends.map((state) => ({ state })), at(T0 + 10 * HOUR), draws(seed))?.other === cy.seed.id) n++;
      return n / 3000;
    };
    expect(share(fond)).toBeGreaterThan(1.5 * share(self));
  });

  it('only ever picks a friend', () => {
    const { self } = circle();
    for (let seed = 0; seed < 200; seed++) {
      expect(policy.chooseVisit(self, [{ state: make('zed') }], at(T0 + 10 * HOUR), draws(seed))).toBeNull();
    }
  });

  it('keeps each day within 3 h × sociability, however many friends', () => {
    const morning = at(Date.parse('2026-11-03T17:00:00Z'));
    for (const sociability of [0.2, 0.6, 1]) {
      for (let day = 0; day < 20; day++) {
        let self = make('ada', sociability, '2026-11-03');
        const friends: MuseState[] = [];
        for (const id of ['bo', 'cy', 'di', 'ed', 'fy', 'gu']) {
          let friend = make(id, 1, '2026-11-03');
          [self, friend] = acquainted(self, friend);
          friends.push(friend);
        }
        let now = morning;
        let used = 0;
        for (let k = 0; k < 50; k++) {
          const choice = policy.chooseVisit(self, friends.map((state) => ({ state })), now, draws(day * 100 + k));
          if (!choice) break;
          expect(choice.until).toBeGreaterThan(now);
          used += choice.until - now;
          self = { ...self, day: { ...self.day, socialMs: used } };
          now = choice.until;
        }
        expect(used).toBeGreaterThan(0);
        expect(used).toBeLessThanOrEqual(3 * HOUR * sociability);
      }
    }
  });

  it('starts a fresh budget on the owner’s next local day', () => {
    const spent = make('ada');
    const [a, b] = acquainted({ ...spent, day: { ...spent.day, socialMs: 3 * HOUR } }, make('bo'));
    expect(policy.chooseVisit(a, [{ state: b }], at(T0 + 20 * HOUR), draws(1))).toBeNull();
    expect(policy.chooseVisit(a, [{ state: b }], at(T0 + DAY + 10 * HOUR), draws(1))).not.toBeNull();
  });

  it('meets a friend never met first, for 45 min, even with no social time left on either side', () => {
    const tired = (id: string) => {
      const s = make(id);
      return { ...s, day: { ...s.day, socialMs: 3 * HOUR } };
    };
    const [ada, met] = acquainted(tired('ada'), tired('bo'));
    const [self, fresh] = introduce(ada, tired('cy'));
    const free = [{ state: met }, { state: fresh }];
    const now = at(T0 + 10 * HOUR);
    expect(policy.visitOffer(self, free, now)).toBe('first-meeting');
    for (let seed = 0; seed < 50; seed++) expect(policy.chooseVisit(self, free, now, draws(seed))).toMatchObject({ other: fresh.seed.id, until: now + 45 * 60_000 });
    expect(policy.visitOffer(self, [{ state: met }], now)).toBe('none');
  });

  it('holds a first meeting until both have a photo slot left today', () => {
    const [a, b] = introduce(make('ada'), make('bo'));
    const full = { ...b, day: { ...b.day, photos: 5 } };
    expect(policy.visitOffer(a, [{ state: full }], at(T0 + 10 * HOUR))).toBe('none');
    expect(policy.chooseVisit(a, [{ state: full }], at(T0 + 10 * HOUR), draws(1))).toBeNull();
  });

  it('offers an ordinary visit while both have social time left', () => {
    const [a, b] = acquainted(make('ada'), make('bo'));
    expect(policy.visitOffer(a, [{ state: b }], at(T0 + 10 * HOUR))).toBe('friend');
    expect(policy.visitOffer(a, [], at(T0 + 10 * HOUR))).toBe('none');
  });

  it('goes over less often after being the guest last time', () => {
    const goesOver = (lastRole: 'host' | 'guest') => {
      const [a0, b] = introduce(make('ada'), make('bo'));
      const a = fold(a0, [pastHangout(b, lastRole, 0.6)], T0);
      let goes = 0;
      for (let seed = 0; seed < 4000; seed++) if (policy.chooseVisit(a, [{ state: b }], at(T0 + 10 * HOUR), draws(seed))?.role === 'guest') goes++;
      return goes / 4000;
    };
    expect(goesOver('host')).toBeCloseTo(0.5, 1);
    expect(goesOver('guest')).toBeCloseTo(0.3, 1);
  });
});
