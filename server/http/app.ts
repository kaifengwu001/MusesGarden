import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type {
  BasketId,
  CommandResult,
  DiscoveryId,
  GardenCommands,
  GardenFrame,
  GardenQueries,
  Instant,
  InvitationId,
  MuseId,
  PhotoId,
} from '../../src/muse/contract';
import type { MediaImages } from './media';
import { isPlanetId } from '../../src/muse/planets';
import { ROUTES, type RouteName } from '../../src/muse/routes';
import { PLANET_STILL, POSTCARDS_DIR } from '../fixtures/planetStills';
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
  ids,
  lastEventId,
  limit,
  reaction,
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
  /** Pictures of finds whose own links expire; absent where nothing is cached. */
  readonly media?: MediaImages;
  /** The garden's events for one Muse: those after log seq `after`, then Muse's status, then each as it happens. Returns the way to stop. */
  readonly subscribe: (museId: MuseId, after: number | null, send: (frame: GardenFrame) => void) => () => void;
}

interface Body {
  readonly status: number;
  readonly type?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

/** Server-sent events: `open` starts sending frames and returns the way to stop. */
interface Stream {
  readonly open: (send: (frame: GardenFrame) => void) => () => void;
}

type Reply = Body | Stream;

interface Call {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

interface Route {
  readonly method: 'GET' | 'POST';
  /** The path split on '/'; a ':name' segment captures that param. */
  readonly path: readonly string[];
  readonly handle: (call: Call) => Reply | Promise<Reply>;
}

const KEEP_ALIVE_MS = 25_000;
const POSTCARDS = new URL('../../src/assets/postcards/', import.meta.url);

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

/** One of the postcard stills in src/assets/postcards/ (stills.ts). */
async function postcard(name: string): Promise<Reply> {
  if (!/^[a-z]+(-[a-z]+)*(-\d+)?\.jpg$/.test(name)) throw new HttpError(404, 'no such postcard');
  const body = await readFile(new URL(name, POSTCARDS)).catch(() => null);
  if (body === null) throw new HttpError(404, 'no such postcard');
  return { status: 200, type: 'image/jpeg', headers: { 'cache-control': 'public, max-age=86400' }, body };
}

/** One of a planet's own postcard stills, src/assets/postcards/<planet>/ (server/fixtures/planetStills.ts). */
async function planetPostcard(planet: string, name: string): Promise<Reply> {
  if (!isPlanetId(planet) || !PLANET_STILL.test(name)) throw new HttpError(404, 'no such postcard');
  const body = await readFile(join(POSTCARDS_DIR, planet, name)).catch(() => null);
  if (body === null) throw new HttpError(404, 'no such postcard');
  // (a still may be taken again under its name: kept a little only)
  return { status: 200, type: name.endsWith('.png') ? 'image/png' : 'image/jpeg', headers: { 'cache-control': 'public, max-age=300' }, body };
}

function routesFor({ queries, commands, now, media, subscribe }: Garden): readonly Route[] {
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
    withdraw: async ({ params, query }) => result(await commands.withdrawInvitation(requestingOwner(query), id<InvitationId>(params.id, 'id'))),
    visit: ({ params, query }) => {
      const view = queries.visit(id<InvitationId>(params.id, 'id'), requestingOwner(query), now());
      if (view === 'forbidden') throw new HttpError(403, 'no visit of yours is open');
      return json(view);
    },
    returnFromVisit: async ({ params, query }) => result(await commands.returnFromVisit(requestingOwner(query), id<InvitationId>(params.id, 'id'))),
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
    devInvite: async ({ body }) => result(await commands.devInvite(muse(id<MuseId>(field(body, 'host'), 'host')), muse(id<MuseId>(field(body, 'guest'), 'guest')))),
    devFriends: async ({ body }) => {
      const museId = muse(id<MuseId>(field(body, 'muse'), 'muse'));
      return result(await commands.devFriends(museId, ids<MuseId>(field(body, 'friends'), 'friends').map(muse)));
    },
    mind: ({ params }) => found(queries.mind(muse(params.id))),
    metrics: ({ params }) => json(queries.metrics(muse(params.id))),
    soulMd: ({ params }) => markdown(queries.soulMd(muse(params.id))),
    journalMd: ({ params, query }) => markdown(queries.journalMd(muse(params.id), day(query))),
    garden: ({ params }) => found(queries.garden(muse(params.id), now())),
    gardenEvents: ({ params, headers }) => {
      const museId = muse(params.id);
      const after = lastEventId(headers['last-event-id']);
      return { open: (send) => subscribe(museId, after, send) };
    },
    gardenReactions: async ({ params, body }) => {
      const museId = muse(params.id);
      const r = reaction(body);
      switch (r.type) {
        case 'like-find':
          return result(await commands.like(museId, { find: r.id as DiscoveryId }, r.liked));
        case 'like-postcard':
        case 'favorite-postcard': {
          const card = queries.garden(museId, now())?.postcards.find((p) => p.id === r.id);
          if (!card) throw new HttpError(404, 'no such postcard');
          // An invitation is a postcard you travel with, not a photo Muse took: there is nothing to like or star.
          if (card.invitation) return json({ ok: true });
          const photo = r.id as PhotoId;
          return result(await (r.type === 'like-postcard' ? commands.like(museId, { photo }, r.liked) : commands.favorite(museId, photo, r.favorite)));
        }
        case 'share-interest':
          return result(await commands.setHidden(museId, `topic:${r.id}`, !r.shared));
        case 'share-find':
          if (!queries.plant(museId, r.id as DiscoveryId)) throw new HttpError(404, 'no such find');
          return result(await commands.setHidden(museId, `discovery:${r.id}`, !r.shared));
        case 'use-invitation':
          return result(await commands.useInvitation(museId, r.id as InvitationId));
        case 'set-reach':
          return result(await commands.setReach(museId, r.reach));
      }
    },
    media: async ({ params }) => {
      const image = media === undefined ? null : await media(params.mid);
      if (image === null) throw new HttpError(404, 'not found');
      return { status: 200, type: image.type, body: image.body };
    },
    postcardImage: ({ params }) => postcard(params.name),
    planetPostcardImage: ({ params }) => planetPostcard(params.planet, params.name),
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
      return await route.handle({ params, query: url.searchParams, headers: req.headers, body });
    }
    throw new HttpError(404, 'no such route');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(`${req.method} ${req.url} failed`, err);
    return json({ error: 'internal error' }, 500);
  }
}

/** Frames as unnamed `data:` events (the garden listens with onmessage), each with its log seq as its id. */
function stream(res: ServerResponse, { open }: Stream): void {
  res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  const write = (text: string) => {
    if (!res.destroyed) res.write(text);
  };
  const alive = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);
  let stop: () => void = () => undefined;
  res.on('close', () => {
    clearInterval(alive);
    stop();
  });
  try {
    stop = open((frame) => write(`id: ${frame.id}\ndata: ${JSON.stringify(frame.event)}\n\n`));
  } catch (err) {
    console.error('a garden event stream failed', err);
    res.end();
  }
}

/** A handler that goes ahead of the garden's routes (the connector, server/agent): true if it answered the request. */
export type Mount = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/** The garden API as a node:http request listener, with `mount` (if given) offered every request first. */
export function createApp(garden: Garden, mount?: Mount): (req: IncomingMessage, res: ServerResponse) => void {
  const routes = routesFor(garden);
  const serve = (req: IncomingMessage, res: ServerResponse) => {
    void reply(routes, req).then((r) => {
      if ('open' in r) return stream(res, r);
      res.writeHead(r.status, { ...CORS, ...(r.type === undefined ? {} : { 'content-type': r.type }), ...r.headers }).end(r.body);
    });
  };
  if (mount === undefined) return serve;
  return (req, res) => {
    mount(req, res).then(
      (handled) => {
        if (!handled) serve(req, res);
      },
      (err: unknown) => {
        console.error(`${req.method} ${req.url} failed`, err);
        if (res.headersSent) res.end();
        else res.writeHead(500, { ...CORS, 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'internal error' }));
      },
    );
  };
}
