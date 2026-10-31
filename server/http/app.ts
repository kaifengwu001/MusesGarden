import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  BasketId,
  CommandResult,
  DiscoveryId,
  GardenCommands,
  GardenQueries,
  Instant,
  InvitationId,
  MuseId,
  PhotoId,
} from '../../src/muse/contract';
import { requestingOwner } from './owner';
import {
  HttpError,
  before,
  clockMode,
  day,
  field,
  flag,
  hhmm,
  hiddenRef,
  hours,
  id,
  limit,
  readJson,
  shareCode,
  text,
  workState,
} from './parse';

/** What the API serves: the engine in wave 2, the sample-backed fake until then. */
export interface Garden {
  readonly queries: GardenQueries;
  readonly commands: GardenCommands;
  /** The sim clock's instant, for /now, /invitations and /visits. */
  readonly now: () => Instant;
}

interface Reply {
  readonly status: number;
  readonly type?: string;
  readonly body: string;
}

interface Call {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

interface Route {
  readonly method: 'GET' | 'POST';
  /** The path split on '/'; a ':name' segment captures that param. */
  readonly path: readonly string[];
  readonly handle: (call: Call) => Reply | Promise<Reply>;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (value: unknown, status = 200): Reply => ({
  status,
  type: 'application/json; charset=utf-8',
  body: JSON.stringify(value),
});

function found(value: unknown): Reply {
  if (value === null) throw new HttpError(404, 'not found');
  return json(value);
}

function markdown(md: string | null): Reply {
  if (md === null) throw new HttpError(404, 'not found');
  return { status: 200, type: 'text/markdown; charset=utf-8', body: md };
}

function result(r: CommandResult): Reply {
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}

function routesFor({ queries, commands, now }: Garden): readonly Route[] {
  const muse = (raw: string): MuseId => {
    const museId = id<MuseId>(raw, 'id');
    if (!queries.muses().some((m) => m.museId === museId)) throw new HttpError(404, 'no such Muse');
    return museId;
  };
  const get = (path: string, handle: Route['handle']): Route => ({ method: 'GET', path: path.split('/'), handle });
  const post = (path: string, handle: Route['handle']): Route => ({ method: 'POST', path: path.split('/'), handle });

  return [
    get('/api/muses', () => json(queries.muses())),
    get('/api/muses/:id/now', ({ params }) => found(queries.now(muse(params.id), now()))),
    get('/api/muses/:id/world', ({ params }) => found(queries.world(muse(params.id)))),
    get('/api/muses/:id/plants/:pid', ({ params }) =>
      found(queries.plant(muse(params.id), id<DiscoveryId>(params.pid, 'pid'))),
    ),
    get('/api/muses/:id/baskets', ({ params, query }) =>
      json(queries.baskets(muse(params.id), before<BasketId>(query), limit(query))),
    ),
    get('/api/muses/:id/photos', ({ params, query }) =>
      json(queries.photos(muse(params.id), before<PhotoId>(query), limit(query))),
    ),
    get('/api/muses/:id/home/shelf', ({ params }) => found(queries.shelf(muse(params.id)))),
    get('/api/muses/:id/invitations', ({ params }) => json(queries.invitations(muse(params.id), now()))),
    get('/api/muses/:id/settings/sharing', ({ params }) => found(queries.sharing(muse(params.id)))),
    post('/api/muses/:id/settings/basket-time', async ({ params, body }) =>
      result(await commands.setBasketTime(muse(params.id), hhmm(field(body, 'hhmm')))),
    ),
    post('/api/muses/:id/settings/hidden', async ({ params, body }) =>
      result(await commands.setHidden(muse(params.id), hiddenRef(field(body, 'ref')), flag(field(body, 'hidden'), 'hidden'))),
    ),
    post('/api/muses/:id/settings/introductions', async ({ params, body }) =>
      result(await commands.introduce(muse(params.id), shareCode(field(body, 'shareCode')))),
    ),
    post('/api/muses/:id/settings/unshare', async ({ params, body }) =>
      result(await commands.unshare(muse(params.id), id<MuseId>(field(body, 'other'), 'other'))),
    ),

    ...(['approve', 'decline', 'accept'] as const).map((action) =>
      post(`/api/invitations/:id/${action}`, async ({ params, query }) =>
        result(await commands.invitation(id<InvitationId>(params.id, 'id'), requestingOwner(query), action)),
      ),
    ),
    get('/api/visits/:id/world', ({ params, query }) => {
      const view = queries.visit(id<InvitationId>(params.id, 'id'), requestingOwner(query), now());
      if (view === 'forbidden') throw new HttpError(403, 'no open visit for you');
      return json(view);
    }),

    post('/api/host/:id/work', async ({ params, body }) =>
      result(await commands.hostWork(muse(params.id), workState(field(body, 'state')))),
    ),
    post('/api/host/:id/soul', async ({ params, body }) =>
      result(await commands.hostSoul(muse(params.id), text(field(body, 'text')))),
    ),
    post('/api/host/:id/memory', async ({ params, body }) => {
      const museId = muse(params.id);
      const memory = text(field(body, 'text'));
      // The engine's errors may quote MEMORY.md (inside a Mind prompt, say), so none reaches a reply or a log.
      const r = await commands.hostMemory(museId, memory).catch(() => null);
      if (r === null) throw new HttpError(500, 'MEMORY.md update failed');
      return result(r.ok ? r : { ...r, error: 'MEMORY.md update rejected' });
    }),

    post('/api/dev/advance', async ({ body }) => result(await commands.advance(hours(field(body, 'hours'))))),
    post('/api/dev/clock', async ({ body }) => result(await commands.setClock(clockMode(field(body, 'mode'))))),
    get('/api/dev/clock', () => json(commands.clock())),
    get('/api/dev/:id/mind', ({ params }) => found(queries.mind(muse(params.id)))),
    get('/api/dev/:id/metrics', ({ params }) => json(queries.metrics(muse(params.id)))),
    get('/api/dev/:id/soul.md', ({ params }) => markdown(queries.soulMd(muse(params.id)))),
    get('/api/dev/:id/journal.md', ({ params, query }) => markdown(queries.journalMd(muse(params.id), day(query)))),
  ];
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'path must be valid percent-encoding');
  }
}

function match(path: readonly string[], parts: readonly string[]): Record<string, string> | null {
  if (path.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, segment] of path.entries()) {
    if (segment.startsWith(':')) params[segment.slice(1)] = parts[i];
    else if (segment !== parts[i]) return null;
  }
  return params;
}

async function reply(routes: readonly Route[], req: IncomingMessage): Promise<Reply> {
  if (req.method === 'OPTIONS') return { status: 204, body: '' };
  try {
    const url = new URL(`http://localhost${req.url ?? '/'}`);
    const parts = url.pathname.split('/').map(decode);
    for (const route of routes) {
      const params = route.method === req.method ? match(route.path, parts) : null;
      if (params === null) continue;
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      return await route.handle({ params, query: url.searchParams, body });
    }
    throw new HttpError(404, 'no such route');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(`${req.method} ${req.url} failed`, err);
    return json({ error: 'internal error' }, 500);
  }
}

/** The garden API as a node:http request listener. */
export function createApp(garden: Garden): (req: IncomingMessage, res: ServerResponse) => void {
  const routes = routesFor(garden);
  return (req, res) => {
    void reply(routes, req).then(({ status, type, body }) => {
      res.writeHead(status, type === undefined ? CORS : { ...CORS, 'content-type': type }).end(body);
    });
  };
}
