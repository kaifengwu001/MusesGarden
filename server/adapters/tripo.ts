// Tripo's image-to-model, for the body (API v3: https://developers.tripo3d.ai/en/docs). A body is made on P2, its
// Smart Mesh model, as quads at about 5000 polygons, textured, no PBR: what the rig is tuned for. Quad output comes
// back as FBX, so a convert task turns it into a GLB (format GLTF, its texture baked at 2K as the sculpts' are).
//   1. POST /files (multipart `file`)                          → file_token     free
//   2. POST /generation/image-to-model {input, model: P2, …}   → task_id        paid: the budget is spent just before
//   3. GET /tasks/<id> until success                           → output.model_url (FBX for quads)
//   4. POST /models/convert {input: task_id, format: GLTF}     → task_id        (quads only)
//   5. GET /tasks/<id> until success, then download            → the GLB
// Every picture is made once: the GLB is cached by the picture's sha256 (and the options), and the task ids are kept
// as soon as they exist, so a run that breaks after paying picks up its task instead of paying again.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TripoBudget } from '../workshop/budget';
import type { MeshOptions, Mesher } from '../workshop/clients';

export const TRIPO_API = 'https://openapi.tripo3d.ai/v3';
/** P2, the model with quad output (https://developers.tripo3d.ai/en/models/p2, read 2026-11-03). */
export const TRIPO_P2 = 'P2-20260801';

export interface TripoOptions {
  readonly apiKey: string;
  readonly budget: TripoBudget;
  /** Where made GLBs and the tasks behind them are kept. */
  readonly cacheDir: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  /** How often a task is asked after (ms) and how long it's waited for in all (ms). */
  readonly pollMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The converted GLB's texture, on a side (the sculpts carry 2K). */
  readonly textureSize?: number;
}

/** What's kept of one picture's run, so it's never paid for twice. */
interface Run {
  task?: string;
  convert?: string;
}

interface TaskOutput {
  readonly model_url?: string;
  readonly [key: string]: unknown;
}

const TERMINAL = new Set(['failed', 'cancelled', 'banned', 'expired']);

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/** The cache's key: the picture's sha256 and what was asked of it. */
export function runKey(image: Buffer, opts: MeshOptions): string {
  return `${TripoBudget.hash(image)}-${opts.quad ? 'quad' : 'tri'}${opts.faceLimit ?? 'auto'}${opts.seed === undefined ? '' : `-s${opts.seed}`}`;
}

export function createTripoMesher(o: TripoOptions): Mesher {
  const http = o.fetch ?? fetch;
  const api = (o.baseUrl ?? TRIPO_API).replace(/\/$/, '');
  const pollMs = o.pollMs ?? 5000;
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const sleep = o.sleep ?? wait;

  async function call<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const res = await http(`${api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${o.apiKey}`, ...(init.headers as Record<string, string> | undefined) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: { code?: number; message?: string; data?: T };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`Tripo ${path}: HTTP ${res.status}, ${text.slice(0, 120)}`);
    }
    if (!res.ok || body.code !== 0 || body.data === undefined) throw new Error(`Tripo ${path}: ${body.message ?? `HTTP ${res.status}`} (code ${body.code ?? '?'})`);
    return body.data;
  }

  const post = <T>(path: string, json: unknown, signal?: AbortSignal): Promise<T> =>
    call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) }, signal);

  async function upload(image: Buffer, signal?: AbortSignal): Promise<string> {
    const png = image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(image)], { type: png ? 'image/png' : 'image/jpeg' }), png ? 'concept.png' : 'concept.jpg');
    const data = await call<{ file_token?: string }>('/files', { method: 'POST', body: form }, signal);
    if (!data.file_token) throw new Error('Tripo /files gave no file_token');
    return data.file_token;
  }

  async function finished(task: string, signal?: AbortSignal): Promise<TaskOutput> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const t = await call<{ status?: string; output?: TaskOutput; error_message?: string; error_code?: number }>(`/tasks/${encodeURIComponent(task)}`, { method: 'GET' }, signal);
      if (t.status === 'success') return t.output ?? {};
      if (t.status && TERMINAL.has(t.status)) throw new Error(`Tripo's task ${task} ${t.status}: ${t.error_message ?? `error ${t.error_code ?? '?'}`}`);
      if (Date.now() >= until) throw new Error(`Tripo's task ${task} didn't finish in ${Math.round(timeoutMs / 60_000)} min (still ${t.status ?? 'unknown'}); it's kept, so trying again waits for it without paying again`);
      await sleep(pollMs, signal);
    }
  }

  return {
    async fromImage(image, opts, signal) {
      mkdirSync(o.cacheDir, { recursive: true });
      const key = runKey(image, opts);
      const glbFile = join(o.cacheDir, `${key}.glb`);
      if (existsSync(glbFile)) return readFileSync(glbFile);
      const runFile = join(o.cacheDir, `${key}.json`);
      const run: Run = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, 'utf8')) as Run) : {};
      const keep = (): void => writeFileSync(runFile, JSON.stringify(run, null, 2));

      if (!run.task) {
        const token = await upload(image, signal);
        o.budget.spend(image, opts.purpose);
        const created = await post<{ task_id?: string }>(
          '/generation/image-to-model',
          {
            input: token,
            model: TRIPO_P2,
            quad: opts.quad ?? false,
            ...(opts.faceLimit === undefined ? {} : { face_limit: opts.faceLimit }),
            ...(opts.seed === undefined ? {} : { model_seed: opts.seed }),
            texture: true,
            pbr: false,
          },
          signal,
        );
        if (!created.task_id) throw new Error('Tripo /generation/image-to-model gave no task_id');
        run.task = created.task_id;
        keep();
      }
      let url = (await finished(run.task, signal)).model_url;
      if (opts.quad) {
        if (!run.convert) {
          const converted = await post<{ task_id?: string }>('/models/convert', { input: run.task, format: 'GLTF', texture_size: o.textureSize ?? 2048 }, signal);
          if (!converted.task_id) throw new Error('Tripo /models/convert gave no task_id');
          run.convert = converted.task_id;
          keep();
        }
        url = (await finished(run.convert, signal)).model_url;
      }
      if (!url) throw new Error(`Tripo's task ${run.convert ?? run.task} finished with no model_url`);
      const res = await http(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Tripo's model couldn't be downloaded: HTTP ${res.status}`);
      const glb = Buffer.from(await res.arrayBuffer());
      if (glb.length < 12 || glb.readUInt32LE(0) !== 0x46546c67) {
        throw new Error(`Tripo's model isn't a GLB (it starts ${glb.subarray(0, 4).toString('hex')}); its tasks are kept in ${runFile}, so trying again pays nothing`);
      }
      writeFileSync(`${glbFile}.part`, glb);
      renameSync(`${glbFile}.part`, glbFile);
      return glb;
    },
  };
}

/** The mesher from the environment: TRIPO_API_KEY, its ledger and cache under `dataDir`; null without a key. */
export function tripoMesherFromEnv(dataDir: string, env: NodeJS.ProcessEnv = process.env): Mesher | null {
  if (!env.TRIPO_API_KEY) return null;
  return createTripoMesher({ apiKey: env.TRIPO_API_KEY, budget: new TripoBudget(join(dataDir, 'tripo', 'ledger.json')), cacheDir: join(dataDir, 'tripo', 'cache') });
}
