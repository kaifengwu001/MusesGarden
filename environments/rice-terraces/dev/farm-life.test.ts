import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { createFarmLife, generateFarmLife } from '../life/farmLife';
import { RICE_RADIUS, sampleRiceField } from '../planet/riceFields';

describe('Ti Tian wooded islands and planted rice', () => {
  it('places roots only in their dry field communities and keeps bounded global coverage', () => {
    for (const seed of [412, 771]) {
      const layout = generateFarmLife(seed);
      expect(layout.trees.length).toBeGreaterThan(30);
      expect(layout.trees.length).toBeLessThanOrEqual(420);
      expect(layout.riceTufts.length).toBeGreaterThan(200);
      expect(layout.riceTufts.length).toBeLessThanOrEqual(2600);
      for (const tree of layout.trees) {
        const field = sampleRiceField(tree.direction, seed);
        expect(field.forest).toBe(true); expect(field.wet).toBe(false);
        expect(tree.direction.length()).toBeCloseTo(1, 8);
        expect(tree.height).toBe(field.surfaceHeight);
        expect(tree.trunkHeight).toBeGreaterThan(1.5);
      }
      for (const tuft of layout.riceTufts) {
        const field = sampleRiceField(tuft.direction, seed);
        expect(field.wet).toBe(false); expect(field.forest).toBe(false);
        expect(tuft.height).toBe(field.surfaceHeight);
        expect(tuft.direction.length()).toBeCloseTo(1, 8);
      }
      // Tuft caps must not leave an unvisited hemisphere.
      expect(layout.riceTufts.some(tuft => tuft.direction.y > 0.5)).toBe(true);
      expect(layout.riceTufts.some(tuft => tuft.direction.y < -0.5)).toBe(true);
      let closest = Infinity;
      layout.trees.forEach((a, i) => layout.trees.slice(i + 1).forEach(b => {
        closest = Math.min(closest, Math.acos(Math.min(1, a.direction.dot(b.direction))) * RICE_RADIUS);
      }));
      expect(closest).toBeGreaterThanOrEqual(2.65 - 1e-7);
    }
  });

  it('regenerates the same life independently of other seeds', () => {
    const first = generateFarmLife(412);
    generateFarmLife(771);
    expect(generateFarmLife(412)).toEqual(first);
    expect(generateFarmLife(413)).not.toEqual(first);
  });

  it('builds finite rooted instance transforms and releases every owned mesh', () => {
    const life = createFarmLife(412);
    expect(life.group.children).toHaveLength(3);
    const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    for (const child of life.group.children) {
      expect(child).toBeInstanceOf(InstancedMesh);
      const mesh = child as InstancedMesh;
      expect(mesh.count).toBeGreaterThan(0);
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(mesh.boundingSphere?.radius).toBeGreaterThan(0);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        expect(matrix.elements.every(Number.isFinite)).toBe(true);
        matrix.decompose(position, rotation, scale);
        expect(position.length()).toBeGreaterThan(RICE_RADIUS);
        expect(Math.min(scale.x, scale.y, scale.z)).toBeGreaterThan(0);
      }
    }
    const rice = life.group.children[2] as InstancedMesh;
    const first = generateFarmLife(412).riceTufts[0];
    rice.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
    expect(position.length()).toBeCloseTo(RICE_RADIUS + first.height + 0.025, 4);
    let disposed = 0;
    life.group.children.forEach(child => (child as InstancedMesh).addEventListener('dispose', () => disposed++));
    life.dispose();
    expect(disposed).toBe(3);
    expect(life.group.children).toHaveLength(0);
  });
});
