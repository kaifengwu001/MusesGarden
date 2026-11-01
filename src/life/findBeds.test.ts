import { Vector3, type InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { FindBeds, type BedLook } from './findBeds';

const R = 128;

function looks(ids: readonly string[]): BedLook[] {
  return ids.map((find, i) => ({ bed: { find, basket: 'b', dir: new Vector3(Math.sin(i), 1, Math.cos(i)).normalize(), ground: 1 }, species: (i % 4) as 0 | 1 | 2 | 3, variant: 0.4 }));
}

describe('FindBeds', () => {
  it('leaves the middle of every bed to its find’s specimen', () => {
    const beds = new FindBeds({});
    const list = looks(Array.from({ length: 12 }, (_, i) => `find-${i}`));
    beds.set(list, R, new Set());
    let nearest = Infinity;
    for (const mesh of beds.meshes) {
      const place = mesh.geometry.getAttribute('aPlace') as InstancedBufferAttribute;
      const look = mesh.geometry.getAttribute('aLook') as InstancedBufferAttribute;
      for (let k = 0; k < place.count; k++) {
        const plant = new Vector3(place.getX(k), place.getY(k), place.getZ(k));
        nearest = Math.min(nearest, plant.angleTo(list[look.getW(k)].bed.dir) * R);
      }
    }
    expect(nearest).toBeGreaterThanOrEqual(0.249);
  });

  it('starts a bed’s planting again when it is handed to another find, and keeps it for the same find', () => {
    const beds = new FindBeds({});
    const timeline = beds.uniforms.uBeds.value;
    beds.set(looks(['old']), R, new Set());
    beds.plant(['old']);
    beds.pulse(['old']);
    const planted = timeline[0].x;
    beds.set(looks(['old']), R, new Set());
    expect(timeline[0].x).toBe(planted);
    beds.set(looks(['new', 'old']), R, new Set());
    // the new find stands grown at once rather than replaying the old one's planting; the old one, in its new bed, too
    expect(beds.slot('new')).toBe(0);
    expect(timeline[0].x).toBeLessThan(-1000);
    expect(timeline[0].z).toBeLessThan(-1000);
    expect(timeline[beds.slot('old') ?? -1].x).toBeLessThan(-1000);
  });
});
