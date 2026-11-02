import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cloudRibbonGeometry } from '../life/cloudRibbons';

describe('high cirrus geometry', () => {
  it('spans every hemisphere on a spherical shell with no collapsed faces', () => {
    const geometry = cloudRibbonGeometry(412);
    const positions = geometry.getAttribute('position');
    const index = geometry.index!;
    const extents = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < positions.count; i++) {
      const p = new Vector3().fromBufferAttribute(positions, i);
      expect(p.length()).toBeCloseTo(1, 6);
      p.toArray().forEach((v, axis) => {
        extents[axis * 2] = Math.min(extents[axis * 2], v);
        extents[axis * 2 + 1] = Math.max(extents[axis * 2 + 1], v);
      });
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(extents[axis * 2]).toBeLessThan(-0.7);
      expect(extents[axis * 2 + 1]).toBeGreaterThan(0.7);
    }
    for (let i = 0; i < index.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(positions, index.getX(i));
      const b = new Vector3().fromBufferAttribute(positions, index.getX(i + 1));
      const c = new Vector3().fromBufferAttribute(positions, index.getX(i + 2));
      expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(1e-7);
    }
    geometry.dispose();
  });

  it('recreates the same weather from its seed and varies between seeds', () => {
    const a = cloudRibbonGeometry(412);
    const b = cloudRibbonGeometry(412);
    const c = cloudRibbonGeometry(771);
    expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array);
    expect(a.getAttribute('position').array).not.toEqual(c.getAttribute('position').array);
    for (const geometry of [a, b, c]) geometry.dispose();
  });
});
