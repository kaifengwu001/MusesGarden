// Records Muse's offline internet from live Wikipedia: the corpus, the hero chain, the unseen pool, and the HTTP
// samples the source tests replay. With no step it re-records everything; `pools` and `samples` reuse corpus.json,
// and `topics` re-filters the recorded topics offline.
//   npx tsx server/adapters/sources/record.ts [all|pools|samples|topics]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Candidate, CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import {
  CORPUS_PATH,
  corpusJson,
  FixtureSource,
  HERO_CHAIN_PATH,
  loadCorpus,
  loadHeroChain,
  loadUnseenPool,
  parseCorpus,
  UNSEEN_PATH,
  type Corpus,
  type CorpusPage,
  type Lean,
} from './corpus';
import { arr, obj, strs } from './json';
import { recordingFetch, SAMPLE_BATCH, type Samples } from './samples';
import { normalizeTitle, topicCategories, WikipediaSource } from './wikipedia';

interface Area {
  readonly name: string;
  readonly seeds: readonly string[];
  /** A crawled page joins the area only if its title, categories or summary match. Seeds always join. */
  readonly keywords: RegExp;
}

const AREAS: readonly Area[] = [
  {
    name: 'botanical illustration',
    seeds: ['Botanical illustration', 'Botany', 'Florilegium', 'Pierre-Joseph Redouté', 'Herbarium'],
    keywords: /botan|illustrat|florileg|herbari|\bflora\b|watercolou?r|naturalist|engrav/i,
  },
  {
    name: 'pigments and colour history',
    seeds: ['Pigment', 'Ultramarine', 'Lapis lazuli', 'Vermilion', 'Prussian blue', 'Tyrian purple'],
    keywords: /pigment|\bdyes?\b|colou?r|paint|ochre|mordant/i,
  },
  {
    name: 'jazz',
    seeds: ['Jazz', 'Bebop', 'Swing music', 'Miles Davis', 'Duke Ellington'],
    keywords: /jazz|bebop|\bswing\b|big band|ragtime|\bblues\b/i,
  },
  {
    name: 'astronomy',
    seeds: ['Astronomy', 'Telescope', 'Galaxy', 'Nebula', 'Comet'],
    keywords: /astronom|telescop|galax|nebula|comet|planet|\bstars?\b|celestial|\bsolar\b|\blunar\b|\bmoon\b|cosmolog/i,
  },
  {
    name: 'sailing and navigation',
    seeds: ['Sailing', 'Celestial navigation', 'Sextant', 'Marine chronometer', 'Clipper'],
    keywords: /\bsail|navigat|\bships?\b|\bboats?\b|maritime|nautical|sextant|chronometer|longitude|compass|\bvessels?\b/i,
  },
  {
    name: 'fungi',
    seeds: ['Fungus', 'Mushroom', 'Mycorrhiza', 'Lichen', 'Mycelium'],
    keywords: /fung|mushroom|mycolog|mycorrhiz|lichen|\bmou?lds?\b|yeast|\bspores?\b/i,
  },
  {
    name: 'Japanese woodblock prints',
    seeds: ['Ukiyo-e', 'Woodblock printing in Japan', 'Hokusai', 'Hiroshige', 'The Great Wave off Kanagawa'],
    keywords: /ukiyo|woodblock|hokusai|hiroshige|utamaro|hanga|printmak|\bedo\b|kabuki|bijin/i,
  },
  {
    name: 'fermentation',
    seeds: ['Fermentation in food processing', 'Kimchi', 'Sourdough', 'Miso', 'Kombucha', 'Sauerkraut'],
    keywords: /ferment|yeast|lactobac|pickl|brew|vinegar|koji|probiotic/i,
  },
  {
    name: 'brutalist architecture',
    seeds: ['Brutalist architecture', 'Le Corbusier', "Unité d'habitation", 'Barbican Estate', 'Alison and Peter Smithson'],
    keywords: /brutalis|concrete|béton|modernis|corbusier|architect/i,
  },
  {
    name: 'birds',
    seeds: ['Bird', 'Bird migration', 'Birdwatching', 'Songbird', 'Corvidae'],
    keywords: /\bbirds?\b|avian|ornitholog|songbird|passerine|raptor|\bowls?\b|corvid|plumage|\bfeathers?\b|birdsong/i,
  },
  {
    name: 'cartography',
    seeds: ['Cartography', 'Map projection', 'Mercator projection', 'Portolan chart', 'Atlas'],
    keywords: /cartograph|\bmaps?\b|mapping|projection|\batlas|\bglobes?\b|portolan|geodes|surveying/i,
  },
  {
    name: 'typography',
    seeds: ['Typography', 'Typeface', 'Serif', 'Movable type', 'Johannes Gutenberg', 'Helvetica'],
    keywords: /typograph|typeface|\bfonts?\b|serif|type design|letterpress|calligraph|glyph|movable type|printing press|punchcut/i,
  },
  {
    name: 'origami',
    seeds: ['Origami', 'Akira Yoshizawa', 'Mathematics of paper folding', 'Kirigami', 'Paper crane'],
    keywords: /origami|paper|\bfold|kirigami|tessellat/i,
  },
  {
    name: 'tea',
    seeds: ['Tea', 'Green tea', 'Matcha', 'Japanese tea ceremony', 'Oolong', 'Camellia sinensis'],
    keywords: /\btea\b|\bteas\b|camellia|matcha|oolong|chanoyu|darjeeling|pu'er|tisane|teapot/i,
  },
];

const PER_AREA = 22;
/** How many of a page's links (in article order) join the crawl frontier. */
const FRONTIER_LINKS = 100;
const HOP = 10;
const SKIP_TITLE = /^(?:List|Lists|Outline|Index|Timeline|Glossary) of /;

/** Pages that must not be in the corpus, for the divergence test. 3 botany-leaning, 3 jazz-leaning, 2 neutral. */
const UNSEEN: Readonly<Record<Lean, readonly string[]>> = {
  botany: ['Hortus Malabaricus', 'Nature printing', 'Elizabeth Blackwell (illustrator)'],
  jazz: ['Village Vanguard', 'The Real Book', 'Thelonious Monk'],
  neutral: ['Suspension bridge', 'Bicycle'],
};

const SOURCES_DIR = fileURLToPath(new URL('./', import.meta.url));

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function fits(area: Area, c: Candidate): boolean {
  return !SKIP_TITLE.test(c.title) && area.keywords.test(`${c.title} | ${c.topics.slice(1).join(' | ')} | ${c.summary}`);
}

async function crawl(wiki: WikipediaSource): Promise<Corpus> {
  const looked = new Map<string, Candidate | null>();
  const taken = new Map<string, { area: string; candidate: Candidate; links: string[] }>();
  for (const area of AREAS) {
    const seeds = new Set(area.seeds.map(normalizeTitle));
    const queued = new Set<string>();
    const frontier: string[] = [];
    const enqueue = (titles: readonly string[]) => {
      for (const t of titles) {
        if (queued.has(t)) continue;
        queued.add(t);
        frontier.push(t);
      }
    };
    enqueue([...seeds]);
    let count = 0;
    while (count < PER_AREA && frontier.length > 0) {
      const batch = frontier.splice(0, 50);
      const unknown = batch.filter((t) => !looked.has(t));
      for (const [t, c] of await wiki.lookup(unknown)) looked.set(t, c);
      const accepted: Candidate[] = [];
      for (const t of batch) {
        const c = looked.get(t);
        if (c == null || taken.has(c.title) || accepted.some((a) => a.title === c.title)) continue;
        if (!seeds.has(t) && !fits(area, c)) continue;
        accepted.push(c);
        if (count + accepted.length >= PER_AREA) break;
      }
      const links = await wiki.links(accepted.map((c) => c.title));
      for (const c of accepted) taken.set(c.title, { area: area.name, candidate: c, links: links.get(c.title) ?? [] });
      // Round-robin so the next layer draws from every page just taken, not only the first.
      for (let k = 0; k < FRONTIER_LINKS; k++) enqueue(accepted.flatMap((c) => taken.get(c.title)?.links[k] ?? []));
      count += accepted.length;
    }
    const missing = area.seeds.filter((s) => looked.get(normalizeTitle(s)) == null);
    console.info(`${area.name}: ${count} pages${missing.length > 0 ? `; missing seeds ${missing.join(', ')}` : ''}`);
  }

  const aliases = await wiki.aliases([...taken.keys()]);
  const resolve = new Map<string, string>();
  for (const [t, c] of looked) if (c != null && taken.has(c.title)) resolve.set(t, c.title);
  for (const [title, redirects] of aliases) for (const r of redirects) resolve.set(normalizeTitle(r), title);
  for (const title of taken.keys()) resolve.set(title, title);

  const pages = [...taken.values()].map(({ area, candidate, links }): CorpusPage => ({
    area,
    candidate,
    links: [...new Set(links.flatMap((t) => resolve.get(t) ?? []))].filter((t) => t !== candidate.title) as TopicKey[],
    aliases: aliases.get(candidate.title) ?? [],
  }));
  const mismatched = pages.filter((p) => p.candidate.url !== p.candidate.canonicalUrl);
  if (mismatched.length > 0) throw new Error(`MediaWiki and wikipediaUrl disagree: ${mismatched.map((p) => p.candidate.url).join(', ')}`);
  return { recordedAt: new Date().toISOString(), areas: AREAS.map(({ name, seeds }) => ({ name, seeds })), pages };
}

/** Botanical illustration → X → Ultramarine where each page links to the next and each step is within one hop's look. */
async function heroChain(corpus: Corpus): Promise<Candidate[]> {
  const source = new FixtureSource(corpus);
  const page = (title: string) => {
    const p = corpus.pages.find((q) => q.candidate.title === title);
    if (p === undefined) throw new Error(`${title} is not in the corpus`);
    return p;
  };
  const start = page('Botanical illustration');
  const end = page('Ultramarine');
  const none = new Set<CanonicalUrl>();
  let best: { rank: number; chain: Candidate[] } | undefined;
  for (const [i, mid] of (await source.next(start.candidate, HOP, none)).entries()) {
    if (!start.links.includes(mid.topics[0]) || !page(mid.title).links.includes(end.candidate.topics[0])) continue;
    const j = (await source.next(mid, HOP, none)).findIndex((c) => c.canonicalUrl === end.candidate.canonicalUrl);
    if (j >= 0 && (best === undefined || Math.max(i, j) < best.rank)) best = { rank: Math.max(i, j), chain: [start.candidate, mid, end.candidate] };
  }
  if (best === undefined) throw new Error(`no linked chain Botanical illustration → X → Ultramarine within ${HOP} per hop`);
  console.info(`hero chain: ${best.chain.map((c) => c.title).join(' → ')} (worst rank ${best.rank + 1} of ${HOP})`);
  return best.chain;
}

async function unseenPool(wiki: WikipediaSource, corpus: Corpus): Promise<Record<Lean, Candidate[]>> {
  const inCorpus = new Set(corpus.pages.map((p) => p.candidate.canonicalUrl));
  const pool = {} as Record<Lean, Candidate[]>;
  for (const lean of Object.keys(UNSEEN) as Lean[]) {
    const found = await wiki.candidates(UNSEEN[lean]);
    if (found.length !== UNSEEN[lean].length) throw new Error(`unseen ${lean}: only ${found.map((c) => c.title).join(', ')} resolved`);
    const overlap = found.filter((c) => inCorpus.has(c.canonicalUrl));
    if (overlap.length > 0) throw new Error(`unseen ${lean}: ${overlap.map((c) => c.title).join(', ')} is in the corpus`);
    pool[lean] = found;
  }
  return pool;
}

/** Real responses for the calls wikipedia.test.ts makes. */
async function samples(): Promise<void> {
  const recorded: Samples = {};
  const wiki = new WikipediaSource({ fetch: recordingFetch(recorded) });
  const none = new Set<CanonicalUrl>();
  const [top] = await wiki.search('Ultramarine' as TopicKey, 5, none);
  await wiki.search('Ultramarine' as TopicKey, 5, new Set([top.canonicalUrl]));
  await wiki.next(top, 6, none);
  for (const label of ['colour', 'Mercury', 'Nonexistentpagexyz123']) await wiki.resolveTopic(label);
  await wiki.candidates(SAMPLE_BATCH);
  await wiki.serendipity(4, 1, none);
  writeJson(`${SOURCES_DIR}samples/wikipedia.json`, recorded);
}

/**
 * Re-applies topicCategories to the recorded files without the network. Raw categories weren't recorded, so a page
 * keeps the categories that survive and may carry fewer than six. Safe to rerun.
 */
function refilterRecordedTopics(): void {
  const refilter = (v: unknown, what: string) => {
    const page = obj(v, what);
    const [title, ...categories] = strs(page.topics, `${what}.topics`);
    return { ...page, topics: [title, ...topicCategories(categories)] };
  };
  const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
  const corpus = obj(readJson(CORPUS_PATH), 'corpus');
  writeJson(CORPUS_PATH, { ...corpus, pages: arr(corpus.pages, 'pages').map((p, i) => refilter(p, `pages[${i}]`)) });
  writeJson(HERO_CHAIN_PATH, arr(readJson(HERO_CHAIN_PATH), 'hero').map((c, i) => refilter(c, `hero[${i}]`)));
  const unseen = Object.entries(obj(readJson(UNSEEN_PATH), 'unseen'));
  writeJson(UNSEEN_PATH, Object.fromEntries(unseen.map(([lean, list]) => [lean, arr(list, lean).map((c, i) => refilter(c, `${lean}[${i}]`))])));
  console.info(`topics re-filtered: ${loadCorpus().pages.length} pages, ${loadHeroChain().length} in the hero chain, ${Object.values(loadUnseenPool()).flat().length} unseen`);
}

async function main(step: string): Promise<void> {
  if (step === 'topics') return refilterRecordedTopics();
  const wiki = new WikipediaSource();
  if (step === 'all') {
    const corpus = parseCorpus(corpusJson(await crawl(wiki)));
    writeJson(CORPUS_PATH, corpusJson(corpus));
    console.info(`corpus: ${corpus.pages.length} pages, ${corpus.pages.reduce((n, p) => n + p.links.length, 0)} links`);
  }
  if (step === 'all' || step === 'pools') {
    const corpus = loadCorpus();
    writeJson(HERO_CHAIN_PATH, await heroChain(corpus));
    writeJson(UNSEEN_PATH, await unseenPool(wiki, corpus));
  }
  if (step === 'all' || step === 'samples') await samples();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv[2] ?? 'all');
