import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { gnoise } from '../../planet/noise';
import { gnoiseGrad } from '../../terraces/fields';
import { generateTerraceLayout, TerraceTerrain } from '../../terraces/terrain';

// The terraces' slope is the height's own gradient (fields.ts naturalGrad,
// fields.glsl terrain()), worked out from each part's derivative, never from
// differences of heights: the noise's gradient is the noise's, its value
// unchanged, and the natural height's gradient is the one its heights draw,
// through the river's valley, its banks, the soft valley floor and the
// towers' mounds.

/** Evenly spread directions (Fibonacci sphere). */
function sphereDesign(n: number): Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    return new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
  });
}

describe("the terraces' gradient", () => {
  it('gives the noise its own value and its derivative', () => {
    const g = new Vector3();
    const e = 1e-5;
    for (let i = 0; i < 2000; i++) {
      const x = Math.sin(i * 1.3) * 7.3;
      const y = Math.cos(i * 0.7) * 5.1;
      const z = Math.sin(i * 0.37) * 9.7;
      const v = gnoiseGrad(x, y, z, 77, g);
      expect(Math.abs(v - gnoise(x, y, z, 77))).toBeLessThan(1e-9);
      const dx = (gnoise(x + e, y, z, 77) - gnoise(x - e, y, z, 77)) / (2 * e);
      const dy = (gnoise(x, y + e, z, 77) - gnoise(x, y - e, z, 77)) / (2 * e);
      const dz = (gnoise(x, y, z + e, 77) - gnoise(x, y, z - e, 77)) / (2 * e);
      expect(Math.hypot(dx - g.x, dy - g.y, dz - g.z)).toBeLessThan(1e-4);
    }
  });

  it("gives the hills the slope their heights draw, a centimetre each way", () => {
    const terrain = new TerraceTerrain(generateTerraceLayout(7));
    terrain.update(128, { hills: 13, forest: 0.1 }, 1);
    const f = terrain.fields;
    const R = terrain.radius;
    const out = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const p = new Vector3();
    const e = 0.01;
    const at = (d: Vector3, t: Vector3, s: number): number => f.natural(p.copy(d).addScaledVector(t, (s * e) / R).normalize());
    let worst = 0;
    let steep = 0;
    for (const d of sphereDesign(600)) {
      const h = f.naturalGrad(d, out);
      expect(Math.abs(h - f.natural(d))).toBeLessThan(1e-9);
      // (on the planet: no part along the direction)
      expect(Math.abs(out.dot(d))).toBeLessThan(1e-9);
      a.crossVectors(d, Math.abs(d.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
      b.crossVectors(d, a);
      const ga = (at(d, a, 1) - at(d, a, -1)) / (2 * e);
      const gb = (at(d, b, 1) - at(d, b, -1)) / (2 * e);
      worst = Math.max(worst, Math.hypot(ga - out.dot(a), gb - out.dot(b)));
      if (out.length() > 0.3) steep++;
    }
    // (a centimetre's difference itself is off by about the curvature times a centimetre: well under this)
    expect(worst).toBeLessThan(0.002);
    expect(steep).toBeGreaterThan(20);
  });
});
