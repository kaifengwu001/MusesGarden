import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { areaElement, areaElementUv, AREA_ELEMENT_UV_MAX, faceOf, faceToSphere, sphereToFace, type FacePoint } from '../../planet/cubesphere';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('spherified cube', () => {
  const v = new Vector3();
  const fp: FacePoint = { face: 0, a: 0, b: 0 };

  it('maps every face onto the unit sphere, on its own side', () => {
    const rand = lcg(1);
    for (let face = 0; face < 6; face++) {
      for (let k = 0; k < 500; k++) {
        faceToSphere(face, rand() * 2 - 1, rand() * 2 - 1, v);
        expect(v.length()).toBeCloseTo(1, 12);
        expect(faceOf(v.x, v.y, v.z)).toBe(face);
      }
    }
  });

  it('inverts in closed form', () => {
    const rand = lcg(2);
    for (let face = 0; face < 6; face++) {
      for (let k = 0; k < 500; k++) {
        const a = rand() * 2 - 1;
        const b = rand() * 2 - 1;
        sphereToFace(faceToSphere(face, a, b, v), fp);
        expect(fp.face).toBe(face);
        expect(fp.a).toBeCloseTo(a, 9);
        expect(fp.b).toBeCloseTo(b, 9);
      }
    }
  });

  it('agrees on shared edges between faces', () => {
    // +Z's right edge (a = 1) is +X's left edge (a = -1), with b the same.
    const w = new Vector3();
    for (let t = -1; t <= 1; t += 0.125) {
      faceToSphere(4, 1, t, v);
      faceToSphere(0, -1, t, w);
      expect(v.distanceTo(w)).toBeLessThan(1e-15);
    }
  });

  it('has an area element that integrates to 4π/6 per face', () => {
    const n = 400;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) sum += areaElement(-1 + (2 * (i + 0.5)) / n, -1 + (2 * (j + 0.5)) / n);
    }
    expect(sum * (2 / n) ** 2).toBeCloseTo((4 * Math.PI) / 6, 5);
  });

  it('matches the finite-difference area element', () => {
    const h = 1e-6;
    const pa = new Vector3();
    const pb = new Vector3();
    const p0 = new Vector3();
    for (const [a, b] of [[0, 0], [0.5, -0.3], [1 - 1e-5, 0], [-0.99, 0.99], [0.2, 0.9]] as const) {
      faceToSphere(2, a, b, p0);
      faceToSphere(2, a + h, b, pa).sub(p0);
      faceToSphere(2, a, b + h, pb).sub(p0);
      expect(pa.cross(pb).length() / (h * h)).toBeCloseTo(areaElement(a, b), 4);
    }
  });

  it('varies by only ×1.33 and never exceeds its stated bound', () => {
    expect(areaElement(0, 0)).toBeCloseTo(0.5, 12);
    expect(areaElement(1, 0)).toBeCloseTo(Math.sqrt(1 / 3), 12);
    expect(areaElement(1, 1)).toBeCloseTo(Math.sqrt(3) / 4, 12);
    const rand = lcg(3);
    for (let k = 0; k < 5000; k++) expect(areaElementUv(rand(), rand())).toBeLessThanOrEqual(AREA_ELEMENT_UV_MAX);
  });
});
