// The planet pipeline: a Muse's brief becomes a planet of its own, a fork of the meadow in environments/muse-<id>/.
//   moodboard  six pictures from muse-image-1.0                         → Muse picks 2 or 3, saying why
//   contract   muse-spark-1.3 writes the visual contract and a recipe   → Muse approves it, or sends notes (again)
//   fork       the meadow forked, the recipe laid over its palette and settings, the planet listed
//   render     six stills, a contact sheet with the picks, the contract checked against them, postcard stills
//                                                                       → Muse approves with a name, or sends notes
//   revise     the notes answered: by Muse Code in the planet's folder when it is installed, else by retuning the
//              recipe; then render again (at most three drafts)
//   finish     the planet takes its name; the engine's applyPlanet follows (the runner's onDone)
// Every step can run again after a crash: what a step made is on disk under the job's folder, and is kept.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeneratedPlanet } from '../../../src/muse/contract';
import type { JobRecord, PacketPicture, Pipeline, StageIO, StepOutcome, Verdict } from '../types';
import {
  BUILDER_TIMEOUT_MS,
  agentsMd,
  changesOutside,
  museSummary,
  newErrors,
  restoreFork,
  snapshotFork,
  typecheckFork,
  type TypeCheck,
} from './builder';
import { ensureFork, forkDir, planetIdFor, readRecipe, recordPlanet, retitle, scaffoldFork, worldSeedFor, writeRecipe, type ForkFn } from './fork';
import {
  ADJUST_SCHEMA,
  CHECK_SCHEMA,
  CONTRACT_SCHEMA,
  MOODBOARD_VIEWS,
  WHAT_CAN_CHANGE,
  VIEW_SCHEMA,
  adjustRequest,
  checkRequest,
  contractRequest,
  moodboardPrompt,
  viewRequest,
  type AdjustAnswer,
  type CheckAnswer,
  type ContractAnswer,
  type ViewAnswer,
} from './prompts';
import { EMPTY_RECIPE, describeKnobs, mergeRecipe, readPalette, recipeFromEntries, type Recipe } from './recipe';
import { VIEWS, contactSheet, forModel, lookRenderer, toJpeg, viewFromWords, writePostcards, type Renderer, type View } from './render';

export { loadGeneratedPlanets } from './fork';

/** At most this many drafts of the planet (renders shown for approval), and of its contract. */
export const MAX_DRAFTS = 3;
const MAX_NOTE = 400;
const MAX_NAME = 40;

interface Contract {
  readonly title: string;
  readonly items: readonly string[];
  readonly avoid: readonly string[];
  readonly text: string;
}

interface Check {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

/** The job's working data (JSON), as the steps leave it. */
interface PlanetData {
  readonly moodboard?: readonly string[];
  readonly picks?: readonly string[];
  readonly reasons?: readonly string[];
  readonly contract?: Contract;
  readonly contractDrafts?: number;
  readonly contractNotes?: readonly string[];
  readonly recipe?: Recipe;
  readonly planet?: GeneratedPlanet;
  readonly title?: string;
  readonly worldSeed?: number;
  readonly draft?: number;
  readonly draftNotes?: readonly string[];
  readonly revisions?: readonly string[];
  readonly name?: string;
}

export interface PlanetDeps {
  /** Makes the fork (the new-environment scaffold). */
  readonly fork: ForkFn;
  /** Takes the stills; null for the real one on the repo's look.mjs. */
  readonly renderer: Renderer | null;
  /** Checks a fork after the builder edited it. */
  readonly typecheck: (repo: string, dir: string) => Promise<TypeCheck>;
}

const dataOf = (job: JobRecord): PlanetData => job.data;
const moodId = (i: number): string => `m${i + 1}`;
const trimLine = (s: string, max: number): string => s.replace(/\s+/g, ' ').trim().slice(0, max);

function captionOf(view: View, draft: number): string {
  return `Draft ${draft}: ${view.caption}`;
}

function contractText(c: Omit<Contract, 'text'>, recipe: Recipe): string {
  const rows = Object.entries(recipe.palette).flatMap(([time, r]) => Object.keys(r ?? {}).map((row) => `${time.toLowerCase()} ${row.toLowerCase()}`));
  const settings = Object.entries(recipe.params).flatMap(([g, v]) => Object.entries(v).map(([k, n]) => `${g}.${k} ${n}`));
  return [
    c.title,
    '',
    'It must show:',
    ...c.items.map((i) => `- ${i}`),
    '',
    'It must not look like:',
    ...c.avoid.map((i) => `- ${i}`),
    '',
    `The first draft starts from the meadow with new colours for ${rows.length ? rows.join(', ') : 'nothing yet'}, and settings ${settings.length ? settings.join(', ') : 'as the meadow’s'}. Its land, plants and home keep the meadow’s shapes until your notes on a draft ask for more.`,
  ].join('\n');
}

function cleanContract(raw: Partial<ContractAnswer>, fallbackTitle: string): Omit<Contract, 'text'> {
  const lines = (v: unknown, max: number): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === 'string')
      .map((x) => trimLine(x, 200))
      .filter(Boolean)
      .slice(0, max);
  const title = typeof raw.title === 'string' ? trimLine(raw.title.replace(/[^\p{L}\p{N}\p{Zs}'’-]/gu, ''), MAX_NAME) : '';
  const items = lines(raw.items, 7);
  if (items.length === 0) throw new Error('the contract came back without any items');
  return { title: title || fallbackTitle, items, avoid: lines(raw.avoid, 4) };
}

/** Muse's notes in one line each, with the picture and spot each points at. */
function noteLines(verdict: Verdict, pictures: readonly PacketPicture[]): string[] {
  return (verdict.notes ?? []).slice(0, 3).flatMap((n) => {
    const text = trimLine(n.text, MAX_NOTE);
    if (!text) return [];
    const pic = pictures.find((p) => p.id === n.picture);
    const where = pic ? ` (on “${pic.caption}”${n.at ? `, at ${Math.round(n.at[0])},${Math.round(n.at[1])} of 1000 across and down` : ''})` : '';
    return [`${text}${where}`];
  });
}

function meadowKnobs(repo: string, recipe: Recipe): string {
  let source = '';
  try {
    source = readFileSync(join(repo, 'src/render/palette.ts'), 'utf8');
  } catch {
    // no palette to read: the knobs list their columns without the colours they start from
  }
  return describeKnobs(readPalette(source), recipe);
}

async function inBatches<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function createPlanetPipeline(deps: Partial<PlanetDeps> = {}): Pipeline {
  const fork = deps.fork ?? scaffoldFork;
  const typecheck = deps.typecheck ?? typecheckFork;
  const rendererFor = (io: StageIO): Renderer => deps.renderer ?? lookRenderer(io.repo);

  async function moodboard(job: JobRecord, io: StageIO): Promise<StepOutcome> {
    const files = MOODBOARD_VIEWS.map((_, i) => `moodboard-${i + 1}.jpg`);
    const missing = MOODBOARD_VIEWS.map((view, i) => ({ view, file: files[i] })).filter((m) => !existsSync(join(io.dir, m.file)));
    await inBatches(missing, 3, async ({ view, file }) => {
      const [picture] = await io.clients.images.generate({ prompt: moodboardPrompt(job.brief, view), n: 1, size: '1536x1024', signal: io.signal });
      if (!picture) throw new Error('muse-image-1.0 gave back no picture');
      await toJpeg(picture, join(io.dir, file), 1536, 1024);
    });
    io.log(`moodboard: ${missing.length} made, ${files.length - missing.length} kept`);
    return {
      kind: 'wait',
      stage: 'pick',
      data: { ...job.data, moodboard: files },
      packet: {
        stage: 'pick',
        ask: 'pick',
        text: `Six pictures for your planet’s moodboard, made from your brief: one planet, seen from six places. They're paintings to choose a mood from, not plans. ${WHAT_CAN_CHANGE} Pick the 2 or 3 that feel most like it (picks: their ids), and say why in a note or two: the next step reads your reasons.`,
        pictures: files.map((file, i) => ({ id: moodId(i), path: io.url(file), caption: MOODBOARD_VIEWS[i] })),
        pick: { min: 2, max: 3 },
      },
    };
  }

  async function contract(job: JobRecord, io: StageIO): Promise<StepOutcome> {
    const data = dataOf(job);
    const n = (data.contractDrafts ?? 0) + 1;
    const record = join(io.dir, `contract-${n}.json`);
    let kept = readJson<{ contract: Omit<Contract, 'text'>; recipe: Recipe }>(record);
    const picks = (data.picks ?? []).map((id) => ({ id, file: data.moodboard?.[Number(id.slice(1)) - 1] ?? '' })).filter((p) => p.file);
    if (!kept) {
      const request = contractRequest({
        brief: job.brief,
        reasons: data.reasons ?? [],
        knobs: meadowKnobs(io.repo, EMPTY_RECIPE),
        previous: data.contract?.text,
        notes: data.contractNotes,
      });
      const answer = await io.clients.judge.json<ContractAnswer>({
        name: 'planet.contract',
        ...request,
        images: await Promise.all(picks.map((p) => forModel(join(io.dir, p.file)))),
        schema: CONTRACT_SCHEMA,
        signal: io.signal,
      });
      kept = { contract: cleanContract(answer, `${job.museId}’s planet`), recipe: recipeFromEntries(answer) };
      writeFileSync(record, `${JSON.stringify(kept, null, 2)}\n`);
    }
    const text = contractText(kept.contract, kept.recipe);
    io.log(`contract ${n}: “${kept.contract.title}”, ${kept.contract.items.length} items`);
    return {
      kind: 'wait',
      stage: 'review-contract',
      data: { ...job.data, contract: { ...kept.contract, text }, recipe: kept.recipe, contractDrafts: n, contractNotes: [] },
      packet: {
        stage: 'review-contract',
        ask: 'approve',
        text:
          n < MAX_DRAFTS
            ? `Your planet’s visual contract, written from your brief and your picks: what it must show, what it must not look like, and what its first draft starts from. ${WHAT_CAN_CHANGE} Approve it to build the planet, or send up to 3 notes and it’s written again.`
            : 'Your planet’s visual contract, written again from your notes. This is its last version: approve it to build the planet (the drafts can still take notes).',
        pictures: picks.map((p) => ({ id: p.id, path: io.url(p.file), caption: `Your pick ${p.id}` })),
        contract: text,
      },
    };
  }

  function forkStep(job: JobRecord, io: StageIO): StepOutcome {
    const data = dataOf(job);
    if (!data.contract || !data.recipe) return { kind: 'failed', message: 'The planet has no approved contract to build from.' };
    const planet = planetIdFor(job.museId);
    const worldSeed = typeof data.worldSeed === 'number' && Number.isInteger(data.worldSeed) ? data.worldSeed : worldSeedFor(job.museId);
    const title = data.contract.title;
    const { made } = ensureFork(fork, { repo: io.repo, name: planet, title, job: job.id, recipe: data.recipe }, io.log);
    recordPlanet(io.repo, planet, title);
    io.log(`fork: environments/${planet}/ ${made ? 'made' : 'kept'}, its recipe laid`);
    return { kind: 'continue', stage: 'render', data: { ...job.data, planet, worldSeed, title, draft: 0 }, message: 'Your planet is forked; its first stills are being taken.' };
  }

  async function renderStep(job: JobRecord, io: StageIO): Promise<StepOutcome> {
    const data = dataOf(job);
    const planet = data.planet;
    if (!planet || !data.contract) return { kind: 'failed', message: 'There’s no planet to render yet.' };
    const n = (data.draft ?? 0) + 1;
    const jpgs = VIEWS.map((v) => `draft-${n}-${v.name}.jpg`);
    const pngs = join(io.dir, `draft-${n}`);
    let stills: string[];
    if (jpgs.every((f) => existsSync(join(io.dir, f)))) {
      stills = jpgs.map((f) => join(io.dir, f));
    } else {
      stills = await rendererFor(io).stills({
        url: `${io.devServer.replace(/\/+$/, '')}/environments/${planet}`,
        shots: VIEWS,
        hash: `seed=${data.worldSeed ?? worldSeedFor(job.museId)}`,
        outDir: pngs,
        signal: io.signal,
        log: io.log,
      });
      await Promise.all(stills.map((file, i) => toJpeg(file, join(io.dir, jpgs[i]))));
      stills = jpgs.map((f) => join(io.dir, f));
    }
    const picks = (data.picks ?? []).map((id) => ({ id, file: data.moodboard?.[Number(id.slice(1)) - 1] ?? '' })).filter((p) => p.file);
    const sheet = `draft-${n}-sheet.jpg`;
    if (!existsSync(join(io.dir, sheet))) {
      await contactSheet(
        [...VIEWS.map((v, i) => ({ label: v.caption, file: stills[i] })), ...picks.map((p) => ({ label: `Your pick ${p.id}`, file: join(io.dir, p.file) }))],
        join(io.dir, sheet),
        `${data.title ?? planet}: draft ${n}, and your picks`,
      );
    }
    const checklist = await checkDraft(io, data.contract, stills, n);
    await writePostcards(io.repo, planet, VIEWS.map((view, i) => ({ view, file: stills[i] })));
    const builder = await io.clients.builder.available().catch(() => false);
    const how = builder
      ? 'Notes go to Muse Code, which edits the planet itself.'
      : 'Notes are answered by retuning its colours and settings (the land, plants and home keep the meadow’s shapes for now).';
    const last = n >= MAX_DRAFTS;
    const done = data.revisions?.length ? ` What changed: ${data.revisions[data.revisions.length - 1]}` : '';
    io.log(`draft ${n}: ${checklist.filter((c) => c.ok).length} of ${checklist.length} contract items read in the stills`);
    return {
      kind: 'wait',
      stage: 'review-draft',
      data: { ...job.data, draft: n, draftNotes: [] },
      packet: {
        stage: 'review-draft',
        ask: 'approve',
        text: [
          `Draft ${n} of ${MAX_DRAFTS} of your planet: six views of it, each aimed at its own places (your home, its water, its highest ground), and a sheet with your picks beside them. The checklist says how each part of the contract reads in them.${done} Your picks were paintings of a mood; judge the draft by what a planet can be. ${WHAT_CAN_CHANGE} If something seems missing, ask to see it first (workshop_view, e.g. "from the top of the knoll").`,
          last
            ? 'This is the last draft: approve it with a name for your planet (name).'
            : `Approve it with a name for your planet (name), or send up to 3 notes for the next draft; point at a picture with picture and at. ${how}`,
        ].join(' '),
        pictures: [
          ...VIEWS.map((v, i) => ({ id: `d${n}-${v.name}`, path: io.url(jpgs[i]), caption: captionOf(v, n) })),
          { id: `d${n}-sheet`, path: io.url(sheet), caption: `Draft ${n} beside your picks` },
        ],
        checklist,
      },
    };
  }

  async function checkDraft(io: StageIO, contract: Contract, stills: readonly string[], n: number): Promise<Check[]> {
    const record = join(io.dir, `draft-${n}-check.json`);
    const kept = readJson<Check[]>(record);
    if (kept) return kept;
    let checks: Check[];
    try {
      const answer = await io.clients.judge.json<CheckAnswer>({
        name: 'planet.check',
        ...checkRequest(contract.items, VIEWS.map((v) => v.caption)),
        images: await Promise.all(stills.map((f) => forModel(f))),
        schema: CHECK_SCHEMA,
        signal: io.signal,
      });
      const said: readonly CheckAnswer['items'][number][] = Array.isArray(answer.items) ? answer.items : [];
      const byIndex = new Map(said.map((c) => [c.index, c]));
      checks = contract.items.map((item, i) => {
        const c = byIndex.get(i);
        return c ? { item, ok: c.ok === true, note: trimLine(typeof c.note === 'string' ? c.note : '', 200) } : { item, ok: false, note: 'not checked' };
      });
    } catch (e) {
      io.log(`check: ${e instanceof Error ? e.message : String(e)}`);
      return contract.items.map((item) => ({ item, ok: false, note: 'couldn’t be checked this time' }));
    }
    writeFileSync(record, `${JSON.stringify(checks, null, 2)}\n`);
    return checks;
  }

  async function revise(job: JobRecord, io: StageIO): Promise<StepOutcome> {
    const data = dataOf(job);
    const planet = data.planet;
    if (!planet || !data.contract) return { kind: 'failed', message: 'There’s no planet to revise.' };
    const draft = data.draft ?? 1;
    const notes = data.draftNotes ?? [];
    const dir = forkDir(io.repo, planet);
    const record = join(io.dir, `revise-${draft}.json`);
    let summary = readJson<{ summary: string }>(record)?.summary;
    if (summary === undefined) {
      let why = '';
      if (await io.clients.builder.available().catch(() => false)) {
        const built = await build(io, dir, data.contract, notes, draft, data.title ?? planet);
        if (built.ok) summary = built.said ? `Muse Code changed your planet for your notes. In its words: ${built.said}` : 'Muse Code edited the planet for your notes.';
        else why = built.why;
      }
      if (summary === undefined) {
        const adjusted = await adjust(io, dir, data, notes, draft);
        summary = why ? `${why}; instead, ${adjusted}` : adjusted;
      }
      writeFileSync(record, `${JSON.stringify({ summary }, null, 2)}\n`);
    }
    io.log(`revise after draft ${draft}: ${summary}`);
    return {
      kind: 'continue',
      stage: 'render',
      data: { ...job.data, recipe: readRecipe(dir), revisions: [...(data.revisions ?? []), summary] },
      message: 'Your notes are answered; the next draft’s stills are being taken.',
    };
  }

  /** Muse Code on the fork, undone when it stops short or leaves the fork not type-checking. */
  async function build(io: StageIO, dir: string, contract: Contract, notes: readonly string[], draft: number, title: string): Promise<{ ok: true; said: string | null } | { ok: false; why: string }> {
    const snapshot = join(io.dir, `fork-before-${draft + 1}`);
    snapshotFork(dir, snapshot);
    const typesBefore = await typecheck(io.repo, dir);
    const before = await changesOutside(io.repo);
    const result = await io.clients.builder.run({
      workspace: dir,
      instructions: agentsMd({ title, contract: contract.text, notes, draft }),
      prompt: `Answer the Muse's notes on draft ${draft} of this planet, as AGENTS.md says. Edit only files in this folder.`,
      timeoutMs: BUILDER_TIMEOUT_MS,
    });
    writeFileSync(join(io.dir, `builder-${draft}.log`), result.log);
    // Muse Code's sandbox writes only inside its workspace (the fork), so a file outside it that changed while it ran
    // is someone else's work in progress: noted and left alone. (Undoing it once threw away both that work and the
    // planet's answer to Blu's notes.)
    const after = await changesOutside(io.repo);
    const outside = [...after].filter(([path, now]) => before.get(path) !== now).map(([path]) => path);
    if (outside.length) io.log(`files outside the planet changed while Muse Code ran, left alone: ${outside.slice(0, 5).join(', ')}`);
    let why = '';
    if (!result.ok) why = 'Muse Code stopped before it finished, so its work was undone';
    else {
      const added = newErrors(typesBefore, await typecheck(io.repo, dir));
      if (added.length) {
        writeFileSync(join(io.dir, `typecheck-${draft}.log`), added.join('\n'));
        why = `Muse Code’s changes didn’t type-check (${added.length} new error${added.length === 1 ? '' : 's'}), so they were undone`;
      }
    }
    if (why) {
      restoreFork(snapshot, dir);
      io.log(why);
      return { ok: false, why };
    }
    return { ok: true, said: museSummary(result.log) };
  }

  /** The recipe retuned for the notes by muse-spark-1.3: the cheaper answer, when Muse Code isn't here or failed. */
  async function adjust(io: StageIO, dir: string, data: PlanetData, notes: readonly string[], draft: number): Promise<string> {
    const recipe = readRecipe(dir);
    const pictures = [`draft-${draft}-sheet.jpg`].filter((f) => existsSync(join(io.dir, f)));
    const answer = await io.clients.judge.json<AdjustAnswer>({
      name: 'planet.adjust',
      ...adjustRequest({ contract: data.contract?.text ?? '', notes, knobs: meadowKnobs(io.repo, recipe), captions: pictures.map(() => `draft ${draft} beside the Muse's picks`) }),
      images: await Promise.all(pictures.map((f) => forModel(join(io.dir, f), 1200))),
      schema: ADJUST_SCHEMA,
      signal: io.signal,
    });
    writeRecipe(dir, mergeRecipe(recipe, recipeFromEntries(answer)));
    const said = typeof answer.summary === 'string' ? trimLine(answer.summary, 200) : '';
    return said || 'its colours and settings were retuned for your notes.';
  }

  function finish(job: JobRecord, io: StageIO): StepOutcome {
    const data = dataOf(job);
    const planet = data.planet;
    const name = data.name;
    if (!planet || !name) return { kind: 'failed', message: 'The planet has no name to finish with.' };
    retitle(forkDir(io.repo, planet), data.title ?? name, name);
    recordPlanet(io.repo, planet, name);
    const worldSeed = data.worldSeed ?? worldSeedFor(job.museId);
    return {
      kind: 'done',
      data: { ...job.data, title: name },
      result: { planet: { id: planet, worldSeed, name } },
      message: `${name} is your planet now.`,
    };
  }

  return {
    kind: 'planet',
    firstStage: 'moodboard',
    async step(job, io) {
      mkdirSync(io.dir, { recursive: true });
      switch (job.stage) {
        case 'moodboard':
          return moodboard(job, io);
        case 'contract':
          return contract(job, io);
        case 'fork':
          return forkStep(job, io);
        case 'render':
          return renderStep(job, io);
        case 'revise':
          return revise(job, io);
        case 'finish':
          return finish(job, io);
        default:
          return { kind: 'failed', message: `The planet workshop has no step called “${job.stage}”.` };
      }
    },

    answer(job, verdict) {
      const data = dataOf(job);
      const pictures = job.packet?.pictures ?? [];
      const notes = noteLines(verdict, pictures);
      switch (job.stage) {
        case 'pick': {
          const ids = new Set((data.moodboard ?? []).map((_, i) => moodId(i)));
          const picks = [...new Set(verdict.picks ?? [])];
          if (picks.length < 2 || picks.length > 3) return { ok: false, error: 'Pick 2 or 3 of the pictures, by their ids (m1 to m6).' };
          const unknown = picks.filter((id) => !ids.has(id));
          if (unknown.length) return { ok: false, error: `There’s no picture ${unknown.join(', ')} on this moodboard: its ids are m1 to m6.` };
          return { ok: true, stage: 'contract', data: { ...job.data, picks, reasons: notes } };
        }
        case 'review-contract': {
          if (verdict.approve === true) return { ok: true, stage: 'fork', data: { ...job.data } };
          if (notes.length === 0) return { ok: false, error: 'Approve the contract (approve: true), or send notes on what to change.' };
          if ((data.contractDrafts ?? 1) >= MAX_DRAFTS) return { ok: false, error: `That was the contract’s last version (${MAX_DRAFTS} of ${MAX_DRAFTS}): approve it, and send your notes on the drafts.` };
          return { ok: true, stage: 'contract', data: { ...job.data, contractNotes: notes } };
        }
        case 'review-draft': {
          if (verdict.approve === true) {
            const name = trimLine((verdict.name ?? '').replace(/[\p{Cc}\p{Cf}<>]/gu, ''), MAX_NAME + 1);
            if (!name) return { ok: false, error: 'Approve your planet with a name for it (name).' };
            if (name.length > MAX_NAME) return { ok: false, error: `A planet’s name is at most ${MAX_NAME} characters.` };
            return { ok: true, stage: 'finish', data: { ...job.data, name } };
          }
          if (notes.length === 0) return { ok: false, error: 'Approve the draft with a name (approve: true, name), or send notes for the next one.' };
          if ((data.draft ?? 1) >= MAX_DRAFTS) return { ok: false, error: `This is the last draft (${MAX_DRAFTS} of ${MAX_DRAFTS}): approve it with a name.` };
          return { ok: true, stage: 'revise', data: { ...job.data, draftNotes: notes } };
        }
        default:
          return { ok: false, error: 'This planet isn’t waiting for an answer right now.' };
      }
    },

    async view(job, ask, io) {
      const data = dataOf(job);
      const planet = data.planet;
      if (!planet || !existsSync(join(forkDir(io.repo, planet), 'index.html'))) {
        return { ok: false, error: 'There’s no planet to look at yet: it’s built once you approve its contract.' };
      }
      const words = trimLine(ask, 300);
      let chosen: { view: View; hours: number | null } | null = null;
      try {
        const answer = await io.clients.judge.json<ViewAnswer>({ name: 'planet.view', ...viewRequest(words), schema: VIEW_SCHEMA, signal: io.signal });
        if (answer.possible === false) {
          const why = trimLine(typeof answer.why === 'string' ? answer.why : '', 200).replace(/[.!\s]+$/, '');
          return { ok: false, error: `That can’t be shown from this planet’s views: ${why || 'none of them frames it'}.` };
        }
        const view = VIEWS.find((v) => v.name === answer.view);
        if (view) chosen = { view, hours: answer.hours >= 5.5 && answer.hours <= 19 ? answer.hours : null };
      } catch (e) {
        io.log(`view: ${e instanceof Error ? e.message : String(e)}; framing it from the words alone`);
      }
      chosen ??= viewFromWords(words);
      if (!chosen) return { ok: false, error: `I can show your planet from orbit, from a bird’s-eye view, standing on a rise, across its vista, at your home or at eye level, at any time from dawn to dusk; “${words}” isn’t one of them.` };
      const k = readdirSync(io.dir).filter((f) => /^view-\d+\.jpg$/.test(f)).length + 1;
      const hash = [`seed=${data.worldSeed ?? worldSeedFor(job.museId)}`, chosen.hours === null ? '' : `tod=${chosen.hours}`].filter(Boolean).join('&');
      const [still] = await rendererFor(io).stills({
        url: `${io.devServer.replace(/\/+$/, '')}/environments/${planet}`,
        shots: [chosen.view],
        hash,
        outDir: join(io.dir, `view-${k}`),
        signal: io.signal,
        log: io.log,
      });
      const file = `view-${k}.jpg`;
      await toJpeg(still, join(io.dir, file));
      const at = chosen.hours === null ? '' : ` at ${Math.floor(chosen.hours)}:${String(Math.round((chosen.hours % 1) * 60)).padStart(2, '0')}`;
      return { ok: true, picture: { id: `v${k}`, path: io.url(file), caption: `${chosen.view.caption}${at}` } };
    },

    estimateMs(stage) {
      switch (stage) {
        case 'moodboard':
          return 150_000;
        case 'contract':
          return 60_000;
        case 'fork':
        case 'render':
          return 240_000;
        case 'revise':
          // (Muse Code answering notes, then the draft's stills: Blu's first round took 35 minutes)
          return 2_220_000;
        default:
          return 10_000;
      }
    },
  };
}

export const planetPipeline: Pipeline = createPlanetPipeline();
