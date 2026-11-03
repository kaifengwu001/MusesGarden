// Real reels, posts, articles and videos, recorded by `npm run record:media` and filed under the topic map's topics.
// The topic map only names topics and links them: everything Muse finds or shows is one of these items.
import { readFileSync } from 'node:fs';
import { mix, salt } from '../../../src/core/hash';
import type { Candidate, CanonicalUrl, MediaInfo, MediaKind, Network, Source, TopicKey } from '../../../src/muse/contract';
import { FIXTURES_DIR, type Corpus } from './corpus';
import { arr, num, obj, optStr, str, strs } from './json';
import { canonicalLink } from './rss';
import { normalizeTitle } from './wikipedia';

export const MEDIA_PATH = `${FIXTURES_DIR}media.json`;
export const MEDIA_KINDS: readonly MediaKind[] = ['reel', 'post', 'video', 'article'];
export const NETWORKS: readonly Network[] = ['instagram', 'facebook', 'youtube', 'vimeo', 'tiktok', 'flickr', 'bluesky', 'web'];
/** Instagram and Facebook: about this share of a hop's candidates when the recording holds any. */
export const META_NETWORKS: ReadonlySet<Network> = new Set(['instagram', 'facebook']);
export const META_SHARE = 0.65;
/** Networks whose picture links expire: the garden serves their pictures from its own cache, /api/media/<id>. */
export const EXPIRING: ReadonlySet<Network> = new Set(['instagram', 'facebook', 'tiktok']);
/** `${network prefix}-${the network's own id}`: one id per item, however many sources or links reach it. */
export const MEDIA_ID = /^[a-z]+-[A-Za-z0-9_-]{1,80}$/;
const TOPICS_MAX = 6;
const TEXT_MAX = 400;

export interface MediaItem {
  readonly id: string;
  /** The topic map's area of the source that recorded it. */
  readonly area: string;
  /** The picture where the network serves it, when that link expires (media.image is then the cache route). */
  readonly imageSource?: string;
  readonly candidate: Candidate;
}

/** Which twin of the divergence test an unseen item should appeal to. */
export type Lean = 'botany' | 'jazz' | 'neutral';
export const LEANS: readonly Lean[] = ['botany', 'jazz', 'neutral'];

export interface MediaRecording {
  readonly recordedAt: string;
  readonly items: readonly MediaItem[];
  /** Real items held out of `items`, so no Muse can find them: what the divergence test asks the twins to judge. */
  readonly unseen: Readonly<Record<Lean, readonly MediaItem[]>>;
}

/** The on-disk form: one flat object per item, so the file reads and diffs well. */
export interface MediaItemJson {
  readonly id: string;
  readonly kind: MediaKind;
  readonly network: Network;
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly topics: readonly string[];
  readonly area: string;
  readonly author?: string;
  readonly site?: string;
  readonly image?: string;
  readonly aspect?: number;
  readonly duration?: number;
  readonly minutes?: number;
  readonly published?: string;
}

/** An item as its network gives it, before the recorder files it under topics; tags help the filing. */
export type RawItem = Omit<MediaItemJson, 'topics' | 'area'> & { readonly tags?: readonly string[] };

/** A link's site, by the last two labels of its host: "example.org" for every language or mobile host of it. */
export const siteOf = (url: string): string => new URL(url).hostname.split('.').slice(-2).join('.');

export const mediaRoute = (id: string): string => `/api/media/${id}`;

function oneOf<T extends string>(v: unknown, options: readonly T[], what: string): T {
  const s = str(v, what);
  const found = options.find((o) => o === s);
  if (found === undefined) throw new Error(`${what}: ${s} is not one of ${options.join(', ')}`);
  return found;
}

function optPositive(v: unknown, what: string): number | undefined {
  if (v === undefined) return undefined;
  const n = num(v, what);
  if (n <= 0) throw new Error(`${what}: ${n} is not positive`);
  return n;
}

function httpsUrl(v: unknown, what: string): string {
  const s = str(v, what);
  if (!URL.canParse(s) || new URL(s).protocol !== 'https:') throw new Error(`${what}: ${s} is not an https link`);
  return s;
}

/** The parse boundary for recorded items: the only place recording strings become TopicKey and CanonicalUrl. */
export function parseMediaItem(raw: unknown, what = 'item'): MediaItem {
  const o = obj(raw, what);
  const id = str(o.id, `${what}.id`);
  if (!MEDIA_ID.test(id)) throw new Error(`${what}.id: ${id} is not a media id`);
  const kind = oneOf(o.kind, MEDIA_KINDS, `${what}.kind`);
  const network = oneOf(o.network, NETWORKS, `${what}.network`);
  const url = httpsUrl(o.url, `${what}.url`);
  const title = str(o.title, `${what}.title`).trim();
  const text = str(o.text, `${what}.text`);
  const topics = strs(o.topics, `${what}.topics`);
  if (title === '') throw new Error(`${what}.title: empty`);
  if (text.length > TEXT_MAX) throw new Error(`${what}.text: ${text.length} characters`);
  if (topics.length < 1 || topics.length > TOPICS_MAX) throw new Error(`${what}.topics: ${topics.length} topics`);
  const image = o.image === undefined ? undefined : httpsUrl(o.image, `${what}.image`);
  const author = optStr(o.author, `${what}.author`);
  const site = optStr(o.site, `${what}.site`);
  const published = optStr(o.published, `${what}.published`);
  if (published !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(published)) throw new Error(`${what}.published: ${published}`);
  const aspect = optPositive(o.aspect, `${what}.aspect`);
  const duration = optPositive(o.duration, `${what}.duration`);
  const minutes = optPositive(o.minutes, `${what}.minutes`);
  const expiring = image !== undefined && EXPIRING.has(network);
  const media: MediaInfo = {
    kind,
    network,
    ...(author === undefined ? {} : { author }),
    ...(image === undefined ? {} : { image: expiring ? mediaRoute(id) : image }),
    ...(aspect === undefined ? {} : { aspect }),
    ...(duration === undefined ? {} : { duration }),
    ...(minutes === undefined ? {} : { minutes }),
    ...(site === undefined ? {} : { site }),
    ...(published === undefined ? {} : { published }),
  };
  return {
    id,
    area: str(o.area, `${what}.area`),
    ...(expiring ? { imageSource: image } : {}),
    candidate: { url, canonicalUrl: canonicalLink(url), title, summary: text, topics: topics as TopicKey[], media },
  };
}

export function parseMediaRecording(raw: unknown): MediaRecording {
  const o = obj(raw, 'recording');
  const items = arr(o.items, 'recording.items').map((x, i) => parseMediaItem(x, `items[${i}]`));
  const held = obj(o.unseen, 'recording.unseen');
  const unseen = Object.fromEntries(LEANS.map((l) => [l, arr(held[l], `unseen.${l}`).map((x, i) => parseMediaItem(x, `unseen.${l}[${i}]`))])) as Record<Lean, MediaItem[]>;
  const ids = new Set<string>();
  const urls = new Set<CanonicalUrl>();
  for (const item of [...items, ...LEANS.flatMap((l) => unseen[l])]) {
    if (ids.has(item.id)) throw new Error(`recording: ${item.id} appears twice`);
    if (urls.has(item.candidate.canonicalUrl)) throw new Error(`recording: ${item.candidate.canonicalUrl} appears twice`);
    ids.add(item.id);
    urls.add(item.candidate.canonicalUrl);
  }
  return { recordedAt: str(o.recordedAt, 'recording.recordedAt'), items, unseen };
}

/** The on-disk form of a recording: one item per line, so the file stays readable and its diffs show what changed. */
export function recordingJson(r: { recordedAt: string; items: readonly MediaItemJson[]; unseen: Readonly<Record<string, readonly MediaItemJson[]>> }): string {
  const list = (items: readonly MediaItemJson[], indent: string) => items.map((i) => `${indent}${JSON.stringify(i)}`).join(',\n');
  const unseen = Object.entries(r.unseen).map(([lean, items]) => `    ${JSON.stringify(lean)}: [\n${list(items, '      ')}\n    ]`);
  return `{\n  "recordedAt": ${JSON.stringify(r.recordedAt)},\n  "items": [\n${list(r.items, '    ')}\n  ],\n  "unseen": {\n${unseen.join(',\n')}\n  }\n}\n`;
}

/**
 * An earlier recording's Instagram items, for a recording made without META_IG_TOKEN, which can't read Instagram and
 * would otherwise lose them all: those whose area the topic map still has and whose id and link `recorded` lacks.
 * Each keeps the topics the map still names; one left with none is filed again by `file`, and left out if that finds
 * none either.
 */
export function carriedInstagram(
  previous: unknown,
  map: Pick<Corpus, 'areas' | 'pages'>,
  recorded: readonly MediaItemJson[],
  file: (item: MediaItemJson) => readonly string[],
): MediaItemJson[] {
  const areas = new Set(map.areas.map((a) => a.name));
  const topics = new Set<string>(map.pages.map((p) => p.candidate.topics[0]));
  const ids = new Set(recorded.map((i) => i.id));
  const links = new Set(recorded.map((i) => canonicalLink(i.url)));
  return arr(obj(previous, 'recording').items, 'recording.items').flatMap((raw, i) => {
    const item = parseMediaItem(raw, `items[${i}]`);
    if (item.candidate.media.network !== 'instagram' || !areas.has(item.area) || ids.has(item.id) || links.has(item.candidate.canonicalUrl)) return [];
    const json = raw as MediaItemJson;
    const still = json.topics.filter((t) => topics.has(t));
    const filed = still.length > 0 ? still : file(json);
    return filed.length > 0 ? [{ ...json, topics: filed }] : [];
  });
}

/** The recording's order: by area as the topic map lists them, then kind, then id. */
export function recordingOrder(areas: readonly string[]): (a: MediaItemJson, b: MediaItemJson) => number {
  const at = new Map(areas.map((a, i) => [a, i]));
  return (a, b) => (at.get(a.area) ?? 0) - (at.get(b.area) ?? 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * `previous` with `added` merged in, for a pass that reads only one network: every item and held-out item it had stays
 * as it was, and each added item joins unless its id or link is already there.
 */
export function withItems(
  previous: unknown,
  added: readonly MediaItemJson[],
  areas: readonly string[],
): { readonly recordedAt: string; readonly items: MediaItemJson[]; readonly unseen: Record<Lean, MediaItemJson[]>; readonly joined: MediaItemJson[] } {
  parseMediaRecording(previous);
  const o = obj(previous, 'recording');
  const items = arr(o.items, 'recording.items') as MediaItemJson[];
  const held = obj(o.unseen, 'recording.unseen');
  const unseen = Object.fromEntries(LEANS.map((l) => [l, arr(held[l], `unseen.${l}`) as MediaItemJson[]])) as Record<Lean, MediaItemJson[]>;
  const ids = new Set([...items, ...LEANS.flatMap((l) => unseen[l])].map((i) => i.id));
  const links = new Set([...items, ...LEANS.flatMap((l) => unseen[l])].map((i) => canonicalLink(i.url)));
  const joined: MediaItemJson[] = [];
  for (const x of added) {
    const link = canonicalLink(x.url);
    if (ids.has(x.id) || links.has(link)) continue;
    ids.add(x.id);
    links.add(link);
    joined.push(x);
  }
  return { recordedAt: str(o.recordedAt, 'recording.recordedAt'), items: [...items, ...joined].sort(recordingOrder(areas)), unseen, joined };
}

export function loadMediaRecording(path = MEDIA_PATH): MediaRecording {
  return parseMediaRecording(JSON.parse(readFileSync(path, 'utf8')));
}

/** Slot i of a hop's candidates goes to Instagram or Facebook when it brings the running share up to META_SHARE. */
function interleave(items: readonly MediaItem[]): MediaItem[] {
  const meta = items.filter((i) => META_NETWORKS.has(i.candidate.media.network));
  const web = items.filter((i) => !META_NETWORKS.has(i.candidate.media.network));
  const out: MediaItem[] = [];
  while (meta.length > 0 || web.length > 0) {
    const wantMeta = Math.floor((out.length + 1) * META_SHARE) > Math.floor(out.length * META_SHARE);
    const from = (wantMeta && meta.length > 0) || web.length === 0 ? meta : web;
    out.push(from.shift() as MediaItem);
  }
  return out;
}

/**
 * The recording as a Source. A hop looks for its drawn kind among the items filed under its topics; with none of
 * that kind it takes the next kind the Muse favours, then an item from the same area of the topic map, so a trip
 * never comes back empty while anything uncollected is left. Offline, and the same answer for the same question.
 */
export class MediaSource implements Source {
  private readonly items: readonly MediaItem[];
  /** Items filed under each topic: those whose main topic it is first, then the rest, each in a fixed shuffled order. */
  private readonly byTopic = new Map<TopicKey, MediaItem[]>();
  private readonly byArea = new Map<string, MediaItem[]>();
  private readonly areaOf = new Map<TopicKey, string>();
  private readonly links = new Map<TopicKey, readonly TopicKey[]>();
  /** Lower-cased topic names and their aliases. */
  private readonly byName = new Map<string, TopicKey>();

  constructor(recording: MediaRecording, map: Corpus) {
    for (const p of map.pages) {
      const topic = p.candidate.topics[0];
      this.areaOf.set(topic, p.area);
      this.links.set(topic, p.links);
      for (const alias of p.aliases) this.byName.set(alias.toLowerCase(), topic);
    }
    for (const topic of this.areaOf.keys()) this.byName.set(topic.toLowerCase(), topic);
    const shuffled = [...recording.items].sort((a, b) => salt(a.id) - salt(b.id) || (a.id < b.id ? -1 : 1));
    this.items = shuffled;
    for (const item of shuffled) {
      const stray = item.candidate.topics.find((t) => !this.areaOf.has(t));
      if (stray !== undefined) throw new Error(`${item.id}: ${stray} is not a topic of the topic map`);
      const area = this.byArea.get(item.area) ?? [];
      area.push(item);
      this.byArea.set(item.area, area);
    }
    for (const rank of [0, 1]) {
      for (const item of shuffled) {
        item.candidate.topics.forEach((t, i) => {
          if ((i === 0 ? 0 : 1) !== rank) return;
          this.byTopic.set(t, [...(this.byTopic.get(t) ?? []), item]);
        });
      }
    }
  }

  search(topic: TopicKey, kinds: readonly MediaKind[], limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    return Promise.resolve(this.pick([this.onTopics([topic]), this.inAreaOf(topic), this.items], kinds, limit, exclude));
  }

  next(from: Candidate, kinds: readonly MediaKind[], limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    const topic = from.topics[0];
    const skip = new Set([...exclude, from.canonicalUrl]);
    const tiers = [this.onTopics(this.links.get(topic) ?? []), this.onTopics(from.topics), this.inAreaOf(topic), this.items];
    return Promise.resolve(this.pick(tiers, kinds, limit, skip));
  }

  serendipity(kinds: readonly MediaKind[], limit: number, seed: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    const order = [...this.items].sort((a, b) => mix(salt(a.id), seed) - mix(salt(b.id), seed) || (a.id < b.id ? -1 : 1));
    return Promise.resolve(this.pick([order], kinds, limit, exclude));
  }

  resolveTopic(label: string): Promise<TopicKey | null> {
    return Promise.resolve(this.byName.get(normalizeTitle(label).toLowerCase()) ?? null);
  }

  private onTopics(topics: readonly TopicKey[]): MediaItem[] {
    return [...new Set(topics.flatMap((t) => this.byTopic.get(t) ?? []))];
  }

  private inAreaOf(topic: TopicKey): readonly MediaItem[] {
    const area = this.areaOf.get(topic);
    return area === undefined ? [] : (this.byArea.get(area) ?? []);
  }

  /**
   * The first tier holding anything left gives the first of `kinds` it has, topped up with that kind from the wider
   * tiers, so a topic with only a few left still shows a full hop. Meta is interleaved within each tier.
   */
  private pick(tiers: readonly (readonly MediaItem[])[], kinds: readonly MediaKind[], limit: number, exclude: ReadonlySet<CanonicalUrl>): Candidate[] {
    const left = tiers.map((tier) => tier.filter((i) => !exclude.has(i.candidate.canonicalUrl)));
    const at = left.findIndex((tier) => tier.length > 0);
    if (at < 0) return [];
    const kind = kinds.find((k) => left[at].some((i) => i.candidate.media.kind === k)) ?? left[at][0].candidate.media.kind;
    const out = new Map<string, MediaItem>();
    for (const tier of left.slice(at)) {
      for (const i of interleave(tier.filter((x) => x.candidate.media.kind === kind))) if (out.size < limit) out.set(i.id, i);
    }
    return [...out.values()].map((i) => i.candidate);
  }
}
