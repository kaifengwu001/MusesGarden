// What the media recorder reads from each network with no key: magazine and blog feeds, YouTube channel pages,
// Vimeo channel feeds, Flickr tag feeds and Bluesky accounts. Each reader returns items whose links answered.
import { createHash } from 'node:crypto';
import { arr, obj, optStr, str } from './json';
import { captionTitle } from './instagram';
import type { RawItem } from './media';
import { canonicalLink, decode, parseFeed, plain, type FeedItem } from './rss';
import { clampSummary } from './text';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 20_000;
const PAGE_MAX = 1_500_000;
const WORDS_PER_MINUTE = 230;

export interface Fetched {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
}

/** A GET that reads at most `maxBytes`, or stops once `until` has been read. Never throws: a failure is status 0. */
export async function getText(url: string, maxBytes = PAGE_MAX, until?: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= maxBytes || (until !== undefined && text.includes(until))) {
        await reader.cancel();
        break;
      }
    }
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: '' };
  }
}

async function getJson(url: string): Promise<unknown> {
  const r = await getText(url, 20_000_000);
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return JSON.parse(r.text);
}

/** Every reader states what it tried, so the recorder can report each source and each link. */
export interface Read {
  readonly items: readonly RawItem[];
  /** Item links that did not answer. */
  readonly dead: readonly string[];
}

const words = (text: string) => (text.match(/\p{L}+/gu) ?? []).length;
const minutesFor = (count: number) => Math.max(1, Math.round(count / WORDS_PER_MINUTE));

// ─── Article pages ──────────────────────────────────────────────────────────

export interface Preview {
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly aspect?: number;
  readonly site?: string;
  readonly author?: string;
  readonly published?: string;
  /** Words in the page's paragraphs. */
  readonly words: number;
}

function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== key) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content === null ? undefined : decode(content[1] ?? content[2]).trim();
    if (value) return value;
  }
  return undefined;
}

/** A page's preview tags (Open Graph and friends) and how much there is to read. */
export function parsePreview(html: string, base: string): Preview {
  const abs = (u: string | undefined) => (u === undefined || !URL.canParse(u, base) ? undefined : new URL(u, base).toString());
  const width = Number(meta(html, 'og:image:width'));
  const height = Number(meta(html, 'og:image:height'));
  const body = /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1])).join(' ');
  const date = meta(html, 'article:published_time') ?? meta(html, 'datepublished') ?? meta(html, 'date');
  const out = {
    title: meta(html, 'og:title'),
    description: meta(html, 'og:description') ?? meta(html, 'description'),
    image: abs(meta(html, 'og:image') ?? meta(html, 'og:image:secure_url') ?? meta(html, 'twitter:image')),
    aspect: width > 0 && height > 0 ? width / height : undefined,
    site: meta(html, 'og:site_name'),
    author: meta(html, 'author') ?? meta(html, 'article:author'),
    published: date !== undefined && !Number.isNaN(Date.parse(date)) ? new Date(Date.parse(date)).toISOString().slice(0, 10) : undefined,
    words: words(paragraphs),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as unknown as Preview;
}

const webId = (canonical: string) => `web-${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
const https = (u: string | undefined) => (u !== undefined && u.startsWith('https://') ? u : undefined);

/** An article whose page answered, read from the page's preview tags where its listing says less. */
async function article(item: FeedItem, siteName: string): Promise<RawItem | null> {
  const page = await getText(item.url);
  if (!page.ok) return null;
  const p = parsePreview(page.text, item.url);
  const text = item.summary !== '' ? item.summary : clampSummary(p.description ?? '');
  const image = https(item.thumb) ?? https(p.image);
  const author = item.author ?? (p.author !== undefined && !p.author.startsWith('http') ? p.author : undefined);
  const site = p.site ?? siteName;
  const published = item.published ?? p.published;
  return {
    id: webId(item.link),
    kind: 'article',
    network: 'web',
    url: item.link,
    title: item.title,
    text,
    ...(author === undefined ? {} : { author }),
    ...(site === '' ? {} : { site }),
    ...(image === undefined ? {} : { image }),
    ...(image !== undefined && p.aspect !== undefined && image === https(p.image) ? { aspect: round(p.aspect) } : {}),
    minutes: minutesFor(Math.max(item.words ?? 0, p.words)),
    ...(published === undefined ? {} : { published }),
  };
}

async function articles(listed: readonly FeedItem[], siteName: (item: FeedItem) => string): Promise<Read> {
  const items: RawItem[] = [];
  const dead: string[] = [];
  for (const item of listed) {
    const read = await article(item, siteName(item));
    if (read === null) dead.push(item.url);
    else items.push(read);
  }
  return { items, dead };
}

export async function readArticles(feedUrl: string, limit: number): Promise<Read> {
  const feed = await getText(feedUrl, 20_000_000);
  if (!feed.ok) throw new Error(`feed answered ${feed.status}`);
  const parsed = parseFeed(feed.text);
  return articles(parsed.items.slice(0, limit), () => parsed.title);
}

const round = (x: number) => Math.round(x * 1000) / 1000;

// ─── YouTube ────────────────────────────────────────────────────────────────

export interface ChannelEntry {
  readonly id: string;
  readonly title: string;
  readonly duration?: number;
}

function initialData(html: string): unknown {
  const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html);
  if (m === null) throw new Error('no ytInitialData on the page');
  return JSON.parse(m[1]);
}

function walk(node: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) for (const v of node) walk(v, visit);
  else if (typeof node === 'object' && node !== null) {
    const o = node as Record<string, unknown>;
    visit(o);
    for (const v of Object.values(o)) walk(v, visit);
  }
}

/** "1:02:03" or "34:28" in seconds. */
export function clockSeconds(text: string): number | undefined {
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(text)) return undefined;
  return text.split(':').reduce((s, part) => s * 60 + Number(part), 0);
}

const dig = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, k) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined), o);

/** A channel's /videos page: its newest long videos, with their lengths. */
export function parseChannelVideos(html: string): ChannelEntry[] {
  const out: ChannelEntry[] = [];
  walk(initialData(html), (o) => {
    const lockup = o.lockupViewModel;
    if (typeof lockup !== 'object' || lockup === null || dig(lockup, 'contentType') !== 'LOCKUP_CONTENT_TYPE_VIDEO') return;
    const id = dig(lockup, 'contentId');
    const title = dig(lockup, 'metadata', 'lockupMetadataViewModel', 'title', 'content');
    if (typeof id !== 'string' || typeof title !== 'string') return;
    let duration: number | undefined;
    walk(dig(lockup, 'contentImage'), (b) => {
      const text = dig(b, 'thumbnailBadgeViewModel', 'text');
      if (duration === undefined && typeof text === 'string') duration = clockSeconds(text);
    });
    out.push({ id, title, ...(duration === undefined ? {} : { duration }) });
  });
  return out;
}

/** A channel's /shorts page: its newest Shorts. */
export function parseChannelShorts(html: string): ChannelEntry[] {
  const out: ChannelEntry[] = [];
  walk(initialData(html), (o) => {
    const lockup = o.shortsLockupViewModel;
    if (typeof lockup !== 'object' || lockup === null) return;
    const id = dig(lockup, 'onTap', 'innertubeCommand', 'reelWatchEndpoint', 'videoId');
    const title = dig(lockup, 'overlayMetadata', 'primaryText', 'content');
    if (typeof id === 'string' && typeof title === 'string') out.push({ id, title });
  });
  return out;
}

/** What a watch page says beyond the listing: the description, the length and the day it was published. */
export function parseWatchPage(html: string): { description?: string; duration?: number; published?: string } {
  const quoted = (key: string) => {
    const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
    return m === null ? undefined : (JSON.parse(`"${m[1]}"`) as string);
  };
  const seconds = Number(quoted('lengthSeconds'));
  const date = quoted('publishDate') ?? meta(html, 'datepublished');
  const description = quoted('shortDescription');
  return {
    ...(description ? { description } : {}),
    ...(seconds > 0 ? { duration: seconds } : {}),
    ...(date !== undefined && !Number.isNaN(Date.parse(date)) ? { published: new Date(Date.parse(date)).toISOString().slice(0, 10) } : {}),
  };
}

/** What an earlier recording read from a watch page, so a re-recording needn't ask YouTube again. */
export type WatchDetails = ReturnType<typeof parseWatchPage>;

/** YouTube answers 429 to a burst of watch pages; after the first, the rest of the run leaves descriptions out. */
let watchPagesRefused = false;

async function watchDetails(id: string, known: WatchDetails | undefined): Promise<WatchDetails> {
  if (known?.description !== undefined || watchPagesRefused) return known ?? {};
  const page = await getText(`https://www.youtube.com/watch?v=${id}`, 2_000_000, '"publishDate"');
  if (page.status === 429) watchPagesRefused = true;
  return page.ok ? parseWatchPage(page.text) : {};
}

async function youtubeItem(entry: ChannelEntry, short: boolean, known: WatchDetails | undefined): Promise<RawItem | null> {
  const url = short ? `https://www.youtube.com/shorts/${entry.id}` : `https://www.youtube.com/watch?v=${entry.id}`;
  const embed = await getText(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, 100_000);
  if (!embed.ok) return null;
  const o = obj(JSON.parse(embed.text), 'oembed');
  const watch = await watchDetails(entry.id, known);
  const duration = entry.duration ?? watch.duration;
  const author = optStr(o.author_name, 'author_name');
  const image = optStr(o.thumbnail_url, 'thumbnail_url');
  return {
    id: `yt-${entry.id}`,
    kind: short ? 'reel' : 'video',
    network: 'youtube',
    url,
    title: optStr(o.title, 'title') ?? entry.title,
    text: clampSummary(watch.description ?? ''),
    ...(author === undefined ? {} : { author }),
    site: 'YouTube',
    ...(image === undefined ? {} : { image }),
    aspect: short ? round(9 / 16) : round(16 / 9),
    ...(duration === undefined ? {} : { duration }),
    ...(watch.published === undefined ? {} : { published: watch.published }),
  };
}

/** A channel or search page, asked for twice when the first answer comes without its data (a consent page). */
async function youtubePage(url: string): Promise<Fetched> {
  const first = await getText(url, 20_000_000);
  return first.ok && !first.text.includes('ytInitialData') ? getText(url, 20_000_000) : first;
}

export async function readYoutube(
  handle: string,
  limits: { readonly videos: number; readonly shorts: number },
  known: ReadonlyMap<string, WatchDetails> = new Map(),
): Promise<Read> {
  const base = `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`;
  const videosPage = await youtubePage(`${base}/videos`);
  if (!videosPage.ok) throw new Error(`channel answered ${videosPage.status}`);
  const shortsPage = await youtubePage(`${base}/shorts`);
  const listed = [
    ...parseChannelVideos(videosPage.text).slice(0, limits.videos).map((e) => ({ e, short: false })),
    ...(shortsPage.ok ? parseChannelShorts(shortsPage.text).slice(0, limits.shorts).map((e) => ({ e, short: true })) : []),
  ];
  const items: RawItem[] = [];
  const dead: string[] = [];
  for (const { e, short } of listed) {
    const item = await youtubeItem(e, short, known.get(`yt-${e.id}`));
    if (item === null) dead.push(`https://www.youtube.com/watch?v=${e.id}`);
    else items.push(item);
  }
  return { items, dead };
}

/** YouTube's search results: long videos with a line of their description, and Shorts. */
export function parseSearchResults(html: string): { readonly videos: (ChannelEntry & { readonly snippet?: string })[]; readonly shorts: ChannelEntry[] } {
  const videos: (ChannelEntry & { snippet?: string })[] = [];
  walk(initialData(html), (o) => {
    const v = o.videoRenderer;
    const id = dig(v, 'videoId');
    const title = dig(v, 'title', 'runs', '0', 'text');
    if (typeof id !== 'string' || typeof title !== 'string') return;
    const length = dig(v, 'lengthText', 'simpleText');
    const duration = typeof length === 'string' ? clockSeconds(length) : undefined;
    const runs = dig(v, 'detailedMetadataSnippets', '0', 'snippetText', 'runs');
    const snippet = Array.isArray(runs) ? runs.map((r) => dig(r, 'text')).filter((t) => typeof t === 'string').join('').trim() : '';
    videos.push({ id, title, ...(duration === undefined ? {} : { duration }), ...(snippet === '' ? {} : { snippet }) });
  });
  return { videos, shorts: parseChannelShorts(html) };
}

export async function searchYoutube(query: string, limits: { readonly videos: number; readonly shorts: number }): Promise<Read> {
  const page = await youtubePage(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  if (!page.ok) throw new Error(`search answered ${page.status}`);
  const found = parseSearchResults(page.text);
  const listed = [
    ...found.videos.slice(0, limits.videos).map((e) => ({ e, short: false, known: e.snippet === undefined ? undefined : { description: e.snippet } })),
    ...found.shorts.slice(0, limits.shorts).map((e) => ({ e, short: true, known: { description: '' } })),
  ];
  const items: RawItem[] = [];
  const dead: string[] = [];
  for (const { e, short, known } of listed) {
    const item = await youtubeItem(e, short, known);
    if (item === null) dead.push(`https://www.youtube.com/watch?v=${e.id}`);
    else items.push(item);
  }
  return { items, dead };
}

// ─── Vimeo ──────────────────────────────────────────────────────────────────

export async function readVimeo(feedUrl: string, limit: number): Promise<Read> {
  const feed = await getText(feedUrl, 20_000_000);
  if (!feed.ok) throw new Error(`feed answered ${feed.status}`);
  const ids = parseFeed(feed.text).items.flatMap((i) => /vimeo\.com\/(?:.*\/)?(\d+)\/?$/.exec(i.url)?.[1] ?? []);
  const items: RawItem[] = [];
  const dead: string[] = [];
  for (const id of [...new Set(ids)].slice(0, limit)) {
    const url = `https://vimeo.com/${id}`;
    const embed = await getText(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`, 200_000);
    if (!embed.ok) {
      dead.push(url);
      continue;
    }
    const o = obj(JSON.parse(embed.text), 'oembed');
    const width = Number(o.width);
    const height = Number(o.height);
    const duration = Number(o.duration);
    const image = optStr(o.thumbnail_url, 'thumbnail_url');
    const author = optStr(o.author_name, 'author_name');
    const date = optStr(o.upload_date, 'upload_date');
    items.push({
      id: `vimeo-${id}`,
      kind: height > width ? 'reel' : 'video',
      network: 'vimeo',
      url,
      title: str(o.title, 'title'),
      text: clampSummary(plain(optStr(o.description, 'description') ?? '')),
      ...(author === undefined ? {} : { author }),
      site: 'Vimeo',
      ...(image === undefined ? {} : { image }),
      ...(width > 0 && height > 0 ? { aspect: round(width / height) } : {}),
      ...(duration > 0 ? { duration } : {}),
      ...(date === undefined ? {} : { published: date.slice(0, 10) }),
    });
  }
  return { items, dead };
}

// ─── Flickr ─────────────────────────────────────────────────────────────────

/** A title a camera gave rather than a person (IMG_1234, DSC01234, P1010101): no word left once file names go. */
const named = (title: string) => /\p{L}{3,}/u.test(title.replace(/(?:img|dsc[fn]?|pxl|gopr|dji|_mg|p)[_-]?\d+/gi, ''));

export function parseFlickr(json: unknown): (RawItem & { readonly page: string })[] {
  return arr(obj(json, 'flickr').items, 'flickr.items').flatMap((raw, i) => {
    const o = obj(raw, `items[${i}]`);
    const link = str(o.link, 'link');
    const id = /\/photos\/[^/]+\/(\d+)/.exec(link)?.[1];
    const title = plain(str(o.title, 'title'));
    const image = str(obj(o.media, 'media').m, 'media.m').replace(/_m\.(jpg|png)$/, '_b.$1');
    if (id === undefined || !named(title)) return [];
    const description = str(o.description, 'description');
    const size = /width="(\d+)"\s+height="(\d+)"/.exec(description);
    const text = clampSummary(plain(description.replace(/^\s*<p>.*?posted a photo:<\/p>/s, '').replace(/<a\b[\s\S]*?<\/a>/i, '')));
    const author = /\("([^"]+)"\)/.exec(str(o.author, 'author'))?.[1];
    const published = optStr(o.published, 'published');
    return [
      {
        id: `flickr-${id}`,
        kind: 'post' as const,
        network: 'flickr' as const,
        url: link.startsWith('https://') ? link : link.replace(/^http:/, 'https:'),
        title,
        text,
        ...(author === undefined ? {} : { author }),
        site: 'Flickr',
        image,
        ...(size === null ? {} : { aspect: round(Number(size[1]) / Number(size[2])) }),
        ...(published === undefined ? {} : { published: published.slice(0, 10) }),
        tags: str(o.tags, 'tags').split(/\s+/).filter(Boolean),
        page: link,
      },
    ];
  });
}

export async function readFlickr(tags: string, limit: number): Promise<Read> {
  const json = await getJson(`https://www.flickr.com/services/feeds/photos_public.gne?tags=${encodeURIComponent(tags)}&tagmode=all&format=json&nojsoncallback=1`);
  const items: RawItem[] = [];
  const dead: string[] = [];
  for (const { page, ...item } of parseFlickr(json).slice(0, limit)) {
    if ((await getText(page, 300_000)).ok) items.push(item);
    else dead.push(page);
  }
  return { items, dead };
}

// ─── Bluesky ────────────────────────────────────────────────────────────────

const BSKY_TEXT_MIN = 12;
/** Pictures their posters say a model made: not something a person found or made. */
const GENERATED = /#ai(?:art|generated|image)\b|\bmidjourney\b|stable ?diffusion|\bai[- ]generated\b/i;

/** Posts with a picture and something to say, unlabelled by moderation; `handle` keeps only that account's own. */
export function parseBlueskyPosts(posts: readonly unknown[], handle: string | null): (RawItem & { readonly uri: string })[] {
  return posts.flatMap((raw, i) => {
    const post = obj(raw, `posts[${i}]`);
    const author = obj(post.author, 'post.author');
    const by = str(author.handle, 'author.handle');
    const labelled = [post.labels, author.labels].some((l) => Array.isArray(l) && l.length > 0);
    if ((handle !== null && by !== handle) || labelled) return [];
    const record = obj(post.record, 'post.record');
    if (!Array.isArray(record.langs) || !record.langs.includes('en')) return [];
    const text = (optStr(record.text, 'record.text') ?? '').trim();
    const embed = post.embed === undefined ? undefined : obj(post.embed, 'post.embed');
    const media = embed !== undefined && embed.media !== undefined ? obj(embed.media, 'embed.media') : embed;
    const type = media === undefined ? '' : (optStr(media.$type, '$type') ?? '');
    const image = type.startsWith('app.bsky.embed.images') ? obj(arr(media?.images, 'images')[0], 'images[0]') : undefined;
    const video = type.startsWith('app.bsky.embed.video') ? media : undefined;
    const picture = image !== undefined ? optStr(image.thumb, 'thumb') : video !== undefined ? optStr(video.thumbnail, 'thumbnail') : undefined;
    if (picture === undefined || text.length < BSKY_TEXT_MIN || GENERATED.test(text)) return [];
    const ratio = (image ?? video)?.aspectRatio;
    const aspect = ratio === undefined ? undefined : Number(obj(ratio, 'aspectRatio').width) / Number(obj(ratio, 'aspectRatio').height);
    const uri = str(post.uri, 'post.uri');
    const rkey = uri.split('/').pop() ?? '';
    const kind = video === undefined ? 'post' : aspect !== undefined && aspect < 1 ? 'reel' : 'video';
    const created = optStr(record.createdAt, 'record.createdAt');
    return [
      {
        id: `bsky-${rkey}`,
        kind,
        network: 'bluesky' as const,
        url: `https://bsky.app/profile/${by}/post/${rkey}`,
        title: captionTitle(text, `@${by}`),
        text: clampSummary(text),
        author: `@${by}`,
        site: 'Bluesky',
        image: picture,
        ...(aspect === undefined || !Number.isFinite(aspect) ? {} : { aspect: round(aspect) }),
        ...(created === undefined ? {} : { published: created.slice(0, 10) }),
        tags: [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((t) => t[1]),
        uri,
      },
    ];
  });
}

/**
 * The posts that still answer, by asking Bluesky's public API for them (25 at a time). Its web pages allow only 300
 * requests in five minutes, too few to check a recording's worth of links.
 */
async function liveBluesky(items: readonly (RawItem & { readonly uri: string })[]): Promise<Read> {
  const live = new Set<string>();
  for (let i = 0; i < items.length; i += 25) {
    const query = items.slice(i, i + 25).map((p) => `uris=${encodeURIComponent(p.uri)}`).join('&');
    const json = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${query}`);
    for (const p of arr(obj(json, 'posts').posts, 'posts.posts')) live.add(str(obj(p, 'post').uri, 'post.uri'));
  }
  return {
    items: items.filter((p) => live.has(p.uri)).map(({ uri: _, ...item }) => item),
    dead: items.filter((p) => !live.has(p.uri)).map((p) => p.url),
  };
}

/** An account's own posts: its feed without reposts. */
export function parseBluesky(json: unknown, handle: string): (RawItem & { readonly uri: string })[] {
  const own = arr(obj(json, 'feed').feed, 'feed.feed').flatMap((f, i) => (obj(f, `feed[${i}]`).reason === undefined ? [obj(f, `feed[${i}]`).post] : []));
  return parseBlueskyPosts(own, handle);
}

export async function readBluesky(handle: string, limit: number): Promise<Read> {
  const json = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=50&filter=posts_with_media`);
  return liveBluesky(parseBluesky(json, handle).slice(0, limit));
}

/** Hosts whose links are reels, posts or videos rather than articles. */
const NOT_ARTICLES = /(?:^|\.)(?:youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com|bsky\.app|threads\.net|vimeo\.com|flickr\.com|spotify\.com|apple\.com)$/;

/** The articles that unlabelled English posts link to, as their link cards show them. */
export function parseLinkedArticles(posts: readonly unknown[]): FeedItem[] {
  return posts.flatMap((raw, i) => {
    const post = obj(raw, `posts[${i}]`);
    const record = obj(post.record, 'post.record');
    const labelled = [post.labels, obj(post.author, 'post.author').labels].some((l) => Array.isArray(l) && l.length > 0);
    const embed = post.embed === undefined ? undefined : obj(post.embed, 'post.embed');
    if (labelled || !Array.isArray(record.langs) || !record.langs.includes('en') || embed?.external === undefined) return [];
    const card = obj(embed.external, 'embed.external');
    const url = str(card.uri, 'external.uri');
    const title = plain(optStr(card.title, 'external.title') ?? '');
    if (!url.startsWith('https://') || !URL.canParse(url) || NOT_ARTICLES.test(new URL(url).hostname) || title === '') return [];
    const thumb = optStr(card.thumb, 'external.thumb');
    return [{ url, link: canonicalLink(url), title, summary: clampSummary(plain(optStr(card.description, 'external.description') ?? '')), ...(thumb === undefined ? {} : { thumb }) }];
  });
}

/**
 * Posts anyone made that name `query`, the most engaged first, and the articles such posts link to: what fills a
 * topic the curated sources missed.
 */
export async function searchBluesky(query: string, limit: number): Promise<Read> {
  const json = await getJson(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&sort=top&limit=50`);
  const found = arr(obj(json, 'search').posts, 'search.posts');
  const posts = await liveBluesky(parseBlueskyPosts(found, null).slice(0, limit));
  const linked = await articles(parseLinkedArticles(found).slice(0, limit), (i) => new URL(i.url).hostname.replace(/^www\./, ''));
  return { items: [...posts.items, ...linked.items], dead: [...posts.dead, ...linked.dead] };
}
