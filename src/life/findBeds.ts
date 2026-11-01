import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  DoubleSide,
  FloatType,
  InstancedBufferAttribute,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcColorFactor,
  Points,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
  Vector4,
  type InstancedBufferGeometry,
  type IUniform,
} from 'three';
import { geometryBytes, gpuMemory } from '../core/gpuMemory';
import { hash32, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { BED_RADIUS, type Bed } from '../garden/placement';
import { travel, tangentToward } from '../planet/geo';
import vertexShader from './findBed.vert.glsl?raw';
import sphereFragment from './findSphere.frag.glsl?raw';
import sphereVertex from './findSphere.vert.glsl?raw';
import { FindTable, PER_ROW } from './findTable';
import { SPECIES_MESH } from './flowerMeshes';
import { HEADS } from './flowers';
import fragmentShader from './grass.frag.glsl?raw';

// The finds on the planet. Each find Muse kept grows as a patch of the
// meadow's own flowers where it was found: its species the find's topic
// (Interest.species, coloured by its variant), with a few companions of the
// meadow's other species so it reads as a clump of the meadow rather than a
// planted square. One instanced draw per species (findBed.vert.glsl). From
// high up, where the patches are a pixel or two, each find shows as a
// glowing sphere instead (findSphere.vert.glsl), one draw of points.
// Both read each find's state from one texture (findTable.ts): the one whose
// card is up is a touch brighter, the one under the pointer lifts and glows,
// one coming home pulses, and the picked basket's grow larger in a cool tint
// until another basket is picked. Every patch stands grown: a find's flower
// comes home from the basket into a patch already there.
// Each patch has a hero: the plant of its species nearest its middle, the one a
// find's flower in the basket stands for. It is flagged by a negative aDelay (the
// shader reads abs()), so the buffers keep their size. It can be hidden while
// its twin is in the air, land (a sway runs out through the patch), and stand
// in focus: lifted, larger and lit.

/** Plants per patch, the share of them that are companions, and their size against the meadow's flowers. */
const PLANTS = 58;
/** The smaller species grow bigger in a patch, so every patch reads at the same distance: pink cup, star, button, cluster. */
const SPECIES_SIZE = [1.0, 1.12, 1.45, 1.4] as const;
const COMPANIONS = 0.16;
const SIZE = [1.25, 1.65] as const;
/** Higher than this (m) the patches are a pixel or two, and the near field's maps they read are not drawn (world.ts): they are not drawn either. */
const SEEN_BELOW = 88;
/** Heights (m) over which the spheres light up as the patches shrink to nothing. */
const SWAP = [72, 88] as const;
/** A pulse lasts this long (s). */
const PULSE = 1.4;
/** The picked basket's patches and spheres stand this much larger; a hero in focus stands this much higher (m) and larger, and nods this far (rad). */
const MARK_SIZE = 1.3;
const FOCUS_LIFT = 0.12;
const FOCUS_SIZE = 1.55;
const FOCUS_NOD = 0.14;
/** A hero landing or in focus is drawn this much nearer (m) than it stands, over the rest of its patch. */
const HERO_NEAR = 1.2;

export interface BedLook {
  readonly bed: Bed;
  readonly species: 0 | 1 | 2 | 3;
  readonly variant: number;
}

/** A patch's hero plant, as its patch draws it. */
export interface Hero {
  /** Where it stands: a unit direction, and its ground's height over R (m). */
  readonly dir: Vector3;
  readonly ground: number;
  readonly species: 0 | 1 | 2 | 3;
  /** As findBed.vert.glsl reads them (aLook): its size factor, its seed in [0, 1) and its colour variant. */
  readonly size: number;
  readonly seed: number;
  readonly variant: number;
}

/** How a hero stands as findBed.vert.glsl draws it in still air: its foot (planet space, unwarped), its frame (side, up, forward) and its size (m per m of the flower's mesh). */
export interface Stance {
  readonly foot: Vector3;
  readonly side: Vector3;
  readonly up: Vector3;
  readonly forward: Vector3;
  readonly scale: number;
}

/** A find's state as its hero reads it: the basket's mark, the lift under the pointer, its focus, 0..1. */
export interface HeroState {
  readonly mark: number;
  readonly lift: number;
  readonly focus: number;
  readonly open: number;
}


/** findBed.vert.glsl's rnd. */
function rnd(s: number, k: number): number {
  const x = Math.sin(s * 78.233 + k * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Where and how large a hero stands, as its patch draws it (the wind and the landing's bounce left out). */
export function heroStance(hero: Hero, radius: number, state: HeroState): Stance {
  const up = hero.dir.clone();
  const ref = Math.abs(up.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const t1 = new Vector3().crossVectors(up, ref).normalize();
  const t2 = new Vector3().crossVectors(up, t1);
  const yaw = rnd(hero.seed, 4) * Math.PI * 2;
  const side = t1.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(t2, Math.sin(yaw));
  const forward = new Vector3().crossVectors(side, up);
  const focus = state.focus;
  const scale = hero.size * (0.85 + 0.3 * rnd(hero.seed, 3)) * (1 + (MARK_SIZE - 1) * state.mark) * (1 + (FOCUS_SIZE - 1) * focus);
  const foot = up.clone().multiplyScalar(radius + hero.ground - 0.02 + 0.22 * state.lift + FOCUS_LIFT * focus);
  return { foot, side, up, forward, scale };
}

function rand(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

function idSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function stateTexture(table: FindTable): DataTexture {
  const texture = new DataTexture(table.data, PER_ROW * 2, table.rows, RGBAFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Write a geometry's buffers in place when they keep their length (the planet grew); else let the old go and make new ones. */
function fill(g: BufferGeometry, buffers: Record<string, { values: number[]; size: number }>, instanced: boolean): void {
  const [first] = Object.entries(buffers);
  const old = g.getAttribute(first[0]) as BufferAttribute | undefined;
  if (old && old.count === first[1].values.length / first[1].size) {
    for (const [name, { values }] of Object.entries(buffers)) (g.getAttribute(name) as BufferAttribute).copyArray(values).needsUpdate = true;
    return;
  }
  if (old) g.dispose();
  for (const [name, { values, size }] of Object.entries(buffers)) {
    const array = new Float32Array(values);
    g.setAttribute(name, instanced ? new InstancedBufferAttribute(array, size) : new BufferAttribute(array, size));
  }
}

export class FindBeds {
  readonly meshes: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>> = [];
  readonly spheres: Points<BufferGeometry, ShaderMaterial>;
  private readonly table = new FindTable();
  private heroes = new Map<string, Hero>();
  private readonly state: IUniform<DataTexture>;
  private uploaded = -1;
  private readonly clock = { value: 0 };
  /** How plainly the spheres show at the camera's height, 0..1. */
  private readonly spheresLook = { value: 0 };
  private readonly start = performance.now();

  constructor(shared: Record<string, IUniform>) {
    this.state = { value: stateTexture(this.table) };
    gpuMemory.set('find state', this.table.data.byteLength);
    const uniforms = { ...shared, uFinds: this.state, uPlantClock: this.clock };
    const defines = {
      FIND_PER_ROW: PER_ROW,
      FIND_PULSE: PULSE.toFixed(2),
      MARK_SIZE: MARK_SIZE.toFixed(2),
      BED_SPAN: (2 * BED_RADIUS).toFixed(2),
      FOCUS_LIFT: FOCUS_LIFT.toFixed(2),
      FOCUS_SIZE: FOCUS_SIZE.toFixed(2),
      FOCUS_NOD: FOCUS_NOD.toFixed(2),
      HERO_NEAR: HERO_NEAR.toFixed(2),
    };
    SPECIES_MESH.forEach((make, species) => {
      const geometry = make();
      geometry.instanceCount = 0;
      const material = new ShaderMaterial({
        name: `find beds ${species}`,
        vertexShader,
        fragmentShader,
        uniforms: {
          ...uniforms,
          uSpecies: { value: species },
          uBedLook: { value: new Vector4(HEADS[species][0], HEADS[species][1], 0, 0) },
        },
        defines,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -18;
      mesh.visible = false;
      this.meshes.push(mesh);
    });
    this.spheres = new Points(
      new BufferGeometry(),
      // screened onto what is behind (src + dst · (1 − src)): a patch of finds glows brighter without burning out to white
      new ShaderMaterial({
        name: 'find spheres',
        vertexShader: sphereVertex,
        fragmentShader: sphereFragment,
        uniforms: { ...uniforms, uSpheres: this.spheresLook },
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

  get objects(): Array<Mesh | Points> {
    return [...this.meshes, this.spheres];
  }

  /** Seconds on the plant clock (wall time: a planting plays even while world time is frozen). */
  get now(): number {
    return (performance.now() - this.start) / 1000;
  }

  /** Grow these finds' patches (the whole garden; called again whenever it changes). */
  set(looks: readonly BedLook[], radius: number): void {
    this.table.assign(looks.map((l) => l.bed.find));
    const per = SPECIES_MESH.map(() => ({ place: [] as number[], look: [] as number[], delay: [] as number[] }));
    const spheres = { place: [] as number[], look: [] as number[] };
    const p = new Vector3();
    const t = new Vector3();
    const heroes = new Map<string, Hero>();
    looks.forEach((entry, b) => {
      const { bed } = entry;
      spheres.place.push(bed.dir.x, bed.dir.y, bed.dir.z, bed.ground);
      spheres.look.push(entry.species, entry.variant, b, 0);
      const r = rand(idSeed(bed.find));
      const north = tangentToward(bed.dir, new Vector3(0, 1, 0), new Vector3());
      const east = new Vector3().crossVectors(bed.dir, north);
      let best: { at: number; reach: number; hero: Hero } | null = null;
      for (let k = 0; k < PLANTS; k++) {
        // denser in the middle; companions toward the rim
        const companion = r() < COMPANIONS;
        const reach = BED_RADIUS * Math.pow(r(), companion ? 0.45 : 0.7);
        const a = r() * Math.PI * 2;
        t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
        travel(bed.dir, t, reach / radius, p);
        const species = companion ? (entry.species + 1 + Math.floor(r() * 3)) % 4 : entry.species;
        const size = (SIZE[0] + (SIZE[1] - SIZE[0]) * r() * (1 - (0.35 * reach) / BED_RADIUS)) * SPECIES_SIZE[species];
        const variant = companion ? r() : Math.min(1, Math.max(0, entry.variant + (r() - 0.5) * 0.18));
        const slot = per[species];
        const seed = r();
        const scale = companion ? size * 0.8 : size;
        if (!companion && (!best || reach < best.reach)) {
          best = { at: slot.delay.length, reach, hero: { dir: p.clone(), ground: bed.ground, species: entry.species, size: scale, seed, variant } };
        }
        slot.place.push(p.x, p.y, p.z, bed.ground);
        slot.look.push(seed, scale, variant, b);
        slot.delay.push((reach / BED_RADIUS) * 0.7 + r() * 0.15);
      }
      if (best) {
        const delay = per[entry.species].delay;
        delay[best.at] = -delay[best.at];
        heroes.set(bed.find, best.hero);
      }
    });
    this.heroes = heroes;
    this.meshes.forEach((mesh, s) => {
      const { place, look, delay } = per[s];
      fill(mesh.geometry, { aPlace: { values: place, size: 4 }, aLook: { values: look, size: 4 }, aDelay: { values: delay, size: 1 } }, true);
      mesh.geometry.instanceCount = delay.length;
    });
    fill(this.spheres.geometry, { aPlace: { values: spheres.place, size: 4 }, aLook: { values: spheres.look, size: 4 } }, false);
    this.spheres.geometry.setDrawRange(0, looks.length);
    gpuMemory.set('find beds', this.meshes.reduce((sum, mesh) => sum + geometryBytes(mesh.geometry), 0));
    gpuMemory.set('find spheres', geometryBytes(this.spheres.geometry));
    this.upload();
  }

  /** A find's hero plant (null: no such find in the garden). */
  hero(find: string): Hero | null {
    return this.heroes.get(find) ?? null;
  }

  /** A find's state as its hero reads it now (null: no such find). */
  heroState(find: string): HeroState | null {
    const t = this.table;
    const mark = t.get(find, 'mark');
    if (mark === undefined) return null;
    return { mark, lift: t.get(find, 'lift') ?? 0, focus: t.get(find, 'focus') ?? 0, open: t.get(find, 'open') ?? 0 };
  }

  /** Bring a find's hero into focus, easing (null: none). One at a time; the last one eases back. */
  focus(find: string | null): void {
    this.table.focus(find);
  }

  get focused(): string | null {
    return this.table.focused;
  }

  /** A find's flower has come down into its patch, now. */
  land(find: string): void {
    this.table.land(find, this.now);
  }

  /** Hide a find's hero while its twin is in the air, or show it again. */
  away(find: string, on: boolean): void {
    this.table.away(find, on);
  }

  /** These finds pulse once, from now. */
  pulse(finds: readonly string[]): void {
    this.table.pulse(finds, this.now);
  }

  /** Brighten the find whose card is up (null: none). */
  open(find: string | null): void {
    this.table.open(find);
  }

  /** Lift and light the find under the pointer (null: none). */
  hover(find: string | null): void {
    this.table.hover(find);
  }

  /** The picked basket's finds: larger, in its tint, until another basket is picked. */
  select(finds: readonly string[]): void {
    this.table.select(finds);
  }

  get hovered(): string | null {
    return this.table.hovered;
  }

  get selected(): readonly string[] {
    return this.table.selected;
  }

  /** Whether the patches are drawn at the camera's height. */
  bedsShown(): boolean {
    return this.meshes.some((mesh) => mesh.visible);
  }

  /** How far the spheres have taken over from the patches at the camera's height, 0..1. */
  spheresShown(): number {
    return this.spheresLook.value;
  }

  /** Once a frame: the camera's height (m), and whether the garden shows at all. */
  update(altitude: number, shown: boolean): void {
    const now = this.now;
    this.table.ease(now - this.clock.value);
    this.clock.value = now;
    this.upload();
    const near = shown && altitude < SEEN_BELOW;
    for (const mesh of this.meshes) mesh.visible = near && mesh.geometry.instanceCount > 0;
    this.spheresLook.value = shown ? smoothstep(SWAP[0], SWAP[1], altitude) : 0;
    this.spheres.visible = this.table.size > 0 && this.spheresLook.value > 0;
  }

  private upload(): void {
    if (this.table.version === this.uploaded) return;
    this.uploaded = this.table.version;
    const texture = this.state.value;
    if (texture.image.height !== this.table.rows) {
      texture.dispose();
      this.state.value = stateTexture(this.table);
      gpuMemory.set('find state', this.table.data.byteLength);
      return;
    }
    texture.image.data = this.table.data;
    texture.needsUpdate = true;
  }
}
