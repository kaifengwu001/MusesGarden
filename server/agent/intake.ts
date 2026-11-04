// Intake: opens each link a real Muse kept, logged out, before the garden plants it. A link that needs a login, won't
// open in time or shows nothing the garden can read is refused with a reason Muse can act on. One that opens becomes a
// Candidate, its MediaInfo filled as the media recorder fills it (server/cli/record-media.ts), filed under the topic map.
//
// Pages are read from their preview tags (Open Graph and friends). YouTube, Vimeo and TikTok answer through their public
// oEmbed. Instagram and Facebook answer only through the Graph API with the garden's token: oEmbed first, and for
// Instagram, while Meta hasn't approved the garden's app for oEmbed, the account's own feed (Business Discovery, as the
// recorder reads it) when the link names the account.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { Candidate, CanonicalUrl, Intake, IntakeOutcome, MediaInfo, MediaKind, Network, TopicKey } from '../../src/muse/contract';
import { FixtureSource, loadCorpus, type Corpus } from '../adapters/sources/corpus';
import { fileUnder as fileByNames, topicIndex } from '../adapters/sources/filing';
import { captionTitle, InstagramReader } from '../adapters/sources/instagram';
import { obj, optStr } from '../adapters/sources/json';
import { EXPIRING, siteOf, type RawItem } from '../adapters/sources/media';
import { parsePreview, parseWatchPage, type WatchDetails } from '../adapters/sources/readers';
import { canonicalLink, decode, plain } from '../adapters/sources/rss';
import { clampSummary, hasWords } from '../adapters/sources/text';

/** How long one link may take to open and read. */
export const LINK_TIMEOUT_MS = 8_000;
/** How long one report's links may take together. */
export const REPORT_TIMEOUT_MS = 30_000;
/** Links opened at once. */
export const AT_ONCE = 6;
/** What is read of a page at most; the preview tags are in its head. */
export const PAGE_MAX_BYTES = 1_000_000;
/** A YouTube watch page carries its description, length and date about 1–2 MB in. */
const WATCH_MAX_BYTES = 2_000_000;
/** The watch page is a nicety: it gets at most this much of a link's time. */
const WATCH_TIMEOUT_MS = 4_000;
const REDIRECTS_MAX = 5;
/** Posts of an account looked through for the one Muse kept (Business Discovery gives the newest first). */
export const INSTAGRAM_LOOK = 100;
const TOPICS_MAX = 6;
const TITLE_MAX = 200;
const WORDS_PER_MINUTE = 230;
const GRAPH = 'https://graph.facebook.com/v21.0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.8' };

// ─── What Muse reads back ───────────────────────────────────────────────────

export const REASONS = {
  notALink: "that isn't a web link; send the whole address, starting with https://",
  private: "that link points inside a private network, which the garden won't open",
  login: 'the page needs a login to see',
  tooManyRedirects: 'the link redirected too many times',
  notFound: (status: number) => `the page wasn't found (${status}); check the link`,
  busy: 'the site is turning the garden away right now (429); try the link again later',
  serverError: (status: number) => `the site answered ${status}; try the link again later`,
  status: (status: number) => `the site answered ${status}, not the page`,
  picture: "it's a picture file, not a page; keep the page it's on",
  file: (type: string) => `it's a file (${type}), not a page; keep the page it's on`,
  nothing: 'the page shows nothing the garden can read without a login or a browser',
  unreadable: "the garden couldn't read the site's answer; try another link",
  timedOut: (ms: number) => `the link didn't open in ${seconds(ms)}`,
  outOfTime: (ms: number) => `the garden ran out of time for this report (${seconds(ms)}); report this link again`,
  cancelled: 'the report was cancelled before this link was read',
  noSite: "the site couldn't be found; check the link",
  noAnswer: "the site didn't answer; check the link",
  noTopic: "the garden couldn't tell what it's about; say which thread you were on",
  youtubeOther: 'keep a single YouTube video or Short, not a channel, playlist or search',
  youtubePrivate: "the video is private or can't be shown outside YouTube",
  youtubeMissing: 'YouTube has no public video at that link',
  instagramToken: "Instagram links need the garden's Instagram token",
  instagramOther: 'keep a single Instagram post or reel, not a profile, story or search',
  instagramNoAccount:
    "Instagram shows the garden a post only through its account's own page; send the link with the account's name in it, like instagram.com/<account>/reel/<code>/",
  instagramNotFound: (user: string) =>
    `the garden couldn't find that post among @${user}'s latest ${INSTAGRAM_LOOK}; Instagram lets it read only public business and creator accounts`,
  instagramAccount: (user: string) => `Instagram wouldn't show @${user}'s posts to the garden; it can read only public business and creator accounts`,
  instagramGone: "Instagram wouldn't show that post logged out; it may be private or gone",
  facebookToken: "Facebook links need the garden's Meta token",
  facebookClosed: "Facebook won't show posts to the garden yet (its embed access isn't approved); keep a link from another site",
  facebookGone: "Facebook wouldn't show that post logged out; it may be private or gone",
  metaToken: "Meta refused the garden's token; the owner needs to renew it",
  metaBusy: 'Meta is limiting the garden right now; try the link again later',
  videoPrivate: 'the video is private or gone',
  videoMissing: 'there is no public video at that link',
} as const;

function seconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${(ms / 1000).toFixed(1)} s`;
}

// ─── Options ────────────────────────────────────────────────────────────────

/** Files an item under topics of the topic map by its own words, best first; `near` are the topics Muse was on. */
export type FileUnder = (item: { readonly title: string; readonly text: string; readonly tags?: readonly string[] }, near: readonly TopicKey[]) => readonly TopicKey[];

export interface IntakeOptions {
  /** A free-text label to its topic of the topic map, or null (Source.resolveTopic). */
  readonly resolveTopic: (label: string) => Promise<TopicKey | null>;
  /** The recorder's filing; without it, a page's own tags are resolved one by one. */
  readonly fileUnder?: FileUnder;
  /** META_IG_TOKEN: Instagram and Facebook links need it. */
  readonly igToken?: string;
  /** META_IG_USER_ID: the token's own Instagram account, found through its Facebook Page when absent. */
  readonly igUserId?: string;
  readonly fetch?: typeof fetch;
  /** The wall clock, for the report's time budget. */
  readonly now?: () => number;
  readonly linkTimeoutMs?: number;
  readonly reportTimeoutMs?: number;
  /** Lets intake open links on this machine and private networks. Tests only: Muse's links are anyone's. */
  readonly openPrivate?: boolean;
  /**
   * Where a picture whose link expires (Instagram, Facebook, TikTok) is shown from, given the find's media id and the
   * picture's own link: the garden's cache route (/api/media/<id>) once the server keeps it. Without it, the link itself.
   */
  readonly keepPicture?: (id: string, source: string) => string;
}

// ─── The parts of a link ────────────────────────────────────────────────────

/** A link read, before it is filed under topics. */
interface Read {
  readonly url: string;
  readonly canonicalUrl: CanonicalUrl;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly media: MediaInfo;
}

/** A refusal Muse reads as it is. */
class Refusal extends Error {}
const refuse = (reason: string): never => {
  throw new Refusal(reason);
};

/** A Graph API error, its message cleared of the token. */
class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const https = (u: string | undefined) => (u !== undefined && u.startsWith('https://') ? u : undefined);
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : typeof v === 'string' && Number(v) > 0 ? Number(v) : undefined);
const bareHost = (u: URL) => u.hostname.toLowerCase().replace(/^(?:www|m|mobile|web)\./, '');

/** MediaInfo without the fields nobody gave. */
function mediaOf(m: Pick<MediaInfo, 'kind' | 'network'> & Partial<MediaInfo>): MediaInfo {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== '')) as unknown as MediaInfo;
}

/** A title of at most TITLE_MAX characters, cut at a word. */
function clampTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim();
  if (flat.length <= TITLE_MAX) return flat;
  const cut = flat.slice(0, TITLE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), TITLE_MAX / 2)).trim()}…`;
}

/** Query parameters that only say who sent the reader, as networks and newsletters add them. */
const TRACKING = /^(?:utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igsh|igshid|_hsenc|_hsmi|mkt_tok|ref_src|ref_url|si|share_id|mibextid)$/i;

/** canonicalLink, and without the tracking parameters networks add to shared links. */
function canonicalOf(raw: string): CanonicalUrl {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return canonicalLink(url.toString());
}

// ─── Login walls ────────────────────────────────────────────────────────────

/** A login page's own address: its host or its path says so. */
export function isLoginUrl(u: URL): boolean {
  const host = bareHost(u);
  const path = u.pathname.toLowerCase();
  if (/^(?:accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com|(?:login|signin|auth|sso|id)\.[^.]+\.[^.]+.*)$/.test(host)) return true;
  if (/(?:^|\.)instagram\.com$/.test(host) && /^\/(?:accounts\/login|challenge)(?:\/|$)/.test(path)) return true;
  if (/(?:^|\.)facebook\.com$/.test(host) && /^\/(?:login|login\.php|checkpoint)(?:\/|$)/.test(path)) return true;
  return /(?:^|\/)(?:log-?in|sign-?in|log_in|sign_in|signin|session\/new|sessions\/new|i\/flow\/login)(?:\.php|\.aspx?|\.html?)?(?:\/|$)/.test(path);
}

/** A login form on a page that isn't an article or a video: a short title naming a login, or a password field. */
function isLoginPage(scan: Scan): boolean {
  const type = scan.meta('og:type') ?? '';
  if (/^(?:article|video)/.test(type)) return false;
  const title = scan.title ?? scan.meta('og:title') ?? '';
  const named = /\b(?:log ?in|sign ?in|login)\b/i.test(title) && title.split(/\s+/).length <= 6;
  return named || (scan.password && scan.meta('og:description') === undefined);
}

// ─── Private networks ───────────────────────────────────────────────────────

const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined) return PRIVATE.check(mapped, 'ipv4');
  return PRIVATE.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/** Rejects once `signal` aborts, whatever `p` is doing. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passes the original failure on
        reject(e);
      },
    );
  });
}

async function assertPublic(u: URL, signal: AbortSignal): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(?:localhost|local|internal|home\.arpa)$/.test(host)) refuse(REASONS.private);
  const addresses = isIP(host) !== 0 ? [host] : (await raceAbort(lookup(host, { all: true, verbatim: true }), signal)).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) refuse(REASONS.private);
}

// ─── A page's preview tags ──────────────────────────────────────────────────

interface Scan {
  meta(key: string): string | undefined;
  metas(key: string): readonly string[];
  readonly title?: string;
  readonly canonical?: string;
  readonly password: boolean;
  /** The first paragraphs' plain text, for a page with no description. */
  readonly lead: string;
}

/** A page's meta tags, title and canonical link, in one pass over its tags. Regular expressions only; nothing runs. */
export function scanPage(html: string): Scan {
  const metas = new Map<string, string[]>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content === null ? '' : decode(content[1] ?? content[2]).trim();
    if (key !== undefined && value !== '') metas.set(key, [...(metas.get(key) ?? []), value]);
  }
  const headEnd = html.search(/<\/head\s*>/i);
  const head = html.slice(0, headEnd < 0 ? 300_000 : headEnd);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  let canonical: string | undefined;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?canonical\b/i.test(m[0])) continue;
    const href = /\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i.exec(m[0]);
    if (href !== null) canonical = decode(href[1] ?? href[2]).trim();
    break;
  }
  const body = /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  let lead = '';
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    lead = `${lead} ${plain(m[1])}`.trim();
    if (lead.length > 600) break;
  }
  const titleText = title === undefined ? '' : plain(title);
  return {
    meta: (key) => metas.get(key)?.[0],
    metas: (key) => metas.get(key) ?? [],
    ...(titleText === '' ? {} : { title: titleText }),
    ...(canonical === undefined || canonical === '' ? {} : { canonical }),
    password: /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html),
    lead,
  };
}

// ─── Which kind of link ─────────────────────────────────────────────────────

type Route =
  | { readonly via: 'youtube'; readonly id: string; readonly short: boolean }
  | { readonly via: 'instagram'; readonly code: string; readonly reel: boolean; readonly user?: string }
  | { readonly via: 'facebook'; readonly video: boolean; readonly reel: boolean; readonly id: string }
  | { readonly via: 'vimeo'; readonly id: string }
  | { readonly via: 'tiktok'; readonly id: string }
  | { readonly via: 'page' };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_NOT_USER = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']);

function routeOf(u: URL): Route {
  const host = bareHost(u);
  const parts = u.pathname.split('/').filter((s) => s !== '');
  if (host === 'youtu.be' || /^(?:music\.)?youtube(?:-nocookie)?\.com$/.test(host)) {
    const id = host === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? (u.searchParams.get('v') ?? undefined) : ['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '') ? parts[1] : undefined;
    if (id === undefined || !YT_ID.test(id)) return refuse(REASONS.youtubeOther);
    return { via: 'youtube', id, short: parts[0] === 'shorts' };
  }
  if (host === 'instagram.com' || host === 'instagr.am') {
    const user = parts.length >= 3 && !IG_NOT_USER.has(parts[0]) ? parts[0] : undefined;
    const rest = user === undefined ? parts : parts.slice(1);
    if (!['p', 'reel', 'reels', 'tv'].includes(rest[0] ?? '') || !/^[A-Za-z0-9_-]{5,}$/.test(rest[1] ?? '')) return refuse(REASONS.instagramOther);
    return { via: 'instagram', code: rest[1], reel: rest[0] !== 'p', ...(user === undefined ? {} : { user }) };
  }
  if (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com') {
    const video = host === 'fb.watch' || /^\/(?:watch|reel|share\/[rv])(?:\/|$)|\/videos\//.test(u.pathname);
    const reel = /^\/(?:reel|share\/r)(?:\/|$)/.test(u.pathname);
    const id = u.searchParams.get('v') ?? u.searchParams.get('story_fbid') ?? u.searchParams.get('fbid') ?? /(\d{6,})\/?$/.exec(u.pathname)?.[1] ?? parts.at(-1) ?? 'link';
    return { via: 'facebook', video, reel, id: id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'link' };
  }
  if (host === 'vimeo.com') {
    const id = /(?:^|\/)(\d{5,})(?:\/|$)/.exec(u.pathname)?.[1];
    if (id !== undefined) return { via: 'vimeo', id };
  }
  if (/(?:^|\.)tiktok\.com$/.test(host)) {
    const id = /\/(?:video|photo)\/(\d+)/.exec(u.pathname)?.[1];
    if (id !== undefined) return { via: 'tiktok', id };
  }
  return { via: 'page' };
}

// ─── Reading ────────────────────────────────────────────────────────────────

/** The text of a response, at most `maxBytes` of it, stopping early once `until` has been read. */
async function readText(res: Response, maxBytes: number, until?: string): Promise<string> {
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  let decoder: InstanceType<typeof TextDecoder>;
  try {
    decoder = new TextDecoder(charset ?? 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
  let text = '';
  let bytes = 0;
  while (reader !== undefined) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - bytes;
    const chunk = value.byteLength > room ? value.subarray(0, room) : value;
    bytes += chunk.byteLength;
    const piece = decoder.decode(chunk, { stream: true });
    text += piece;
    const found = until !== undefined && text.slice(-(piece.length + until.length)).includes(until);
    if (bytes >= maxBytes || found) {
      await reader.cancel().catch(() => undefined);
      return text;
    }
  }
  return text + decoder.decode();
}

const drain = (res: Response) => res.body?.cancel().catch(() => undefined);

interface Ctx {
  /** Aborts when this link's time is up, the report's is, or the report is cancelled. */
  readonly signal: AbortSignal;
  /** When this link's time is up, on `now`. */
  readonly deadline: number;
}

export function createIntake(opts: IntakeOptions): Intake {
  const fetchImpl: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = opts.now ?? Date.now;
  const linkMs = opts.linkTimeoutMs ?? LINK_TIMEOUT_MS;
  const reportMs = opts.reportTimeoutMs ?? REPORT_TIMEOUT_MS;
  const token = opts.igToken?.trim() ?? '';
  /** Meta answered that the garden's app may not use oEmbed: Instagram goes straight to Business Discovery after. */
  let instagramOembedClosed = false;
  const picture = (network: Network, id: string, source: string | undefined): string | undefined => {
    if (source === undefined) return undefined;
    return EXPIRING.has(network) && opts.keepPicture !== undefined ? opts.keepPicture(id, source) : source;
  };
  const redact = (text: string) => (token === '' ? text : text.replaceAll(token, '<token>')).replace(/access_token=[^&\s"']+/g, 'access_token=<token>');

  /** A GET of a page Muse kept: redirects followed by hand, each hop checked for a private address or a login page. */
  async function open(start: URL, ctx: Ctx, maxBytes: number): Promise<{ readonly url: URL; readonly text: string }> {
    let url = start;
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'https:' && url.protocol !== 'http:') refuse(REASONS.notALink);
      if (isLoginUrl(url)) refuse(REASONS.login);
      if (opts.openPrivate !== true) await assertPublic(url, ctx.signal);
      const res = await fetchImpl(url, { headers: HEADERS, redirect: 'manual', signal: ctx.signal });
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.get('location');
        await drain(res);
        if (location === null || !URL.canParse(location, url.toString())) refuse(REASONS.status(res.status));
        if (hop >= REDIRECTS_MAX) refuse(REASONS.tooManyRedirects);
        url = new URL(location as string, url);
        continue;
      }
      if (!res.ok) {
        await drain(res);
        if (res.status === 401 || res.status === 403 || res.status === 407) refuse(REASONS.login);
        if (res.status === 404 || res.status === 410) refuse(REASONS.notFound(res.status));
        if (res.status === 429) refuse(REASONS.busy);
        refuse(res.status >= 500 ? REASONS.serverError(res.status) : REASONS.status(res.status));
      }
      const type = (res.headers.get('content-type') ?? 'text/html').split(';')[0].trim().toLowerCase();
      if (type !== 'text/html' && type !== 'application/xhtml+xml' && type !== '') {
        await drain(res);
        refuse(type.startsWith('image/') ? REASONS.picture : REASONS.file(type));
      }
      return { url, text: await readText(res, maxBytes) };
    }
  }

  /** A GET of a fixed service's JSON (an oEmbed endpoint): its status and body, or null for a body that isn't JSON. */
  async function getJson(url: URL | string, signal: AbortSignal): Promise<{ readonly status: number; readonly body: Record<string, unknown> | null }> {
    const res = await fetchImpl(url, { headers: { ...HEADERS, Accept: 'application/json' }, signal });
    const text = await readText(res, 2_000_000);
    try {
      return { status: res.status, body: obj(JSON.parse(text), 'answer') };
    } catch {
      return { status: res.status, body: null };
    }
  }

  async function graphOembed(endpoint: string, link: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const url = new URL(`${GRAPH}/${endpoint}`);
    url.searchParams.set('url', link);
    url.searchParams.set('omitscript', 'true');
    url.searchParams.set('access_token', token);
    const { status, body } = await getJson(url, signal);
    if (body === null) throw new GraphError(status, undefined, `graph: ${endpoint} answered ${status} without JSON`);
    if (status < 200 || status >= 300 || body.error !== undefined) {
      const error = body.error === undefined ? {} : obj(body.error, 'error');
      const code = typeof error.code === 'number' ? error.code : undefined;
      throw new GraphError(status, code, redact(`graph: ${endpoint} answered ${status} ${optStr(error.message, 'message') ?? ''}`.trim()));
    }
    return body;
  }

  /** What a Graph refusal means for Muse, when it isn't about the post itself. */
  const metaTrouble = (err: GraphError): string | null =>
    err.code === 190 || /access token|session has expired/i.test(err.message) ? REASONS.metaToken : err.code !== undefined && [4, 17, 32, 613].includes(err.code) ? REASONS.metaBusy : null;
  /** Meta's "your app isn't approved for oEmbed Read". */
  const oembedClosed = (err: GraphError) => err.code === 10 || (err.code === 200 && /oembed/i.test(err.message));

  function fromRaw(item: RawItem): Read {
    const media = mediaOf({
      kind: item.kind,
      network: item.network,
      author: item.author,
      image: picture(item.network, item.id, item.image),
      aspect: item.aspect,
      duration: item.duration,
      minutes: item.minutes,
      site: item.site,
      published: item.published,
    });
    return { url: item.url, canonicalUrl: canonicalOf(item.url), title: item.title, summary: item.text, tags: item.tags ?? [], media };
  }

  /** What a watch page adds to the oEmbed (description, length, date), in what is left of the link's time; or nothing. */
  async function watchDetails(id: string, ctx: Ctx): Promise<WatchDetails> {
    const room = Math.min(WATCH_TIMEOUT_MS, ctx.deadline - now() - 250);
    if (room < 500) return {};
    try {
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(room)]);
      const res = await fetchImpl(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS, signal });
      if (!res.ok) {
        await drain(res);
        return {};
      }
      return parseWatchPage(await readText(res, WATCH_MAX_BYTES, '"publishDate"'));
    } catch {
      return {};
    }
  }

  async function youtube(route: Extract<Route, { via: 'youtube' }>, ctx: Ctx): Promise<Read> {
    const url = route.short ? `https://www.youtube.com/shorts/${route.id}` : `https://www.youtube.com/watch?v=${route.id}`;
    const embed = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, ctx.signal);
    if (embed.status === 401 || embed.status === 403) refuse(REASONS.youtubePrivate);
    if (embed.status === 400 || embed.status === 404) refuse(REASONS.youtubeMissing);
    if (embed.status === 429) refuse(REASONS.busy);
    if (embed.status < 200 || embed.status >= 300) refuse(REASONS.serverError(embed.status));
    const o = embed.body ?? refuse(REASONS.unreadable);
    const title = optStr(o.title, 'title')?.trim() || refuse(REASONS.youtubeMissing);
    const watch = await watchDetails(route.id, ctx);
    const author = optStr(o.author_name, 'author_name');
    const image = https(optStr(o.thumbnail_url, 'thumbnail_url'));
    return fromRaw({
      id: `yt-${route.id}`,
      kind: route.short ? 'reel' : 'video',
      network: 'youtube',
      url,
      title: clampTitle(title),
      text: clampSummary(watch.description ?? ''),
      site: 'YouTube',
      aspect: route.short ? round(9 / 16) : round(16 / 9),
      ...(author === undefined ? {} : { author }),
      ...(image === undefined ? {} : { image }),
      ...(watch.duration === undefined ? {} : { duration: watch.duration }),
      ...(watch.published === undefined ? {} : { published: watch.published }),
      tags: [...(watch.description ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((t) => t[1]),
    });
  }

  async function instagram(route: Extract<Route, { via: 'instagram' }>, ctx: Ctx): Promise<Read> {
    if (token === '') refuse(REASONS.instagramToken);
    const url = `https://www.instagram.com/${route.reel ? 'reel' : 'p'}/${route.code}/`;
    const id = `ig-${route.code}`;
    if (!instagramOembedClosed) {
      try {
        const o = await graphOembed('instagram_oembed', url, ctx.signal);
        const author = optStr(o.author_name, 'author_name')?.replace(/^@/, '');
        const caption = optStr(o.title, 'title') ?? embedCaption(optStr(o.html, 'html') ?? '');
        const kind: MediaKind = route.reel ? 'reel' : 'post';
        const thumb = https(optStr(o.thumbnail_url, 'thumbnail_url'));
        const width = positive(o.thumbnail_width);
        const height = positive(o.thumbnail_height);
        return fromRaw({
          id,
          kind,
          network: 'instagram',
          url,
          title: captionTitle(caption, author === undefined ? `An Instagram ${kind}` : `A ${kind} by @${author}`),
          text: clampSummary(caption),
          site: 'Instagram',
          ...(author === undefined ? {} : { author: `@${author}` }),
          ...(thumb === undefined ? {} : { image: thumb }),
          ...(route.reel ? { aspect: 9 / 16 } : width !== undefined && height !== undefined ? { aspect: round(width / height) } : {}),
          tags: [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((t) => t[1]),
        });
      } catch (err) {
        if (!(err instanceof GraphError)) throw err;
        const trouble = metaTrouble(err);
        if (trouble !== null) refuse(trouble);
        if (!oembedClosed(err)) refuse(REASONS.instagramGone);
        instagramOembedClosed = true;
      }
    }
    const user = route.user ?? refuse(REASONS.instagramNoAccount);
    const reader = new InstagramReader({
      token,
      ...(opts.igUserId === undefined || opts.igUserId === '' ? {} : { userId: opts.igUserId }),
      fetch: (input, init) => fetchImpl(input, { ...init, signal: ctx.signal }),
    });
    const items = await reader.latest(user, INSTAGRAM_LOOK).catch((err: unknown) => {
      if (ctx.signal.aborted) throw err;
      const message = String(err);
      return refuse(/access token|session has expired|\b190\b/i.test(message) ? REASONS.metaToken : REASONS.instagramAccount(user));
    });
    const item = items.find((i) => i.id === id) ?? refuse(REASONS.instagramNotFound(user));
    return fromRaw(item);
  }

  async function facebook(route: Extract<Route, { via: 'facebook' }>, link: URL, ctx: Ctx): Promise<Read> {
    if (token === '') refuse(REASONS.facebookToken);
    const url = canonicalOf(link.toString());
    let o: Record<string, unknown>;
    try {
      o = await graphOembed(route.video ? 'oembed_video' : 'oembed_post', url, ctx.signal);
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      return refuse(metaTrouble(err) ?? (oembedClosed(err) ? REASONS.facebookClosed : REASONS.facebookGone));
    }
    const html = optStr(o.html, 'html') ?? '';
    const caption = embedCaption(html);
    const author = optStr(o.author_name, 'author_name');
    const kind: MediaKind = route.reel ? 'reel' : route.video ? 'video' : 'post';
    const date = /\bon\s*<a\b[^>]*>([^<]+)<\/a>\s*<\/blockquote>/i.exec(html)?.[1];
    const published = date !== undefined && !Number.isNaN(Date.parse(date)) ? new Date(Date.parse(date)).toISOString().slice(0, 10) : undefined;
    return fromRaw({
      id: `fb-${route.id}`,
      kind,
      network: 'facebook',
      url,
      title: captionTitle(caption, author === undefined ? `A Facebook ${kind}` : `A ${kind} by ${author}`),
      text: clampSummary(caption),
      site: 'Facebook',
      ...(author === undefined ? {} : { author }),
      ...(route.reel ? { aspect: 9 / 16 } : {}),
      ...(published === undefined ? {} : { published }),
    });
  }

  async function vimeo(route: Extract<Route, { via: 'vimeo' }>, ctx: Ctx): Promise<Read> {
    const url = `https://vimeo.com/${route.id}`;
    const embed = await getJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`, ctx.signal);
    if (embed.status === 401 || embed.status === 403) refuse(REASONS.videoPrivate);
    if (embed.status === 404) refuse(REASONS.videoMissing);
    if (embed.status < 200 || embed.status >= 300) refuse(REASONS.serverError(embed.status));
    const o = embed.body ?? refuse(REASONS.unreadable);
    const width = positive(o.width);
    const height = positive(o.height);
    const date = optStr(o.upload_date, 'upload_date');
    const author = optStr(o.author_name, 'author_name');
    const image = https(optStr(o.thumbnail_url, 'thumbnail_url'));
    const duration = positive(o.duration);
    return fromRaw({
      id: `vimeo-${route.id}`,
      kind: width !== undefined && height !== undefined && height > width ? 'reel' : 'video',
      network: 'vimeo',
      url,
      title: clampTitle(optStr(o.title, 'title')?.trim() || refuse(REASONS.videoMissing)),
      text: clampSummary(plain(optStr(o.description, 'description') ?? '')),
      site: 'Vimeo',
      ...(author === undefined ? {} : { author }),
      ...(image === undefined ? {} : { image }),
      ...(width !== undefined && height !== undefined ? { aspect: round(width / height) } : {}),
      ...(duration === undefined ? {} : { duration }),
      ...(date === undefined ? {} : { published: date.slice(0, 10) }),
    });
  }

  async function tiktok(route: Extract<Route, { via: 'tiktok' }>, link: URL, ctx: Ctx): Promise<Read> {
    const url = `https://www.tiktok.com${link.pathname.replace(/\/$/, '')}`;
    const embed = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, ctx.signal);
    if (embed.status === 400 || embed.status === 404) refuse(REASONS.videoMissing);
    if (embed.status < 200 || embed.status >= 300) refuse(REASONS.serverError(embed.status));
    const o = embed.body ?? refuse(REASONS.unreadable);
    const caption = optStr(o.title, 'title') ?? '';
    const handle = optStr(o.author_unique_id, 'author_unique_id');
    const author = handle === undefined ? optStr(o.author_name, 'author_name') : `@${handle}`;
    const image = https(optStr(o.thumbnail_url, 'thumbnail_url'));
    return fromRaw({
      id: `tiktok-${route.id}`,
      kind: 'reel',
      network: 'tiktok',
      url,
      title: captionTitle(caption, author === undefined ? 'A TikTok' : `A TikTok by ${author}`),
      text: clampSummary(caption),
      site: 'TikTok',
      aspect: 9 / 16,
      ...(author === undefined ? {} : { author }),
      ...(image === undefined ? {} : { image }),
      tags: [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((t) => t[1]),
    });
  }

  async function page(link: URL, ctx: Ctx): Promise<Read> {
    const opened = await open(link, ctx, PAGE_MAX_BYTES);
    const final = opened.url;
    if (isLoginUrl(final)) refuse(REASONS.login);
    const scan = scanPage(opened.text);
    if (isLoginPage(scan)) refuse(REASONS.login);
    const preview = parsePreview(opened.text, final.toString());
    const host = bareHost(final);
    const network: Network = /(?:^|\.)bsky\.app$/.test(host) ? 'bluesky' : /(?:^|\.)(?:flickr\.com|flic\.kr)$/.test(host) ? 'flickr' : 'web';
    const tagged = scan.meta('og:title') ?? scan.meta('twitter:title');
    const description = scan.meta('og:description') ?? scan.meta('twitter:description') ?? scan.meta('description');
    const named = tagged ?? scan.title ?? '';
    // A page with no preview tags and a one-word title is a shell the site fills in a browser ("Instagram", "Video").
    if (named === '' || (tagged === undefined && description === undefined && !/\s/.test(named))) refuse(REASONS.nothing);
    const ogType = scan.meta('og:type') ?? '';
    const kind: MediaKind = network !== 'web' ? 'post' : ogType.startsWith('video') || scan.meta('twitter:card') === 'player' ? 'video' : 'article';
    const text = clampSummary(description ?? scan.lead);
    const title = network === 'bluesky' && description !== undefined ? captionTitle(description, named) : clampTitle(named);
    const declared = scan.canonical ?? scan.meta('og:url');
    const canonical = declared !== undefined && URL.canParse(declared, final.toString()) ? new URL(declared, final) : undefined;
    const sameSite = canonical !== undefined && /^https?:$/.test(canonical.protocol) && siteOf(canonical.toString()) === siteOf(final.toString());
    const image = https(preview.image);
    const author = preview.author !== undefined && !preview.author.startsWith('http') ? preview.author : undefined;
    const keywords = (scan.meta('keywords') ?? '').split(',').map((k) => k.trim()).filter((k) => k !== '' && k.length <= 40);
    const hashtags = [...(description ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((t) => t[1]);
    const media = mediaOf({
      kind,
      network,
      author,
      image,
      aspect: image !== undefined && preview.aspect !== undefined ? round(preview.aspect) : undefined,
      duration: kind === 'video' ? positive(scan.meta('og:video:duration') ?? scan.meta('video:duration')) : undefined,
      minutes: kind === 'article' ? Math.max(1, Math.round(preview.words / WORDS_PER_MINUTE)) : undefined,
      site: preview.site ?? (network === 'bluesky' ? 'Bluesky' : network === 'flickr' ? 'Flickr' : host),
      published: preview.published,
    });
    return {
      url: final.toString(),
      canonicalUrl: canonicalOf((sameSite && canonical !== undefined ? canonical : final).toString()),
      title,
      summary: text,
      tags: [...new Set([...scan.metas('article:tag'), ...keywords, ...hashtags])].slice(0, 20),
      media,
    };
  }

  function read(link: URL, ctx: Ctx): Promise<Read> {
    const route = routeOf(link);
    switch (route.via) {
      case 'youtube':
        return youtube(route, ctx);
      case 'instagram':
        return instagram(route, ctx);
      case 'facebook':
        return facebook(route, link, ctx);
      case 'vimeo':
        return vimeo(route, ctx);
      case 'tiktok':
        return tiktok(route, link, ctx);
      case 'page':
        return page(link, ctx);
    }
  }

  return async (urls, { interests, thread, signal: outer }) => {
    const total = new AbortController();
    const totalTimer = setTimeout(() => total.abort(), reportMs);
    const reportDeadline = now() + reportMs;
    try {
      const filing = await raceAbort(threadOf(opts, thread, interests), total.signal).catch((): Filing => ({ thread, topic: null, interests, near: interests }));
      const unique = [...new Set(urls.map((u) => u.trim()))];
      const outcomes = await pool(
        unique.map((raw) => async (): Promise<IntakeOutcome> => {
          const link = new AbortController();
          const signals = [link.signal, total.signal, ...(outer === undefined ? [] : [outer])];
          const ms = Math.min(linkMs, reportDeadline - now());
          const timer = setTimeout(() => link.abort(), Math.max(0, ms));
          const why = (err: unknown): string => {
            if (err instanceof Refusal) return err.message;
            if (outer?.aborted === true) return REASONS.cancelled;
            // A link given only what was left of the report's time ran out of the report's time, whichever timer fired first.
            if (total.signal.aborted || (link.signal.aborted && ms < linkMs)) return REASONS.outOfTime(reportMs);
            if (link.signal.aborted) return REASONS.timedOut(linkMs);
            return explain(err);
          };
          try {
            if (outer?.aborted === true) refuse(REASONS.cancelled);
            if (ms <= 0 || total.signal.aborted) refuse(REASONS.outOfTime(reportMs));
            const parsed = URL.canParse(raw) ? new URL(raw) : refuse(REASONS.notALink);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') refuse(REASONS.notALink);
            const ctx: Ctx = { signal: AbortSignal.any(signals), deadline: now() + ms };
            const found = await read(parsed, ctx);
            const topics = await raceAbort(topicsFor(opts, found, filing), ctx.signal);
            const candidate: Candidate = { url: found.url, canonicalUrl: found.canonicalUrl, title: found.title, summary: found.summary, topics, media: found.media };
            return { ok: true, url: raw, candidate };
          } catch (err) {
            return { ok: false, url: raw, reason: why(err) };
          } finally {
            clearTimeout(timer);
          }
        }),
        AT_ONCE,
      );
      const byUrl = new Map(unique.map((u, i) => [u, outcomes[i]]));
      return urls.map((u) => {
        const o = byUrl.get(u.trim()) as IntakeOutcome;
        return { ...o, url: u };
      });
    } catch {
      return urls.map((url) => ({ ok: false as const, url, reason: "the garden couldn't read this link just now; try again" }));
    } finally {
      clearTimeout(totalTimer);
    }
  };
}

/** An oEmbed blockquote's own words: its paragraphs, without the embed's "View this post" and "shared by" lines. */
function embedCaption(html: string): string {
  const quote = /<blockquote\b[\s\S]*?<\/blockquote>/i.exec(html)?.[0] ?? html;
  const paragraphs = [...quote.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1]));
  return paragraphs
    .filter((p) => p !== '' && !/^(?:view this (?:post|reel|profile) on instagram|a (?:post|reel|video) shared by\b)/i.test(p))
    .join(' ')
    .trim();
}

/** Why a link failed that isn't a refusal or a timeout, from the network error's code. */
function explain(err: unknown): string {
  const e = err as { readonly code?: unknown; readonly cause?: { readonly code?: unknown } };
  const raw = e.cause?.code ?? e.code;
  const code = typeof raw === 'string' ? raw : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME') return REASONS.noSite;
  if (code !== '') return REASONS.noAnswer;
  return err instanceof SyntaxError ? REASONS.unreadable : REASONS.noAnswer;
}

/** Runs `tasks` at most `n` at a time, keeping their order. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], n: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

// ─── Filing ─────────────────────────────────────────────────────────────────

interface Filing {
  readonly thread: string;
  /** The thread's own topic, when the topic map names it. */
  readonly topic: TopicKey | null;
  readonly interests: readonly TopicKey[];
  /** What Muse was on: the thread's topic, then its interests. */
  readonly near: readonly TopicKey[];
}

async function threadOf(opts: IntakeOptions, thread: string, interests: readonly TopicKey[]): Promise<Filing> {
  const label = thread.trim();
  const resolved = label === '' ? null : await resolveSafe(opts, label);
  const named = resolved ?? (label === '' || opts.fileUnder === undefined ? undefined : safeFile(opts.fileUnder, { title: label, text: '' }, interests)[0]);
  const topic = named ?? null;
  return { thread: label, topic, interests, near: [...new Set([...(topic === null ? [] : [topic]), ...interests])] };
}

/** resolveTopic, with a failure read as "the map has none". */
function resolveSafe(opts: IntakeOptions, label: string): Promise<TopicKey | null> {
  return Promise.resolve()
    .then(() => opts.resolveTopic(label))
    .catch(() => null);
}

function safeFile(file: FileUnder, item: Parameters<FileUnder>[0], near: readonly TopicKey[]): readonly TopicKey[] {
  try {
    return file(item, near);
  } catch {
    return [];
  }
}

/** A topic's name as its words, lower-cased: "Kermes (dye)" is "kermes". */
const nameOf = (t: TopicKey) => t.replace(/\s*\([^)]*\)$/, '').toLowerCase();

/**
 * The topics a find is filed under, the main one first: by its own words (the recorder's filing, or its tags resolved
 * one by one); else the declared interest it or the thread names; else the thread's topic; else Muse's first interest.
 */
async function topicsFor(opts: IntakeOptions, found: Read, filing: Filing): Promise<TopicKey[]> {
  const item = { title: found.title, text: found.summary, tags: found.tags };
  const filed =
    opts.fileUnder !== undefined
      ? safeFile(opts.fileUnder, item, filing.near)
      : (await Promise.all(found.tags.slice(0, 10).map((t) => resolveSafe(opts, t)))).filter((t): t is TopicKey => t !== null);
  const topics = [...new Set(filed)].slice(0, TOPICS_MAX);
  if (topics.length > 0) return topics;
  const words = `${found.title} ${found.summary}`.toLowerCase();
  const thread = filing.thread.toLowerCase();
  const near =
    filing.interests.find((t) => hasWords(words, nameOf(t))) ??
    filing.interests.find((t) => t === filing.topic || hasWords(thread, nameOf(t))) ??
    filing.topic ??
    filing.interests[0];
  return near === undefined ? refuse(REASONS.noTopic) : [near];
}

/** The recorder's filing over a topic map, in the area of the first topic Muse was near that the map places. */
export function filingFor(map: Corpus): FileUnder {
  const index = topicIndex(map);
  const areaOf = new Map<string, string>(map.pages.map((p) => [p.candidate.topics[0], p.area]));
  return (item, near) => fileByNames(index, near.map((t) => areaOf.get(t)).find((a) => a !== undefined) ?? '', item);
}

let fromCorpus: Pick<IntakeOptions, 'resolveTopic' | 'fileUnder'> | undefined;

/** Intake over the real topic map (server/fixtures/corpus.json), with the garden's Meta token from the environment. */
export function defaultIntake(env: NodeJS.ProcessEnv = process.env, more: Partial<IntakeOptions> = {}): Intake {
  fromCorpus ??= (() => {
    const map = loadCorpus();
    const source = new FixtureSource(map);
    return { resolveTopic: (label: string) => source.resolveTopic(label), fileUnder: filingFor(map) };
  })();
  const igToken = env.META_IG_TOKEN?.trim();
  const igUserId = env.META_IG_USER_ID?.trim();
  return createIntake({ ...fromCorpus, ...(igToken ? { igToken } : {}), ...(igUserId ? { igUserId } : {}), ...more });
}
