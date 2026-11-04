import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Instant, MuseId } from '../../../src/muse/contract';
import { planetOf } from '../../../src/muse/planets';
import { fakeClients, type Builder, type WorkshopClients } from '../clients';
import type { Brief, JobRecord, Packet, Pipeline, StageIO, StepOutcome, Verdict } from '../types';
import type { ForkFn } from './fork';
import { createPlanetPipeline } from './index';
import type { Renderer } from './render';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'planet-job-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
/** What the fake muse-image-1.0 makes: a small picture, so the tests stay quick. */
const PICTURE = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();

const BRIEF: Brief = {
  kind: 'planet',
  text: 'quiet tide pools under a pale sky; somewhere high to watch the stars',
  never: ['nothing neon'],
};

const JUDGED = {
  'planet.contract': {
    title: 'Tide Pool Rise!',
    items: ['A pale, quiet sky', 'Still pools of water across the land', 'A high place to look out from', '  '],
    avoid: ['neon colours'],
    palette: [
      { time: 'NOON', row: 'SKY', colours: ['#cfe3ee', '#eef4f6', 'not a colour'] },
      { time: 'NOON', row: 'NOPE', colours: ['#111111'] },
      { time: 'DAWN', row: 'GRASS', colours: ['#000000'] },
    ],
    params: [
      { param: 'grass.height', value: 9 },
      { param: 'style.toonBands', value: 3.6 },
      { param: 'world.seed', value: 3 },
    ],
  },
  'planet.check': {
    items: [
      { index: 0, ok: true, note: 'the sky is pale' },
      { index: 1, ok: false, note: 'mostly meadow, few pools' },
    ],
  },
  'planet.adjust': {
    summary: 'The sky is paler and the grass shorter.',
    palette: [{ time: 'NOON', row: 'SKY', colours: ['#E0ECF2'] }],
    params: [{ param: 'grass.height', value: 0.2 }],
  },
};

/** A fork as the scaffold makes one, cut down to what the pipeline touches. */
const fakeFork: ForkFn = ({ repo, name, title }) => {
  const dir = join(repo, 'environments', name);
  mkdirSync(join(dir, 'render'), { recursive: true });
  mkdirSync(join(dir, 'ui'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<html><title>${title}</title></html>`);
  writeFileSync(join(dir, 'ui/ui.ts'), `export const TITLE = '${title}';\n`);
  writeFileSync(join(dir, 'ui/postcard.ts'), `export const SIGNED = '${title}';\n`);
  writeFileSync(join(dir, 'params.ts'), readFileSync(join(REPO, 'src/params.ts'), 'utf8'));
  writeFileSync(join(dir, 'render/palette.ts'), readFileSync(join(REPO, 'src/render/palette.ts'), 'utf8'));
  return { dir, commit: 'abc1234', dirty: false };
};

/** Stills without a browser: a flat picture per shot. */
function stubRenderer(calls: { shots: string[]; hash: string; url: string }[]): Renderer {
  return {
    async stills({ url, shots, hash, outDir }) {
      calls.push({ url, hash: hash ?? '', shots: shots.map((s) => s.name) });
      mkdirSync(outDir, { recursive: true });
      return Promise.all(
        shots.map(async (s, i) => {
          const file = join(outDir, `${s.name}.png`);
          await sharp({ create: { width: 360, height: 240, channels: 3, background: { r: 40 * i, g: 120, b: 200 } } }).png().toFile(file);
          return file;
        }),
      );
    },
  };
}

interface Run {
  readonly pipeline: Pipeline;
  readonly io: StageIO;
  job: JobRecord;
  readonly renders: { shots: string[]; hash: string; url: string }[];
  readonly generated: { n: number };
}

function setup(name: string, opts: { builder?: Builder; judged?: Record<string, unknown>; repo?: string } = {}): Run {
  const repo = opts.repo ?? join(root, name);
  mkdirSync(join(repo, 'src/render'), { recursive: true });
  writeFileSync(join(repo, 'src/render/palette.ts'), readFileSync(join(REPO, 'src/render/palette.ts'), 'utf8'));
  const base = fakeClients({ picture: PICTURE, judged: opts.judged ?? JUDGED, builder: opts.builder });
  const generated = { n: 0 };
  const clients: WorkshopClients = {
    ...base,
    images: {
      ...base.images,
      generate: (req) => ((generated.n += req.n), base.images.generate(req)),
    },
  };
  const renders: Run['renders'] = [];
  const io: StageIO = {
    dir: join(repo, '.muse/workshop/job-1'),
    url: (f) => `/w/job-1/${f}`,
    clients,
    log: () => {},
    signal: new AbortController().signal,
    repo,
    devServer: 'http://localhost:5402/',
  };
  const job: JobRecord = {
    id: 'job-1',
    museId: 'test' as MuseId,
    kind: 'planet',
    brief: BRIEF,
    state: 'working',
    stage: 'moodboard',
    round: 0,
    data: {},
    packet: null,
    message: '',
    createdAt: 0 as Instant,
    updatedAt: 0 as Instant,
  };
  return { pipeline: createPlanetPipeline({ fork: fakeFork, renderer: stubRenderer(renders), typecheck: (_repo, dir) => Promise.resolve({ errors: existsSync(join(dir, 'broken.ts')) ? ['broken.ts: error TS2322: no'] : ['main.ts: error TS2345: the scaffold’s own'], log: '' }) }), io, job, renders, generated };
}

/** Steps on as the runner does, until a round is ready (or the job ends). */
async function runOn(run: Run): Promise<StepOutcome> {
  for (let i = 0; i < 10; i++) {
    const out = await run.pipeline.step(run.job, run.io);
    if (out.kind === 'continue') {
      run.job = { ...run.job, stage: out.stage, data: out.data };
      continue;
    }
    if (out.kind === 'wait') {
      const packet: Packet = { ...out.packet, job: run.job.id, kind: 'planet', round: run.job.round + 1 };
      run.job = { ...run.job, state: 'waiting', stage: out.stage, data: out.data, packet, round: run.job.round + 1 };
    } else if (out.kind === 'done') {
      run.job = { ...run.job, state: 'done', data: out.data, packet: null };
    }
    return out;
  }
  throw new Error('no round after 10 steps');
}

function answer(run: Run, verdict: Verdict): void {
  const a = run.pipeline.answer(run.job, verdict);
  if (!a.ok) throw new Error(a.error);
  run.job = { ...run.job, state: 'working', stage: a.stage, data: a.data, packet: null };
}

const refusal = (run: Run, verdict: Verdict): string => {
  const a = run.pipeline.answer(run.job, verdict);
  return a.ok ? '' : a.error;
};

describe('the planet pipeline under fakes', { timeout: 30_000 }, () => {
  it('runs a whole job: moodboard, picks, contract, fork, renders, notes, a second draft, a name', async () => {
    const run = setup('whole');
    const mood = await runOn(run);
    expect(mood.kind).toBe('wait');
    expect(run.job.stage).toBe('pick');
    expect(run.job.packet?.ask).toBe('pick');
    expect(run.job.packet?.pick).toEqual({ min: 2, max: 3 });
    expect(run.job.packet?.pictures.map((p) => p.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect(run.job.packet?.pictures[0].path).toBe('/w/job-1/moodboard-1.jpg');
    expect(readdirSync(run.io.dir).filter((f) => f.startsWith('moodboard-'))).toHaveLength(6);

    expect(refusal(run, { picks: ['m1'] })).toMatch(/2 or 3/);
    expect(refusal(run, { picks: ['m1', 'm9'] })).toMatch(/no picture m9/);
    answer(run, { picks: ['m2', 'm5'], notes: [{ text: 'the pale light in this one', picture: 'm2' }] });

    await runOn(run);
    expect(run.job.stage).toBe('review-contract');
    const contract = run.job.packet?.contract ?? '';
    expect(contract).toContain('Tide Pool Rise');
    expect(contract).toContain('- A pale, quiet sky');
    expect(contract).toContain('- neon colours');
    expect(run.job.packet?.pictures.map((p) => p.id)).toEqual(['m2', 'm5']);
    expect(run.job.data.reasons).toEqual(['the pale light in this one (on “A vista across the land from a low rise, the home small in the middle distance.”)']);
    expect(refusal(run, {})).toMatch(/Approve the contract/);
    answer(run, { approve: true });

    await runOn(run);
    expect(run.job.stage).toBe('review-draft');
    const fork = join(run.io.repo, 'environments/muse-test');
    expect(JSON.parse(readFileSync(join(fork, 'recipe.json'), 'utf8'))).toEqual({
      palette: { NOON: { SKY: ['#CFE3EE', '#EEF4F6'] } },
      params: { grass: { height: 1.2 }, style: { toonBands: 4 } },
    });
    expect(readFileSync(join(fork, 'params.ts'), 'utf8')).toContain("import { recipeParams } from './recipe';");
    expect(readFileSync(join(fork, 'render/palette.ts'), 'utf8')).toContain("import { recipePalette } from '../recipe';");
    expect(existsSync(join(fork, 'recipe.ts'))).toBe(true);
    expect(run.renders[0].url).toBe('http://localhost:5402/environments/muse-test');
    expect(run.renders[0].hash).toBe(`seed=${String(run.job.data.worldSeed)}`);
    expect(run.renders[0].shots).toEqual(['orbit', 'birds-eye', 'standing', 'vista', 'home', 'eye-level']);
    const draft = run.job.packet;
    expect(draft?.ask).toBe('approve');
    expect(draft?.pictures.map((p) => p.id)).toEqual(['d1-orbit', 'd1-birds-eye', 'd1-standing', 'd1-vista', 'd1-home', 'd1-eye-level', 'd1-sheet']);
    expect(draft?.checklist).toEqual([
      { item: 'A pale, quiet sky', ok: true, note: 'the sky is pale' },
      { item: 'Still pools of water across the land', ok: false, note: 'mostly meadow, few pools' },
      { item: 'A high place to look out from', ok: false, note: 'not checked' },
    ]);
    const cards = readdirSync(join(run.io.repo, 'src/assets/postcards/muse-test')).sort();
    expect(cards).toEqual(['beyond-1.jpg', 'closeup-1.jpg', 'home-1.jpg', 'invitation-1.jpg', 'scenery-1.jpg', 'scenery-2.jpg', 'scenery-3.jpg']);
    expect((await sharp(join(run.io.repo, 'src/assets/postcards/muse-test/scenery-1.jpg')).metadata()).width).toBe(960);
    expect(await sharp(join(run.io.dir, 'draft-1-sheet.jpg')).metadata()).toMatchObject({ format: 'jpeg' });
    expect(JSON.parse(readFileSync(join(run.io.repo, 'environments/generated.json'), 'utf8'))).toEqual([{ id: 'muse-test', title: 'Tide Pool Rise' }]);

    expect(refusal(run, { approve: true })).toMatch(/with a name/);
    answer(run, { notes: [{ text: 'paler, and shorter grass', picture: 'd1-vista', at: [500, 300] }] });
    await runOn(run);
    expect(run.job.stage).toBe('review-draft');
    expect(run.job.data.draft).toBe(2);
    expect(run.job.packet?.pictures[0].id).toBe('d2-orbit');
    expect(run.job.packet?.text).toContain('The sky is paler and the grass shorter.');
    expect(JSON.parse(readFileSync(join(fork, 'recipe.json'), 'utf8'))).toEqual({
      palette: { NOON: { SKY: ['#E0ECF2'] } },
      params: { grass: { height: 0.2 }, style: { toonBands: 4 } },
    });

    answer(run, { approve: true, name: '  Starwatch   Pools ' });
    const done = await runOn(run);
    expect(done).toMatchObject({ kind: 'done', result: { planet: { id: 'muse-test', name: 'Starwatch Pools' } } });
    if (done.kind !== 'done') return;
    expect(done.result.planet?.worldSeed).toBe(run.job.data.worldSeed);
    expect(planetOf('muse-test').title).toBe('Starwatch Pools');
    expect(JSON.parse(readFileSync(join(run.io.repo, 'environments/generated.json'), 'utf8'))).toEqual([{ id: 'muse-test', title: 'Starwatch Pools' }]);
    expect(readFileSync(join(fork, 'index.html'), 'utf8')).toContain('<title>Starwatch Pools</title>');
    expect(readFileSync(join(fork, 'ui/ui.ts'), 'utf8')).toContain("'Starwatch Pools'");
  });

  it('keeps what a step made when it runs again', async () => {
    const run = setup('again');
    await runOn(run);
    expect(run.generated.n).toBe(6);
    rmSync(join(run.io.dir, 'moodboard-3.jpg'));
    run.job = { ...run.job, stage: 'moodboard', state: 'working' };
    await runOn(run);
    expect(run.generated.n).toBe(7);
  });

  it('writes the contract again from notes, at most three times', async () => {
    const run = setup('contract');
    await runOn(run);
    answer(run, { picks: ['m1', 'm2', 'm3'] });
    await runOn(run);
    for (let n = 2; n <= 3; n++) {
      answer(run, { notes: [{ text: `more pools, round ${n}` }] });
      expect(run.job.data.contractNotes).toEqual([`more pools, round ${n}`]);
      await runOn(run);
      expect(run.job.data.contractDrafts).toBe(n);
    }
    expect(existsSync(join(run.io.dir, 'contract-3.json'))).toBe(true);
    expect(refusal(run, { notes: [{ text: 'again' }] })).toMatch(/last version/);
  });

  it('takes no notes on the third draft', async () => {
    const run = setup('drafts');
    await runOn(run);
    answer(run, { picks: ['m1', 'm2'] });
    await runOn(run);
    answer(run, { approve: true });
    await runOn(run);
    for (let n = 2; n <= 3; n++) {
      answer(run, { notes: [{ text: 'paler' }] });
      await runOn(run);
      expect(run.job.data.draft).toBe(n);
    }
    expect(run.job.packet?.text).toContain('This is the last draft');
    expect(refusal(run, { notes: [{ text: 'more' }] })).toMatch(/last draft/);
    expect(refusal(run, { approve: true, name: 'x'.repeat(41) })).toMatch(/at most 40/);
  });

  it('shows another view from Muse’s words, and says plainly when it can’t', async () => {
    const run = setup('view');
    const view = run.pipeline.view?.bind(run.pipeline);
    if (!view) throw new Error('the planet pipeline has views');
    const early = await view(run.job, 'my porch at dusk', run.io);
    expect(early.ok).toBe(false);
    expect(early.ok ? '' : early.error).toMatch(/no planet to look at yet/);
    await runOn(run);
    answer(run, { picks: ['m1', 'm2'] });
    await runOn(run);
    answer(run, { approve: true });
    await runOn(run);
    const porch = await view(run.job, 'from my porch at dusk', run.io);
    expect(porch).toEqual({ ok: true, picture: { id: 'v1', path: '/w/job-1/view-1.jpg', caption: 'Your home at 18:36' } });
    expect(run.renders.at(-1)?.shots).toEqual(['home']);
    expect(run.renders.at(-1)?.hash).toBe(`seed=${String(run.job.data.worldSeed)}&tod=18.6`);
    const second = await view(run.job, 'the whole planet from orbit', run.io);
    expect(second).toMatchObject({ ok: true, picture: { id: 'v2', caption: 'The whole planet from orbit' } });
    expect(await view(run.job, 'the inside of the teapot', run.io)).toMatchObject({ ok: false });
  });

  it('refuses a view the judge says no view can show', async () => {
    const run = setup('view-no', { judged: { ...JUDGED, 'planet.view': { possible: false, view: 'home', hours: 0, why: 'it is inside the volcano' } } });
    await runOn(run);
    answer(run, { picks: ['m1', 'm2'] });
    await runOn(run);
    answer(run, { approve: true });
    await runOn(run);
    expect(await run.pipeline.view?.(run.job, 'inside the volcano', run.io)).toEqual({ ok: false, error: 'That can’t be shown from this planet’s views: it is inside the volcano.' });
  });
});

describe('notes answered by the builder', { timeout: 30_000 }, () => {
  const repo = join(root, 'git-repo');
  beforeEach(() => {
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(join(repo, '.gitignore'), 'environments/muse-*/\n.muse/\nsrc/assets/postcards/muse-*/\nenvironments/generated.json\n');
    writeFileSync(join(repo, 'README.md'), 'hello\n');
    mkdirSync(join(repo, 'src/render'), { recursive: true });
    writeFileSync(join(repo, 'src/render/palette.ts'), readFileSync(join(REPO, 'src/render/palette.ts'), 'utf8'));
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'start');
  });

  async function toFirstDraft(run: Run): Promise<void> {
    await runOn(run);
    answer(run, { picks: ['m1', 'm2'] });
    await runOn(run);
    answer(run, { approve: true });
    await runOn(run);
  }

  it('keeps an edit inside the planet', async () => {
    const runs: string[] = [];
    const builder: Builder = {
      available: () => Promise.resolve(true),
      run: ({ workspace, instructions }) => {
        runs.push(instructions);
        writeFileSync(join(workspace, 'shore.ts'), 'export const SHORE = 1;\n');
        return Promise.resolve({ ok: true, log: 'edited shore.ts' });
      },
    };
    const run = setup('builder-in', { builder, repo });
    await toFirstDraft(run);
    expect(run.job.packet?.text).toContain('Muse Code');
    answer(run, { notes: [{ text: 'tide pools along the shore' }] });
    await runOn(run);
    expect(run.job.data.draft).toBe(2);
    expect(existsSync(join(repo, 'environments/muse-test/shore.ts'))).toBe(true);
    expect(run.job.packet?.text).toContain('Muse Code edited the planet for your notes.');
    expect(runs[0]).toContain('Edit only files in this folder');
    expect(runs[0]).toContain('1. tide pools along the shore');
    expect(runs[0]).toContain('- A pale, quiet sky');
  });

  it('undoes a run that adds type errors to the planet', async () => {
    const builder: Builder = {
      available: () => Promise.resolve(true),
      run: ({ workspace }) => {
        writeFileSync(join(workspace, 'broken.ts'), 'export const X: number = "no";\n');
        return Promise.resolve({ ok: true, log: '' });
      },
    };
    const run = setup('builder-types', { builder, repo });
    await toFirstDraft(run);
    answer(run, { notes: [{ text: 'paler' }] });
    await runOn(run);
    expect(existsSync(join(repo, 'environments/muse-test/broken.ts'))).toBe(false);
    expect(run.job.packet?.text).toContain('Muse Code’s changes didn’t type-check (1 new error), so they were undone; instead, The sky is paler');
    expect(readFileSync(join(run.io.dir, 'typecheck-1.log'), 'utf8')).toBe('broken.ts: error TS2322: no');
  });

  it('undoes a run that strays outside the planet, and retunes the recipe instead', async () => {
    const builder: Builder = {
      available: () => Promise.resolve(true),
      run: ({ workspace }) => {
        writeFileSync(join(workspace, 'shore.ts'), 'export const SHORE = 1;\n');
        writeFileSync(join(repo, 'README.md'), 'changed\n');
        writeFileSync(join(repo, 'stray.ts'), 'oops\n');
        return Promise.resolve({ ok: true, log: '' });
      },
    };
    const run = setup('builder-out', { builder, repo });
    await toFirstDraft(run);
    answer(run, { notes: [{ text: 'paler' }] });
    await runOn(run);
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('hello\n');
    expect(existsSync(join(repo, 'stray.ts'))).toBe(false);
    expect(existsSync(join(run.io.dir, 'outside-1/stray.ts'))).toBe(true);
    expect(existsSync(join(repo, 'environments/muse-test/shore.ts'))).toBe(false);
    expect(run.job.packet?.text).toMatch(/changed files outside the planet \((README\.md, stray\.ts|stray\.ts, README\.md)\), so its work was undone; instead, The sky is paler/);
    expect(JSON.parse(readFileSync(join(repo, 'environments/muse-test/recipe.json'), 'utf8'))).toMatchObject({ params: { grass: { height: 0.2 } } });
  });
});
