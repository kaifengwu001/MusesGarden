// A planet's recipe: where its colours and settings differ from the meadow it was forked from. It is written to the
// fork's recipe.json, which the fork's own recipe.ts lays over its palette rows (render/palette.ts) and parameter
// defaults (params.ts) at load. Everything a model proposes passes through here first: unknown times, rows, groups and
// keys are dropped, colours must be #rrggbb, and numbers are held to the schema's ranges.

/** The palette's three keys of the day (render/palette.ts NOON, DAWN, GOLDEN). */
export const TIMES = ['NOON', 'DAWN', 'GOLDEN'] as const;
export type PaletteTime = (typeof TIMES)[number];

/**
 * The meadow's palette rows by name (render/palette.ts ROW), each column's meaning as its comment gives it. Dawn and
 * golden hour override only the sky, cloud and light rows, and the dawn and golden sky rows have five columns.
 */
export const ROWS: Readonly<Record<string, readonly string[]>> = {
  GRASS: ['light', 'mid', 'shade', 'sunlit tips', 'pale (ahead of bloom)', 'deep shade', 'far blue-green', 'pale light', 'wind sheen'],
  BRUSH: ['far ground brush light', 'brush mid', 'brush dark', 'dry highlight', 'cool strokes', 'warm strokes'],
  WATER: ['the mirror', 'the deep body', '(unused)', 'highlight', 'pale sky low in the mirror', 'deep colour high in it', 'lily pad', 'lily pad shade', 'a bank in the mirror', 'ruffle'],
  PINK: ['pink cup light', 'cup mid', 'inner', 'cup shade', 'stem', 'stem shade', 'blush', 'rose', 'coral', 'rose shade'],
  STAR: ['white star petal', 'petal shade', 'centre', 'centre bright', 'cream', 'pale lilac'],
  SCATTER: ['yellow button', 'yellow shade', 'blue cluster', 'blue shade', 'red', 'red shade', 'orange', 'orange shade', 'violet', 'violet shade', 'lemon'],
  SKY: ['zenith', 'horizon', 'haze', 'sun glow', 'mid sky', 'haze over the far ground'],
  CLOUD: ['lit', 'shadowed', 'mid', 'rim', 'base (the ground seen through it)'],
  ROCK: ['rock', 'shadow', 'light', 'lilac shade'],
  SNOW: ['snow', 'blue-lilac shade', 'mid', 'highlight'],
  STONE: [
    'home wall light',
    'wall',
    'wall patch',
    'stone',
    'stone dark',
    'joint',
    'damp at the waterline',
    'ochre bloom',
    'landing top',
    'landing side',
    'eaves shadow',
    '(unused)',
    'brick',
    'brick dark',
    'stone where the plaster fell',
    'damp at the foot',
  ],
  ROOF: [
    'roof tile',
    'tile shade',
    'door wood',
    'door wood shade',
    'iron',
    'tile light',
    'moss light',
    'moss dark',
    'capping tiles',
    'window frames',
    'glass (the ground in it)',
    'glass (the sky in it)',
    'bench wood',
    'under the eaves',
    'tile edge (lit)',
    'tile grey',
  ],
  LIGHT: ['sun light', 'sky ambient', 'ground bounce', 'rim', 'shadow tint'],
  BUD: ['bud green', 'bud tip', 'dry grass'],
};

/** How many columns each time of day has of each row it overrides (render/palette.ts DAWN and GOLDEN). */
const TIMED: Readonly<Record<string, number>> = { SKY: 5, CLOUD: 5, LIGHT: 5 };

export function columnsOf(time: PaletteTime, row: string): number {
  if (!Object.hasOwn(ROWS, row)) return 0;
  if (time === 'NOON') return ROWS[row].length;
  return Object.hasOwn(TIMED, row) ? TIMED[row] : 0;
}

export interface ParamSpec {
  readonly group: string;
  readonly key: string;
  readonly label: string;
  readonly def: number;
  readonly min: number;
  readonly max: number;
  readonly int?: boolean;
}

const p = (group: string, key: string, label: string, def: number, min: number, max: number, int = false): ParamSpec => ({ group, key, label, def, min, max, int });

/**
 * The defaults a recipe may set: the look's groups of src/params.ts (grass, flowers, water, clouds, light, style), as
 * its schema has them (recipe.test.ts holds this table to it). Grass's blade radius is left out: it is a cost, not a look.
 */
export const PARAMS: readonly ParamSpec[] = [
  p('grass', 'density', 'grass blades per m²', 180, 20, 1200),
  p('grass', 'height', 'grass height (m)', 0.42, 0.08, 1.2),
  p('flowers', 'density', 'flowers per m²', 12, 0, 40),
  p('flowers', 'patchiness', 'how much flowers gather in patches', 0.95, 0, 1),
  p('flowers', 'patchSize', 'flower patch size (m)', 13, 3, 40),
  p('flowers', 'sizeVariation', 'flower size variation', 0.6, 0, 1),
  p('flowers', 'colourVariation', 'flower colour variation', 0.65, 0, 1),
  p('flowers', 'pink', 'share of pink cups', 0.21, 0, 1),
  p('flowers', 'star', 'share of white stars', 0.35, 0, 1),
  p('flowers', 'yellow', 'share of yellow buttons', 0.33, 0, 1),
  p('flowers', 'blue', 'share of blue clusters', 0.11, 0, 1),
  p('water', 'depthTint', 'water depth tint', 0.65, 0, 1),
  p('water', 'reflection', 'sky reflection in the water', 0.8, 0, 1),
  p('water', 'glints', 'glints on the water', 0.7, 0, 1),
  p('water', 'lilyPads', 'lily pads', 0, 0, 1),
  p('clouds', 'coverage', 'cloud coverage', 0.45, 0, 1),
  p('clouds', 'altitude', 'cloud altitude (m)', 5, 1, 40),
  p('clouds', 'speed', 'cloud speed', 0.4, 0, 1),
  p('clouds', 'shadow', 'cloud shadow strength', 0.88, 0, 1),
  p('light', 'timeOfDay', 'time of day (hours, 5.5 dawn to 19 dusk)', 11.5, 5.5, 19),
  p('style', 'toonBands', 'toon light bands', 3, 2, 5, true),
  p('style', 'bandSoftness', 'softness between the bands', 0.08, 0, 0.3),
  p('style', 'fogDensity', 'aerial haze', 0.5, 0, 1),
  p('style', 'grain', 'paper grain', 0.02, 0, 0.1),
  p('style', 'contrast', 'contrast', 1.1, 0.8, 1.4),
  p('style', 'brightness', 'brightness', 0.95, 0.7, 1.2),
];

const BY_PATH = new Map(PARAMS.map((s) => [`${s.group}.${s.key}`, s]));
export const PARAM_PATHS: readonly string[] = [...BY_PATH.keys()];

export interface Recipe {
  /** By time of day, by row name: the row's colours, column by column (a shorter row keeps the meadow's tail). */
  readonly palette: Readonly<Partial<Record<PaletteTime, Readonly<Record<string, readonly string[]>>>>>;
  /** By group, by key: the default. */
  readonly params: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export const EMPTY_RECIPE: Recipe = { palette: {}, params: {} };

/** What a model answers with: flat lists, which strict structured output can describe. */
export interface RecipeEntries {
  readonly palette: readonly { readonly time: string; readonly row: string; readonly colours: readonly string[] }[];
  readonly params: readonly { readonly param: string; readonly value: number }[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is PaletteTime => typeof v === 'string' && (TIMES as readonly string[]).includes(v);

function cleanColours(time: PaletteTime, row: string, raw: unknown): string[] | null {
  const n = columnsOf(time, row);
  if (n === 0 || !Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const c of raw.slice(0, n)) {
    if (typeof c !== 'string' || !HEX.test(c.trim())) break;
    out.push(c.trim().toUpperCase());
  }
  return out.length > 0 ? out : null;
}

/** A number for a known parameter, held to its range (whole for an integer one); null for anything else. */
export function clampParam(path: string, value: unknown): number | null {
  const spec = BY_PATH.get(path);
  if (!spec || typeof value !== 'number' || !Number.isFinite(value)) return null;
  const v = Math.min(spec.max, Math.max(spec.min, value));
  return spec.int ? Math.round(v) : Math.round(v * 1e4) / 1e4;
}

/** Any recipe-shaped value (a recipe.json, perhaps edited by hand) as a valid recipe: what can't be used is dropped. */
export function clampRecipe(raw: unknown): Recipe {
  if (!isRecord(raw)) return EMPTY_RECIPE;
  const palette: Partial<Record<PaletteTime, Record<string, string[]>>> = {};
  if (isRecord(raw.palette)) {
    for (const [time, rows] of Object.entries(raw.palette)) {
      if (!isTime(time) || !isRecord(rows)) continue;
      for (const [row, colours] of Object.entries(rows)) {
        const clean = cleanColours(time, row, colours);
        if (clean) (palette[time] ??= {})[row] = clean;
      }
    }
  }
  const params: Record<string, Record<string, number>> = {};
  if (isRecord(raw.params)) {
    for (const [group, values] of Object.entries(raw.params)) {
      if (!isRecord(values)) continue;
      for (const [key, value] of Object.entries(values)) {
        const v = clampParam(`${group}.${key}`, value);
        if (v !== null) (params[group] ??= {})[key] = v;
      }
    }
  }
  return { palette, params };
}

/** A model's flat answer as a recipe, clamped. */
export function recipeFromEntries(entries: Partial<RecipeEntries>): Recipe {
  const palette: Record<string, Record<string, unknown>> = {};
  for (const e of Array.isArray(entries.palette) ? entries.palette : []) {
    if (isRecord(e) && typeof e.time === 'string' && typeof e.row === 'string') (palette[e.time] ??= {})[e.row] = e.colours;
  }
  const params: Record<string, Record<string, unknown>> = {};
  for (const e of Array.isArray(entries.params) ? entries.params : []) {
    if (!isRecord(e) || typeof e.param !== 'string') continue;
    const [group, key] = e.param.split('.');
    if (group && key) (params[group] ??= {})[key] = e.value;
  }
  return clampRecipe({ palette, params });
}

/** `patch` laid over `base`: its rows and keys win, the rest of `base` stays. */
export function mergeRecipe(base: Recipe, patch: Recipe): Recipe {
  const palette: Partial<Record<PaletteTime, Record<string, readonly string[]>>> = {};
  for (const time of TIMES) {
    const rows = { ...(base.palette[time] ?? {}), ...(patch.palette[time] ?? {}) };
    if (Object.keys(rows).length > 0) palette[time] = rows;
  }
  const params: Record<string, Record<string, number>> = {};
  for (const group of new Set([...Object.keys(base.params), ...Object.keys(patch.params)])) {
    params[group] = { ...(base.params[group] ?? {}), ...(patch.params[group] ?? {}) };
  }
  return { palette, params };
}

/** The value a recipe gives a parameter, else the meadow's. */
export function paramOf(recipe: Recipe, path: string): number | undefined {
  const spec = BY_PATH.get(path);
  if (!spec) return undefined;
  return recipe.params[spec.group]?.[spec.key] ?? spec.def;
}

/** The JSON Schema of a model's recipe answer (strict structured output: every object closed, every field required). */
export const ENTRIES_SCHEMA = {
  palette: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['time', 'row', 'colours'],
      properties: {
        time: { type: 'string', enum: [...TIMES] },
        row: { type: 'string', enum: Object.keys(ROWS) },
        colours: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  params: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['param', 'value'],
      properties: { param: { type: 'string', enum: [...PARAM_PATHS] }, value: { type: 'number' } },
    },
  },
} as const;

/**
 * The palette rows of a palette.ts source (the meadow's, or a fork's), by time and row name: the hex colours of each
 * `[ROW.NAME]: [...]` line of its NOON, DAWN and GOLDEN tables. Used to show a model the colours it starts from.
 */
export function readPalette(source: string): Partial<Record<PaletteTime, Record<string, string[]>>> {
  const out: Partial<Record<PaletteTime, Record<string, string[]>>> = {};
  for (const time of TIMES) {
    const start = source.indexOf(`const ${time}: Rows = {`);
    if (start < 0) continue;
    const end = source.indexOf('\n};', start);
    const block = source.slice(start, end < 0 ? undefined : end);
    for (const m of block.matchAll(/\[ROW\.([A-Z]+)\]:\s*\[([^\]]*)\]/g)) {
      (out[time] ??= {})[m[1]] = [...m[2].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((c) => c[1].toUpperCase());
    }
  }
  return out;
}

/** The knobs in words, for a prompt: each row's columns with the colours it starts from, and each parameter's range. */
export function describeKnobs(base: Partial<Record<PaletteTime, Record<string, string[]>>>, recipe: Recipe = EMPTY_RECIPE): string {
  const lines: string[] = ['Palette rows (time, row: column = colour now):'];
  for (const time of TIMES) {
    for (const row of Object.keys(ROWS)) {
      const n = columnsOf(time, row);
      if (n === 0) continue;
      const now = recipe.palette[time]?.[row] ?? [];
      const from = base[time]?.[row] ?? [];
      if (time !== 'NOON' && from.length === 0) continue;
      const cols = ROWS[row].slice(0, n).map((what, i) => `${what} ${now[i] ?? from[i] ?? '?'}`);
      lines.push(`- ${time} ${row}: ${cols.join(', ')}`);
    }
  }
  lines.push('', 'Settings (param: what, range, now):');
  for (const s of PARAMS) {
    const path = `${s.group}.${s.key}`;
    lines.push(`- ${path}: ${s.label}, ${s.min}–${s.max}${s.int ? ' (whole)' : ''}, now ${paramOf(recipe, path)}`);
  }
  return lines.join('\n');
}
