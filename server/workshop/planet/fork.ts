// A Muse's planet on disk: a fork of the meadow in environments/muse-<id>/ (git-ignored), made by the new-environment
// scaffold, with its recipe (recipe.json) laid over its palette and parameters through one import each. The planets
// the workshop has made are listed in environments/generated.json, which the server reads at boot.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedPlanet } from '../../../src/muse/contract';
import { isGeneratedPlanet, registerPlanet } from '../../../src/muse/planets';
import { newEnvironment } from '../../../scripts/new-environment';
import { clampRecipe, type Recipe } from './recipe';

const TEMPLATE = fileURLToPath(new URL('../../../scripts/templates/recipe.ts.txt', import.meta.url));
/** The workshop's note in a fork: which job made it. */
const MARKER = '.workshop.json';
export const GENERATED_JSON = 'environments/generated.json';

/** The planet a Muse's workshop builds: muse-<its id>, in the letters a world's folder may use. */
export function planetIdFor(museId: string): GeneratedPlanet {
  const slug = museId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const id: GeneratedPlanet = `muse-${slug || 'planet'}`;
  if (!isGeneratedPlanet(id)) throw new Error(`no planet id can be made from the Muse id ${JSON.stringify(museId)}`);
  return id;
}

/** A seed for a Muse's planet from its id (FNV-1a), in the schema's 0–9999. */
export function worldSeedFor(museId: string): number {
  let h = 0x811c9dc5;
  for (const ch of museId) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 10_000;
}

export function forkDir(repo: string, id: GeneratedPlanet): string {
  return join(repo, 'environments', id);
}

export interface ForkRequest {
  readonly repo: string;
  readonly name: GeneratedPlanet;
  readonly title: string;
}

/** Makes environments/<name>/ (and nothing else). The real one is the new-environment scaffold. */
export type ForkFn = (req: ForkRequest) => { readonly dir: string; readonly commit: string; readonly dirty: boolean };

/** The scaffold, copying src/ as it stands: uncommitted changes don't hold a Muse's planet up (its README says so). */
export const scaffoldFork: ForkFn = ({ repo, name, title }) => newEnvironment({ name, title, repo, allowDirty: true });

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** The job that made this fork, if the workshop made it. */
export function forkedBy(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as { job?: unknown };
    return typeof raw.job === 'string' ? raw.job : null;
  } catch {
    return null;
  }
}

/**
 * The fork for `job`, made once: a fork this job made already is kept (a step run again after a crash); any other in
 * its place (an older planet of the same Muse, or one half made) is replaced. Then the recipe's file and its two
 * imports, which are safe to lay again.
 */
export function ensureFork(fork: ForkFn, req: ForkRequest & { readonly job: string; readonly recipe: Recipe }, log: (line: string) => void): { readonly dir: string; readonly made: boolean } {
  const dir = forkDir(req.repo, req.name);
  let made = false;
  if (forkedBy(dir) !== req.job) {
    if (existsSync(dir)) {
      log(`replacing environments/${req.name}/ (made by ${forkedBy(dir) ?? 'no workshop job'})`);
      rmSync(dir, { recursive: true, force: true });
    }
    const out = fork(req);
    if (out.dirty) log('src/ had uncommitted changes; the planet copies them as they are');
    writeText(join(dir, MARKER), `${JSON.stringify({ job: req.job, from: out.commit, dirty: out.dirty }, null, 2)}\n`);
    made = true;
  }
  layRecipe(dir);
  writeRecipe(dir, req.recipe);
  return { dir, made };
}

/** One import and one call in each of params.ts and render/palette.ts that lay recipe.json over them, and recipe.ts. */
export function layRecipe(dir: string): void {
  writeText(join(dir, 'recipe.ts'), readFileSync(TEMPLATE, 'utf8'));
  if (!existsSync(join(dir, 'recipe.json'))) writeRecipe(dir, { palette: {}, params: {} });
  insertOnce(join(dir, 'params.ts'), "import { recipeParams } from './recipe';", 'export const schema = {', '\n} as const;', "\n\n// This planet's own defaults (recipe.json), over the meadow's.\nrecipeParams(schema);");
  insertOnce(join(dir, 'render/palette.ts'), "import { recipePalette } from '../recipe';", 'const GOLDEN: Rows = {', '\n};', "\n\n// This planet's own colours (recipe.json), over the meadow's.\nrecipePalette({ NOON, DAWN, GOLDEN }, ROW);");
}

/** Adds `importLine` after a file's last top import and `call` after the block from `start` to `end`, unless there. */
function insertOnce(file: string, importLine: string, start: string, end: string, call: string): void {
  let text = readFileSync(file, 'utf8');
  if (text.includes(importLine)) return;
  const at = text.indexOf(start);
  const close = at < 0 ? -1 : text.indexOf(end, at);
  if (close < 0) throw new Error(`${file}: can't find where to lay the recipe (${JSON.stringify(start)})`);
  text = `${text.slice(0, close + end.length)}${call}${text.slice(close + end.length)}`;
  const imports = [...text.matchAll(/^import .*;$/gm)];
  const last = imports.at(-1);
  const after = last ? (last.index ?? 0) + last[0].length : 0;
  text = `${text.slice(0, after)}${after > 0 ? '\n' : ''}${importLine}${after > 0 ? '' : '\n'}${text.slice(after)}`;
  writeText(file, text);
}

export function writeRecipe(dir: string, recipe: Recipe): void {
  writeText(join(dir, 'recipe.json'), `${JSON.stringify(clampRecipe(recipe), null, 2)}\n`);
}

export function readRecipe(dir: string): Recipe {
  try {
    return clampRecipe(JSON.parse(readFileSync(join(dir, 'recipe.json'), 'utf8')));
  } catch {
    return { palette: {}, params: {} };
  }
}

/** Renames a fork: its page's title and the name its interface and postcards print. */
export function retitle(dir: string, from: string, to: string): void {
  if (from === to) return;
  const html = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ts = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const swap = (file: string, a: string, b: string): void => {
    const path = join(dir, file);
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    if (text.includes(a)) writeText(path, text.split(a).join(b));
  };
  swap('index.html', `<title>${html(from)}</title>`, `<title>${html(to)}</title>`);
  swap('ui/ui.ts', ts(from), ts(to));
  swap('ui/postcard.ts', ts(from), ts(to));
}

export interface GeneratedEntry {
  readonly id: GeneratedPlanet;
  readonly title: string;
}

function readGenerated(repo: string): GeneratedEntry[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(repo, GENERATED_JSON), 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((e: unknown) => {
      const { id, title } = (typeof e === 'object' && e !== null ? e : {}) as { id?: unknown; title?: unknown };
      return isGeneratedPlanet(id) && typeof title === 'string' && title.trim() ? [{ id, title }] : [];
    });
  } catch {
    return [];
  }
}

/** Adds or renames a planet in environments/generated.json and registers it with the planets the server knows. */
export function recordPlanet(repo: string, id: GeneratedPlanet, title: string): void {
  const list = readGenerated(repo).filter((e) => e.id !== id);
  list.push({ id, title });
  list.sort((a, b) => a.id.localeCompare(b.id));
  writeText(join(repo, GENERATED_JSON), `${JSON.stringify(list, null, 2)}\n`);
  registerPlanet(id, title);
}

/** At boot: registers every planet in environments/generated.json whose folder is still there, and returns them. */
export function loadGeneratedPlanets(repo: string): readonly GeneratedEntry[] {
  const live = readGenerated(repo).filter((e) => existsSync(join(forkDir(repo, e.id), 'index.html')));
  for (const e of live) registerPlanet(e.id, e.title);
  return live;
}
