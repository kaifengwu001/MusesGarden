// Muse Code, Meta's coding agent, as the planet's builder: it answers Muse's notes on a draft by editing the planet's
// own folder, headless (`muse exec "<prompt>" --workspace <folder>`), with its instructions in that folder's AGENTS.md.
// Around a run: what changed outside the folder is put back (and the run counts as failed), and the fork is checked.
import { execFile, type ExecFileException } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Builder } from '../clients';

/** How long Muse Code may work on one round of notes. */
export const BUILDER_TIMEOUT_MS = 40 * 60_000;

function run(bin: string, args: readonly string[], opts: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ ok: boolean; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 32 << 20, env: opts.env ?? process.env }, (err: ExecFileException | null, stdout, stderr) => {
      const out = `${stdout}${stderr ? `\n${stderr}` : ''}`;
      resolve({ ok: !err, out: err && !out.trim() ? err.message : out, missing: err?.code === 'ENOENT' });
    });
  });
}

/** The real builder: `muse` on PATH (MUSE_CODE_BIN to point elsewhere). */
export function museCodeBuilder(bin = process.env.MUSE_CODE_BIN || 'muse'): Builder {
  return {
    async available() {
      const r = await run(bin, ['--version'], { timeoutMs: 10_000 });
      return !r.missing && r.ok;
    },
    async run({ workspace, instructions, prompt, timeoutMs }) {
      writeFileSync(join(workspace, 'AGENTS.md'), instructions);
      const r = await run(bin, ['exec', prompt, '--workspace', workspace], { cwd: workspace, timeoutMs });
      const log = r.out.length > 20_000 ? `…${r.out.slice(-20_000)}` : r.out;
      return { ok: r.ok, log };
    },
  };
}

/** The AGENTS.md a planet's builder reads: what the planet must be, Muse's notes, and the house rules. */
export function agentsMd(opts: { readonly title: string; readonly contract: string; readonly notes: readonly string[]; readonly draft: number }): string {
  return `# ${opts.title}: notes on draft ${opts.draft}

This folder is one planet of Muse's Garden: a tiny round world drawn in three.js, forked from the meadow
(the main world in ../../src/). A Muse asked for it in its own words. Answer the Muse's notes below by
editing this planet, then stop.

## The rules

- **Edit only files in this folder.** Never touch ../../src/ or anything else outside it; a change there is
  undone and the round fails. When a shared file must differ here, copy it into this folder at the same
  relative path and repoint this planet's import to the copy.
- recipe.json holds this planet's palette rows and settings (read by recipe.ts). Change colours and settings
  there first; change code when the notes ask for shapes, plants, water or light the recipe can't give.
- Keep it working: the page must still load, with no errors in the console, and \`npx tsc -p tsconfig.json\`
  in this folder must still pass.
- The look: whimsical, cute and beautiful, with plausible materials (rock reads as fractured mineral, sand
  as granular, wood as fibrous, leaves as thin and living). Bold colour is welcome; muddled materials are not.
  No uniform clay or candy look, no eerie or bodily shapes, no generic noise.
- Sizes are meters, and everything stays with the planet as it turns.
- The views: \`npm run dev\` at the repository's root, then /environments/<this folder>/; the URL hash holds
  the view (t=12 freezes time).

## What the planet must be (the visual contract the Muse approved)

${opts.contract}

## The Muse's notes on draft ${opts.draft}

${opts.notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}
`;
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

/** Type-checks a fork with the repo's tsc (about a minute). */
export async function typecheckFork(repo: string, dir: string): Promise<{ readonly ok: boolean; readonly log: string }> {
  const config = join(dir, 'tsconfig.json');
  if (!existsSync(config)) writeFileSync(config, FORK_TSCONFIG);
  const tsc = join(repo, 'node_modules/.bin/tsc');
  const r = await run(tsc, ['-p', config, '--noEmit'], { cwd: repo, timeoutMs: 5 * 60_000 });
  return { ok: r.ok, log: r.out.trim().split('\n').slice(0, 30).join('\n') };
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
