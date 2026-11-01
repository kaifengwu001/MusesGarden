import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import { FixtureSource, loadCorpus, loadHeroChain, loadUnseenPool, parseCandidate, type CorpusPage } from './corpus';
import type { TopicPage } from './wikipedia';

const corpus = loadCorpus();
const none = new Set<CanonicalUrl>();
const titles = (cs: readonly TopicPage[]) => cs.map((c) => c.title);
const page = (title: string): CorpusPage => {
  const p = corpus.pages.find((q) => q.candidate.title === title);
  if (p === undefined) throw new Error(`${title} is not in the corpus`);
  return p;
};

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('FixtureSource must not touch the network');
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('the recorded corpus', () => {
  it('holds about 300 real Wikipedia pages across all 14 interest areas', () => {
    expect(corpus.pages.length).toBeGreaterThanOrEqual(280);
    expect(corpus.areas).toHaveLength(14);
    for (const area of corpus.areas) {
      expect(corpus.pages.filter((p) => p.area === area.name).length, area.name).toBeGreaterThanOrEqual(20);
    }
    expect(new Set(corpus.pages.map((p) => p.candidate.canonicalUrl)).size).toBe(corpus.pages.length);
  });

  it('records every page in the contract shape, with the URL MediaWiki itself reported', () => {
    for (const { candidate } of corpus.pages) {
      expect(candidate.origin).toBe('wikipedia');
      expect(candidate.url).toBe(candidate.canonicalUrl);
      expect(candidate.canonicalUrl.startsWith('https://en.wikipedia.org/wiki/')).toBe(true);
      expect(candidate.topics[0]).toBe(candidate.title);
      expect(candidate.topics.length).toBeLessThanOrEqual(7);
      expect(candidate.topics.some((t) => t.startsWith('Category:'))).toBe(false);
      expect(candidate.summary.length).toBeGreaterThan(0);
      expect(candidate.summary.length).toBeLessThanOrEqual(400);
    }
  });
});

describe('recorded topics', () => {
  const notTopics = [
    /^\d{4} (?:births|deaths)$/, /^Living people$/, /^People from /, / alumni$/, /^Articles /, /^Pages /, /^Wikipedia /,
    /^CS1 /, /^Webarchive /, /^All stub articles$/, / stubs$/, /^Use dmy dates/, /^Short description/, /^Commons category/,
    /^Coordinates on Wikidata$/, /^Burials at /,
  ];

  it('hold no biographical or maintenance category, in the corpus or the pools', () => {
    const pool = loadUnseenPool();
    const recorded = [...corpus.pages.map((p) => p.candidate), ...loadHeroChain(), ...pool.botany, ...pool.jazz, ...pool.neutral];
    const offenders = recorded.flatMap((c) => c.topics.slice(1).filter((t) => notTopics.some((re) => re.test(t))).map((t) => `${c.title}: ${t}`));
    expect(offenders).toEqual([]);
  });

  it('are checked when a recorded page is loaded', () => {
    const ultramarine = page('Ultramarine').candidate;
    expect(() => parseCandidate({ ...ultramarine, topics: [...ultramarine.topics.slice(0, 2), 'People from Zurich'] })).toThrow(/maintenance/);
  });
});

describe('FixtureSource', () => {
  const source = new FixtureSource(corpus);

  it('answers the same question the same way, even from a fresh load', async () => {
    const other = FixtureSource.load();
    const ultramarine = page('Ultramarine').candidate;
    const ask = async (s: FixtureSource) => [
      await s.search('Jazz' as TopicKey, 8, none),
      await s.next(ultramarine, 8, none),
      await s.serendipity(8, 42, none),
      await s.resolveTopic('botanical art'),
    ];
    expect(await ask(other)).toEqual(await ask(source));
    expect(await ask(source)).toEqual(await ask(source));
  });

  it('search puts the exact page first, then pages that share its categories or mention it', async () => {
    const results = await source.search('Jazz' as TopicKey, 10, none);
    expect(results[0].title).toBe('Jazz');
    const jazzCategories = new Set(page('Jazz').candidate.topics);
    for (const c of results.slice(1)) {
      const related = c.topics.some((t) => jazzCategories.has(t)) || /jazz/i.test(`${c.title} ${c.summary}`);
      expect(related, c.title).toBe(true);
    }
  });

  it('next follows the recorded links in article order, then same-category pages', async () => {
    const watercolor = page('Watercolor painting');
    const linked = await source.next(watercolor.candidate, watercolor.links.length, none);
    expect(titles(linked)).toEqual(watercolor.links);

    const leaf = corpus.pages.find((p) => p.links.length === 0);
    if (leaf === undefined) throw new Error('expected a page with no in-corpus links');
    const related = await source.next(leaf.candidate, 5, none);
    expect(related.length).toBeGreaterThan(0);
    for (const c of related) expect(c.topics.some((t) => leaf.candidate.topics.includes(t)), c.title).toBe(true);
  });

  it('honours exclude in every method, keeping the order of everything else', async () => {
    const from = page('Ultramarine').candidate;
    const calls = {
      search: (limit: number, ex: ReadonlySet<CanonicalUrl>) => source.search('Pigment' as TopicKey, limit, ex),
      next: (limit: number, ex: ReadonlySet<CanonicalUrl>) => source.next(from, limit, ex),
      serendipity: (limit: number, ex: ReadonlySet<CanonicalUrl>) => source.serendipity(limit, 7, ex),
    };
    for (const [method, call] of Object.entries(calls)) {
      const all = await call(50, none);
      const exclude = new Set(all.slice(0, 3).map((c) => c.canonicalUrl));
      expect(all.length, method).toBeGreaterThan(4);
      expect(await call(6, exclude), method).toEqual(all.filter((c) => !exclude.has(c.canonicalUrl)).slice(0, 6));
    }
    expect((await source.next(from, 50, none)).some((c) => c.canonicalUrl === from.canonicalUrl)).toBe(false);
  });

  it('serendipity is stable for a seed and differs across seeds', async () => {
    const a = await source.serendipity(10, 1, none);
    expect(a).toHaveLength(10);
    expect(await source.serendipity(10, 1, none)).toEqual(a);
    expect(titles(await source.serendipity(10, 2, none))).not.toEqual(titles(a));
  });

  it('resolves titles and recorded redirects offline, ignoring case and underscores', async () => {
    expect(await source.resolveTopic('ultramarine')).toBe('Ultramarine');
    expect(await source.resolveTopic('botanical_illustration')).toBe('Botanical illustration');
    expect(await source.resolveTopic('Botanical art')).toBe('Botanical illustration');
    expect(await source.resolveTopic('Not a page in the corpus')).toBeNull();
  });
});

describe('pools', () => {
  const source = new FixtureSource(corpus);

  it('the hero chain runs Botanical illustration to Ultramarine over real links inside the corpus', () => {
    const chain = loadHeroChain();
    expect(chain).toHaveLength(3);
    expect(chain[0].title).toBe('Botanical illustration');
    expect(chain[2].title).toBe('Ultramarine');
    for (let i = 0; i < chain.length - 1; i++) {
      expect(page(chain[i].title).links, `${chain[i].title} links to ${chain[i + 1].title}`).toContain(chain[i + 1].topics[0]);
    }
    for (const c of chain) expect(page(c.title).candidate).toEqual(c);
  });

  it('a trip can walk the hero chain: a search hop, then two hops of at most 10 pages', async () => {
    const chain = loadHeroChain();
    expect((await source.search('Botanical illustration' as TopicKey, 6, none))[0]).toEqual(chain[0]);
    for (let i = 0; i < chain.length - 1; i++) {
      expect(titles(await source.next(chain[i], 10, none))).toContain(chain[i + 1].title);
    }
  });

  it('the unseen pool is 3 botany, 3 jazz and 2 neutral real pages, none of them in the corpus', async () => {
    const pool = loadUnseenPool();
    expect([pool.botany.length, pool.jazz.length, pool.neutral.length]).toEqual([3, 3, 2]);
    const inCorpus = new Set(corpus.pages.map((p) => p.candidate.canonicalUrl));
    for (const c of [...pool.botany, ...pool.jazz, ...pool.neutral]) {
      expect(inCorpus.has(c.canonicalUrl), c.title).toBe(false);
      expect(await source.resolveTopic(c.title), c.title).toBeNull();
    }
  });
});
