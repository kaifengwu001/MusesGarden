import { describe, expect, it } from 'vitest';
import { parseHash } from '../../core/hashSync';
import { coerce, fieldAt, fields, formatValue, ParamStore, presets, stepDecimals, type GroupName, type ParamValue } from '../../params';

/** Deterministic pseudo-random values for round-trip tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomValue(e: (typeof fields)[number], rand: () => number): ParamValue {
  const f = e.field;
  if (f.kind === 'number') return f.min + (f.max - f.min) * rand();
  if (f.kind === 'choice') return f.options[Math.floor(rand() * f.options.length)];
  return rand() < 0.5;
}

describe('parameter schema', () => {
  it('has a unique URL key for every field', () => {
    const keys = fields.map((e) => e.field.url);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves the hash keys used by other state free', () => {
    const keys = new Set(fields.map((e) => e.field.url));
    for (const reserved of ['t', 'pose']) expect(keys.has(reserved)).toBe(false);
  });

  it('keeps every default inside its range', () => {
    for (const { field: f } of fields) {
      if (f.kind === 'number') {
        expect(f.def).toBeGreaterThanOrEqual(f.min);
        expect(f.def).toBeLessThanOrEqual(f.max);
        if (f.int) expect(Number.isInteger(f.def)).toBe(true);
      } else if (f.kind === 'choice') {
        expect(f.options).toContain(f.def);
      }
    }
  });

  it('clamps, rounds and rejects', () => {
    const growth = fieldAt('world.growth').field;
    const seed = fieldAt('world.seed').field;
    const tier = fieldAt('quality.tier').field;
    const hud = fieldAt('ui.hud').field;
    expect(coerce(growth, '1.7')).toBe(1);
    expect(coerce(growth, -3)).toBe(0);
    expect(coerce(growth, 'abc')).toBeUndefined();
    expect(coerce(growth, '')).toBeUndefined();
    expect(coerce(seed, '41.6')).toBe(42);
    expect(coerce(tier, 'ultra')).toBeUndefined();
    expect(coerce(tier, 'low')).toBe('low');
    expect(coerce(hud, '1')).toBe(true);
    expect(coerce(hud, 'yes')).toBeUndefined();
  });

  it('derives URL precision from the step', () => {
    expect(stepDecimals(0.0001)).toBe(4);
    expect(stepDecimals(0.005)).toBe(3);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(1)).toBe(0);
  });
});

describe('URL hash state', () => {
  it('writes nothing for the default world', () => {
    expect(new ParamStore().toQuery()).toBe('');
  });

  it('writes only non-default values, in canonical form', () => {
    const store = new ParamStore();
    store.set('world.seed', 7);
    store.set('world.growth', 0.123456);
    expect(store.toQuery()).toBe('seed=7&g=0.1235');
  });

  it('round-trips every field', () => {
    const rand = lcg(412);
    for (let trial = 0; trial < 25; trial++) {
      const a = new ParamStore();
      for (const e of fields) a.set(e.path, randomValue(e, rand));
      const b = new ParamStore();
      b.applyQuery(parseHash(`#${a.toQuery()}`));
      for (const e of fields) expect(formatValue(e.field, b.get(e.path)), e.path).toBe(formatValue(e.field, a.get(e.path)));
    }
  });

  it('returns keys missing from the hash to their defaults', () => {
    const store = new ParamStore();
    store.set('world.seed', 99);
    store.set('wind.strength', 0.9);
    store.applyQuery(parseHash('#ws=0.2'));
    expect(store.values.world.seed).toBe(412);
    expect(store.values.wind.strength).toBe(0.2);
  });

  it('ignores unknown keys and malformed pairs', () => {
    const store = new ParamStore();
    store.applyQuery(parseHash('#nope=1&&g=0.5&%E0%A4%A=2&seed=abc'));
    expect(store.values.world.growth).toBe(0.5);
    expect(store.values.world.seed).toBe(412);
  });

  it('keeps the area pair ordered whatever order it arrives in', () => {
    const store = new ParamStore();
    store.applyQuery(parseHash('#amax=60000'));
    store.applyQuery(parseHash('#amin=100000&amax=2000000'));
    expect(store.values.world.areaMin).toBe(100000);
    expect(store.values.world.areaMax).toBe(2000000);
    store.applyQuery(parseHash('#amin=300000&amax=100000'));
    expect(store.values.world.areaMax).toBeGreaterThan(store.values.world.areaMin);
  });

  it('batches change notifications', async () => {
    const store = new ParamStore();
    const batches: string[][] = [];
    store.subscribe((changed) => batches.push([...changed]));
    store.set('world.seed', 1);
    store.set('world.bloom', 0.1);
    store.set('world.bloom', 0.1); // no-op
    await Promise.resolve();
    expect(batches).toEqual([['world.seed', 'world.bloom']]);
  });
});

describe('presets', () => {
  it('only name known fields, with values inside their ranges', () => {
    for (const [name, patch] of Object.entries(presets)) {
      for (const [group, values] of Object.entries(patch as Record<string, Record<string, unknown>>)) {
        for (const [key, value] of Object.entries(values)) {
          const e = fieldAt(`${group as GroupName}.${key}` as Parameters<typeof fieldAt>[0]);
          expect(coerce(e.field, value), `${name}: ${e.path}`).toBe(value);
        }
      }
    }
  });

  it('keep the seed and reset everything else first', () => {
    const store = new ParamStore();
    store.set('world.seed', 1234);
    store.set('wind.strength', 0.95);
    store.applyPreset('Golden hour');
    expect(store.values.world.seed).toBe(1234);
    expect(store.values.wind.strength).toBe(0.3);
    expect(store.values.light.timeOfDay).toBe(18.4);
    store.applyPreset('Spring meadow');
    expect(store.toQuery()).toBe('seed=1234');
  });
});
