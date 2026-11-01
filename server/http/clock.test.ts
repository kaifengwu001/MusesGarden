import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Instant } from '../../src/muse/contract';
import { startLiveClock } from './clock';

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('startLiveClock', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ticks at once, then every interval, with the wall time', async () => {
    const seen: Instant[] = [];
    const clock = startLiveClock({ tick: (now) => Promise.resolve(void seen.push(now)) });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(seen).toEqual([0, 60_000, 120_000, 180_000]);
    await clock.stop();
  });

  it('never starts a tick while the last one is still running', async () => {
    const gates: ReturnType<typeof gate>[] = [];
    let active = 0;
    let maxActive = 0;
    const clock = startLiveClock({
      intervalMs: 10,
      tick: async () => {
        const g = gate();
        gates.push(g);
        maxActive = Math.max(maxActive, ++active);
        await g.opened;
        active--;
      },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gates).toHaveLength(1);

    gates[0].open();
    await vi.advanceTimersByTimeAsync(10);
    expect(gates).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gates).toHaveLength(2);
    expect(maxActive).toBe(1);

    gates[1].open();
    await clock.stop();
  });

  it('stops cleanly: waits for the tick in flight and starts no more', async () => {
    const g = gate();
    let ticks = 0;
    const clock = startLiveClock({
      intervalMs: 10,
      tick: () => {
        ticks++;
        return g.opened;
      },
    });

    let stopped = false;
    const stopping = clock.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false);

    g.open();
    await stopping;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ticks).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops between ticks without another tick', async () => {
    let ticks = 0;
    const clock = startLiveClock({ intervalMs: 10, tick: () => Promise.resolve(void ticks++) });
    await vi.advanceTimersByTimeAsync(15);
    expect(ticks).toBe(2);

    await clock.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ticks).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a failed tick and keeps ticking', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let ticks = 0;
    const clock = startLiveClock({
      intervalMs: 10,
      tick: () => (++ticks === 1 ? Promise.reject(new Error('source offline')) : Promise.resolve()),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(ticks).toBe(2);
    expect(error).toHaveBeenCalledOnce();
    await clock.stop();
  });
});
