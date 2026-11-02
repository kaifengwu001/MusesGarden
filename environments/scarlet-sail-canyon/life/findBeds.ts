import { DoubleSide, InstancedBufferAttribute, Mesh, ShaderMaterial, Vector3, Vector4, type InstancedBufferGeometry, type IUniform } from 'three';
import { geometryBytes, gpuMemory } from '../../../src/core/gpuMemory';
import { hash32, unit } from '../../../src/core/hash';
import { BED_RADIUS, type Bed } from '../garden/placement';
import { travel, tangentToward } from '../../../src/planet/geo';
import vertexShader from './findBed.vert.glsl?raw';
import { SPECIES_MESH } from './flowerMeshes';
import { HEADS } from './flowers';
import fragmentShader from './nativePlant.frag.glsl?raw';

// Each kept find grows a native canyon patch: coral, ivory fern or sage.
// Topic channel IDs, planting timelines, highlights and hover lifts are unchanged.
// The full botanical templates need fewer instances than meadow flowers.

/** Plants per bed, the share of them that are companions, and their size against the meadow's flowers. */
export const BED_PLANTS = 14;
/** Compact native plants fit the bed while leaving its saved specimen visible. */
const SPECIES_SIZE = [1.0, 0.9, 1.0, 1.1] as const;
const COMPANIONS = 0.28;
const SIZE = [0.85, 1.1] as const;
/** The bed's middle is left to the find's specimen (findForms.ts): no flower within this (m). */
const HOLE = 0.25;
/** Beds a draw can address (MAX_BEDS in the shader). */
export const MAX_BEDS = 64;
/** A bed planted long ago: fully grown. A bed not planted yet: hidden. */
const LONG_AGO = -1e6;
const NOT_YET = 1e9;
/** Higher than this (m) the beds are a pixel or two, and the near field's maps they read are not drawn (world.ts): they are not drawn either. */
const SEEN_BELOW = 88;
/** How fast the bed under the pointer lifts, and settles back (s). */
const LIFT_TIME = 0.12;

export interface BedLook {
  readonly bed: Bed;
  readonly species: 0 | 1 | 2 | 3;
  readonly variant: number;
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

export class FindBeds {
  readonly meshes: Array<Mesh<InstancedBufferGeometry, ShaderMaterial>> = [];
  /** Per bed: planted at (s on the plant clock), highlight, lift under the pointer (0..1), pulsed at (s); shared by the four draws and the finds' specimens (findForms.ts). */
  private readonly beds = Array.from({ length: MAX_BEDS }, () => new Vector4(LONG_AGO, 0, 0, LONG_AGO));
  private readonly clock = { value: 0 };
  /** The beds' timeline, for other draws that plant and light up with them. */
  readonly uniforms: { readonly uBeds: IUniform<Vector4[]>; readonly uPlantClock: IUniform<number> } = { uBeds: { value: this.beds }, uPlantClock: this.clock };
  private readonly index = new Map<string, number>();
  /** The find each bed was last laid out for: a bed handed to another find starts its timeline again. */
  private readonly holder: Array<string | null> = Array.from({ length: MAX_BEDS }, () => null);
  private highlighted = -1;
  private hovered: string | null = null;
  private readonly start = performance.now();

  constructor(shared: Record<string, IUniform>) {
    SPECIES_MESH.forEach((make, species) => {
      const geometry = make();
      geometry.instanceCount = 0;
      const material = new ShaderMaterial({
        name: `find beds ${species}`,
        vertexShader,
        fragmentShader,
        uniforms: {
          ...shared,
          ...this.uniforms,
          uSpecies: { value: species },
          uBedLook: { value: new Vector4(HEADS[species][0], HEADS[species][1], 0, 0) },
        },
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -18;
      mesh.visible = false;
      this.meshes.push(mesh);
    });
  }

  /** Seconds on the plant clock (wall time: a planting plays even while world time is frozen). */
  get now(): number {
    return (performance.now() - this.start) / 1000;
  }

  /** Grow these beds (the whole garden; called again whenever it changes). `hidden`: beds not planted yet. */
  set(looks: readonly BedLook[], radius: number, hidden: ReadonlySet<string>): void {
    const per: Array<{ place: number[]; look: number[]; delay: number[] }> = SPECIES_MESH.map(() => ({ place: [], look: [], delay: [] }));
    this.index.clear();
    const p = new Vector3();
    const t = new Vector3();
    looks.slice(0, MAX_BEDS).forEach((entry, b) => {
      const { bed } = entry;
      this.index.set(bed.find, b);
      if (this.holder[b] !== bed.find) {
        this.holder[b] = bed.find;
        this.beds[b].x = LONG_AGO;
        this.beds[b].w = LONG_AGO;
      }
      if (hidden.has(bed.find)) this.beds[b].x = NOT_YET;
      else if (this.beds[b].x === NOT_YET) this.beds[b].x = LONG_AGO;
      const r = rand(idSeed(bed.find));
      const north = tangentToward(bed.dir, new Vector3(0, 1, 0), new Vector3());
      const east = new Vector3().crossVectors(bed.dir, north);
      for (let k = 0; k < BED_PLANTS; k++) {
        // denser in the middle, round the find's own specimen; companions toward the rim
        const companion = r() < COMPANIONS;
        const reach = HOLE + (BED_RADIUS - HOLE) * Math.pow(r(), companion ? 0.45 : 0.7);
        const a = r() * Math.PI * 2;
        t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
        travel(bed.dir, t, reach / radius, p);
        const species = companion ? ((entry.species + 1 + Math.floor(r() * 3)) % 4) : entry.species;
        const size = (SIZE[0] + (SIZE[1] - SIZE[0]) * r() * (1 - (0.35 * reach) / BED_RADIUS)) * SPECIES_SIZE[species];
        const variant = companion ? r() : Math.min(1, Math.max(0, entry.variant + (r() - 0.5) * 0.18));
        const slot = per[species];
        slot.place.push(p.x, p.y, p.z, bed.ground);
        slot.look.push(r(), companion ? size * 0.8 : size, variant, b);
        slot.delay.push((reach / BED_RADIUS) * 0.7 + r() * 0.15);
      }
    });
    if (looks.length > MAX_BEDS) console.warn(`garden: ${looks.length} finds, but the beds draw ${MAX_BEDS}`);
    this.meshes.forEach((mesh, s) => {
      const g = mesh.geometry;
      const slot = per[s];
      const count = slot.delay.length;
      const old = g.getAttribute('aDelay') as InstancedBufferAttribute | undefined;
      if (old && old.count === count) {
        // the same garden re-laid (the planet grew): write over the buffers in place
        (g.getAttribute('aPlace') as InstancedBufferAttribute).copyArray(slot.place).needsUpdate = true;
        (g.getAttribute('aLook') as InstancedBufferAttribute).copyArray(slot.look).needsUpdate = true;
        old.copyArray(slot.delay).needsUpdate = true;
      } else {
        // a different number of plants: the old buffers are let go before the new ones are made
        if (old) g.dispose();
        g.setAttribute('aPlace', new InstancedBufferAttribute(new Float32Array(slot.place), 4));
        g.setAttribute('aLook', new InstancedBufferAttribute(new Float32Array(slot.look), 4));
        g.setAttribute('aDelay', new InstancedBufferAttribute(new Float32Array(slot.delay), 1));
      }
      g.instanceCount = count;
    });
    gpuMemory.set('find beds', this.meshes.reduce((sum, mesh) => sum + geometryBytes(mesh.geometry), 0));
  }

  /** The bed a find is drawn in (the newest MAX_BEDS finds), if any. */
  slot(find: string): number | undefined {
    return this.index.get(find);
  }

  /** These beds' finds pulse once, from now. */
  pulse(finds: readonly string[]): void {
    const now = this.now;
    for (const id of finds) {
      const b = this.index.get(id);
      if (b !== undefined) this.beds[b].w = now;
    }
  }

  /** Plant beds now, one after another `gap` s apart (the order given): each blossoms from its middle out. Returns when the last is done (s). */
  plant(finds: readonly string[], gap = 0.32, after = 0): number {
    const now = this.now + after;
    finds.forEach((id, k) => {
      const b = this.index.get(id);
      if (b !== undefined) this.beds[b].x = now + k * gap;
    });
    return after + (finds.length - 1) * gap + 1.6;
  }

  /** Hide beds again (not planted yet), e.g. to replay a planting. */
  unplant(finds: readonly string[]): void {
    for (const id of finds) {
      const b = this.index.get(id);
      if (b !== undefined) this.beds[b].x = NOT_YET;
    }
  }

  /** Light up one bed (null: none). */
  highlight(find: string | null): void {
    const b = find === null ? -1 : (this.index.get(find) ?? -1);
    if (b === this.highlighted) return;
    if (this.highlighted >= 0) this.beds[this.highlighted].y = 0;
    this.highlighted = b;
    if (b >= 0) this.beds[b].y = 1;
  }

  /** Lift the bed under the pointer (null: none). */
  hover(find: string | null): void {
    this.hovered = find;
  }

  update(altitude: number): void {
    const now = this.now;
    const ease = Math.min(1, (now - this.clock.value) / LIFT_TIME);
    const lifted = this.hovered === null ? -1 : (this.index.get(this.hovered) ?? -1);
    this.beds.forEach((bed, b) => (bed.z += ((b === lifted ? 1 : 0) - bed.z) * ease));
    this.clock.value = now;
    const seen = altitude < SEEN_BELOW;
    for (const mesh of this.meshes) mesh.visible = seen && mesh.geometry.instanceCount > 0;
  }
}
