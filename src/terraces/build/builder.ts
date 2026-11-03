import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, type IUniform } from 'three';
import fragmentShader from '../terrace.frag.glsl?raw';
import vertexShader from '../terrace.vert.glsl?raw';
import { BUILD, buildTerraces, type BuildInput, type BuildOutput } from './construct';
import { FIELD } from './field';
import type { BuildMessage } from './worker';

// The terraces, built (ARCHITECTURE.md, "The terraces' build"): the paddy
// lab's construction over the whole planet at once (construct.ts), from the
// planet's mathematics (field.ts), in a worker of its own so the page draws
// on meanwhile, made into meshes a chunk of a cube face each. Never from the
// camera: built again only when the world's seed changes, the new meshes put
// in place of the old in one step once all are ready. The worker keeps the
// last build in the browser and loads it again while the build's code stands
// (worker.ts).

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
  /** The mountains and the houses it placed (per model: direction, base, height, which, turn, stretch). */
  peaks: Float32Array | null = null;
  houses: Float32Array | null = null;
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
    worker.onmessage = (e: MessageEvent<BuildMessage>) => {
      if (this.worker !== worker) return;
      const m = e.data;
      // (a build it is keeping in the browser: the worker let go once that is written)
      if (m.kind === 'kept' || !m.keeping) {
        worker.terminate();
        this.worker = null;
      }
      if (m.kind === 'built') this.install(m.out, m.kept, m.ms);
    };
    worker.postMessage(input);
  }

  private install(out: BuildOutput, kept = false, ms = 0): void {
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
    // (its figures as it was built; whether it was loaded as kept, and how long it took this time)
    this.stats = { ...out.stats, kept: kept ? 1 : 0, readyMs: Math.round(ms) };
    this.trees = out.trees;
    this.peaks = out.peaks;
    this.houses = out.houses;
    this.building = false;
    this.version++;
    for (const done of this.waiting.splice(0)) done();
  }

  /** A mesh of the terraces' own kind (their attributes, their paint) added to this build's, gone with it at the next. */
  add(geometry: BufferGeometry): Mesh {
    const mesh = new Mesh(geometry, this.material);
    mesh.renderOrder = -10;
    this.group.add(mesh);
    return mesh;
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
