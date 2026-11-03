import { salt } from '../../../src/core/hash';
import type {
  Candidate,
  EventRef,
  Experience,
  InterestDelta,
  InterestStage,
  Judgment,
  Mind,
  MindContext,
  PostcardAsk,
  PostcardWords,
  ReflectionProposal,
  Temperament,
  TopicKey,
} from '../../../src/muse/contract';
import { templateWords } from './postcard';

// ─── text ───────────────────────────────────────────────────────────────────

const words = (text: string): string[] => text.toLowerCase().match(/\p{L}+/gu) ?? [];

// The question templates. Their filler words are stopwords, so judging against a question reads only its topic and title.
const QUESTIONS_WITH_RECENT = [
  (topic: string, recent: string) => `How does ${topic} connect to ${recent}?`,
  (topic: string, recent: string) => `Why does ${recent} keep leading me back to ${topic}?`,
  (topic: string, recent: string) => `What do ${recent} and ${topic} have in common?`,
];
const QUESTIONS_ALONE = [
  (topic: string) => `What came before ${topic}?`,
  (topic: string) => `Who first wrote about ${topic}?`,
  (topic: string) => `Where else does ${topic} turn up?`,
];

// Function words and words every Wikipedia summary uses.
const STOPWORDS = new Set([
  ...`
  about above after again against all also although among and any are around because been before being below
  between both but can could did does doing down during each else few for from further had has have having her
  here hers him his how into its itself just many may might more most much nor not now off once only other our
  out over own same she should some such than that the their them then there these they this those through too
  under until upon very was were what when where which while who whom why will with would yet you your
  known called used using use usually often made make one two three first second third new based became
  become becomes since within various several number large small part form forms type types kind include
  includes including century centuries term terms refers refer list article articles page pages category
  wikipedia stub name named year years time way like
  `
    .split(/\s+/)
    .filter(Boolean),
  ...[...QUESTIONS_WITH_RECENT.map((q) => q('', '')), ...QUESTIONS_ALONE.map((q) => q(''))].flatMap((q) => words(q)),
]);

// Prefix-5 truncation is a crude stemmer that folds botany, botanical and botanist into one term.
const stem = (word: string): string =>
  (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word).slice(0, 5);

const terms = (text: string): string[] => [
  ...new Set(
    words(text)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map(stem),
  ),
];

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
// A setext underline or a thematic break ends a section too.
const RULE = /^\s{0,3}(?:=+|-+|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

/**
 * The bullet items under any heading named in `sections` (case-insensitive), up to the next heading or rule.
 * Everything else in the document is never read.
 */
function bulletsUnder(markdown: string, sections: readonly string[]): string[] {
  const items: string[] = [];
  let inside = false;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      inside = sections.includes(heading[1].replace(/:$/, '').trim().toLowerCase());
    } else if (RULE.test(line)) {
      inside = false;
    } else if (inside) {
      const bullet = BULLET.exec(line);
      if (bullet) items.push(bullet[1]);
    }
  }
  return items;
}

/** A bullet's head phrase: link text kept, emphasis dropped, cut before any aside (":", "(", ",", " - "). */
const headPhrase = (item: string): string =>
  item
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .split(/\s[-–—]\s|[:;(,.!?]/)[0]
    .trim();

// ─── judge ──────────────────────────────────────────────────────────────────

const W_OVERLAP = 0.55;
const W_QUESTION = 0.25;
const W_NOVELTY = 0.2;

/** How central a term is to a page, by where it appears. */
const PLACE = { title: 0.9, category: 0.8, summary: 0.5 } as const;
/** An interest that is the page's own topic, or one of its categories, outranks any term match. */
const TOPIC_MATCH = { own: 1, category: 0.85 } as const;

/** stem → its strongest PLACE weight on the page. */
type Profile = ReadonlyMap<string, number>;

function profile(c: Candidate): Profile {
  const p = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const t of terms(text)) p.set(t, Math.max(p.get(t) ?? 0, weight));
  };
  add(c.title, PLACE.title);
  add(c.topics[0] ?? '', PLACE.title);
  for (const category of c.topics.slice(1)) add(category, PLACE.category);
  add(c.summary, PLACE.summary);
  return p;
}

/** How squarely the page is about `topic`, in [0, 1]. */
function match(topic: TopicKey, c: Candidate, page: Profile): number {
  if (c.topics[0] === topic) return TOPIC_MATCH.own;
  if (c.topics.includes(topic)) return TOPIC_MATCH.category;
  const ts = terms(topic);
  return ts.length === 0 ? 0 : ts.reduce((sum, t) => sum + (page.get(t) ?? 0), 0) / ts.length;
}

/** Soft OR, 1 − Π(1 − x). One strong hit is enough, more hits add up, and the total stays in [0, 1]. */
const softOr = (xs: readonly number[]): number => 1 - xs.reduce((rest, x) => rest * (1 - x), 1);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;
const pick = <T>(options: readonly T[], key: string): T => options[salt(key) % options.length];

const KEEP_REASONS = [
  (t: string) => `This brings me right back to ${t}.`,
  (t: string) => `It sits right beside my love of ${t}.`,
  (t: string) => `Another thread of ${t} I want to follow.`,
  (t: string) => `I can never walk past anything about ${t}.`,
];
const ECHO_REASONS = [
  (t: string) => `A faint echo of ${t}, but only faint.`,
  (t: string) => `It brushes against ${t} without quite reaching it.`,
];
const QUESTION_REASONS = [
  (title: string) => `${title} might hold part of my answer.`,
  (title: string) => `This could help with the thing I keep wondering about: ${title}.`,
];
const STRANGER_REASONS = [
  (title: string) => `${title} isn't my kind of thing, at least not yet.`,
  () => `Nothing here pulls at me yet.`,
];

function judgeOne(ctx: MindContext, c: Candidate, questionTerms: readonly string[]): Judgment {
  const page = profile(c);
  const strongest = Math.max(0, ...ctx.interests.map((i) => i.affinity + i.salience));
  const hits = ctx.interests.map((i) => ({
    topic: i.topic,
    hit: strongest > 0 ? ((i.affinity + i.salience) / strongest) * match(i.topic, c, page) : 0,
  }));
  const overlap = softOr(hits.map((h) => h.hit));

  // With no open question, Muse's interests are the question.
  const fit = questionTerms.length === 0 ? overlap : softOr(questionTerms.map((t) => page.get(t) ?? 0));

  // Goldilocks. Best when related but not already familiar, and explorers like it less familiar than homebodies.
  const known = ctx.interests.find((i) => i.topic === c.topics[0])?.affinity ?? 0;
  const peak = 0.6 - 0.3 * ctx.temperament.novelty;
  const novelty = (1 - known) * Math.max(0, 1 - ((overlap - peak) / 0.6) ** 2);

  const score = round(clamp(W_OVERLAP * overlap + W_QUESTION * fit + W_NOVELTY * novelty, 0, 1), 3);

  const lead = hits.reduce((best, h) => (h.hit > best.hit ? h : best), { topic: '' as TopicKey, hit: 0 });
  const key = c.canonicalUrl;
  const reason =
    questionTerms.length > 0 && fit > overlap && fit >= 0.5
      ? pick(QUESTION_REASONS, key)(c.title)
      : lead.hit > PLACE.summary
        ? pick(KEEP_REASONS, key)(lead.topic)
        : lead.hit > 0
          ? pick(ECHO_REASONS, key)(lead.topic)
          : pick(STRANGER_REASONS, key)(c.title);

  return { canonicalUrl: c.canonicalUrl, score, reason };
}

// ─── reflect ────────────────────────────────────────────────────────────────

/** Experiences that count as a source, because Muse now holds the page. */
const HELD: ReadonlySet<Experience['kind']> = new Set(['kept', 'gift']);
const STAGE_RANK: Readonly<Record<InterestStage, number>> = { fading: 0, hypothesis: 1, emerging: 2, established: 3 };
const DAY_MS = 86_400_000;

/** The stage that `sources` distinct pages over `days` distinct days support (the validator re-checks it). */
const supportedStage = (sources: number, days: number): InterestStage =>
  sources >= 4 && days >= 2 ? 'established' : 'emerging';

function reflectOn(ctx: MindContext, experiences: readonly Experience[]): ReflectionProposal {
  const byTopic = new Map<TopicKey, Experience[]>();
  for (const e of experiences) {
    if (!HELD.has(e.kind) || e.canonicalUrl === undefined) continue;
    for (const topic of new Set(e.topics)) byTopic.set(topic, [...(byTopic.get(topic) ?? []), e]);
  }

  const deltas: (InterestDelta & { weight: number })[] = [];
  for (const [topic, held] of byTopic) {
    const sources = new Set(held.map((e) => e.canonicalUrl)).size;
    // A page the owner liked counts twice.
    const weight = sources + new Set(held.filter((e) => e.liked).map((e) => e.canonicalUrl)).size;
    if (weight < 2) continue;
    const days = new Set(held.map((e) => Math.floor(e.at / DAY_MS))).size;
    const stage = supportedStage(sources, days);
    const current = ctx.interests.find((i) => i.topic === topic)?.stage ?? 'fading';
    deltas.push({
      topic,
      dAffinity: round(Math.min(0.2, 0.05 * weight), 2),
      ...(STAGE_RANK[stage] > STAGE_RANK[current] ? { stage } : {}),
      evidence: held.map((e): EventRef => e.ref),
      reason: sources > 1 ? `${sources} separate finds keep pointing me to ${topic}.` : `My owner liked what I found about ${topic}.`,
      weight,
    });
  }
  deltas.sort((a, b) => b.weight - a.weight || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));

  return {
    deltas: deltas.map(({ weight: _, ...d }) => d),
    narrative: deltas.length > 0 ? `Lately I keep finding my way back to ${deltas[0].topic}.` : '',
    questions: [],
  };
}

// ─── extractInterests ───────────────────────────────────────────────────────

/** The only sections ever read. Anything else in MEMORY.md or SOUL.md never reaches the Mind's output. */
const INTEREST_SECTIONS: Readonly<Record<'memory' | 'soul', readonly string[]>> = {
  memory: ['interests', 'likes'],
  soul: ['interests'],
};
const MAX_LABEL_WORDS = 5;
const MAX_LABEL_CHARS = 60;

function extract(text: string, from: 'memory' | 'soul'): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of bulletsUnder(text, INTEREST_SECTIONS[from])) {
    const label = headPhrase(item);
    const wordCount = label.split(/\s+/).length;
    if (!/\p{L}/u.test(label) || wordCount > MAX_LABEL_WORDS || label.length > MAX_LABEL_CHARS) continue;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    labels.push(label);
  }
  return labels;
}

// ─── estimateTemperament ────────────────────────────────────────────────────

/** Words in the soul that nudge a trait up or down by CUE_STEP each (counted once per cue). */
const CUES: Readonly<Record<keyof Temperament, { readonly up: readonly string[]; readonly down: readonly string[] }>> = {
  curiosity: { up: ['curious', 'curiosity', 'wonder', 'question', 'learn', 'explore'], down: ['incurious', 'indifferent'] },
  focus: { up: ['focus', 'deep', 'obsessed', 'patient', 'detail', 'meticulous'], down: ['restless', 'scattered', 'flit', 'distracted', 'impatient'] },
  sociability: { up: ['friend', 'social', 'chat', 'together', 'share', 'gather', 'outgoing'], down: ['quiet', 'alone', 'solitary', 'introvert', 'shy', 'private'] },
  whimsy: { up: ['playful', 'whimsy', 'whimsical', 'silly', 'photo', 'camera', 'delight', 'dream'], down: ['serious', 'practical', 'sober'] },
  novelty: { up: ['new', 'novel', 'adventure', 'wander', 'travel', 'strange', 'unknown', 'explore'], down: ['familiar', 'home', 'homebody', 'routine', 'nostalgia', 'cozy', 'old'] },
};
const CUE_STEP = 0.1;

function estimate(soul: string): Temperament {
  const present = new Set(words(soul).map(stem));
  const trait = ({ up, down }: (typeof CUES)[keyof Temperament]) => {
    const count = (cues: readonly string[]) => new Set(cues.map(stem).filter((c) => present.has(c))).size;
    return round(clamp(0.5 + CUE_STEP * (count(up) - count(down)), 0.1, 0.9), 2);
  };
  return {
    curiosity: trait(CUES.curiosity),
    focus: trait(CUES.focus),
    sociability: trait(CUES.sociability),
    whimsy: trait(CUES.whimsy),
    novelty: trait(CUES.novelty),
  };
}

// ─── The Mind ───────────────────────────────────────────────────────────────

/** A deterministic Mind with no IO, for tests, fast-forward, and every Muse but the hero. */
export class HeuristicMind implements Mind {
  judge(ctx: MindContext, candidates: readonly Candidate[]): Promise<Judgment[]> {
    const questionTerms = ctx.question === null ? [] : terms(ctx.question);
    return Promise.resolve(candidates.map((c) => judgeOne(ctx, c, questionTerms)));
  }

  proposeQuestion(_ctx: MindContext, topic: TopicKey, recent: readonly Candidate[]): Promise<string> {
    const other = recent.findLast((c) => c.title.toLowerCase() !== topic.toLowerCase())?.title;
    return Promise.resolve(
      other === undefined
        ? pick(QUESTIONS_ALONE, topic)(topic)
        : pick(QUESTIONS_WITH_RECENT, `${topic}|${other}`)(topic, other),
    );
  }

  reflect(ctx: MindContext, experiences: readonly Experience[]): Promise<ReflectionProposal> {
    return Promise.resolve(reflectOn(ctx, experiences));
  }

  extractInterests(text: string, from: 'memory' | 'soul'): Promise<string[]> {
    return Promise.resolve(extract(text, from));
  }

  writePostcard(ctx: MindContext, ask: PostcardAsk): Promise<PostcardWords> {
    return Promise.resolve(templateWords(ctx, ask));
  }

  estimateTemperament(soul: string): Promise<Temperament> {
    return Promise.resolve(estimate(soul));
  }
}
