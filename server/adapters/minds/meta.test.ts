import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Candidate,
  CanonicalUrl,
  EventRef,
  Experience,
  Instant,
  LlmCache,
  Mind,
  MindContext,
  Temperament,
  TopicKey,
} from '../../../src/muse/contract';
import { MetaMind, type MetaMindOptions } from './meta';

const topic = (t: string) => t as TopicKey;
const ref = (n: number) => `pip#${n}` as EventRef;

const ctx: MindContext = {
  name: 'Pip',
  soul: 'I love the colour blue and anything made by hand.',
  temperament: { curiosity: 0.8, focus: 0.4, sociability: 0.5, whimsy: 0.7, novelty: 0.6 },
  interests: [{ topic: topic('Ultramarine'), affinity: 0.4, salience: 0.6, stage: 'emerging' }],
  question: null,
};

function page(title: string): Candidate {
  const url = `https://en.wikipedia.org/wiki/${title}`;
  return { url, canonicalUrl: url as CanonicalUrl, title, summary: `About ${title}.`, topics: [topic(title)], media: { kind: 'article', network: 'web' } };
}

const pages = [page('Ultramarine'), page('Lapis_lazuli'), page('Parking_meter')];

function lived(n: number, topics: string[]): Experience {
  return { ref: ref(n), at: (Date.UTC(2026, 9, n) as Instant), kind: 'kept', topics: topics.map(topic), note: `kept ${n}` };
}

const HEURISTIC_TEMPERAMENT: Temperament = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 };
const heuristic: Mind = {
  judge: (_ctx, cs) => Promise.resolve(cs.map((c) => ({ canonicalUrl: c.canonicalUrl, score: 0.5, reason: 'heuristic' }))),
  proposeQuestion: () => Promise.resolve('heuristic question?'),
  reflect: () => Promise.resolve({ deltas: [], narrative: 'heuristic', questions: [] }),
  extractInterests: () => Promise.resolve(['heuristic']),
  estimateTemperament: () => Promise.resolve(HEURISTIC_TEMPERAMENT),
  writePostcard: () => Promise.resolve({ kind: 'line', text: 'heuristic line' }),
};

function memoryCache(): LlmCache {
  const m = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(m.get(k)),
    set: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
  };
}

/** A chat.completion envelope as Meta returns it, with `content` as the message text. */
function completion(content: unknown, status = 200): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const body = {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'muse-spark-1.3',
    choices: [{ index: 0, message: { role: 'assistant', content: text, refusal: null }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Answers each call with the next reply in order; an Error reply rejects like a network failure. */
function stubFetch(...replies: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url, init });
    const r = replies.shift();
    if (r === undefined) return Promise.reject(new Error('unexpected fetch'));
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { fetch: fn as typeof fetch, calls };
}

function mind(fetch: typeof globalThis.fetch, opts: Partial<MetaMindOptions> = {}) {
  return new MetaMind({ apiKey: 'test-key', cache: memoryCache(), fallback: heuristic, fetch, ...opts });
}

function bodyOf(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

const goodJudgments = {
  judgments: [
    { canonicalUrl: pages[0].canonicalUrl, score: 0.92, reason: 'The bluest blue, ground from stone.' },
    { canonicalUrl: pages[1].canonicalUrl, score: 0.81, reason: 'Where ultramarine comes from.' },
    { canonicalUrl: pages[2].canonicalUrl, score: 0.05, reason: 'Nothing for me here.' },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MetaMind request', () => {
  it('posts a strict json_schema chat completion to Meta with a bearer key', async () => {
    vi.stubEnv('MUSE_LLM_BASE_URL', '');
    vi.stubEnv('MUSE_LLM_MODEL', '');
    const { fetch, calls } = stubFetch(completion(goodJudgments));
    await mind(fetch).judge(ctx, pages);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' });
    const body = bodyOf(calls[0]);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.messages).toMatchObject([{ role: 'system' }, { role: 'user' }]);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'muse_judgments', strict: true, schema: { type: 'object', additionalProperties: false } },
    });
  });

  it('reads the key, base URL and model from env when options omit them', async () => {
    vi.stubEnv('MODEL_API_KEY', 'env-key');
    vi.stubEnv('MUSE_LLM_BASE_URL', 'https://llm.example/v1/');
    vi.stubEnv('MUSE_LLM_MODEL', 'muse-spark-1.2');
    const { fetch, calls } = stubFetch(completion(goodJudgments));
    await new MetaMind({ cache: memoryCache(), fallback: heuristic, fetch }).judge(ctx, pages);

    expect(calls[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer env-key' });
    expect(bodyOf(calls[0]).model).toBe('muse-spark-1.2');
  });
});

describe('MetaMind.judge', () => {
  it('parses a good reply', async () => {
    const m = mind(stubFetch(completion(goodJudgments)).fetch);
    expect(await m.judge(ctx, pages)).toEqual(goodJudgments.judgments);
    expect(m.fallbacks).toEqual([]);
  });

  it('returns judgments in input order when the reply is shuffled', async () => {
    const [a, b, c] = goodJudgments.judgments;
    const m = mind(stubFetch(completion({ judgments: [c, a, b] })).fetch);
    expect((await m.judge(ctx, pages)).map((j) => j.canonicalUrl)).toEqual(pages.map((p) => p.canonicalUrl));
  });

  it('clamps scores to [0, 1]', async () => {
    const [a, b, c] = goodJudgments.judgments;
    const reply = { judgments: [{ ...a, score: 1.7 }, { ...b, score: -0.3 }, c] };
    const judged = await mind(stubFetch(completion(reply)).fetch).judge(ctx, pages);
    expect(judged.map((j) => j.score)).toEqual([1, 0, 0.05]);
  });

  it('retries a malformed reply once and keeps the second answer', async () => {
    const { fetch, calls } = stubFetch(completion('not json'), completion(goodJudgments));
    const m = mind(fetch);
    expect(await m.judge(ctx, pages)).toEqual(goodJudgments.judgments);
    expect(calls).toHaveLength(2);
    expect(m.fallbacks).toEqual([]);
  });

  it('falls back after two malformed replies and records it', async () => {
    const missingOne = { judgments: goodJudgments.judgments.slice(0, 2) };
    const { fetch, calls } = stubFetch(completion('{"judgments": "nope"}'), completion(missingOne));
    const m = mind(fetch);
    expect(await m.judge(ctx, pages)).toEqual(await heuristic.judge(ctx, pages));
    expect(calls).toHaveLength(2);
    expect(m.fallbacks).toMatchObject([{ method: 'judge', reason: 'malformed' }]);
  });

  it('falls back on a 500 without retrying', async () => {
    const { fetch, calls } = stubFetch(new Response('{"error":{"message":"boom"}}', { status: 500 }));
    const m = mind(fetch);
    expect(await m.judge(ctx, pages)).toEqual(await heuristic.judge(ctx, pages));
    expect(calls).toHaveLength(1);
    expect(m.fallbacks).toMatchObject([{ method: 'judge', reason: 'http' }]);
  });

  it('falls back on a network error', async () => {
    const m = mind(stubFetch(new TypeError('fetch failed')).fetch);
    expect(await m.judge(ctx, pages)).toEqual(await heuristic.judge(ctx, pages));
    expect(m.fallbacks).toMatchObject([{ method: 'judge', reason: 'network' }]);
  });

  it('falls back instead of throwing when the cache fails', async () => {
    const broken: LlmCache = { get: () => Promise.reject(new Error('disk full')), set: () => Promise.resolve() };
    const m = mind(stubFetch(completion(goodJudgments)).fetch, { cache: broken });
    expect(await m.judge(ctx, pages)).toEqual(await heuristic.judge(ctx, pages));
    expect(m.fallbacks).toMatchObject([{ method: 'judge', reason: 'error' }]);
  });
});

describe('MetaMind cache', () => {
  it('answers a repeated call from the cache without fetching', async () => {
    const cache = memoryCache();
    const first = stubFetch(completion(goodJudgments));
    const answer = await mind(first.fetch, { cache }).judge(ctx, pages);

    const second = stubFetch();
    const again = mind(second.fetch, { cache });
    expect(await again.judge(ctx, pages)).toEqual(answer);
    expect(second.calls).toHaveLength(0);
    expect(again.fallbacks).toEqual([]);
  });

  it('serves cached answers with no API key, and falls back without fetching on a miss', async () => {
    const cache = memoryCache();
    await mind(stubFetch(completion(goodJudgments)).fetch, { cache }).judge(ctx, pages);

    const offline = stubFetch();
    const m = mind(offline.fetch, { cache, apiKey: '' });
    expect(await m.judge(ctx, pages)).toEqual(goodJudgments.judgments);
    expect(await m.judge(ctx, pages.slice(0, 1))).toEqual(await heuristic.judge(ctx, pages.slice(0, 1)));
    expect(offline.calls).toHaveLength(0);
    expect(m.fallbacks).toMatchObject([{ method: 'judge', reason: 'no-key' }]);
  });

  it('does not cache a fallback answer', async () => {
    const cache = memoryCache();
    await mind(stubFetch(new Response('', { status: 503 })).fetch, { cache }).judge(ctx, pages);

    const { fetch, calls } = stubFetch(completion(goodJudgments));
    expect(await mind(fetch, { cache }).judge(ctx, pages)).toEqual(goodJudgments.judgments);
    expect(calls).toHaveLength(1);
  });
});

describe('MetaMind.reflect', () => {
  const experiences = [lived(1, ['Ultramarine']), lived(2, ['Lapis_lazuli']), lived(3, ['Ultramarine'])];

  it('clamps dAffinity and drops evidence refs it was not shown', async () => {
    const reply = {
      deltas: [
        { topic: 'Ultramarine', dAffinity: 0.9, stage: 'established', evidence: ['pip#1', 'pip#99', 'pip#3'], reason: 'Again and again, blue.' },
        { topic: 'Lapis_lazuli', dAffinity: -0.5, stage: null, evidence: ['pip#2'], reason: 'Less than I thought.' },
        { topic: 'Ultramarine', dAffinity: 0.1, stage: null, evidence: ['pip#42'], reason: 'Only foreign evidence.' },
        { topic: 'Opera', dAffinity: 0.1, stage: null, evidence: ['pip#1'], reason: 'A topic I never met.' },
      ],
      narrative: 'Blue keeps finding me.',
      questions: [
        { topic: 'Ultramarine', text: 'Who first ground lapis into paint?' },
        { topic: 'Opera', text: 'Not mine to ask.' },
      ],
    };
    const m = mind(stubFetch(completion(reply)).fetch);
    expect(await m.reflect(ctx, experiences)).toEqual({
      deltas: [
        { topic: 'Ultramarine', dAffinity: 0.2, stage: 'established', evidence: ['pip#1', 'pip#3'], reason: 'Again and again, blue.' },
        { topic: 'Lapis_lazuli', dAffinity: -0.2, evidence: ['pip#2'], reason: 'Less than I thought.' },
      ],
      narrative: 'Blue keeps finding me.',
      questions: [{ topic: 'Ultramarine', text: 'Who first ground lapis into paint?' }],
    });
    expect(m.fallbacks).toEqual([]);
  });

  it('reports no change, with an empty narrative, when no delta keeps its evidence', async () => {
    const reply = {
      deltas: [{ topic: 'Ultramarine', dAffinity: 0.1, stage: null, evidence: ['pip#7'], reason: 'Foreign.' }],
      narrative: 'Something changed.',
      questions: [],
    };
    const proposal = await mind(stubFetch(completion(reply)).fetch).reflect(ctx, experiences);
    expect(proposal).toEqual({ deltas: [], narrative: '', questions: [] });
  });

  it('tells the model which finds the owner liked', async () => {
    const { fetch, calls } = stubFetch(completion({ deltas: [], narrative: '', questions: [] }));
    await mind(fetch).reflect(ctx, [{ ...experiences[0], liked: true }, experiences[1]]);
    const user = (bodyOf(calls[0]).messages as { role: string; content: string }[]).find((m) => m.role === 'user')?.content ?? '';
    const shown = JSON.parse(user.slice(user.indexOf('['))) as { ref: string; liked: boolean }[];
    expect(shown.map((e) => [e.ref, e.liked])).toEqual([
      ['pip#1', true],
      ['pip#2', false],
    ]);
  });

  it('offers only the shown refs to the model as citable evidence', async () => {
    const { fetch, calls } = stubFetch(completion({ deltas: [], narrative: '', questions: [] }));
    await mind(fetch).reflect(ctx, experiences);
    const format = bodyOf(calls[0]).response_format as { json_schema: { schema: { properties: { deltas: { items: { properties: { evidence: { items: { enum: string[] } } } } } } } } };
    expect(format.json_schema.schema.properties.deltas.items.properties.evidence.items.enum).toEqual(['pip#1', 'pip#2', 'pip#3']);
  });
});

describe('MetaMind other calls', () => {
  it('clamps an estimated temperament to [0, 1]', async () => {
    const reply = { curiosity: 1.4, focus: -0.2, sociability: 0.3, whimsy: 0.9, novelty: 0.5 };
    const t = await mind(stubFetch(completion(reply)).fetch).estimateTemperament('I wander.');
    expect(t).toEqual({ curiosity: 1, focus: 0, sociability: 0.3, whimsy: 0.9, novelty: 0.5 });
  });

  it('dedupes extracted interest labels', async () => {
    const reply = { interests: ['Sourdough', ' sourdough ', 'Jazz'] };
    const labels = await mind(stubFetch(completion(reply)).fetch).extractInterests('I bake and listen to jazz.', 'memory');
    expect(labels).toEqual(['Sourdough', 'Jazz']);
  });

  it('proposes a question in one line', async () => {
    const reply = { question: 'Why is\nultramarine   so costly?' };
    const q = await mind(stubFetch(completion(reply)).fetch).proposeQuestion(ctx, topic('Ultramarine'), pages);
    expect(q).toBe('Why is ultramarine so costly?');
  });
});
