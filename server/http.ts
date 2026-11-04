// npm run serve: the garden API on MUSE_PORT (default 8787), with the live clock ticking each minute.
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Instant } from '../src/muse/contract';
import type { AgentHandler } from './agent/index';
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
import { clientsFromEnv, createWorkshop, workshopFiles } from './workshop/index';
import { PIPELINES } from './workshop/pipelines';

type Backend = Garden & {
  readonly name: string;
  readonly tick: (now: Instant) => Promise<void>;
  readonly close: () => void | Promise<void>;
  /** A real Muse's connector (/mcp, /api/v1, /d/, /garden.md) and the workshop's files (/w/, /api/looks/). */
  readonly agent?: AgentHandler;
};

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
  const start = (clock === 'live' ? Date.now() : Date.parse('2026-11-02T08:00:00-08:00')) as Instant;
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
  // The workshop: Meta's models for pictures, cut-outs and judging; Tripo (only with TRIPO_LIVE=1) for bodies and
  // pieces of furniture; WORKSHOP_FAKE=1 fakes every outside service. Renders need the page's dev server.
  const workshop = createWorkshop({
    dataDir: dir,
    clients: clientsFromEnv({ mesher: tripoMesherFromEnv(dir) ?? undefined }),
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
const server = createServer(createApp(backend, backend.agent));
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
