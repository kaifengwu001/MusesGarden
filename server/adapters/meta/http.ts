// What every Meta client shares: the key and base URL (MODEL_API_KEY, MUSE_LLM_BASE_URL, else
// https://api.meta.ai/v1), JSON over POST with a timeout, one retry on a busy backend, and errors in plain words.
// Error envelope: https://dev.meta.ai/docs/error-handling ({ error: { type, code, param, message } }).

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
/** Statuses worth one more try after a pause (the docs: 503 is retryable with backoff). */
const RETRYABLE = new Set([429, 502, 503, 504]);
const RETRY_PAUSE_MS = 2_000;

export interface MetaOptions {
  /** Defaults to env MODEL_API_KEY. */
  readonly apiKey?: string;
  /** Defaults to env MUSE_LLM_BASE_URL, then https://api.meta.ai/v1. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** The pause before the one retry of a busy backend (default 2 s). */
  readonly retryPauseMs?: number;
}

export interface MetaHttp {
  /** POSTs `body` as JSON to `path` (e.g. "/images/generations") and returns the parsed reply. Throws plain errors. */
  post(path: string, body: unknown, opts: { readonly what: string; readonly timeoutMs: number; readonly signal?: AbortSignal }): Promise<unknown>;
}

export function metaHttp(opts: MetaOptions = {}): MetaHttp {
  const env = process.env;
  const apiKey = opts.apiKey ?? env.MODEL_API_KEY ?? '';
  const base = (opts.baseUrl ?? (env.MUSE_LLM_BASE_URL || DEFAULT_BASE_URL)).replace(/\/+$/, '');
  const send = opts.fetch ?? fetch.bind(globalThis);

  async function once(url: string, body: string, what: string, timeoutMs: number, signal?: AbortSignal): Promise<{ readonly status: number; readonly text: string }> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const both = signal ? AbortSignal.any([timeout, signal]) : timeout;
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: both,
      });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      if (signal?.aborted) throw new Error(`${what} was stopped`, { cause: e });
      if (timeout.aborted) throw new Error(`${what} took longer than ${Math.round(timeoutMs / 1000)} s and was given up`, { cause: e });
      throw new Error(`${what} couldn’t be reached: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }

  return {
    async post(path, body, { what, timeoutMs, signal }) {
      if (apiKey === '') throw new Error(`${what} needs MODEL_API_KEY, and it isn’t set`);
      const url = `${base}${path}`;
      const text = JSON.stringify(body);
      let reply = await once(url, text, what, timeoutMs, signal);
      if (RETRYABLE.has(reply.status)) {
        await pause(opts.retryPauseMs ?? RETRY_PAUSE_MS, signal);
        reply = await once(url, text, what, timeoutMs, signal);
      }
      if (reply.status < 200 || reply.status >= 300) throw new Error(`${what} ${refusal(reply.status, reply.text)}`);
      const json = parseJson(reply.text);
      if (json === undefined) throw new Error(`${what} answered with something that isn’t JSON: ${reply.text.slice(0, 120)}`);
      return json;
    },
  };
}

/** "refused the request (400 invalid_request_error, param n: n must be at most 10)". */
function refusal(status: number, text: string): string {
  const json = parseJson(text);
  const err = isRecord(json) && isRecord(json.error) ? json.error : null;
  const message = err && typeof err.message === 'string' ? err.message : text.replace(/\s+/g, ' ').trim().slice(0, 200);
  const kind = err ? [err.code, err.type].find((v) => typeof v === 'string') : undefined;
  const param = err && typeof err.param === 'string' ? `, param ${err.param}` : '';
  const label = `${status}${typeof kind === 'string' ? ` ${kind}` : ''}${param}`;
  if (status === 401 || status === 403) return `refused the key (${label}): ${message}`;
  if (status === 429) return `is rate limited (${label}): ${message}`;
  if (status >= 500) return `is having trouble (${label}): ${message}`;
  return `refused the request (${label}): ${message}`;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('stopped'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('stopped'));
      },
      { once: true },
    );
  });
}

/** The picture's type from its first bytes: png, jpeg, webp or gif (else png). */
export function imageType(image: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  if (image[0] === 0xff && image[1] === 0xd8) return 'image/jpeg';
  if (image.subarray(0, 4).toString('latin1') === 'RIFF' && image.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (image.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return 'image/png';
}

export const isPng = (image: Buffer): boolean => image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

export const dataUrl = (image: Buffer): string => `data:${imageType(image)};base64,${image.toString('base64')}`;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
