import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { Instant, MuseId } from '../../../src/muse/contract';
import { fakeClients, type Segment, type WorkshopClients } from '../clients';
import type { Brief, JobRecord, Pipeline, StageIO, StepOutcome, Verdict } from '../types';
import type { Home } from './furnish';
import { makeHomePipeline, MAX_PIECES, nounPhrase } from './index';
import { free, keepClear, KEEP, ANCHORS } from './place';
import { stubRenderer } from './render';

// The whole home job under fake clients and a stand-in renderer, in a temporary repository with a fork of the meadow
// (just its world.ts, importing the meadow's hut as a scaffolded fork does): the room, three versions to pick from,
// the pieces found and cleaned, made into models (muse6.glb standing in, never Tripo), placed, home.json written into
// the fork with the fork's own hut reading it, the room shown, notes, a second draft, approval.

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function repo(withFork: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'home-job-'));
  temps.push(root);
  if (withFork) {
    const fork = join(root, 'environments', 'muse-test');
    mkdirSync(fork, { recursive: true });
    const hut = relative(fork, join(SRC, 'life', 'hut')).split('\\').join('/');
    writeFileSync(join(fork, 'world.ts'), `import { HutInterior } from '${hut}';\n\nexport const Hut = HutInterior;\n`);
  }
  return root;
}

const brief: Brief = { kind: 'home', text: 'a cozy reading corner', things: ['a green armchair by the window', 'a floor lamp', 'a stack of books', 'a tiny piano'] };

function record(stage: string, data: Readonly<Record<string, unknown>> = {}, b: Brief = brief): JobRecord {
  return { id: 'f'.repeat(32), museId: 'test' as MuseId, kind: 'home', brief: b, state: 'working', stage, round: 0, data, packet: null, message: '', createdAt: 0 as Instant, updatedAt: 0 as Instant };
}

function io(root: string, clients: WorkshopClients): StageIO {
  const dir = join(root, '.muse', 'workshop', 'f'.repeat(32));
  mkdirSync(dir, { recursive: true });
  return { dir, url: (f) => `/w/${'f'.repeat(32)}/${f}`, clients, log: () => undefined, signal: new AbortController().signal, repo: root, devServer: 'http://localhost:0' };
}

/** Steps until the job waits, is done or fails (as the runner does), each step's stage recorded. */
async function run(p: Pipeline, job: JobRecord, at: StageIO): Promise<{ job: JobRecord; outcome: StepOutcome; stages: string[] }> {
  const stages: string[] = [];
  for (let k = 0; k < 20; k++) {
    stages.push(job.stage);
    const outcome = await p.step(job, at);
    if (outcome.kind !== 'continue') return { job: outcome.kind === 'wait' ? { ...job, stage: outcome.stage, data: outcome.data, state: 'waiting' } : job, outcome, stages };
    job = { ...job, stage: outcome.stage, data: outcome.data };
  }
  throw new Error('the job never settled');
}

function answer(p: Pipeline, job: JobRecord, verdict: Verdict): JobRecord {
  const a = p.answer(job, verdict);
  if (!a.ok) throw new Error(a.error);
  return { ...job, stage: a.stage, data: a.data, state: 'working' };
}

/** A segmenter that knows where three of the things stand in the picture (and finds no piano). */
function segmenter(calls: string[]): WorkshopClients['segmenter'] {
  const at: Record<string, Segment[]> = {
    'green armchair': [{ box: [260, 300, 380, 430], mask: null, confidence: 0.92 }],
    'floor lamp': [{ box: [700, 120, 740, 300], mask: null, confidence: 0.8 }],
    'stack of books': [{ box: [150, 400, 190, 440], mask: null, confidence: 0.7 }],
  };
  return { find: (_image, phrase) => (calls.push(phrase), Promise.resolve(at[phrase] ?? [])) };
}

describe('the home job', () => {
  it('furnishes the fork’s room end to end: room, pick, pieces, models, home.json, approval', async () => {
    const root = repo(true);
    const fork = join(root, 'environments', 'muse-test');
    const meshed: string[] = [];
    const found: string[] = [];
    const base = fakeClients();
    const clients: WorkshopClients = {
      ...base,
      segmenter: segmenter(found),
      mesher: { fromImage: (image, opts, signal) => (meshed.push(`${opts.purpose} (${opts.faceLimit} faces)`), base.mesher.fromImage(image, opts, signal)) },
    };
    const at = io(root, clients);
    const pipeline = makeHomePipeline({ renderer: () => stubRenderer() });

    // the room, then three versions of it furnished, to pick from
    let r = await run(pipeline, record('room'), at);
    expect(r.stages).toEqual(['room', 'furnish']);
    expect(r.outcome.kind).toBe('wait');
    if (r.outcome.kind !== 'wait') return;
    expect(r.outcome.packet.ask).toBe('pick');
    expect(r.outcome.packet.pick).toEqual({ min: 1, max: 1 });
    expect(r.outcome.packet.pictures).toHaveLength(3);
    for (const f of ['room.png', 'furnish-1-1.png', 'furnish-1-2.png', 'furnish-1-3.png']) expect(existsSync(join(at.dir, f)), f).toBe(true);
    expect(pipeline.answer(r.job, { picks: ['nope'] }).ok).toBe(false);

    // picked: the pieces found, cut out and cleaned, made into models one by one, placed, written into the fork
    let job = answer(pipeline, r.job, { picks: [r.outcome.packet.pictures[1].id] });
    r = await run(pipeline, job, at);
    expect(r.stages).toEqual(['pieces', 'mesh', 'place', 'show']);
    expect(found).toEqual(['green armchair', 'floor lamp', 'stack of books']);
    expect(meshed).toHaveLength(3);
    expect(meshed[0]).toBe('home piece a green armchair by the window for test (10000 faces)');
    if (r.outcome.kind !== 'wait') throw new Error(r.outcome.kind);
    expect(r.outcome.packet.ask).toBe('approve');
    expect(r.outcome.packet.pictures[0].id).toBe('home-1');

    const home = JSON.parse(readFileSync(join(fork, 'home.json'), 'utf8')) as Home;
    expect(home.keep).toEqual([...KEEP]);
    expect(home.pieces.length).toBeGreaterThan(0);
    expect(home.pieces.length).toBeLessThanOrEqual(MAX_PIECES);
    const zones = keepClear(ANCHORS);
    for (const p of home.pieces) {
      expect(existsSync(join(fork, 'assets', 'home', p.file)), p.file).toBe(true);
      expect(p.height).toBeGreaterThanOrEqual(0.3);
      expect(p.height).toBeLessThanOrEqual(2.3);
      // its spot is clear of the bed, the hearth, the showpiece and the ways Muse walks (a small box round its foot at least)
      expect(free({ x0: p.place.x - 0.05, x1: p.place.x + 0.05, z0: p.place.z - 0.05, z1: p.place.z + 0.05 }, zones, []), p.name).toBe(true);
    }
    // the models' pictures are 512² at most (muse6.glb's is larger)
    const glb = readFileSync(join(fork, 'assets', 'home', home.pieces[0].file));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { images: { bufferView: number }[]; bufferViews: { byteOffset?: number; byteLength: number }[] };
    const view = json.bufferViews[json.images[0].bufferView];
    const binAt = 20 + glb.readUInt32LE(12) + 8;
    const meta = await sharp(glb.subarray(binAt + (view.byteOffset ?? 0), binAt + (view.byteOffset ?? 0) + view.byteLength)).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512);

    // the fork has its own hut reading home.json, and its world imports it
    expect(readFileSync(join(fork, 'life', 'hut.ts'), 'utf8')).toContain("import.meta.glob<Home>('../home.json'");
    expect(readFileSync(join(fork, 'world.ts'), 'utf8')).toContain("from './life/hut'");

    // a step run again after a crash makes nothing twice (and never pays for the same picture again)
    await pipeline.step({ ...job, stage: 'mesh', data: r.job.data }, at);
    expect(meshed).toHaveLength(3);

    // notes: furnished again, a second draft; then approved
    expect(pipeline.answer(r.job, {}).ok).toBe(false);
    job = answer(pipeline, r.job, { notes: [{ text: 'a warmer lamp' }] });
    expect(job.stage).toBe('furnish');
    r = await run(pipeline, job, at);
    if (r.outcome.kind !== 'wait') throw new Error(r.outcome.kind);
    expect(r.outcome.packet.pictures[0].id).toBe('furnish-2-1');
    job = answer(pipeline, r.job, { picks: ['furnish-2-3'] });
    r = await run(pipeline, job, at);
    expect(r.outcome.kind).toBe('wait');
    // (the same pictures again: the cache answers, no new models)
    expect(meshed).toHaveLength(3);
    job = answer(pipeline, r.job, { approve: true });
    r = await run(pipeline, job, at);
    expect(r.outcome.kind).toBe('done');
    if (r.outcome.kind !== 'done') return;
    expect(r.outcome.result).toEqual({});
    expect(r.outcome.message).toContain('in environments/muse-test/ (home.json, assets/home/)');
  });

  it('the fork’s own hut loads the pieces from home.json: the kept ones, then the made ones', async () => {
    const root = repo(true);
    const pipeline = makeHomePipeline({ renderer: () => stubRenderer() });
    const base = fakeClients();
    const at = io(root, { ...base, segmenter: segmenter([]) });
    const r = await run(pipeline, record('room'), at);
    if (r.outcome.kind !== 'wait') throw new Error(r.outcome.kind);
    await run(pipeline, answer(pipeline, r.job, { picks: ['furnish-1-1'] }), at);
    const fork = join(root, 'environments', 'muse-test');
    const home = JSON.parse(readFileSync(join(fork, 'home.json'), 'utf8')) as Home;
    const hut = (await import(join(fork, 'life', 'hut.ts'))) as { PIECES: readonly { name: string; url: string; height: number }[] };
    expect(hut.PIECES.map((p) => p.name)).toEqual([...KEEP.filter((k) => ['wood-stove', 'display-cabinet', 'single-bed'].includes(k)).sort((a, b) => order(a) - order(b)), ...home.pieces.map((p) => p.name)]);
    for (const p of home.pieces) expect(hut.PIECES.find((q) => q.name === p.name)?.url).toMatch(new RegExp(`/assets/home/${p.file}$`));
  });

  it('with nothing found, makes one keepsake for the showpiece’s shelf', async () => {
    const root = repo(true);
    const pipeline = makeHomePipeline({ renderer: () => stubRenderer() });
    const at = io(root, { ...fakeClients(), segmenter: { find: () => Promise.resolve([]) } });
    let r = await run(pipeline, record('room'), at);
    if (r.outcome.kind !== 'wait') throw new Error(r.outcome.kind);
    r = await run(pipeline, answer(pipeline, r.job, { picks: ['furnish-1-2'] }), at);
    expect(r.stages).toEqual(['pieces', 'keepsake', 'mesh', 'place', 'show']);
    const home = JSON.parse(readFileSync(join(root, 'environments', 'muse-test', 'home.json'), 'utf8')) as Home;
    expect(home.pieces).toHaveLength(1);
    expect(home.pieces[0]).toMatchObject({ name: 'keepsake', rests: false });
    // on the showpiece: by the left wall, up on a shelf
    expect(home.pieces[0].place.x).toBeLessThan(-3.2);
    expect(home.pieces[0].lift).toBeGreaterThan(0.5);
  });

  it('with no planet yet, renders the meadow’s room and keeps the home in the job’s folder', async () => {
    const root = repo(false);
    const pages: string[] = [];
    const stub = stubRenderer();
    const pipeline = makeHomePipeline({ renderer: () => ({ ...stub, room: (req) => (pages.push(req.page), stub.room(req)) }) });
    const at = io(root, fakeClients());
    let r = await run(pipeline, record('room'), at);
    expect(pages).toEqual(['/']);
    if (r.outcome.kind !== 'wait') throw new Error(r.outcome.kind);
    r = await run(pipeline, answer(pipeline, r.job, { picks: ['furnish-1-1'] }), at);
    if (r.outcome.kind !== 'wait') throw new Error(r.outcome.kind);
    // the stock fake finds the same box for every thing: one piece
    expect(readdirSync(join(at.dir, 'home')).sort()).toEqual(['home-1-a-green-armchair-by-the-window.glb', 'home.json']);
    expect(r.outcome.packet.text).toContain('planet isn’t made yet');
    r = await run(pipeline, answer(pipeline, r.job, { approve: true }), at);
    if (r.outcome.kind !== 'done') throw new Error(r.outcome.kind);
    expect(r.outcome.message).toContain(`waits in ${relative(root, join(at.dir, 'home'))}/`);
  });

  it('asks for something to furnish with, and caps the drafts', async () => {
    const pipeline = makeHomePipeline({ renderer: () => stubRenderer() });
    const at = io(repo(false), fakeClients());
    const r = await pipeline.step(record('room', {}, { kind: 'home', text: ' ' }), at);
    expect(r.kind).toBe('failed');
    const last = pipeline.answer({ ...record('approve', { draft: 3 }), state: 'waiting' }, { notes: [{ text: 'more plants' }] });
    expect(last.ok).toBe(false);
  });

  it('turns a thing into a short phrase for the segmenter', () => {
    expect(nounPhrase('a green armchair by the window')).toBe('green armchair');
    expect(nounPhrase('A stack of books!')).toBe('stack of books');
    expect(nounPhrase('the old floor lamp with a fringed shade')).toBe('old floor lamp');
  });
});

/** The meadow's own order of the pieces it keeps (hut.ts PIECES). */
function order(name: string): number {
  return ['wood-stove', 'wall-shelf', 'dish-cabinet', 'display-shelf', 'display-cabinet', 'dining-table', 'single-bed', 'work-desk', 'woven-armchair'].indexOf(name);
}
