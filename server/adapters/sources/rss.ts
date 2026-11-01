// RSS 2.0 and Atom feeds: the items the media recorder reads from magazines, blogs and video channels.
import type { CanonicalUrl } from '../../../src/muse/contract';
import { clampSummary } from './text';

export interface FeedItem {
  readonly url: string;
  readonly link: CanonicalUrl;
  readonly title: string;
  readonly summary: string;
  readonly thumb?: string;
  /** ISO date. */
  readonly published?: string;
  readonly author?: string;
  /** Words in the item's full text, when the feed carries it. */
  readonly words?: number;
}

export interface Feed {
  /** The publication's own name. */
  readonly title: string;
  readonly items: readonly FeedItem[];
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

export function decode(s: string): string {
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

/** An attribute of the first `tag` element (self-closing or not) that has it. */
function attribute(item: string, tag: string, name: string, where: RegExp = /./): string | undefined {
  for (const m of item.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))) {
    if (!where.test(m[1])) continue;
    const value = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(m[1]);
    if (value !== null) return decode(value[1] ?? value[2]);
  }
  return undefined;
}

export function plain(markup: string): string {
  return decode(markup.replace(/<[^>]*>/g, ' '))
    .replace(/The post .* appeared first on .*\.\s*$/s, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

const IMAGE = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i;

function thumbOf(item: string, html: string): string | undefined {
  return (
    attribute(item, 'media:thumbnail', 'url') ??
    attribute(item, 'media:content', 'url', /medium="image"|type="image/i) ??
    attribute(item, 'media:content', 'url', IMAGE) ??
    attribute(item, 'enclosure', 'url', /type="image/i) ??
    /<img\b[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1]
  );
}

function linkOf(item: string): string {
  const rss = element(item, 'link')?.trim();
  if (rss !== undefined && rss !== '' && URL.canParse(rss)) return rss;
  return attribute(item, 'link', 'href', /rel="alternate"/i) ?? attribute(item, 'link', 'href', /^(?![^]*rel=)/) ?? '';
}

function parseItem(item: string): FeedItem | null {
  const title = plain(element(item, 'title') ?? '');
  const url = linkOf(item);
  if (title === '' || !URL.canParse(url)) return null;
  const full = element(item, 'content:encoded') ?? element(item, 'content') ?? '';
  const description = element(item, 'description') ?? element(item, 'summary') ?? element(item, 'media:description') ?? '';
  const summary = clampSummary(plain(description === '' ? full : description));
  const thumb = thumbOf(item, `${description} ${full}`);
  const published = isoDate(element(item, 'pubDate') ?? element(item, 'published') ?? element(item, 'updated') ?? element(item, 'dc:date'));
  const author = plain(element(item, 'dc:creator') ?? element(element(item, 'author') ?? '', 'name') ?? element(item, 'author') ?? '');
  const words = full === '' ? 0 : plain(full).split(' ').length;
  return {
    url,
    link: canonicalLink(url),
    title,
    summary,
    ...(thumb === undefined ? {} : { thumb }),
    ...(published === undefined ? {} : { published }),
    ...(author === '' ? {} : { author }),
    ...(words > 0 ? { words } : {}),
  };
}

/** An RSS 2.0 or Atom document, items in feed order. Items without a title or link are dropped. */
export function parseFeed(xml: string): Feed {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)];
  const head = xml.slice(0, blocks[0]?.index ?? xml.length);
  return {
    title: plain(element(head, 'title') ?? ''),
    items: blocks.flatMap(([, , body]) => parseItem(body) ?? []),
  };
}
