// A Muse's home lives in its planet: the fork of the meadow (environments/muse-<id>/, made by the planet's workshop)
// gets its own copy of the hut (life/hut.ts), which reads its pieces from home.json beside the world's page. The
// meadow's src/ is never touched.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = join(REPO, 'src');
const HUT = join(SRC, 'life', 'hut.ts');
const TEMPLATE = join(REPO, 'scripts', 'templates', 'home.hut.txt');
/** The fork's copy already reads home.json. */
const MARKER = 'const HOME: Home | null';
const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|^import\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;
const ASSET_URL = /(new URL\(`)(\.{1,2}\/[^`$]*)/g;

/** A piece Muse's home made: its model (a file under the fork's assets/home/), its height (m) and where it stands (local m, rad). */
export interface HomePiece {
  readonly name: string;
  readonly file: string;
  readonly height: number;
  readonly place: { readonly x: number; readonly z: number; readonly turn: number };
  /** Its foot over the floor (m): on a shelf. */
  readonly lift?: number;
  /** Stands on the floor (default), rather than on a shelf. */
  readonly rests?: boolean;
}

/** home.json: the meadow's pieces it keeps (by name), the pieces it made, and where its rug lies (else the meadow's). */
export interface Home {
  readonly keep: readonly string[];
  readonly pieces: readonly HomePiece[];
  readonly rug?: { readonly x: number; readonly z: number; readonly length: number; readonly width: number; readonly turn: number };
}

function fail(message: string): never {
  throw new Error(`furnishFork: ${message}`);
}

function replaceOnce(source: string, from: string | RegExp, to: string): string {
  const count = typeof from === 'string' ? source.split(from).length - 1 : (source.match(new RegExp(from.source, `${from.flags.replace('g', '')}g`)) ?? []).length;
  if (count !== 1) fail(`src/life/hut.ts: expected one ${String(from)}, found ${count}; the meadow's hut changed, so update server/workshop/home/furnish.ts`);
  return source.replace(from, to);
}

/** A relative specifier's file, if it is there (with .ts or /index.ts as the bundler finds it). */
function resolveFile(base: string, specifier: string): string | null {
  const path = join(base, specifier.split('?')[0]);
  for (const candidate of [path, `${path}.ts`, join(path, 'index.ts')]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

const asSpecifier = (from: string, to: string): string => {
  const r = relative(from, to).split('\\').join('/');
  return r.startsWith('.') ? r : `./${r}`;
};

/**
 * The meadow's hut as the fork's: its imports pointing at the fork's copies where the fork has them (its props.ts),
 * else back into src/ (the shaders, the engine, the meadow's furniture), and its pieces read from home.json.
 */
export function forkHut(forkDir: string, source = readFileSync(HUT, 'utf8')): string {
  const here = join(forkDir, 'life');
  const repoint = (specifier: string): string => {
    const [path, query] = specifier.split('?');
    const inFork = resolveFile(here, path);
    if (inFork) return specifier;
    const target = join(SRC, 'life', path);
    return `${asSpecifier(here, target)}${query === undefined ? '' : `?${query}`}`;
  };
  let text = source.replace(SPECIFIER, (_m: string, lead: string, quote: string, specifier: string) => `${lead}${quote}${repoint(specifier)}${quote}`);
  // (the meadow's models by name, as new URL(`../assets/interior/${name}.glb`, import.meta.url))
  text = text.replace(ASSET_URL, (_m: string, lead: string, path: string) => `${lead}${existsSync(join(here, path)) ? path : `${asSpecifier(here, join(SRC, 'life', path))}${path.endsWith('/') ? '/' : ''}`}`);
  text = replaceOnce(text, 'export const PIECES: readonly Piece[] = [', 'const MEADOW_PIECES: readonly Piece[] = [');
  const template = readFileSync(TEMPLATE, 'utf8');
  text = replaceOnce(
    text,
    /^const RUG = (\{[^\n]*\}) as const;$/m,
    `const MEADOW_RUG = $1 as const;
${template.trim()}
/** The room's pieces: the meadow's, or Muse's own home's (home.json): the meadow's pieces it keeps, then the ones it made. */
export const PIECES: readonly Piece[] = HOME
  ? [
      ...MEADOW_PIECES.filter((p) => HOME.keep.includes(p.name)),
      ...HOME.pieces.map((p): Piece => ({ name: p.name, url: homeModel(p.file), height: p.height, place: p.place, lift: p.lift, rests: p.rests ?? true })),
    ]
  : MEADOW_PIECES;
const RUG = HOME?.rug ?? MEADOW_RUG;`,
  );
  return text;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'assets' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Give the fork its own hut reading `home` (home.json), its models copied from `from` (a folder holding each
 * piece's `file`) into the fork's assets/home/. The hut is copied in once (a hut already reading home.json is kept as
 * it is), and the fork's imports of the meadow's hut are pointed at it. Safe to run again.
 */
export function furnishFork(forkDir: string, home: Home, from?: string): { readonly hut: string; readonly repointed: readonly string[] } {
  if (!existsSync(join(forkDir, 'world.ts'))) fail(`${forkDir} is not a world (no world.ts)`);
  const hut = join(forkDir, 'life', 'hut.ts');
  if (!existsSync(hut) || !readFileSync(hut, 'utf8').includes(MARKER)) {
    const own = existsSync(hut) ? readFileSync(hut, 'utf8') : undefined;
    mkdirSync(dirname(hut), { recursive: true });
    writeFileSync(hut, forkHut(forkDir, own));
  }
  const repointed: string[] = [];
  for (const file of tsFiles(forkDir)) {
    if (file === hut) continue;
    const source = readFileSync(file, 'utf8');
    const text = source.replace(SPECIFIER, (match: string, lead: string, quote: string, specifier: string) => {
      if (resolveFile(dirname(file), specifier) !== HUT) return match;
      return `${lead}${quote}${asSpecifier(dirname(file), hut.replace(/\.ts$/, ''))}${quote}`;
    });
    if (text !== source) {
      writeFileSync(file, text);
      repointed.push(relative(forkDir, file));
    }
  }
  const assets = join(forkDir, 'assets', 'home');
  mkdirSync(assets, { recursive: true });
  const files = new Set(home.pieces.map((p) => p.file));
  for (const p of home.pieces) {
    if (!/^[\w.-]+\.glb$/.test(p.file)) fail(`a piece's model must be a plain .glb name: ${p.file}`);
    const source = from ? join(from, p.file) : join(assets, p.file);
    if (!existsSync(source)) fail(`no model for ${p.name} at ${source}`);
    if (source !== join(assets, p.file)) copyFileSync(source, join(assets, p.file));
  }
  // (a model no piece names any more is taken out, so the world's build doesn't carry it)
  for (const name of readdirSync(assets)) if (name.endsWith('.glb') && !files.has(name)) rmSync(join(assets, name));
  writeFileSync(join(forkDir, 'home.json'), `${JSON.stringify(home, null, 2)}\n`);
  return { hut, repointed };
}
