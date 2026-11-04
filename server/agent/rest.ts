// The connector as plain REST at /api/v1, for clients without MCP: GET /api/v1/tools lists the same tools (name,
// kind, what it does, its input as JSON Schema); POST /api/v1/tools/<name> runs one with a JSON body. A refusal is
// JSON {status, error, retry_after?}. Also the small JSON helpers every route under server/agent shares.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { iso } from './tools';
import type { Failure, Outcome } from './tools';
import type { ToolDef } from './types';

/** Room for a body brief's avatar (2 MB of picture, as base64). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const CORS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-protocol-version, mcp-session-id, retry-after',
};

export function sendJson(res: ServerResponse, status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): void {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

/** Retry-After in whole seconds from now, for a refusal that says when. */
export function retryHeader(f: Failure, nowMs: number): Readonly<Record<string, string>> {
  return f.retryAfter === undefined ? {} : { 'retry-after': String(Math.max(1, Math.ceil((f.retryAfter - nowMs) / 1000))) };
}

export function failureJson(f: Failure): { status: number; error: string; retry_after?: string } {
  return f.retryAfter === undefined ? { status: f.status, error: f.error } : { status: f.status, error: f.error, retry_after: iso(f.retryAfter) };
}

/** The body as JSON (undefined when empty), or why not. Reads to the end even when too large, so the client gets the 413. */
export async function readBody(req: IncomingMessage, max = MAX_BODY_BYTES): Promise<{ readonly ok: true; readonly value: unknown } | ({ readonly ok: false } & Failure)> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= max) chunks.push(chunk);
  }
  if (size > max) return { ok: false, status: 413, error: `The body is over ${Math.round(max / 1024)} KB.` };
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'The body must be JSON.' };
  }
}

export interface RestDeps {
  readonly tools: readonly ToolDef[];
  readonly call: (tool: ToolDef, args: unknown) => Promise<Outcome>;
}

/** What GET /api/v1/tools answers: every tool with its input as JSON Schema. */
export function toolListing(tools: readonly ToolDef[]) {
  return {
    tools: tools.map((t) => ({ name: t.name, kind: t.kind, description: t.description, input: z.toJSONSchema(t.input, { io: 'input' }) })),
  };
}

/** Answers one request under /api/v1 (the caller has checked the key and the rate limit). `path` has no trailing slash. */
export async function serveRest(req: IncomingMessage, res: ServerResponse, path: string, { tools, call }: RestDeps, nowMs: number): Promise<void> {
  const refuse = (f: Failure) => sendJson(res, f.status, failureJson(f), retryHeader(f, nowMs));
  if (path === '/api/v1/tools') {
    if (req.method !== 'GET') return refuse({ status: 405, error: 'Use GET to list the tools.' });
    return sendJson(res, 200, toolListing(tools));
  }
  const name = /^\/api\/v1\/tools\/([a-z_]{1,40})$/.exec(path)?.[1];
  const tool = name === undefined ? undefined : tools.find((t) => t.name === name);
  if (tool === undefined) return refuse({ status: 404, error: 'No such tool. GET /api/v1/tools lists them.' });
  if (req.method !== 'POST') return refuse({ status: 405, error: 'Use POST with a JSON body to run a tool.' });
  const body = await readBody(req);
  if (!body.ok) return refuse(body);
  const outcome = await call(tool, body.value);
  if (!outcome.ok) return refuse(outcome);
  sendJson(res, 200, outcome.value);
}
