import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type IUniform, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import fragmentShader from './model.frag.glsl?raw';
import vertexShader from './model.vert.glsl?raw';

// Kai's models as the planet draws them: the towers as scripts/terraces-models.mjs
// wrote them (a node per level of detail, lod0 full and lod1 lighter, quantized
// and compressed, a unit tall on their base), each level's triangles with its
// positions back in the model's own units (its node's translation and scale
// undone); the houses as they came (Kai, 2026-11-03: low and clean enough as
// they are, no lighter copy), their one mesh made a unit tall on its base. And
// the one colour texture each model's levels share.

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
    if (!gltf.scene.getObjectByName('lod0')) return asItCame(gltf.scene);
    for (const name of ['lod0', 'lod1']) {
      const src = gltf.scene.getObjectByName(name) as Mesh | undefined;
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

/** A model with no levels of detail: its first mesh, in the scene's frame, scaled a unit tall from its base (y = 0 up). */
function asItCame(scene: Object3D): Model {
  let src: Mesh | undefined;
  scene.traverse((o) => {
    if (!src && (o as Mesh).isMesh) src = o as Mesh;
  });
  if (!src) return { lods: [], map: null };
  scene.updateMatrixWorld(true);
  const mesh: Mesh = src;
  const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const tall = box.max.y - box.min.y;
  g.translate(0, -box.min.y, 0);
  g.scale(1 / tall, 1 / tall, 1 / tall);
  const out = new BufferGeometry();
  out.setIndex(g.index);
  for (const a of ['position', 'normal', 'uv']) out.setAttribute(a, g.getAttribute(a));
  return { lods: [out], map: (mesh.material as { map?: Texture }).map ?? null };
}

/** One model stood on the planet: which, its site's up and its x way (unit), its base's height (m), its height (m), its width × this. */
export interface Placement {
  readonly model: number;
  readonly up: Vector3;
  readonly e1: Vector3;
  readonly base: number;
  readonly height: number;
  readonly stretch: number;
}

/**
 * A set of Kai's models stood on the planet (model.vert.glsl, model.frag.glsl):
 * an instanced draw per model and level of detail, each placement drawn in
 * full detail near the camera, in its lighter copy past `near` (m, plus its
 * height). Loads its models itself; draws nothing until they are in.
 */
export class ModelSet {
  readonly group = new Group();
  private readonly meshes: Array<Array<Mesh<InstancedBufferGeometry, ShaderMaterial>>> = [];
  private placed: Array<Placement & { at: Vector3 }> = [];
  private readonly camera = new Vector3();
  private ready = false;

  constructor(
    name: string,
    urls: readonly string[],
    private readonly shared: Record<string, IUniform>,
    private readonly max: number,
    private readonly near: number,
    /** Its models' heights × this (their footprints kept): Kai found the towers a little tall. */
    squash = 1,
  ) {
    this.group.name = name;
    void loadModels(urls).then((models) => {
      for (const m of models) {
        this.meshes.push(
          m.lods.map((src, l) => {
            const g = new InstancedBufferGeometry();
            g.index = src.index;
            for (const a of ['position', 'normal', 'uv']) g.setAttribute(a, src.getAttribute(a));
            for (const a of ['aBase', 'aFrame']) g.setAttribute(a, new InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(DynamicDrawUsage));
            g.instanceCount = 0;
            const mesh = new Mesh(g, new ShaderMaterial({ name: `${name} lod${l}`, vertexShader, fragmentShader, uniforms: { ...this.shared, uMap: { value: m.map }, uModelSquash: { value: squash } } }));
            mesh.frustumCulled = false;
            this.group.add(mesh);
            return mesh;
          }),
        );
      }
      this.ready = true;
      this.assign();
    });
  }

  /** The placements (planet radius R: where each stands, for its distance to the camera). */
  set(placements: readonly Placement[], R: number): void {
    this.placed = placements.slice(0, this.max).map((p) => ({ ...p, at: p.up.clone().multiplyScalar(R + p.base) }));
    this.assign();
  }

  /** Each placement in full detail or its lighter copy by its distance from the camera (planet space). */
  update(camera: Vector3): void {
    this.camera.copy(camera);
    this.assign();
  }

  private assign(): void {
    if (!this.ready) return;
    const counts = this.meshes.map((lods) => lods.map(() => 0));
    for (const p of this.placed) {
      const lods = this.meshes[p.model];
      const l = lods.length > 1 && p.at.distanceTo(this.camera) > this.near + p.height ? 1 : 0;
      const n = counts[p.model][l]++;
      const g = lods[l].geometry;
      (g.getAttribute('aBase').array as Float32Array).set([p.up.x, p.up.y, p.up.z, p.base], n * 4);
      // (the stretch rides in the x way's length: the shader reads |e1| as the width's scale)
      (g.getAttribute('aFrame').array as Float32Array).set([p.e1.x * p.stretch, p.e1.y * p.stretch, p.e1.z * p.stretch, p.height], n * 4);
    }
    this.meshes.forEach((lods, k) =>
      lods.forEach((mesh, l) => {
        mesh.geometry.instanceCount = counts[k][l];
        mesh.geometry.getAttribute('aBase').needsUpdate = true;
        mesh.geometry.getAttribute('aFrame').needsUpdate = true;
      }),
    );
  }
}
