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
  private readonly byKey = new Map<string, Entry>();
  /**
   * The mean job step of recent runs (ms): a step is not started unless twice
   * that would still fit. A mean over whole runs, not the slowest single
   * step: WebKit's clock reads whole milliseconds, so a single step measured
   * 0 or 1 ms, and a guard on the slowest (iterations 5–13) let a phone run
   * one 1/256 of a tile a frame.
   */
  private meanStep = 0.05;

  get size(): number {
    return this.entries.length;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Jobs more urgent than `priority` (lower values). */
  countBelow(priority: number): number {
    let n = 0;
    for (const e of this.entries) if (e.priority < priority) n++;
    return n;
  }

  /** Add or replace the job under `key`. */
  add(key: string, priority: number, job: Job): void {
    this.cancel(key);
    const entry = { key, priority, job };
    this.entries.push(entry);
    this.byKey.set(key, entry);
  }

  reprioritise(key: string, priority: number): void {
    const e = this.byKey.get(key);
    if (e) e.priority = priority;
  }

  cancel(key: string): void {
    const e = this.byKey.get(key);
    if (!e) return;
    e.job.return(undefined);
    this.byKey.delete(key);
    this.entries.splice(this.entries.indexOf(e), 1);
  }

  /**
   * Resume jobs while the next step should end within `budgetMs` (one step
   * always runs, so work never stalls). Returns the time spent.
   */
  run(budgetMs: number): number {
    const t0 = performance.now();
    if (this.entries.length > 1) this.entries.sort((a, b) => a.priority - b.priority);
    let steps = 0;
    while (this.entries.length > 0) {
      const entry = this.entries[0];
      let done = false;
      while (!done) {
        if (steps > 0 && performance.now() - t0 + 2 * this.meanStep > budgetMs) break;
        done = entry.job.next().done === true;
        steps++;
      }
      if (!done) break;
      this.entries.shift();
      this.byKey.delete(entry.key);
    }
    this.lastMs = performance.now() - t0;
    if (steps > 0 && Number.isFinite(budgetMs)) this.meanStep += (this.lastMs / steps - this.meanStep) * 0.2;
    return this.lastMs;
  }

  /** Finish every job now. */
  drain(): void {
    this.run(Number.POSITIVE_INFINITY);
  }
}
