// Review stills of a made body in the lab (src/dev/museLab.html), headless, through muse-look's batch.mjs: idle,
// wave and pet, each from the front, at three-quarter and from the side. It needs the page's dev server, and the
// lab must load the look (served at /api/looks/<id>.glb).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const POSES = [
  ['idle', 2],
  ['wave', 1.2],
  ['pet', 2],
] as const;
export const VIEWS = ['front', 'persp:35', 'left'] as const;

export interface Still {
  readonly pose: string;
  readonly view: string;
  /** In `out`. */
  readonly file: string;
}

export interface RenderRequest {
  readonly look: string;
  /** Where the stills go. */
  readonly out: string;
  readonly devServer: string;
  readonly repo: string;
  readonly signal: AbortSignal;
}

export type Renderer = (req: RenderRequest) => Promise<{ readonly ok: true; readonly stills: readonly Still[] } | { readonly ok: false; readonly reason: string }>;

/** batch.mjs's file name for one still (`<model>-<pose>-<s>-<view without ':'>-<look>.png`). */
export function stillFile(look: string, pose: string, s: number, view: string): string {
  return `${look}-${pose}-${s}-${view.replace(':', '')}-muse.png`;
}

async function reachable(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

/** The lab's stills, from the dev server at req.devServer, or plainly why not. */
export const labRenderer: Renderer = async ({ look, out, devServer, repo, signal }) => {
  const base = devServer.replace(/\/$/, '');
  if (!(await reachable(`${base}/src/dev/museLab.html`, signal))) return { ok: false, reason: `the page's dev server isn't running at ${base}` };
  if (!(await reachable(`${base}/api/looks/${look}.glb`, signal))) return { ok: false, reason: `the dev server at ${base} doesn't serve /api/looks/${look}.glb` };
  const stills = POSES.flatMap(([pose, s]) => VIEWS.map((view) => ({ pose, view, s, file: stillFile(look, pose, s, view) })));
  const missing = stills.filter((st) => !existsSync(join(out, st.file)));
  if (missing.length) {
    const list = JSON.stringify(missing.map((st) => [look, st.pose, st.s, st.view, 'muse']));
    const script = join(repo, 'tools/workflows/muse-look/scripts/batch.mjs');
    const log = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const child = spawn(process.execPath, [script, out, list], { cwd: repo, env: { ...process.env, BASE: base }, signal, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d: Buffer) => (text += d.toString()));
      child.stderr.on('data', (d: Buffer) => (text += d.toString()));
      child.on('error', (e) => resolve({ code: -1, text: `${text}\n${e.message}` }));
      child.on('close', (code) => resolve({ code, text }));
    });
    const errors = /^ERRORS (.*)$/m.exec(log.text)?.[1];
    if (log.code !== 0 || errors) return { ok: false, reason: `the lab couldn't render it: ${(errors ?? log.text.trim().split('\n').pop() ?? `exit ${log.code}`).slice(0, 300)}` };
  }
  const made = stills.filter((st) => existsSync(join(out, st.file)));
  if (made.length < stills.length) return { ok: false, reason: `the lab rendered only ${made.length} of ${stills.length} stills` };
  return { ok: true, stills: made.map(({ pose, view, file }) => ({ pose, view, file })) };
};
