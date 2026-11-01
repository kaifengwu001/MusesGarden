// End to end: a MEMORY.md full of private facts goes in through the engine the way the Muse app would send it.
// Only allow-listed interest topics may come out, and no trace of the raw text may be stored.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Instant, MuseId } from '../../src/muse/contract';
import { FIXTURES_DIR } from '../fixtures/cast';
import { buildGarden } from './compose';

const START = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const memory = readFileSync(join(FIXTURES_DIR, 'privacy/MEMORY.sensitive.md'), 'utf8');
const soul = readFileSync(join(FIXTURES_DIR, 'divergence/a/SOUL.md'), 'utf8');

/** The words that make each marked line private: names, places, numbers, and the health and relationship terms. */
const privateWords = memory
  .split('\n')
  .filter((line) => line.includes('<!-- sensitive -->'))
  .flatMap((line) => line.replace('<!-- sensitive -->', '').match(/[A-Z][a-z]+|\d[\d,$.]*|diabetes|glucose|partner|salary|patch/gi) ?? [])
  .filter((w) => !['Has', 'Lives', 'Going', 'Manager', 'Salary', 'Partner'].includes(w));

describe('privacy, end to end through the engine', () => {
  it('a sensitive MEMORY.md yields only interest topics, and none of its private facts', async () => {
    const garden = buildGarden({ db: null, mind: 'heuristic', hero: null, start: START, clock: 'fast-forward' });
    await garden.engine.addMuse({ id: 'owner' as MuseId, name: 'Owner', worldSeed: 412, timezone: 'UTC' }, soul, memory, START);
    const log = garden.engine.log('owner' as MuseId);
    const topics = log.flatMap((e) => (e.event.kind === 'memory.updated' ? e.event.topics : []));

    expect(privateWords.length).toBeGreaterThan(10);
    expect(topics.length).toBeGreaterThan(0);
    const words = (t: string) => t.toLowerCase().split(/[^a-z0-9$.,]+/).filter(Boolean);
    for (const t of topics) {
      for (const w of privateWords) expect(words(t), `topic "${t}" vs private "${w}"`).not.toContain(w.toLowerCase());
    }

    const stored = JSON.stringify(log) + (garden.store.soulText('owner' as MuseId) ?? '');
    for (const w of ['Dana', 'Whitcombe', 'Theodore', 'Lindqvist', 'Larkspur', 'Springfield', '97477', '148,500', 'diabetes', 'glucose']) {
      expect(stored, `stored data contains "${w}"`).not.toContain(w);
    }
    expect(log.some((e) => e.event.kind === 'memory.updated' && e.event.textHash.length === 64)).toBe(true);
    garden.store.close();
  });
});
