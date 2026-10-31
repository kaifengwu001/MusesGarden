import { describe, expect, it } from 'vitest';
import type { PublicDiscovery, Relationship } from '../../src/muse/contract';
import { neighbours } from './atlas';
import { discoveryId, museId, photoId } from './ids';
import { validateReflection } from './reflection';
import { shelf } from './shelf';
import { Life, MOSS, t, topic, wiki } from './testing';
import { DAY_MS, HOUR_MS } from './time';

const D1 = t('2026-11-02T09:00:00-08:00');

/** Twelve finds: six about moss, six about jazz, with jazz kept a little more keenly. */
function collector(): Life {
  const life = new Life();
  const region = neighbours(life.state.home)[0];
  life.push(D1, { kind: 'episode.started', n: 1, plan: { activity: 'travel', trip: { kind: 'new-area', topic: topic('Moss'), region, relatedTo: null, question: null } } });
  life.push(D1, { kind: 'region.revealed', region, topic: topic('Moss') });
  for (let k = 0; k < 6; k++) {
    life.hop(D1 + k * HOUR_MS, 1, 2 * k, 'Moss', region, [{ title: `Moss ${k}`, score: 0.8, kept: true, topics: [`Moss ${k}`, 'Moss'] }]);
    life.hop(D1 + k * HOUR_MS, 1, 2 * k + 1, 'Jazz', region, [{ title: `Jazz ${k}`, score: 0.85, kept: true, topics: [`Jazz ${k}`, 'Jazz'] }]);
  }
  return life;
}

describe('the favorites shelf', () => {
  it('shows at most ten objects', () => {
    expect(shelf(collector().state, D1 + 7 * HOUR_MS)).toHaveLength(10);
  });

  it('reorders when reflection moves affinities', () => {
    const life = collector();
    const later = D1 + 10 * DAY_MS;
    const before = shelf(life.state, later).slice(0, 6);
    expect(before.every((x) => x.discovery.topics.includes(topic('Jazz')))).toBe(true);
    const evidence = [...life.state.discoveries.values()].filter((d) => d.topics.includes(topic('Moss'))).flatMap((d) => d.because);
    const body = validateReflection(
      life.state,
      life.log,
      {
        deltas: [
          { topic: topic('Moss'), dAffinity: 0.2, evidence, reason: 'moss keeps pulling me back' },
          { topic: topic('Jazz'), dAffinity: -0.2, evidence, reason: 'less jazz lately' },
        ],
        narrative: 'Moss over jazz.',
        questions: [],
      },
      later,
    );
    life.push(later, body);
    life.push(later, body);
    const after = shelf(life.state, later).slice(0, 6);
    expect(after.every((x) => x.discovery.topics.includes(topic('Moss')))).toBe(true);
  });

  it('holds gifts from close friends a little dearer', () => {
    const life = new Life();
    const gift = (from: string, title: string): void => {
      const received: PublicDiscovery = { id: discoveryId(title), url: wiki(title), canonicalUrl: wiki(title), title, summary: '', topics: [topic(title)] };
      life.push(D1, { kind: 'hangout', other: museId(from), role: 'host', pleasantness: 0.8, gave: discoveryId('x'), received, photo: photoId(MOSS.id, 0, D1, 0) });
    };
    gift('wren', 'Lichen');
    gift('juniper', 'Kelp');
    const rel = (other: string, rapport: number): Relationship => ({
      other: museId(other),
      status: 'friends',
      origin: 'introduced',
      familiarity: 0,
      rapport,
      rapportSinceInvite: 0,
      unpleasantStreak: 0,
      encounters: 0,
      hangouts: 1,
      lastRole: null,
      lastMetAt: null,
      lastInviteAt: null,
    });
    const s = { ...life.state, social: { relationships: new Map([[museId('wren'), rel('wren', 4)], [museId('juniper'), rel('juniper', 1)]]), invitations: new Map() } };
    const [first, second] = shelf(s, D1);
    expect(first.discovery.title).toBe('Lichen');
    expect(first.fondness - second.fondness).toBeCloseTo(0.1 * (1 - 1 / 4), 9);
  });
});
