// npm run serve: the garden API on MUSE_PORT (default 8787), with the live clock ticking each minute.
import { createServer } from 'node:http';
import type { Instant } from '../src/muse/contract';
import type { Garden } from './http/app';
import { createApp } from './http/app';
import { startLiveClock } from './http/clock';
import { fakeCommands, fakeQueries } from './http/fake';

/** The garden the API serves, and what the live clock does each tick. Wave 2 returns the real engine here. */
function buildBackend(): Garden & { readonly name: string; readonly tick: (now: Instant) => Promise<void> } {
  const commands = fakeCommands();
  return {
    name: 'sample fake',
    queries: fakeQueries(),
    commands,
    now: () => commands.clock().now,
    tick: () => Promise.resolve(),
  };
}

const backend = buildBackend();
const port = Number(process.env.MUSE_PORT ?? 8787);
const server = createServer(createApp(backend));
const clock = startLiveClock({ tick: backend.tick, now: backend.now });

server.listen(port, () => console.info(`Muse garden API (${backend.name}) on http://localhost:${port}/api`));

const shutdown = () => {
  void clock.stop().then(() => server.close());
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
