import { describe, expect, it } from 'vitest';
import { socialPolicy as policy } from './policy';
import { HOUR, T0, apply, at, draws, find, interest, muse, ofKind, topics, wiki } from './testkit';

const ada = muse('ada', {
  timezone: 'Europe/Lisbon',
  interests: [
    interest('Lichen'),
    interest('Moss', { sources: [] }),
    interest('Tide', { seededBy: 'owner-memory', stage: 'emerging', sources: [wiki('Tide tables'), wiki('Harbour walk')] }),
    interest('Sailing', { seededBy: 'owner-memory', stage: 'established', sources: [wiki('Sail knots')] }),
    interest('Poetry', { seededBy: 'soul', stage: 'hypothesis' }),
    interest('Ink', { seededBy: 'soul', stage: 'established' }),
    interest('Fern'),
  ],
  hidden: ['topic:Fern', 'discovery:Lichen secrets'],
  discoveries: [
    find('Lichen dyes', ['Lichen']),
    find('Sail knots', ['Knot']),
    find('Lichen secrets', ['Lichen']),
    find('Tide tables', ['Tide']),
    find('Harbour walk', ['Walk']),
    find('Lichen tides', ['Lichen', 'Tide']),
    find('Fern spores', ['Fern']),
    find('Lichen gift', ['Lichen'], { provenance: 'gift' }),
    find('Opera house', ['Opera']),
  ],
});

describe('what a Muse shares', () => {
  it('shares Muse-grown interests with a source, and owner or soul interests only once established', () => {
    expect(policy.publicProfile(ada).interests.map((i) => i.topic).sort()).toEqual(['Ink', 'Lichen', 'Sailing']);
  });

  it('shares only its own finds whose every topic is public, never hidden ones or gifts', () => {
    expect(policy.publicProfile(ada).discoveries.map((d) => d.title).sort()).toEqual(['Lichen dyes', 'Sail knots']);
  });

  it('carries only the public fields, and nothing about the owner', () => {
    const profile = policy.publicProfile(ada);
    expect(Object.keys(profile).sort()).toEqual(['discoveries', 'interests', 'museId', 'name', 'worldSeed']);
    for (const d of profile.discoveries) expect(Object.keys(d).sort()).toEqual(['canonicalUrl', 'id', 'summary', 'title', 'topics', 'url']);
    for (const i of profile.interests) expect(Object.keys(i).sort()).toEqual(['topic', 'weight']);
    const json = JSON.stringify(profile);
    for (const secret of ['Lisbon', 'Tide', 'Poetry', 'Fern', 'Moss', 'secrets', 'gift', 'Opera', 'reason', 'place']) expect(json).not.toContain(secret);
  });

  it('never gives a hidden or private find as a gift, even the one that would stretch the friend most', () => {
    // "Lichen tides" would stretch bo most, but Tide is ada's owner's private interest.
    const bo = muse('bo', { interests: topics('Tide') });
    const [a, b] = apply(ada, bo, policy.ownerLink(ada, bo, 'introduce', T0), T0);
    const [received] = ofKind(policy.hangout(a, b, at(T0 + HOUR), draws(1)).guest, 'hangout');
    expect(['Lichen dyes', 'Sail knots']).toContain(received.received.title);
  });
});
