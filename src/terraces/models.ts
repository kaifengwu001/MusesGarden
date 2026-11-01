import { BufferGeometry, Float32BufferAttribute, Vector3, type Mesh, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Kai's models as the planet draws them (scripts/terraces-models.mjs wrote
// them: a node per level of detail, lod0 full and lod1 lighter, quantized and
// compressed, a unit tall on their base): each level's triangles with its
// positions back in the model's own units (its node's translation and scale
// undone), and the one colour texture they share.

export interface Model {
  /** Full detail, then the lighter copy. */
  readonly lods: BufferGeometry[];
  readonly map: Texture | null;
}

export async function loadModels(urls: readonly string[]): Promise<Model[]> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = await Promise.all(urls.map((u) => loader.loadAsync(u)));
  const v = new Vector3();
  return files.map((gltf) => {
    const lods: BufferGeometry[] = [];
    let map: Texture | null = null;
    for (const name of ['lod0', 'lod1']) {
      const src = gltf.scene.getObjectByName(name) as Mesh<BufferGeometry> | undefined;
      if (!src) continue;
      map ??= (src.material as { map?: Texture }).map ?? null;
      src.updateMatrix();
      const q = src.geometry.getAttribute('position');
      const pos = new Float32Array(q.count * 3);
      for (let i = 0; i < q.count; i++) v.fromBufferAttribute(q, i).applyMatrix4(src.matrix).toArray(pos, 3 * i);
      const g = new BufferGeometry();
      g.setIndex(src.geometry.index);
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', src.geometry.getAttribute('normal'));
      g.setAttribute('uv', src.geometry.getAttribute('uv'));
      lods.push(g);
    }
    return { lods, map };
  });
}
