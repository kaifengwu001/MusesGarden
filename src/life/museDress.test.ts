import { BufferAttribute, DoubleSide, FrontSide, InstancedBufferGeometry, ShaderMaterial, Texture, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { schema } from '../params';
import { FIELD_FIT } from './museBody';
import { dressMuse, fitOf, isDressed, type Clothes } from './museDress';
import { DRESSED, SCULPTS, type FaceLayout } from './museMesh';

const VERTICES = 4;
const FACE: FaceLayout = { eye: [0.1, 0.77, 0.02], mouth: [0.004, 0.72, 0.03, 0.01], blush: [0.11, 0.73, 0.04], plate: [0.77, 0.18, 0.13, 0.1] };

/** A body's geometry as Muse makes one (the skin's attributes; what the dress adds is looked for). */
function geometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(VERTICES * 3), 3));
  g.setAttribute('aFur', new BufferAttribute(new Float32Array(VERTICES), 1));
  return g;
}

/** Muse's material as it is before any body is dressed: some of its own defines and uniforms, its front side. */
function material(): ShaderMaterial {
  return new ShaderMaterial({ defines: { MUSE_COLOURED: 1 }, uniforms: { uMuseGrade: { value: new Vector3(1, 1, 1) } }, side: FrontSide });
}

/** A muse in clothes: cloth, texture coordinates and its face as measured. */
function dressed(): Clothes {
  return { cloth: new Float32Array([0, 1, 0.5, 1]), uv: new Float32Array(VERTICES * 2), features: FACE };
}

/** What a material is drawn with, for comparing: its defines, its uniforms' names, its side and its version (each rebuild bumps it). */
function state(m: ShaderMaterial): { defines: Record<string, unknown>; uniforms: string[]; side: number; version: number } {
  return { defines: { ...m.defines }, uniforms: Object.keys(m.uniforms).sort(), side: m.side, version: m.version };
}

describe('a muse in clothes, dressed (museDress.ts)', () => {
  it('gives a dressed body its cloth and paint, its face and both sides', () => {
    const g = geometry();
    const m = material();
    const paint = new Texture();
    const body = dressed();
    dressMuse(g, m, body, paint);
    expect(m.defines).toEqual({ MUSE_COLOURED: 1, MUSE_PAINTED: 1, MUSE_FEATURES: 1 });
    expect(g.getAttribute('aCloth').array).toBe(body.cloth);
    expect(g.getAttribute('aCloth').itemSize).toBe(1);
    expect(g.getAttribute('uv').array).toBe(body.uv);
    expect(g.getAttribute('uv').itemSize).toBe(2);
    expect(m.uniforms.uMusePaint.value).toBe(paint);
    expect(m.uniforms.uMuseEyeAt.value).toEqual(new Vector3(...FACE.eye));
    expect(m.uniforms.uMuseMouthAt.value).toEqual(new Vector4(...FACE.mouth));
    expect(m.uniforms.uMuseBlushAt.value).toEqual(new Vector3(...FACE.blush));
    expect(m.uniforms.uMuseFaceAt.value).toEqual(new Vector4(...FACE.plate));
    expect(m.side).toBe(DoubleSide);
    expect(m.version).toBeGreaterThan(0);
  });

  it('adds nothing for a body without clothes (the original Muse, tpose6): its geometry and material as they were, not rebuilt', () => {
    const g = geometry();
    const m = material();
    const before = state(m);
    const attributes = Object.keys(g.attributes).sort();
    dressMuse(g, m, {}, new Texture());
    expect(state(m)).toEqual(before);
    expect(Object.keys(g.attributes).sort()).toEqual(attributes);
  });

  it('paints no cloth without its paint or its texture coordinates, though its cloth is still drawn on both sides', () => {
    const g = geometry();
    const m = material();
    dressMuse(g, m, { cloth: new Float32Array(VERTICES), uv: new Float32Array(VERTICES * 2) }, null);
    expect('MUSE_PAINTED' in m.defines).toBe(false);
    expect(g.getAttribute('aCloth')).toBeUndefined();
    expect(m.uniforms.uMusePaint).toBeUndefined();
    expect(m.side).toBe(DoubleSide);
    const h = geometry();
    const n = material();
    dressMuse(h, n, { cloth: new Float32Array(VERTICES) }, new Texture());
    expect('MUSE_PAINTED' in n.defines).toBe(false);
    expect(h.getAttribute('uv')).toBeUndefined();
  });

  it('takes it all off again when Muse changes back to a body without clothes', () => {
    const m = material();
    const before = state(m);
    dressMuse(geometry(), m, dressed(), new Texture());
    dressMuse(geometry(), m, {}, null);
    expect({ ...state(m), version: 0 }).toEqual({ ...before, version: 0 });
    expect(m.version).toBeGreaterThan(before.version);
  });

  it('changes from one dressed body to another without rebuilding the program, its paint and face the new one', () => {
    const m = material();
    dressMuse(geometry(), m, dressed(), new Texture());
    const version = m.version;
    const paint = new Texture();
    const face: FaceLayout = { eye: [0.2, 0.8, 0.03], mouth: [0, 0.7, 0.02, 0.02], blush: [0.12, 0.74, 0.05], plate: [0.8, 0.2, 0.14, 0.12] };
    dressMuse(geometry(), m, { ...dressed(), features: face }, paint);
    expect(m.version).toBe(version);
    expect(m.uniforms.uMusePaint.value).toBe(paint);
    expect(m.uniforms.uMuseEyeAt.value).toEqual(new Vector3(...face.eye));
    expect(m.uniforms.uMuseFaceAt.value).toEqual(new Vector4(...face.plate));
  });
});

describe('its skeleton (fitOf)', () => {
  it('is a dressed muse’s own as measured, else its kind’s', () => {
    const measured = { ...FIELD_FIT, reach: 1.23 };
    expect(fitOf('muse5', { fit: measured })).toBe(measured);
    expect(fitOf('muse5', {})).toBe(DRESSED.muse5.fit);
    expect(fitOf('tpose6', {})).toBe(SCULPTS.tpose6.fit);
    expect(fitOf('sculpt', {})).toBe(SCULPTS.sculpt.fit);
  });

  it('tells the muses in clothes from the sculpts', () => {
    expect(Object.keys(DRESSED).every(isDressed)).toBe(true);
    expect(Object.keys(SCULPTS).some(isDressed)).toBe(false);
  });
});

describe('choosing one on the meadow (params.ts Body)', () => {
  it('offers every muse in clothes, the original Muse still its default', () => {
    expect(schema.muse.model.def).toBe('tpose6');
    for (const kind of Object.keys(DRESSED)) expect(schema.muse.model.options).toContain(kind);
  });
});
