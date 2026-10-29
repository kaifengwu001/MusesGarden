import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { effectiveVisualRadius, unwarpPoint, warpK, warpNormal, warpPoint, type WarpFrame } from '../../render/warp';

// The CPU mirror of warp.glsl. The GPU side is checked against this in the
// browser picking test (S8); here we pin down the math itself.

function frameAt(radius: number, visualRadius: number, w: number): WarpFrame {
  return { focus: new Vector3(0, radius, 0), up: new Vector3(0, 1, 0), k: warpK(w, radius, visualRadius) };
}

/** A point on the true sphere at geodesic distance s from the focus, toward +x. */
function onSphere(radius: number, s: number, height = 0): Vector3 {
  const a = s / radius;
  return new Vector3(Math.sin(a), Math.cos(a), 0).multiplyScalar(radius + height);
}

describe('tiny-planet warp', () => {
  const f = frameAt(400, 60, 1);

  it('leaves the focus and the up axis through it untouched', () => {
    expect(warpPoint(f, f.focus.clone(), new Vector3()).distanceTo(f.focus)).toBe(0);
    const above = new Vector3(0, 412, 0);
    expect(warpPoint(f, above, new Vector3()).distanceTo(above)).toBe(0);
  });

  it('pulls points down along U by k·d²', () => {
    const p = new Vector3(30, 400, -40); // tangent distance 50 m
    const q = warpPoint(f, p, new Vector3());
    expect(q.x).toBe(p.x);
    expect(q.z).toBe(p.z);
    expect(p.y - q.y).toBeCloseTo(f.k * 2500, 10);
  });

  it('makes the meadow near the focus curve like R_visual, not R', () => {
    for (const s of [2, 5, 10, 15]) {
      const p = onSphere(400, s);
      const q = warpPoint(f, p, new Vector3());
      const d = Math.hypot(q.x, q.z);
      const drop = 400 - q.y;
      // a sphere of radius 60 m drops d²/(2·60) over tangent distance d (parabolic, to ~0.5 %)
      expect(drop / ((d * d) / 120)).toBeCloseTo(1, 2);
    }
  });

  it('is the identity in Overview (w = 0)', () => {
    const o = frameAt(400, 60, 0);
    const p = onSphere(400, 180, 3);
    expect(warpPoint(o, p, new Vector3()).distanceTo(p)).toBe(0);
  });

  it('never uses a visual radius below 0.15 R', () => {
    expect(effectiveVisualRadius(20, 400)).toBe(60);
    expect(effectiveVisualRadius(60, 128)).toBe(60);
    expect(warpK(1, 400, 20)).toBe(warpK(1, 400, 60));
  });

  it('inverts exactly (picking can unwarp what it hits)', () => {
    const r = new Vector3();
    for (let i = 0; i < 200; i++) {
      const p = onSphere(400, i * 3.1, (i % 7) * 1.3).applyAxisAngle(new Vector3(0, 1, 0), i * 0.7);
      const q = warpPoint(f, p, new Vector3());
      expect(unwarpPoint(f, q, r).distanceTo(p)).toBeLessThan(1e-9 * (1 + p.length()));
    }
  });

  it('bends normals to match the bent surface', () => {
    // Warp a small surface patch and compare the finite-difference normal with warpNormal.
    const eps = 1e-3;
    for (const s of [3, 12, 30]) {
      const p = onSphere(400, s);
      const n = p.clone().normalize();
      const tu = new Vector3(n.y, -n.x, 0).normalize();
      const tv = new Vector3().crossVectors(n, tu);
      const q0 = warpPoint(f, p, new Vector3());
      const qu = warpPoint(f, p.clone().addScaledVector(tu, eps), new Vector3()).sub(q0);
      const qv = warpPoint(f, p.clone().addScaledVector(tv, eps), new Vector3()).sub(q0);
      const fd = new Vector3().crossVectors(qv, qu).normalize();
      if (fd.dot(n) < 0) fd.negate();
      expect(warpNormal(f, p, n, new Vector3()).angleTo(fd)).toBeLessThan(1e-3);
    }
  });
});
