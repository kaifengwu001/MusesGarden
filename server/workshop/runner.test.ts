import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Instant, MuseId } from '../../src/muse/contract';
import type { WorkshopRuntime } from './api';
import { createWorkshop, MAX_DRAFTS } from './api';
import { fakeClients } from './clients';
import { openJobStore } from './store';
import type { Brief, JobKind, JobRecord, JobResult, Pipeline, StageIO } from './types';

const PIP = 'pip' as MuseId;
const MOSS = 'moss' as MuseId;
const T0 = Date.parse('2026-11-03T10:00:00Z') as Instant;

const dirs: string[] = [];
const open: WorkshopRuntime[] = [];
afterEach(async () => {
  for (const w of open.splice(0)) await w.close().catch(() => undefined);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'workshop-'));
  dirs.push(d);
  return d;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

interface Trace {
  readonly steps: string[];
  /** Steps at these stages wait for `gate` (or the runner's abort) before going on. */
  gate?: Promise<void>;
  gated?: readonly string[];
}

/** sketch → draft (waits for approve) → finish (done); notes on a draft go back to draft. */
function twoStage(kind: JobKind, trace: Trace, extra: Partial<Pipeline> = {}): Pipeline {
  return {
    kind,
    firstStage: 'sketch',
    async step(job: JobRecord, io: StageIO) {
      trace.steps.push(`${job.museId}:${job.stage}`);
      if (trace.gate && trace.gated?.includes(job.stage)) {
        await Promise.race([
          trace.gate,
          new Promise((_, reject) => io.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        ]);
      }
      if (job.stage === 'sketch') {
        io.log('sketching');
        return { kind: 'continue', stage: 'draft', data: { ...job.data, sketched: true } };
      }
      if (job.stage === 'draft') {
        const n = ((job.data.drafts as number | undefined) ?? 0) + 1;
        writeFileSync(join(io.dir, `draft${n}.txt`), `draft ${n}`);
        return {
          kind: 'wait',
          stage: 'review',
          data: { ...job.data, drafts: n },
          packet: { stage: 'review', ask: 'approve', text: `Draft ${n}: approve it or send notes.`, pictures: [{ id: `d${n}`, path: io.url(`draft${n}.txt`), caption: `draft ${n}` }] },
        };
      }
      if (job.stage === 'boom') throw new Error('the kiln cracked\n    at somewhere (stack.ts:1)');
      if (job.stage === 'finish') return { kind: 'done', data: job.data, result: { look: 'gen-pip-1' }, message: 'Your body is ready.' };
      throw new Error(`no stage ${job.stage}`);
    },
    answer(job, verdict) {
      if (verdict.approve) return { ok: true, stage: (job.data.next as string | undefined) ?? 'finish', data: job.data };
      if (verdict.notes?.length) return { ok: true, stage: 'draft', data: { ...job.data, notes: verdict.notes } };
      return { ok: false, error: 'Approve it, or send notes.' };
    },
    estimateMs: (stage) => (stage === 'draft' ? 30_000 : 1_000),
    ...extra,
  };
}

function setup(opts: { dataDir?: string; trace?: Trace; extra?: Partial<Pipeline>; onDone?: (job: JobRecord, r: JobResult) => Promise<void> } = {}) {
  const dataDir = opts.dataDir ?? tmp();
  const trace = opts.trace ?? { steps: [] };
  const done: { job: string; result: JobResult }[] = [];
  const pipelines = {
    body: twoStage('body', trace, opts.extra),
    planet: twoStage('planet', trace, opts.extra),
    home: twoStage('home', trace, opts.extra),
  };
  const workshop = createWorkshop({
    dataDir,
    clients: fakeClients(),
    pipelines,
    now: () => T0,
    repo: '/repo',
    devServer: 'http://localhost:5173',
    onDone:
      opts.onDone ??
      ((job, result) => {
        done.push({ job: job.id, result });
        return Promise.resolve();
      }),
  });
  open.push(workshop);
  return { workshop, dataDir, trace, done };
}

const brief = (kind: JobKind = 'body', more: Partial<Brief> = {}): Brief => ({ kind, text: 'soft and blue, a little shy', ...more });

async function started(w: WorkshopRuntime, museId = PIP, b = brief()) {
  const r = await w.start(museId, b);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('the workshop runner', () => {
  it('runs every stage, waits for a round, takes the verdict, finishes and hands over the result', async () => {
    const { workshop, dataDir, trace, done } = setup();
    const job = await started(workshop);
    expect(job.id).toMatch(/^[0-9a-f]{32}$/);
    expect(job.state).toBe('working');
    await workshop.idle();

    const waiting = workshop.job(PIP, job.id);
    expect(waiting?.state).toBe('waiting');
    expect(waiting?.round).toBe(1);
    expect(waiting?.nextRoundAt).toBeNull();
    expect(waiting?.packet).toMatchObject({ job: job.id, kind: 'body', round: 1, stage: 'review', ask: 'approve' });
    expect(waiting?.packet?.pictures[0]?.path).toBe(`/w/${job.id}/draft1.txt`);
    expect(readFileSync(join(dataDir, 'workshop', job.id, 'draft1.txt'), 'utf8')).toBe('draft 1');
    expect(readFileSync(join(dataDir, 'workshop', job.id, 'log.txt'), 'utf8')).toContain('[sketch] sketching');
    expect(workshop.pending(PIP)).toBe(1);

    const r = await workshop.review(PIP, job.id, { approve: true });
    expect(r.ok && r.value.state).toBe('working');
    await workshop.idle();

    const finished = workshop.job(PIP, job.id);
    expect(finished).toMatchObject({ state: 'done', message: 'Your body is ready.', packet: null });
    expect(done).toEqual([{ job: job.id, result: { look: 'gen-pip-1' } }]);
    expect(trace.steps).toEqual(['pip:sketch', 'pip:draft', 'pip:finish']);
    expect(workshop.pending(PIP)).toBe(0);
  });

  it('gives next_round_at from the stage’s estimate while it works', async () => {
    const gate = deferred();
    const { workshop } = setup({ trace: { steps: [], gate: gate.promise, gated: ['draft'] } });
    const job = await started(workshop);
    await new Promise((r) => setTimeout(r, 20));
    expect(workshop.job(PIP, job.id)).toMatchObject({ state: 'working', stage: 'draft', nextRoundAt: T0 + 30_000 });
    gate.resolve();
    await workshop.idle();
  });

  it('resumes a job left working when it boots again', async () => {
    const dataDir = tmp();
    const first = setup({ dataDir, trace: { steps: [], gate: new Promise(() => undefined), gated: ['draft'] } });
    const job = await started(first.workshop);
    await new Promise((r) => setTimeout(r, 20));
    await first.workshop.close();
    open.splice(open.indexOf(first.workshop), 1);

    const store = openJobStore(join(dataDir, 'workshop.db'));
    expect(store.get(job.id)).toMatchObject({ state: 'working', stage: 'draft' });
    store.close();

    const second = setup({ dataDir });
    await second.workshop.idle();
    expect(second.workshop.job(PIP, job.id)).toMatchObject({ state: 'waiting', round: 1 });
    expect(second.trace.steps).toEqual(['pip:draft']);
  });

  it('turns a throw into a failed job with a plain message', async () => {
    const { workshop } = setup({ extra: { firstStage: 'boom' } });
    const job = await started(workshop);
    await workshop.idle();
    const failed = workshop.job(PIP, job.id);
    expect(failed?.state).toBe('failed');
    expect(failed?.message).toBe('The boom step failed: the kiln cracked at somewhere (stack.ts:1)');
  });

  it('fails a job whose result the garden can’t take', async () => {
    const { workshop } = setup({ onDone: () => Promise.reject(new Error('no such Muse')) });
    const job = await started(workshop);
    await workshop.idle();
    await workshop.review(PIP, job.id, { approve: true });
    await workshop.idle();
    expect(workshop.job(PIP, job.id)).toMatchObject({ state: 'failed', message: expect.stringContaining('no such Muse') as unknown });
  });

  it('counts the rounds waiting for each Muse for the doorbell', async () => {
    const { workshop } = setup();
    await started(workshop, PIP, brief('body'));
    await started(workshop, PIP, brief('planet'));
    await started(workshop, MOSS, brief('body'));
    await workshop.idle();
    expect(workshop.pending(PIP)).toBe(2);
    expect(workshop.pending(MOSS)).toBe(1);
    expect(workshop.pending('nobody' as MuseId)).toBe(0);
    expect(workshop.jobs(PIP).map((j) => j.kind).sort()).toEqual(['body', 'planet']);
  });

  it('runs one job at a time per kind', async () => {
    const gate = deferred();
    const trace: Trace = { steps: [], gate: gate.promise, gated: ['sketch'] };
    const { workshop } = setup({ trace });
    await started(workshop, PIP, brief('body'));
    await started(workshop, MOSS, brief('body'));
    await started(workshop, MOSS, brief('home'));
    await new Promise((r) => setTimeout(r, 20));
    expect(trace.steps.sort()).toEqual(['moss:sketch', 'pip:sketch']);
    expect(trace.steps.filter((s) => s === 'moss:sketch')).toHaveLength(1);
    gate.resolve();
    await workshop.idle();
    expect(workshop.pending(PIP) + workshop.pending(MOSS)).toBe(3);
  });

  it('takes notes on at most three drafts, then only approve or stop', async () => {
    const { workshop } = setup();
    const job = await started(workshop);
    for (let draft = 1; draft < MAX_DRAFTS; draft++) {
      await workshop.idle();
      expect(workshop.job(PIP, job.id)?.round).toBe(draft);
      const r = await workshop.review(PIP, job.id, { notes: [{ text: 'bluer ears' }] });
      expect(r.ok).toBe(true);
    }
    await workshop.idle();
    expect(workshop.job(PIP, job.id)).toMatchObject({ state: 'waiting', round: MAX_DRAFTS });
    const more = await workshop.review(PIP, job.id, { notes: [{ text: 'and a hat' }] });
    expect(more).toMatchObject({ ok: false, status: 422, error: expect.stringContaining('last draft') as unknown });
    const ok = await workshop.review(PIP, job.id, { approve: true, notes: [{ text: 'lovely' }] });
    expect(ok.ok).toBe(true);
    await workshop.idle();
    expect(workshop.job(PIP, job.id)?.state).toBe('done');
  });

  it('stops a job when Muse answers approve false with no notes', async () => {
    const { workshop } = setup();
    const job = await started(workshop);
    await workshop.idle();
    const r = await workshop.review(PIP, job.id, { approve: false });
    expect(r.ok && r.value).toMatchObject({ state: 'failed', message: 'You stopped this job at round 1.' });
    expect(workshop.pending(PIP)).toBe(0);
    expect((await workshop.start(PIP, brief())).ok).toBe(true);
  });

  it('refuses answers to rounds that aren’t waiting, from other Muses, or that the pipeline can’t use', async () => {
    const gate = deferred();
    const { workshop } = setup({ trace: { steps: [], gate: gate.promise, gated: ['sketch'] } });
    const job = await started(workshop);
    expect(await workshop.review(PIP, job.id, { approve: true })).toMatchObject({ ok: false, status: 409, retryAfter: T0 + 1_000 });
    gate.resolve();
    await workshop.idle();
    expect(await workshop.review(MOSS, job.id, { approve: true })).toMatchObject({ ok: false, status: 404 });
    expect(workshop.job(MOSS, job.id)).toBeNull();
    expect(await workshop.review(PIP, '0'.repeat(32), { approve: true })).toMatchObject({ ok: false, status: 404 });
    expect(await workshop.review(PIP, job.id, { picks: ['d1'] })).toMatchObject({ ok: false, status: 422, error: 'Approve it, or send notes.' });
    expect(await workshop.review(PIP, job.id, { picks: ['zz'] })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining('no picture “zz”') as unknown });
    const tooMany = { notes: [1, 2, 3, 4].map((i) => ({ text: `note ${i}` })) };
    expect(await workshop.review(PIP, job.id, tooMany)).toMatchObject({ ok: false, status: 400 });
    expect(await workshop.review(PIP, job.id, { notes: [{ text: 'here', at: [10, 2000] as const, picture: 'd1' }] })).toMatchObject({ ok: false, status: 400 });
    expect(workshop.job(PIP, job.id)?.state).toBe('waiting');
  });

  it('adds another view to the round on show, when the pipeline can make one', async () => {
    const extra: Partial<Pipeline> = {
      view: (_job, ask, io) => {
        writeFileSync(join(io.dir, 'porch.txt'), ask);
        return Promise.resolve({ ok: true, picture: { id: 'porch', path: io.url('porch.txt'), caption: ask } });
      },
    };
    const { workshop } = setup({ extra });
    const job = await started(workshop);
    await workshop.idle();
    const r = await workshop.view(PIP, job.id, 'from my porch at dusk');
    expect(r.ok && r.value.packet?.pictures.map((p) => p.id)).toEqual(['d1', 'porch']);
    expect(workshop.job(PIP, job.id)?.packet?.pictures).toHaveLength(2);
    expect(await workshop.view(PIP, job.id, '')).toMatchObject({ ok: false, status: 400 });

    const plainOne = setup();
    const other = await started(plainOne.workshop);
    await plainOne.workshop.idle();
    expect(await plainOne.workshop.view(PIP, other.id, 'from above')).toMatchObject({ ok: false, status: 422 });
  });

  it('checks the brief before it starts anything', async () => {
    const { workshop, trace } = setup();
    const refused = async (b: unknown) => {
      const r = await workshop.start(PIP, b as Brief);
      return r.ok ? null : `${r.status}`;
    };
    expect(await refused({ kind: 'body', text: 'x'.repeat(1001) })).toBe('400');
    expect(await refused({ kind: 'body', text: '  ' })).toBe('400');
    expect(await refused({ kind: 'castle', text: 'a castle' })).toBe('400');
    expect(await refused(brief('body', { must: Array.from({ length: 9 }, (_, i) => `thing ${i}`) }))).toBe('400');
    expect(await refused(brief('home', { things: ['a lamp', 7 as unknown as string] }))).toBe('400');
    expect(await refused(brief('planet', { references: ['javascript:alert(1)'] }))).toBe('400');
    expect(await refused(brief('body', { avatar: { image: 'https://example.com/me.png' } }))).toBe('400');
    const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 10, 1).toString('base64')}`;
    expect(await refused(brief('body', { avatar: { image: big } }))).toBe('400');
    expect(trace.steps).toEqual([]);

    const small = `data:image/jpeg;base64,${readFileSync(new URL('./body/base.jpg', import.meta.url)).toString('base64')}`;
    expect(await refused(brief('body', { avatar: { image: small, description: 'a cream plush' }, must: Array.from({ length: 8 }, (_, i) => `m${i}`) }))).toBeNull();
    expect(await refused(brief('body'))).toBe('409');
    expect(await refused(brief('planet'))).toBeNull();
    await workshop.idle();
  });
});
