import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TripoBudget, type SpendRecord } from '../workshop/budget';
import { createTripoMesher, runKey, TRIPO_P2 } from './tripo';

const GLB = readFileSync(fileURLToPath(new URL('../../src/assets/muse/muses/muse6.glb', import.meta.url)));
const PICTURE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('a concept')]);
const OPTS = { quad: true, faceLimit: 5000, purpose: 'body for pooh (gen-pooh-1)' } as const;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

interface Call {
  readonly method: string;
  readonly url: string;
  readonly json?: Record<string, unknown>;
  readonly form?: boolean;
  readonly auth?: string;
}

/** A Tripo that answers each request from a script, in order, and records what it was sent. */
function scripted(replies: readonly (Record<string, unknown> | Buffer)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fake: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body;
    calls.push({
      method: init?.method ?? 'GET',
      url,
      json: typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : undefined,
      form: body instanceof FormData,
      auth: headers.Authorization,
    });
    const reply = replies[i++];
    if (!reply) return Promise.reject(new Error(`unexpected request ${url}`));
    if (Buffer.isBuffer(reply)) return Promise.resolve(new Response(new Uint8Array(reply)));
    return Promise.resolve(new Response(JSON.stringify(reply), { headers: { 'Content-Type': 'application/json' } }));
  };
  return { fake, calls };
}

function setup(live = true) {
  const root = mkdtempSync(join(tmpdir(), 'tripo-'));
  roots.push(root);
  const ledger = join(root, 'ledger.json');
  const budget = new TripoBudget(ledger, 1, live);
  const spent = (): SpendRecord[] => (existsSync(ledger) ? (JSON.parse(readFileSync(ledger, 'utf8')) as SpendRecord[]) : []);
  return { root, budget, spent, cacheDir: join(root, 'cache') };
}

const ok = (data: unknown) => ({ code: 0, data });
const API = 'https://openapi.tripo3d.ai/v3';

describe('the Tripo mesher', () => {
  it('uploads, makes a P2 quad body of 5000 polygons, converts it to a GLB and downloads it, paying once', async () => {
    const s = setup();
    const { fake, calls } = scripted([
      ok({ file_token: 'file_1' }),
      ok({ task_id: 'task-1' }),
      ok({ task_id: 'task-1', status: 'queued', progress: 0 }),
      ok({ task_id: 'task-1', status: 'running', progress: 50 }),
      ok({ task_id: 'task-1', status: 'success', progress: 100, output: { model_url: 'https://cdn.example/model.fbx' } }),
      ok({ task_id: 'task-2' }),
      ok({ task_id: 'task-2', status: 'success', output: { model_url: 'https://cdn.example/model.glb' } }),
      GLB,
    ]);
    const mesher = createTripoMesher({ apiKey: 'tsk_test', budget: s.budget, cacheDir: s.cacheDir, fetch: fake, sleep: () => Promise.resolve() });
    const out = await mesher.fromImage(PICTURE, OPTS);
    expect(out.equals(GLB)).toBe(true);

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/files`,
      `POST ${API}/generation/image-to-model`,
      `GET ${API}/tasks/task-1`,
      `GET ${API}/tasks/task-1`,
      `GET ${API}/tasks/task-1`,
      `POST ${API}/models/convert`,
      `GET ${API}/tasks/task-2`,
      'GET https://cdn.example/model.glb',
    ]);
    expect(calls[0].form).toBe(true);
    expect(calls.slice(0, 7).every((c) => c.auth === 'Bearer tsk_test')).toBe(true);
    expect(calls[7].auth).toBeUndefined();
    expect(calls[1].json).toEqual({ input: 'file_1', model: TRIPO_P2, quad: true, face_limit: 5000, texture: true, pbr: false });
    expect(calls[5].json).toEqual({ input: 'task-1', format: 'GLTF', texture_size: 2048 });
    expect(s.spent()).toEqual([expect.objectContaining({ hash: TripoBudget.hash(PICTURE), purpose: OPTS.purpose })]);

    // (the same picture again: from the cache, nothing asked of Tripo, nothing paid)
    const again = await mesher.fromImage(PICTURE, OPTS);
    expect(again.equals(GLB)).toBe(true);
    expect(calls.length).toBe(8);
    expect(s.spent().length).toBe(1);
  });

  it('picks up a task already paid for instead of paying again', async () => {
    const s = setup();
    const { fake, calls } = scripted([
      ok({ task_id: 'task-1', status: 'success', output: { model_url: 'https://cdn.example/model.fbx' } }),
      ok({ task_id: 'task-2' }),
      ok({ task_id: 'task-2', status: 'success', output: { model_url: 'https://cdn.example/model.glb' } }),
      GLB,
    ]);
    const mesher = createTripoMesher({ apiKey: 'k', budget: s.budget, cacheDir: s.cacheDir, fetch: fake, sleep: () => Promise.resolve() });
    mkdirSync(s.cacheDir, { recursive: true });
    writeFileSync(join(s.cacheDir, `${runKey(PICTURE, OPTS)}.json`), JSON.stringify({ task: 'task-1' }));
    await mesher.fromImage(PICTURE, OPTS);
    expect(calls.map((c) => c.url)).toEqual([`${API}/tasks/task-1`, `${API}/models/convert`, `${API}/tasks/task-2`, 'https://cdn.example/model.glb']);
    expect(s.spent()).toEqual([]);
  });

  it('makes a triangle body as a GLB without converting it', async () => {
    const s = setup();
    const { fake, calls } = scripted([
      ok({ file_token: 'file_1' }),
      ok({ task_id: 'task-1' }),
      ok({ task_id: 'task-1', status: 'success', output: { model_url: 'https://cdn.example/model.glb' } }),
      GLB,
    ]);
    const mesher = createTripoMesher({ apiKey: 'k', budget: s.budget, cacheDir: s.cacheDir, fetch: fake, sleep: () => Promise.resolve() });
    await mesher.fromImage(PICTURE, { purpose: 'a test', seed: 7 });
    expect(calls[1].json).toEqual({ input: 'file_1', model: TRIPO_P2, quad: false, model_seed: 7, texture: true, pbr: false });
    expect(calls.length).toBe(4);
  });

  it('pays nothing while Tripo is off', async () => {
    const s = setup(false);
    const { fake, calls } = scripted([ok({ file_token: 'file_1' })]);
    const mesher = createTripoMesher({ apiKey: 'k', budget: s.budget, cacheDir: s.cacheDir, fetch: fake, sleep: () => Promise.resolve() });
    await expect(mesher.fromImage(PICTURE, OPTS)).rejects.toThrow(/Tripo is off/);
    expect(calls.map((c) => c.url)).toEqual([`${API}/files`]);
    expect(s.spent()).toEqual([]);
  });

  it('says plainly when a task fails or the API refuses', async () => {
    const s = setup();
    const { fake } = scripted([ok({ file_token: 'f' }), ok({ task_id: 't' }), ok({ task_id: 't', status: 'failed', error_code: 2010, error_message: 'image not supported' })]);
    const mesher = createTripoMesher({ apiKey: 'k', budget: s.budget, cacheDir: s.cacheDir, fetch: fake, sleep: () => Promise.resolve() });
    await expect(mesher.fromImage(PICTURE, OPTS)).rejects.toThrow(/task t failed: image not supported/);

    const s2 = setup();
    const refused = scripted([{ code: 1002, message: 'Authentication failed' }]);
    const m2 = createTripoMesher({ apiKey: 'bad', budget: s2.budget, cacheDir: s2.cacheDir, fetch: refused.fake, sleep: () => Promise.resolve() });
    await expect(m2.fromImage(PICTURE, OPTS)).rejects.toThrow(/Authentication failed \(code 1002\)/);
  });

  it("refuses a download that isn't a GLB, keeping its tasks", async () => {
    const s = setup();
    const { fake } = scripted([
      ok({ file_token: 'f' }),
      ok({ task_id: 't1' }),
      ok({ task_id: 't1', status: 'success', output: { model_url: 'https://cdn.example/a.fbx' } }),
      ok({ task_id: 't2' }),
      ok({ task_id: 't2', status: 'success', output: { model_url: 'https://cdn.example/a.zip' } }),
      Buffer.from('PK\u0003\u0004zip'),
    ]);
    const mesher = createTripoMesher({ apiKey: 'k', budget: s.budget, cacheDir: s.cacheDir, fetch: fake, sleep: () => Promise.resolve() });
    await expect(mesher.fromImage(PICTURE, OPTS)).rejects.toThrow(/isn't a GLB/);
    expect(JSON.parse(readFileSync(join(s.cacheDir, `${runKey(PICTURE, OPTS)}.json`), 'utf8'))).toEqual({ task: 't1', convert: 't2' });
  });
});
