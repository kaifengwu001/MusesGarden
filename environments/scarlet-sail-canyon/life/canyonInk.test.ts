import { describe, expect, it } from 'vitest';
import { InstancedBufferAttribute, InstancedBufferGeometry, Vector3 } from 'three';
import { CanyonGeometry, chalkGeometry, chalkShelfGeometry, coralGeometry, fanTreeGeometry, fernGeometry, lichenGeometry } from './canyonGeometry';
import { canyonInkGeometry, makeCanyonInk } from './canyonInk';

describe('Scarlet canyon outline geometry', () => {
  it('draws the outer boundary of a leaf without its triangulation seam', () => {
    const builder = new CanyonGeometry();
    builder.quad(new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(1,1,0),new Vector3(0,1,0),1);
    const source = builder.build();
    const outline = canyonInkGeometry(source);
    expect(outline.getAttribute('position').count).toBe(8);
    expect(Array.from(outline.getAttribute('aInkRule').array)).toEqual(Array<number>(8).fill(1));
    outline.dispose(); source.dispose();
  });

  it('keeps actual box creases and discards every coplanar triangle diagonal', () => {
    const builder = new CanyonGeometry();
    builder.box(0,0,0,1,1,1,2);
    const source = builder.build();
    const outline = canyonInkGeometry(source);
    expect(outline.getAttribute('position').count).toBe(24);
    outline.dispose(); source.dispose();
  });

  it('retains each planted outline vertex’s support height for independent plant scaling', () => {
    const builder = new CanyonGeometry();
    builder.triangle(new Vector3(0,4.25,0),new Vector3(0.4,5,0),new Vector3(-0.4,5,0),3.1,undefined,undefined,4.25);
    const source = builder.build();
    const outline = canyonInkGeometry(source);
    expect(Array.from(outline.getAttribute('aPlantBase').array)).toEqual(Array<number>(6).fill(4.25));
    outline.dispose(); source.dispose();
  });

  it('keeps all real template edges finite and within a modest segment budget', () => {
    const templates = [fanTreeGeometry(),chalkGeometry(),fernGeometry(),coralGeometry(),chalkShelfGeometry(),lichenGeometry()];
    for (const source of templates) {
      const outline = canyonInkGeometry(source);
      const vertices = outline.getAttribute('position').count;
      expect(vertices).toBeGreaterThan(0);
      expect(vertices/2).toBeLessThan(1500);
      expect(vertices).toBeLessThan(source.getAttribute('position').count);
      for (const attribute of Object.values(outline.attributes)) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      outline.dispose(); source.dispose();
    }
  });

  it('borrows exact placement and wind state and follows active source instances', () => {
    const base = chalkGeometry();
    const source = new InstancedBufferGeometry();
    for (const [name, attribute] of Object.entries(base.attributes)) source.setAttribute(name, attribute);
    const attrs = {
      aAnchor: new InstancedBufferAttribute(new Float32Array(12),4),
      aAcross: new InstancedBufferAttribute(new Float32Array(9),3),
      aPlacement: new InstancedBufferAttribute(new Float32Array(12),4),
      aHeightScale: new InstancedBufferAttribute(new Float32Array(3).fill(1),1),
    };
    for (const [name, attribute] of Object.entries(attrs)) source.setAttribute(name, attribute);
    source.instanceCount = 2;
    const clock = {value:42};
    const ink = makeCanyonInk(source,{uSceneryTime:clock});
    for (const [name, attribute] of Object.entries(attrs)) expect(ink.geometry.getAttribute(name)).toBe(attribute);
    expect(ink.material.uniforms.uSceneryTime).toBe(clock);
    expect(ink.geometry.instanceCount).toBe(2);
    attrs.aAnchor.setXYZW(0,0,1,0,12.2);
    expect(ink.geometry.getAttribute('aAnchor').getW(0)).toBeCloseTo(12.2);
    source.instanceCount = 1;
    // The callback has no arguments or renderer dependency; count syncing
    // therefore works equally before an orbital or surface draw.
    (ink.mesh.onBeforeRender as () => void)();
    expect(ink.geometry.instanceCount).toBe(1);
    ink.dispose(); source.dispose(); base.dispose();
  });
});
