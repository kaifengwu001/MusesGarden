import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { DRESSED } from '../../../src/life/museMesh';
import type { Instant, MuseId } from '../../../src/muse/contract';
import { fakeClients, type Box, type Segmenter, type WorkshopClients } from '../clients';
import type { Brief, JobRecord, Pipeline, StageIO, StepOutcome, Verdict } from '../types';
import { createBodyPipeline, GEN_SCULPT, reserveLook, type BodyDeps } from '.';
import { cleanGlb, readGlb, tagged } from './glb';
import { comparePose, type Seen } from './pose';
import { conceptPrompt } from './prompt';
import type { Renderer } from './render';
import type { RigCheck } from './rig';

const BASE = readFileSync(fileURLToPath(new URL('./base.jpg', import.meta.url)));
const MUSE6 = readFileSync(fileURLToPath(new URL('../../../src/assets/muse/muses/muse6.glb', import.meta.url)));
const JOB = '0123456789abcdef0123456789abcdef';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function avatarUrl(): Promise<string> {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 140, g: 90, b: 50 } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** The stills a lab would render: copies of the base, named as batch.mjs names them. */
const stubRender: Renderer = async ({ look, out }) => {
  const stills = [];
  for (const pose of ['idle', 'wave', 'pet']) {
    for (const view of ['front', 'persp:35', 'left']) {
      const file = `${look}-${pose}-${view.replace(':', '')}.png`;
      writeFileSync(join(out, file), await sharp(BASE).resize(200).png().toBuffer());
      stills.push({ pose, view, file });
    }
  }
  return { ok: true, stills };
};

/** A body job run step by step as the runner would, with Muse's answers given by hand. */
async function harness(clients: WorkshopClients, deps: BodyDeps = {}, brief?: Partial<Brief>) {
  const root = mkdtempSync(join(tmpdir(), 'body-'));
  roots.push(root);
  const pipeline: Pipeline = createBodyPipeline({ render: stubRender, ...deps });
  const io: StageIO = {
    dir: join(root, 'workshop', JOB),
    url: (f) => `/w/${JOB}/${f}`,
    clients,
    log: () => undefined,
    signal: new AbortController().signal,
    repo: process.cwd(),
    devServer: 'http://localhost:1',
  };
  let job: JobRecord = {
    id: JOB,
    museId: 'pooh' as MuseId,
    kind: 'body',
    brief: { kind: 'body', text: 'A warm brown bear who loves naps', avatar: { image: await avatarUrl(), description: 'a brown painted bear' }, things: ['a green knitted scarf'], ...brief },
    state: 'working',
    stage: pipeline.firstStage,
    round: 0,
    data: {},
    packet: null,
    message: '',
    createdAt: 0 as Instant,
    updatedAt: 0 as Instant,
  };
  return {
    root,
    io,
    pipeline,
    get job() {
      return job;
    },
    /** Steps until a round is ready, the job is done or it failed. */
    async run(): Promise<StepOutcome> {
      for (;;) {
        const o = await pipeline.step(job, io);
        if (o.kind === 'continue') {
          job = { ...job, stage: o.stage, data: o.data };
          continue;
        }
        if (o.kind === 'wait') job = { ...job, stage: o.stage, data: o.data, state: 'waiting' };
        return o;
      }
    },
    /** One step only (to run a stage again). */
    step: () => pipeline.step(job, io),
    answer(v: Verdict) {
      const r = pipeline.answer(job, v);
      if (r.ok) job = { ...job, stage: r.stage, data: r.data, state: 'working' };
      return r;
    },
  };
}

/** Clients that count their calls. */
function counted(base: WorkshopClients) {
  const calls = { edit: 0, mesh: 0, find: 0 };
  const clients: WorkshopClients = {
    ...base,
    images: { ...base.images, edit: (req) => (calls.edit++, base.images.edit(req)) },
    mesher: { fromImage: (img, opts, signal) => (calls.mesh++, base.mesher.fromImage(img, opts, signal)) },
    segmenter: { find: (img, phrase, signal) => (calls.find++, base.segmenter.find(img, phrase, signal)) },
  };
  return { clients, calls };
}

/** A segmenter that sees what's drawn: the box round every pixel darker than near-white, and a face in its top middle. */
const inkSegmenter: Segmenter = {
  async find(image, phrase) {
    const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels] >= 235) continue;
        x1 = Math.min(x1, x);
        y1 = Math.min(y1, y);
        x2 = Math.max(x2, x);
        y2 = Math.max(y2, y);
      }
    }
    if (!Number.isFinite(x1)) return [];
    const plush: Box = [x1, y1, x2, y2];
    const w = x2 - x1;
    const h = y2 - y1;
    const face: Box = [x1 + 0.35 * w, y1 + 0.1 * h, x1 + 0.65 * w, y1 + 0.35 * h];
    return [{ box: phrase === 'face' ? face : plush, mask: null }];
  },
};

/** The base moved `dx` pixels to the right, the same size. */
async function shifted(dx: number): Promise<Buffer> {
  const meta = await sharp(BASE).metadata();
  const wider = await sharp(BASE).extend({ left: dx, background: { r: 255, g: 255, b: 255 } }).png().toBuffer();
  return sharp(wider).extract({ left: 0, top: 0, width: meta.width ?? 0, height: meta.height ?? 0 }).png().toBuffer();
}

describe('the body pipeline', () => {
  it('runs a whole job under the fakes: concepts, a refinement, the 3D body rigged (muse6), renders, approval', async () => {
    const { clients, calls } = counted(fakeClients());
    const h = await harness(clients);

    const first = await h.run();
    expect(first.kind).toBe('wait');
    if (first.kind !== 'wait') return;
    expect(first.stage).toBe('pick');
    expect(first.packet.ask).toBe('pick');
    expect(first.packet.pick).toEqual({ min: 1, max: 1 });
    expect(first.packet.pictures.map((p) => p.id)).toEqual(['c1-1', 'c1-2', 'c1-3', 'c1-4']);
    expect(first.packet.pictures[0].path).toBe(`/w/${JOB}/concept-1-1-1.png`);
    expect(first.packet.checklist?.every((c) => c.ok)).toBe(true);
    expect(calls.edit).toBe(1);
    // (each concept is the base's exact size, and there's a contact sheet)
    const meta = await sharp(join(h.io.dir, 'concept-1-1-1.png')).metadata();
    expect([meta.width, meta.height]).toEqual([1186, 1326]);
    expect(existsSync(join(h.io.dir, 'concepts-1.jpg'))).toBe(true);
    // (no judge answer in the fakes: the prompt follows the brief, with the scarf Muse asked for)
    expect(readFileSync(join(h.io.dir, 'prompt-1.txt'), 'utf8')).toContain('a green knitted scarf');

    expect(h.answer({ picks: ['c1-2'], notes: [{ text: 'a red scarf instead', at: [500, 520] }] })).toMatchObject({ ok: true, stage: 'refine' });
    const second = await h.run();
    if (second.kind !== 'wait') throw new Error(`expected a pick, got ${second.kind}`);
    expect(second.packet.pictures.map((p) => p.id)).toEqual(['c1-2r', 'c1-2']);
    expect(h.answer({ picks: ['c1-2'], notes: [{ text: 'again' }] })).toMatchObject({ ok: false });

    expect(h.answer({ picks: ['c1-2r'] })).toMatchObject({ ok: true, stage: 'mesh' });
    const third = await h.run();
    if (third.kind !== 'wait') throw new Error(`expected the approval, got ${third.kind}: ${third.kind === 'failed' ? third.message : ''}`);
    expect(third.stage).toBe('approve');
    expect(third.packet.ask).toBe('approve');
    expect(third.packet.pictures.length).toBe(11);
    expect(third.packet.checklist?.every((c) => c.ok)).toBe(true);
    expect(calls.mesh).toBe(1);

    const looks = join(h.root, 'workshop', 'looks');
    expect(readdirSync(looks).sort()).toEqual(['gen-pooh-1.glb', 'gen-pooh-1.jpg', 'gen-pooh-1.json']);
    expect(readFileSync(join(looks, 'gen-pooh-1.json'), 'utf8').trim()).toBe('{}');
    expect(tagged(readFileSync(join(looks, 'gen-pooh-1.glb')))).toBe(false);
    expect(await sharp(join(looks, 'gen-pooh-1.jpg')).metadata()).toMatchObject({ width: 512, height: 512 });

    expect(h.answer({ approve: true })).toMatchObject({ ok: true, stage: 'finish' });
    const done = await h.run();
    expect(done).toMatchObject({ kind: 'done', result: { look: 'gen-pooh-1' } });
  }, 120_000);

  it('runs each stage again without redoing its work', async () => {
    const { clients, calls } = counted(fakeClients());
    let rigs = 0;
    const rig: RigCheck = () => (rigs++, Promise.resolve({ ok: true, report: { ms: 1, made: { vertices: 1, triangles: 1 }, vertices: 1, triangles: 1, cloth: 0, top: 1, face: { eye: [0.1, 0.77, 0.03], mouth: [0, 0.7, 0.03, 0], blush: [0.1, 0.72, 0.02], plate: [0.75, 0.15, 0.1, 0.2] } } }));
    const h = await harness(clients, { rig });

    const a = await h.step();
    const b = await h.step();
    expect(b).toEqual(a);
    expect(await h.run()).toEqual(a);
    expect(calls.edit).toBe(1);

    h.answer({ picks: ['c1-3'], notes: [{ text: 'rounder ears' }] });
    const r1 = await h.step();
    const r2 = await h.step();
    expect(r2).toEqual(r1);
    expect(await h.run()).toEqual(r1);
    expect(calls.edit).toBe(2);

    h.answer({ picks: ['c1-3'] });
    const m1 = await h.step();
    const m2 = await h.step();
    expect(m2).toEqual(m1);
    expect(m1).toMatchObject({ kind: 'continue', stage: 'rig', data: { look: 'gen-pooh-1' } });
    expect(calls.mesh).toBe(1);

    if (m1.kind !== 'continue') return;
    const atRig = { ...h.job, stage: 'rig', data: m1.data };
    const g1 = await h.pipeline.step(atRig, h.io);
    const g2 = await h.pipeline.step(atRig, h.io);
    expect(g2).toEqual(g1);
    expect(rigs).toBe(1);

    if (g1.kind !== 'continue') throw new Error('expected the renders next');
    const atRenders = { ...h.job, stage: 'renders', data: g1.data };
    expect(await h.pipeline.step(atRenders, h.io)).toEqual(await h.pipeline.step(atRenders, h.io));
  }, 60_000);

  it('turns away concepts that lose the pose, and keeps those that hold it on a later try', async () => {
    const moved = await shifted(120);
    let edits = 0;
    const base = fakeClients();
    const clients: WorkshopClients = {
      ...base,
      segmenter: inkSegmenter,
      // (the first edit moves every concept off the base's place; the next keeps it)
      images: { ...base.images, edit: ({ n, images }) => Promise.resolve(Array.from({ length: n }, () => (edits++ < 4 ? moved : images[0]))) },
    };
    const h = await harness(clients);
    const o = await h.run();
    if (o.kind !== 'wait') throw new Error(`expected a pick, got ${o.kind}`);
    expect(o.packet.pictures.map((p) => p.path)).toEqual([1, 2, 3, 4].map((s) => `/w/${JOB}/concept-1-${s}-2.png`));
    const turned = JSON.parse(readFileSync(join(h.io.dir, 'concept-1-1-1.png.check.json'), 'utf8')) as { check: { ok: boolean; reasons: string[] } };
    expect(turned.check.ok).toBe(false);
    expect(turned.check.reasons.join(' ')).toMatch(/arm's tip moved/);
  }, 60_000);

  it('fails plainly when no concept keeps the pose in three tries', async () => {
    const moved = await shifted(120);
    const base = fakeClients();
    let edits = 0;
    const clients: WorkshopClients = {
      ...base,
      segmenter: inkSegmenter,
      images: { ...base.images, edit: ({ n }) => (edits++, Promise.resolve(Array.from({ length: n }, () => moved))) },
    };
    const h = await harness(clients);
    const o = await h.run();
    expect(o.kind).toBe('failed');
    if (o.kind === 'failed') expect(o.message).toMatch(/None of the 4 concepts kept the base Muse's pose after 3 tries/);
    expect(edits).toBe(3);
  }, 60_000);

  it("rejects a concept whose box moved, by the fake segmenter's word", async () => {
    const base = fakeClients();
    const segmenter: Segmenter = {
      // (the base where it is; anything else moved 10% to the right)
      find: (image) => Promise.resolve([{ box: (image.equals(BASE) ? [200, 200, 800, 800] : [320, 200, 920, 800]), mask: null }]),
    };
    const h = await harness({ ...base, segmenter });
    const o = await h.run();
    expect(o.kind).toBe('failed');
  }, 60_000);

  it('sends Muse back to pick another when a made body won\'t rig', async () => {
    const rig: RigCheck = () => Promise.resolve({ ok: false, error: "its face wasn't found" });
    const h = await harness(fakeClients(), { rig });
    await h.run();
    h.answer({ picks: ['c1-1'] });
    const o = await h.run();
    if (o.kind !== 'wait') throw new Error(`expected a pick, got ${o.kind}`);
    expect(o.packet.pictures.map((p) => p.id)).toEqual(['c1-2', 'c1-3', 'c1-4']);
    expect(o.packet.text).toMatch(/couldn't be used: its face wasn't found/);
    expect(h.answer({ picks: ['c1-1'] })).toMatchObject({ ok: false });
    h.answer({ picks: ['c1-4'] });
    const again = await h.run();
    if (again.kind !== 'wait') throw new Error('expected a pick');
    // (each made body takes the next id)
    expect(readdirSync(join(h.root, 'workshop', 'looks')).filter((f) => f.endsWith('.glb')).sort()).toEqual(['gen-pooh-1.glb', 'gen-pooh-2.glb']);
  }, 60_000);

  it('shows the concept when the lab can\'t render, and notes on a body start a new round', async () => {
    const render: Renderer = () => Promise.resolve({ ok: false, reason: "the page's dev server isn't running" });
    const rig: RigCheck = () => Promise.resolve({ ok: true, report: { ms: 1, made: { vertices: 1, triangles: 1 }, vertices: 1, triangles: 1, cloth: 0, top: 1, face: { eye: [0.1, 0.77, 0.03], mouth: [0, 0.7, 0.03, 0], blush: [0.1, 0.72, 0.02], plate: [0.75, 0.15, 0.1, 0.2] } } });
    const h = await harness(fakeClients(), { render, rig });
    await h.run();
    h.answer({ picks: ['c1-1'] });
    const o = await h.run();
    if (o.kind !== 'wait') throw new Error('expected the approval');
    expect(o.packet.pictures.map((p) => p.id)).toEqual(['c1-1']);
    expect(o.packet.checklist?.find((c) => !c.ok)?.note).toMatch(/dev server/);
    expect(h.answer({})).toMatchObject({ ok: false });
    expect(h.answer({ notes: [{ text: 'longer ears' }] })).toMatchObject({ ok: true, stage: 'concepts', data: { attempt: 2, notes: ['longer ears'] } });
    const next = await h.run();
    if (next.kind !== 'wait') throw new Error('expected a pick');
    expect(next.packet.pictures.map((p) => p.id)).toEqual(['c2-1', 'c2-2', 'c2-3', 'c2-4']);
    expect(readFileSync(join(h.io.dir, 'prompt-2.txt'), 'utf8')).toContain('longer ears');
  }, 60_000);

  it('checks answers plainly', async () => {
    const h = await harness(fakeClients());
    await h.run();
    expect(h.answer({ picks: ['c9-9'] })).toMatchObject({ ok: false });
    expect(h.answer({ picks: ['c1-1', 'c1-2'] })).toMatchObject({ ok: false });
    expect(h.answer({})).toMatchObject({ ok: false });
    expect(h.answer({ picks: ['c1-1'], notes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] })).toMatchObject({ ok: false });
    expect(h.answer({ notes: [{ text: 'brighter fur' }] })).toMatchObject({ ok: true, stage: 'concepts' });
  }, 60_000);

  it('uses the design the judge reads off the avatar', async () => {
    const design = { fur: 'warm chestnut brown with visible brushstrokes, a beige belly', ears: 'two small round bear ears', garment: 'a green knitted scarf', things: ['a tiny pillow'] };
    const h = await harness(fakeClients({ judged: { 'body-design': design } }));
    await h.run();
    const prompt = readFileSync(join(h.io.dir, 'prompt-1.txt'), 'utf8');
    expect(prompt).toContain('two small round bear ears');
    expect(prompt).toContain('a tiny pillow');
    expect(prompt).toContain('The second picture is');
  }, 60_000);
});

describe('the pose check', () => {
  const W = 100;
  const H = 100;
  const square = (x1: number, y1: number, x2: number, y2: number): Uint8Array => {
    const m = new Uint8Array(W * H);
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) m[y * W + x] = 1;
    return m;
  };
  const seen = (mask: Uint8Array | null, plush: Box, face: Box | null = [40, 20, 60, 40]): Seen => ({ width: W, height: H, plush, mask, face });

  it('passes the base against itself, with masks or boxes', () => {
    expect(comparePose(seen(square(10, 10, 90, 90), [10, 10, 90, 90]), seen(square(10, 10, 90, 90), [10, 10, 90, 90]))).toMatchObject({ ok: true, cover: 1 });
    expect(comparePose(seen(null, [10, 10, 90, 90]), seen(null, [10, 10, 90, 90]))).toMatchObject({ ok: true, cover: null });
  });

  it('allows ears above the head, but not arms moved or a body shrunk', () => {
    const b = seen(square(10, 20, 90, 90), [10, 20, 90, 90]);
    expect(comparePose(b, seen(square(10, 10, 90, 90), [10, 10, 90, 90])).ok).toBe(true);
    expect(comparePose(b, seen(square(15, 20, 90, 90), [15, 20, 90, 90])).reasons.join()).toMatch(/right arm/);
    const thin = square(10, 20, 90, 90);
    for (let y = 20; y <= 90; y++) for (let x = 30; x <= 70; x++) thin[y * W + x] = 0;
    expect(comparePose(b, seen(thin, [10, 20, 90, 90])).reasons.join()).toMatch(/covers only/);
  });

  it('holds the face plate to its place', () => {
    const b = seen(null, [10, 10, 90, 90]);
    expect(comparePose(b, seen(null, [10, 10, 90, 90], [45, 20, 65, 40])).reasons.join()).toMatch(/face plate moved/);
    expect(comparePose(b, seen(null, [10, 10, 90, 90], null)).reasons.join()).toMatch(/face plate was not found/);
  });
});

describe('the made body', () => {
  it('is rigged with muse-rig’s starting entry (DRESSED.muse3’s)', () => {
    expect(GEN_SCULPT).toEqual(DRESSED.muse3);
  });

  it('loses its maker’s tag and keeps its mesh', () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0', generator: 'tripo' }, nodes: [{ name: 'tripo_node_1' }], meshes: [{ name: 'tripo_mesh', primitives: [] }], materials: [{ name: 'tripo_mat' }], images: [{ name: 'other' }] }));
    const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const bin = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const glb = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
    glb.writeUInt32LE(0x46546c67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(glb, 20);
    glb.writeUInt32LE(bin.length, 20 + padded.length);
    glb.writeUInt32LE(0x004e4942, 24 + padded.length);
    bin.copy(glb, 28 + padded.length);
    expect(tagged(glb)).toBe(true);
    const clean = cleanGlb(glb);
    expect(tagged(clean)).toBe(false);
    const out = JSON.parse(clean.subarray(20, 20 + clean.readUInt32LE(12)).toString()) as { asset: object; nodes: { name: string }[]; meshes: { name: string }[]; materials: { name: string }[]; images: { name: string }[] };
    expect(out.asset).toEqual({ version: '2.0' });
    expect([out.nodes[0].name, out.meshes[0].name, out.materials[0].name, out.images[0].name]).toEqual(['model_node_1', 'model_mesh', 'model_mat', 'other']);
    expect(clean.subarray(clean.length - 8)).toEqual(bin);
    expect(clean.readUInt32LE(8)).toBe(clean.length);
  });

  it('reads muse6 as the loader does', () => {
    const m = readGlb(MUSE6);
    expect(m.position.length % 3).toBe(0);
    expect(m.normal.length).toBe(m.position.length);
    expect(m.uv.length / 2).toBe(m.position.length / 3);
    expect(m.index.length % 3).toBe(0);
    expect(m.paint?.length).toBeGreaterThan(1000);
  });

  it('takes the next free id per Muse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looks-'));
    roots.push(dir);
    expect(reserveLook(dir, 'pooh')).toBe('gen-pooh-1');
    expect(reserveLook(dir, 'pooh')).toBe('gen-pooh-2');
    writeFileSync(join(dir, 'gen-pooh-7.glb'), '');
    expect(reserveLook(dir, 'pooh')).toBe('gen-pooh-8');
    expect(reserveLook(dir, 'Momo Bear')).toBe('gen-momo-bear-1');
  });
});

describe('the prompt', () => {
  it('pins the pose and face and changes only fur, ears, garment and things', () => {
    const p = conceptPrompt({ fur: 'chestnut', ears: 'round ears', garment: 'a scarf', things: ['a pillow'] }, true, []);
    expect(p).toMatch(/same pose/);
    expect(p).toMatch(/face plate/);
    expect(p).toMatch(/white background/);
    expect(p).toMatch(/its fur: chestnut/);
  });
});
