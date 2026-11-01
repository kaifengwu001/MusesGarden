import { ROUTES, type RouteName } from '../../src/muse/routes';
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

  // Typed by every route name, so a route without a handler doesn't compile.
  const handlers: { readonly [N in RouteName]: Route['handle'] } = {
    muses: () => json(queries.muses()),
    now: ({ params }) => found(queries.now(muse(params.id), now())),
    world: ({ params }) => found(queries.world(muse(params.id))),
    plant: ({ params }) => found(queries.plant(muse(params.id), id<DiscoveryId>(params.pid, 'pid'))),
    baskets: ({ params, query }) => json(queries.baskets(muse(params.id), before<BasketId>(query), limit(query))),
    photos: ({ params, query }) => json(queries.photos(muse(params.id), before<PhotoId>(query), limit(query))),
    shelf: ({ params }) => found(queries.shelf(muse(params.id))),
    invitations: ({ params }) => json(queries.invitations(muse(params.id), now())),
    sharing: ({ params }) => found(queries.sharing(muse(params.id))),
    basketTime: async ({ params, body }) => result(await commands.setBasketTime(muse(params.id), hhmm(field(body, 'hhmm')))),
    hidden: async ({ params, body }) =>
      result(await commands.setHidden(muse(params.id), hiddenRef(field(body, 'ref')), flag(field(body, 'hidden'), 'hidden'))),
    introduce: async ({ params, body }) => result(await commands.introduce(muse(params.id), shareCode(field(body, 'shareCode')))),
    unshare: async ({ params, body }) => result(await commands.unshare(muse(params.id), id<MuseId>(field(body, 'other'), 'other'))),
    answer: async ({ params, query }) => {
      const action = params.action;
      if (action !== 'approve' && action !== 'decline' && action !== 'accept') throw new HttpError(404, 'no such route');
      return result(await commands.invitation(id<InvitationId>(params.id, 'id'), requestingOwner(query), action));
    },
    visit: ({ params, query }) => {
      const view = queries.visit(id<InvitationId>(params.id, 'id'), requestingOwner(query), now());
      if (view === 'forbidden') throw new HttpError(403, 'no open visit for you');
      return json(view);
    },
    hostWork: async ({ params, body }) => result(await commands.hostWork(muse(params.id), workState(field(body, 'state')))),
    hostSoul: async ({ params, body }) => result(await commands.hostSoul(muse(params.id), text(field(body, 'text')))),
    hostMemory: async ({ params, body }) => {
      const museId = muse(params.id);
      const memory = text(field(body, 'text'));
      // The engine's errors may quote MEMORY.md (inside a Mind prompt, say), so none reaches a reply or a log.
      const r = await commands.hostMemory(museId, memory).catch(() => null);
      if (r === null) throw new HttpError(500, 'MEMORY.md update failed');
      return result(r.ok ? r : { ...r, error: 'MEMORY.md update rejected' });
    },
    advance: async ({ body }) => result(await commands.advance(hours(field(body, 'hours')))),
    setClock: async ({ body }) => result(await commands.setClock(clockMode(field(body, 'mode')))),
    clock: () => json(commands.clock()),
    mind: ({ params }) => found(queries.mind(muse(params.id))),
    metrics: ({ params }) => json(queries.metrics(muse(params.id))),
    soulMd: ({ params }) => markdown(queries.soulMd(muse(params.id))),
    journalMd: ({ params, query }) => markdown(queries.journalMd(muse(params.id), day(query))),
    garden: ({ params }) => found(queries.garden(muse(params.id), now())),
    gardenEvents: () => {
      throw new HttpError(404, 'no such route');
    },
    gardenReactions: () => {
      throw new HttpError(404, 'no such route');
    },
    media: () => {
      throw new HttpError(404, 'no such route');
    },
    postcardImage: () => {
      throw new HttpError(404, 'no such route');
    },
  };

  return (Object.keys(ROUTES) as RouteName[]).map((name) => ({
    method: ROUTES[name].method,
    path: ROUTES[name].pattern.split('/'),
    handle: handlers[name],
  }));
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
