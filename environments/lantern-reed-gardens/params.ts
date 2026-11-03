import { areaOfRadius, growthForArea } from '../../src/planet/growth';

// One typed parameter schema. Every tunable lives here with its default,
// range, URL key and the kind of work a change triggers. The panel, control
// bar, URL hash and presets all go through `ParamStore`, so there is one
// source of truth; systems read `store.values` and subscribe to changes.

/** What has to happen when a field changes. */
export type Effect =
  | 'live' // read every frame (uniforms); nothing to rebuild
  | 'terrain' // terrain fields change: chunk data rebuild
  | 'world' // macro layout regenerates from the seed
  | 'life' // vegetation / cloud instance sets change
  | 'quality' // tier or resolution change
  | 'ui'; // interface only

interface FieldBase {
  /** Short key in the URL hash; unique across the schema. */
  readonly url: string;
  readonly label: string;
  readonly effect: Effect;
  /** Kept out of the lil-gui panel (still in the URL). */
  readonly hidden?: boolean;
}

export interface NumberField extends FieldBase {
  readonly kind: 'number';
  readonly def: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly int: boolean;
  readonly unit: string;
}

export interface ChoiceField<T extends string = string> extends FieldBase {
  readonly kind: 'choice';
  readonly def: T;
  readonly options: readonly T[];
}

export interface BoolField extends FieldBase {
  readonly kind: 'bool';
  readonly def: boolean;
}

export type Field = NumberField | ChoiceField | BoolField;

interface NumberOptions {
  unit?: string;
  hidden?: boolean;
}

function num(url: string, label: string, def: number, min: number, max: number, step: number, effect: Effect, opts: NumberOptions = {}): NumberField {
  return { kind: 'number', url, label, def, min, max, step, int: false, unit: opts.unit ?? '', effect, hidden: opts.hidden };
}

function int(url: string, label: string, def: number, min: number, max: number, effect: Effect, opts: NumberOptions = {}): NumberField {
  return { ...num(url, label, def, min, max, 1, effect, opts), int: true };
}

function choice<const T extends string>(url: string, label: string, options: readonly T[], def: NoInfer<T>, effect: Effect): ChoiceField<T> {
  return { kind: 'choice', url, label, options, def, effect };
}

function bool(url: string, label: string, def: boolean, effect: Effect): BoolField {
  return { kind: 'bool', url, label, def, effect };
}

export const RADIUS_MIN = 40;
export const RADIUS_MAX = 400;
export const RADIUS_DEFAULT = 128;
const AREA_MIN = Math.round(areaOfRadius(RADIUS_MIN)); // 20,106 m²
const AREA_MAX = Math.round(areaOfRadius(RADIUS_MAX)); // 2,010,619 m²

/** Growth that puts the default world at R ≈ 128 m, A ≈ 206,000 m². */
export const DEFAULT_GROWTH = Math.round(growthForArea(areaOfRadius(RADIUS_DEFAULT), AREA_MIN, AREA_MAX) * 1e4) / 1e4;

export const schema = {
  world: {
    seed: int('seed', 'Seed', 412, 0, 9999, 'world'),
    growth: num('g', 'Growth', DEFAULT_GROWTH, 0, 1, 0.0001, 'live'),
    areaMin: num('amin', 'Area at g = 0', AREA_MIN, 5_000, 400_000, 1, 'live', { unit: 'm²' }),
    areaMax: num('amax', 'Area at g = 1', AREA_MAX, 50_000, 5_000_000, 1, 'live', { unit: 'm²' }),
    bloom: num('b', 'Bloom', 1, 0, 1, 0.001, 'live'),
  },
  view: {
    mode: choice('cam', 'Camera', ['overview', 'wander'], 'wander', 'live'),
    visualRadius: num('rv', 'Visual radius', 60, 20, 400, 1, 'live', { unit: 'm' }),
  },
  terrain: {
    roll: num('roll', 'Mineral islands', 1.4, 0, 4, 0.01, 'terrain', { unit: 'm' }),
    hummocks: num('hum', 'Gravel banks', 0.2, 0, 1.5, 0.01, 'terrain', { unit: 'm' }),
    wetlands: num('wet', 'Mirror basins', 0.78, 0, 0.9, 0.01, 'terrain', { hidden: true }),
    waterLevel: num('lvl', 'Water level', 0.05, -1, 1, 0.01, 'terrain', { unit: 'm', hidden: true }),
    grain: num('grn', 'Grain', 0.35, 0, 1, 0.01, 'terrain'),
  },
  grass: {
    density: num('gd', 'Density', 0, 0, 1200, 1, 'life', { unit: '/m²' }),
    height: num('gh', 'Height', 0.12, 0.08, 1.2, 0.01, 'live', { unit: 'm' }),
    nearRadius: num('gr', 'Blade radius', 22, 6, 60, 0.5, 'life', { unit: 'm' }),
  },
  flowers: {
    density: num('fd', 'Density', 0, 0, 40, 0.1, 'life', { unit: '/m²' }),
    patchiness: num('fpt', 'Patchiness', 0.95, 0, 1, 0.01, 'life'),
    patchSize: num('fps', 'Patch size', 13, 3, 40, 0.5, 'life', { unit: 'm' }),
    sizeVariation: num('fsv', 'Size variation', 0.6, 0, 1, 0.01, 'life'),
    colourVariation: num('fcv', 'Colour variation', 0.65, 0, 1, 0.01, 'life'),
    pink: num('fp', 'Lilac seed cups', 0.2, 0, 1, 0.01, 'life'),
    star: num('fs', 'Ivory petals', 0.75, 0, 1, 0.01, 'life'),
    yellow: num('fy', 'Seed heads', 0.05, 0, 1, 0.01, 'life'),
    blue: num('fb', 'Blue clusters', 0, 0, 1, 0.01, 'life'),
  },
  water: {
    depthTint: num('dt', 'Depth tint', 0.65, 0, 1, 0.01, 'live'),
    reflection: num('wr', 'Sky reflection', 0.85, 0, 1, 0.01, 'live'),
    glints: num('wgl', 'Glints', 0.35, 0, 1, 0.01, 'live'),
    lilyPads: num('wlp', 'Lily pads', 0, 0, 1, 0.01, 'live'),
  },
  wind: {
    strength: num('ws', 'Strength', 0.22, 0, 1, 0.01, 'live'),
    direction: num('wd', 'Direction', 64, 0, 360, 1, 'live', { unit: '°' }),
    gustiness: num('wg', 'Gustiness', 0.28, 0, 1, 0.01, 'live'),
    sheen: num('wsh', 'Sheen', 0.5, 0, 1, 0.01, 'live'),
  },
  clouds: {
    coverage: num('cc', 'Coverage', 0.43, 0, 1, 0.01, 'life'),
    altitude: num('ca', 'Altitude', 18.5, 1, 40, 0.5, 'live', { unit: 'm' }),
    speed: num('cs', 'Speed', 0.4, 0, 1, 0.01, 'live'),
    shadow: num('csh', 'Shadow', 0.24, 0, 1, 0.01, 'live'),
  },
  muse: {
    show: bool('mu', 'Show Muse', true, 'live'),
    model: choice('mm', 'Body', ['tpose6', 'tpose5', 'tpose2', 'tpose', 'sculpt', 'field'], 'tpose6', 'live'),
  },
  light: {
    // one light for now (late morning); dawn and golden hour are kept in the palette for later
    timeOfDay: num('tod', 'Time of day', 17.4, 5.5, 19, 0.05, 'live', { unit: 'h' }),
  },
  style: {
    toonBands: int('tb', 'Toon bands', 3, 2, 5, 'live'),
    bandSoftness: num('bs', 'Band softness', 0.08, 0, 0.3, 0.005, 'live'),
    fogDensity: num('fog', 'Aerial haze', 0.13, 0, 1, 0.01, 'live'),
    grain: num('gn', 'Paper grain', 0.004, 0, 0.1, 0.001, 'live'),
    contrast: num('ct', 'Contrast', 1.1, 0.8, 1.4, 0.01, 'live'),
    brightness: num('br', 'Brightness', 1.0, 0.7, 1.2, 0.01, 'live'),
  },
  quality: {
    tier: choice('q', 'Tier', ['auto', 'low', 'medium', 'high'], 'auto', 'quality'),
  },
  ui: {
    hud: bool('hud', 'Perf HUD', false, 'ui'),
    postcard: bool('pc', 'Postcard', false, 'ui'),
    debug: choice('dbg', 'Debug view', ['off', 'chunks', 'morph', 'normals'], 'off', 'ui'),
  },
} as const;

export type Schema = typeof schema;
export type GroupName = keyof Schema;
type ValueOf<F> = F extends ChoiceField<infer T> ? T : F extends NumberField ? number : F extends BoolField ? boolean : never;
export type Params = { -readonly [G in GroupName]: { -readonly [K in keyof Schema[G]]: ValueOf<Schema[G][K]> } };
export type ParamPatch = { [G in GroupName]?: Partial<Params[G]> };
export type ParamPath = { [G in GroupName]: `${G}.${Extract<keyof Schema[G], string>}` }[GroupName];
export type ParamValue = number | string | boolean;

export interface FieldEntry {
  readonly path: ParamPath;
  readonly group: GroupName;
  readonly key: string;
  readonly field: Field;
}

/** Every field in schema order. */
export const fields: readonly FieldEntry[] = (Object.keys(schema) as GroupName[]).flatMap((group) =>
  Object.entries(schema[group] as Record<string, Field>).map(([key, field]) => ({
    path: `${group}.${key}` as ParamPath,
    group,
    key,
    field,
  })),
);

const byPath = new Map<string, FieldEntry>(fields.map((e) => [e.path, e]));
const byUrl = new Map<string, FieldEntry>(fields.map((e) => [e.field.url, e]));

export function fieldAt(path: ParamPath): FieldEntry {
  const entry = byPath.get(path);
  if (!entry) throw new Error(`unknown parameter ${path}`);
  return entry;
}

export function fieldForUrlKey(key: string): FieldEntry | undefined {
  return byUrl.get(key);
}

export function defaultParams(): Params {
  const out: Record<string, Record<string, ParamValue>> = {};
  for (const e of fields) (out[e.group] ??= {})[e.key] = e.field.def;
  return out as unknown as Params;
}

/** Parse, validate and clamp a raw value for a field; undefined when unusable. */
export function coerce(field: Field, raw: unknown): ParamValue | undefined {
  switch (field.kind) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return undefined;
      const c = Math.min(field.max, Math.max(field.min, n));
      return field.int ? Math.round(c) : c;
    }
    case 'choice':
      return typeof raw === 'string' && field.options.includes(raw) ? raw : undefined;
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === '1' || raw === 'true') return true;
      if (raw === '0' || raw === 'false') return false;
      return undefined;
  }
}

/** Decimal places implied by a step: 0.0001 → 4, 0.005 → 3, 1 → 0. */
export function stepDecimals(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

/** Canonical text form used in the URL. */
export function formatValue(field: Field, value: ParamValue): string {
  if (field.kind === 'number') return String(Number((value as number).toFixed(stepDecimals(field.step))));
  if (field.kind === 'bool') return value ? '1' : '0';
  return String(value);
}

/** Area bounds keep a little headroom so R(g) stays strictly increasing. */
const AREA_GAP = 1.05;

export const presets = {
  'Lantern Reed Gardens': {},
  Seedling: { world: { growth: 0, bloom: 0.2 } },
  'Wide world': { world: { growth: 1, bloom: 1 } },
  'Morning mist': { clouds: { coverage: 0.38 }, light: { timeOfDay: 7.5 } },
  Gusty: { wind: { strength: 0.85, gustiness: 0.9 }, clouds: { speed: 0.7, coverage: 0.55 } },
} satisfies Record<string, ParamPatch>;

export type PresetName = keyof typeof presets;

/** Fields a preset or reset leaves alone. */
const PRESERVED: readonly ParamPath[] = ['world.seed', 'quality.tier', 'ui.hud', 'ui.postcard'];

type Listener = (changed: ReadonlySet<ParamPath>) => void;

export class ParamStore {
  readonly values: Params = defaultParams();
  private readonly listeners = new Set<Listener>();
  private pending = new Set<ParamPath>();
  private flushQueued = false;

  get(path: ParamPath): ParamValue {
    const e = fieldAt(path);
    return (this.values[e.group] as Record<string, ParamValue>)[e.key];
  }

  /** Coerces and clamps; returns true when the stored value changed. */
  set(path: ParamPath, raw: unknown): boolean {
    return this.write(path, raw, true);
  }

  private write(path: ParamPath, raw: unknown, constrained: boolean): boolean {
    const e = byPath.get(path);
    if (!e) return false;
    let v = coerce(e.field, raw);
    if (v === undefined) return false;
    if (constrained) v = this.constrain(path, v);
    const group = this.values[e.group] as Record<string, ParamValue>;
    if (group[e.key] === v) return false;
    group[e.key] = v;
    this.mark(path);
    return true;
  }

  patch(patch: ParamPatch): void {
    for (const group of Object.keys(patch) as GroupName[]) {
      const values = patch[group] as Record<string, unknown> | undefined;
      if (!values) continue;
      for (const [key, v] of Object.entries(values)) this.set(`${group}.${key}` as ParamPath, v);
    }
  }

  /** Back to defaults, keeping the seed, quality tier and interface toggles. */
  reset(): void {
    for (const e of fields) if (!PRESERVED.includes(e.path)) this.set(e.path, e.field.def);
  }

  applyPreset(name: PresetName): void {
    this.reset();
    this.patch(presets[name]);
  }

  /** `url=value` pairs for every non-default field, in schema order. */
  toQuery(): string {
    const parts: string[] = [];
    for (const e of fields) {
      const value = formatValue(e.field, this.get(e.path));
      if (value !== formatValue(e.field, e.field.def)) parts.push(`${e.field.url}=${value}`);
    }
    return parts.join('&');
  }

  /**
   * Apply URL state. Fields missing from `query` return to their defaults, so
   * the hash fully describes the world. Unknown keys and bad values are ignored.
   */
  applyQuery(query: ReadonlyMap<string, string>): void {
    for (const e of fields) {
      const raw = query.get(e.field.url);
      // The area pair is written unconstrained and fixed up together below,
      // so the order of the two keys cannot clamp one against a stale other.
      const constrained = e.path !== 'world.areaMin' && e.path !== 'world.areaMax';
      if (raw === undefined || coerce(e.field, raw) === undefined) this.write(e.path, e.field.def, constrained);
      else this.write(e.path, raw, constrained);
    }
    this.set('world.areaMax', this.values.world.areaMax);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Deliver pending changes now (normally batched to a microtask). */
  flush(): void {
    this.flushQueued = false;
    if (this.pending.size === 0) return;
    const changed = this.pending;
    this.pending = new Set();
    for (const fn of this.listeners) fn(changed);
  }

  private mark(path: ParamPath): void {
    this.pending.add(path);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  private constrain(path: ParamPath, v: ParamValue): ParamValue {
    const w = this.values.world;
    if (path === 'world.areaMin') return Math.min(v as number, w.areaMax / AREA_GAP);
    if (path === 'world.areaMax') return Math.max(v as number, w.areaMin * AREA_GAP);
    return v;
  }
}
