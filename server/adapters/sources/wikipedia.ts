import type { Candidate, CanonicalUrl, Source, TopicKey } from '../../../src/muse/contract';
import { arr, obj, optStr, str } from './json';
import { clampSummary } from './text';

const API = 'https://en.wikipedia.org/w/api.php';
export const USER_AGENT = 'MusesGarden/0.1 (hackathon prototype)';
/** MediaWiki's per-request title limit for non-bot clients. */
const BATCH = 50;
const MAX_CATEGORIES = 6;
/** Extra titles fetched past `limit`, so missing pages, disambiguations and redirect duplicates don't leave a hop short. */
const PAD = 10;
/** Wikimedia rate-limits anonymous API clients with 429 and Retry-After (15 s observed). */
const RETRIES = 6;

const DETAILS = {
  prop: 'info|extracts|pageimages|categories|pageprops',
  inprop: 'url',
  exintro: '1',
  explaintext: '1',
  exlimit: 'max',
  piprop: 'thumbnail',
  pithumbsize: '320',
  pilimit: 'max',
  clshow: '!hidden',
  cllimit: 'max',
  ppprop: 'disambiguation',
};

/**
 * Non-hidden categories that say little about what a page is about. The API lists categories alphabetically, so
 * date-led ones ("1926 births", "20th-century American male actors") would otherwise crowd out the subject ones.
 */
const NOISE_CATEGORY = /^(?:\d|(?:Possibly )?Living people$)/;

/** Link targets outside the article namespace. Prefixes of 1–3 letters cover language codes and shortcuts (wp:, s:). */
const NOT_ARTICLE =
  /^(?:file|image|media|category|template|help|wikipedia|portal|special|user|talk|draft|module|wikt|wiktionary|commons|wikisource|wikiquote|wikibooks|wikinews|wikiversity|wikivoyage|wikidata|species|meta|[a-z]{1,3}(?:-[a-z]+)*)\s*:/i;

/** Back-matter headings: links after these are citations, not part of the article's thread. */
const BACK_MATTER = /^==\s*(?:References|Notes|Citations|Footnotes|Sources|Bibliography|Further reading|External links)\s*==\s*$/im;

/** MediaWiki's main-namespace title form: spaces not underscores, single spaces, first letter upper case. */
export function normalizeTitle(label: string): string {
  const t = label.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** https://en.wikipedia.org/wiki/<Title_With_Underscores>, escaped like MediaWiki's wfUrlencode. */
export function wikipediaUrl(title: string): CanonicalUrl {
  const path = encodeURIComponent(normalizeTitle(title).replace(/ /g, '_'))
    .replace(/'/g, '%27')
    .replace(/%(3B|40|24|2C|2F|3A)/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return `https://en.wikipedia.org/wiki/${path}` as CanonicalUrl;
}

/** Article-namespace link targets in the order they appear in the body, before the back matter. */
export function wikitextLinks(wikitext: string): string[] {
  const end = wikitext.search(BACK_MATTER);
  const body = (end < 0 ? wikitext : wikitext.slice(0, end))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  const seen = new Set<string>();
  for (const m of body.matchAll(/\[\[([^[\]|]*)(?:\|[^[\]]*)?\]\]/g)) {
    const target = m[1].split('#')[0].trim();
    if (target === '' || target.startsWith(':') || NOT_ARTICLE.test(target)) continue;
    seen.add(normalizeTitle(target));
  }
  return [...seen];
}

interface RawPage {
  readonly title: string;
  readonly article: boolean;
  disambiguation: boolean;
  url?: string;
  extract?: string;
  thumb?: string;
  wikitext?: string;
  categories: string[];
  redirects: string[];
}

interface QueryBatch {
  readonly pages: RawPage[];
  /** `normalized` and `redirects` hops, from → to. */
  readonly renames: [string, string][];
  readonly cont: Record<string, string> | undefined;
}

function parsePage(v: unknown): RawPage {
  const p = obj(v, 'page');
  const titles = (key: string) =>
    p[key] === undefined ? [] : arr(p[key], key).map((c) => str(obj(c, key).title, `${key}.title`));
  const revision = p.revisions === undefined ? undefined : obj(arr(p.revisions, 'revisions')[0], 'revision');
  const main = revision === undefined ? undefined : obj(obj(revision.slots, 'slots').main, 'slots.main');
  const thumbnail = p.thumbnail === undefined ? undefined : obj(p.thumbnail, 'thumbnail');
  return {
    title: str(p.title, 'page.title'),
    article: p.ns === 0 && p.missing !== true && p.invalid !== true,
    disambiguation: p.pageprops !== undefined && 'disambiguation' in obj(p.pageprops, 'pageprops'),
    url: optStr(p.canonicalurl, 'canonicalurl'),
    extract: optStr(p.extract, 'extract'),
    thumb: thumbnail === undefined ? undefined : str(thumbnail.source, 'thumbnail.source'),
    wikitext: main === undefined ? undefined : optStr(main.content, 'content'),
    categories: titles('categories').map((c) => c.replace(/^Category:/, '')),
    redirects: titles('redirects'),
  };
}

function parseQuery(body: Record<string, unknown>): QueryBatch {
  const query = body.query === undefined ? {} : obj(body.query, 'query');
  const hops = (key: string): [string, string][] =>
    query[key] === undefined
      ? []
      : arr(query[key], key).map((h) => {
          const o = obj(h, key);
          return [str(o.from, `${key}.from`), str(o.to, `${key}.to`)];
        });
  const cont = body.batchcomplete === true || body.continue === undefined ? undefined : obj(body.continue, 'continue');
  return {
    pages: query.pages === undefined ? [] : arr(query.pages, 'pages').map(parsePage),
    renames: [...hops('normalized'), ...hops('redirects')],
    cont: cont === undefined ? undefined : Object.fromEntries(Object.entries(cont).map(([k, v]) => [k, String(v)])),
  };
}

/** Continuation responses repeat a page with the next slice of its props. */
function mergePage(into: Map<string, RawPage>, p: RawPage): void {
  const seen = into.get(p.title);
  if (seen === undefined) {
    into.set(p.title, p);
    return;
  }
  seen.disambiguation ||= p.disambiguation;
  seen.url ??= p.url;
  seen.extract ??= p.extract;
  seen.thumb ??= p.thumb;
  seen.wikitext ??= p.wikitext;
  seen.categories.push(...p.categories.filter((c) => !seen.categories.includes(c)));
  seen.redirects.push(...p.redirects.filter((r) => !seen.redirects.includes(r)));
}

/** The parse boundary for topic identity: titles and category names the API returned are canonical. */
function topicsOf(page: RawPage): TopicKey[] {
  const categories = page.categories.filter((c) => !NOISE_CATEGORY.test(c)).slice(0, MAX_CATEGORIES);
  return [page.title, ...categories] as TopicKey[];
}

function toCandidate(page: RawPage): Candidate | null {
  if (page.disambiguation || page.extract === undefined) return null;
  const summary = clampSummary(page.extract);
  if (summary === '') return null;
  const canonicalUrl = wikipediaUrl(page.title);
  return {
    origin: 'wikipedia',
    url: page.url ?? canonicalUrl,
    canonicalUrl,
    title: page.title,
    summary,
    ...(page.thumb === undefined ? {} : { thumb: page.thumb }),
    topics: topicsOf(page),
  };
}

function dedupe(candidates: readonly (Candidate | null | undefined)[]): Candidate[] {
  const seen = new Set<CanonicalUrl>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (c == null || seen.has(c.canonicalUrl)) continue;
    seen.add(c.canonicalUrl);
    out.push(c);
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface WikipediaOptions {
  readonly fetch?: typeof fetch;
  /** The minimum gap between two requests. Requests are serialized. */
  readonly minIntervalMs?: number;
}

/** Live English Wikipedia through the MediaWiki action API. */
export class WikipediaSource implements Source {
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private gate: Promise<void> = Promise.resolve();
  private lastAt = 0;

  constructor(options: WikipediaOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.minIntervalMs = options.minIntervalMs ?? 500;
  }

  async search(topic: TopicKey, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    return this.pick(await this.searchTitles(topic), limit, exclude);
  }

  async next(from: Candidate, limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    const skip = new Set<CanonicalUrl>([...exclude, from.canonicalUrl]);
    const title = from.origin === 'wikipedia' ? from.topics[0] : undefined;
    const linked = title === undefined ? [] : ((await this.links([title])).get(title) ?? []);
    const first = await this.pick(linked, limit, skip);
    if (first.length >= limit) return first;
    for (const c of first) skip.add(c.canonicalUrl);
    const similar = await this.searchTitles(title === undefined ? from.title : `morelike:${title}`);
    return [...first, ...(await this.pick(similar, limit - first.length, skip))];
  }

  /** Live and therefore not reproducible: `seed` only matters offline. */
  async serendipity(limit: number, _seed: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    const body = await this.get({ action: 'query', list: 'random', rnnamespace: '0', rnlimit: String(limit + PAD) });
    const random = arr(obj(body.query, 'query').random, 'random').map((r) => str(obj(r, 'random').title, 'title'));
    return this.pick(random, limit, exclude);
  }

  async resolveTopic(label: string): Promise<TopicKey | null> {
    const title = normalizeTitle(label);
    if (title === '') return null;
    const page = (await this.queryTitles([title], { prop: 'pageprops', ppprop: 'disambiguation' })).get(title);
    return page == null || page.disambiguation ? null : topicsOf(page)[0];
  }

  /** Each title (as normalized) to its page's Candidate after redirects, or null for missing pages and disambiguations. */
  async lookup(titles: readonly string[]): Promise<Map<string, Candidate | null>> {
    const pages = await this.queryTitles(titles, DETAILS);
    return new Map([...pages].map(([title, page]) => [title, page && toCandidate(page)]));
  }

  /** Candidates for `titles` in order, redirects resolved and duplicates dropped. */
  async candidates(titles: readonly string[]): Promise<Candidate[]> {
    const found = await this.lookup(titles);
    return dedupe(titles.map((t) => found.get(normalizeTitle(t))));
  }

  /** Each title (as normalized) to its article-namespace links in body order. Link targets may be redirects. */
  async links(titles: readonly string[]): Promise<Map<string, string[]>> {
    const pages = await this.queryTitles(titles, { prop: 'revisions', rvprop: 'content', rvslots: 'main' });
    return new Map([...pages].map(([title, page]) => [title, wikitextLinks(page?.wikitext ?? '')]));
  }

  /** Each title (as normalized) to the article-namespace redirects that point at it. */
  async aliases(titles: readonly string[]): Promise<Map<string, string[]>> {
    const pages = await this.queryTitles(titles, { prop: 'redirects', rdlimit: 'max', rdnamespace: '0' });
    return new Map([...pages].map(([title, page]) => [title, page?.redirects ?? []]));
  }

  private async searchTitles(query: string): Promise<string[]> {
    const body = await this.get({
      action: 'query',
      list: 'search',
      srsearch: query,
      srnamespace: '0',
      srlimit: String(BATCH),
      srprop: '',
      srinfo: '',
    });
    return arr(obj(body.query, 'query').search, 'search').map((r) => str(obj(r, 'search').title, 'title'));
  }

  private async pick(titles: readonly string[], limit: number, exclude: ReadonlySet<CanonicalUrl>): Promise<Candidate[]> {
    if (limit <= 0) return [];
    const fresh = titles.filter((t) => !exclude.has(wikipediaUrl(t))).slice(0, limit + PAD);
    const found = await this.candidates(fresh);
    return found.filter((c) => !exclude.has(c.canonicalUrl)).slice(0, limit);
  }

  /** Batches of 50 titles, each followed through `continue` until complete. Keys are the normalized requested titles. */
  private async queryTitles(titles: readonly string[], params: Readonly<Record<string, string>>): Promise<Map<string, RawPage | null>> {
    const out = new Map<string, RawPage | null>();
    const unique = [...new Set(titles.map(normalizeTitle))].filter((t) => t !== '');
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      const pages = new Map<string, RawPage>();
      const renames = new Map<string, string>();
      let cont: Record<string, string> | undefined = {};
      while (cont !== undefined) {
        const batch = parseQuery(await this.get({ action: 'query', redirects: '1', titles: chunk.join('|'), ...params, ...cont }));
        for (const [from, to] of batch.renames) renames.set(from, to);
        for (const page of batch.pages) mergePage(pages, page);
        cont = batch.cont;
      }
      for (const title of chunk) {
        let resolved = title;
        for (let hop = 0; hop < 3; hop++) resolved = renames.get(resolved) ?? resolved;
        const page = pages.get(resolved);
        out.set(title, page?.article ? page : null);
      }
    }
    return out;
  }

  private async get(params: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    const turn = this.gate.then(async () => {
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastAt = Date.now();
    });
    this.gate = turn;
    await turn;
    const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params }).toString()}`;
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
      const body = res.ok ? obj(await res.json(), 'MediaWiki response') : undefined;
      const error = body?.error === undefined ? undefined : obj(body.error, 'error');
      const busy = res.status === 429 || res.status >= 500 || error?.code === 'maxlag';
      if (busy && attempt <= RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (body === undefined) throw new Error(`MediaWiki HTTP ${res.status}`);
      if (error !== undefined) throw new Error(`MediaWiki ${String(error.code)}: ${String(error.info)}`);
      return body;
    }
  }
}
