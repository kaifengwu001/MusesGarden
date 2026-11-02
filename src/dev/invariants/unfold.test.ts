import type { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Veil, VEIL } from '../../life/veil';
import { DEFAULT_GROWTH, schema } from '../../params';
import { FIRST_PLANET } from '../../planet/firstPlanet';
import { generateLayout } from '../../planet/terrain';
import { unfoldBloom, unfoldGrowth, UNVEILED, unveiling } from '../../planet/unfold';
import { CameraRig } from '../../view/camera';

const angle = (a: Vector3, b: Vector3): number => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));

function veilOf(seed: number): { veil: Veil; hut: Vector3 } {
  const hut = generateLayout(seed).cottage;
  const veil = new Veil();
  veil.build(seed, hut);
  return { veil, hut };
}

const standing = (veil: Veil, progress: number): number => veil.heaps.filter((h) => Veil.stands(h, progress) && h.lobes.some((_, k) => Veil.lobe(h, k, progress) > 0)).length;

describe('the unfolding (planet/unfold.ts)', () => {
  it('leaves the first planet as tuned by default: unveiled, all in flower, at R 128 m (see CLAUDE.md)', () => {
    expect(schema.world.unfold.def).toBe(UNVEILED);
    expect(unveiling(UNVEILED)).toBe(1);
    // (so the bloom is the season's own: Math.min(bloom, 1) is bloom, to the bit)
    expect(unfoldBloom(UNVEILED)).toBe(1);
    expect(unfoldGrowth(UNVEILED)).toBe(DEFAULT_GROWTH);
    expect(FIRST_PLANET.growth).toBe(DEFAULT_GROWTH);
  });

  it('starts under the veil with no flowers, at the meadow’s tuned size', () => {
    expect(unveiling(0)).toBe(0);
    expect(unfoldBloom(0)).toBe(0);
    for (let i = 0; i <= 50; i++) expect(unfoldGrowth((i / 50) * UNVEILED)).toBe(FIRST_PLANET.growth);
  });

  it('unveils and brings the flowers out steadily, then grows the planet to the largest', () => {
    let veil = -Infinity;
    let bloom = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const u = (i / 100) * UNVEILED;
      expect(unveiling(u)).toBeGreaterThan(veil);
      expect(unfoldBloom(u)).toBeGreaterThan(bloom);
      veil = unveiling(u);
      bloom = unfoldBloom(u);
    }
    let g = unfoldGrowth(UNVEILED);
    for (let i = 1; i <= 100; i++) {
      const u = UNVEILED + (i / 100) * (1 - UNVEILED);
      expect(unfoldGrowth(u)).toBeGreaterThan(g);
      expect(unveiling(u)).toBe(1);
      g = unfoldGrowth(u);
    }
    expect(unfoldGrowth(1)).toBe(1);
  });
});

describe('the veil (life/veil.ts)', () => {
  it('lays out the same veil for the same planet', () => {
    const a = veilOf(412).veil;
    const b = veilOf(412).veil;
    expect(a.heaps.length).toBe(b.heaps.length);
    a.heaps.forEach((h, i) => {
      expect(h.dir.toArray()).toEqual(b.heaps[i].dir.toArray());
      expect(h.turn).toBe(b.heaps[i].turn);
    });
  });

  it('covers all of the planet but a little ground round the hut, before anything unfolds', () => {
    for (const seed of [412, 7, 2024]) {
      const { veil, hut } = veilOf(seed);
      const open = veil.heaps.filter((h) => !Veil.stands(h, 0));
      // the ground round the hut is clear, and only a little more
      for (const h of veil.heaps) if (angle(h.dir, hut) * 128 < VEIL.core) expect(Veil.stands(h, 0)).toBe(false);
      expect(open.length / veil.heaps.length).toBeLessThan(VEIL.clear + 0.01);
      // the rest stands whole
      for (const h of veil.heaps) if (Veil.stands(h, 0)) for (let k = 0; k < 8; k++) expect(Veil.lobe(h, k, 0)).toBe(1);
    }
  });

  it('clears for good by the time the planet is unveiled, and only ever clears', () => {
    const { veil } = veilOf(412);
    expect(standing(veil, 1)).toBe(0);
    let last = Infinity;
    for (let i = 0; i <= 200; i++) {
      const s = i / 200;
      const n = standing(veil, s);
      expect(n).toBeLessThanOrEqual(last);
      last = n;
      for (const h of veil.heaps.slice(0, 40)) for (let k = 0; k < 8; k++) expect(Veil.lobe(h, k, s)).toBeLessThanOrEqual(Veil.lobe(h, k, Math.max(0, s - 0.005)));
    }
  });

  it('clears out from the hut, raggedly: by and large nearer first, but not in rings', () => {
    const { veil, hut } = veilOf(412);
    const going = veil.heaps.filter((h) => h.turn >= 0);
    // the mean distance from the hut of each tenth of the veil to clear grows tenth by tenth
    const tenths = Array.from({ length: 10 }, (_, t) => going.filter((h) => h.turn >= (t / 10) * 0.84 && h.turn < ((t + 1) / 10) * 0.84 + (t === 9 ? 1 : 0)));
    const means = tenths.map((hs) => hs.reduce((a, h) => a + angle(h.dir, hut), 0) / hs.length);
    for (let t = 1; t < 10; t++) expect(means[t]).toBeGreaterThan(means[t - 1]);
    // and some heaps clear before others nearer the hut (islands behind the edge, holes ahead of it)
    let out = 0;
    for (let i = 1; i < going.length; i++) if (angle(going[i].dir, hut) < angle(going[i - 1].dir, hut)) out++;
    expect(out / going.length).toBeGreaterThan(0.2);
  });
});

describe('the camera as the planet grows under it (CameraRig.holdThrough)', () => {
  const ground = (): number => 0;

  it('holds its distance from the centre in orbit, so the planet grows in the window', () => {
    const rig = new CameraRig();
    rig.setZoom(0, true);
    rig.update(1 / 60, 128, 1.6, ground);
    const before = rig.camera.position.length();
    let r = 128;
    for (const next of [150, 200, 260, 330, 400]) {
      rig.holdThrough(r, next);
      rig.update(1 / 60, next, 1.6, ground);
      r = next;
      expect(rig.camera.position.length()).toBeCloseTo(before, 6);
    }
    // and back: at R 128 it is in orbit as it was
    for (const next of [330, 200, 128]) {
      rig.holdThrough(r, next);
      rig.update(1 / 60, next, 1.6, ground);
      r = next;
    }
    expect(rig.zoom).toBeCloseTo(0, 9);
    expect(rig.camera.position.length()).toBeCloseTo(before, 6);
  });

  it('keeps its height over the meadow at the bird’s-eye and standing stops', () => {
    for (const zoom of [0.35, 0.8301, 1]) {
      const rig = new CameraRig();
      rig.setZoom(zoom, true);
      rig.update(1 / 60, 128, 1.6, ground);
      const height = rig.altitude;
      rig.holdThrough(128, 400);
      rig.update(1 / 60, 400, 1.6, ground);
      expect(rig.altitude).toBeCloseTo(height, 6);
    }
  });
});
