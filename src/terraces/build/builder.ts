import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, type IUniform } from 'three';
import fragmentShader from '../terrace.frag.glsl?raw';
import vertexShader from '../terrace.vert.glsl?raw';
import { BUILD, buildTerraces, type BuildInput, type BuildOutput } from './construct';
import { FIELD } from './field';

// The terraces, built (ARCHITECTURE.md, "The terraces' build"): the paddy
// lab's construction over the whole planet at once (construct.ts), from the
// planet's mathematics (field.ts), in a worker of its own so the page draws
// on meanwhile, made into meshes a chunk of a cube face each. Never from the
// camera: built again only when the world's seed changes, the new meshes put
// in place of the old in one step once all are ready.

export class TerraceBuild {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private builtFor = -1;
  private worker: Worker | null = null;
  /** Whether a build is under way, and the last one's figures (stage times, counts). */
  building = false;
  stats: Record<string, number> = {};
  /** The trees the last build placed (per tree: direction, ground, seed). */
  trees: Float32Array | null = null;
  /** Builds put in place so far (a key for what reads the meshes). */
  version = 0;
  private waiting: Array<() => void> = [];

  constructor(shared: Record<string, IUniform>) {
    this.material = new ShaderMaterial({ name: 'terraces', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide });
    this.group.name = 'terraces';
  }

  /** Build the planet's terraces for the world's noise seed, if not built for it yet. */
  update(seed: number): void {
    if (seed === this.builtFor) return;
    this.builtFor = seed;
    const input: BuildInput = { seed, field: FIELD, params: BUILD };
    this.worker?.terminate();
    this.building = true;
    if (typeof Worker === 'undefined') {
      this.install(buildTerraces(input));
      return;
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<BuildOutput>) => {
      if (this.worker !== worker) return;
      worker.terminate();
      this.worker = null;
      this.install(e.data);
    };
    worker.postMessage(input);
  }

  private install(out: BuildOutput): void {
    // in place of the old, all at once
    for (const m of [...this.group.children] as Mesh[]) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    for (const c of out.chunks) {
      if (!c) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(c.position, 3));
      g.setAttribute('normal', new BufferAttribute(c.normal, 3, true));
      g.setAttribute('aPart', new BufferAttribute(c.part, 1));
      g.setAttribute('aPaddy', new BufferAttribute(c.paddy, 4, true));
      g.setAttribute('aFloor', new BufferAttribute(c.floor, 4));
      g.setIndex(new BufferAttribute(c.index, 1));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, this.material);
      mesh.renderOrder = -10; // before the ground: early-z skips the shading of the ground sunk under them
      this.group.add(mesh);
    }
    this.stats = out.stats;
    this.trees = out.trees;
    this.building = false;
    this.version++;
    for (const done of this.waiting.splice(0)) done();
  }

  /** Resolved once the build under way (if any) is in place. */
  whenBuilt(): Promise<void> {
    if (!this.building) return Promise.resolve();
    return new Promise((done) => this.waiting.push(done));
  }

  get triangles(): number {
    let n = 0;
    for (const m of this.group.children as Mesh[]) if (m.geometry.index) n += m.geometry.index.count / 3;
    return n;
  }
}
