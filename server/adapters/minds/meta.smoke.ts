// Live check of MetaMind against the real API: npx tsx server/adapters/minds/meta.smoke.ts
// Exits 1 if any call fell back or an extracted label carries private detail.
import type { Candidate, CanonicalUrl, LlmCache, Mind, MindContext, TopicKey } from '../../../src/muse/contract';
import { MetaMind } from './meta';

if (!process.env.MODEL_API_KEY) {
  console.info('skipped: MODEL_API_KEY unset');
  process.exit(0);
}

const memory = new Map<string, string>();
const cache: LlmCache = {
  get: (k) => Promise.resolve(memory.get(k)),
  set: (k, v) => {
    memory.set(k, v);
    return Promise.resolve();
  },
};
const unused = () => Promise.reject(new Error('not exercised by the smoke'));
const fallback: Mind = {
  judge: (_ctx, cs) => Promise.resolve(cs.map((c) => ({ canonicalUrl: c.canonicalUrl, score: 0, reason: '(fallback)' }))),
  proposeQuestion: unused,
  reflect: unused,
  extractInterests: () => Promise.resolve([]),
  estimateTemperament: unused,
};
const mind = new MetaMind({ cache, fallback });

const ctx: MindContext = {
  name: 'Pip',
  soul: 'I am drawn to deep blues, old pigments and anything made slowly by hand. I talk softly and notice small things.',
  temperament: { curiosity: 0.8, focus: 0.5, sociability: 0.4, whimsy: 0.7, novelty: 0.6 },
  interests: [{ topic: 'Ultramarine' as TopicKey, affinity: 0.4, salience: 0.6, stage: 'emerging' }],
  question: 'Why was blue paint once worth more than gold?',
};

function page(title: string, summary: string): Candidate {
  const url = `https://en.wikipedia.org/wiki/${title}`;
  return { origin: 'wikipedia', url, canonicalUrl: url as CanonicalUrl, title: title.replace(/_/g, ' '), summary, topics: [title as TopicKey] };
}

const pages = [
  page('Lapis_lazuli', 'A deep-blue metamorphic rock prized since antiquity, ground to make the pigment ultramarine.'),
  page('Parking_meter', 'A device used to collect money in exchange for the right to park a vehicle in a place for a limited time.'),
];

const memoryMd = [
  'My sister Ana Lopez visits on Sundays. I was diagnosed with asthma in 2019 and use an inhaler.',
  'I earn $85,000 at Northwind and still owe $12,000 on my car. We live at 42 Elm Street, Portland.',
  'Lately I bake sourdough every weekend, go birdwatching at dawn, and I am rereading Moby-Dick.',
  'I play jazz piano badly and love it. My email is ana.lopez@example.com.',
].join('\n');
const PRIVATE = ['ana', 'lopez', 'asthma', 'inhaler', '85', '12,000', 'northwind', 'elm', 'portland', '@'];

const judged = await mind.judge(ctx, pages);
for (const j of judged) console.info(`judge  ${j.score.toFixed(2)}  ${j.canonicalUrl}\n       ${j.reason}`);

const labels = await mind.extractInterests(memoryMd, 'memory');
console.info(`interests  ${JSON.stringify(labels)}`);

const leaks = labels.filter((l) => PRIVATE.some((p) => l.toLowerCase().includes(p)));
for (const f of mind.fallbacks) console.error(`fell back: ${f.method} ${f.reason} ${f.detail}`);
if (leaks.length > 0) console.error(`private detail leaked: ${JSON.stringify(leaks)}`);
process.exit(mind.fallbacks.length > 0 || leaks.length > 0 ? 1 : 0);
