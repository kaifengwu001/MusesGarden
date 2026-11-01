import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import { replayFetch, SAMPLE_BATCH, urlOf, type Samples } from './samples';
import { clampSummary } from './text';
import { normalizeTitle, USER_AGENT, WikipediaSource, wikipediaUrl, wikitextLinks, type TopicPage } from './wikipedia';

const samples = JSON.parse(readFileSync(new URL('./samples/wikipedia.json', import.meta.url), 'utf8')) as Samples;
const none = new Set<CanonicalUrl>();

function replayed() {
  const requests: { params: URLSearchParams; userAgent: string | null }[] = [];
  const serve = replayFetch(samples);
  const source = new WikipediaSource({
    minIntervalMs: 0,
    fetch: (input, init) => {
      requests.push({ params: new URL(urlOf(input)).searchParams, userAgent: new Headers(init?.headers).get('user-agent') });
      return serve(input, init);
    },
  });
  return { source, requests };
}

function expectContractShape(c: TopicPage): void {
  expect(c.origin).toBe('wikipedia');
  expect(c.url, 'MediaWiki’s canonical URL matches ours').toBe(c.canonicalUrl);
  expect(c.canonicalUrl).toBe(wikipediaUrl(c.title));
  expect(c.topics[0]).toBe(c.title);
  expect(c.topics.length).toBeLessThanOrEqual(7);
  expect(c.topics.some((t) => t.startsWith('Category:') || /^\d/.test(t))).toBe(false);
  expect(c.summary.length).toBeGreaterThan(0);
  expect(c.summary.length).toBeLessThanOrEqual(400);
}

describe('Wikipedia title and URL normalisation', () => {
  it('escapes titles the way MediaWiki does (checked live)', () => {
    expect(wikipediaUrl('Banks\' Florilegium')).toBe('https://en.wikipedia.org/wiki/Banks%27_Florilegium');
    expect(wikipediaUrl('AC/DC')).toBe('https://en.wikipedia.org/wiki/AC/DC');
    expect(wikipediaUrl('C (programming language)')).toBe('https://en.wikipedia.org/wiki/C_(programming_language)');
    expect(wikipediaUrl('Académie royale de peinture et de sculpture')).toBe(
      'https://en.wikipedia.org/wiki/Acad%C3%A9mie_royale_de_peinture_et_de_sculpture',
    );
    expect(wikipediaUrl('Rock & roll')).toBe('https://en.wikipedia.org/wiki/Rock_%26_roll');
  });

  it('normalises labels to main-namespace titles', () => {
    expect(normalizeTitle('  botanical_illustration ')).toBe('Botanical illustration');
    expect(normalizeTitle('Lapis   lazuli')).toBe('Lapis lazuli');
    expect(wikipediaUrl('botanical illustration')).toBe(wikipediaUrl('Botanical_illustration'));
  });

  it('clamps summaries to 400 characters, at a sentence end when one is near', () => {
    const sentence = 'Ultramarine is a deep blue pigment. ';
    const long = sentence.repeat(20);
    const cut = clampSummary(long);
    expect(cut.length).toBeLessThanOrEqual(400);
    expect(cut.endsWith('pigment.')).toBe(true);
    const words = clampSummary('word '.repeat(200));
    expect(words.length).toBeLessThanOrEqual(400);
    expect(words.endsWith('word…')).toBe(true);
    expect(clampSummary('Jazz ( ) is a music genre .')).toBe('Jazz is a music genre.');
  });
});

describe('wikitextLinks', () => {
  it('lists article links in body order, without files, categories, other wikis, anchors or citations', () => {
    const text = [
      "'''Ultramarine''' is a [[pigment|deep blue pigment]] from [[Lapis lazuli#Sources|lapis]].",
      '[[File:Ultramarine.jpg|thumb|Ground [[lazurite]] in a dish]]',
      'See [[Pigment]] again, and [[:Category:Blue]], [[wikt:azure]], [[fr:Outremer]].',
      'Made in [[Venice]].<ref>[[Cennino Cennini]], 1400.</ref><!-- [[Hidden]] -->',
      '== See also ==',
      '* [[Prussian blue]]',
      '== References ==',
      '* [[Daniel V. Thompson]]',
      '[[Category:Inorganic pigments]]',
    ].join('\n');
    expect(wikitextLinks(text)).toEqual(['Pigment', 'Lapis lazuli', 'Lazurite', 'Venice', 'Prussian blue']);
  });
});

describe('WikipediaSource on recorded responses', () => {
  it('search returns real pages in the contract shape, best match first, never a disambiguation', async () => {
    const { source } = replayed();
    const results = await source.search('Ultramarine' as TopicKey, 5, none);
    expect(results).toHaveLength(5);
    expect(results[0].title).toBe('Ultramarine');
    for (const c of results) expectContractShape(c);
    expect(results.some((c) => c.title.includes('(disambiguation)'))).toBe(false);
  });

  it('search honours exclude', async () => {
    const { source } = replayed();
    const [top] = await source.search('Ultramarine' as TopicKey, 5, none);
    const rest = await source.search('Ultramarine' as TopicKey, 5, new Set([top.canonicalUrl]));
    expect(rest).toHaveLength(5);
    expect(rest.map((c) => c.canonicalUrl)).not.toContain(top.canonicalUrl);
  });

  it('next follows the page’s own links in article order and never returns the page itself', async () => {
    const { source } = replayed();
    const [ultramarine] = await source.search('Ultramarine' as TopicKey, 5, none);
    const next = await source.next(ultramarine, 6, none);
    expect(next).toHaveLength(6);
    expect(next.slice(0, 3).map((c) => c.title)).toEqual(['Pigment', 'Blue', 'Lazurite']);
    expect(next.map((c) => c.title)).not.toContain('Ultramarine');
    for (const c of next) expectContractShape(c);
  });

  it('batches past the 20-extract limit, resolves redirects and drops duplicates', async () => {
    const { source, requests } = replayed();
    const found = await source.candidates(SAMPLE_BATCH);
    expect(found).toHaveLength(SAMPLE_BATCH.length - 1);
    expect(found.map((c) => c.title)).toContain('Color');
    expect(found.map((c) => c.title)).not.toContain('Colour');
    for (const c of found) expectContractShape(c);
    expect(requests.length, 'one continuation for extracts 21–26').toBe(2);
  });

  it('resolveTopic follows redirects and returns null for missing pages and disambiguations', async () => {
    const { source } = replayed();
    expect(await source.resolveTopic('colour')).toBe('Color');
    expect(await source.resolveTopic('Mercury')).toBeNull();
    expect(await source.resolveTopic('Nonexistentpagexyz123')).toBeNull();
    expect(await source.resolveTopic('   ')).toBeNull();
  });

  it('keeps biographical and maintenance categories out of topics, filtering before the cap of six', async () => {
    const categories = [
      '1926 births', '1991 deaths', 'African-American jazz musicians', 'All stub articles', 'American jazz bandleaders',
      'American jazz trumpeter stubs', 'Articles with short description', 'Burials at Woodlawn Cemetery (Bronx, New York)',
      'CS1 maint: archived copy as title', 'Commons category link is on Wikidata', 'Cool jazz trumpeters',
      'Coordinates on Wikidata', 'Hard bop trumpeters', 'Juilliard School alumni', 'Living people', 'Modal jazz trumpeters',
      'Pages using infobox musical artist', 'People from Alton, Illinois', 'Post-bop trumpeters',
      'Short description is different from Wikidata', 'Use mdy dates from May 2024', 'Webarchive template wayback links',
      'Wikipedia indefinitely semi-protected pages', 'Jazz fusion trumpeters',
    ];
    const page = {
      pageid: 50350,
      ns: 0,
      title: 'Miles Davis',
      canonicalurl: 'https://en.wikipedia.org/wiki/Miles_Davis',
      extract: 'Miles Dewey Davis III was an American trumpeter, bandleader, and composer.',
      categories: categories.map((c) => ({ ns: 14, title: `Category:${c}` })),
    };
    const source = new WikipediaSource({ minIntervalMs: 0, fetch: () => Promise.resolve(Response.json({ batchcomplete: true, query: { pages: [page] } })) });
    const [miles] = await source.candidates(['Miles Davis']);
    expect(miles.topics).toEqual([
      'Miles Davis',
      'African-American jazz musicians',
      'American jazz bandleaders',
      'Cool jazz trumpeters',
      'Hard bop trumpeters',
      'Modal jazz trumpeters',
      'Post-bop trumpeters',
    ]);
  });

  it('serendipity returns random real pages', async () => {
    const { source } = replayed();
    const random = await source.serendipity(4, 1, none);
    expect(random).toHaveLength(4);
    for (const c of random) expectContractShape(c);
  });

  it('identifies itself without contact details and asks for at most 50 titles at a time', async () => {
    const { source, requests } = replayed();
    const [top] = await source.search('Ultramarine' as TopicKey, 5, none);
    await source.next(top, 6, none);
    await source.candidates(SAMPLE_BATCH);
    for (const { params, userAgent } of requests) {
      expect(userAgent).toBe(USER_AGENT);
      expect(userAgent).not.toMatch(/@/);
      expect((params.get('titles') ?? '').split('|').length).toBeLessThanOrEqual(50);
      expect(params.get('redirects') === '1' || params.has('list')).toBe(true);
    }
  });
});
