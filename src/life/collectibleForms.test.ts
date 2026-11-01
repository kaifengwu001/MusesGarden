import { describe, expect, it } from 'vitest';
import { BUDGET, buildMesh, familiesFor, formOf, HEIGHT, meshBytes, PART, unpackShape, type Collectible, type CollectibleMesh, type Family, type Form, type Ground } from './collectibleForms';

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

const find = (id: string, kin: string | null, open = true): Collectible => ({ id, dir: [0, 1, 0], kin, open });

const MEADOW: Ground = { shore: 12, wet: 0.3, lush: 0.7 };
const WET: Ground = { shore: 12, wet: 0.8, lush: 0.7 };
const THIN: Ground = { shore: 12, wet: 0.3, lush: 0.1 };
const SHORE: Ground = { shore: 1, wet: 0.5, lush: 0.5 };
const GROUNDS: Record<Family, readonly Ground[]> = { bloom: [MEADOW, THIN], spire: [WET], fern: [MEADOW, WET], reed: [SHORE], stone: [THIN, SHORE] };

/** n finds of one family, each of its own topic. */
function familyFinds(family: Family, n: number, open = true): Form[] {
  const out: Form[] = [];
  for (let i = 0; out.length < n; i++) {
    for (const g of GROUNDS[family]) {
      const f = formOf(find(`${family}-${i}`, `topic ${family} ${i}`, open), g);
      if (f.family === family && out.length < n) out.push(f);
    }
  }
  return out;
}

/** Finds anywhere: random ids, topics (some private), grounds and delivery. */
function randomFinds(n: number, seed: number): { forms: Form[]; grounds: Ground[] } {
  const r = random(seed);
  const grounds = Array.from({ length: n }, () => ({ shore: r() * 30 - 2, wet: r(), lush: r() }));
  const forms = grounds.map((g, i) => formOf(find(`find-${seed}-${i}-${r()}`, r() < 0.1 ? null : `topic ${Math.floor(r() * 80)}`, r() < 0.5), g));
  return { forms, grounds };
}

const vertices = (m: CollectibleMesh): number => m.position.length / 3;

/** Vertices per part: what the shader colours, and how many petals, bells or fronds there are. */
function parts(m: CollectibleMesh): number[] {
  const n = Object.keys(PART).map(() => 0);
  for (let v = 0; v < vertices(m); v++) n[unpackShape(m.shape[v * 2]).part]++;
  return n;
}

describe('formOf', () => {
  it('gives the same form for the same find on the same ground', () => {
    const a = randomFinds(200, 1);
    const b = randomFinds(200, 1);
    expect(b.forms).toEqual(a.forms);
    expect(buildMesh(b.forms)).toEqual(buildMesh(a.forms));
  });

  it('draws the family from the two the ground allows, the first about two times in three', () => {
    const { forms, grounds } = randomFinds(1000, 2);
    forms.forEach((f, i) => expect(familiesFor(grounds[i])).toContain(f.family));
    const first = Array.from({ length: 1000 }, (_, i) => formOf(find('x', `topic ${i}`), MEADOW)).filter((f) => f.family === 'bloom').length;
    expect(first / 1000).toBeGreaterThan(0.58);
    expect(first / 1000).toBeLessThan(0.72);
  });

  it('keeps plants 0.6 to 1 m tall and stones 0.35 to 0.6 m', () => {
    for (const f of randomFinds(1000, 3).forms) {
      const [lo, hi] = f.family === 'stone' ? HEIGHT.stone : HEIGHT.plant;
      expect(f.height).toBeGreaterThanOrEqual(lo);
      expect(f.height).toBeLessThanOrEqual(hi);
    }
  });

  it('gives every find of one topic the same family, colour and part counts on one ground', () => {
    for (const g of [MEADOW, WET, THIN, SHORE]) {
      const kin = Array.from({ length: 30 }, (_, i) => formOf(find(`id ${i}`, 'the tides'), g));
      for (const f of kin) {
        expect(f.family).toBe(kin[0].family);
        expect(f.colour).toEqual(kin[0].colour);
        expect(f.kin).toBe(kin[0].kin);
        expect(parts(buildMesh([f]))).toEqual(parts(buildMesh([kin[0]])));
      }
    }
    // and different topics do differ
    const topics = Array.from({ length: 40 }, (_, i) => formOf(find('one id', `topic ${i}`), MEADOW));
    expect(new Set(topics.map((f) => JSON.stringify(f.colour))).size).toBeGreaterThan(3);
    expect(new Set(topics.map((f) => parts(buildMesh([f])).join())).size).toBeGreaterThan(3);
  });

  it('makes a private find its own kin', () => {
    const a = formOf(find('private a', null), MEADOW);
    const b = formOf(find('private b', null), MEADOW);
    expect(a.kin).toBe(a.self);
    expect(b.kin).toBe(b.self);
    expect(a.kin).not.toBe(b.kin);
  });
});

describe('buildMesh', () => {
  it('never gives two finds the same geometry, even of one topic on one ground', () => {
    for (const g of [MEADOW, WET, THIN, SHORE]) {
      const meshes = Array.from({ length: 400 }, (_, i) => buildMesh([formOf(find(`find ${i}`, 'one topic'), g)]));
      expect(new Set(meshes.map((m) => m.position.join())).size).toBe(400);
    }
  });

  it(`keeps every find within ${BUDGET.vertices} vertices`, () => {
    for (const family of ['bloom', 'spire', 'fern', 'reed', 'stone'] as const) {
      for (const open of [true, false]) {
        for (const f of familyFinds(family, 300, open)) expect(vertices(buildMesh([f]))).toBeLessThanOrEqual(BUDGET.vertices);
      }
    }
  });

  it('fits 400 finds in the GPU budget, wherever they grow', () => {
    for (const seed of [4, 5, 6]) expect(meshBytes(buildMesh(randomFinds(400, seed).forms))).toBeLessThanOrEqual(BUDGET.bytesFor400);
    for (const family of ['bloom', 'spire', 'fern', 'reed', 'stone'] as const) {
      expect(meshBytes(buildMesh(familyFinds(family, 400)))).toBeLessThanOrEqual(BUDGET.bytesFor400);
    }
  });

  it('opens a bloom from its bud, and leaves a stone as it is', () => {
    const [bloom] = familyFinds('bloom', 1);
    const bud = buildMesh([{ ...bloom, open: false }]);
    const open = buildMesh([bloom]);
    expect(Array.from(bud.position)).not.toEqual(Array.from(open.position));
    expect(parts(bud)[PART.petal]).toBe(0);
    expect(parts(bud)[PART.bud]).toBeGreaterThan(0);
    expect(parts(open)[PART.petal]).toBeGreaterThan(0);
    expect(parts(open)[PART.centre]).toBeGreaterThan(0);

    const [stone] = familyFinds('stone', 1);
    expect(buildMesh([{ ...stone, open: false }])).toEqual(buildMesh([stone]));
  });

  it('keeps every triangle inside one find', () => {
    const { forms } = randomFinds(400, 7);
    const m = buildMesh(forms);
    const anchor = (v: number): number => m.shape[v * 2 + 1];
    expect(m.index.length % 3).toBe(0);
    for (let i = 0; i < m.index.length; i += 3) {
      const [a, b, c] = [m.index[i], m.index[i + 1], m.index[i + 2]];
      for (const v of [a, b, c]) expect(v).toBeLessThan(vertices(m));
      expect(anchor(b)).toBe(anchor(a));
      expect(anchor(c)).toBe(anchor(a));
    }
    // every find has geometry, and only its own index
    expect(new Set(Array.from({ length: vertices(m) }, (_, v) => anchor(v)))).toEqual(new Set(forms.map((_, i) => i)));
  });

  it('gives every vertex a unit normal', () => {
    const m = buildMesh(randomFinds(400, 8).forms);
    for (let v = 0; v < vertices(m); v++) {
      const [x, y, z, w] = [m.normal[v * 4], m.normal[v * 4 + 1], m.normal[v * 4 + 2], m.normal[v * 4 + 3]];
      expect(Math.hypot(x, y, z) / 127).toBeCloseTo(1, 1);
      expect(w).toBe(0);
    }
  });

  it('stands on the ground: nothing deeper than 5 cm, and its top near the find height', () => {
    for (const f of randomFinds(1000, 9).forms) {
      const m = buildMesh([f]);
      let [low, high] = [Infinity, -Infinity];
      for (let v = 0; v < vertices(m); v++) [low, high] = [Math.min(low, m.position[v * 3 + 1]), Math.max(high, m.position[v * 3 + 1])];
      expect(low).toBeGreaterThanOrEqual(-0.05);
      // closed buds and fiddleheads stand lower than they will
      if (f.open || f.family === 'stone') expect(Math.abs(high - f.height) / f.height).toBeLessThan(0.1);
    }
  });

  it('marks stones as stone that the wind leaves still, and grows plants up from the ground', () => {
    for (const f of randomFinds(400, 10).forms) {
      const m = buildMesh([f]);
      const shapes = Array.from({ length: vertices(m) }, (_, v) => unpackShape(m.shape[v * 2]));
      if (f.family === 'stone') {
        for (const s of shapes) expect(s).toEqual({ part: PART.stone, t: 0 });
      } else {
        expect(shapes.some((s) => s.part === PART.stone)).toBe(false);
        expect(Math.min(...shapes.map((s) => s.t))).toBe(0);
        expect(Math.max(...shapes.map((s) => s.t))).toBeGreaterThan(0.6);
      }
    }
  });
});
