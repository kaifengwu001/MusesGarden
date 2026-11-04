// The workshop's runner: steps each 'working' job through its pipeline until it waits for Muse, finishes or fails,
// saving after every step so a restart picks up where it stopped. One job runs at a time per kind (one body, one
// planet and one home at once); the rest queue in the order they were kicked.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Instant } from '../../src/muse/contract';
import type { WorkshopClients } from './clients';
import type { JobStore, StoredJob } from './store';
import { jobDir } from './store';
import type { JobId, JobKind, JobRecord, JobResult, Pipeline, StageIO, StepOutcome } from './types';

/** A pipeline that never waits or finishes is stopped after this many steps in a row. */
const MAX_STEPS = 200;
const MAX_MESSAGE = 500;

export interface RunnerDeps {
  readonly dataDir: string;
  readonly store: JobStore;
  readonly clients: WorkshopClients;
  readonly pipelines: Readonly<Record<JobKind, Pipeline>>;
  readonly now: () => Instant;
  readonly repo: string;
  readonly devServer: string;
  /** A job finished: hand its result to the garden (applyLook / applyPlanet). A throw fails the job. */
  readonly onDone: (job: JobRecord, result: JobResult) => Promise<void>;
}

export interface Runner {
  /** Queues a 'working' job on its kind's lane (again is a no-op). */
  kick(id: JobId): void;
  /** Queues every job left 'working' by the last run. */
  resume(): void;
  /** The StageIO a job's steps (and views) run with. */
  io(job: JobRecord): StageIO;
  /** Resolves once no job is running or queued. */
  idle(): Promise<void>;
  /** Stops: aborts running steps (their jobs stay 'working', to resume next boot) and waits for them. */
  close(): Promise<void>;
}

/** An error as one plain line, without a stack. */
export function plain(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim() || 'an unknown error';
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

const isOutcome = (o: unknown): o is StepOutcome =>
  typeof o === 'object' && o !== null && ['continue', 'wait', 'done', 'failed'].includes((o as { kind?: unknown }).kind as string);

export function createRunner(deps: RunnerDeps): Runner {
  const { store } = deps;
  const stop = new AbortController();
  const lanes = new Map<JobKind, { queue: JobId[]; running: JobId | null }>();
  const inflight = new Set<Promise<void>>();

  const laneOf = (kind: JobKind) => {
    let lane = lanes.get(kind);
    if (!lane) lanes.set(kind, (lane = { queue: [], running: null }));
    return lane;
  };

  const io = (job: JobRecord): StageIO => {
    const dir = jobDir(deps.dataDir, job.id);
    return {
      dir,
      url: (file) => `/w/${job.id}/${file.split('/').map(encodeURIComponent).join('/')}`,
      clients: deps.clients,
      log: (line) => {
        try {
          mkdirSync(dir, { recursive: true });
          appendFileSync(join(dir, 'log.txt'), `${new Date().toISOString()} [${job.stage}] ${line}\n`);
        } catch {
          // a log line is never worth failing a step over
        }
      },
      signal: stop.signal,
      repo: deps.repo,
      devServer: deps.devServer,
    };
  };

  const save = (job: StoredJob, change: Partial<StoredJob>) => store.save({ ...job, ...change, updatedAt: deps.now() });

  /** Saves what one step came back with. */
  async function apply(job: StoredJob, outcome: StepOutcome): Promise<void> {
    switch (outcome.kind) {
      case 'continue':
        save(job, { stage: outcome.stage, data: outcome.data, message: outcome.message ?? job.message });
        return;
      case 'wait': {
        const round = job.round + 1;
        save(job, {
          state: 'waiting',
          stage: outcome.stage,
          data: outcome.data,
          round,
          drafts: job.drafts + (outcome.packet.ask === 'approve' ? 1 : 0),
          views: 0,
          packet: { ...outcome.packet, job: job.id, kind: job.kind, round },
          message: `Round ${round} is ready for you.`,
        });
        return;
      }
      case 'done':
        try {
          await deps.onDone(job, outcome.result);
        } catch (e) {
          save(job, { state: 'failed', data: outcome.data, packet: null, message: `It was finished, but the garden couldn’t take it in: ${plain(e)}` });
          return;
        }
        save(job, { state: 'done', data: outcome.data, packet: null, message: outcome.message });
        return;
      case 'failed':
        save(job, { state: 'failed', packet: null, message: plain(outcome.message) });
        return;
    }
  }

  async function run(id: JobId): Promise<void> {
    for (let steps = 0; ; steps++) {
      const job = store.get(id);
      if (!job || job.state !== 'working' || stop.signal.aborted) return;
      if (steps >= MAX_STEPS) {
        save(job, { state: 'failed', packet: null, message: `The workshop went round ${MAX_STEPS} steps without a round to show, so it stopped.` });
        return;
      }
      const pipeline = deps.pipelines[job.kind] as Pipeline | undefined;
      let outcome: StepOutcome;
      if (!pipeline) {
        outcome = { kind: 'failed', message: `There’s no workshop for a ${job.kind} yet.` };
      } else {
        const stageIO = io(job);
        try {
          mkdirSync(stageIO.dir, { recursive: true });
          const out: unknown = await pipeline.step(job, stageIO);
          outcome = isOutcome(out) ? out : { kind: 'failed', message: `The ${job.stage} step gave back something the workshop can’t read.` };
        } catch (e) {
          // Stopped for a restart: the job stays 'working' and runs this step again next boot.
          if (stop.signal.aborted) return;
          stageIO.log(`failed: ${plain(e)}`);
          outcome = { kind: 'failed', message: `The ${job.stage} step failed: ${plain(e)}` };
        }
      }
      await apply(job, outcome);
      if (outcome.kind !== 'continue') return;
    }
  }

  function pump(kind: JobKind): void {
    const lane = laneOf(kind);
    if (lane.running !== null || stop.signal.aborted) return;
    const id = lane.queue.shift();
    if (id === undefined) return;
    lane.running = id;
    const p: Promise<void> = run(id)
      .catch((e: unknown) => console.error(`workshop: job ${id} stopped unexpectedly:`, e))
      .finally(() => {
        lane.running = null;
        inflight.delete(p);
        pump(kind);
      });
    inflight.add(p);
  }

  const kick = (id: JobId): void => {
    const job = store.get(id);
    if (!job || job.state !== 'working') return;
    const lane = laneOf(job.kind);
    if (lane.running === id || lane.queue.includes(id)) return;
    lane.queue.push(id);
    pump(job.kind);
  };

  return {
    kick,
    resume: () => {
      for (const job of store.inState('working')) kick(job.id);
    },
    io,
    idle: async () => {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
    close: async () => {
      stop.abort(new Error('the workshop is shutting down'));
      for (const lane of lanes.values()) lane.queue.length = 0;
      await Promise.all([...inflight]);
    },
  };
}
