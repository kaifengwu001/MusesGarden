// A real Muse (agent.joined) makes its own social choices, so the rules make none for it: it meets others, is visited
// and receives gifts, but no draw befriends it, and it gives no gift and sends no invitation of its own.
import { describe, expect, it } from 'vitest';
import type { MuseState } from '../../../src/muse/contract';
import { socialPolicy as policy } from './policy';
import { HOUR, T0, apply, at, constant, find, fold, muse, ofKind, pastHangout, topics } from './testkit';

const agent = (s: MuseState): MuseState => ({ ...s, agent: true });

describe('a real Muse among the simulated ones', () => {
  it('meets strangers beyond and grows familiar, but no draw makes it friends', () => {
    let [a, b] = [agent(muse('ada', { sociability: 1, interests: topics('Lichen'), reach: 'everyone' })), muse('bo', { sociability: 1, interests: topics('Lichen'), reach: 'everyone' })];
    for (let n = 1; n <= 200; n++) [a, b] = apply(a, b, policy.encounter(a, b, 'beyond', at(T0 + n * HOUR), constant(0)), at(T0 + n * HOUR));
    expect(a.social.relationships.get(b.seed.id)).toMatchObject({ status: 'acquainted', encounters: 200 });
    expect(b.social.relationships.get(a.seed.id)?.status).toBe('acquainted');
  });

  it('receives a friend’s gift at a hangout but gives none, and never invites the friend’s owner', () => {
    const host = agent(muse('ada', { interests: topics('Lichen'), discoveries: [find('Lichen dyes', ['Lichen'])] }));
    const guest = muse('bo', { interests: topics('Lichen'), discoveries: [find('Lichen and moss', ['Lichen'])] });
    let [a, b] = apply(host, guest, policy.ownerLink(host, guest, 'introduce', T0), T0);
    for (let k = 0; k < 12; k++) [a, b] = [fold(a, [pastHangout(b, 'host', 1)], T0), fold(b, [pastHangout(a, 'guest', 1)], T0)];
    const out = policy.hangout(a, b, at(T0 + 30 * 24 * HOUR), constant(0.5));
    const [hostSide] = ofKind(out.host, 'hangout');
    expect(hostSide.gave).toBeUndefined();
    expect(hostSide.received?.title).toBe('Lichen and moss');
    expect(ofKind(out.host, 'invitation')).toEqual([]);
    // The same hangout with a simulated host sends one, so it is the real Muse that held it back.
    const simulated = policy.hangout({ ...a, agent: false }, b, at(T0 + 30 * 24 * HOUR), constant(0.5));
    expect(ofKind(simulated.host, 'invitation')).toHaveLength(1);
    expect(ofKind(simulated.host, 'hangout')[0].gave).toBeDefined();
  });
});
