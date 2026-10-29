import { BufferGeometry, Float32BufferAttribute, Mesh, type Material } from 'three';

export { default as fullscreenVertex } from './fullscreen.vert.glsl?raw';

/** One triangle that covers clip space; cheaper than a quad (no diagonal seam). */
export function fullscreenTriangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return geometry;
}

export function fullscreenMesh(material: Material): Mesh {
  const mesh = new Mesh(fullscreenTriangle(), material);
  mesh.frustumCulled = false;
  return mesh;
}
