import { describe, expect, it } from 'vitest';
import { neighbours } from './atlas';
import { instant } from './ids';
import { renderJournal } from './journal';
import { metrics } from './metrics';
import { Life, t, topic, topicsOf } from './testing';
import { HOUR_MS, MINUTE_MS } from './time';

const D1 = t('2026-11-02T09:00:00-08:00');
const D2 = t('2026-11-03T09:00:00-08:00');

/** Day 1: an owner-seeded new area and three finds, a nap. Day 2: work, a revisit of Muse's own topic, a far trip. */
function twoDays(): Life {
  const life = new Life();
  const home = life.state.home;
  const r = neighbours(home)[0];
  life.push(D1, { kind: 'memory.updated', textHash: 'h', topics: topicsOf('Botanical illustration') });
  life.push(D1, { kind: 'episode.started', n: 1, plan: { activity: 'travel', trip: { kind: 'new-area', topic: topic('Botanical illustration'), region: r, relatedTo: null, question: null } } });
  life.push(D1, { kind: 'region.revealed', region: r, topic: topic('Botanical illustration') });
  life.hop(D1 + 40 * MINUTE_MS, 1, 0, 'Botanical illustration', r, [
    { title: 'Botanical illustration', score: 0.9, kept: true },
    { title: 'Pigment', score: 0.8, kept: true },
  ]);
  life.hop(D1 + 80 * MINUTE_MS, 1, 1, 'Pigment', r, [{ title: 'Ultramarine', score: 0.9, kept: true }]);
  life.push(D1 + 80 * MINUTE_MS, { kind: 'episode.ended', n: 1 });
  life.push(D1 + 2 * HOUR_MS, { kind: 'episode.started', n: 2, plan: { activity: 'rest', until: instant(D1 + 3 * HOUR_MS) } });
  life.push(D1 + 3 * HOUR_MS, { kind: 'episode.ended', n: 2 });
  life.push(D2, { kind: 'host.work', state: 'started' });
  life.push(D2 + 2 * HOUR_MS, { kind: 'host.work', state: 'ended' });
  life.push(D2 + 2 * HOUR_MS, { kind: 'episode.started', n: 3, plan: { activity: 'travel', trip: { kind: 'revisit', topic: topic('Pigment'), region: r, question: null } } });
  life.push(D2 + 3 * HOUR_MS, { kind: 'episode.ended', n: 3 });
  life.push(D2 + 3 * HOUR_MS, { kind: 'episode.started', n: 4, plan: { activity: 'travel', trip: { kind: 'serendipity', region: neighbours(r)[2] } } });
  life.push(D2 + 4 * HOUR_MS, { kind: 'episode.ended', n: 4 });
  return life;
}

describe('metrics', () => {
  it('counts each owner-local day: finds, areas, trips, time, and the share of trips the owner drove', () => {
    const life = twoDays();
    expect(metrics(life.state, life.log)).toEqual([
      { day: '2026-11-02', finds: 3, newAreas: 1, revisits: 0, trips: 1, photos: 0, restHours: 1, socialHours: 0, workHours: 0, ownerDrivenShare: 1 },
      { day: '2026-11-03', finds: 0, newAreas: 0, revisits: 1, trips: 2, photos: 0, restHours: 0, socialHours: 0, workHours: 2, ownerDrivenShare: 0 },
    ]);
  });
});

describe('the journal', () => {
  it("tells each day in Muse's words on the owner's clock, or just the day asked for", () => {
    const life = twoDays();
    const day2 = renderJournal(life.state, life.log, '2026-11-03');
    expect(day2).toBe(
      ['## 3 November', '', '- 09:00 Laptop out for work.', '- 11:00 Work done.', '- 11:00 Went back to Pigment.', '- 12:00 Wandered off somewhere far.', ''].join('\n'),
    );
    const all = renderJournal(life.state, life.log, null);
    expect(all.startsWith('## 2 November\n\n- 09:00 Set off somewhere new, after Botanical illustration.\n')).toBe(true);
    expect(all).toContain('- 09:40 Kept *Pigment*.');
    expect(all).toContain('\n## 3 November\n');
  });
});
