import { Float32BufferAttribute, InstancedBufferGeometry, type BufferGeometry } from 'three';
import { coralGeometry, fernGeometry, lichenGeometry } from './canyonGeometry';

/** The four persistent topic channels keep their IDs, but all decoration is native canyon flora. */
export const SPECIES = ['coral', 'ivory', 'sage', 'young-coral'] as const;
export const NATIVE_PLANT_SCALE = [0.62, 0.42, 0.46, 0.43] as const;
const SOURCES = [coralGeometry, fernGeometry, lichenGeometry, coralGeometry] as const;

/** Adapt the same source meshes used on the cliffs to the garden's instancing contract. */
function nativePlant(source: BufferGeometry, scale: number, species: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  const position = source.getAttribute('position').clone();
  const part = new Float32Array(position.count).fill(1);
  const along = new Float32Array(position.count);
  source.computeBoundingBox();
  const height = source.boundingBox!.max.y * scale;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) * scale, Math.max(0, position.getY(i) * scale), position.getZ(i) * scale);
    along[i] = Math.min(1, position.getY(i) / height);
  }
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', source.getAttribute('normal').clone());
  geometry.setAttribute('uv', source.getAttribute('uv').clone());
  geometry.setAttribute('aPart', new Float32BufferAttribute(part, 1));
  geometry.setAttribute('aT', new Float32BufferAttribute(along, 1));
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.userData.nativeSpecies = SPECIES[species];
  geometry.computeBoundingSphere();
  source.dispose();
  return geometry;
}

export const SPECIES_MESH: ReadonlyArray<() => InstancedBufferGeometry> = SOURCES.map((make, species) => () => nativePlant(make(), NATIVE_PLANT_SCALE[species], species));
