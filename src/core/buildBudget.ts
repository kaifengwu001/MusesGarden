import { clamp } from './math';
import { FRAME_BUDGET_MS } from './quality';

/** Normally the queue gets up to `slice` ms of the time a frame leaves, and at least `min`, so the meadow keeps growing in. */
const PLAIN = { min: 0.5, slice: 2 } as const;

/**
 * While tiles wait to be built in sight (a jump, a fly-in, a glide), a slice
 * that grows by `grow` ms each frame that arrives on time and is cut by
 * `cut` at a late one, between a floor and a ceiling: a phone's are lower (a
 * slower CPU, sharing its time with a busier GPU). `margin` of the time
 * before the next frame is always left to the browser.
 */
const CATCH_UP = {
  desktop: { floor: 3.6, most: 8 },
  phone: { floor: 2, most: 6 },
  grow: 0.5,
  cut: 0.5,
  margin: 4,
  /** A frame this much longer than the usual interval missed its refresh. */
  late: 1.35,
  /** ... the builds' fault only if the main thread was busy (the frame's JS and the build) for this much of it; otherwise the GPU held it up. */
  busy: 0.6,
} as const;
/** The longest frame interval the time left is reckoned on (ms). */
const LONGEST = 50;

/** Frames the usual interval is taken over. */
const HISTORY = 30;

/**
 * How long the build queue (vegetation tiles) may run after a frame. It runs
 * in a task of its own once the frame is handed to the GPU, so it overlaps
 * the GPU's work, in the time the frame leaves before the next one: the
 * usual frame interval (the median of the frames without a backlog, never
 * shorter than the 60 fps the quality controller aims at: on a 120 Hz screen
 * the frame is still 16.7 ms) less what the frame has taken. Each frame is
 * judged on its own, so one slow frame does not hold the builds back (through
 * iteration 13 the slowest recent update counted, forgotten 5 % a frame, and a
 * single slow frame, a shader's first use on the way down from orbit, starved
 * the queue for about a second).
 */
export class BuildBudget {
  /** The catch-up slice now (ms): its floor while nothing waits. */
  slice: number;
  private readonly floor: number;
  private readonly most: number;
  private readonly intervals = new Float64Array(HISTORY);
  private intervalCount = 0;
  /** The last frame's interval (ms). */
  private lastMs: number = FRAME_BUDGET_MS;
  private readonly scratch: number[] = [];

  constructor(phone: boolean) {
    const c = phone ? CATCH_UP.phone : CATCH_UP.desktop;
    this.floor = c.floor;
    this.most = c.most;
    this.slice = c.floor;
  }

  /** The usual frame interval (ms): the median of the frames without a backlog, at least the 60 fps target's. */
  get frameMs(): number {
    const n = Math.min(this.intervalCount, HISTORY);
    if (n === 0) return FRAME_BUDGET_MS;
    const s = this.scratch;
    s.length = 0;
    for (let i = 0; i < n; i++) s.push(this.intervals[i]);
    s.sort((a, b) => a - b);
    return Math.max(FRAME_BUDGET_MS, s[n >> 1]);
  }

  /**
   * Once a frame: the time since the last one (ms), whether tiles wait in
   * sight, and how long the main thread was busy over it (its JS and the
   * build after it, ms). Grows or cuts the catch-up slice by how the last
   * frame kept time: a frame the GPU held up (the main thread mostly idle,
   * as on the way down from orbit) is not the builds' fault.
   */
  begin(frameMs: number, backlog: boolean, busyMs: number): void {
    if (!(frameMs > 0 && frameMs < 250)) return; // a hidden tab or a stall says nothing of the build
    this.lastMs = Math.min(frameMs, LONGEST);
    if (!backlog) {
      this.intervals[this.intervalCount++ % HISTORY] = frameMs;
      this.slice = this.floor;
      return;
    }
    const late = frameMs > this.frameMs * CATCH_UP.late && busyMs > frameMs * CATCH_UP.busy;
    this.slice = late ? Math.max(this.floor, this.slice * CATCH_UP.cut) : Math.min(this.most, this.slice + CATCH_UP.grow);
  }

  /**
   * The queue's budget (ms), `sinceMs` after the frame began: what is left
   * before the next frame is due (by the usual interval, or the last one's
   * while the GPU holds frames up), less the browser's margin.
   */
  next(backlog: boolean, sinceMs: number): number {
    const left = Math.max(this.frameMs, this.lastMs) - sinceMs;
    return clamp(left - CATCH_UP.margin, PLAIN.min, backlog ? this.slice : PLAIN.slice);
  }
}
