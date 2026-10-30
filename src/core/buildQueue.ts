/** A unit of background work that yields whenever it is safe to pause. */
export type Job = Generator<void, void, void>;

interface Entry {
  readonly key: string;
  priority: number;
  readonly job: Job;
}

/**
 * Time-sliced build queue. Jobs are generators; `run` resumes them, most
 * urgent first (lowest priority value), until the frame's budget is spent,
 * so heavy work (vegetation tiles, rest-point enumeration) never causes a
 * hitch. `drain` finishes everything at once for deterministic captures.
 */
export class BuildQueue {
  /** Milliseconds spent in the most recent `run`. */
  lastMs = 0;
  private entries: Entry[] = [];
  /** The longest recent job step (ms), slowly forgotten: a step that would likely overrun the slice waits for the next frame. */
  private stepMs = 0.2;

  get size(): number {
    return this.entries.length;
  }

  has(key: string): boolean {
    return this.entries.some((e) => e.key === key);
  }

  /** Add or replace the job under `key`. */
  add(key: string, priority: number, job: Job): void {
    this.cancel(key);
    this.entries.push({ key, priority, job });
  }

  reprioritise(key: string, priority: number): void {
    const e = this.entries.find((x) => x.key === key);
    if (e) e.priority = priority;
  }

  cancel(key: string): void {
    const i = this.entries.findIndex((e) => e.key === key);
    if (i >= 0) {
      this.entries[i].job.return(undefined);
      this.entries.splice(i, 1);
    }
  }

  /**
   * Resume jobs until `budgetMs` has elapsed, starting no step that would
   * likely run past it (but always at least one, so work never starves).
   * Returns the time spent.
   */
  run(budgetMs: number): number {
    const t0 = performance.now();
    if (this.entries.length > 1) this.entries.sort((a, b) => a.priority - b.priority);
    let first = true;
    while (this.entries.length > 0) {
      const entry = this.entries[0];
      let done = false;
      while (!done) {
        const s0 = performance.now();
        if (!first && s0 - t0 + this.stepMs > budgetMs) break;
        first = false;
        done = entry.job.next().done === true;
        this.stepMs = Math.max(performance.now() - s0, this.stepMs * 0.995);
      }
      if (!done) break;
      this.entries.shift();
    }
    this.lastMs = performance.now() - t0;
    return this.lastMs;
  }

  /** Finish every job now. */
  drain(): void {
    this.run(Number.POSITIVE_INFINITY);
  }
}
