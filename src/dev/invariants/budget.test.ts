import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildBudget } from '../../core/buildBudget';
import { BuildQueue, type Job } from '../../core/buildQueue';

// How much of a frame the tile builds get (core/buildBudget.ts, core/buildQueue.ts):
// one slow frame does not starve them, a phone catches up too, the catch-up slice
// follows how the frames keep time, and a coarse clock (WebKit reads whole
// milliseconds) still runs many steps a frame.

/** A clock that advances only as the jobs work, read whole milliseconds or not. */
function fakeClock(coarse: boolean): { advance: (ms: number) => void } {
  let t = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => (coarse ? Math.floor(t) : t));
  return { advance: (ms) => (t += ms) };
}

function* steps(n: number, clock: { advance: (ms: number) => void }, ms: number, counter: { n: number }): Job {
  for (let i = 0; i < n; i++) {
    clock.advance(ms);
    counter.n++;
    yield;
  }
}

/**
 * Frames of this length, the build running `sinceMs` after each began, the main thread busy for
 * `busyMs` of each (its JS and the build), as the frame loop feeds them; the last budget.
 */
function feed(b: BuildBudget, frames: number, frameMs: number, backlog: boolean, sinceMs = 3.7, busyMs = 6): number {
  let budget = 0;
  for (let i = 0; i < frames; i++) {
    b.begin(frameMs, backlog, busyMs);
    budget = b.next(backlog, sinceMs);
  }
  return budget;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('build queue', () => {
  it('runs many short steps a frame on a clock that reads whole milliseconds', () => {
    const clock = fakeClock(true);
    const q = new BuildQueue();
    const done = { n: 0 };
    q.add('tile', 0, steps(10000, clock, 0.05, done));
    const perFrame: number[] = [];
    for (let f = 0; f < 10; f++) {
      const before = done.n;
      q.run(2);
      perFrame.push(done.n - before);
    }
    // 2 ms of 0.05 ms steps is 40; iteration 13's guard (the slowest single step, read 1 ms) allowed 1
    expect(Math.min(...perFrame.slice(2))).toBeGreaterThan(15);
  });

  it('keeps to its budget, never starting a step that would not fit (beyond the first)', () => {
    const clock = fakeClock(false);
    const q = new BuildQueue();
    const done = { n: 0 };
    q.add('tile', 0, steps(10000, clock, 0.1, done));
    for (let f = 0; f < 10; f++) expect(q.run(1.5)).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(done.n).toBeGreaterThan(80);
  });

  it('counts the jobs more urgent than a priority, and finds them by key', () => {
    const clock = fakeClock(false);
    const q = new BuildQueue();
    const done = { n: 0 };
    q.add('a', 5, steps(3, clock, 0.1, done));
    q.add('b', 2000, steps(3, clock, 0.1, done));
    q.add('c', 50, steps(3, clock, 0.1, done));
    expect(q.countBelow(1000)).toBe(2);
    q.reprioritise('b', 10);
    expect(q.countBelow(1000)).toBe(3);
    q.cancel('a');
    expect(q.has('a')).toBe(false);
    expect(q.size).toBe(2);
    q.drain();
    expect(q.size).toBe(0);
    expect(done.n).toBe(6);
  });
});

describe('build budget', () => {
  it('gives the queue up to 2 ms of what the frame leaves when nothing waits, and at least 0.5', () => {
    const b = new BuildBudget(false);
    expect(feed(b, 40, 16.7, false, 3.7)).toBeCloseTo(2, 5);
    expect(feed(b, 40, 16.7, false, 12.4)).toBeCloseTo(0.5, 5);
  });

  it('judges each frame on its own: one slow frame does not hold the builds back', () => {
    const b = new BuildBudget(false);
    feed(b, 40, 16.7, false);
    // a shader's first use on the way down from orbit: a frame that leaves nothing
    expect(feed(b, 1, 16.7, true, 76.7)).toBeCloseTo(0.5, 5);
    // through iteration 13 the slowest recent update counted, forgotten 5 % a frame: 0.5 ms for about a second
    expect(feed(b, 1, 16.7, true, 3.7)).toBeGreaterThanOrEqual(3.6);
  });

  it('grows its slice while frames keep time, to 8 ms on a desktop and 6 ms on a phone', () => {
    const desktop = new BuildBudget(false);
    feed(desktop, 40, 16.7, false);
    expect(feed(desktop, 30, 16.7, true)).toBeCloseTo(8, 5);
    const phone = new BuildBudget(true);
    feed(phone, 40, 16.7, false);
    expect(feed(phone, 30, 16.7, true)).toBeCloseTo(6, 5);
  });

  it('halves its slice at a late frame, never below its floor, and resets it once caught up', () => {
    const b = new BuildBudget(false);
    feed(b, 40, 16.7, false);
    feed(b, 30, 16.7, true);
    b.begin(34, true, 30); // a missed refresh, the main thread busy all along
    expect(b.slice).toBeCloseTo(4, 5);
    b.begin(34, true, 30);
    expect(b.slice).toBeCloseTo(3.6, 5);
    feed(b, 1, 16.7, false);
    expect(b.slice).toBeCloseTo(3.6, 5);
  });

  it('never takes more than the frame leaves for it, less a margin for the browser', () => {
    const b = new BuildBudget(false);
    feed(b, 40, 16.7, false);
    expect(feed(b, 30, 16.7, true, 7.7)).toBeCloseTo(16.7 - 7.7 - 4, 5);
  });

  it('keeps growing while the GPU holds frames up and the main thread idles (the way down from orbit)', () => {
    const b = new BuildBudget(false);
    feed(b, 40, 16.7, false);
    // 27 ms frames, the main thread busy 9 ms of each: late, but not the builds' doing
    expect(feed(b, 30, 27, true, 2, 9)).toBeCloseTo(8, 5);
  });

  it('takes a slower frame rate from the frames without a backlog (a phone at 30 fps)', () => {
    const b = new BuildBudget(true);
    feed(b, 40, 33.3, false);
    expect(b.frameMs).toBeCloseTo(33.3, 5);
    // 33 ms frames are on time there, so the slice grows to the phone's ceiling
    expect(feed(b, 30, 33.3, true, 8, 20)).toBeCloseTo(6, 5);
  });

  it('never takes the usual frame shorter than 60 fps allows (a 120 Hz screen)', () => {
    const b = new BuildBudget(false);
    feed(b, 40, 8.3, false);
    expect(b.frameMs).toBeCloseTo(1000 / 60, 5);
  });
});
