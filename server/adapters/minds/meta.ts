// Wire format: https://dev.meta.ai/docs/protocols/chat-completions and https://dev.meta.ai/docs/structured-output
import { createHash } from 'node:crypto';
import type {
  Candidate,
  EventRef,
  Experience,
  InterestDelta,
  InterestStage,
  Judgment,
  LlmCache,
  Mind,
  MindContext,
  PostcardAsk,
  PostcardWords,
  ReflectionProposal,
  Temperament,
  TopicKey,
} from '../../../src/muse/contract';
import { interestsPrompt, MAX_INTERESTS } from './prompts/interests';
import { judgePrompt } from './prompts/judge';
import type { Prompt } from './prompts/prompt';
import { tooClose, wordsOf } from '../../domain/postcardWords';
import { parsePostcard, postcardPrompt } from './prompts/postcard';
import { questionPrompt } from './prompts/question';
import { MAX_QUESTIONS, reflectPrompt, STAGES } from './prompts/reflect';
import { temperamentPrompt, TRAITS } from './prompts/temperament';

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
const DEFAULT_MODEL = 'muse-spark-1.3';
/** Longest reason, question or narrative Muse may write. A longer one counts as a malformed reply. */
const MAX_LINE = 300;
const MAX_LABEL = 60;
const NO_CHANGE: ReflectionProposal = { deltas: [], narrative: '', questions: [] };

export interface MetaMindOptions {
  /** Defaults to env MODEL_API_KEY. With no key, every uncached call goes to `fallback`. */
  readonly apiKey?: string;
  /** Defaults to env MUSE_LLM_BASE_URL, then https://api.meta.ai/v1. */
  readonly baseUrl?: string;
  /** Defaults to env MUSE_LLM_MODEL, then muse-spark-1.3. */
  readonly model?: string;
  readonly cache: LlmCache;
  readonly fallback: Mind;
  readonly fetch?: typeof fetch;
}

export type FallbackReason = 'no-key' | 'network' | 'http' | 'malformed' | 'error';

export interface Fallback {
  readonly method: keyof Mind;
  readonly reason: FallbackReason;
  readonly detail: string;
}

type Failure = Omit<Fallback, 'method'>;

export class MetaMind implements Mind {
  readonly model: string;
  /** Every call the fallback answered instead of the model, oldest first. */
  readonly fallbacks: Fallback[] = [];
  private readonly apiKey: string;
  private readonly url: string;
  private readonly cache: LlmCache;
  private readonly fallback: Mind;
  private readonly send: typeof fetch;

  constructor(opts: MetaMindOptions) {
    const env = process.env;
    this.apiKey = opts.apiKey ?? env.MODEL_API_KEY ?? '';
    this.model = opts.model ?? (env.MUSE_LLM_MODEL || DEFAULT_MODEL);
    this.url = `${(opts.baseUrl ?? (env.MUSE_LLM_BASE_URL || DEFAULT_BASE_URL)).replace(/\/+$/, '')}/chat/completions`;
    this.cache = opts.cache;
    this.fallback = opts.fallback;
    this.send = opts.fetch ?? fetch.bind(globalThis);
  }

  judge(ctx: MindContext, candidates: readonly Candidate[]): Promise<Judgment[]> {
    if (candidates.length === 0) return Promise.resolve([]);
    return this.ask(
      'judge',
      judgePrompt(ctx, candidates),
      (raw) => parseJudgments(raw, candidates),
      () => this.fallback.judge(ctx, candidates),
    );
  }

  proposeQuestion(ctx: MindContext, topic: TopicKey, recent: readonly Candidate[]): Promise<string> {
    return this.ask('proposeQuestion', questionPrompt(ctx, topic, recent), parseQuestion, () =>
      this.fallback.proposeQuestion(ctx, topic, recent),
    );
  }

  reflect(ctx: MindContext, experiences: readonly Experience[]): Promise<ReflectionProposal> {
    if (experiences.length === 0) return Promise.resolve(NO_CHANGE);
    const topics = new Map<string, TopicKey>();
    for (const t of [...ctx.interests.map((i) => i.topic), ...experiences.flatMap((e) => e.topics)]) topics.set(t, t);
    return this.ask(
      'reflect',
      reflectPrompt(ctx, experiences, [...topics.values()]),
      (raw) => parseReflection(raw, topics, experiences),
      () => this.fallback.reflect(ctx, experiences),
    );
  }

  extractInterests(text: string, from: 'memory' | 'soul'): Promise<string[]> {
    if (text.trim() === '') return Promise.resolve([]);
    return this.ask('extractInterests', interestsPrompt(text, from), parseInterests, () =>
      this.fallback.extractInterests(text, from),
    );
  }

  writePostcard(ctx: MindContext, ask: PostcardAsk): Promise<PostcardWords> {
    const fresh = (raw: unknown) => {
      const w = parsePostcard(raw, ask.plan.kind);
      return w && !tooClose(wordsOf(w), ask.recent) ? w : null;
    };
    return this.ask('writePostcard', postcardPrompt(ctx, ask), fresh, () =>
      this.fallback.writePostcard(ctx, ask),
    );
  }

  estimateTemperament(soul: string): Promise<Temperament> {
    return this.ask('estimateTemperament', temperamentPrompt(soul), parseTemperament, () =>
      this.fallback.estimateTemperament(soul),
    );
  }

  /** The model's answer when it gives a valid one, otherwise the fallback's. Never rejects unless the fallback does. */
  private async ask<T>(
    method: keyof Mind,
    prompt: Prompt,
    parse: (raw: unknown) => T | null,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const outcome = await this.askModel(prompt, parse).catch((e: unknown): Failure => ({ reason: 'error', detail: describe(e) }));
    if ('value' in outcome) return outcome.value;
    this.fallbacks.push({ method, ...outcome });
    return fallback();
  }

  /** Cache first, then the model, retrying once on a malformed reply. Only valid replies are cached. */
  private async askModel<T>(prompt: Prompt, parse: (raw: unknown) => T | null): Promise<{ readonly value: T } | Failure> {
    const body = JSON.stringify(requestBody(this.model, prompt));
    const key = createHash('sha256').update(`${this.model}\n${body}`).digest('hex');
    const cached = await this.cache.get(key);
    const hit = cached === undefined ? null : parse(parseJson(cached));
    if (hit !== null) return { value: hit };
    if (this.apiKey === '') return { reason: 'no-key', detail: 'MODEL_API_KEY is unset' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.post(body);
      if ('reason' in reply) return reply;
      if (reply.content === null) continue;
      const value = parse(parseJson(reply.content));
      if (value !== null) {
        await this.cache.set(key, reply.content);
        return { value };
      }
    }
    return { reason: 'malformed', detail: 'two replies failed to parse' };
  }

  private async post(body: string): Promise<{ readonly content: string | null } | Failure> {
    try {
      const res = await this.send(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body,
      });
      const text = await res.text();
      if (!res.ok) return { reason: 'http', detail: `${res.status} ${text.slice(0, 200)}` };
      return { content: messageContent(parseJson(text)) };
    } catch (e) {
      return { reason: 'network', detail: describe(e) };
    }
  }
}

function requestBody(model: string, prompt: Prompt) {
  return {
    model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: prompt.name, schema: prompt.schema, strict: true } },
    reasoning_effort: prompt.effort,
  };
}

function messageContent(json: unknown): string | null {
  if (!isRecord(json) || !Array.isArray(json.choices)) return null;
  const choice: unknown = json.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return typeof choice.message.content === 'string' ? choice.message.content : null;
}

function parseJudgments(raw: unknown, candidates: readonly Candidate[]): Judgment[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.judgments)) return null;
  const byUrl = new Map<string, { score: number; reason: string }>();
  for (const j of raw.judgments as unknown[]) {
    if (!isRecord(j) || typeof j.canonicalUrl !== 'string') return null;
    const score = finite(j.score);
    const reason = line(j.reason);
    if (score === null || !reason) return null;
    byUrl.set(j.canonicalUrl, { score: clamp(score, 0, 1), reason });
  }
  const judgments: Judgment[] = [];
  for (const c of candidates) {
    const j = byUrl.get(c.canonicalUrl);
    if (!j) return null;
    judgments.push({ canonicalUrl: c.canonicalUrl, ...j });
  }
  return judgments;
}

function parseQuestion(raw: unknown): string | null {
  return (isRecord(raw) && line(raw.question)) || null;
}

/** Deltas and questions about topics Muse has never met are dropped, and so are evidence refs it was not shown. */
function parseReflection(
  raw: unknown,
  topics: ReadonlyMap<string, TopicKey>,
  experiences: readonly Experience[],
): ReflectionProposal | null {
  if (!isRecord(raw) || !Array.isArray(raw.deltas) || !Array.isArray(raw.questions)) return null;
  const refs = new Map<string, EventRef>(experiences.map((e) => [e.ref, e.ref]));
  const deltas: InterestDelta[] = [];
  for (const d of raw.deltas as unknown[]) {
    if (!isRecord(d) || typeof d.topic !== 'string' || !Array.isArray(d.evidence)) return null;
    const dAffinity = finite(d.dAffinity);
    const reason = line(d.reason);
    if (dAffinity === null || !reason || !(d.stage === null || isStage(d.stage))) return null;
    const topic = topics.get(d.topic);
    const evidence = (d.evidence as unknown[]).flatMap((r) => (typeof r === 'string' && refs.get(r)) || []);
    if (!topic || evidence.length === 0) continue;
    deltas.push({ topic, dAffinity: clamp(dAffinity, -0.2, 0.2), stage: d.stage ?? undefined, evidence, reason });
  }
  const narrative = line(raw.narrative);
  if (narrative === null) return null;
  const questions: { topic: TopicKey; text: string }[] = [];
  for (const q of raw.questions as unknown[]) {
    if (!isRecord(q)) return null;
    const topic = typeof q.topic === 'string' ? topics.get(q.topic) : undefined;
    const text = line(q.text);
    if (topic && text) questions.push({ topic, text });
  }
  return {
    deltas,
    narrative: deltas.length > 0 ? narrative : '',
    questions: questions.slice(0, MAX_QUESTIONS),
  };
}

function parseInterests(raw: unknown): string[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.interests)) return null;
  const labels = new Map<string, string>();
  for (const v of raw.interests as unknown[]) {
    if (typeof v !== 'string') return null;
    const label = v.replace(/\s+/g, ' ').trim();
    if (label && label.length <= MAX_LABEL && !labels.has(label.toLowerCase())) labels.set(label.toLowerCase(), label);
  }
  return [...labels.values()].slice(0, MAX_INTERESTS);
}

function parseTemperament(raw: unknown): Temperament | null {
  if (!isRecord(raw)) return null;
  const traits = {} as Record<keyof Temperament, number>;
  for (const trait of Object.keys(TRAITS) as (keyof Temperament)[]) {
    const v = finite(raw[trait]);
    if (v === null) return null;
    traits[trait] = clamp(v, 0, 1);
  }
  return traits;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStage(v: unknown): v is InterestStage {
  return STAGES.includes(v as InterestStage);
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** One line of Muse's prose: whitespace collapsed, empty allowed, null when not a string or over MAX_LINE. */
function line(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length <= MAX_LINE ? s : null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
