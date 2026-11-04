import { BufferAttribute, DoubleSide, FrontSide, Vector3, Vector4, type BufferGeometry, type ShaderMaterial, type Texture } from 'three';
import { isGeneratedLook } from '../muse/looks';
import type { MuseFit } from './museBody';
import { DRESSED, GENERATED, SCULPTS, type BodyKind, type DressedKind, type MuseMesh } from './museMesh';

// A muse in clothes (museMesh.ts DRESSED) in Muse's shaders, wherever one is
// drawn: on a planet (muse.ts), in the lab and in its lineup. Its clothes are
// painted from its texture as made (muse.frag.glsl MUSE_PAINTED: how much of
// each vertex is cloth, its texture coordinates, the paint), its face drawn
// where it was measured off its sculpt (MUSE_FEATURES), both sides of its
// cloth drawn (a garment is often a single sheet: an apron, a collar), and its
// skeleton fitted as measured off it; a body the workshop made (gen-*) is
// dressed the same way. A body without clothes (the original Muse, tpose6;
// the field's) is given none of it: its geometry, defines, uniforms and side
// stay as they were, so it draws as it always has.

/** What a body wears, if anything: a dressed muse's cloth, texture coordinates and face (museMesh.ts MuseMesh). */
export type Clothes = Pick<Partial<MuseMesh>, 'cloth' | 'uv' | 'features'>;

/** The face's measures, as muse.frag.glsl reads them (MUSE_FEATURES). */
const FACE = ['uMuseEyeAt', 'uMuseMouthAt', 'uMuseBlushAt', 'uMuseFaceAt'] as const;

/** Whether a body is one of the muses in clothes. */
export function isDressed(kind: string): kind is DressedKind {
  return kind in DRESSED;
}

/** A body's skeleton: a dressed or made muse's as measured off it (museMesh.ts measureFit), else its sculpt's. */
export function fitOf(kind: BodyKind, body: { fit?: MuseFit }): MuseFit {
  return body.fit ?? (isDressed(kind) ? DRESSED[kind].fit : isGeneratedLook(kind) ? GENERATED.fit : SCULPTS[kind].fit);
}

/** A define on or off, the program rebuilt only when it changes. */
function define(material: ShaderMaterial, name: string, on: boolean): void {
  if (on === name in material.defines) return;
  if (on) material.defines[name] = 1;
  else delete material.defines[name];
  material.needsUpdate = true;
}

/**
 * Dress a Muse's material, and its body's new geometry, in what the body
 * wears: its cloth's share and texture coordinates and the paint they read
 * (when it has all three), its face's measures, both sides drawn where it has
 * cloth. What it doesn't wear comes off the material (a Muse that changes
 * bodies keeps its material), so a body without clothes adds nothing to a
 * material that never wore any.
 */
export function dressMuse(geometry: BufferGeometry, material: ShaderMaterial, body: Clothes, paint: Texture | null): void {
  const { cloth, uv, features } = body;
  const u = material.uniforms;
  const painted = cloth !== undefined && uv !== undefined && paint !== null;
  if (painted) {
    geometry.setAttribute('aCloth', new BufferAttribute(cloth, 1));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    u.uMusePaint = { value: paint };
  } else delete u.uMusePaint;
  define(material, 'MUSE_PAINTED', painted);
  if (features) {
    u.uMuseEyeAt = { value: new Vector3(...features.eye) };
    u.uMuseMouthAt = { value: new Vector4(...features.mouth) };
    u.uMuseBlushAt = { value: new Vector3(...features.blush) };
    u.uMuseFaceAt = { value: new Vector4(...features.plate) };
  } else for (const name of FACE) delete u[name];
  define(material, 'MUSE_FEATURES', features !== undefined);
  const side = cloth ? DoubleSide : FrontSide;
  if (material.side !== side) {
    material.side = side;
    material.needsUpdate = true;
  }
}
