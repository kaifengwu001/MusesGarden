// npm run serve: the garden API on MUSE_PORT (default 8787), with the live clock ticking each minute.
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Instant } from '../src/muse/contract';
import { seedCast } from './cli/run';
import { lifePolicy } from './domain/policy/index';
import { buildGarden } from './engine/compose';
import { FIXTURES_DIR, loadCast } from './fixtures/cast';
import type { Garden } from './http/app';
import { createApp } from './http/app';
import { startLiveClock } from './http/clock';
import { fakeCommands, fakeQueries } from './http/fake';

type Backend = Garden & { readonly name: string; readonly tick: (now: Instant) => Promise<void>; readonly close: () => void };

/** MUSE_BACKEND=fake serves the samples; otherwise the real engine on a SQLite file, seeded with the cast on first run. */
async function buildBackend(): Promise<Backend> {
  if (process.env.MUSE_BACKEND === 'fake') {
    const commands = fakeCommands();
    return { name: 'sample fake', queries: fakeQueries(), commands, now: () => commands.clock().now, tick: () => Promise.resolve(), close: () => undefined };
  }
  const clock = process.env.MUSE_CLOCK === 'live' ? 'live' : 'fast-forward';
  const dir = process.env.MUSE_DATA ?? '.muse';
  mkdirSync(dir, { recursive: true });
  const cast = loadCast();
  const hero = cast.members.find((m) => m.role === 'hero')?.id ?? null;
  const start = (clock === 'live' ? Date.now() : Date.parse('2026-11-02T08:00:00-08:00')) as Instant;
  const garden = buildGarden({
    db: `${dir}/garden.db`,
    source: process.env.MUSE_SOURCE === 'live' ? 'live' : 'fixture',
    mind: process.env.MODEL_API_KEY ? 'meta' : 'heuristic',
    hero,
    start,
    clock,
    roles: new Map(cast.members.map((m) => [m.id, m.role])),
  });
  if (garden.engine.museIds().length === 0) {
    const work = clock === 'live' ? null : `${FIXTURES_DIR}work-3weeks.json`;
    await seedCast(garden.engine, lifePolicy, { cast: `${FIXTURES_DIR}cast.json`, work, start, hours: 0, owners: 'auto-accept' });
  }
  return {
    name: `engine (${clock}, ${process.env.MODEL_API_KEY ? 'MetaMind for the hero' : 'HeuristicMind'})`,
    queries: garden.views,
    commands: garden.commands,
    now: () => garden.engine.now(),
    tick: (now) => garden.commands.tick(now),
    close: () => garden.store.close(),
  };
}

const backend = await buildBackend();
const port = Number(process.env.MUSE_PORT ?? 8787);
const server = createServer(createApp(backend));
const clock = startLiveClock({ tick: backend.tick, now: backend.now });

server.listen(port, () => console.info(`Muse garden API (${backend.name}) on http://localhost:${port}/api`));

const shutdown = () => {
  void clock.stop().then(() => {
    server.close();
    backend.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
