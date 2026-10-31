import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Candidate, CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import { canonicalLink, FEEDS, parseRss, RssSource } from './rss';
import { urlOf } from './samples';

const none = new Set<CanonicalUrl>();
const recorded = new Map(FEEDS.map((f) => [f.url, readFileSync(new URL(`./samples/${new URL(f.url).hostname}.xml`, import.meta.url), 'utf8')]));

function feedFetch(down?: string): typeof fetch {
  return (input) => {
    const url = urlOf(input);
    if (url === down) return Promise.resolve(new Response('busy', { status: 503 }));
    const xml = recorded.get(url);
    return xml === undefined ? Promise.reject(new Error(`unexpected request ${url}`)) : Promise.resolve(new Response(xml));
  };
}

describe('canonicalLink', () => {
  it('forces https, lower-cases the host, and drops utm_* params and the fragment', () => {
    expect(canonicalLink('HTTP://WWW.Example.COM/Essay/a?utm_source=rss&id=2&UTM_Medium=feed#comments')).toBe('https://www.example.com/Essay/a?id=2');
    expect(canonicalLink('http://example.com/x?utm_campaign=z')).toBe('https://example.com/x');
    expect(canonicalLink(' https://example.com/q?a=b%20c ')).toBe('https://example.com/q?a=b%20c');
  });
});

describe('parseRss', () => {
  it('reads CDATA and entity-encoded items into plain text with canonical links', () => {
    const xml = `<rss><channel><title>Feed</title>
      <item><title><![CDATA[Indigo &amp; Woad
      ]]></title><link>http://Example.org/indigo?utm_source=rss#top</link>
      <description><![CDATA[<p><img src="https://img.example.org/woad.jpg" /> Blue from <b>leaves</b> &amp; vats.</p>
      <p>The post <a href="x">Indigo</a> appeared first on <a href="y">Daily</a>.</p>]]></description></item>
      <item><title>Frank &amp; Nancy&#8217;s Museum</title><link>https://example.org/museum</link>
      <description>&lt;p&gt;A small &lt;em&gt;museum&lt;/em&gt;.&lt;/p&gt;</description></item>
      <item><title>No link</title></item>
    </channel></rss>`;
    expect(parseRss(xml)).toEqual([
      {
        url: 'http://Example.org/indigo?utm_source=rss#top',
        link: 'https://example.org/indigo',
        title: 'Indigo & Woad',
        summary: 'Blue from leaves & vats.',
        thumb: 'https://img.example.org/woad.jpg',
      },
      { url: 'https://example.org/museum', link: 'https://example.org/museum', title: 'Frank & Nancy’s Museum', summary: 'A small museum.' },
    ]);
  });

  it('parses every recorded feed into clean items', () => {
    for (const [url, xml] of recorded) {
      const items = parseRss(xml);
      expect(items.length, url).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.link.startsWith('https://')).toBe(true);
        expect(item.link).not.toMatch(/#|utm_/i);
        expect(item.title).not.toMatch(/<|&amp;|CDATA/);
        expect(item.summary.length).toBeLessThanOrEqual(400);
        expect(item.summary).not.toMatch(/<|appeared first on/);
      }
    }
  });
});

describe('RssSource on recorded feeds', () => {
  const source = new RssSource({ fetch: feedFetch() });
  const titles = (cs: readonly Candidate[]) => cs.map((c) => c.title);

  it('search matches the topic label in an item’s title or summary', async () => {
    const [first] = parseRss(recorded.get(FEEDS[1].url) ?? '');
    const word = first.title.split(/[^\p{L}]+/u).sort((a, b) => b.length - a.length)[0];
    const results = await source.search(word as TopicKey, 10, none);
    expect(titles(results)).toContain(first.title);
    for (const c of results) {
      expect(`${c.title} ${c.summary}`.toLowerCase()).toContain(word.toLowerCase());
      expect(c.origin).toBe('rss');
      expect(c.topics[0]).toBe(word);
    }
    expect(await source.search(first.title as TopicKey, 10, new Set([canonicalLink(first.url)]))).toEqual([]);
  });

  it('next finds items that mention any of the page’s topics', async () => {
    const [first] = parseRss(recorded.get(FEEDS[0].url) ?? '');
    const word = first.title.split(/[^\p{L}]+/u).sort((a, b) => b.length - a.length)[0];
    const from: Candidate = { ...(await source.serendipity(1, 0, none))[0], topics: ['Nothing matches this' as TopicKey, word as TopicKey] };
    const next = await source.next(from, 10, none);
    expect(next.length).toBeGreaterThan(0);
    for (const c of next) expect(c.topics[0]).toBe(word);
  });

  it('serendipity is stable for a seed, differs across seeds, and honours exclude', async () => {
    const a = await source.serendipity(6, 1, none);
    expect(a).toHaveLength(6);
    expect(await source.serendipity(6, 1, none)).toEqual(a);
    expect(titles(await source.serendipity(6, 2, none))).not.toEqual(titles(a));
    const rest = await source.serendipity(6, 1, new Set([a[0].canonicalUrl]));
    expect(rest.map((c) => c.canonicalUrl)).not.toContain(a[0].canonicalUrl);
    for (const c of a) expect(FEEDS.map((f) => f.topic)).toContain(c.topics[0]);
  });

  it('keeps serving the other feeds when one is down', async () => {
    const partial = new RssSource({ fetch: feedFetch(FEEDS[0].url) });
    const items = await partial.serendipity(50, 1, none);
    expect(items.length).toBe(parseRss(recorded.get(FEEDS[1].url) ?? '').length + parseRss(recorded.get(FEEDS[2].url) ?? '').length);
    expect(items.some((c) => c.topics.includes(FEEDS[0].topic as TopicKey))).toBe(false);
  });

  it('has no topic namespace of its own', async () => {
    expect(await source.resolveTopic('Jazz')).toBeNull();
  });
});
