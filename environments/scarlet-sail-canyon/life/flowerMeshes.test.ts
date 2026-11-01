import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { coralGeometry, fernGeometry, lichenGeometry } from './canyonGeometry';
import { NATIVE_PLANT_SCALE, SPECIES, SPECIES_MESH } from './flowerMeshes';
import { BED_PLANTS, FindBeds, MAX_BEDS } from './findBeds';

describe('native canyon garden decoration', () => {
  it('uses the same coral, ivory and sage silhouettes as the cliff plants in all four topic channels', () => {
    const sources = [coralGeometry, fernGeometry, lichenGeometry, coralGeometry];
    expect(SPECIES).toEqual(['coral', 'ivory', 'sage', 'young-coral']);
    SPECIES_MESH.forEach((make, species) => {
      const geometry = make(), source = sources[species]();
      const position = geometry.getAttribute('position'), original = source.getAttribute('position');
      expect(position.count).toBe(original.count);
      expect(geometry.getAttribute('normal').count).toBe(position.count);
      expect(geometry.getAttribute('aPart').count).toBe(position.count);
      expect(geometry.getAttribute('aT').count).toBe(position.count);
      for (let i = 0; i < position.count; i++) {
        expect(position.getX(i)).toBeCloseTo(original.getX(i) * NATIVE_PLANT_SCALE[species], 6);
        expect(position.getY(i)).toBeCloseTo(Math.max(0, original.getY(i) * NATIVE_PLANT_SCALE[species]), 6);
        expect(position.getZ(i)).toBeCloseTo(original.getZ(i) * NATIVE_PLANT_SCALE[species], 6);
      }
      const along = Array.from(geometry.getAttribute('aT').array);
      expect(along.every(t => t >= 0 && t <= 1)).toBe(true);
      expect(Math.min(...along)).toBe(0);
      expect(Math.max(...along)).toBeCloseTo(1, 6);
      expect(Array.from(geometry.getAttribute('aPart').array).every(part => part === 1)).toBe(true);
      for (const attribute of Object.values(geometry.attributes)) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      source.dispose(); geometry.dispose();
    });
  });

  it('keeps garden planting, pulse, hover and replay timelines functional with a bounded native plant count', () => {
    const beds = new FindBeds({});
    const looks = Array.from({ length: MAX_BEDS }, (_, i) => ({
      bed: { find: `native-${i}`, basket: 'basket', dir: new Vector3(0, 1, 0), ground: 1.2 },
      species: (i % 4) as 0 | 1 | 2 | 3,
      variant: 0.5,
    }));
    beds.set(looks, 128, new Set(['native-0']));
    expect(beds.meshes.reduce((sum, mesh) => sum + mesh.geometry.instanceCount, 0)).toBe(MAX_BEDS * BED_PLANTS);
    const triangles = beds.meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3 * mesh.geometry.instanceCount, 0);
    expect(triangles).toBeLessThan(850_000);
    const slot = beds.slot('native-0')!;
    expect(beds.uniforms.uBeds.value[slot].x).toBeGreaterThan(1e8);
    expect(beds.plant(['native-0'])).toBeGreaterThan(0);
    expect(beds.uniforms.uBeds.value[slot].x).toBeLessThan(1e8);
    beds.highlight('native-0'); beds.hover('native-0'); beds.pulse(['native-0']); beds.update(5);
    expect(beds.uniforms.uBeds.value[slot].y).toBe(1);
    expect(beds.uniforms.uBeds.value[slot].w).toBeGreaterThanOrEqual(0);
    expect(beds.meshes.every(mesh => mesh.visible)).toBe(true);
    beds.unplant(['native-0']);
    expect(beds.uniforms.uBeds.value[slot].x).toBeGreaterThan(1e8);
    beds.update(100);
    expect(beds.meshes.every(mesh => !mesh.visible)).toBe(true);
    for (const mesh of beds.meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
  });
});
