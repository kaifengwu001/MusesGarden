import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Color } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { planetOf } from '../../../src/muse/planets';
import { newEnvironment } from '../../../scripts/new-environment';
import { ensureFork, forkedBy, layRecipe, loadGeneratedPlanets, planetIdFor, readRecipe, recordPlanet, retitle, worldSeedFor, writeRecipe, type ForkFn } from './fork';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

// A fork's modules, read through vitest (the server's types don't cover the page's import.meta.env).
interface ParamsModule {
  readonly schema: { readonly grass: { readonly height: { readonly def: number } }; readonly style: { readonly toonBands: { readonly def: number } } };
  defaultParams(): { readonly grass: { readonly height: number } };
  readonly ParamStore: new () => { toQuery(): string };
}
interface PaletteModule {
  readonly Palette: new () => { get(row: number, col: number): Color };
  readonly ROW: { readonly SKY: number; readonly GRASS: number };
}
const tmp = mkdtempSync(join(tmpdir(), 'planet-fork-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('a Muse’s planet id and seed', () => {
  it('is muse-<id> in a world folder’s letters', () => {
    expect(planetIdFor('pooh')).toBe('muse-pooh');
    expect(planetIdFor('Kiki Two')).toBe('muse-kiki-two');
    expect(planetIdFor('__')).toBe('muse-planet');
  });

  it('has a seed of its own from its id, in the schema’s range', () => {
    expect(worldSeedFor('pooh')).toBe(worldSeedFor('pooh'));
    expect(worldSeedFor('pooh')).not.toBe(worldSeedFor('test'));
    for (const id of ['a', 'pooh', 'test', 'x'.repeat(50)]) {
      expect(Number.isInteger(worldSeedFor(id))).toBe(true);
      expect(worldSeedFor(id)).toBeGreaterThanOrEqual(0);
      expect(worldSeedFor(id)).toBeLessThan(10_000);
    }
  });
});

describe('the fork and its recipe', () => {
  const out = join(tmp, 'environments', 'muse-test');
  const recipe = { palette: { NOON: { SKY: ['#C9DDE8', '#EAF1F4'] }, GOLDEN: { LIGHT: ['#FFC0A0'] } }, params: { grass: { height: 0.2 }, style: { toonBands: 4 } } };

  it('forks the meadow with the scaffold and lays the recipe through one import each', () => {
    const made = newEnvironment({ name: 'muse-test', title: 'Tide Pool Rise', repo: REPO, out, allowDirty: true });
    expect(made.dir).toBe(out);
    layRecipe(out);
    writeRecipe(out, recipe);
    layRecipe(out); // again: nothing doubles
    const params = readFileSync(join(out, 'params.ts'), 'utf8');
    const palette = readFileSync(join(out, 'render/palette.ts'), 'utf8');
    expect(params.split("import { recipeParams } from './recipe';").length).toBe(2);
    expect(params.split('recipeParams(schema);').length).toBe(2);
    expect(palette.split("import { recipePalette } from '../recipe';").length).toBe(2);
    expect(palette.split('recipePalette({ NOON, DAWN, GOLDEN }, ROW);').length).toBe(2);
    expect(params.indexOf('recipeParams(schema);')).toBeGreaterThan(params.indexOf('} as const;'));
    expect(palette.indexOf('recipePalette(')).toBeGreaterThan(palette.indexOf('const GOLDEN: Rows = {'));
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('<title>Tide Pool Rise</title>');
    expect(readRecipe(out)).toEqual(recipe);
  });

  it('starts the fork’s world from the recipe', async () => {
    const params = (await import(join(out, 'params.ts'))) as ParamsModule;
    expect(params.schema.grass.height.def).toBe(0.2);
    expect(params.schema.style.toonBands.def).toBe(4);
    expect(params.defaultParams().grass.height).toBe(0.2);
    expect(new params.ParamStore().toQuery()).toBe('');
    const meadow = (await import(join(REPO, 'src/params.ts'))) as ParamsModule;
    expect(meadow.schema.grass.height.def).toBe(0.42);
    const { Palette, ROW } = (await import(join(out, 'render/palette.ts'))) as PaletteModule;
    const palette = new Palette();
    expect(palette.get(ROW.SKY, 0).getHexString()).toBe(new Color('#C9DDE8').getHexString());
    expect(palette.get(ROW.SKY, 2).getHexString()).toBe(new Color('#D6EAF1').getHexString()); // the meadow's haze, past the recipe's two
    expect(palette.get(ROW.GRASS, 0).getHexString()).toBe(new Color('#8BA44A').getHexString());
  });

  it('renames the fork', () => {
    retitle(out, 'Tide Pool Rise', 'Star’s “Rest” & Co');
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('<title>Star’s “Rest” &amp; Co</title>');
    expect(readFileSync(join(out, 'ui/ui.ts'), 'utf8')).toContain("'Star’s “Rest” & Co'");
    expect(readFileSync(join(out, 'ui/postcard.ts'), 'utf8')).toContain("'Star’s “Rest” & Co'");
  });
});

describe('ensureFork', () => {
  const repo = join(tmp, 'repo');
  const fake: ForkFn = ({ repo: r, name, title }) => {
    const dir = join(r, 'environments', name);
    mkdirSync(join(dir, 'render'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), `<title>${title}</title>`);
    writeFileSync(join(dir, 'params.ts'), readFileSync(join(REPO, 'src/params.ts'), 'utf8'));
    writeFileSync(join(dir, 'render/palette.ts'), readFileSync(join(REPO, 'src/render/palette.ts'), 'utf8'));
    return { dir, commit: 'abc1234', dirty: false };
  };
  const recipe = { palette: {}, params: { clouds: { coverage: 0.9 } } };

  it('forks once per job, keeps its own fork when run again, and replaces another job’s', () => {
    let forks = 0;
    const counted: ForkFn = (req) => (forks++, fake(req));
    const lines: string[] = [];
    const first = ensureFork(counted, { repo, name: 'muse-test', title: 'A', job: 'job-1', recipe }, (l) => lines.push(l));
    expect(first.made).toBe(true);
    expect(forkedBy(first.dir)).toBe('job-1');
    writeFileSync(join(first.dir, 'mine.txt'), 'kept');
    expect(ensureFork(counted, { repo, name: 'muse-test', title: 'A', job: 'job-1', recipe }, (l) => lines.push(l)).made).toBe(false);
    expect(existsSync(join(first.dir, 'mine.txt'))).toBe(true);
    expect(ensureFork(counted, { repo, name: 'muse-test', title: 'B', job: 'job-2', recipe }, (l) => lines.push(l)).made).toBe(true);
    expect(existsSync(join(first.dir, 'mine.txt'))).toBe(false);
    expect(forks).toBe(2);
    expect(lines.join('\n')).toContain('replacing environments/muse-test/ (made by job-1)');
    expect(readRecipe(first.dir)).toEqual(recipe);
  });

  it('lists the planets it made and registers them at boot', () => {
    recordPlanet(repo, 'muse-test', 'Tide Pool Rise');
    recordPlanet(repo, 'muse-gone', 'Gone');
    recordPlanet(repo, 'muse-test', 'Star Rest');
    const list = JSON.parse(readFileSync(join(repo, 'environments/generated.json'), 'utf8')) as unknown;
    expect(list).toEqual([
      { id: 'muse-gone', title: 'Gone' },
      { id: 'muse-test', title: 'Star Rest' },
    ]);
    expect(loadGeneratedPlanets(repo)).toEqual([{ id: 'muse-test', title: 'Star Rest' }]);
    expect(planetOf('muse-test').title).toBe('Star Rest');
    expect(loadGeneratedPlanets(join(tmp, 'nowhere'))).toEqual([]);
  });
});
