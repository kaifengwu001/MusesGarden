// Muse Code, Meta's coding agent, as the planet's builder: it answers Muse's notes on a draft by editing the planet's
// own folder, headless:
//   muse exec --api-key-stdin --model muse-spark-1.3 --reasoning-effort low --workspace <folder> --prompt-file <file> --json
// A headless workspace is untrusted, so Muse Code doesn't read the folder's AGENTS.md: every instruction goes in the
// prompt file, and AGENTS.md is written beside the planet only for the record. Its sandbox writes only inside that
// folder; around a run, what changed outside it is noted (never undone: it is someone else's) and the fork is
// type-checked.
import { execFile, spawn, type ExecFileException } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Builder } from '../clients';

/** How long Muse Code may work on one round of notes. */
export const BUILDER_TIMEOUT_MS = 40 * 60_000;
/** The most a run's log keeps (its tail). */
const MAX_LOG = 200_000;

function run(bin: string, args: readonly string[], opts: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ ok: boolean; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 32 << 20, env: opts.env ?? process.env }, (err: ExecFileException | null, stdout, stderr) => {
      const out = `${stdout}${stderr ? `\n${stderr}` : ''}`;
      resolve({ ok: !err, out: err && !out.trim() ? err.message : out, missing: err?.code === 'ENOENT' });
    });
  });
}

/** Runs a command with `input` on its stdin, killed at `timeoutMs`: its exit, whether it timed out, and its output's tail. */
function runWithInput(bin: string, args: readonly string[], input: string, opts: { cwd: string; timeoutMs: number }): Promise<{ code: number | null; timedOut: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const keep = (chunk: Buffer): void => {
      out += chunk.toString('utf8');
      if (out.length > MAX_LOG * 2) out = out.slice(-MAX_LOG);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, opts.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut, out: `${out}\n${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, out: out.slice(-MAX_LOG) });
    });
    child.stdin.end(input);
  });
}

export interface MuseCodeOptions {
  /** The command: this, else env MUSE_CODE_BIN, else `muse` on PATH, else ~/.local/bin/muse. */
  readonly bin?: string;
  /** The provider key, read on stdin: env MODEL_API_KEY by default. */
  readonly apiKey?: () => string;
  readonly model?: string;
  readonly effort?: string;
}

/** The real builder: Muse Code headless, rooted at the planet's folder. Available when it's installed and a key is set. */
export function museCodeBuilder(opts: MuseCodeOptions = {}): Builder {
  const key = opts.apiKey ?? ((): string => process.env.MODEL_API_KEY ?? '');
  let found: Promise<string | null> | null = null;
  const bin = (): Promise<string | null> =>
    (found ??= (async () => {
      const named = opts.bin ?? process.env.MUSE_CODE_BIN;
      const candidates = named ? [named] : ['muse', join(homedir(), '.local/bin/muse')];
      for (const b of candidates) {
        const r = await run(b, ['--version'], { timeoutMs: 10_000 });
        if (r.ok) return b;
      }
      return null;
    })());
  return {
    async available() {
      return (await bin()) !== null && key() !== '';
    },
    async run({ workspace, instructions, prompt, timeoutMs }) {
      const muse = await bin();
      if (!muse) return { ok: false, log: 'Muse Code (muse) isn’t installed here' };
      if (!key()) return { ok: false, log: 'MODEL_API_KEY isn’t set, so Muse Code has no key' };
      writeFileSync(join(workspace, 'AGENTS.md'), instructions);
      const dir = mkdtempSync(join(tmpdir(), 'planet-builder-'));
      const file = join(dir, 'prompt.md');
      writeFileSync(file, `${instructions}\n## What to do now\n\n${prompt}\n`);
      try {
        const args = ['exec', '--api-key-stdin', '--model', opts.model ?? 'muse-spark-1.3', '--reasoning-effort', opts.effort ?? 'low', '--workspace', workspace, '--prompt-file', file, '--json'];
        const r = await runWithInput(muse, args, key(), { cwd: workspace, timeoutMs });
        const head = r.timedOut ? `stopped after ${Math.round(timeoutMs / 60_000)} min\n` : r.code === 0 ? '' : `exited with ${String(r.code)}\n`;
        return { ok: r.code === 0 && !r.timedOut, log: `${head}${r.out}` };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** What a planet's builder is told (its prompt, and AGENTS.md for the record): the contract, Muse's notes, the rules. */
export function agentsMd(opts: { readonly title: string; readonly contract: string; readonly notes: readonly string[]; readonly draft: number }): string {
  return `# ${opts.title}: notes on draft ${opts.draft}

This folder is one planet of Muse's Garden: a tiny round world drawn with three.js, forked from the meadow
(the main world, in ../../src/). A Muse (a plush creature who lives in the game) asked for it in its own
words and approved the visual contract below. Answer the Muse's notes on draft ${opts.draft} by editing this
planet, then stop. A small change that plainly answers the notes beats a big one that might break the world.

## The rules

- **Edit only files in this folder.** Never touch ../../src/ or anything else outside it. When a shared file
  must differ here, copy it into this folder at the same relative path and repoint this planet's import to
  the copy.
- Don't install packages, start servers or commit. Don't delete the folder's tests.
- Keep it working: the page must still load without errors, and \`npx tsc -p tsconfig.json\` run in this
  folder must report no new errors. (It already reports six of its own in main.ts and ui/garden/gardenUi.ts
  before you start; leave those.)
- The look: whimsical, cute and beautiful, with plausible materials (rock reads as fractured mineral, sand
  as granular, wood as fibrous, leaves as thin and living). Bold colour is welcome; muddled materials are not.
  No uniform clay or candy look, no eerie or bodily shapes, no generic noise: shape fields into structures.
- Sizes are meters, and everything stays with the planet as it turns.
- **End your last message with one line that starts \`For the Muse:\`** and says, in two or three plain
  sentences with no file or code names, what you changed and where on the planet to see it (say where it is
  from the cottage). The Muse reads it beside the next draft's pictures.

## Where things are

- recipe.json: this planet's palette rows (by name, column by column) and setting defaults, laid over
  render/palette.ts and params.ts by recipe.ts at load. Colours and settings change here first.
- render/palette.ts: every colour of the world, as rows of a 16 × 16 palette (the comments say what each
  column is). params.ts: every setting, its default and its range.
- planet/fields.ts with planet/fields.glsl and planet/bake.frag.glsl: the land's recipe (relief, wetness,
  height, patterns, where plants grow). The CPU (.ts) and GPU (.glsl) copies must agree exactly.
- planet/terrain.ts (generateLayout) and planet/terrain.glsl: the layout from the seed, the home's clearing,
  its pond. The water table is at height 0 everywhere (planet/water.glsl paints it as a mirror of the sky).
- planet/meadow.glsl: the painted ground. life/grass.ts: the grass blades. life/flowers.ts and
  life/flowerMeshes.ts: the four flower species (four at most: one channel each).
- life/props.ts: the home (a cottage with a terrace and a pier); its sizes are also in planet/terrain.glsl,
  planet/water.glsl and life/muse.ts, and must change together. render/sky.ts: the sky and clouds' colour.

## What the planet must be (the visual contract the Muse approved)

${opts.contract}

## The Muse's notes on draft ${opts.draft}

${opts.notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}
`;
}

/**
 * What the builder said for the Muse at the end of its run (its last "For the Muse:" line), in plain words and at
 * most 600 characters; null if it said nothing. The log is its JSON events, one a line.
 */
export function museSummary(log: string): string | null {
  let said: string | null = null;
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      const at = v.lastIndexOf('For the Muse:');
      if (at >= 0) said = v.slice(at + 'For the Muse:'.length);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  for (const line of log.split('\n')) {
    if (!line.includes('For the Muse:')) continue;
    try {
      visit(JSON.parse(line));
    } catch {
      visit(line);
    }
  }
  if (said === null) return null;
  const plain = (said as string).split(/\n\s*\n/)[0].replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  return plain.length > 600 ? `${plain.slice(0, 597).replace(/\s+\S*$/, '')}…` : plain;
}

/** A tsconfig for checking one fork on its own (the root's options, this folder only). */
export const FORK_TSCONFIG = `${JSON.stringify(
  {
    extends: '../../tsconfig.json',
    include: ['./**/*.ts'],
    exclude: ['./**/*.spec.ts', './vite.config.ts'],
  },
  null,
  2,
)}\n`;

export interface TypeCheck {
  /** Each error once, without its line and column (edits move them): "file: error TSxxxx: message". */
  readonly errors: readonly string[];
  readonly log: string;
}

/**
 * Type-checks a fork with the repo's tsc (a few seconds). A fork of today's meadow already has errors of its own (the
 * scaffold's module list lags the meadow), so a builder's run is judged by the errors it adds (newErrors).
 */
export async function typecheckFork(repo: string, dir: string): Promise<TypeCheck> {
  const config = join(dir, 'tsconfig.json');
  if (!existsSync(config)) writeFileSync(config, FORK_TSCONFIG);
  const tsc = join(repo, 'node_modules/.bin/tsc');
  const r = await run(tsc, ['-p', config, '--noEmit', '--pretty', 'false'], { cwd: repo, timeoutMs: 5 * 60_000 });
  if (r.missing) throw new Error(`no tsc at ${tsc}`);
  const errors = [...new Set(r.out.split('\n').flatMap((line) => {
    const m = /^(.+?)\(\d+,\d+\): (error TS\d+: .*)$/.exec(line.trim());
    return m ? [`${m[1]}: ${m[2]}`] : [];
  }))];
  if (!r.ok && errors.length === 0) errors.push(`tsc failed: ${r.out.trim().split('\n')[0] ?? ''}`);
  return { errors, log: r.out.trim().split('\n').slice(0, 40).join('\n') };
}

/** The errors in `after` that `before` didn't have. */
export function newErrors(before: TypeCheck, after: TypeCheck): string[] {
  const had = new Set(before.errors);
  return after.errors.filter((e) => !had.has(e));
}

/** What git sees as changed outside ignored paths: each path with its status and the hash of its contents. */
export async function changesOutside(repo: string): Promise<ReadonlyMap<string, string>> {
  const r = await run('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: repo, timeoutMs: 60_000 });
  if (!r.ok) throw new Error(`git status failed: ${r.out.trim().slice(0, 200)}`);
  const out = new Map<string, string>();
  const parts = r.out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status[0] === 'R' || status[0] === 'C') i++; // the old path follows a rename
    const file = join(repo, path);
    const hash = existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex') : 'gone';
    out.set(path, `${status} ${hash}`);
  }
  return out;
}

/**
 * Puts back what changed outside the fork between two readings of changesOutside: a tracked file to its committed
 * state, a new file moved aside into `aside` (kept, not deleted, in case it was someone else's). A path that was
 * already changed before (someone's work in progress) is left alone and reported as kept.
 */
export async function revertOutside(
  repo: string,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  aside: string,
): Promise<{ readonly reverted: string[]; readonly kept: string[] }> {
  const reverted: string[] = [];
  const kept: string[] = [];
  for (const [path, now] of after) {
    if (before.get(path) === now) continue;
    if (before.has(path)) {
      kept.push(path);
      continue;
    }
    if (now.startsWith('??')) {
      const to = join(aside, path);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(join(repo, path), to);
    } else {
      const r = await run('git', ['checkout', 'HEAD', '--', path], { cwd: repo, timeoutMs: 60_000 });
      if (!r.ok) {
        kept.push(path);
        continue;
      }
    }
    reverted.push(path);
  }
  return { reverted, kept };
}

/** A copy of the fork to put back if a builder's run has to be undone. */
export function snapshotFork(dir: string, to: string): void {
  rmSync(to, { recursive: true, force: true });
  cpSync(dir, to, { recursive: true });
}

export function restoreFork(from: string, dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  cpSync(from, dir, { recursive: true });
}
