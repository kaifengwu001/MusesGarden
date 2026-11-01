import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { PEAKS, type Peak } from './fields';
import { loadModels } from './models';
import type { TerraceTerrain } from './terrain';
import fragmentShader from './tower.frag.glsl?raw';
import vertexShader from './tower.vert.glsl?raw';

// The karst towers: Kai's five mountain models (scripts/terraces-models.mjs
// made them light: src/assets/terraces/mountain*.glb, a unit tall, two levels
// of detail each), one standing on each tower's site (fields.ts places the
// sites and gathers a low mound of ground round each foot), turned and
// stretched a little so no two read alike, its height the site's. Drawn
// rigid, not bent round the planet (a tall tower bent with it would flare
// at its top): its base sunk into its mound so its edges never float. Near
// ones in full detail, far ones in their lighter copy.

const URLS = [1, 2, 3, 4, 5].map((k) => new URL(`../assets/terraces/mountain${k}.glb`, import.meta.url).href);
/** How far its base sinks into its mound (× its height), and out to where a tower is drawn in full detail (m, plus its height). */
export const TOWER = { sink: 0.09, near: 140 } as const;

interface TowerModel {
  readonly lods: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>>;
  readonly attrs: Array<{ base: InstancedBufferAttribute; frame: InstancedBufferAttribute }>;
}

export class Towers {
  readonly group = new Group();
  private readonly models: TowerModel[] = [];
  private placed: Array<{ peak: Peak; base: number; up: Vector3; e1: Vector3; at: Vector3 }> = [];
  private readonly at = new Vector3();
  private ready = false;

  constructor(private readonly shared: Record<string, IUniform>) {
    this.group.name = 'towers';
    void this.load();
  }

  private async load(): Promise<void> {
    for (const file of await loadModels(URLS)) {
      const model: TowerModel = { lods: [], attrs: [] };
      for (const [l, src] of file.lods.entries()) {
        const g = new InstancedBufferGeometry();
        g.index = src.index;
        for (const name of ['position', 'normal', 'uv']) g.setAttribute(name, src.getAttribute(name));
        const base = new InstancedBufferAttribute(new Float32Array(PEAKS.max * 4), 4);
        const frame = new InstancedBufferAttribute(new Float32Array(PEAKS.max * 4), 4);
        base.setUsage(DynamicDrawUsage);
        frame.setUsage(DynamicDrawUsage);
        g.setAttribute('aBase', base);
        g.setAttribute('aFrame', frame);
        g.instanceCount = 0;
        const mesh = new Mesh(g, new ShaderMaterial({ name: `tower lod${l}`, vertexShader, fragmentShader, uniforms: { ...this.shared, uMap: { value: file.map } } }));
        mesh.frustumCulled = false;
        model.lods.push(mesh);
        model.attrs.push({ base, frame });
        this.group.add(mesh);
      }
      this.models.push(model);
    }
    this.ready = true;
    this.assign(this.at);
  }

  /** The towers on the planet's sites, each on its mound (call when the fields change). */
  set(terrain: TerraceTerrain): void {
    const R = terrain.radius;
    this.placed = terrain.fields.peaks.map((peak) => {
      const up = peak.dir.clone();
      // its turn about the up, from a fixed tangent
      const a = new Vector3().crossVectors(up, Math.abs(up.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
      const b = new Vector3().crossVectors(up, a);
      const e1 = a.multiplyScalar(Math.cos(peak.turn)).addScaledVector(b, Math.sin(peak.turn)).normalize();
      const base = terrain.fields.natural(up) - TOWER.sink * peak.height;
      return { peak, base, up, e1, at: up.clone().multiplyScalar(R + base) };
    });
    this.assign(this.at);
  }

  /** Each tower in full detail or its lighter copy by its distance from the camera (planet space). */
  update(camera: Vector3): void {
    this.at.copy(camera);
    this.assign(camera);
  }

  private assign(camera: Vector3): void {
    if (!this.ready) return;
    const counts = this.models.map((m) => m.lods.map(() => 0));
    for (const t of this.placed) {
      const m = this.models[t.peak.model];
      const l = m.lods.length > 1 && t.at.distanceTo(camera) > TOWER.near + t.peak.height ? 1 : 0;
      const n = counts[t.peak.model][l]++;
      const { base, frame } = m.attrs[l];
      (base.array as Float32Array).set([t.up.x, t.up.y, t.up.z, t.base], n * 4);
      (frame.array as Float32Array).set([t.e1.x, t.e1.y, t.e1.z, t.peak.height], n * 4);
      // (the stretch rides in the frame's length: the shader reads |e1| as the width's scale)
      (frame.array as Float32Array)[n * 4] *= t.peak.stretch;
      (frame.array as Float32Array)[n * 4 + 1] *= t.peak.stretch;
      (frame.array as Float32Array)[n * 4 + 2] *= t.peak.stretch;
    }
    this.models.forEach((m, k) =>
      m.lods.forEach((mesh, l) => {
        mesh.geometry.instanceCount = counts[k][l];
        m.attrs[l].base.needsUpdate = true;
        m.attrs[l].frame.needsUpdate = true;
      }),
    );
  }
}
