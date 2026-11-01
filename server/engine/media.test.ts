// Temperament shows in what Muse looks at: twins with one owner, one whimsical and one focused, look at different
// mixes of reels, posts, articles and videos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Instant, MediaKind, MuseId, MuseSeed } from '../../src/muse/contract';
import { FIXTURES_DIR } from '../fixtures/cast';
import { buildGarden } from './compose';

const START = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const H = 3_600_000;
const soul = readFileSync(join(FIXTURES_DIR, 'divergence/a/SOUL.md'), 'utf8');
const memory = '# Memory\n\n## Interests\n- Botanical illustration\n- Tea\n- Jazz\n';
const seed = (id: string): MuseSeed => ({ id: id as MuseId, name: id, worldSeed: 412, timezone: 'America/Los_Angeles' });
const traits = (t: Record<string, number>) => soul.replace(/^(curiosity|focus|whimsy|novelty): .*$/gm, (line, k: string) => `${k}: ${t[k] ?? line.split(': ')[1]}`);

/** The share of reels and posts. */
const quick = (kinds: readonly MediaKind[]) => kinds.filter((k) => k === 'reel' || k === 'post').length / Math.max(1, kinds.length);

describe('what a hop looks for', () => {
  it('a whimsical Muse looks at more reels and posts than a focused twin with the same owner', async () => {
    const garden = buildGarden({ db: null, mind: 'heuristic', hero: null, start: START, clock: 'fast-forward' });
    await garden.engine.addMuse(seed('whimsical'), traits({ focus: 0.2, curiosity: 0.4, whimsy: 0.9, novelty: 0.9 }), memory, START);
    await garden.engine.addMuse(seed('focused'), traits({ focus: 0.9, curiosity: 0.8, whimsy: 0.2, novelty: 0.2 }), memory, START);
    await garden.engine.advanceTo((START + 7 * 24 * H) as Instant);
    const kindOf = new Map(garden.recording.items.map((i) => [i.candidate.canonicalUrl as string, i.candidate.media.kind]));
    const looked = (id: string) =>
      quick(garden.engine.log(id as MuseId).flatMap((e) => (e.event.kind === 'trip.hop' ? e.event.looked.flatMap((v) => kindOf.get(v.canonicalUrl) ?? []) : [])));
    expect(looked('whimsical') - looked('focused')).toBeGreaterThan(0.2);
    garden.store.close();
  });
});
