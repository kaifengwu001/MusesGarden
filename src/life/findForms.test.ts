import { Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terrain } from '../planet/terrain';
import { BUDGET, buildMesh, formOf, type Family } from './collectibleForms';
import { FindBeds, MAX_BEDS } from './findBeds';
import { FindForms, octahedral, packForms, type FormLook, type PackedFind } from './findForms';

const FAMILIES: readonly Family[] = ['bloom', 'spire', 'fern', 'reed', 'stone'];

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function randomDir(r: () => number): Vector3 {
  const z = 2 * r() - 1;
  const a = r() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return new Vector3(s * Math.cos(a), s * Math.sin(a), z);
}

/** findForm.glsl's octahedral, on the CPU. */
function unfold(u: number, v: number): Vector3 {
  const d = new Vector3(u, v, 1 - Math.abs(u) - Math.abs(v));
  if (d.z < 0) d.set((1 - Math.abs(v)) * (u >= 0 ? 1 : -1), (1 - Math.abs(u)) * (v >= 0 ? 1 : -1), d.z);
  return d.normalize();
}

/** A planet whose ground is the same everywhere. */
function plainGround(g: { shore: number; wet: number; lush: number }, seed = 7): Terrain {
  return {
    layout: { seed },
    sample: (_dir: Vector3, out: { height: number; water: number; depth: number; clearing: number; wet: number }) => Object.assign(out, { height: 0, water: g.shore, wet: g.wet, depth: 0, clearing: 0 }),
    fields: { lush: () => 2 * g.lush - 1 },
  } as unknown as Terrain;
}

const SHORE = { shore: 1, wet: 0.5, lush: 0.5 };
const MEADOW = { shore: 30, wet: 0.2, lush: 0.8 };

function looks(n: number, seed = 1): FormLook[] {
  const r = random(seed);
  return Array.from({ length: n }, (_, i) => ({
    bed: { find: `find-${seed}-${i}`, basket: 'b', dir: randomDir(r), ground: 1 + r() },
    species: (i % 4) as 0 | 1 | 2 | 3,
    variant: r(),
    topic: `topic ${i % 9}`,
  }));
}

/** What the spheres draw: per find, its index and family, read back from its first vertex. */
function drawn(forms: FindForms): Array<{ index: number; family: number; ground: number }> {
  const firsts = forms.spheres.geometry.getIndex()?.array ?? [];
  const find = forms.specimens.geometry.getAttribute('aFind').array as Int16Array;
  return Array.from(firsts, (v) => ({ index: find[v * 4 + 3] % 4096, family: Math.floor(find[v * 4 + 3] / 4096), ground: find[v * 4 + 2] / 256 }));
}

function garden(): { beds: FindBeds; forms: FindForms } {
  const beds = new FindBeds({});
  return { beds, forms: new FindForms({}, beds) };
}

afterEach(() => vi.unstubAllGlobals());

describe('packForms', () => {
  it('folds a direction to within 2.5 cm on a 400 m planet, a tenth of the hole its bed leaves it', () => {
    const r = random(3);
    for (let i = 0; i < 2000; i++) {
      const d = randomDir(r);
      const [u, v] = octahedral(d);
      const back = unfold(Math.round(u * 32767) / 32767, Math.round(v * 32767) / 32767);
      expect(back.angleTo(d) * 400).toBeLessThan(0.025);
    }
  });

  it('packs each vertex in 20 bytes, so 400 finds stay within the budget on any ground', () => {
    for (const ground of [SHORE, MEADOW, { shore: 30, wet: 0.8, lush: 0.8 }, { shore: 30, wet: 0.2, lush: 0.1 }]) {
      const list = looks(400, 5);
      const forms = list.map((l) => formOf({ id: l.bed.find, dir: [0, 1, 0], kin: l.topic, open: true }, ground));
      const p = packForms(
        buildMesh(forms),
        forms.map((f, i) => ({ dir: list[i].bed.dir, ground: list[i].bed.ground, family: f.family, index: i, look: 0 })),
      );
      const vertices = p.local.length / 4;
      expect((p.local.byteLength + p.normal.byteLength + p.find.byteLength) / vertices).toBe(20);
      expect(p.local.byteLength + p.normal.byteLength + p.find.byteLength + p.index.byteLength).toBeLessThanOrEqual(BUDGET.bytesFor400);
    }
  });

  it('gives every vertex its own find: where, its ground, its family, its index and its look', () => {
    const r = random(9);
    const list = looks(60, 9);
    const finds: PackedFind[] = list.map((l, i) => ({ dir: l.bed.dir, ground: l.bed.ground, family: FAMILIES[i % 5], index: 100 + i, look: Math.floor(r() * 256) }));
    const forms = list.map((l, i) => ({ ...formOf({ id: l.bed.find, dir: [0, 1, 0], kin: l.topic, open: true }, MEADOW), family: finds[i].family }));
    const p = packForms(buildMesh(forms), finds);
    expect(p.firsts[0]).toBe(0);
    expect(p.firsts[finds.length]).toBe(p.local.length / 4);
    finds.forEach((f, k) => {
      expect(p.firsts[k + 1]).toBeGreaterThan(p.firsts[k]);
      for (let v = p.firsts[k]; v < p.firsts[k + 1]; v++) {
        expect(unfold(p.find[v * 4] / 32767, p.find[v * 4 + 1] / 32767).angleTo(f.dir)).toBeLessThan(1e-4);
        expect(p.find[v * 4 + 2] / 256).toBeCloseTo(f.ground, 2);
        expect(p.find[v * 4 + 3]).toBe(FAMILIES.indexOf(f.family) * 4096 + f.index);
        expect(p.normal[v * 4 + 3] + 128).toBe(f.look);
      }
    });
  });
});

describe('FindForms', () => {
  it('draws every find: the newest in their beds, the rest fully grown past them', () => {
    const { beds, forms } = garden();
    const list = looks(MAX_BEDS + 30);
    beds.set(list, 128, new Set());
    forms.set(list, plainGround(MEADOW), new Set());
    const indices = drawn(forms).map((d) => d.index);
    expect(indices).toHaveLength(list.length);
    list.slice(0, MAX_BEDS).forEach((l, i) => expect(indices[i]).toBe(beds.slot(l.bed.find)));
    expect(indices.slice(MAX_BEDS).every((i) => i >= MAX_BEDS)).toBe(true);
    expect(new Set(indices).size).toBe(list.length);
  });

  it('keeps a find not planted yet out of sight until its bed is, and leaves one past the beds out', () => {
    const { beds, forms } = garden();
    const list = looks(MAX_BEDS + 2);
    const hidden = new Set([list[0].bed.find, list[MAX_BEDS + 1].bed.find]);
    beds.set(list, 128, hidden);
    forms.set(list, plainGround(MEADOW), hidden);
    const indices = drawn(forms).map((d) => d.index);
    // the hidden find in a bed stays drawn, waiting on its bed's planting; the one past the beds is left out
    expect(indices).toContain(beds.slot(list[0].bed.find));
    expect(indices).toHaveLength(list.length - 1);
  });

  it('keeps the ground a find first grew on, so its specimen stays itself as the planet changes', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const list = looks(40);
    const first = garden();
    first.beds.set(list, 128, new Set());
    first.forms.set(list, plainGround(SHORE), new Set());
    const shore = drawn(first.forms).map((d) => d.family);
    expect(shore.every((f) => f === FAMILIES.indexOf('reed') || f === FAMILIES.indexOf('stone'))).toBe(true);

    const later = garden();
    later.beds.set(list, 128, new Set());
    later.forms.set(list, plainGround(MEADOW), new Set());
    expect(drawn(later.forms).map((d) => d.family)).toEqual(shore);

    const elsewhere = garden();
    elsewhere.beds.set(list, 128, new Set());
    elsewhere.forms.set(list, plainGround(MEADOW, 8), new Set());
    expect(drawn(elsewhere.forms).map((d) => d.family)).not.toEqual(shore);
  });

  it('moves the same finds to their new ground without growing them again', () => {
    const { beds, forms } = garden();
    const list = looks(20);
    beds.set(list, 128, new Set());
    forms.set(list, plainGround(MEADOW), new Set());
    const geometry = forms.specimens.geometry;
    const raised = list.map((l) => ({ ...l, bed: { ...l.bed, ground: l.bed.ground + 2 } }));
    beds.set(raised, 140, new Set());
    forms.set(raised, plainGround(MEADOW), new Set());
    expect(forms.specimens.geometry).toBe(geometry);
    drawn(forms).forEach((d, i) => expect(d.ground).toBeCloseTo(raised[i].bed.ground, 2));
  });

  it('hands the spheres over from the specimens as the camera rises past the beds', () => {
    const { beds, forms } = garden();
    const list = looks(5);
    beds.set(list, 128, new Set());
    forms.set(list, plainGround(MEADOW), new Set());
    const at = (altitude: number, shown = true): [boolean, boolean, number] => {
      forms.update(altitude, shown);
      return [forms.specimens.visible, forms.spheres.visible, forms.spheresShown()];
    };
    expect(at(10)).toEqual([true, false, 0]);
    expect(at(80)[0]).toBe(true);
    expect(at(80)[2]).toBeGreaterThan(0);
    expect(at(400)).toEqual([false, true, 1]);
    expect(at(400, false)).toEqual([false, false, 0]);
    forms.hover(list[2].bed.find);
    expect(at(10)).toEqual([true, true, 0]);
  });
});
