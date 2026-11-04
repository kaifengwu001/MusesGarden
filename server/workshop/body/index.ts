// The body pipeline: Muse's avatar becomes a rigged 3D body, in rounds.
//   concepts  four edits of the base Muse (base.jpg) in its fur, ears and clothes, each held to the base's pose
//             (pose.ts), retried up to 3 times → Muse picks one (with notes: one refinement of it)
//   refine    the picked concept edited by Muse's notes, held to the same pose → Muse picks again
//   mesh      the picked concept to a GLB (Tripo P2, quad, 5000 polygons) → looks/gen-<muse>-<n>.glb, .jpg, .json
//   rig       rigged here as the page will rig it; a body that won't rig sends Muse back to pick another
//   renders   lab stills (idle, wave, pet; front, three-quarter, side) → Muse approves, or sends notes for new
//             concepts
//   finish    done: the look's id, for applyLook
// Every step is safe to run again: it reuses the files it already made.
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { GeneratedLook } from '../../../src/muse/contract';
import type { Box, Segmenter } from '../clients';
import type { JobRecord, Packet, PacketPicture, Pipeline, StageIO, StepOutcome, Verdict } from '../types';
import { cleanGlb, turnGlb } from './glb';
import { comparePose, describe, reframe, reframeFor, see, type PoseCheck, type Reframe, type Seen } from './pose';
import { avatarPicture, contactSheet, fitTo, portrait } from './pictures';
import { conceptPrompt, designFromBrief, designPrompt, DESIGN_SCHEMA, DESIGN_SYSTEM, noteLines, refinePrompt, tidyDesign, type Design } from './prompt';
import { labRenderer, type Renderer, type Still } from './render';
import { rigCheck, type RigCheck, type RigReport } from './rig';

export { GEN_SCULPT } from './rig';

/** How many concepts a round offers, and how many tries each gets to keep the pose. */
const SLOTS = 4;
const TRIES = 3;
/** Tripo's settings for a body: the rig is tuned for P2's quad output at about 5000 polygons. */
export const MESH = { quad: true, faceLimit: 5000 } as const;

const BASE_FILE = fileURLToPath(new URL('./base.jpg', import.meta.url));
let baseCache: { image: Buffer; width: number; height: number } | null = null;
async function base(): Promise<{ image: Buffer; width: number; height: number }> {
  if (!baseCache) {
    const image = readFileSync(BASE_FILE);
    const meta = await sharp(image).metadata();
    baseCache = { image, width: meta.width ?? 0, height: meta.height ?? 0 };
  }
  return baseCache;
}

/** The base segmented once per segmenter (it never changes). */
const baseSeen = new WeakMap<Segmenter, Promise<Seen>>();
function seeBase(segmenter: Segmenter, signal: AbortSignal): Promise<Seen> {
  let seen = baseSeen.get(segmenter);
  if (!seen) {
    seen = base().then((b) => see(b.image, segmenter, signal));
    seen.catch(() => baseSeen.delete(segmenter));
    baseSeen.set(segmenter, seen);
  }
  return seen;
}

interface Concept {
  readonly id: string;
  readonly file: string;
  readonly caption: string;
  readonly check: PoseCheck;
  readonly face: Box | null;
}

/** The job's working data. */
interface BodyData {
  /** The concept round, from 1 (notes on a body send it back for a new one). */
  readonly attempt: number;
  /** Every note so far, for the concepts' prompt. */
  readonly notes: readonly string[];
  /** This round's concepts that kept the pose (and the refinement, once made). */
  readonly concepts: readonly Concept[];
  /** The ids on show in the waiting pick. */
  readonly shown: readonly string[];
  readonly pick?: string;
  readonly refineNotes?: readonly string[];
  readonly refined?: boolean;
  /** Picks whose bodies wouldn't rig. */
  readonly unrigged: readonly string[];
  readonly look?: GeneratedLook;
  readonly rig?: RigReport;
}

function state(data: Readonly<Record<string, unknown>>): BodyData {
  const d = data as Partial<BodyData>;
  return {
    ...d,
    attempt: typeof d.attempt === 'number' ? d.attempt : 1,
    notes: Array.isArray(d.notes) ? d.notes : [],
    concepts: Array.isArray(d.concepts) ? d.concepts : [],
    shown: Array.isArray(d.shown) ? d.shown : [],
    unrigged: Array.isArray(d.unrigged) ? d.unrigged : [],
  };
}

const data = (d: BodyData): Readonly<Record<string, unknown>> => d as unknown as Readonly<Record<string, unknown>>;

/** A new concept round, with Muse's notes added. */
function nextAttempt(d: BodyData, notes: readonly string[]): BodyData {
  return { attempt: d.attempt + 1, notes: [...d.notes, ...notes], concepts: [], shown: [], unrigged: [] };
}

/** The Muse's id as it can go in a file name and a look id. */
export function museSlug(museId: string): string {
  return museId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'muse';
}

/** Where made bodies go: <data>/workshop/looks, beside the jobs' folders. */
export function looksDir(io: StageIO): string {
  return resolve(io.dir, '..', 'looks');
}

/**
 * The next free look id for this Muse (gen-<muse>-<n>, n from 1), reserved by creating its <id>.json (the
 * Sculpt overrides the loader merges into GEN_SCULPT: none yet).
 */
export function reserveLook(dir: string, museId: string): GeneratedLook {
  mkdirSync(dir, { recursive: true });
  const slug = museSlug(museId);
  const taken = new RegExp(`^gen-${slug}-(\\d+)\\.(glb|json|jpg)$`);
  let n = Math.max(0, ...readdirSync(dir).map((f) => Number(taken.exec(f)?.[1] ?? 0))) + 1;
  for (;;) {
    const id: GeneratedLook = `gen-${slug}-${n}`;
    try {
      const fd = openSync(join(dir, `${id}.json`), 'wx');
      writeFileSync(fd, '{}\n');
      closeSync(fd);
      return id;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      n++;
    }
  }
}

const readJson = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null);
const aborted = (io: StageIO, e: unknown): boolean => io.signal.aborted || (e as Error).name === 'AbortError';

function summary(design: Design): string {
  return [`${design.fur} fur`, design.ears, design.garment, ...design.things].filter(Boolean).join('; ');
}

/** What the body is to be: the judge's reading of the avatar and brief, kept per round; the brief alone without it. */
async function designFor(job: JobRecord, io: StageIO, d: BodyData, avatar: Buffer | null): Promise<Design> {
  const file = join(io.dir, `design-${d.attempt}.json`);
  const kept = readJson<Design>(file);
  if (kept) return kept;
  let design: Design;
  try {
    const answer = await io.clients.judge.json<Partial<Design>>({
      name: 'body-design',
      system: DESIGN_SYSTEM,
      prompt: designPrompt(job.brief, d.notes),
      images: avatar ? [avatar] : undefined,
      schema: DESIGN_SCHEMA,
      signal: io.signal,
    });
    design = tidyDesign({
      fur: typeof answer.fur === 'string' ? answer.fur : '',
      ears: typeof answer.ears === 'string' ? answer.ears : null,
      garment: typeof answer.garment === 'string' ? answer.garment : null,
      things: Array.isArray(answer.things) ? answer.things.filter((t): t is string => typeof t === 'string') : [],
    });
  } catch (e) {
    if (aborted(io, e)) throw e;
    io.log(`body: no design from the judge (${(e as Error).message}); the concepts follow the brief alone`);
    design = tidyDesign(designFromBrief(job.brief));
  }
  writeFileSync(file, JSON.stringify(design, null, 2));
  return design;
}

/**
 * A picture's pose check, kept beside it (<file>.check.json) so it's run once. The picture is first set back in
 * the base's frame by its face plate (the image model zooms a few percent), and checked as it now is.
 */
async function checked(io: StageIO, file: string): Promise<{ check: PoseCheck; face: Box | null; reframed: Reframe | null }> {
  const sidecar = join(io.dir, `${file}.check.json`);
  const kept = readJson<{ check: PoseCheck; face: Box | null; reframed: Reframe | null }>(sidecar);
  if (kept) return kept;
  const path = join(io.dir, file);
  const b = await seeBase(io.clients.segmenter, io.signal);
  let c = await see(readFileSync(path), io.clients.segmenter, io.signal);
  const r = reframeFor(b, c);
  if (r) {
    writeFileSync(path, await reframe(readFileSync(path), r));
    c = await see(readFileSync(path), io.clients.segmenter, io.signal);
  }
  const result = { check: comparePose(b, c), face: c.face, reframed: r };
  writeFileSync(sidecar, JSON.stringify(result));
  return result;
}

/**
 * Edits until each slot holds a picture that keeps the pose, up to TRIES each: the slots still wanting one are
 * asked for together. Files: <prefix>-<slot>-<try>.png. Returns the passers by slot, and the last reasons.
 */
async function editHeld(
  io: StageIO,
  prefix: string,
  slots: readonly number[],
  ask: (n: number) => Promise<Buffer[]>,
): Promise<{ passed: Map<number, { file: string; check: PoseCheck; face: Box | null }>; reasons: string[] }> {
  const { width, height } = await base();
  const passed = new Map<number, { file: string; check: PoseCheck; face: Box | null }>();
  let reasons: string[] = [];
  for (let t = 1; t <= TRIES; t++) {
    const need = slots.filter((s) => !passed.has(s));
    if (!need.length) break;
    const name = (s: number): string => `${prefix}-${s}-${t}.png`;
    const missing = need.filter((s) => !existsSync(join(io.dir, name(s))));
    if (missing.length) {
      const made = await ask(missing.length);
      await Promise.all(missing.map(async (s, i) => (made[i] ? writeFileSync(join(io.dir, name(s)), await fitTo(made[i], width, height)) : undefined)));
    }
    reasons = [];
    for (const s of need) {
      if (!existsSync(join(io.dir, name(s)))) {
        reasons.push(`${s}: no picture came back`);
        continue;
      }
      const { check, face } = await checked(io, name(s));
      if (check.ok) passed.set(s, { file: name(s), check, face });
      else {
        reasons.push(`${s}: ${check.reasons.join('; ')}`);
        io.log(`body: ${name(s)} lost the pose: ${check.reasons.join('; ')}`);
      }
    }
  }
  return { passed, reasons };
}

function pickPacket(io: StageIO, concepts: readonly Concept[], text: string): Omit<Packet, 'job' | 'kind' | 'round'> {
  return {
    stage: 'pick',
    ask: 'pick',
    pick: { min: 1, max: 1 },
    text,
    pictures: concepts.map((c): PacketPicture => ({ id: c.id, path: io.url(c.file), caption: c.caption })),
    checklist: concepts.map((c) => ({ item: `${c.id} stands in the base Muse's pose`, ok: c.check.ok, note: describe(c.check) })),
  };
}

const HOW_TO_PICK =
  'Pick one by its id to have it made in 3D. With your pick you can send up to 3 notes for one refinement of it first. Or send notes without a pick for four new concepts.';

async function concepts(job: JobRecord, io: StageIO, d: BodyData): Promise<StepOutcome> {
  const b = await base();
  const avatar = job.brief.avatar?.image ? await avatarPicture(job.brief.avatar.image) : null;
  if (job.brief.avatar?.image && !avatar) return { kind: 'failed', message: "The avatar picture couldn't be read: send it as a PNG or JPEG data: URL." };
  const design = await designFor(job, io, d, avatar);
  const prompt = conceptPrompt(design, avatar !== null, d.notes);
  writeFileSync(join(io.dir, `prompt-${d.attempt}.txt`), prompt);
  const images = avatar ? [b.image, avatar] : [b.image];
  const slots = Array.from({ length: SLOTS }, (_, i) => i + 1);
  const { passed, reasons } = await editHeld(io, `concept-${d.attempt}`, slots, (n) =>
    io.clients.images.edit({ prompt, images, n, size: `${b.width}x${b.height}`, signal: io.signal }),
  );
  if (!passed.size) {
    return { kind: 'failed', message: `None of the ${SLOTS} concepts kept the base Muse's pose after ${TRIES} tries each (${reasons.join(' | ')}).` };
  }
  const list: Concept[] = [...passed].sort(([a], [b]) => a - b).map(([s, p]) => ({
    id: `c${d.attempt}-${s}`,
    file: p.file,
    caption: `Concept ${s}: ${summary(design)}`,
    check: p.check,
    face: p.face,
  }));
  const sheet = `concepts-${d.attempt}.jpg`;
  if (!existsSync(join(io.dir, sheet))) {
    writeFileSync(join(io.dir, sheet), await contactSheet(list.map((c) => ({ image: readFileSync(join(io.dir, c.file)), label: c.id }))));
  }
  const dropped = SLOTS - list.length;
  const text = [
    `${list.length === 1 ? 'One body' : `${list.length} bodies`} for you, each the base Muse in your fur and what you'd wear, standing in the same T-pose (the pose stays: the 3D step and the rig need it).`,
    dropped ? `${dropped} more didn't keep the pose in ${TRIES} tries and were left out.` : null,
    `Side by side: ${io.url(sheet)}.`,
    HOW_TO_PICK,
  ]
    .filter(Boolean)
    .join(' ');
  return { kind: 'wait', stage: 'pick', data: data({ ...d, concepts: list, shown: list.map((c) => c.id), refined: false }), packet: pickPacket(io, list, text) };
}

async function refine(_job: JobRecord, io: StageIO, d: BodyData): Promise<StepOutcome> {
  const picked = d.concepts.find((c) => c.id === d.pick);
  if (!picked) return { kind: 'failed', message: `The picked concept (${d.pick ?? 'none'}) is gone.` };
  const b = await base();
  const notes = d.refineNotes ?? [];
  const pickedImage = readFileSync(join(io.dir, picked.file));
  const { passed, reasons } = await editHeld(io, `refined-${picked.id}`, [1], (n) =>
    io.clients.images.edit({ prompt: refinePrompt(notes), images: [pickedImage, b.image], n, size: `${b.width}x${b.height}`, signal: io.signal }),
  );
  const made = passed.get(1);
  if (!made) {
    const text = `Your notes couldn't be followed without losing the base pose in ${TRIES} tries (${reasons.join('; ')}), so here is ${picked.id} as it was. Pick it to have it made in 3D, or send notes without a pick for four new concepts.`;
    return { kind: 'wait', stage: 'pick', data: data({ ...d, refined: true, shown: [picked.id] }), packet: pickPacket(io, [picked], text) };
  }
  const refined: Concept = { id: `${picked.id}r`, file: made.file, caption: `${picked.id} refined: ${notes.join('; ')}`, check: made.check, face: made.face };
  const text = `Here is ${picked.id} refined by your notes, beside it as it was. Pick the one to have made in 3D (this was its one refinement), or send notes without a pick for four new concepts.`;
  return {
    kind: 'wait',
    stage: 'pick',
    data: data({ ...d, refined: true, concepts: [...d.concepts.filter((c) => c.id !== refined.id), refined], shown: [refined.id, picked.id] }),
    packet: pickPacket(io, [refined, picked], text),
  };
}

async function mesh(job: JobRecord, io: StageIO, d: BodyData): Promise<StepOutcome> {
  const picked = d.concepts.find((c) => c.id === d.pick);
  if (!picked) return { kind: 'failed', message: `The picked concept (${d.pick ?? 'none'}) is gone.` };
  const looks = looksDir(io);
  // (the look's id is kept per pick, so a step run again after a crash reuses it)
  const marker = join(io.dir, `look-${picked.id}.txt`);
  const look = existsSync(marker) ? (readFileSync(marker, 'utf8').trim() as GeneratedLook) : reserveLook(looks, job.museId);
  writeFileSync(marker, look);
  const glb = join(looks, `${look}.glb`);
  if (!existsSync(glb)) {
    let made: Buffer;
    try {
      made = await io.clients.mesher.fromImage(readFileSync(join(io.dir, picked.file)), { ...MESH, purpose: `body for ${job.museId} (${look}, job ${job.id})` }, io.signal);
    } catch (e) {
      if (aborted(io, e)) throw e;
      return { kind: 'failed', message: `The 3D step couldn't run: ${(e as Error).message}` };
    }
    let clean: Buffer;
    try {
      clean = cleanGlb(made);
    } catch (e) {
      return { kind: 'failed', message: `The 3D step gave back no usable model: ${(e as Error).message}` };
    }
    writeFileSync(glb, clean);
  }
  const jpg = join(looks, `${look}.jpg`);
  if (!existsSync(jpg)) writeFileSync(jpg, await portrait(readFileSync(join(io.dir, picked.file)), picked.face));
  const overrides = join(looks, `${look}.json`);
  if (!existsSync(overrides)) writeFileSync(overrides, '{}\n');
  io.log(`body: ${picked.id} made into ${look}`);
  return { kind: 'continue', stage: 'rig', data: data({ ...d, look }), message: `Rigging ${look}.` };
}

async function rig(_job: JobRecord, io: StageIO, d: BodyData, check: RigCheck): Promise<StepOutcome> {
  if (!d.look || !d.pick) return { kind: 'failed', message: 'There is no made body to rig.' };
  const file = join(io.dir, `rig-${d.look}.json`);
  const cached = readJson<Awaited<ReturnType<RigCheck>>>(file);
  let result: Awaited<ReturnType<RigCheck>> | null = cached?.ok ? cached : null;
  if (!result) {
    const glbFile = join(looksDir(io), `${d.look}.glb`);
    const made = readFileSync(glbFile);
    result = await check(made);
    // (a body made facing sideways or away is turned to face the front, as the sculpts do, and kept turned: only
    // facing the front are its eyes found)
    for (let q = 1; !result.ok && q < 4; q++) {
      const turned = turnGlb(made, q);
      const r = await check(turned);
      if (!r.ok) continue;
      writeFileSync(glbFile, turned);
      io.log(`body: ${d.look} was made facing away; turned ${q * 90}° about its upright to face the front`);
      result = r;
    }
  }
  writeFileSync(file, JSON.stringify(result, null, 2));
  if (result.ok) {
    io.log(`body: ${d.look} rigs (${result.report.ms} ms, ${result.report.vertices} vertices, cloth ${(100 * result.report.cloth).toFixed(0)}%)`);
    return { kind: 'continue', stage: 'renders', data: data({ ...d, rig: result.report }), message: `Rendering ${d.look}.` };
  }
  const pick = d.pick;
  io.log(`body: ${d.look} (from ${pick}) won't rig: ${result.error}`);
  const unrigged = [...d.unrigged, pick];
  const left = d.concepts.filter((c) => !unrigged.includes(c.id));
  if (!left.length) return { kind: 'failed', message: `The 3D body made from ${pick} couldn't be used: ${result.error}.` };
  const text = `The 3D body made from ${pick} couldn't be used: ${result.error}. Pick another to have made in 3D (another 3D run), or send notes without a pick for four new concepts.`;
  const { pick: _pick, look: _look, rig: _rig, ...rest } = d;
  return { kind: 'wait', stage: 'pick', data: data({ ...rest, unrigged, shown: left.map((c) => c.id) }), packet: pickPacket(io, left, text) };
}

async function renders(_job: JobRecord, io: StageIO, d: BodyData, render: Renderer): Promise<StepOutcome> {
  const look = d.look;
  const picked = d.concepts.find((c) => c.id === d.pick);
  if (!look || !picked) return { kind: 'failed', message: 'There is no made body to show.' };
  const done = await render({ look, out: io.dir, devServer: io.devServer, repo: io.repo, signal: io.signal });
  const report = d.rig;
  const checklist = [
    { item: 'It rigs on Muse’s skeleton', ok: true, note: report ? `${report.ms} ms; ${report.made.triangles} triangles as made, ${report.vertices} vertices rigged; ${(100 * report.cloth).toFixed(0)}% cloth` : '' },
    { item: 'Its face was found', ok: true, note: report ? `eyes at ${report.face.eye[1].toFixed(3)} H` : '' },
  ];
  const conceptPicture: PacketPicture = { id: picked.id, path: io.url(picked.file), caption: `The concept it was made from (${picked.id})` };
  if (!done.ok) {
    io.log(`body: no lab stills of ${look}: ${done.reason}`);
    return {
      kind: 'wait',
      stage: 'approve',
      data: data(d),
      packet: {
        stage: 'approve',
        ask: 'approve',
        text: `Your body (${look}) is made in 3D and rigs on Muse's skeleton, but it couldn't be shown moving yet (${done.reason}). Here is the concept it was made from. Approve it to wear it, or send up to 3 notes for four new concepts.`,
        pictures: [conceptPicture],
        checklist: [...checklist, { item: 'Shown in the lab', ok: false, note: done.reason }],
      },
    };
  }
  const sheet = `renders-${look}.jpg`;
  if (!existsSync(join(io.dir, sheet))) {
    writeFileSync(join(io.dir, sheet), await contactSheet(done.stills.map((s) => ({ image: readFileSync(join(io.dir, s.file)), label: `${s.pose}, ${view(s)}` })), 3, 360));
  }
  const stills: PacketPicture[] = done.stills.map((s) => ({ id: `${s.pose}-${s.view.replace(':', '')}`, path: io.url(s.file), caption: `${s.pose}, ${view(s)}` }));
  return {
    kind: 'wait',
    stage: 'approve',
    data: data(d),
    packet: {
      stage: 'approve',
      ask: 'approve',
      text: `Your body (${look}), made in 3D and rigged: idle, waving and being petted, from the front, at three-quarter and from the side (all nine: ${io.url(sheet)}). Approve it to wear it, or send up to 3 notes for four new concepts.`,
      pictures: [{ id: 'all', path: io.url(sheet), caption: 'All nine views' }, ...stills, conceptPicture],
      checklist: [...checklist, { item: 'Shown in the lab', ok: true, note: `${done.stills.length} stills` }],
    },
  };
}

const view = (s: Still): string => (s.view === 'front' ? 'front' : s.view === 'left' ? 'side' : 'three-quarter');

function answer(job: JobRecord, verdict: Verdict): ReturnType<Pipeline['answer']> {
  const d = state(job.data);
  if ((verdict.notes?.length ?? 0) > 3) return { ok: false, error: 'Send at most 3 notes.' };
  const notes = noteLines(verdict.notes);
  if (job.stage === 'pick') {
    const picks = verdict.picks ?? [];
    if (picks.length > 1) return { ok: false, error: `Pick one concept, not ${picks.length}.` };
    if (!picks.length) {
      if (notes.length) return { ok: true, stage: 'concepts', data: data(nextAttempt(d, notes)) };
      return { ok: false, error: `Pick one concept by its id (${d.shown.join(', ')}), or send notes without a pick for four new concepts.` };
    }
    const id = picks[0];
    if (!d.shown.includes(id)) return { ok: false, error: `"${id}" isn't one of the concepts on show (${d.shown.join(', ')}).` };
    if (notes.length) {
      if (d.refined) return { ok: false, error: 'This round has had its one refinement: pick one as it is (no notes), or send notes without a pick for four new concepts.' };
      return { ok: true, stage: 'refine', data: data({ ...d, pick: id, refineNotes: notes }) };
    }
    return { ok: true, stage: 'mesh', data: data({ ...d, pick: id }) };
  }
  if (job.stage === 'approve') {
    if (verdict.approve) return { ok: true, stage: 'finish', data: data(d) };
    if (notes.length) return { ok: true, stage: 'concepts', data: data(nextAttempt(d, notes)) };
    return { ok: false, error: 'Approve this body, or send up to 3 notes for four new concepts.' };
  }
  return { ok: false, error: 'Nothing here is waiting for an answer.' };
}

export interface BodyDeps {
  /** Rigs a made body here before it's shown (default: rigSculpt with GEN_SCULPT). */
  readonly rig?: RigCheck;
  /** Renders the lab's review stills (default: muse-look's batch.mjs against io.devServer). */
  readonly render?: Renderer;
}

export function createBodyPipeline(deps: BodyDeps = {}): Pipeline {
  const check = deps.rig ?? rigCheck();
  const render = deps.render ?? labRenderer;
  return {
    kind: 'body',
    firstStage: 'concepts',
    async step(job, io) {
      mkdirSync(io.dir, { recursive: true });
      const d = state(job.data);
      switch (job.stage) {
        case 'concepts':
          return concepts(job, io, d);
        case 'refine':
          return refine(job, io, d);
        case 'mesh':
          return mesh(job, io, d);
        case 'rig':
          return rig(job, io, d, check);
        case 'renders':
          return renders(job, io, d, render);
        case 'finish':
          if (!d.look) return { kind: 'failed', message: 'There is no made body to finish.' };
          return { kind: 'done', data: data(d), result: { look: d.look }, message: `Your body is ready: ${d.look}.` };
        default:
          return { kind: 'failed', message: `The body workshop has no step "${job.stage}".` };
      }
    },
    answer,
    estimateMs(stage) {
      return ({ concepts: 120_000, refine: 60_000, mesh: 300_000, rig: 20_000, renders: 90_000, finish: 0 } as Record<string, number>)[stage] ?? 60_000;
    },
  };
}

export const bodyPipeline: Pipeline = createBodyPipeline();
