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
import { warpNormal, warpPoint, type WarpFrame } from '../render/warp';
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
/** A landing's sway runs out through its patch for this long (s); its hero is lit, and holds still, till then. */
const LAND_RING = 1.1;
/** A patch lifts this far (m) under the pointer. */
const HOVER_LIFT = 0.22;
/** How far the wind leans a stem's top, in stem tops, for picking: a patch's reach (a fresh wind), a head's (a steady one). */
const LEAN = 0.5;
const HEAD_LEAN = 0.3;

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

/** A patch as drawn, still and unmarked, for picking it: how far its flowers reach from its middle and over its ground (m), and its plants but the hero. */
interface Reach {
  readonly find: string;
  readonly dir: Vector3;
  readonly ground: number;
  readonly across: number;
  readonly up: number;
  /** Per plant: its direction (x, y, z), its size as drawn and its species. */
  readonly plants: number[];
}

/** Numbers per plant in a Reach's plants. */
const PLANT = 5;
const toCentre = new Vector3();

/** Where a ray (from `o`, unit `ray`) first meets a ball round `c` of radius `r`: its distance (0 inside), or null. */
function rayBall(o: Vector3, ray: Vector3, c: Vector3, r: number): number | null {
  const oc = toCentre.subVectors(o, c);
  const b = oc.dot(ray);
  const q = oc.lengthSq() - r * r;
  if (q <= 0) return 0;
  const disc = b * b - q;
  if (b > 0 || disc < 0) return null;
  return -b - Math.sqrt(disc);
}

const edge1 = new Vector3();
const edge2 = new Vector3();
const across3 = new Vector3();
const toCorner = new Vector3();
const lever = new Vector3();

/** Where a ray (from `o`, unit `ray`) meets the triangle a, b, c: its distance, or null. */
function rayTriangle(o: Vector3, ray: Vector3, a: Vector3, b: Vector3, c: Vector3): number | null {
  edge1.subVectors(b, a);
  edge2.subVectors(c, a);
  across3.crossVectors(ray, edge2);
  const det = edge1.dot(across3);
  if (Math.abs(det) < 1e-12) return null;
  toCorner.subVectors(o, a);
  const u = toCorner.dot(across3) / det;
  if (u < 0 || u > 1) return null;
  lever.crossVectors(toCorner, edge1);
  const v = ray.dot(lever) / det;
  if (v < 0 || u + v > 1) return null;
  const t = edge2.dot(lever) / det;
  return t > 0 ? t : null;
}

const rayAxis = new Vector3();
const rayFrom = new Vector3();
const rayAcross = new Vector3();
const fromAcross = new Vector3();

/** Where a ray (from `o`, unit `ray`) first meets a capped column from `a` up to `b` of radius `r`: its distance, or null. */
function rayColumn(o: Vector3, ray: Vector3, a: Vector3, b: Vector3, r: number): number | null {
  const axis = rayAxis.subVectors(b, a);
  const length = axis.length();
  if (length < 1e-6) return null;
  axis.divideScalar(length);
  const from = rayFrom.subVectors(o, a);
  const along = ray.dot(axis);
  const at = from.dot(axis);
  const across = rayAcross.copy(ray).addScaledVector(axis, -along);
  const off = fromAcross.copy(from).addScaledVector(axis, -at);
  const c = off.lengthSq() - r * r;
  if (c <= 0 && at >= 0 && at <= length) return 0;
  let best = Infinity;
  const qa = across.lengthSq();
  const qb = 2 * off.dot(across);
  const disc = qb * qb - 4 * qa * c;
  if (qa > 1e-12 && disc >= 0) {
    const t = (-qb - Math.sqrt(disc)) / (2 * qa);
    const h = at + t * along;
    if (t > 0 && h >= 0 && h <= length) best = t;
  }
  if (Math.abs(along) > 1e-9) {
    for (const h of [0, length]) {
      const t = (h - at) / along;
      if (t > 0 && t < best && off.lengthSq() + 2 * t * off.dot(across) + t * t * qa <= r * r) best = t;
    }
  }
  return best < Infinity ? best : null;
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
  const foot = up.clone().multiplyScalar(radius + hero.ground - 0.02 + HOVER_LIFT * state.lift + FOCUS_LIFT * focus);
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
  private reaches: Reach[] = [];
  /** Each species' head as its mesh has it: how far it reaches from its stem's top (m of mesh), and its triangles' corners from there (x, y, z each). */
  private readonly headSize: number[] = [];
  private readonly headTriangles: Float32Array[] = [];
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
      const position = geometry.getAttribute('position');
      const part = geometry.getAttribute('aPart');
      let head = 0;
      for (let i = 0; i < position.count; i++) {
        if (part.getX(i) > 0.5) head = Math.max(head, Math.hypot(position.getX(i), position.getY(i) - HEADS[species][0], position.getZ(i)));
      }
      this.headSize.push(head);
      const corners: number[] = [];
      const index = geometry.index;
      for (let k = 0; index && k < index.count; k += 3) {
        const tri = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
        if (tri.some((i) => part.getX(i) < 0.5)) continue;
        for (const i of tri) corners.push(position.getX(i), position.getY(i) - HEADS[species][0], position.getZ(i));
      }
      this.headTriangles.push(new Float32Array(corners));
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
    const reaches: Reach[] = [];
    looks.forEach((entry, b) => {
      const { bed } = entry;
      const extent = { find: bed.find, dir: bed.dir.clone(), ground: bed.ground, across: 0, up: 0, plants: [] as number[] };
      spheres.place.push(bed.dir.x, bed.dir.y, bed.dir.z, bed.ground);
      spheres.look.push(entry.species, entry.variant, b, 0);
      const r = rand(idSeed(bed.find));
      const north = tangentToward(bed.dir, new Vector3(0, 1, 0), new Vector3());
      const east = new Vector3().crossVectors(bed.dir, north);
      let best: { at: number; reach: number; plant: number; hero: Hero } | null = null;
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
          best = { at: slot.delay.length, reach, plant: extent.plants.length, hero: { dir: p.clone(), ground: bed.ground, species: entry.species, size: scale, seed, variant } };
        }
        slot.place.push(p.x, p.y, p.z, bed.ground);
        slot.look.push(seed, scale, variant, b);
        const drawn = scale * (0.85 + 0.3 * rnd(seed, 3));
        extent.plants.push(p.x, p.y, p.z, drawn, species);
        extent.across = Math.max(extent.across, reach + (this.headSize[species] + LEAN * HEADS[species][0]) * drawn);
        extent.up = Math.max(extent.up, (HEADS[species][0] + this.headSize[species]) * drawn);
        slot.delay.push((reach / BED_RADIUS) * 0.7 + r() * 0.15);
      }
      if (best) {
        const delay = per[entry.species].delay;
        delay[best.at] = -delay[best.at];
        heroes.set(bed.find, best.hero);
        // (its hero stands as heroStance has it)
        extent.plants.splice(best.plant, PLANT);
      }
      reaches.push(extent);
    });
    this.heroes = heroes;
    this.reaches = reaches;
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

  /** Whether a find's hero is lit: in focus, or its flower landing (drawn over its patch, held still). */
  private heroLit(find: string, state: HeroState): boolean {
    const since = this.clock.value - (this.table.get(find, 'landed') ?? -Infinity);
    return state.focus > 0 || (since >= 0 && since < LAND_RING);
  }

  /**
   * The patch a ray (from `origin`, unit `ray`, in view space: through `warp`, on a planet `radius` m) meets first,
   * as drawn (lifted, marked, its hero lit as they stand now; on this side of the horizon): the nearest flower head
   * it meets, else the nearest patch whose column (from its ground up to its heads) it passes through. Its depth is
   * as drawn: a lit hero is drawn HERO_NEAR m nearer than it stands.
   */
  pick(origin: Vector3, ray: Vector3, warp: WarpFrame, radius: number): { find: string; depth: number } | null {
    let head: { find: string; depth: number } | null = null;
    let column: { find: string; depth: number } | null = null;
    const foot = new Vector3();
    const top = new Vector3();
    const normal = new Vector3();
    const at = new Vector3();
    const meet = (find: string, depth: number | null, best: typeof head): typeof head => (depth !== null && (!best || depth < best.depth) ? { find, depth } : best);
    for (const e of this.reaches) {
      const state = this.heroState(e.find);
      if (!state) continue;
      foot.copy(e.dir).multiplyScalar(radius + e.ground);
      warpNormal(warp, foot, e.dir, normal);
      warpPoint(warp, foot, foot);
      if (normal.dot(top.subVectors(origin, foot).normalize()) < -0.05) continue;
      const mark = 1 + (MARK_SIZE - 1) * state.mark;
      const lift = HOVER_LIFT * state.lift;
      const hero = this.heroes.get(e.find);
      const stance = hero && (this.table.get(e.find, 'away') ?? 0) < 0.5 ? heroStance(hero, radius, state) : null;
      const lit = stance !== null && this.heroLit(e.find, state);
      let up = lift + e.up * mark;
      if (hero && stance) up = Math.max(up, stance.foot.length() - radius - e.ground + (HEADS[hero.species][0] + this.headSize[hero.species]) * stance.scale);
      top.copy(e.dir).multiplyScalar(radius + e.ground + up);
      warpPoint(warp, top, top);
      const t = rayColumn(origin, ray, foot, top, e.across * mark);
      if (t === null) continue;
      column = meet(e.find, t - (lit ? HERO_NEAR : 0), column);
      // its heads: each a ball round its stem's top as large as its head and the wind's lean; a lit hero's, as drawn
      const p = e.plants;
      for (let k = 0; k < p.length; k += PLANT) {
        const species = p[k + 4];
        const size = p[k + 3] * mark;
        const stem = HEADS[species][0] * size;
        at.set(p[k], p[k + 1], p[k + 2]).multiplyScalar(radius + e.ground - 0.02 + lift + stem);
        head = meet(e.find, rayBall(origin, ray, warpPoint(warp, at, at), this.headSize[species] * size + HEAD_LEAN * stem), head);
      }
      if (hero && stance && lit) head = meet(e.find, this.litHead(hero, stance, origin, ray, warp), head);
      else if (hero && stance) {
        const stem = HEADS[hero.species][0] * stance.scale;
        at.copy(stance.foot).addScaledVector(stance.up, stem);
        head = meet(e.find, rayBall(origin, ray, warpPoint(warp, at, at), this.headSize[hero.species] * stance.scale + HEAD_LEAN * stem), head);
      }
    }
    return head ?? column;
  }

  /**
   * Where a ray meets a lit hero's head, triangle by triangle as findBed.vert.glsl draws it (it holds still: nodded
   * its species' nod, no wind), at its depth as drawn (HERO_NEAR m nearer); null when it misses.
   */
  private litHead(hero: Hero, stance: Stance, origin: Vector3, ray: Vector3, warp: WarpFrame): number | null {
    const top = stance.foot.clone().addScaledVector(stance.up, HEADS[hero.species][0] * stance.scale);
    const nod = HEADS[hero.species][1];
    const c = Math.cos(nod);
    const sn = Math.sin(nod);
    const corners = this.headTriangles[hero.species];
    const v = [new Vector3(), new Vector3(), new Vector3()];
    let best: number | null = null;
    for (let k = 0; k < corners.length; k += 9) {
      for (let j = 0; j < 3; j++) {
        const x = corners[k + j * 3];
        const y = corners[k + j * 3 + 1];
        const z = corners[k + j * 3 + 2];
        // rotateAxis about the plant's own x (its side), by the nod
        const ry = y * c - z * sn;
        const rz = z * c + y * sn;
        v[j].copy(top).addScaledVector(stance.side, x * stance.scale).addScaledVector(stance.up, ry * stance.scale).addScaledVector(stance.forward, rz * stance.scale);
        warpPoint(warp, v[j], v[j]);
      }
      const t = rayTriangle(origin, ray, v[0], v[1], v[2]);
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best === null ? null : best - HERO_NEAR;
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
