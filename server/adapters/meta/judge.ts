// muse-spark-1.3 as the workshop's Judge: /v1/chat/completions with a JSON schema (strict structured output) and
// pictures as image_url data URLs in the user message, as server/adapters/minds/meta.ts asks for text.
// Docs: https://dev.meta.ai/docs/structured-output and https://dev.meta.ai/docs/image-understanding.
import type { Judge } from '../../workshop/clients';
import type { MetaOptions } from './http';
import { dataUrl, isRecord, metaHttp, parseJson } from './http';

export const JUDGE_MODEL = 'muse-spark-1.3';
const TIMEOUT_MS = 90_000;
const MAX_IMAGES = 50;

export interface MetaJudgeOptions extends MetaOptions {
  readonly model?: string;
  readonly timeoutMs?: number;
}

/** A schema name the API accepts: letters, digits, _ and -, at most 64. */
const schemaName = (name: string): string => name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64) || 'answer';

function content(reply: unknown): string | null {
  if (!isRecord(reply) || !Array.isArray(reply.choices)) return null;
  const choice: unknown = reply.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const c = choice.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: unknown) => (isRecord(p) && typeof p.text === 'string' ? p.text : '')).join('');
  return null;
}

export function metaJudge(opts: MetaJudgeOptions = {}): Judge {
  const http = metaHttp(opts);
  const model = opts.model ?? JUDGE_MODEL;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  return {
    async json<T>(req: Parameters<Judge['json']>[0]): Promise<T> {
      const what = `Judging “${req.name}” (${model})`;
      const images = req.images ?? [];
      if (images.length > MAX_IMAGES) throw new Error(`${what}: at most ${MAX_IMAGES} pictures at once (given ${images.length})`);
      const user =
        images.length === 0
          ? req.prompt
          : [{ type: 'text', text: req.prompt }, ...images.map((image) => ({ type: 'image_url', image_url: { url: dataUrl(image) } }))];
      const body = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: schemaName(req.name), schema: req.schema, strict: true } },
      };
      // A reply that isn't JSON gets one more try; a refusal or an HTTP error doesn't.
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await http.post('/chat/completions', body, { what, timeoutMs, signal: req.signal });
        const text = content(reply);
        const value = text === null ? undefined : parseJson(text);
        if (value !== undefined && value !== null) return value as T;
      }
      throw new Error(`${what} twice answered with something that isn’t the JSON asked for`);
    },
  };
}
