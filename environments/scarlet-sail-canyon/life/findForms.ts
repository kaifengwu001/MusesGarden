import { BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcColorFactor, Points, ShaderMaterial, Vector4, type IUniform, type Vector3 } from 'three';
import { geometryBytes, gpuMemory } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { buildMesh, formOf, type CollectibleMesh, type Family, type Form, type Ground } from './collectibleForms';
import { MAX_BEDS, type BedLook, type FindBeds } from './findBeds';
import vertexShader from '../../../src/life/findForm.vert.glsl?raw';
import sphereFragment from '../../../src/life/findSphere.frag.glsl?raw';
import sphereVertex from '../../../src/life/findSphere.vert.glsl?raw';
import fragmentShader from '../../../src/life/grass.frag.glsl?raw';

// Each find's own specimen, standing in the middle of its bed (findBeds.ts),
// and, from high up, its glowing sphere. Every find gets one, not only the
// newest whose beds are drawn: one merged mesh in one draw (collectibleForms.ts
// grows it: the ground picks the family, the topic the kin, the id the
// individual), and one draw of points that reads the same buffers. The
// finds in beds plant and light up with them (their timeline, uBeds); the
// rest stand fully grown. The ground a find first grew on is kept, so its
// specimen stays what it is as the planet grows round it.

/** A find as it is drawn: its bed, its bed's colour, and its topic (its kin). */
export interface FormLook extends BedLook {
  readonly topic: string;
}

/** One find's place in the packed buffers (findForm.glsl reads them back). */
export interface PackedFind {
  readonly dir: Vector3;
  readonly ground: number;
  readonly family: Family;
  /** Below MAX_BEDS: its bed. */
  readonly index: number;
  /** 0..255: a bloom's or spire's bed colour (species × 64 + variant × 63), else its swatch. */
  readonly look: number;
}

export interface PackedForms {
  /** Per vertex: x, y, z × LOCAL_SCALE, then packShape's part and t. */
  readonly local: Int16Array;
  /** Per vertex: facing × 127, then the find's look − 128. */
  readonly normal: Int8Array;
  /** Per vertex: the find's direction (octahedral × 32767), ground × GROUND_SCALE, family × 4096 + index. */
  readonly find: Int16Array;
  readonly index: Uint16Array | Uint32Array;
  /** Per find, its first vertex; then the vertex count. */
  readonly firsts: Uint32Array;
}

/** Int16 steps per metre: in the find's frame (±4 m), and the ground over R (±128 m). */
const LOCAL_SCALE = 8192;
const GROUND_SCALE = 256;
/** Finds the packed index holds (12 bits). */
export const MAX_FINDS = 4096;
const FAMILY: Readonly<Record<Family, number>> = { bloom: 0, spire: 1, fern: 2, reed: 3, stone: 4 };
/** Swatches a garden's ferns, reeds and stones draw from at most (collectibleForms.ts has 13). */
const MAX_SWATCHES = 16;
/** Heights (m) over which the specimens shrink into their beds and the spheres light up in their place. */
const SWAP = [72, 88] as const;
/** The specimens stand this much larger than collectibleForms grows them: above their bed's flowers, which grow larger than the meadow's. */
const SPECIMEN_SCALE = 1.45;
/** A pulse lasts this long (s; findForm.glsl findLit). */
const PULSE = 1.4;
const GROUNDS_KEY = 'muses-garden:specimen-ground';

/** A unit vector folded onto the octahedron and flattened: two numbers in [-1, 1] (findForm.glsl octahedral). */
export function octahedral(d: Vector3): [number, number] {
  const l = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z);
  const u = d.x / l;
  const v = d.y / l;
  if (d.z >= 0) return [u, v];
  return [(1 - Math.abs(v)) * (u >= 0 ? 1 : -1), (1 - Math.abs(u)) * (v >= 0 ? 1 : -1)];
}

/** A find's direction and ground as packed (findForm.glsl findOf). */
function place(dir: Vector3, ground: number): [number, number, number] {
  const [u, v] = octahedral(dir);
  return [Math.round(u * 32767), Math.round(v * 32767), Math.round(Math.min(127, Math.max(-127, ground)) * GROUND_SCALE)];
}

/** buildMesh's mesh with each vertex carrying its find (20 bytes a vertex, as buildMesh's own). */
export function packForms(m: CollectibleMesh, finds: readonly PackedFind[]): PackedForms {
  const vertices = m.position.length / 3;
  const local = new Int16Array(vertices * 4);
  const normal = new Int8Array(m.normal);
  const find = new Int16Array(vertices * 4);
  const firsts = new Uint32Array(finds.length + 1).fill(vertices);
  for (let v = vertices - 1; v >= 0; v--) firsts[m.shape[v * 2 + 1]] = v;
  finds.forEach((f, k) => {
    const packed = [...place(f.dir, f.ground), FAMILY[f.family] * 4096 + f.index];
    for (let v = firsts[k]; v < firsts[k + 1]; v++) {
      for (let c = 0; c < 3; c++) local[v * 4 + c] = Math.round(m.position[v * 3 + c] * LOCAL_SCALE);
      local[v * 4 + 3] = m.shape[v * 2];
      normal[v * 4 + 3] = f.look - 128;
      find.set(packed, v * 4);
    }
  });
  return { local, normal, find, index: m.index, firsts };
}

/** The ground each find first grew on, kept across visits (by planet and find). */
class FirstGround {
  private kept: Record<string, readonly [number, number, number]> = {};
  private changed = false;

  constructor() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(GROUNDS_KEY) ?? '{}');
      if (raw && typeof raw === 'object') {
        for (const [key, g] of Object.entries(raw)) {
          if (Array.isArray(g) && g.length === 3 && g.every((x) => typeof x === 'number' && Number.isFinite(x))) this.kept[key] = [g[0], g[1], g[2]];
        }
      }
    } catch {
      // private windows and blocked storage: the ground is measured again each visit
    }
  }

  of(key: string, measure: () => Ground): Ground {
    const kept = this.kept[key];
    if (kept) return { shore: kept[0], wet: kept[1], lush: kept[2] };
    const g = measure();
    this.kept[key] = [Math.round(g.shore * 100) / 100, Math.round(g.wet * 1000) / 1000, Math.round(g.lush * 1000) / 1000];
    this.changed = true;
    return this.of(key, measure);
  }

  save(): void {
    if (!this.changed) return;
    this.changed = false;
    try {
      localStorage.setItem(GROUNDS_KEY, JSON.stringify(this.kept));
    } catch {
      // as above
    }
  }
}

interface Drawn {
  readonly look: FormLook;
  readonly index: number;
}

const sample = createGroundSample();

export class FindForms {
  readonly specimens: Mesh<BufferGeometry, ShaderMaterial>;
  readonly spheres: Points<BufferGeometry, ShaderMaterial>;
  /** hovered index, open index (-1: none), specimens shown, spheres shown (findForm.glsl uFindLook) */
  private readonly lit = new Vector4(-1, -1, 0, 0);
  private readonly swatches = Array.from({ length: MAX_SWATCHES }, () => new Vector4());
  private readonly grounds = new FirstGround();
  private drawn: readonly Drawn[] = [];
  private readonly index = new Map<string, number>();
  private firsts: Uint32Array = new Uint32Array(1);
  private builtFor = '';
  private hovered: string | null = null;
  private opened: string | null = null;
  private pulseUntil = 0;
  private warned = false;

  constructor(
    shared: Record<string, IUniform>,
    private readonly beds: FindBeds,
  ) {
    const uniforms = { ...shared, ...beds.uniforms, uFindLook: { value: this.lit }, uSwatches: { value: this.swatches } };
    const defines = { MAX_BEDS, MAX_SWATCHES, LOCAL_SCALE: LOCAL_SCALE.toFixed(1), GROUND_SCALE: GROUND_SCALE.toFixed(1), PULSE: PULSE.toFixed(2), SPECIMEN_SCALE: SPECIMEN_SCALE.toFixed(2) };
    this.specimens = new Mesh(new BufferGeometry(), new ShaderMaterial({ name: 'find specimens', vertexShader, fragmentShader, uniforms, defines, side: DoubleSide }));
    this.specimens.frustumCulled = false;
    this.specimens.renderOrder = -18;
    this.specimens.visible = false;
    this.spheres = new Points(
      new BufferGeometry(),
      // screened onto what is behind (src + dst · (1 − src)): a patch of finds glows brighter without burning out to white
      new ShaderMaterial({
        name: 'find spheres',
        vertexShader: sphereVertex,
        fragmentShader: sphereFragment,
        uniforms,
        defines,
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcColorFactor,
      }),
    );
    this.spheres.frustumCulled = false;
    this.spheres.visible = false;
  }

  get objects(): [Mesh, Points] {
    return [this.specimens, this.spheres];
  }

  /**
   * Grow these finds (the whole garden, in the beds' order; called after FindBeds.set, whenever it
   * changes or is laid out again). `hidden`: finds not planted yet; those without a bed wait unseen.
   */
  set(looks: readonly FormLook[], terrain: Terrain, hidden: ReadonlySet<string>): void {
    const drawn: Drawn[] = [];
    let past = MAX_BEDS;
    for (const look of looks) {
      const slot = this.beds.slot(look.bed.find);
      if (slot === undefined && hidden.has(look.bed.find)) continue;
      const index = slot ?? past++;
      if (index < MAX_FINDS) drawn.push({ look, index });
    }
    if (past > MAX_FINDS && !this.warned) {
      this.warned = true;
      console.warn(`garden: ${past} finds, but the specimens draw ${MAX_FINDS}`);
    }
    const key = JSON.stringify([terrain.layout.seed, drawn.map(({ look, index }) => [look.bed.find, look.topic, look.species, look.variant, index])]);
    if (key === this.builtFor) this.place(drawn);
    else this.build(drawn, terrain, key);
  }

  /** Light this find's outline (null: none). */
  hover(id: string | null): void {
    this.hovered = id;
  }

  /** Brighten the find whose card is up (null: none). */
  open(id: string | null): void {
    this.opened = id;
  }

  /** These finds pulse once, from now (those in beds: the newest). */
  pulse(ids: readonly string[]): void {
    this.beds.pulse(ids);
    this.pulseUntil = this.beds.now + PULSE;
  }

  /** How far the spheres have taken over from the specimens at the current height, 0..1. */
  spheresShown(): number {
    return this.lit.w;
  }

  /** Once a frame, after FindBeds.update (its plant clock): the camera's height (m), and whether the garden shows at all. */
  update(altitude: number, shown: boolean): void {
    const swap = shown ? smoothstep(SWAP[0], SWAP[1], altitude) : 0;
    const any = this.drawn.length > 0;
    this.lit.set(this.indexOf(this.hovered), this.indexOf(this.opened), shown ? 1 - swap : 0, swap);
    this.specimens.visible = any && this.lit.z > 0;
    // close by, the points draw only a lit find's glow behind its specimen
    this.spheres.visible = any && (swap > 0 || (shown && (this.lit.x >= 0 || this.lit.y >= 0 || this.beds.now < this.pulseUntil)));
  }

  private indexOf(id: string | null): number {
    return id === null ? -1 : (this.index.get(id) ?? -1);
  }

  private build(drawn: readonly Drawn[], terrain: Terrain, key: string): void {
    this.builtFor = key;
    this.drawn = drawn;
    this.index.clear();
    for (const { look, index } of drawn) this.index.set(look.bed.find, index);
    const seed = terrain.layout.seed;
    const forms: Form[] = drawn.map(({ look }) => {
      const { find, dir } = look.bed;
      const ground = this.grounds.of(`${seed}:${find}`, () => {
        terrain.sample(dir, sample);
        // fields.lush is -1..1; Ground.lush is 0..1
        return { shore: sample.water, wet: sample.wet, lush: 0.5 + 0.5 * terrain.fields.lush(dir) };
      });
      return formOf({ id: find, dir: [dir.x, dir.y, dir.z], kin: look.topic, open: true }, ground);
    });
    this.grounds.save();
    const swatches = new Map<string, number>();
    const packed = packForms(
      buildMesh(forms),
      forms.map((form, k) => {
        const { look, index } = drawn[k];
        let colour = look.species * 64 + Math.round(Math.min(1, Math.max(0, look.variant)) * 63);
        if (form.family !== 'bloom' && form.family !== 'spire') {
          const c = form.colour;
          const name = `${c.row},${c.lit},${c.mid},${c.shade}`;
          if (!swatches.has(name) && swatches.size < MAX_SWATCHES) {
            this.swatches[swatches.size].set(c.row, c.lit, c.mid, c.shade);
            swatches.set(name, swatches.size);
          }
          colour = swatches.get(name) ?? 0;
        }
        return { dir: look.bed.dir, ground: look.bed.ground, family: form.family, index, look: colour };
      }),
    );
    this.firsts = packed.firsts;
    this.specimens.geometry.dispose();
    this.spheres.geometry.dispose();
    const geometry = new BufferGeometry();
    const findAttribute = new BufferAttribute(packed.find, 4);
    const normalAttribute = new BufferAttribute(packed.normal, 4);
    geometry.setAttribute('aLocal', new BufferAttribute(packed.local, 4));
    geometry.setAttribute('aNormal', normalAttribute);
    geometry.setAttribute('aFind', findAttribute);
    geometry.setIndex(new BufferAttribute(packed.index, 1));
    this.specimens.geometry = geometry;
    // one point per find, at its first vertex
    const points = new BufferGeometry();
    points.setAttribute('aNormal', normalAttribute);
    points.setAttribute('aFind', findAttribute);
    const firsts = packed.firsts.subarray(0, drawn.length);
    points.setIndex(new BufferAttribute(packed.index instanceof Uint32Array ? new Uint32Array(firsts) : new Uint16Array(firsts), 1));
    this.spheres.geometry = points;
    gpuMemory.set('find specimens', geometryBytes(geometry));
    gpuMemory.set('find spheres', points.getIndex()?.array.byteLength ?? 0);
  }

  /** The same finds laid out again (the planet grew): only their places move. */
  private place(drawn: readonly Drawn[]): void {
    this.drawn = drawn;
    const attribute = this.specimens.geometry.getAttribute('aFind') as BufferAttribute | undefined;
    if (!attribute) return;
    const find = attribute.array as Int16Array;
    drawn.forEach(({ look }, k) => {
      const packed = place(look.bed.dir, look.bed.ground);
      for (let v = this.firsts[k]; v < this.firsts[k + 1]; v++) find.set(packed, v * 4);
    });
    attribute.needsUpdate = true;
  }
}
