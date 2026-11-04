import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PARAMS, ROWS, TIMES, clampParam, clampRecipe, columnsOf, describeKnobs, mergeRecipe, readPalette, recipeFromEntries } from './recipe';

const PALETTE = readFileSync(fileURLToPath(new URL('../../../src/render/palette.ts', import.meta.url)), 'utf8');

interface FieldLike {
  readonly kind: string;
  readonly def: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly int?: boolean;
}
// The page's schema (src/params.ts), read through vitest: the server's own types don't cover the page's import.meta.env.
const PARAMS_TS = fileURLToPath(new URL('../../../src/params.ts', import.meta.url));
const { schema } = (await import(PARAMS_TS)) as { readonly schema: Readonly<Record<string, Readonly<Record<string, FieldLike>>>> };

describe('the recipe’s knobs are the meadow’s', () => {
  it('each parameter has the schema’s default, range and kind', () => {
    for (const spec of PARAMS) {
      const field = schema[spec.group][spec.key];
      expect(field, `${spec.group}.${spec.key}`).toBeDefined();
      expect([field.kind, field.def, field.min, field.max, field.int], `${spec.group}.${spec.key}`).toEqual(['number', spec.def, spec.min, spec.max, spec.int === true]);
    }
  });

  it('covers every number of the look’s groups but the blade radius', () => {
    const want = ['grass', 'flowers', 'water', 'clouds', 'light', 'style'].flatMap((g) =>
      Object.entries(schema[g])
        .filter(([, f]) => f.kind === 'number')
        .map(([k]) => `${g}.${k}`),
    );
    expect(PARAMS.map((s) => `${s.group}.${s.key}`).sort()).toEqual(want.filter((p) => p !== 'grass.nearRadius').sort());
  });

  it('each palette row has the meadow’s columns, by time of day', () => {
    const meadow = readPalette(PALETTE);
    expect(Object.keys(meadow.NOON ?? {}).sort()).toEqual(Object.keys(ROWS).sort());
    for (const time of TIMES) {
      for (const [row, colours] of Object.entries(meadow[time] ?? {})) expect(columnsOf(time, row), `${time} ${row}`).toBe(colours.length);
      for (const row of Object.keys(ROWS)) if (!meadow[time]?.[row]) expect(columnsOf(time, row), `${time} ${row}`).toBe(0);
    }
  });

  it('describes every knob with the colour it starts from', () => {
    const text = describeKnobs(readPalette(PALETTE));
    expect(text).toContain('NOON SKY: zenith #2F7CC4');
    expect(text).toContain('DAWN SKY: zenith #3F70B3');
    expect(text).toContain('grass.height: grass height (m), 0.08–1.2, now 0.42');
    expect(text).not.toContain('?');
  });
});

describe('clamping a recipe', () => {
  it('holds numbers to their ranges and rounds whole ones', () => {
    expect(clampParam('grass.height', 9)).toBe(1.2);
    expect(clampParam('grass.height', -1)).toBe(0.08);
    expect(clampParam('style.toonBands', 3.6)).toBe(4);
    expect(clampParam('light.timeOfDay', 18.25)).toBe(18.25);
    expect(clampParam('grass.height', Number.NaN)).toBeNull();
    expect(clampParam('grass.height', '0.5')).toBeNull();
    expect(clampParam('world.seed', 3)).toBeNull();
    expect(clampParam('grass.nearRadius', 30)).toBeNull();
  });

  it('drops unknown times, rows, groups and keys, and colours that aren’t #rrggbb', () => {
    const recipe = clampRecipe({
      palette: {
        NOON: { SKY: ['#cfe3ee', '#EEF4F6', 'blue', '#FFFFFF'], NOPE: ['#111111'], GRASS: 'green', ROCK: ['#1', '#222222'] },
        DAWN: { GRASS: ['#000000'], SKY: ['#101010', '#202020', '#303030', '#404040', '#505050', '#606060'] },
        NIGHT: { SKY: ['#000000'] },
      },
      params: { grass: { height: 2, nearRadius: 30, colour: 1 }, world: { seed: 1 }, style: { toonBands: 2.2 }, ['__proto__']: { x: 1 } },
      extra: true,
    });
    expect(recipe).toEqual({
      palette: { NOON: { SKY: ['#CFE3EE', '#EEF4F6'] }, DAWN: { SKY: ['#101010', '#202020', '#303030', '#404040', '#505050'] } },
      params: { grass: { height: 1.2 }, style: { toonBands: 2 } },
    });
  });

  it('turns a model’s flat answer into a clamped recipe', () => {
    const recipe = recipeFromEntries({
      palette: [
        { time: 'NOON', row: 'WATER', colours: ['#5A8FB0'] },
        { time: 'GOLDEN', row: 'LIGHT', colours: ['#FFD0A0', '#B0C0E0'] },
        { time: 'GOLDEN', row: 'GRASS', colours: ['#000000'] },
      ],
      params: [
        { param: 'clouds.coverage', value: 1.5 },
        { param: 'flowers.pink', value: 0 },
        { param: 'terrain.wetlands', value: 0.9 },
        { param: 'nonsense', value: 1 },
      ],
    });
    expect(recipe).toEqual({
      palette: { NOON: { WATER: ['#5A8FB0'] }, GOLDEN: { LIGHT: ['#FFD0A0', '#B0C0E0'] } },
      params: { clouds: { coverage: 1 }, flowers: { pink: 0 } },
    });
    expect(clampRecipe(null)).toEqual({ palette: {}, params: {} });
    expect(recipeFromEntries({})).toEqual({ palette: {}, params: {} });
  });

  it('merges a retune over a recipe, row by row and key by key', () => {
    const base = clampRecipe({ palette: { NOON: { SKY: ['#111111'], WATER: ['#222222'] } }, params: { grass: { height: 0.3, density: 100 } } });
    const patch = clampRecipe({ palette: { NOON: { SKY: ['#333333'] }, DAWN: { SKY: ['#444444'] } }, params: { grass: { height: 0.6 }, clouds: { speed: 0.1 } } });
    expect(mergeRecipe(base, patch)).toEqual({
      palette: { NOON: { SKY: ['#333333'], WATER: ['#222222'] }, DAWN: { SKY: ['#444444'] } },
      params: { grass: { height: 0.6, density: 100 }, clouds: { speed: 0.1 } },
    });
  });
});
