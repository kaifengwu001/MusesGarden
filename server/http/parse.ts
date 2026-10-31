// Parsers for everything that enters over HTTP: path params, query strings and JSON bodies. Each one returns a
// contract type or throws an HttpError with a short message. No message ever quotes the input it rejected.
import type { IncomingMessage } from 'node:http';
import type { HiddenRef } from '../../src/muse/contract';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_HOURS = 24 * 60;

const bad = (message: string) => new HttpError(400, message);

/** The body as JSON, or undefined when empty. Reads to the end even when too large, so the client gets the 413. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body over 64 KB');
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw bad('body must be JSON');
  }
}

/** One field of a JSON object body. */
export function field(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('body must be a JSON object');
  return Object.hasOwn(body, key) ? (body as Record<string, unknown>)[key] : undefined;
}

const ID = /^[\w.:~-]{1,128}$/;

/** Any branded id: MuseId, DiscoveryId, InvitationId, BasketId, PhotoId. */
export function id<T extends string>(raw: unknown, name: string): T {
  if (typeof raw === 'string' && ID.test(raw)) return raw as T;
  throw bad(`${name} must be an id`);
}

export function before<T extends string>(query: URLSearchParams): T | null {
  const raw = query.get('before');
  return raw === null ? null : id<T>(raw, 'before');
}

export function limit(query: URLSearchParams): number {
  const raw = query.get('limit');
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (/^\d+$/.test(raw) && n >= 1 && n <= MAX_LIMIT) return n;
  throw bad(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
}

export function day(query: URLSearchParams): string | null {
  const raw = query.get('day');
  if (raw === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  throw bad('day must be YYYY-MM-DD');
}

export function hhmm(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return v;
  throw bad('hhmm must be "HH:MM" or null');
}

export function hiddenRef(v: unknown): HiddenRef {
  if (typeof v === 'string' && /^(topic:[^\p{Cc}]{1,256}|discovery:[\w.:~-]{1,128})$/u.test(v)) return v as HiddenRef;
  throw bad('ref must be "topic:<title>" or "discovery:<id>"');
}

export function hours(v: unknown): number {
  if (typeof v === 'number' && v > 0 && v <= MAX_HOURS) return v;
  throw bad(`hours must be a number above 0 and at most ${MAX_HOURS}`);
}

export function flag(v: unknown, name: string): boolean {
  if (typeof v === 'boolean') return v;
  throw bad(`${name} must be true or false`);
}

export function text(v: unknown): string {
  if (typeof v === 'string') return v;
  throw bad('text must be a string');
}

export function shareCode(v: unknown): string {
  if (typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v)) return v;
  throw bad('shareCode must be letters, digits and dashes');
}

function oneOf<const T extends readonly string[]>(name: string, values: T): (v: unknown) => T[number] {
  return (v) => {
    if (typeof v === 'string' && values.includes(v)) return v;
    throw bad(`${name} must be one of: ${values.join(', ')}`);
  };
}

export const workState = oneOf('state', ['started', 'ended']);
export const clockMode = oneOf('mode', ['live', 'fast-forward']);
