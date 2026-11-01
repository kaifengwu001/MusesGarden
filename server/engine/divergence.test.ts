// The acceptance test for the personality claim: identical Muses with different histories choose differently,
// the choices survive a restart, and removing the history makes them choose like the seed-only Muse again.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Candidate, CanonicalUrl, Instant, MuseId, MuseSeed, MuseState, StoredEvent } from '../../src/muse/contract';
import { HeuristicMind } from '../adapters/minds/heuristic';
import { loadMediaRecording } from '../adapters/sources/media';
import { lifePolicy } from '../domain/policy/index';
import { reduceSocial } from '../domain/social/state';
import { emptyState, reduceCore } from '../domain/state';
import { FIXTURES_DIR, readMemberDocs } from '../fixtures/cast';
import { buildGarden } from './compose';
import type { Engine } from './engine';

const START = Date.parse('2026-11-02T08:00:00-08:00') as Instant;
const H = 3_600_000;
const held = loadMediaRecording().unseen;
const pool = { botany: held.botany.map((i) => i.candidate), jazz: held.jazz.map((i) => i.candidate), neutral: held.neutral.map((i) => i.candidate) };
const unseen: readonly Candidate[] = [...pool.botany, ...pool.jazz, ...pool.neutral];
const twinSoul = readFileSync(join(FIXTURES_DIR, 'divergence/a/SOUL.md'), 'utf8');
const memory = (twin: 'a' | 'b') => readFileSync(join(FIXTURES_DIR, `divergence/${twin}/MEMORY.md`), 'utf8');
const seed = (id: string): MuseSeed => ({ id: id as MuseId, name: id, worldSeed: 412, timezone: 'America/Los_Angeles' });

async function twins(days: number, db: string | null = null) {
  const garden = buildGarden({ db, mind: 'heuristic', hero: null, start: START, clock: 'fast-forward' });
  await garden.engine.addMuse(seed('twin-a'), twinSoul, memory('a'), START);
  await garden.engine.addMuse(seed('twin-b'), twinSoul, memory('b'), START);
  await garden.engine.advanceTo((START + days * 24 * H) as Instant);
  return garden;
}

/** What a Muse keeps from the same unseen finds: the Mind judges, the policy's keep rule decides. */
async function decide(engine: Engine, s: MuseState): Promise<ReadonlySet<CanonicalUrl>> {
  const judged = await new HeuristicMind().judge(engine.mindContext(s, null), unseen);
  return new Set(lifePolicy.keep(judged).map((j) => j.canonicalUrl));
}

/** Kept sets by best score: the top three, so a Muse's preferences show even when few pages pass the bar. */
async function preferences(engine: Engine, s: MuseState): Promise<ReadonlySet<CanonicalUrl>> {
  const judged = await new HeuristicMind().judge(engine.mindContext(s, null), unseen);
  return new Set([...judged].sort((a, b) => b.score - a.score).slice(0, 3).map((j) => j.canonicalUrl));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((x) => b.has(x)).length / union.size;
}

const fold = (s: MuseState, e: StoredEvent): MuseState => reduceCore({ ...s, social: reduceSocial(s.social, e, s.seed.id) }, e);

/** The log with every experience removed (and renumbered), keeping the seed events and the reflections. */
function withoutExperiences(log: readonly StoredEvent[]): StoredEvent[] {
  const experience = new Set(['trip.hop', 'discovery.collected', 'region.revealed', 'question.opened', 'question.closed', 'hangout', 'encounter', 'photo.taken', 'basket.delivered']);
  return log.filter((e) => !experience.has(e.event.kind)).map((e, i) => ({ ...e, seq: i + 1 }));
}

function replay(id: string, log: readonly StoredEvent[]): MuseState {
  return log.reduce(fold, emptyState(seed(id)));
}

describe('divergence: history, not hidden parameters, drives what Muse keeps', () => {
  it('identical Muses whose owners love botany and jazz keep different finds after a free week', async () => {
    const { engine, store } = await twins(7);
    const a = await preferences(engine, engine.state('twin-a' as MuseId) as MuseState);
    const b = await preferences(engine, engine.state('twin-b' as MuseId) as MuseState);
    expect(jaccard(a, b)).toBeLessThanOrEqual(0.34);
    const botany = new Set(pool.botany.map((c) => c.canonicalUrl));
    const jazz = new Set(pool.jazz.map((c) => c.canonicalUrl));
    expect([...a].filter((u) => botany.has(u)).length).toBeGreaterThan([...a].filter((u) => jazz.has(u)).length);
    expect([...b].filter((u) => jazz.has(u)).length).toBeGreaterThan([...b].filter((u) => botany.has(u)).length);
    store.close();
  });

  it('control: the same inputs give the same log and the same choices', async () => {
    const one = await twins(3);
    const two = await twins(3);
    const id = 'twin-a' as MuseId;
    expect(two.engine.log(id).map((e) => e.event)).toEqual(one.engine.log(id).map((e) => e.event));
    expect([...(await decide(two.engine, two.engine.state(id) as MuseState))]).toEqual([...(await decide(one.engine, one.engine.state(id) as MuseState))]);
  });

  it('ablation: remove the experiences and the Muse chooses like its seed-only self again, likes and all', async () => {
    const { engine, commands } = await twins(7);
    for (const id of ['twin-a', 'twin-b']) {
      const [find] = engine.state(id as MuseId)?.discoveries.keys() ?? [];
      expect(await commands.like(id as MuseId, { find }, true)).toEqual({ ok: true });
      const log = engine.log(id as MuseId);
      const seedOnly = replay(id, log.filter((e) => e.event.kind === 'soul.updated' || e.event.kind === 'memory.updated' || e.event.kind === 'owner.liked'));
      const stripped = replay(id, withoutExperiences(log));
      expect(stripped.reflections).toEqual([]);
      expect(engine.state(id as MuseId)?.likes.size).toBe(1);
      expect(stripped.likes.size).toBe(0);
      expect([...(await preferences(engine, stripped))]).toEqual([...(await preferences(engine, seedOnly))]);
      const score = async (st: MuseState) => (await new HeuristicMind().judge(engine.mindContext(st, null), unseen)).map((j) => j.score);
      expect(await score(engine.state(id as MuseId) as MuseState)).not.toEqual(await score(seedOnly));
    }
  });

  it('the choices survive closing and reopening the SQLite store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'muse-divergence-'));
    try {
      const path = join(dir, 'garden.db');
      const first = await twins(7, path);
      const before = await preferences(first.engine, first.engine.state('twin-b' as MuseId) as MuseState);
      first.store.close();
      const reopened = buildGarden({ db: path, mind: 'heuristic', hero: null, start: START, clock: 'fast-forward' });
      const after = await preferences(reopened.engine, reopened.engine.state('twin-b' as MuseId) as MuseState);
      expect([...after]).toEqual([...before]);
      reopened.store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('friends shape interests: identical Muses introduced to a botany friend or a music friend end up with different top interests', async () => {
    const garden = buildGarden({ db: null, mind: 'heuristic', hero: null, start: START, clock: 'fast-forward' });
    const blank = '# Memory\n\n## Interests\n\n## Routines\n- Waters the window boxes before work.\n';
    const botanist = readMemberDocs({ dir: 'divergence/a' });
    const musician = readMemberDocs({ dir: 'divergence/b' });
    await garden.engine.addMuse(seed('twin-a'), twinSoul, blank, START);
    await garden.engine.addMuse(seed('twin-b'), twinSoul, blank, START);
    await garden.engine.addMuse(seed('botanist'), botanist.soul, botanist.memory, START);
    await garden.engine.addMuse(seed('musician'), musician.soul, musician.memory, START);
    await garden.engine.introduce('twin-a' as MuseId, 'botanist' as MuseId, START);
    await garden.engine.introduce('twin-b' as MuseId, 'musician' as MuseId, START);
    await garden.engine.advanceTo((START + 14 * 24 * H) as Instant);
    const top = (id: string) =>
      [...(garden.engine.state(id as MuseId) as MuseState).interests.values()]
        .sort((x, y) => y.affinity - x.affinity || y.sources.length - x.sources.length)
        .slice(0, 3)
        .map((i) => i.topic);
    expect(top('twin-a')).not.toEqual(top('twin-b'));
    garden.store.close();
  });
});
