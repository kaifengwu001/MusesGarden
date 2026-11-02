import { describe, expect, it } from 'vitest';
import { CHERRY_VARIANTS, makeCherryGeometry } from '../life/cherryGeometry';

describe('cherry tree anatomy', () => {
  it('keeps all four meter-sized trees finite, rooted and within the source geometry budget', () => {
    for (let variant = 0; variant < CHERRY_VARIANTS; variant++) {
      const geometry = makeCherryGeometry(variant);
      const position = geometry.getAttribute('position');
      expect(position.count / 3).toBeLessThan(12_000);
      expect(position.count / 3).toBeGreaterThan(2_000);
      for (const attribute of Object.values(geometry.attributes)) {
        expect(attribute.count).toBe(position.count);
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      const box = geometry.boundingBox!;
      expect(box.min.y).toBeGreaterThan(-0.25);
      expect(box.min.y).toBeLessThan(-0.05);
      expect(box.max.y).toBeGreaterThan(6);
      expect(box.max.y).toBeLessThan(12);
      expect(box.max.x - box.min.x).toBeGreaterThan(5);
      expect(box.max.x - box.min.x).toBeLessThan(16);
      geometry.dispose();
    }
  });

  it('produces distinct, repeatable branching and blossom communities', () => {
    const geometries = Array.from({ length: CHERRY_VARIANTS }, (_, i) => makeCherryGeometry(i));
    const counts = geometries.map(g => g.getAttribute('position').count);
    expect(new Set(counts).size).toBe(CHERRY_VARIANTS);
    const repeat = makeCherryGeometry(1);
    expect(Array.from(repeat.getAttribute('position').array)).toEqual(Array.from(geometries[1].getAttribute('position').array));
    for (let i = 0; i < CHERRY_VARIANTS; i++) {
      const kinds = new Set(Array.from(geometries[i].getAttribute('aKind').array));
      expect(kinds.has(0)).toBe(true);
      if (i === 3) {
        expect(kinds.has(4)).toBe(true);
        expect(kinds.has(1)).toBe(false);
      } else {
        expect(kinds.has(1)).toBe(true);
        expect(kinds.has(2)).toBe(true);
        expect(kinds.has(3)).toBe(true);
      }
      expect((geometries[i].userData.branchTips as number[][]).length).toBeGreaterThan(25);
    }
    repeat.dispose();
    geometries.forEach(g => g.dispose());
  });

  it('keeps distant crowns on the same branches with fewer than 1,100 triangles per tree', () => {
    for (let variant = 0; variant < CHERRY_VARIANTS; variant++) {
      const full = makeCherryGeometry(variant);
      const far = makeCherryGeometry(variant, 'far');
      expect(far.getAttribute('position').count / 3).toBeLessThan(1_100);
      expect(far.getAttribute('position').count).toBeLessThan(full.getAttribute('position').count / 4);
      const a = full.boundingBox!, b = far.boundingBox!;
      // Larger distant petal fans stand in for the whole small-dab spray at the same anchor.
      expect(Math.abs(a.max.y - b.max.y)).toBeLessThan(1.25);
      expect(Math.abs(a.min.x - b.min.x)).toBeLessThan(1.6);
      expect(Math.abs(a.max.x - b.max.x)).toBeLessThan(1.6);
      expect(Math.abs(a.min.z - b.min.z)).toBeLessThan(1.6);
      expect(Math.abs(a.max.z - b.max.z)).toBeLessThan(1.6);
      expect(Math.abs(a.min.y - b.min.y)).toBeLessThan(0.08);
      full.dispose(); far.dispose();
    }
  });

  it('holds willow attachments fixed while giving low hanging foliage independent tip flex', () => {
    const geometry = makeCherryGeometry(3);
    const p = geometry.getAttribute('position'), flex = geometry.getAttribute('aFlex'), kind = geometry.getAttribute('aKind');
    const attachments = new Set<string>();
    let flexibleLowLeaves = 0, fixedWood = 0;
    for (let i=0;i<p.count;i++) {
      const weight = flex.getW(i);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
      if (p.getY(i)<1) expect(weight).toBe(0);
      if (kind.getX(i)===0 && weight===0) fixedWood++;
      if (kind.getX(i)===4 && weight>0.7) {
        expect(flex.getY(i)-p.getY(i)).toBeGreaterThan(1.6);
        flexibleLowLeaves++;
        attachments.add([flex.getX(i),flex.getY(i),flex.getZ(i)].map(v=>v.toFixed(3)).join(','));
      }
    }
    expect(flexibleLowLeaves).toBeGreaterThan(500);
    expect(fixedWood).toBeGreaterThan(500);
    expect(attachments.size).toBeGreaterThan(25);
    for (let variant=0;variant<3;variant++) {
      const cherry = makeCherryGeometry(variant), f = cherry.getAttribute('aFlex');
      expect(Array.from({length:f.count},(_,i)=>f.getW(i)).every(w=>w===0)).toBe(true);
      cherry.dispose();
    }
    geometry.dispose();
  });
});
