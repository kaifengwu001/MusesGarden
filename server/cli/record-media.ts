// npm run record:media [-- --area fungi --dry]
// Reads the newest items of every source in server/fixtures/media-sources.json, keeps those whose links answer, files
// each under topics of the topic map, and writes server/fixtures/media.json. Instagram joins when META_IG_TOKEN is set.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { salt } from '../../src/core/hash';
import type { MediaKind, TopicKey } from '../../src/muse/contract';
import { FIXTURES_DIR, loadCorpus, loadHeroChain } from '../adapters/sources/corpus';
import { fileUnder, topicIndex } from '../adapters/sources/filing';
import { InstagramReader } from '../adapters/sources/instagram';
import { arr, obj, str, strs } from '../adapters/sources/json';
import { LEANS, MEDIA_PATH, parseMediaRecording, siteOf, type Lean, type MediaItemJson, type RawItem } from '../adapters/sources/media';
import { readArticles, readBluesky, readFlickr, readVimeo, readYoutube, searchBluesky, searchYoutube, type Read, type WatchDetails } from '../adapters/sources/readers';

const SOURCES_PATH = `${FIXTURES_DIR}media-sources.json`;
const KINDS = ['articles', 'youtube', 'vimeo', 'flickr', 'bluesky', 'instagram'] as const;
type SourceKind = (typeof KINDS)[number];
/** How many of each source's newest items are recorded. */
const LIMITS = { articles: 3, videos: 2, shorts: 3, vimeo: 3, flickr: 3, bluesky: 3, instagram: 6 } as const;
const CONCURRENCY = 8;
/**
 * A topic with fewer than this many items of a kind after the curated sources is filled by searches that name it:
 * Bluesky for posts and the articles posts link to, YouTube for videos and Shorts. A hop looks for its drawn kind on
 * its topic first, so each topic needs some of every kind for temperament to show in what Muse brings home.
 */
const PER_KIND = 2;
/** Search results looked at per topic: many name the topic only in a picture's description, which is not kept. */
const TOPIC_LOOK = 25;

/** The divergence test's held-out items: the twins' owners love botany and jazz. */
const UNSEEN: Readonly<Record<Lean, { readonly areas: readonly string[]; readonly topics: readonly string[]; readonly count: number }>> = {
  botany: { areas: ['botanical illustration'], topics: ['Botany', 'Botanical illustration', 'Herbarium'], count: 3 },
  jazz: { areas: ['jazz'], topics: ['Jazz', 'Bebop', 'Swing music'], count: 3 },
  neutral: { areas: ['sailing and navigation', 'brutalist architecture'], topics: [], count: 2 },
};

interface AreaSources {
  readonly area: string;
  /** Added to a single-word topic's search so it stays in the area. */
  readonly search: string;
  readonly sources: Readonly<Record<SourceKind, readonly string[]>>;
}

/** The parse boundary for the source list, which people edit by hand. */
function parseSources(raw: unknown, areas: ReadonlySet<string>): AreaSources[] {
  return arr(obj(raw, 'media-sources').areas, 'areas').map((a, i) => {
    const o = obj(a, `areas[${i}]`);
    const area = str(o.area, `areas[${i}].area`);
    if (!areas.has(area)) throw new Error(`areas[${i}]: ${area} is not an area of the topic map (${[...areas].join(', ')})`);
    const sources = Object.fromEntries(KINDS.map((k) => [k, o[k] === undefined ? [] : strs(o[k], `${area}.${k}`)])) as Record<SourceKind, string[]>;
    return { area, search: str(o.search, `${area}.search`), sources };
  });
}

/** Runs `tasks` at most `n` at a time, keeping their order. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array<T>(tasks.length);
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

interface Outcome {
  readonly area: string;
  readonly kind: SourceKind | 'bluesky search' | 'youtube search';
  readonly ref: string;
  readonly read: Read | null;
  readonly error?: string;
  /** For a topic search: the topic every item it found is about. */
  readonly topic?: TopicKey;
}

async function attempt(o: Omit<Outcome, 'read' | 'error'>, read: () => Promise<Read>): Promise<Outcome> {
  try {
    const r = await read();
    console.info(`  ${r.items.length} ${o.kind} from ${o.ref}${r.dead.length > 0 ? ` (${r.dead.length} links did not answer)` : ''}`);
    return { ...o, read: r };
  } catch (err) {
    console.info(`  FAILED ${o.kind} ${o.ref}: ${String(err)}`);
    return { ...o, read: null, error: String(err) };
  }
}

/** The topic's own words in quotes, plus the area's word when the name alone could mean anything. */
function topicQuery(topic: TopicKey, word: string): string {
  const name = topic.replace(/\s*\([^)]*\)$/, '');
  return /\s/.test(name) || name.toLowerCase().includes(word.toLowerCase()) ? `"${name}"` : `"${name}" ${word}`;
}

/** What the last recording read from YouTube watch pages, by item id. */
function knownWatchDetails(): Map<string, WatchDetails> {
  if (!existsSync(MEDIA_PATH)) return new Map();
  const items = arr(obj(JSON.parse(readFileSync(MEDIA_PATH, 'utf8')), 'recording').items, 'items').map((x) => obj(x, 'item'));
  return new Map(
    items
      .filter((i) => i.network === 'youtube' && typeof i.text === 'string' && i.text !== '')
      .map((i) => [str(i.id, 'id'), { description: str(i.text, 'text'), ...(typeof i.duration === 'number' ? { duration: i.duration } : {}), ...(typeof i.published === 'string' ? { published: i.published } : {}) }]),
  );
}

function readerFor(instagram: InstagramReader | null): Record<SourceKind, ((ref: string) => Promise<Read>) | null> {
  const known = knownWatchDetails();
  return {
    articles: (ref) => readArticles(ref, LIMITS.articles),
    youtube: (ref) => readYoutube(ref, { videos: LIMITS.videos, shorts: LIMITS.shorts }, known),
    vimeo: (ref) => readVimeo(ref, LIMITS.vimeo),
    flickr: (ref) => readFlickr(ref, LIMITS.flickr),
    bluesky: (ref) => readBluesky(ref, LIMITS.bluesky),
    instagram: instagram === null ? null : async (ref) => ({ items: await instagram.latest(ref, LIMITS.instagram), dead: [] }),
  };
}

const count = <T>(xs: readonly T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join(', ');
};

/** One item per line, so the file stays readable and its diffs show what changed. */
function recordingJson(r: { recordedAt: string; items: readonly MediaItemJson[]; unseen: Readonly<Record<string, readonly MediaItemJson[]>> }): string {
  const list = (items: readonly MediaItemJson[], indent: string) => items.map((i) => `${indent}${JSON.stringify(i)}`).join(',\n');
  const unseen = Object.entries(r.unseen).map(([lean, items]) => `    ${JSON.stringify(lean)}: [\n${list(items, '      ')}\n    ]`);
  return `{\n  "recordedAt": ${JSON.stringify(r.recordedAt)},\n  "items": [\n${list(r.items, '    ')}\n  ],\n  "unseen": {\n${unseen.join(',\n')}\n  }\n}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { area: { type: 'string' }, dry: { type: 'boolean', default: false } } });
  const map = loadCorpus();
  const index = topicIndex(map);
  const listed = parseSources(JSON.parse(readFileSync(SOURCES_PATH, 'utf8')), new Set(map.areas.map((a) => a.name)));
  const instagram = InstagramReader.fromEnv();
  const readers = readerFor(instagram);
  if (instagram === null) console.info('Instagram: no META_IG_TOKEN, so Instagram accounts are skipped.');

  const tasks = listed
    .filter((a) => values.area === undefined || a.area === values.area)
    .flatMap(({ area, sources }) =>
      KINDS.flatMap((kind) => {
        const read = readers[kind];
        return read === null ? [] : sources[kind].map((ref) => () => attempt({ area, kind, ref }, () => read(ref)));
      }),
    );
  console.info(`Reading ${tasks.length} sources...`);
  const curated = await pool(tasks, CONCURRENCY);

  const seen = new Set<string>();
  /** The topic map's own site: nothing Muse finds comes from it, links to it, or names it. */
  const mapSites = new Set(map.pages.map((p) => siteOf(p.candidate.url)));
  const namesMap = new RegExp([...mapSites].map((s) => s.split('.')[0]).join('|'), 'i');
  let offTopic = 0;
  let onMap = 0;
  const filed: (MediaItemJson & { readonly fallback: boolean })[] = [];
  const have = (t: TopicKey, kinds: readonly MediaKind[]) => filed.filter((x) => kinds.includes(x.kind) && x.topics.includes(t)).length;
  const file = (outcomes: readonly Outcome[]) => {
    for (const o of outcomes) {
      for (const { tags, ...raw } of o.read?.items ?? ([] as RawItem[])) {
        if (o.topic !== undefined && have(o.topic, [raw.kind]) >= PER_KIND) continue;
        if (seen.has(raw.id)) continue;
        seen.add(raw.id);
        if (mapSites.has(siteOf(raw.url)) || namesMap.test(`${raw.url} ${raw.title} ${raw.text} ${raw.author ?? ''}`)) {
          onMap++;
          continue;
        }
        const matched = fileUnder(index, o.area, { title: raw.title, text: raw.text, ...(tags === undefined ? {} : { tags }) });
        if (o.topic !== undefined && !matched.includes(o.topic)) {
          offTopic++;
          continue;
        }
        const lead = o.topic ?? (matched.length > 0 ? undefined : index.roots.get(o.area));
        const topics = lead === undefined ? matched : [lead, ...matched.filter((t) => t !== lead)].slice(0, 6);
        if (topics.length > 0) filed.push({ ...raw, topics, area: o.area, fallback: o.topic === undefined && matched.length === 0 });
      }
    }
  };
  file(curated);

  const words = new Map(listed.map((a) => [a.area, a.search]));
  const pages = map.pages.filter((p) => values.area === undefined || p.area === values.area);
  const searches = pages.flatMap((p) => {
    const topic = p.candidate.topics[0];
    const ref = topicQuery(topic, words.get(p.area) ?? '');
    const at = { area: p.area, ref, topic };
    const thin = (kinds: readonly MediaKind[]) => kinds.some((k) => have(topic, [k]) < PER_KIND);
    return [
      ...(thin(['post', 'article']) ? [() => attempt({ ...at, kind: 'bluesky search' }, () => searchBluesky(ref, TOPIC_LOOK))] : []),
      ...(thin(['video', 'reel']) ? [() => attempt({ ...at, kind: 'youtube search' }, () => searchYoutube(ref, { videos: 3, shorts: 3 }))] : []),
    ];
  });
  console.info(`Searching for topics with fewer than ${PER_KIND} items of a kind (${searches.length} searches)...`);
  const searched = await pool(searches, CONCURRENCY);
  file(searched);
  const outcomes = [...curated, ...searched];

  const order = new Map(map.areas.map((a, i) => [a.name, i]));
  filed.sort((a, b) => (order.get(a.area) ?? 0) - (order.get(b.area) ?? 0) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : 1));
  const strip = ({ fallback: _, ...item }: MediaItemJson & { readonly fallback: boolean }): MediaItemJson => item;
  const held = new Set<string>();
  const unseen: Record<Lean, MediaItemJson[]> = { botany: [], jazz: [], neutral: [] };
  for (const lean of LEANS) {
    const want = UNSEEN[lean];
    const picked = filed
      .filter((x) => want.areas.includes(x.area) && (want.topics.length === 0 || x.topics.some((t) => want.topics.includes(t))))
      .sort((a, b) => salt(a.id) - salt(b.id))
      .slice(0, want.count);
    for (const p of picked) held.add(p.id);
    unseen[lean] = picked.map(strip);
  }
  const recording = { recordedAt: new Date().toISOString(), items: filed.filter((x) => !held.has(x.id)).map(strip), unseen };
  const parsed = parseMediaRecording(recording);

  const failed = outcomes.filter((o) => o.read === null);
  const dead = outcomes.flatMap((o) => o.read?.dead ?? []);
  const answered = outcomes.reduce((n, o) => n + (o.read?.items.length ?? 0), 0);
  console.info(`\nSources: ${outcomes.length - failed.length} of ${outcomes.length} answered (${count(outcomes.filter((o) => o.read !== null), (o) => o.kind)}).`);
  for (const f of failed) console.info(`  failed: ${f.area} ${f.kind} ${f.ref} (${f.error ?? ''})`);
  console.info(`Links: ${answered} answered when recorded, ${dead.length} did not and were left out.`);
  console.info(`Items: ${parsed.items.length} recorded, ${LEANS.reduce((n, l) => n + parsed.unseen[l].length, 0)} held out as unseen.`);
  console.info(`  by kind: ${count(parsed.items, (i) => i.candidate.media.kind)}`);
  console.info(`  by network: ${count(parsed.items, (i) => i.candidate.media.network)}`);
  console.info(`  by area: ${count(parsed.items, (i) => i.area)}`);

  const perTopic = new Map<TopicKey, number>();
  for (const i of parsed.items) for (const t of i.candidate.topics) perTopic.set(t, (perTopic.get(t) ?? 0) + 1);
  const topics = map.pages.map((p) => p.candidate.topics[0]);
  const atLeast = (n: number) => topics.filter((t) => (perTopic.get(t) ?? 0) >= n).length;
  console.info(`Coverage: ${atLeast(1)} of ${topics.length} topics have an item, ${atLeast(3)} have 3 or more.`);
  const pools = loadHeroChain().map((c) => c.topics[0]);
  console.info(`  the hero's pools: ${pools.map((t) => `${t} ${perTopic.get(t) ?? 0}`).join(', ')}`);
  console.info(`  filed under the area's main topic for want of a match: ${filed.filter((x) => x.fallback).length}`);
  console.info(`  topic search results left out for not naming their topic: ${offTopic}`);
  console.info(`  items from, linking to or naming the topic map's own site left out: ${onMap}`);
  console.info(`  without a caption: ${count(parsed.items.filter((i) => i.candidate.summary === ''), (i) => i.candidate.media.network) || 'none'}`);

  if (values.dry || values.area !== undefined) {
    console.info('\nNot written (--dry or --area).');
    return;
  }
  writeFileSync(MEDIA_PATH, recordingJson(recording));
  console.info(`\nWrote ${MEDIA_PATH}`);
}

await main();
