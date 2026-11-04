// The connector a real Muse uses, mounted ahead of the garden's own routes (createApp's second argument):
//   /mcp                   the tools over MCP (Authorization: Bearer mg_...)
//   /api/v1/tools[/<name>] the same tools over REST (the same key)
//   /d/<code>              the doorbell: a bare count of what's waiting, no key
//   /garden.md             CONNECTOR.md, Muse's guide to the garden, with this garden's origin filled in
//   /api/agent-admin/keys  npm run agent:key, from this laptop only, with the admin token written at boot
// Keys, doorbells and kept replies live in <dataDir>/agent.db.
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentCommands, AgentQueries, Instant } from '../../src/muse/contract';
import type { Workshop } from '../workshop/types';
import { AdminKeyRequest, bearer, forwarded, mintAgentKey, museOfRequest, rateLimit, sameToken, writeAdminToken } from './auth';
import { serveDoorbell } from './doorbell';
import { rpcError, serveMcp } from './mcp';
import { CORS, failureJson, readBody, retryHeader, sendJson, serveRest } from './rest';
import { openAgentStore } from './store';
import { connectorTools, inputError, toolCaller } from './tools';
import type { Failure } from './tools';
import type { ToolContext } from './types';

/** Another handler served alongside (the workshop's /w/, the looks' /api/looks/): true if it answered. It must not read the body unless it answers. */
export type ExtraRoute = (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>;

export interface AgentDeps {
  readonly commands: AgentCommands;
  readonly queries: AgentQueries;
  readonly workshop: Workshop;
  /** The sim clock (the engine's). */
  readonly now: () => Instant;
  /** Where agent.db and admin.token live (.muse, or MUSE_DATA). */
  readonly dataDir: string;
  /** The garden's public origin (https://<tunnel host>). Default: MUSE_PUBLIC_ORIGIN, else each request's own host. */
  readonly origin?: string;
  readonly extraRoutes?: readonly ExtraRoute[];
  /** Wall time (ms), for the rate limit and when replies were kept. */
  readonly wall?: () => number;
  /** How long a tool may run before the call answers "still working" (default 40 s, under the 45 s cap). */
  readonly toolTimeoutMs?: number;
  /** The guide served at /garden.md (default server/agent/CONNECTOR.md). */
  readonly guide?: URL | string;
}

export interface AgentHandler {
  /** True if the request was the connector's (answered), false to let the garden's routes have it. */
  (req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  readonly close: () => void;
}

const CONNECTOR_MD = new URL('./CONNECTOR.md', import.meta.url);
const ADMIN_BODY_BYTES = 16 * 1024;

const trimSlash = (origin: string | undefined): string | undefined => (origin === undefined || origin === '' ? undefined : origin.replace(/\/+$/, ''));

/** The origin a request came in on: X-Forwarded-Proto (the tunnel's https) and its host. */
export function requestOrigin(req: IncomingMessage): string {
  const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(',')[0]?.trim();
  const proto = first(req.headers['x-forwarded-proto'])?.toLowerCase() === 'https' ? 'https' : 'http';
  const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? '';
  const safe = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/.test(host) ? host : 'localhost';
  return `${proto}://${safe}`;
}

export function createAgentHandler(deps: AgentDeps): AgentHandler {
  const { commands, queries, workshop, now, dataDir, extraRoutes = [], wall = Date.now, guide: guidePath = CONNECTOR_MD } = deps;
  mkdirSync(dataDir, { recursive: true });
  const store = openAgentStore(join(dataDir, 'agent.db'));
  const adminToken = writeAdminToken(dataDir);
  const tools = connectorTools({ doorbell: (museId) => store.doorbellOf(museId) });
  const callTool = toolCaller({ store, wall, ...(deps.toolTimeoutMs === undefined ? {} : { timeoutMs: deps.toolTimeoutMs }) });
  const limit = rateLimit();
  const configured = trimSlash(deps.origin ?? process.env.MUSE_PUBLIC_ORIGIN);

  /** The key's Muse and its tool context, or the refusal (sent): no key, a wrong one, or over 60 a minute. */
  const admit = (req: IncomingMessage, origin: string, refuse: (f: Failure, h?: Record<string, string>) => void): ToolContext | null => {
    const who = museOfRequest(req, store);
    if (who === null) {
      refuse(
        { status: 401, error: 'This needs your garden key: Authorization: Bearer mg_... (your owner makes one with npm run agent:key).' },
        { 'www-authenticate': 'Bearer realm="muses-garden"' },
      );
      return null;
    }
    const nowMs = wall();
    const next = limit.take(who.keyHash, nowMs);
    if (next !== null) {
      refuse({ status: 429, error: 'Too many requests: at most 60 a minute.', retryAfter: next as Instant });
      return null;
    }
    return { museId: who.museId, now, commands, queries, workshop, origin };
  };

  const mcp = async (req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> => {
    const refuse = (f: Failure, h: Record<string, string> = {}) => {
      res.writeHead(f.status, { ...CORS, 'content-type': 'application/json; charset=utf-8', ...retryHeader(f, wall()), ...h }).end(rpcError(f));
    };
    // Stateless with JSON replies: there is no stream to open (GET) and no session to end (DELETE).
    if (req.method !== 'POST') return refuse({ status: 405, error: 'Send MCP requests with POST.' }, { allow: 'POST' });
    const ctx = admit(req, origin, refuse);
    if (ctx === null) return;
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    await serveMcp(req, res, { tools, call: (tool, args) => callTool(tool, args, ctx), origin });
  };

  const rest = async (req: IncomingMessage, res: ServerResponse, path: string, origin: string): Promise<void> => {
    const refuse = (f: Failure, h: Record<string, string> = {}) => sendJson(res, f.status, failureJson(f), { ...retryHeader(f, wall()), ...h });
    const ctx = admit(req, origin, refuse);
    if (ctx === null) return;
    await serveRest(req, res, path, { tools, call: (tool, args) => callTool(tool, args, ctx) }, wall());
  };

  const guide = async (res: ServerResponse, origin: string): Promise<void> => {
    const md = await readFile(guidePath, 'utf8').catch(() => null);
    if (md === null) {
      res.writeHead(404, { ...CORS, 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { ...CORS, 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' }).end(md.replaceAll('{{origin}}', origin));
  };

  const admin = async (req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> => {
    const refuse = (status: number, error: string) => sendJson(res, status, { status, error });
    if (req.method !== 'POST') return refuse(405, 'Use POST.');
    // The tunnel says whom it forwarded for: a key is only ever made from this laptop.
    if (forwarded(req)) return refuse(403, 'Keys are made on the garden’s own machine only.');
    if (!sameToken(bearer(req), adminToken)) return refuse(401, 'This needs the admin token from admin.token in the garden’s data folder.');
    const body = await readBody(req, ADMIN_BODY_BYTES);
    if (!body.ok) return refuse(body.status, body.error);
    const ask = AdminKeyRequest.safeParse(body.value ?? {});
    if (!ask.success) return refuse(400, inputError(ask.error));
    const minted = await mintAgentKey(ask.data, commands, store, wall());
    if (!minted.ok) return refuse(minted.status, minted.error);
    const { muse, added, key, doorbell } = minted.value;
    sendJson(res, 200, { muse, added, key, connector: `${origin}/mcp`, doorbell: `${origin}/d/${doorbell}`, guide: `${origin}/garden.md` });
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const ours = path === '/mcp' || path === '/api/v1' || path.startsWith('/api/v1/');
    if (ours && req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return true;
    }
    const origin = configured ?? requestOrigin(req);
    if (path === '/mcp') {
      await mcp(req, res, origin);
      return true;
    }
    if (ours) {
      await rest(req, res, path, origin);
      return true;
    }
    const ring = /^\/d\/([^/]+)$/.exec(path);
    if (ring !== null) {
      serveDoorbell(res, req.method, ring[1], store, workshop);
      return true;
    }
    if (path === '/garden.md' && (req.method === 'GET' || req.method === 'HEAD')) {
      await guide(res, origin);
      return true;
    }
    if (path === '/api/agent-admin/keys') {
      await admin(req, res, origin);
      return true;
    }
    for (const route of extraRoutes) if (await route(req, res)) return true;
    return false;
  };

  return Object.assign(handler, { close: () => store.close() });
}
