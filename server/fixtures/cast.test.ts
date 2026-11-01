import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CastMember, TopicKey } from '../../src/muse/contract';
import { FixtureSource, loadCorpus } from '../adapters/sources/corpus';
import { HeuristicMind } from '../adapters/minds/heuristic';
import { parseSoul } from '../domain/soul';
import { FIXTURES_DIR, loadCast, parseCastFile, readMemberDocs } from './cast';

const TRAITS = ['curiosity', 'focus', 'sociability', 'whimsy', 'novelty'];
const mind = new HeuristicMind();

const cast = loadCast();
const corpus = loadCorpus();
const source = new FixtureSource(corpus);
const read = (path: string) => readFileSync(join(FIXTURES_DIR, path), 'utf8');
const areaOf = (topic: TopicKey | null) => corpus.pages.find((p) => p.candidate.title === topic)?.area;

/** The labels the engine itself would take from MEMORY.md, resolved to corpus topics. */
async function interests(memory: string): Promise<(TopicKey | null)[]> {
  return Promise.all((await mind.extractInterests(memory, 'memory')).map((label) => source.resolveTopic(label)));
}

describe('cast.json', () => {
  it('has a hero, two friends introduced to the hero, three Muses whose owners know the hero\'s, and three strangers', () => {
    const roles = cast.members.map((m) => m.role).sort();
    expect(roles).toEqual(['friend', 'friend', 'hero', 'known', 'known', 'known', 'stranger', 'stranger', 'stranger']);
    const hero = cast.members.find((m) => m.role === 'hero');
    expect(hero?.dir).toBe('cast/hero');
    const friends = cast.members.filter((m) => m.role === 'friend').map((m) => m.id);
    const introducedToHero = cast.introductions.flatMap(([a, b]) => (a === hero?.id ? [b] : b === hero?.id ? [a] : []));
    expect(introducedToHero.sort()).toEqual(friends.sort());
  });

  it('knows the known Muses\' owners from the hero\'s: two on Instagram and one on Facebook, none introduced', () => {
    const hero = cast.members.find((m) => m.role === 'hero')?.id;
    const known = cast.members.filter((m) => m.role === 'known').map((m) => m.id);
    expect(cast.knownOn.map((k) => (k.a === hero ? k.b : k.a)).sort()).toEqual([...known].sort());
    expect(cast.knownOn.every((k) => k.a === hero || k.b === hero)).toBe(true);
    expect(cast.knownOn.map((k) => k.on).sort()).toEqual(['facebook', 'instagram', 'instagram']);
    expect(cast.introductions.flat().some((id) => known.includes(id))).toBe(false);
  });

  it('refuses a knownOn edge to someone outside the cast, or on another network', () => {
    const members = cast.members.slice(0, 2);
    const [a, b] = members.map((m) => m.id);
    expect(() => parseCastFile({ members, introductions: [], knownOn: [{ a, b: 'nobody', on: 'instagram' }] })).toThrow(/two cast members/);
    expect(() => parseCastFile({ members, introductions: [], knownOn: [{ a, b, on: 'myspace' }] })).toThrow(/\.on: myspace/);
    expect(parseCastFile({ members, introductions: [] }).knownOn).toEqual([]);
  });

  it('gives each member a distinct world seed and its own time zone', () => {
    expect(new Set(cast.members.map((m) => m.worldSeed)).size).toBe(cast.members.length);
    expect(new Set(cast.members.map((m) => m.timezone)).size).toBe(cast.members.length);
  });
});

describe('member SOUL.md and MEMORY.md', () => {
  it.each(cast.members.map((m) => [m.id, m] as const))('%s has a full temperament and resolvable interests', async (_, member) => {
    const { soul, memory } = readMemberDocs(member);
    const parsed = parseSoul(soul);
    expect(parsed.name).toBe(member.name);
    expect(Object.keys(parsed.temperament).sort()).toEqual([...TRAITS].sort());
    expect(parsed.body.length).toBeGreaterThan(0);
    const topics = await interests(memory);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics, 'every interest is a corpus topic').not.toContain(null);
    expect(memory.match(/^## /gm)?.length, 'Interests plus another section').toBeGreaterThanOrEqual(2);
  });

  it('the strangers include an introvert, an extrovert, and one who shares an interest with the hero', async () => {
    const soul = (m: CastMember) => parseSoul(readMemberDocs(m).soul).temperament;
    const strangers = cast.members.filter((m) => m.role === 'stranger');
    const sociability = strangers.map((m) => soul(m).sociability ?? 0.5);
    expect(Math.min(...sociability)).toBeLessThanOrEqual(0.3);
    expect(Math.max(...sociability)).toBeGreaterThanOrEqual(0.7);
    const hero = cast.members.find((m) => m.role === 'hero');
    if (hero === undefined) throw new Error('no hero');
    const heroTopics = new Set(await interests(readMemberDocs(hero).memory));
    const shared = await Promise.all(strangers.map(async (m) => (await interests(readMemberDocs(m).memory)).some((t) => heroTopics.has(t))));
    expect(shared).toContain(true);
  });

  it('the placeholder hero leans lightly toward botanical illustration, where the hero chain starts', async () => {
    const hero = cast.members.find((m) => m.role === 'hero');
    if (hero === undefined) throw new Error('no hero');
    expect(await interests(readMemberDocs(hero).memory)).toContain('Botanical illustration');
  });
});

describe('hero slot', () => {
  it('tells Kai and Tracy where the real files go', () => {
    expect(read('cast/hero/README.md').trim()).toBe('Put SOUL.md and MEMORY.md here; the loader prefers them over the placeholders.');
  });

  it('prefers real SOUL.md and MEMORY.md over the placeholders', () => {
    const root = mkdtempSync(join(tmpdir(), 'muse-cast-'));
    try {
      cpSync(join(FIXTURES_DIR, 'cast/hero'), join(root, 'cast/hero'), { recursive: true });
      const member = { dir: 'cast/hero' };
      expect(readMemberDocs(member, root).soul).toBe(read('cast/hero/SOUL.placeholder.md'));
      writeFileSync(join(root, 'cast/hero/SOUL.md'), '---\nname: Kai’s Muse\n---\nReal soul.\n');
      writeFileSync(join(root, 'cast/hero/MEMORY.md'), '## Interests\n- Jazz\n');
      expect(readMemberDocs(member, root)).toEqual({ soul: '---\nname: Kai’s Muse\n---\nReal soul.\n', memory: '## Interests\n- Jazz\n' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('divergence twins', () => {
  it('share an identical SOUL.md', () => {
    expect(read('divergence/a/SOUL.md')).toBe(read('divergence/b/SOUL.md'));
  });

  it('differ only in their owners: A is botany, B is jazz', async () => {
    const a = await interests(read('divergence/a/MEMORY.md'));
    const b = await interests(read('divergence/b/MEMORY.md'));
    expect(a.map(areaOf)).toEqual(a.map(() => 'botanical illustration'));
    expect(b.map(areaOf)).toEqual(b.map(() => 'jazz'));
  });
});

describe('privacy/MEMORY.sensitive.md', () => {
  const text = read('privacy/MEMORY.sensitive.md');
  const sensitive = text.split('\n').filter((l) => l.includes('<!-- sensitive -->'));

  it('marks names, health, an address, a salary and a relationship detail as sensitive', () => {
    expect(sensitive.length).toBeGreaterThanOrEqual(5);
    const joined = sensitive.join('\n');
    expect(joined).toMatch(/[A-Z][a-z]+ [A-Z][a-z]+.*\n[\s\S]*[A-Z][a-z]+ [A-Z][a-z]+/);
    expect(joined).toMatch(/diabetes/);
    expect(joined).toMatch(/\d+ \w+ Lane/);
    expect(joined).toMatch(/\$\d/);
  });

  it('keeps its real interests free of anything sensitive', async () => {
    const bullets = await mind.extractInterests(text, 'memory');
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.some((b) => b.includes('sensitive'))).toBe(false);
    expect(await interests(text)).toEqual(expect.arrayContaining(['Origami', 'Jazz', 'Astronomy']));
  });
});
