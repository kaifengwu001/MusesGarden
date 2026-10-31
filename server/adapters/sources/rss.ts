import { mix, salt } from '../../../src/core/hash';
import type { Candidate, CanonicalUrl, Source, TopicKey } from '../../../src/muse/contract';
import { clampSummary, mentions } from './text';
import { USER_AGENT } from './wikipedia';

export interface Feed {
  readonly url: string;
  /** The publication's canonical Wikipedia title, the topic of an item no interest matched. */
  readonly topic: string;
}

/** RSS 2.0 feeds checked live on 2026-10-31. */
export const FEEDS: readonly Feed[] = [
  { url: 'https://publicdomainreview.org/rss.xml', topic: 'The Public Domain Review' },
  { url: 'https://www.atlasobscura.com/feeds/latest', topic: 'Atlas Obscura' },
  { url: 'https://daily.jstor.org/feed/', topic: 'JSTOR' },
];

export interface FeedItem {
  readonly url: string;
  readonly link: CanonicalUrl;
  readonly title: string;
  readonly summary: string;
  readonly thumb?: string;
}

/** https, lowercase host, no `utm_*` params, no fragment. */
export function canonicalLink(raw: string): CanonicalUrl {
  const url = new URL(raw.trim());
  url.protocol = 'https:';
  url.hash = '';
  const tracking = [...url.searchParams.keys()].filter((k) => k.toLowerCase().startsWith('utm_'));
  for (const key of tracking) url.searchParams.delete(key);
  return url.toString() as CanonicalUrl;
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** An element's content as markup: CDATA unwrapped, or entities decoded once. */
function element(item: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(item);
  if (m === null) return undefined;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return cdata === null ? decode(m[1]) : cdata[1];
}

function plain(markup: string): string {
  return decode(markup.replace(/<[^>]*>/g, ' '))
    .replace(/The post .* appeared first on .*\.\s*$/s, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Items of an RSS 2.0 document, in feed order. Items without a title or link are dropped. */
export function parseRss(xml: string): FeedItem[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const title = plain(element(item, 'title') ?? '');
    const url = (element(item, 'link') ?? '').trim();
    if (title === '' || !URL.canParse(url)) return [];
    const description = element(item, 'description') ?? '';
    const thumb = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(`${description} ${element(item, 'content:encoded') ?? ''}`)?.[1];
    return [{ url, link: canonicalLink(url), title, summary: clampSummary(plain(description)), ...(thumb === undefined ? {} : { thumb }) }];
  });
}

interface Entry {
  readonly feed: Feed;
  readonly item: FeedItem;
}

/** Brands the feed's own topic: Feed.topic is a canonical title by construction (checked live). */
function toCandidate({ feed, item }: Entry, matched: readonly TopicKey[]): Candidate {
  return {
    origin: 'rss',
    url: item.url,
    canonicalUrl: item.link,
    title: item.title,
    summary: item.summary,
    ...(item.thumb === undefined ? {} : { thumb: item.thumb }),
    topics: [...new Set([...matched, feed.topic as TopicKey])],
  };
}

export interface RssOptions {
  readonly feeds?: readonly Feed[];
  readonly fetch?: typeof fetch;
  /** How long fetched feeds are reused before refetching. */
  readonly ttlMs?: number;
}

/**
 * A small live source over curated feeds. Items match by topic label in their title or summary. RSS has no topic
 * namespace, so resolveTopic always returns null: resolve labels through Wikipedia.
 */
export class RssSource implements Source {
  private readonly feeds: readonly Feed[];
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private cache: { readonly at: number; readonly entries: Promise<Entry[]> } | undefined;

  constructor(options: RssOptions = {}) {
    this.feeds = options.feeds ?? FEEDS;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  }

  async search(topic: TopicKey, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    return (await this.entries())
      .filter((e) => !exclude.has(e.item.link) && mentions(`${e.item.title} ${e.item.summary}`, topic))
      .slice(0, limit)
      .map((e) => toCandidate(e, [topic]));
  }

  async next(from: Candidate, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    return (await this.entries())
      .filter((e) => !exclude.has(e.item.link) && e.item.link !== from.canonicalUrl)
      .map((e) => ({ e, matched: from.topics.filter((t) => mentions(`${e.item.title} ${e.item.summary}`, t)) }))
      .filter(({ matched }) => matched.length > 0)
      .sort((a, b) => b.matched.length - a.matched.length)
      .slice(0, limit)
      .map(({ e, matched }) => toCandidate(e, matched));
  }

  async serendipity(limit: number, seed: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    return (await this.entries())
      .filter((e) => !exclude.has(e.item.link))
      .map((e) => ({ e, key: mix(salt(e.item.link), seed) }))
      .sort((a, b) => a.key - b.key)
      .slice(0, limit)
      .map(({ e }) => toCandidate(e, []));
  }

  resolveTopic(_label: string): Promise<TopicKey | null> {
    return Promise.resolve(null);
  }

  private entries(): Promise<Entry[]> {
    if (this.cache === undefined || Date.now() - this.cache.at > this.ttlMs) {
      this.cache = { at: Date.now(), entries: this.fetchAll() };
    }
    return this.cache.entries;
  }

  private async fetchAll(): Promise<Entry[]> {
    const settled = await Promise.allSettled(
      this.feeds.map(async (feed) => {
        const res = await this.fetchImpl(feed.url, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`${feed.url}: HTTP ${res.status}`);
        return parseRss(await res.text()).map((item) => ({ feed, item }));
      }),
    );
    const seen = new Set<CanonicalUrl>();
    return settled.flatMap((s) => {
      if (s.status === 'rejected') {
        console.warn(`rss: skipped a feed (${String(s.reason)})`);
        return [];
      }
      return s.value.filter((e) => {
        if (seen.has(e.item.link)) return false;
        seen.add(e.item.link);
        return true;
      });
    });
  }
}
