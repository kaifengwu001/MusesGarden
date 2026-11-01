import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCellSample } from '../../terraces/cells';
import { PLOT_FLAT, PLOT_TERRACE, TERRACE } from '../../terraces/plots';
import { createTerraceSample, generateTerraceLayout, TerraceTerrain, type TerraceSample } from '../../terraces/terrain';

// The terraces' plots (plots.ts, the CPU twin of plots.glsl): a paddy is
// level wherever you stand in it, every wall steps up to the floor above, a
// paddy two levels wide stands between walls half again as tall, the bunds
// stand over the water, and the flats are plots, not bands.

const terrain = new TerraceTerrain(generateTerraceLayout(7));
terrain.update(128, { hills: 18, forest: 0.15 }, 1);
const R = terrain.radius;

/** Evenly spread directions (Fibonacci sphere). */
function sphereDesign(n: number): Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    return new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
  });
}

const points = sphereDesign(900);
const samples = points.map((d) => terrain.terraceAt(d, createTerraceSample()));
const tame = (s: TerraceSample): boolean => s.wild < 0.35;

describe('terraces', () => {
  it('has hills of terraces, forest and flat valley floors all three', () => {
    const terraced = samples.filter((s) => tame(s) && s.kind === PLOT_TERRACE).length;
    const flats = samples.filter((s) => tame(s) && s.kind === PLOT_FLAT).length;
    const wild = samples.filter((s) => s.wild > 0.5).length;
    expect(terraced / samples.length).toBeGreaterThan(0.25);
    expect(flats / samples.length).toBeGreaterThan(0.04);
    expect(wild / samples.length).toBeGreaterThan(0.2);
  });

  it('keeps every paddy level: a step away within the same paddy, the same floor', () => {
    const near = createTerraceSample();
    const q = new Vector3();
    let checked = 0;
    for (const [k, s] of samples.entries()) {
      if (!tame(s)) continue;
      for (const [dx, dy] of [
        [0.3, 0],
        [0, 0.3],
        [-0.3, 0.2],
      ]) {
        q.copy(points[k]).add(new Vector3(dx / R, dy / R, 0)).normalize();
        terrain.terraceAt(q, near);
        if (near.id !== s.id || near.kind !== s.kind || near.wild >= 0.35) continue;
        expect(near.floorH).toBeCloseTo(s.floorH, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('steps every wall up to the floor above, a wide paddy between walls half again as tall', () => {
    let wide = 0;
    const cell = createCellSample();
    for (const [k, s] of samples.entries()) {
      if (!tame(s) || s.kind !== PLOT_TERRACE) continue;
      expect(s.above).toBeGreaterThan(s.floorH);
      expect(s.floorH).toBeGreaterThan(s.below);
      // a floor lies midway between its walls (in levels), so a band two levels wide has taller walls
      if (s.hi - s.lo > 1.6) {
        wide++;
        const riser = terrain.plots.riser(s.cell, Math.max(terrain.cells.at(points[k], cell).slope, 0.004));
        expect(s.above - s.floorH).toBeGreaterThan(1.25 * riser);
        expect(s.floorH - s.below).toBeGreaterThan(1.25 * riser);
      }
    }
    expect(wide).toBeGreaterThan(5);
  });

  it('stands its bunds over the water in every paddy', () => {
    for (const s of samples) {
      if (!tame(s) || s.water < -1e3) continue;
      expect(s.floorH + TERRACE.bundHeight).toBeGreaterThan(s.water + 0.02);
      expect(s.crossTop).toBeGreaterThan(s.water + 0.02);
    }
  });

  it('grows the crop to different heights, paddy by paddy', () => {
    const heights = new Set(samples.filter((s) => tame(s) && s.crop.height > 0).map((s) => s.crop.height.toFixed(2)));
    expect(heights.size).toBeGreaterThan(40);
  });
});
