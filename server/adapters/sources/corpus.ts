import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mix, salt } from '../../../src/core/hash';
import type { CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import { arr, obj, optStr, str, strs } from './json';
import { mentions } from './text';
import { normalizeTitle, topicCategories, wikipediaUrl, type TopicPage } from './wikipedia';

export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));
export const CORPUS_PATH = `${FIXTURES_DIR}corpus.json`;
export const HERO_CHAIN_PATH = `${FIXTURES_DIR}pools/hero-chain.json`;
export const UNSEEN_PATH = `${FIXTURES_DIR}pools/unseen.json`;

export interface CorpusArea {
  readonly name: string;
  readonly seeds: readonly string[];
}

export interface CorpusPage {
  /** The interest area whose crawl reached this page first. */
  readonly area: string;
  readonly candidate: TopicPage;
  /** In-corpus pages this page links to, in article order. */
  readonly links: readonly TopicKey[];
  /** Redirect titles that lead to this page. */
  readonly aliases: readonly string[];
}

export interface Corpus {
  readonly recordedAt: string;
  readonly areas: readonly CorpusArea[];
  readonly pages: readonly CorpusPage[];
}

export type Lean = 'botany' | 'jazz' | 'neutral';
export type UnseenPool = Readonly<Record<Lean, readonly TopicPage[]>>;

/** The parse boundary for recorded pages: the only place fixture strings become TopicKey and CanonicalUrl. */
export function parseCandidate(raw: unknown, what = 'candidate'): TopicPage {
  const o = obj(raw, what);
  const origin = str(o.origin, `${what}.origin`);
  if (origin !== 'wikipedia' && origin !== 'rss') throw new Error(`${what}.origin: unknown source ${origin}`);
  const title = str(o.title, `${what}.title`);
  const canonicalUrl = str(o.canonicalUrl, `${what}.canonicalUrl`);
  const summary = str(o.summary, `${what}.summary`);
  const topics = strs(o.topics, `${what}.topics`);
  const thumb = optStr(o.thumb, `${what}.thumb`);
  if (origin === 'wikipedia' && canonicalUrl !== wikipediaUrl(title)) throw new Error(`${what}: ${canonicalUrl} is not canonical`);
  if (summary === '' || summary.length > 400) throw new Error(`${what}.summary: ${summary.length} characters`);
  if (topics.length < 1 || topics.length > 7) throw new Error(`${what}.topics: ${topics.length} topics`);
  if (origin === 'wikipedia' && topicCategories(topics.slice(1)).length !== topics.length - 1) {
    throw new Error(`${what}.topics: holds a biographical or maintenance category`);
  }
  return {
    origin,
    url: str(o.url, `${what}.url`),
    canonicalUrl: canonicalUrl as CanonicalUrl,
    title,
    summary,
    ...(thumb === undefined ? {} : { thumb }),
    topics: topics as TopicKey[],
  };
}

export function parseCorpus(raw: unknown): Corpus {
  const o = obj(raw, 'corpus');
  const pages = arr(o.pages, 'corpus.pages').map((p, i): CorpusPage => {
    const page = obj(p, `pages[${i}]`);
    const candidate = parseCandidate(page, `pages[${i}]`);
    if (candidate.topics[0] !== candidate.title) throw new Error(`pages[${i}]: topics[0] is not the page's title`);
    return {
      area: str(page.area, `pages[${i}].area`),
      candidate,
      links: strs(page.links, `pages[${i}].links`) as TopicKey[],
      aliases: strs(page.aliases, `pages[${i}].aliases`),
    };
  });
  const titles = new Set(pages.map((p) => p.candidate.title));
  for (const p of pages) {
    const stray = p.links.find((t) => !titles.has(t) || t === p.candidate.title);
    if (stray !== undefined) throw new Error(`${p.candidate.title}: link to ${stray} is outside the corpus or to itself`);
  }
  return {
    recordedAt: str(o.recordedAt, 'corpus.recordedAt'),
    areas: arr(o.areas, 'corpus.areas').map((a, i) => {
      const area = obj(a, `areas[${i}]`);
      return { name: str(area.name, `areas[${i}].name`), seeds: strs(area.seeds, `areas[${i}].seeds`) };
    }),
    pages,
  };
}

/** The on-disk form: each page is a flat TopicPage plus its area, links and aliases. */
export function corpusJson(corpus: Corpus): unknown {
  return {
    recordedAt: corpus.recordedAt,
    areas: corpus.areas,
    pages: corpus.pages.map((p) => ({ area: p.area, ...p.candidate, links: p.links, aliases: p.aliases })),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadCorpus(path = CORPUS_PATH): Corpus {
  return parseCorpus(readJson(path));
}

/** Botanical illustration → … → Ultramarine: each page links to the next. */
export function loadHeroChain(path = HERO_CHAIN_PATH): TopicPage[] {
  return arr(readJson(path), 'hero chain').map((c, i) => parseCandidate(c, `hero[${i}]`));
}

/** Real pages that are not in the corpus, grouped by which twin they should appeal to. */
export function loadUnseenPool(path = UNSEEN_PATH): UnseenPool {
  const o = obj(readJson(path), 'unseen');
  const lean = (key: Lean) => arr(o[key], key).map((c, i) => parseCandidate(c, `${key}[${i}]`));
  return { botany: lean('botany'), jazz: lean('jazz'), neutral: lean('neutral') };
}

/** The topic map's own reader: its recorder builds the hero chain with it. Offline, and deterministic. */
export class FixtureSource {
  private readonly pages: readonly CorpusPage[];
  private readonly byTitle = new Map<string, CorpusPage>();
  private readonly byUrl = new Map<CanonicalUrl, CorpusPage>();
  /** Lower-cased titles and redirect aliases. */
  private readonly byName = new Map<string, CorpusPage>();

  constructor(corpus: Corpus) {
    this.pages = corpus.pages;
    for (const p of corpus.pages) {
      this.byTitle.set(p.candidate.title, p);
      this.byUrl.set(p.candidate.canonicalUrl, p);
      for (const alias of p.aliases) this.byName.set(alias.toLowerCase(), p);
    }
    for (const p of corpus.pages) this.byName.set(p.candidate.title.toLowerCase(), p);
  }

  static load(path = CORPUS_PATH): FixtureSource {
    return new FixtureSource(loadCorpus(path));
  }

  /** The exact page first, then pages sharing its categories (most shared first), then pages that mention it. */
  search(topic: TopicKey, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<TopicPage[]> {
    const self = this.byTitle.get(topic);
    const keys = new Set<string>([topic, ...(self?.candidate.topics.slice(1) ?? [])]);
    const ranked = this.pages
      .map((p, i) => ({
        p,
        i,
        exact: p === self ? 1 : 0,
        shared: p.candidate.topics.slice(1).filter((t) => keys.has(t)).length,
        text: mentions(`${p.candidate.title} ${p.candidate.summary}`, topic) ? 1 : 0,
      }))
      .filter((s) => s.exact + s.shared + s.text > 0)
      .sort((a, b) => b.exact - a.exact || b.shared - a.shared || b.text - a.text || a.i - b.i);
    return Promise.resolve(this.take(ranked.map((s) => s.p), limit, exclude));
  }

  /** Recorded links in article order, then pages sharing a topic with `from` (most shared first). */
  next(from: TopicPage, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<TopicPage[]> {
    const linked = (this.byUrl.get(from.canonicalUrl)?.links ?? []).flatMap((t) => this.byTitle.get(t) ?? []);
    const keys = new Set<string>(from.topics);
    const related = this.pages
      .map((p, i) => ({ p, i, shared: p.candidate.topics.filter((t) => keys.has(t)).length }))
      .filter((s) => s.shared > 0)
      .sort((a, b) => b.shared - a.shared || a.i - b.i)
      .map((s) => s.p);
    const others = [...linked, ...related].filter((p) => p.candidate.canonicalUrl !== from.canonicalUrl);
    return Promise.resolve(this.take(others, limit, exclude));
  }

  /** The whole corpus in an order drawn from `seed`. A page's place depends only on its URL and the seed. */
  serendipity(limit: number, seed: number, exclude: ReadonlySet<CanonicalUrl>): Promise<TopicPage[]> {
    const shuffled = this.pages
      .map((p) => ({ p, key: mix(salt(p.candidate.canonicalUrl), seed) }))
      .sort((a, b) => a.key - b.key)
      .map((s) => s.p);
    return Promise.resolve(this.take(shuffled, limit, exclude));
  }

  /** Corpus titles and the redirects recorded for them, ignoring case. Anything else is unknown offline. */
  resolveTopic(label: string): Promise<TopicKey | null> {
    const page = this.byName.get(normalizeTitle(label).toLowerCase());
    return Promise.resolve(page === undefined ? null : page.candidate.topics[0]);
  }

  private take(pages: readonly CorpusPage[], limit: number, exclude: ReadonlySet<CanonicalUrl>): TopicPage[] {
    const out: TopicPage[] = [];
    const seen = new Set<CanonicalUrl>();
    for (const { candidate } of pages) {
      if (out.length >= limit) break;
      if (exclude.has(candidate.canonicalUrl) || seen.has(candidate.canonicalUrl)) continue;
      seen.add(candidate.canonicalUrl);
      out.push(candidate);
    }
    return out;
  }
}
