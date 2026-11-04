// The workshop Muse talks to (workshop_start, workshop_round, workshop_review, workshop_view): checks each brief
// and verdict, keeps the jobs in <dataDir>/workshop.db and lets the runner step them.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentResult, AgentStatus, Instant, MuseId } from '../../src/muse/contract';
import type { WorkshopClients } from './clients';
import type { Runner } from './runner';
import { createRunner, isDraft, plain } from './runner';
import type { JobStore, StoredJob } from './store';
import { isJobId, jobDir, newJobId, openJobStore } from './store';
import type { JobId, JobKind, JobRecord, JobResult, JobView, Packet, Pipeline, Verdict, Workshop } from './types';

/** Drafts per job ('approve' rounds without a contract): notes on the last one are refused (approve it, or stop). */
export const MAX_DRAFTS = 3;
/** Extra views (workshop_view) per round. */
export const MAX_VIEWS = 4;
const MAX_TEXT = 1000;
const MAX_LIST = 8;
const MAX_ITEM = 500;
const MAX_NOTES = 3;
const MAX_NAME = 60;
const MAX_ASK = 300;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const KINDS: readonly JobKind[] = ['body', 'planet', 'home'];

export interface WorkshopDeps {
  /** The garden's data folder (.muse): jobs go in workshop.db, their files in workshop/<job>/. */
  readonly dataDir: string;
  readonly clients: WorkshopClients;
  readonly pipelines: Readonly<Record<JobKind, Pipeline>>;
  /** The sim clock. */
  readonly now: () => Instant;
  readonly repo: string;
  readonly devServer: string;
  /** A job finished: the integrator hands the result to applyLook / applyPlanet. */
  readonly onDone: (job: JobRecord, result: JobResult) => Promise<void>;
}

export interface WorkshopRuntime extends Workshop {
  /** Resolves once no job is running or queued (tests, and a clean shutdown). */
  idle(): Promise<void>;
  /** Stops running steps (their jobs resume at the next boot) and closes the database. */
  close(): Promise<void>;
}

type Refusal = { readonly ok: false; readonly status: AgentStatus; readonly error: string; readonly retryAfter?: Instant };
const refuse = (status: AgentStatus, error: string, retryAfter?: Instant | null): Refusal =>
  retryAfter == null ? { ok: false, status, error } : { ok: false, status, error, retryAfter };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkList(brief: Record<string, unknown>, key: string): string | null {
  const v = brief[key];
  if (v === undefined) return null;
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) return `${key} must be a list of short texts.`;
  if (v.length > MAX_LIST) return `${key} can hold at most ${MAX_LIST} items (it has ${v.length}).`;
  if (v.some((s: string) => s.length > MAX_ITEM)) return `Each item in ${key} must be at most ${MAX_ITEM} characters.`;
  return null;
}

/** A data: URL of a PNG, JPEG, WebP or GIF picture, at most 2 MB decoded; null when it's fine. */
export function checkAvatarImage(image: unknown): string | null {
  if (typeof image !== 'string') return 'avatar.image must be a data: URL (base64).';
  if (image.length > Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64) return 'avatar.image is over 2 MB: send a smaller picture.';
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!m) return 'avatar.image must be a data: URL of a PNG, JPEG, WebP or GIF picture, base64 encoded.';
  const bytes = Buffer.from(m[2] ?? '', 'base64');
  if (bytes.length === 0) return 'avatar.image is empty.';
  if (bytes.length > MAX_AVATAR_BYTES) return 'avatar.image is over 2 MB: send a smaller picture.';
  return null;
}

/** Why a brief can't start a job, in plain words; null when it can. */
export function checkBrief(brief: unknown): string | null {
  if (!isRecord(brief)) return 'The brief must be an object.';
  if (!KINDS.includes(brief.kind as JobKind)) return `The brief's kind must be one of ${KINDS.join(', ')}.`;
  if (typeof brief.text !== 'string' || brief.text.trim() === '') return 'Say in the brief, in a few words, what you want.';
  if (brief.text.length > MAX_TEXT) return `The brief's text must be at most ${MAX_TEXT} characters (it has ${brief.text.length}).`;
  for (const key of ['must', 'never', 'references', 'things']) {
    const error = checkList(brief, key);
    if (error) return error;
  }
  const refs = (brief.references ?? []) as string[];
  if (refs.some((r) => !/^https?:\/\/\S+$/.test(r))) return 'Each reference must be an http(s) link.';
  if (brief.avatar !== undefined) {
    if (!isRecord(brief.avatar)) return 'avatar must be an object with image and/or description.';
    const { image, description } = brief.avatar;
    if (image !== undefined) {
      const error = checkAvatarImage(image);
      if (error) return error;
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > MAX_TEXT)) {
      return `avatar.description must be a text of at most ${MAX_TEXT} characters.`;
    }
  }
  return null;
}

/** Why a verdict can't be read, in plain words; null when its shape is fine. */
export function checkVerdict(verdict: unknown): string | null {
  if (!isRecord(verdict)) return 'The answer must be an object.';
  if (verdict.approve !== undefined && typeof verdict.approve !== 'boolean') return 'approve must be true or false.';
  if (verdict.name !== undefined && (typeof verdict.name !== 'string' || verdict.name.trim() === '' || verdict.name.length > MAX_NAME)) {
    return `name must be a text of 1 to ${MAX_NAME} characters.`;
  }
  if (verdict.picks !== undefined && (!Array.isArray(verdict.picks) || !verdict.picks.every((p) => typeof p === 'string') || verdict.picks.length > 10)) {
    return 'picks must be a list of picture ids.';
  }
  if (verdict.notes !== undefined) {
    if (!Array.isArray(verdict.notes)) return 'notes must be a list.';
    if (verdict.notes.length > MAX_NOTES) return `Send at most ${MAX_NOTES} notes.`;
    for (const n of verdict.notes as unknown[]) {
      if (!isRecord(n) || typeof n.text !== 'string' || n.text.trim() === '') return 'Each note needs its text.';
      if (n.text.length > MAX_ITEM) return `Each note must be at most ${MAX_ITEM} characters.`;
      if (n.picture !== undefined && typeof n.picture !== 'string') return "A note's picture must be a picture id.";
      if (n.at !== undefined) {
        const at = n.at as unknown;
        const ok = Array.isArray(at) && at.length === 2 && at.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1000);
        if (!ok) return "A note's at must be [x, y], each from 0 to 1000.";
        if (n.picture === undefined) return 'A note with at must say which picture it points at.';
      }
    }
  }
  return null;
}

export function createWorkshop(deps: WorkshopDeps): WorkshopRuntime {
  mkdirSync(join(deps.dataDir, 'workshop'), { recursive: true });
  const store: JobStore = openJobStore(join(deps.dataDir, 'workshop.db'));
  const runner: Runner = createRunner({ ...deps, store });
  /** review and view on one job run one at a time. */
  const chains = new Map<JobId, Promise<unknown>>();
  const serial = <T>(id: JobId, fn: () => Promise<T>): Promise<T> => {
    const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
    const settled = next.catch(() => undefined);
    chains.set(id, settled);
    void settled.then(() => {
      if (chains.get(id) === settled) chains.delete(id);
    });
    return next;
  };

  const nextRoundAt = (job: JobRecord): Instant | null => {
    if (job.state !== 'working') return null;
    let ms = 60_000;
    try {
      ms = deps.pipelines[job.kind].estimateMs(job.stage);
    } catch {
      // keep the default
    }
    // (counted from when its stage began, so it doesn't drift as it's asked again; a stage running long is nearly
    // done, so never sooner than a minute from now)
    return Math.max(deps.now() + 60_000, job.updatedAt + Math.max(0, ms)) as Instant;
  };

  /**
   * On the last draft the packet says so itself: a Muse checking in later with fresh context reads only the packet,
   * and would otherwise send notes the workshop must refuse (seen with the stand-in).
   */
  const lastDraftSaid = (packet: Packet, drafts: number): Packet =>
    isDraft(packet) && drafts >= MAX_DRAFTS
      ? { ...packet, text: `${packet.text}\n\nThis is the last draft (${MAX_DRAFTS} of ${MAX_DRAFTS}): it takes no more notes. Approve it, or stop the job with approve false and no notes.` }
      : packet;

  const toView = (job: StoredJob): JobView => ({
    id: job.id,
    kind: job.kind,
    state: job.state,
    stage: job.stage,
    round: job.round,
    packet: job.state === 'waiting' && job.packet ? lastDraftSaid(job.packet, job.drafts) : null,
    nextRoundAt: nextRoundAt(job),
    message: job.message,
  });

  const mine = (museId: MuseId, id: JobId): StoredJob | null => {
    if (typeof id !== 'string' || !isJobId(id)) return null;
    const job = store.get(id);
    return job && job.museId === museId ? job : null;
  };

  const notWaiting = (job: StoredJob): Refusal =>
    job.state === 'working'
      ? refuse(409, 'This job is still working on its next round: look again later.', nextRoundAt(job))
      : refuse(409, `This job is ${job.state === 'done' ? 'finished' : 'over'}: ${job.message}`);

  const save = (job: StoredJob, change: Partial<StoredJob>): StoredJob => {
    const next: StoredJob = { ...job, ...change, updatedAt: deps.now() };
    store.save(next);
    return next;
  };

  function review(museId: MuseId, id: JobId, verdict: Verdict): AgentResult<JobView> {
    const job = mine(museId, id);
    if (!job) return refuse(404, 'There’s no such job of yours.');
    if (job.state !== 'waiting' || !job.packet) return notWaiting(job);
    const shape = checkVerdict(verdict);
    if (shape) return refuse(400, shape);
    const packet = job.packet;
    const notes = verdict.notes ?? [];
    const picks = verdict.picks ?? [];
    const ids = new Set(packet.pictures.map((p) => p.id));
    const stranger = [...picks, ...notes.flatMap((n) => (n.picture === undefined ? [] : [n.picture]))].find((p) => !ids.has(p));
    if (stranger !== undefined) return refuse(422, `There’s no picture “${stranger}” in this round: use the ids in its pictures.`);
    if (picks.length > 0 && packet.pick && (picks.length < packet.pick.min || picks.length > packet.pick.max)) {
      const { min, max } = packet.pick;
      return refuse(422, `Pick ${min === max ? `${min}` : `${min} to ${max}`} of the pictures (you picked ${picks.length}).`);
    }
    if (verdict.approve === false && notes.length === 0 && picks.length === 0) {
      return { ok: true, value: toView(save(job, { state: 'failed', packet: null, message: `You stopped this job at round ${job.round}.` })) };
    }
    if (isDraft(packet) && verdict.approve !== true && notes.length > 0 && job.drafts >= MAX_DRAFTS) {
      return refuse(
        422,
        `This is the last draft (${MAX_DRAFTS} of ${MAX_DRAFTS}), so it can’t take more notes: approve it, or stop with approve false and no notes.`,
      );
    }
    let answer: ReturnType<Pipeline['answer']>;
    try {
      answer = deps.pipelines[job.kind].answer(job, verdict);
    } catch (e) {
      return refuse(422, `That answer couldn’t be used: ${plain(e)}`);
    }
    if (!answer.ok) return refuse(422, answer.error);
    const next = save(job, { state: 'working', stage: answer.stage, data: answer.data, packet: null, views: 0, message: 'Working on your answer.' });
    runner.kick(job.id);
    return { ok: true, value: toView(next) };
  }

  async function view(museId: MuseId, id: JobId, ask: string): Promise<AgentResult<JobView>> {
    const job = mine(museId, id);
    if (!job) return refuse(404, 'There’s no such job of yours.');
    if (job.state !== 'waiting' || !job.packet) return notWaiting(job);
    if (typeof ask !== 'string' || ask.trim() === '' || ask.length > MAX_ASK) return refuse(400, `Say which view you want, in at most ${MAX_ASK} characters.`);
    const pipeline = deps.pipelines[job.kind];
    if (!pipeline.view) return refuse(422, `A ${job.kind} round can’t show other views: answer the round instead.`);
    if (job.views >= MAX_VIEWS) return refuse(422, `You’ve seen ${MAX_VIEWS} extra views this round: answer it first.`);
    const io = runner.io(job);
    let made: Awaited<ReturnType<NonNullable<Pipeline['view']>>>;
    try {
      mkdirSync(io.dir, { recursive: true });
      made = await pipeline.view(job, ask, io);
    } catch (e) {
      return refuse(422, `That view couldn’t be made: ${plain(e)}`);
    }
    if (!made.ok) return refuse(422, made.error);
    const now = store.get(job.id);
    if (!now || now.state !== 'waiting' || !now.packet || now.round !== job.round) return refuse(409, 'The round moved on while that view was being made.');
    const packet = { ...now.packet, pictures: [...now.packet.pictures, made.picture] };
    return { ok: true, value: toView(save(now, { packet, views: now.views + 1 })) };
  }

  runner.resume();

  return {
    start: (museId, brief) => {
      const error = checkBrief(brief);
      if (error) return Promise.resolve(refuse(400, error));
      const active = store.byMuse(museId).find((j) => j.kind === brief.kind && (j.state === 'working' || j.state === 'waiting'));
      if (active) {
        return Promise.resolve(
          refuse(409, `You already have a ${brief.kind} job going (${active.id}, ${active.state}): finish it or stop it first.`, nextRoundAt(active)),
        );
      }
      const pipeline = deps.pipelines[brief.kind] as Pipeline | undefined;
      if (!pipeline) return Promise.resolve(refuse(422, `There’s no workshop for a ${brief.kind} yet.`));
      const at = deps.now();
      const job: StoredJob = {
        id: newJobId(),
        museId,
        kind: brief.kind,
        brief,
        state: 'working',
        stage: pipeline.firstStage,
        round: 0,
        drafts: 0,
        views: 0,
        data: {},
        packet: null,
        message: 'Started: the first round is on its way.',
        createdAt: at,
        updatedAt: at,
      };
      mkdirSync(jobDir(deps.dataDir, job.id), { recursive: true });
      store.save(job);
      runner.kick(job.id);
      return Promise.resolve({ ok: true, value: toView(job) });
    },
    jobs: (museId) => store.byMuse(museId).map(toView),
    job: (museId, id) => {
      const job = mine(museId, id);
      return job ? toView(job) : null;
    },
    review: (museId, id, verdict) => serial(id, () => Promise.resolve(review(museId, id, verdict))),
    view: (museId, id, ask) => serial(id, () => view(museId, id, ask)),
    pending: (museId) => store.byMuse(museId).filter((j) => j.state === 'waiting').length,
    idle: () => runner.idle(),
    close: async () => {
      await runner.close();
      store.close();
    },
  };
}
