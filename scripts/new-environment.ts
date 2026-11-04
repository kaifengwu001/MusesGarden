import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `npm run new-environment -- <name> --title "<Title>"`: a new world in
// environments/<name>/, a working copy of the meadow's world-specific modules
// that imports the shared engine from src/ unchanged. Paths mirror src/, so
// imports between copied files stay as written; every other relative import is
// repointed into src/. The meadow itself is never edited.
//
// The same fork is exported as newEnvironment() for the workshop, which forks a
// planet for each real Muse (server/workshop/planet).

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** World-specific modules: they hold the meadow's content, or import (even as a type) a module that does. */
const COPIED = [
  'main.ts',
  'dev/hud.ts',
  'garden/placement.ts',
  'life/findBeds.ts',
  'life/museProps.ts',
  'life/museRoam.ts',
  'muse/ui/body.ts',
  'muse/ui/overlay.ts',
  'ui/garden/basketStage.ts',
  'ui/garden/gardenUi.ts',
  'ui/garden/travel.ts',
  'planet/surface.ts',
  'planet/surface.vert.glsl',
  'planet/surface.frag.glsl',
  'life/props.vert.glsl',

  'world.ts',
  'params.ts',
  'core/hashSync.ts',
  'dev/harness.ts',
  'dev/parity.ts',
  'ui/ui.ts',
  'ui/panel.ts',
  'ui/controlBar.ts',
  'ui/postcard.ts',
  'ui/format.ts',
  'planet/fields.ts',
  'planet/fields.glsl',
  'planet/terrain.ts',
  'planet/terrain.glsl',
  'planet/bake.ts',
  'planet/bake.frag.glsl',
  'planet/meadow.glsl',
  'planet/water.glsl',
  'render/palette.ts',
  'render/sky.ts',
  'render/glsl.ts',
  'render/toon.glsl',
  'life/flowers.ts',
  'life/flowerMeshes.ts',
  'life/flower.vert.glsl',
  'life/grass.ts',
  'life/props.ts',
  'life/props.frag.glsl',
  'life/birds.ts',
  'life/butterflies.ts',
  'life/muse.ts',
  'view/picking.ts',
  'view/vista.ts',
] as const;

/** The meadow's tests that exercise copied modules, run against the copy. */
const TESTS = ['dev/invariants/scale.test.ts', 'dev/invariants/params.test.ts', 'dev/invariants/growth.test.ts', 'dev/invariants.spec.ts', 'dev/lock.spec.ts'] as const;

const TITLE = { html: 'Muse&#8217;s Garden', text: 'Muse’s Garden' } as const;
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|^import\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;

/** Why a world could not be made; the command line prints it after "new-environment: ". */
export class NewEnvironmentError extends Error {}

function fail(message: string): never {
  throw new NewEnvironmentError(message);
}

function parseArgs(argv: readonly string[]): { name: string; title: string } {
  const name = argv.find((a) => !a.startsWith('--'));
  const at = argv.indexOf('--title');
  const title = at >= 0 ? argv[at + 1] : undefined;
  if (!name || !NAME.test(name)) fail('usage: npm run new-environment -- <name> --title "<Title>" (name: lowercase letters, digits, hyphens)');
  if (!title) fail('missing --title "<Title>"');
  return { name, title };
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The file a relative specifier in src/<from> points to, as a path relative to src/. */
function target(src: string, from: string, specifier: string): string {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier.split('?')[0]));
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    const file = join(src, candidate);
    if (existsSync(file) && statSync(file).isFile()) return candidate;
  }
  return fail(`src/${from}: cannot resolve '${specifier}'`);
}

function rewriteImports(src: string, from: string, source: string, copied: ReadonlySet<string>, out: string): string {
  return source.replace(SPECIFIER, (match: string, lead: string, quote: string, specifier: string) => {
    if (copied.has(target(src, from, specifier))) return match;
    const [path, query] = specifier.split('?');
    let moved = relative(join(out, dirname(from)), join(src, dirname(from), path)).split('\\').join('/');
    if (!moved.startsWith('.')) moved = `./${moved}`;
    return `${lead}${quote}${moved}${query === undefined ? '' : `?${query}`}${quote}`;
  });
}

function replaceOnce(file: string, source: string, from: string, to: string): string {
  if (!source.includes(from)) fail(`${file}: expected to find ${JSON.stringify(from)}`);
  return source.split(from).join(to);
}

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface NewEnvironmentOptions {
  /** The world's folder name under environments/ (lowercase letters, digits, hyphens). */
  readonly name: string;
  /** Its page's title, and the name its interface and postcards print. */
  readonly title: string;
  /** The checkout whose meadow is copied; this script's own by default. */
  readonly repo?: string;
  /** Where the world goes; environments/<name>/ in `repo` by default. */
  readonly out?: string;
  /**
   * Copy src/ as it is even with uncommitted changes (the README then says so). The command line never does: it asks
   * for them to be committed first, so the world records the meadow it was copied from.
   */
  readonly allowDirty?: boolean;
}

export interface NewEnvironment {
  /** The world's folder (absolute). */
  readonly dir: string;
  /** The meadow's commit it was copied from. */
  readonly commit: string;
  /** Whether src/ or index.html had uncommitted changes, copied as they were. */
  readonly dirty: boolean;
  readonly modules: number;
  readonly tests: number;
}

/** Scaffolds a world: copies of the meadow's world-specific modules, its own page, build config, tests and README. */
export function newEnvironment(opts: NewEnvironmentOptions): NewEnvironment {
  const { name, title } = opts;
  if (!NAME.test(name)) fail(`a world's name is lowercase letters, digits and hyphens: ${JSON.stringify(name)}`);
  if (!title.trim()) fail('a world needs a title');
  const repo = resolve(opts.repo ?? REPO);
  const src = join(repo, 'src');
  const out = resolve(opts.out ?? join(repo, 'environments', name));
  if (existsSync(out)) fail(`environments/${name} already exists; a world is scaffolded once and then edited by hand`);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', 'src', 'index.html') !== '';
  if (dirty && !opts.allowDirty) fail('src/ or index.html has uncommitted changes; commit them first, so the world records the meadow it was copied from');
  const commit = git('rev-parse', '--short', 'HEAD');
  const copied = new Set<string>(COPIED);
  const sourceOf = (file: string): string => (file === 'dev/lock.spec.ts' ? join(repo, 'scripts/templates/lock.spec.txt') : join(src, file));

  // Detect removed/renamed meadow modules before creating a partial world.
  for (const file of [...COPIED, ...TESTS]) {
    const source = sourceOf(file);
    if (!existsSync(source) || !statSync(source).isFile()) fail(`missing source for ${file}; update the scaffold's module list before creating a world`);
  }

  for (const file of [...COPIED, ...TESTS]) {
    let text = readFileSync(sourceOf(file), 'utf8');
    if (!file.endsWith('.glsl')) text = rewriteImports(src, file, text, copied, out);
    if (file === 'ui/ui.ts' || file === 'ui/postcard.ts') text = replaceOnce(file, text, `'${TITLE.text}'`, `'${title.replace(/'/g, "\\'")}'`);
    if (file.endsWith('.spec.ts')) text = text.replaceAll('`/#', `\`/environments/${name}/#`).replaceAll('`/?garden=', `\`/environments/${name}/?garden=`);
    if (file === 'dev/lock.spec.ts') text = replaceOnce(file, text, "'shots/lock'", `'shots/${name}/lock'`);
    write(join(out, file), text);
  }

  let html = readFileSync(join(repo, 'index.html'), 'utf8');
  html = replaceOnce('index.html', html, 'src="/src/main.ts"', 'src="./main.ts"');
  html = replaceOnce('index.html', html, TITLE.html, escapeHtml(title));
  write(join(out, 'index.html'), html);

  write(
    join(out, 'vite.config.ts'),
    `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npx vite build --config environments/${name}/vite.config.ts → dist-environments/${name}/
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  build: {
    target: 'es2022',
    outDir: \`\${repo}dist-environments/${name}\`,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: { fs: { allow: [repo] }, proxy: { '/api': process.env.MUSE_API ?? 'http://localhost:8787' } },
});
`,
  );

  write(
    join(out, 'README.md'),
    `# ${title}

A world of its own, scaffolded by \`npm run new-environment\` from the meadow at
commit ${commit}${dirty ? ' (with the uncommitted changes in src/ at the time)' : ''}. See [environments/README.md](../README.md) for how worlds are
organised.

- Open: \`npm run dev\`, then http://localhost:5173/environments/${name}/
- Test: \`npm test\`, \`npx playwright test --project=${name}:invariants\`, \`npx playwright test --project=${name}:lock\`
- Build: \`npx vite build --config environments/${name}/vite.config.ts\` (to \`dist-environments/${name}/\`)
`,
  );

  return { dir: out, commit, dirty, modules: COPIED.length, tests: TESTS.length };
}

function main(): void {
  try {
    const { name, title } = parseArgs(process.argv.slice(2));
    const made = newEnvironment({ name, title });
    console.info(`environments/${name}: ${made.modules} modules and ${made.tests} tests copied; open /environments/${name}/`);
  } catch (e) {
    if (!(e instanceof NewEnvironmentError)) throw e;
    console.error(`new-environment: ${e.message}`);
    process.exit(1);
  }
}

// Run as a command (npm run new-environment), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
