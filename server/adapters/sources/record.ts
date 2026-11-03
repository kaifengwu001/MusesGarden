// Records the topic map from its live API: the corpus, the hero chain, the unseen pool, and the HTTP samples the
// source tests replay. Muse's finds are recorded by server/cli/record-media.ts instead. With no step it re-records everything; `pools` and `samples` reuse corpus.json,
// and `topics` re-filters the recorded topics offline.
//   npx tsx server/adapters/sources/record.ts [all|pools|samples|topics]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalUrl, TopicKey } from '../../../src/muse/contract';
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
import { normalizeTitle, topicCategories, WikipediaSource, type TopicPage } from './wikipedia';

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
  // Kai's cast (2026-11-02): the interests its Muses brought that no area above covered.
  {
    name: 'gardening and flowers',
    seeds: ['Gardening', 'Flower', 'Flower garden', 'Cottage garden', 'Horticulture', 'Perennial'],
    keywords: /garden|horticult|flower|\bblooms?\b|perennial|\bbulbs?\b|compost|seedling|cultivar|prun|\broses?\b|herbaceous|ornamental plant/i,
  },
  {
    name: 'soup',
    seeds: ['Soup', 'Stock (food)', 'Minestrone', 'Borscht', 'Miso soup', 'Gazpacho', 'Chowder'],
    keywords: /\bsoups?\b|\bstews?\b|broth|\bstock\b|chowder|bisque|potage|consomm|pottage|bouillon|ramen|borscht|gazpacho|minestrone|dashi/i,
  },
  {
    name: 'hiking',
    seeds: ['Hiking', 'Long-distance trail', 'Backpacking (hiking)', 'Trail', 'Appalachian Trail'],
    keywords: /\bhik|\btrails?\b|trek|backpack|walking|hillwalk|rambl|footpath|mountaineer|long-distance|national park|wilderness|camping/i,
  },
  {
    name: 'bread and baking',
    seeds: ['Baking', 'Bread', 'Pastry', 'Croissant', 'Oven', 'Bakery'],
    keywords: /\bbak|bread|pastr|dough|\bloa(f|ves)\b|\bflour\b|\bovens?\b|\bcakes?\b|biscuit|croissant|\bbuns?\b|brioche|baguette|leaven|\bwheat\b|\brye\b/i,
  },
  {
    name: 'coffee',
    seeds: ['Coffee', 'Espresso', 'Coffee roasting', 'Coffeehouse', 'Coffea arabica', 'Coffee preparation'],
    keywords: /coffee|espresso|\bcaf[eé]s?\b|roast|barista|arabica|robusta|\blatte\b|cappuccino|coffea|caffeine|moka|brewing/i,
  },
  {
    name: 'home organisation',
    seeds: ['Professional organizing', 'Simple living', 'Housekeeping', 'Marie Kondo', 'The Life-Changing Magic of Tidying Up', 'Pantry'],
    keywords: /organi[sz]|declutter|\btid(y|ying)\b|storage|housekeep|household|\bhomes?\b|closet|cupboard|\bshel(f|ves)\b|minimalis|simple living|cleaning|pantry|laundry|home economics/i,
  },
  {
    name: 'Japanese architecture',
    seeds: ['Japanese architecture', 'Minka', 'Sukiya-zukuri', 'Chashitsu', 'Japanese carpentry', 'Shoin-zukuri', 'Machiya'],
    keywords: /japan|zukuri|minka|chashitsu|tatami|sh[oō]ji|fusuma|engawa|torii|pagoda|shinto shrine|buddhist temple|machiya|\bkura\b|kyoto|nara\b|edo period|heian/i,
  },
  {
    name: 'sculpture and wood carving',
    seeds: ['Sculpture', 'Wood carving', 'Relief', 'Netsuke', 'Whittling', 'Chip carving'],
    keywords: /sculpt|\bcarv|relief|\bstatues?\b|whittl|chisel|netsuke|bronze|marble|figurine|woodcraft|woodwork|\bbust\b|monument/i,
  },
  {
    name: 'folk music and the flute',
    seeds: ['Folk music', 'Flute', 'Tin whistle', 'Fife (instrument)', 'Shakuhachi', 'Fiddle'],
    keywords: /\bfolk\b|flute|whistle|\bfifes?\b|bagpipe|\bpipes?\b|fiddle|ballad|shakuhachi|recorder \(musical|piccolo|traditional music|dance music|woodwind|\bjigs?\b|sea shant|morris danc/i,
  },
  {
    name: 'agriculture and farming',
    seeds: ['Agriculture', 'Farm', 'Harvest', 'Crop rotation', 'Paddy field', 'Terrace (earthworks)'],
    keywords: /agricult|\bfarm|harvest|\bcrops?\b|tillage|plough|\bplow|\brice\b|paddy|terrac|irrigat|cereal|\bgrains?\b|livestock|orchard|sowing|agronom|pastoral|smallholding/i,
  },
  {
    name: 'furniture',
    seeds: ['Furniture', 'Chair', 'Windsor chair', 'Shaker furniture', 'Cabinetry', 'Woodworking'],
    keywords: /furnitur|\bchairs?\b|\btables?\b|cabinet|\bstools?\b|joiner|woodwork|upholster|shaker|\bbench|wardrobe|\bdesks?\b|\bsofas?\b|carpentr|chest of drawers|marquetry|veneer/i,
  },
  {
    name: 'kites and hang gliding',
    seeds: ['Kite', 'Hang gliding', 'Paragliding', 'Kite types', 'Gliding', 'Kitesurfing'],
    keywords: /\bkites?\b|glid|paraglid|soaring|\bwings?\b|thermal|aviation|\bflight\b|sailplane|parachut|kiteboard|kitesurf|aerodynam|\blift\b|windsurf|ultralight/i,
  },
  {
    name: 'Dutch Golden Age painting',
    seeds: ['Dutch Golden Age painting', 'Johannes Vermeer', 'Rembrandt', 'Girl with a Pearl Earring', 'The Night Watch', 'Still life'],
    keywords: /dutch|netherland|flemish|vermeer|rembrandt|golden age|frans hals|still life|genre (art|painting|works)|baroque|delft|haarlem|amsterdam|\boil paint|vanitas|portrait/i,
  },
  {
    name: 'Impressionism and abstract art',
    seeds: ['Impressionism', 'Claude Monet', 'Oil painting', 'Wassily Kandinsky', 'Abstract art', 'Der Blaue Reiter'],
    keywords: /impressionis|monet|renoir|degas|pissarro|kandinsky|abstract|expressionis|blaue reiter|bauhaus|\bpaint(ing|er|ers)\b|oil paint|canvas|plein air|modern art|fauvis|cubis|color theory|colour theory/i,
  },
  {
    name: 'science fiction film',
    seeds: ['Science fiction film', 'Science fiction', 'Film', '2001: A Space Odyssey', 'Blade Runner', 'Metropolis (1927 film)'],
    keywords: /science fiction|sci-fi|\bfilms?\b|cinema|\bmovies?\b|film director|screenplay|space opera|cyberpunk|dystopi|special effects|visual effects|\baliens?\b/i,
  },
  {
    name: 'artificial intelligence and technology',
    seeds: ['Artificial intelligence', 'Technology', 'Machine learning', 'Robotics', 'Computer', 'Alan Turing'],
    keywords: /artificial intelligence|machine learning|neural network|\brobot|comput|technolog|algorithm|automat|software|turing|deep learning|chatbot|language model|engineering|invention/i,
  },
  {
    name: 'physics',
    seeds: ['Physics', 'Optics', 'Light', 'Classical mechanics', 'Aerodynamics', 'Wind'],
    keywords: /physic|optic|\blight\b|mechanic|aerodynam|fluid dynamic|refract|diffract|\bwaves?\b|\bforces?\b|motion|quantum|relativ|thermodynam|newton|electromagnet|\bwinds?\b|atmospher|turbulen/i,
  },
  {
    name: 'photography',
    seeds: ['Photography', 'Camera', 'Landscape photography', 'Long-exposure photography', 'Photographic film', 'Street photography'],
    keywords: /photograph|camera|\blens(es)?\b|exposure|darkroom|shutter|aperture|cinematograph|daguerre|negative|photographic/i,
  },
  {
    name: 'travel',
    seeds: ['Travel', 'Tourism', 'Travel literature', 'Backpacking (travel)', 'Grand Tour'],
    keywords: /travel|touris|journey|voyage|pilgrim|backpack|guidebook|itinerar|expedition|road trip|grand tour|hostel|explor/i,
  },
  {
    name: 'interior design',
    seeds: ['Interior design', 'Interior architecture', 'Vernacular architecture', 'Courtyard house', 'Siheyuan', 'Feng shui'],
    keywords: /interior|architect|\bdesign|\brooms?\b|\bhouses?\b|dwelling|courtyard|vernacular|decor|furnish|feng shui|siheyuan|floor plan|lighting|wallpaper/i,
  },
  {
    name: 'dreams',
    seeds: ['Dream', 'Lucid dream', 'Sleep', 'Rapid eye movement sleep', 'Nightmare', 'Dream interpretation'],
    keywords: /dream|sleep|nightmare|lucid|\brem\b|unconscious|hypnagog|reverie|oneir|consciousness|hallucinat|imagination/i,
  },
  {
    name: 'psychology and therapy',
    seeds: ['Psychology', 'Psychotherapy', 'Cognitive behavioral therapy', 'Emotion', 'Mindfulness', 'Positive psychology'],
    keywords: /psycholog|therap|emotion|\bmind\b|cognit|counsel|mental|behavio|well-?being|mindful|anxiety|empathy|personality|psychiatr|self-/i,
  },
  {
    name: 'fantasy literature',
    seeds: ['Harry Potter', 'Fantasy literature', 'Hogwarts', 'Magic in fiction', 'The Hobbit', 'Magic (supernatural)'],
    keywords: /fantasy|\bmagic|wizard|witch|harry potter|hogwarts|rowling|tolkien|dragon|fairy tale|mytholog|\bspells?\b|quidditch|sorcer|\bnovels?\b|children's literature/i,
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
/** Those pages never join the corpus, whichever area's crawl reaches them. */
const HELD_OUT = new Set(Object.values(UNSEEN).flat().map(normalizeTitle));

const SOURCES_DIR = fileURLToPath(new URL('./', import.meta.url));

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function fits(area: Area, c: TopicPage): boolean {
  return !SKIP_TITLE.test(c.title) && area.keywords.test(`${c.title} | ${c.topics.slice(1).join(' | ')} | ${c.summary}`);
}

async function crawl(wiki: WikipediaSource): Promise<Corpus> {
  const looked = new Map<string, TopicPage | null>();
  const taken = new Map<string, { area: string; candidate: TopicPage; links: string[] }>();
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
      const accepted: TopicPage[] = [];
      for (const t of batch) {
        const c = looked.get(t);
        if (c == null || HELD_OUT.has(c.title) || taken.has(c.title) || accepted.some((a) => a.title === c.title)) continue;
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
async function heroChain(corpus: Corpus): Promise<TopicPage[]> {
  const source = new FixtureSource(corpus);
  const page = (title: string) => {
    const p = corpus.pages.find((q) => q.candidate.title === title);
    if (p === undefined) throw new Error(`${title} is not in the corpus`);
    return p;
  };
  const start = page('Botanical illustration');
  const end = page('Ultramarine');
  const none = new Set<CanonicalUrl>();
  let best: { rank: number; chain: TopicPage[] } | undefined;
  for (const [i, mid] of (await source.next(start.candidate, HOP, none)).entries()) {
    if (!start.links.includes(mid.topics[0]) || !page(mid.title).links.includes(end.candidate.topics[0])) continue;
    const j = (await source.next(mid, HOP, none)).findIndex((c) => c.canonicalUrl === end.candidate.canonicalUrl);
    if (j >= 0 && (best === undefined || Math.max(i, j) < best.rank)) best = { rank: Math.max(i, j), chain: [start.candidate, mid, end.candidate] };
  }
  if (best === undefined) throw new Error(`no linked chain Botanical illustration → X → Ultramarine within ${HOP} per hop`);
  console.info(`hero chain: ${best.chain.map((c) => c.title).join(' → ')} (worst rank ${best.rank + 1} of ${HOP})`);
  return best.chain;
}

async function unseenPool(wiki: WikipediaSource, corpus: Corpus): Promise<Record<Lean, TopicPage[]>> {
  const inCorpus = new Set(corpus.pages.map((p) => p.candidate.canonicalUrl));
  const pool = {} as Record<Lean, TopicPage[]>;
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
