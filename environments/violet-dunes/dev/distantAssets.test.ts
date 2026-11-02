import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { KIT, KIT_FAR_MESH, KIT_KINDS, KIT_MESH } from '../life/landmarkMeshes';

it('keeps distant orchard silhouettes finite, rooted and within the original physical bounds', () => {
  for (const kind of KIT_KINDS) {
    const geometry = KIT_FAR_MESH[kind]();
    const fine = KIT_MESH[kind]();
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const parts = geometry.getAttribute('aPart');
    geometry.computeBoundingBox();
    fine.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const fineBounds = fine.boundingBox!;
    expect(geometry.index!.count / 3, `${kind} distant triangle budget`).toBeLessThanOrEqual(110);
    expect(bounds.max.y, `${kind} retains crown height`).toBeGreaterThan(fineBounds.max.y * 0.65);
    expect(bounds.min.y, `${kind} has a rooted base`).toBeLessThanOrEqual(0);
    for (let i = 0; i < positions.count; i++) {
      const point = new Vector3().fromBufferAttribute(positions, i);
      const normal = new Vector3().fromBufferAttribute(normals, i);
      expect(Number.isFinite(point.x + point.y + point.z + normal.length())).toBe(true);
      expect(normal.length()).toBeCloseTo(1, 5);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(KIT[kind][0] / 2 + 0.025);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(KIT[kind][1] / 2 + 0.025);
      expect(point.y).toBeLessThanOrEqual(KIT[kind][2] + 0.025);
      expect(parts.getX(i)).toBeGreaterThanOrEqual(0);
      expect(parts.getX(i)).toBeLessThanOrEqual(6);
    }
    const triangles = new Set<string>();
    for (let i = 0; i < geometry.index!.count; i += 3) {
      const points = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(positions, geometry.index!.getX(i + k)));
      const area = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).length();
      expect(area, `${kind} distant face ${i / 3}`).toBeGreaterThan(1e-10);
      const key = points.map((p) => p.toArray().map((x) => Math.round(x * 1e6)).join(',')).sort().join('|');
      expect(triangles.has(key), `${kind} duplicate face`).toBe(false);
      triangles.add(key);
    }
    geometry.dispose();
    fine.dispose();
  }
});
