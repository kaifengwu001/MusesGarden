import { describe, expect, it } from 'vitest';
import type { Candidate, CanonicalUrl, EventRef, Experience, Instant, InterestStage, MindContext, TopicKey } from '../../../src/muse/contract';
import { HeuristicMind } from './heuristic';

// KEEP_THRESHOLD in the plan: Muse keeps a page scoring at least 0.75.
const KEEP = 0.75;

const topic = (s: string) => s as TopicKey;
const wiki = (title: string) => `https://en.wikipedia.org/wiki/${title.replaceAll(' ', '_')}` as CanonicalUrl;
const page = (title: string, summary: string, categories: string[]): Candidate => ({
  origin: 'wikipedia',
  url: wiki(title),
  canonicalUrl: wiki(title),
  title,
  summary,
  topics: [title, ...categories].map(topic),
});

const botanicalIllustration = page(
  'Botanical illustration',
  'Botanical illustration is the art of depicting the form, color, and details of plant species, frequently in watercolor paintings. They must be scientifically accurate but often also have an artistic component.',
  ['Botanical art', 'Scientific illustration', 'Botany', 'Plants in art'],
);
const modalJazz = page(
  'Modal jazz',
  'Modal jazz is jazz that uses musical modes rather than chord progressions as a harmonic framework. Pioneered in the late 1950s by Miles Davis and others, it gave improvisers long stretches of a single scale.',
  ['Jazz genres', 'Jazz terminology', 'Improvisation'],
);
const tide = page(
  'Tide',
  'Tides are the rise and fall of sea levels caused by the combined effects of the gravitational forces exerted by the Moon and the Sun, and the rotation of the Earth.',
  ['Oceanography', 'Geodesy'],
);
const lapis = page(
  'Lapis lazuli',
  'Lapis lazuli is a deep-blue metamorphic rock used as a semi-precious stone. Ground into powder, it was the source of the pigment ultramarine, prized by Renaissance painters.',
  ['Gemstones', 'Mineral pigments'],
);

const interest = (name: string, affinity: number, salience: number, stage: InterestStage = 'emerging') => ({
  topic: topic(name),
  affinity,
  salience,
  stage,
});

const temperament = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 };

const botanist: MindContext = {
  name: 'Fern',
  soul: 'I love plants.',
  temperament,
  interests: [interest('Botany', 0.6, 0.5, 'established'), interest('Botanical illustration', 0.4, 0.3), interest('Lichen', 0.3, 0.2, 'hypothesis')],
  question: null,
};
const jazzFan: MindContext = {
  name: 'Miles',
  soul: 'I love music.',
  temperament,
  interests: [interest('Jazz', 0.6, 0.5, 'established'), interest('Saxophone', 0.4, 0.3), interest('Improvisation', 0.3, 0.2, 'hypothesis')],
  question: null,
};

const mind = new HeuristicMind();
const scores = async (ctx: MindContext, pages: Candidate[]) => (await mind.judge(ctx, pages)).map((j) => j.score);

describe('HeuristicMind.judge', () => {
  it('is deterministic: the same input gives the same judgments', async () => {
    const pages = [botanicalIllustration, modalJazz, tide, lapis];
    expect(await new HeuristicMind().judge(botanist, pages)).toEqual(await new HeuristicMind().judge(botanist, pages));
  });

  it('scores every candidate in input order', async () => {
    const judged = await mind.judge(botanist, [tide, botanicalIllustration, modalJazz]);
    expect(judged.map((j) => j.canonicalUrl)).toEqual([tide.canonicalUrl, botanicalIllustration.canonicalUrl, modalJazz.canonicalUrl]);
    for (const j of judged) {
      expect(j.score).toBeGreaterThanOrEqual(0);
      expect(j.score).toBeLessThanOrEqual(1);
      expect(j.reason.length).toBeGreaterThan(0);
    }
  });

  it('makes a botanist and a jazz fan keep different pages', async () => {
    const [botanyOnBotany, botanyOnJazz, botanyOnTide] = await scores(botanist, [botanicalIllustration, modalJazz, tide]);
    const [jazzOnBotany, jazzOnJazz, jazzOnTide] = await scores(jazzFan, [botanicalIllustration, modalJazz, tide]);

    expect(botanyOnBotany).toBeGreaterThanOrEqual(KEEP);
    expect(jazzOnJazz).toBeGreaterThanOrEqual(KEEP);
    for (const s of [botanyOnJazz, botanyOnTide, jazzOnBotany, jazzOnTide]) expect(s).toBeLessThan(0.3);
    expect(botanyOnBotany - jazzOnBotany).toBeGreaterThan(0.5);
    expect(jazzOnJazz - botanyOnJazz).toBeGreaterThan(0.5);
  });

  it('says why in terms of the interest the page touches', async () => {
    const [kept] = await mind.judge(botanist, [botanicalIllustration]);
    expect(kept.reason).toMatch(/Botan/);
    const [jazz] = await mind.judge(jazzFan, [modalJazz]);
    expect(jazz.reason).toMatch(/Jazz|Improvisation/);
  });

  it('lifts a page that speaks to the open question', async () => {
    const question = await mind.proposeQuestion(botanist, topic('Ultramarine'), [page('Pigment', 'A pigment is a colored material.', [])]);
    const [without] = await scores(botanist, [lapis]);
    const [withQuestion] = await scores({ ...botanist, question }, [lapis]);
    expect(withQuestion - without).toBeGreaterThan(0.15);
  });

  it('reads only the topic and title of its own questions, never their filler words', async () => {
    const blank: MindContext = { ...botanist, interests: [] };
    const filler = page(
      'Habit',
      'How does it connect? Why does it keep leading me back? What do they have in common? What came before? Who first wrote about it? Where else does it turn up?',
      [],
    );
    const [unasked] = await scores(blank, [filler]);
    for (const t of ['Ultramarine', 'Moss', 'Jazz', 'Tide', 'Lichen', 'Pigment', 'Fern', 'Saxophone']) {
      for (const recent of [[], [page('Cobalt blue', 'A blue pigment.', [])]]) {
        const question = await mind.proposeQuestion(blank, topic(t), recent);
        expect(await scores({ ...blank, question }, [filler])).toEqual([unasked]);
      }
    }
  });

  it('at equal pull, prefers a topic it is still getting to know over one it already loves', async () => {
    const lichen = page('Lichen', 'A lichen is a composite organism of algae living among fungus filaments.', ['Symbiosis', 'Botany']);
    const pull = 1.1;
    const [whenNew] = await scores({ ...botanist, interests: [botanist.interests[0], interest('Lichen', 0.1, pull - 0.1)] }, [lichen]);
    const [whenKnown] = await scores({ ...botanist, interests: [botanist.interests[0], interest('Lichen', 0.9, pull - 0.9)] }, [lichen]);
    expect(whenKnown).toBeLessThan(whenNew);
  });
});

describe('HeuristicMind.proposeQuestion', () => {
  it('asks about the topic, ties in a recent title, and repeats itself for the same input', async () => {
    const recent = [page('Pigment', 'A pigment is a colored material.', []), page('Ultramarine', 'A deep blue.', [])];
    const q = await mind.proposeQuestion(botanist, topic('Ultramarine'), recent);
    expect(q).toContain('Ultramarine');
    expect(q).toContain('Pigment');
    expect(q.endsWith('?')).toBe(true);
    expect(await mind.proposeQuestion(botanist, topic('Ultramarine'), recent)).toBe(q);
    expect(await mind.proposeQuestion(botanist, topic('Moss'), [])).toContain('Moss');
  });
});

describe('HeuristicMind.reflect', () => {
  const T0 = Date.UTC(2026, 9, 1, 10);
  let n = 0;
  const exp = (kind: Experience['kind'], topics: string[], url?: string, dayOffset = 0): Experience => ({
    ref: `fern#${++n}` as EventRef,
    at: (T0 + dayOffset * 86_400_000 + n * 60_000) as Instant,
    kind,
    topics: topics.map(topic),
    ...(url === undefined ? {} : { canonicalUrl: wiki(url) }),
    note: '',
  });

  it('grows a topic only with at least two distinct kept sources, and cites only the given experiences', async () => {
    const lichen1 = exp('kept', ['Lichen', 'Fungi'], 'Lichen');
    const lichen2 = exp('kept', ['Cladonia', 'Lichen'], 'Cladonia');
    const skipped = exp('skipped', ['Lichen'], 'Usnea');
    const met = exp('encounter', ['Lichen']);
    const moss1 = exp('kept', ['Moss'], 'Sphagnum');
    const moss2 = exp('kept', ['Moss'], 'Sphagnum');
    const given = [lichen1, lichen2, skipped, met, moss1, moss2];

    const proposal = await mind.reflect(botanist, given);

    expect(proposal.deltas).toEqual([
      { topic: 'Lichen', dAffinity: 0.1, stage: 'emerging', evidence: [lichen1.ref, lichen2.ref], reason: expect.any(String) as string },
    ]);
    const givenRefs = new Set(given.map((e) => e.ref));
    for (const d of proposal.deltas) for (const ref of d.evidence) expect(givenRefs.has(ref)).toBe(true);
    expect(proposal.narrative).toContain('Lichen');
  });

  it('counts a gift as a source and suggests established for four sources over two days', async () => {
    const given = [
      exp('kept', ['Lichen'], 'Lichen', 0),
      exp('kept', ['Lichen'], 'Cladonia', 0),
      exp('gift', ['Lichen'], 'Usnea', 1),
      exp('kept', ['Lichen'], 'Xanthoria', 1),
      exp('kept', ['Lichen'], 'Peltigera', 2),
    ];
    const [delta] = (await mind.reflect(botanist, given)).deltas;
    expect(delta).toMatchObject({ topic: 'Lichen', dAffinity: 0.2, stage: 'established' });
    expect(delta.evidence).toHaveLength(5);
  });

  it('never suggests a lower stage than the interest already has', async () => {
    const given = [exp('kept', ['Botany'], 'Fern'), exp('kept', ['Botany'], 'Moss')];
    const [delta] = (await mind.reflect(botanist, given)).deltas;
    expect(delta.topic).toBe('Botany');
    expect(delta.stage).toBeUndefined();
  });

  it('weighs a find the owner liked as two, so one liked find can move its topic', async () => {
    const liked: Experience = { ...exp('kept', ['Tide', 'Moon'], 'Tide'), liked: true };
    const plain = exp('kept', ['Moon'], 'Moon');
    const { deltas } = await mind.reflect(botanist, [liked, plain]);
    expect(deltas.map((d) => [d.topic, d.dAffinity, d.evidence])).toEqual([
      ['Moon', 0.15, [liked.ref, plain.ref]],
      ['Tide', 0.1, [liked.ref]],
    ]);
  });

  it('proposes nothing when no topic has two sources', async () => {
    const proposal = await mind.reflect(botanist, [exp('kept', ['Tide'], 'Tide'), exp('skipped', ['Tide'], 'Neap tide')]);
    expect(proposal).toEqual({ deltas: [], narrative: '', questions: [] });
  });
});

const MEMORY = `# What I know about my owner

## People
- My sister Ana Lopez, ana.lopez@example.com, +1 415 555 0134
- Dr. Raj Patel, oncologist

## Health
- Type 2 diabetes, metformin 500mg
- Panic attacks on Mondays

## Interests
- Botanical illustration
- **Jazz** (especially Coltrane)
- [Lichen](https://en.wikipedia.org/wiki/Lichen): the slow ones
- Watercolor — paints at 12 Elm Street, Springfield
- I have been thinking a lot about whether to quit my job at Initech
Money
-----
- Salary: $145,000 at Initech

## Address
- 12 Elm Street, Springfield, IL 62704

Likes paragraph outside any list: tide pools.

### likes
- Tide pools
`;

describe('HeuristicMind.extractInterests', () => {
  it('reads only the bullets under Interests or Likes in MEMORY.md', async () => {
    expect(await mind.extractInterests(MEMORY, 'memory')).toEqual(['Botanical illustration', 'Jazz', 'Lichen', 'Watercolor', 'Tide pools']);
  });

  it('reads only the Interests section of SOUL.md', async () => {
    expect(await mind.extractInterests(MEMORY, 'soul')).toEqual(['Botanical illustration', 'Jazz', 'Lichen', 'Watercolor']);
  });

  it('finds nothing in a file without an interests section', async () => {
    expect(await mind.extractInterests('# Notes\nAna likes jazz. Salary $145,000.\n- 12 Elm Street', 'memory')).toEqual([]);
  });
});

describe('HeuristicMind.estimateTemperament', () => {
  it('starts every trait at 0.5', async () => {
    expect(await mind.estimateTemperament('')).toEqual(temperament);
  });

  it('nudges traits from cues in the soul, within [0.1, 0.9]', async () => {
    const homebody = await mind.estimateTemperament(
      'I am quiet and shy, happiest alone at home with old, familiar books. I can sit with one fern for hours, patient and deep in its detail. I keep to my routine; nostalgia is my cozy private place.',
    );
    expect(homebody.sociability).toBeLessThan(0.5);
    expect(homebody.novelty).toBeLessThan(0.5);
    expect(homebody.focus).toBeGreaterThan(0.5);
    for (const v of Object.values(homebody)) {
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(0.9);
    }
    const explorer = await mind.estimateTemperament('Curious and playful! I wander, travel, explore anything new and strange with friends.');
    expect(explorer.novelty).toBeGreaterThan(0.5);
    expect(explorer.curiosity).toBeGreaterThan(0.5);
    expect(explorer.sociability).toBeGreaterThan(0.5);
  });
});
