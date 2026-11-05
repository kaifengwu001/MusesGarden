// npm run serve: the garden API on MUSE_PORT (default 8787), with the live clock ticking each minute.
import { mkdirSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { Instant, InvitationId } from '../src/muse/contract';
import { visitable, visitUrl } from '../src/visit/params';
import type { AgentHandler } from './agent/index';
import { forwarded } from './agent/auth';
import { createAgentHandler } from './agent/index';
import { defaultIntake } from './agent/intake';
import { tripoMesherFromEnv } from './adapters/tripo';
import { seedCast } from './cli/run';
import { lifePolicy } from './domain/policy/index';
import { buildGarden } from './engine/compose';
import { FIXTURES_DIR, loadCast, membersOf } from './fixtures/cast';
import type { Garden } from './http/app';
import { createApp } from './http/app';
import { startLiveClock } from './http/clock';
import { fakeCommands, fakeQueries } from './http/fake';
import { mediaCache } from './http/media';
import { fakeClients } from './workshop/clients';
import { furnishWaitingHomes } from './workshop/home/index';
import { clientsFromEnv, createWorkshop, jobDir, workshopFiles } from './workshop/index';
import { loadGeneratedPlanets } from './workshop/planet/index';
import { museCodeBuilder } from './workshop/planet/builder';
import { PIPELINES } from './workshop/pipelines';

type Backend = Garden & {
  readonly name: string;
  readonly tick: (now: Instant) => Promise<void>;
  readonly close: () => void | Promise<void>;
  /** A real Muse's connector (/mcp, /api/v1, /d/, /garden.md) and the workshop's files (/w/, /api/looks/). */
  readonly agent?: AgentHandler;
  /** A garden open to the public (MUSE_OPEN_GARDEN=1): its default Muse off to a friend's planet on a ticket of that
   * friend's, sent and used now; the visit's page, or why there's none. */
  readonly visitFriend?: (who: string) => Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly status: number; readonly error: string }>;
};

/** GET /visit/<friend> (a garden open to the public): off to that friend's planet, with the friend there. */
async function visitFromRequest(res: ServerResponse, who: string, visit: NonNullable<Backend['visitFriend']>): Promise<void> {
  const r = await visit(who);
  if (r.ok) {
    res.writeHead(302, { location: r.url, 'cache-control': 'no-store' }).end();
    return;
  }
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  res
    .writeHead(r.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    .end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Muse's Garden</title><body style="font:18px/1.5 Georgia,serif;max-width:32em;margin:15vh auto;padding:0 16px;color:#2b2a24;background:#f6f3ea"><p>${esc(r.error)}</p><p><a href="/">Back to the garden</a></p></body>`);
}

/** MUSE_BACKEND=fake serves the samples; otherwise the real engine on a SQLite file, seeded with the cast on first run. */
async function buildBackend(): Promise<Backend> {
  if (process.env.MUSE_BACKEND === 'fake') {
    const commands = fakeCommands();
    return {
      name: 'sample fake',
      queries: fakeQueries(),
      commands,
      now: () => commands.clock().now,
      subscribe: () => () => undefined,
      tick: () => Promise.resolve(),
      close: () => undefined,
    };
  }
  const clock = process.env.MUSE_CLOCK === 'live' ? 'live' : 'fast-forward';
  const dir = process.env.MUSE_DATA ?? '.muse';
  mkdirSync(dir, { recursive: true });
  const cast = loadCast();
  const hero = cast.members.find((m) => m.role === 'hero')?.id ?? null;
  // (MUSE_START: when a fast-forward garden's life begins, for a garden that then goes live with some days behind it)
  const start = (clock === 'live' ? Date.now() : Date.parse(process.env.MUSE_START ?? '2026-11-02T08:00:00-08:00')) as Instant;
  const garden = buildGarden({
    db: `${dir}/garden.db`,
    mind: process.env.MODEL_API_KEY ? 'meta' : 'heuristic',
    modelFor: process.env.MUSE_MODEL_MIND === 'all' ? 'all' : 'postcards',
    hero,
    start,
    clock,
    members: membersOf(cast),
    // A real Muse's links are opened logged out before they're planted (META_IG_TOKEN for Instagram).
    intake: defaultIntake(),
  });
  if (garden.engine.museIds().length === 0) {
    const work = clock === 'live' ? null : `${FIXTURES_DIR}work-3weeks.json`;
    await seedCast(garden.engine, lifePolicy, { cast: `${FIXTURES_DIR}cast.json`, work, start, hours: 0 });
  }
  // Cast members marked agent: true are real Muses (idempotent; kept out of seedCast so the sim is unchanged).
  for (const m of cast.members.filter((c) => c.agent === true)) {
    await garden.agent.addAgentMuse(m.id, { name: m.name, planet: m.planet, look: m.look, worldSeed: m.worldSeed, timezone: m.timezone });
  }
  // Planets the workshop built for real Muses (environments/generated.json), named as they were approved.
  loadGeneratedPlanets(process.cwd());
  // The workshop: Meta's models for pictures, cut-outs and judging; Tripo (only with TRIPO_LIVE=1) for bodies and
  // pieces of furniture; WORKSHOP_FAKE=1 fakes every outside service. Renders need the page's dev server.
  const workshop = createWorkshop({
    dataDir: dir,
    // Muse Code (Meta's coding agent) answers Muse's notes on its planet's drafts.
    // TRIPO_FAKE=1: everything live but Tripo (muse6's model stands in), for testing without spending.
    clients: clientsFromEnv({
      mesher: process.env.TRIPO_FAKE === '1' ? fakeClients().mesher : (tripoMesherFromEnv(dir) ?? undefined),
      builder: museCodeBuilder(),
    }),
    pipelines: PIPELINES,
    now: () => garden.engine.now(),
    repo: process.cwd(),
    devServer: process.env.MUSE_DEV_SERVER ?? 'http://localhost:5173',
    onDone: async (job, result) => {
      const done = result.look
        ? await garden.agent.applyLook(job.museId, result.look)
        : result.planet
          ? await garden.agent.applyPlanet(job.museId, result.planet.id, result.planet.worldSeed, result.planet.name)
          : null;
      if (done && !done.ok) throw new Error(done.error);
      // A home Muse finished before it had a planet goes into the planet now.
      if (result.planet) {
        const homes = workshop.jobs(job.museId).filter((j) => j.kind === 'home' && j.state === 'done');
        furnishWaitingHomes(process.cwd(), job.museId, homes.map((j) => jobDir(dir, j.id)));
      }
    },
  });
  const agent = createAgentHandler({
    commands: garden.agent,
    queries: garden.agent,
    workshop,
    now: () => garden.engine.now(),
    dataDir: dir,
    extraRoutes: [workshopFiles({ dataDir: dir })],
  });
  return {
    name: `engine (${clock}, ${process.env.MODEL_API_KEY ? (process.env.MUSE_MODEL_MIND === 'all' ? 'MetaMind for the hero' : 'MetaMind writes the hero’s postcards') : 'HeuristicMind'})`,
    queries: garden.views,
    commands: garden.commands,
    now: () => garden.engine.now(),
    media: mediaCache({ dir: `${dir}/media`, items: garden.recording.items }),
    subscribe: (museId, after, send) => garden.views.subscribeGarden(museId, after, send),
    tick: (now) => garden.commands.tick(now),
    ...(process.env.MUSE_OPEN_GARDEN === '1' && hero
      ? {
          visitFriend: async (who: string) => {
            const key = who.trim().toLowerCase();
            const host = cast.members.find((m) => m.id !== hero && (m.id === key || m.name.toLowerCase() === key || m.planet === key));
            if (!host) return { ok: false as const, status: 404, error: `No friend called “${who}” lives on a planet here.` };
            if (!visitable(host.planet)) return { ok: false as const, status: 404, error: `${host.name}’s planet isn’t open for visits yet.` };
            // (on a link the two meet now: each leaves off working, as at the end of a stretch of it, so the trip sets
            // off as the ticket is used and the visit opens with both Muses there, not one of them on the way)
            await garden.engine.hostWork(host.id, 'ended');
            await garden.engine.hostWork(hero, 'ended');
            // (a ticket from the friend, used at once: boarding ends any other trip, and the visit lasts as a ticket's does)
            const ticket: InvitationId = await garden.engine.sendInvitation(host.id, hero);
            const used = await garden.engine.invitationAction(ticket, hero, 'use');
            if (!used.ok) return { ok: false as const, status: used.status, error: used.error };
            return { ok: true as const, url: visitUrl(host.planet, { invitation: ticket, as: hero, garden: `/api/muses/${hero}` }) };
          },
        }
      : {}),
    close: async () => {
      agent.close();
      await workshop.close();
      garden.store.close();
    },
    agent,
  };
}

const backend = await buildBackend();
const port = Number(process.env.MUSE_PORT ?? 8787);
/**
 * What a request through the public tunnel may reach: only what a real Muse uses (its connector, doorbell and guide,
 * and the pictures it downloads). The garden's own routes trust `?as=`, and the host simulator and dev tools have no
 * key, so from outside they stay hidden; the owner's page reaches them from this laptop as before.
 */
const PUBLIC_PATHS = [/^\/mcp\/?$/, /^\/api\/v1\//, /^\/d\//, /^\/s\//, /^\/garden\.md$/, /^\/w\//, /^\/api\/looks\//, /^\/api\/postcards\//, /^\/api\/media\//];
/**
 * A garden open to the public (MUSE_OPEN_GARDEN=1): from outside, every Muse's garden and the visits on it can be
 * read, and its default Muse's owner's own routes used (a like, a basket opened, a setting, a ticket used or a visit
 * ended), as its page does; the host simulator and the dev tools stay on this laptop. The routes trust `?as=`, so the
 * owner's ones answer only as the default Muse.
 */
const OPEN_AS = process.env.MUSE_OPEN_GARDEN === '1' ? (loadCast().members.find((m) => m.role === 'hero')?.id ?? null) : null;
function openToAll(method: string | undefined, path: string, as: string | null): boolean {
  if (!OPEN_AS) return false;
  if (method === 'GET' || method === 'HEAD') return /^\/api\/muses(\/[a-z0-9-]+(\/.*)?)?$/.test(path) || /^\/api\/visits\/[^/]+\/world$/.test(path) || /^\/visit\/[^/]+\/?$/.test(path);
  if (method !== 'POST') return false;
  const own = new RegExp(`^/api/muses/${OPEN_AS}/(settings/(basket-time|hidden|introductions|unshare)|garden/reactions)$`);
  return own.test(path) || (as === OPEN_AS && /^\/api\/(invitations\/[^/]+\/withdraw|visits\/[^/]+\/return)$/.test(path));
}
const app = createApp(backend, backend.agent);
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const open = openToAll(req.method, path, new URL(req.url ?? '/', 'http://garden').searchParams.get('as'));
  if (forwarded(req) && !open && !PUBLIC_PATHS.some((p) => p.test(path))) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'not found' }));
    return;
  }
  // (a garden open to the public: /visit/<friend> takes its default Muse to that friend's planet)
  const friend = /^\/visit\/([^/]+)\/?$/.exec(path);
  if (backend.visitFriend && friend && (req.method === 'GET' || req.method === 'HEAD')) {
    void visitFromRequest(res, decodeURIComponent(friend[1] ?? ''), backend.visitFriend);
    return;
  }
  app(req, res);
});
// Wall time, not the engine's: ticking to the engine's own now would never move it.
const clock = startLiveClock({ tick: backend.tick });

server.listen(port, () => console.info(`Muse garden API (${backend.name}) on http://localhost:${port}/api`));

const shutdown = () => {
  void clock.stop().then(() => {
    // Event streams never go idle, so the server would wait on them forever.
    server.closeAllConnections();
    server.close();
    void backend.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
