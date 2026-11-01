import type { Instant } from '../../src/muse/contract';

export interface LiveClock {
  /** Cancels the next tick and resolves once any tick in flight has settled. */
  stop(): Promise<void>;
}

/**
 * Runs `tick(now())` at once, then `intervalMs` after each tick settles, so ticks never overlap. A failed tick is
 * logged and the clock keeps going. Wave 2 passes the engine's `advanceTo` as `tick`.
 */
export function startLiveClock({
  tick,
  intervalMs = 60_000,
  now = () => Date.now() as Instant,
}: {
  readonly tick: (now: Instant) => Promise<void>;
  readonly intervalMs?: number;
  readonly now?: () => Instant;
}): LiveClock {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void>;

  const loop = async (): Promise<void> => {
    try {
      await tick(now());
    } catch (err) {
      console.error('live clock: tick failed', err);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        running = loop();
      }, intervalMs);
    }
  };

  running = loop();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      return running;
    },
  };
}
