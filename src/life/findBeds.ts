import { DoubleSide, InstancedBufferAttribute, Mesh, ShaderMaterial, Vector3, Vector4, type InstancedBufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { BED_RADIUS, type Bed } from '../garden/placement';
import { travel, tangentToward } from '../planet/geo';
import vertexShader from './findBed.vert.glsl?raw';
import { SPECIES_MESH } from './flowerMeshes';
import { HEADS } from './flowers';
import fragmentShader from './grass.frag.glsl?raw';

// The finds' flower beds: each find Muse kept grows as a small bed of the
// meadow's own flowers, its species the find's topic (Interest.species,
// coloured by its variant), with a few companions of the meadow's other
// species so it reads as a clump of the meadow rather than a planted
// square. One instanced draw per species (findBed.vert.glsl), a few
// thousand plants at most. A bed can be planted while you watch (it
// blossoms from its middle out, then its card pops up: ui/garden), and the
// bed you are looking at is lit a little brighter.

/** Plants per bed, the share of them that are companions, and their size against the meadow's flowers. */
const PLANTS = 58;
/** The smaller species grow bigger in a bed, so every bed reads at the same distance: pink cup, star, button, cluster. */
const SPECIES_SIZE = [1.0, 1.12, 1.45, 1.4] as const;
const COMPANIONS = 0.16;
const SIZE = [1.25, 1.65] as const;
/** Beds a draw can address (MAX_BEDS in the shader). */
export const MAX_BEDS = 64;
/** A bed planted long ago: fully grown. A bed not planted yet: hidden. */
const LONG_AGO = -1e6;
const NOT_YET = 1e9;
/** Higher than this (m) the beds are under a pixel and are not drawn. */
const SEEN_BELOW = 180;

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
  /** Per bed: planted at (s on the plant clock), highlight; shared by the four draws. */
  private readonly beds = Array.from({ length: MAX_BEDS }, () => new Vector4(LONG_AGO, 0, 0, 0));
  private readonly clock = { value: 0 };
  private readonly index = new Map<string, number>();
  private highlighted = -1;
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
          uBeds: { value: this.beds },
          uPlantClock: this.clock,
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
      if (hidden.has(bed.find)) this.beds[b].x = NOT_YET;
      else if (this.beds[b].x === NOT_YET) this.beds[b].x = LONG_AGO;
      const r = rand(idSeed(bed.find));
      const north = tangentToward(bed.dir, new Vector3(0, 1, 0), new Vector3());
      const east = new Vector3().crossVectors(bed.dir, north);
      for (let k = 0; k < PLANTS; k++) {
        // denser in the middle; companions toward the rim
        const companion = r() < COMPANIONS;
        const reach = BED_RADIUS * Math.pow(r(), companion ? 0.45 : 0.7);
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
      g.setAttribute('aPlace', new InstancedBufferAttribute(new Float32Array(slot.place), 4));
      g.setAttribute('aLook', new InstancedBufferAttribute(new Float32Array(slot.look), 4));
      g.setAttribute('aDelay', new InstancedBufferAttribute(new Float32Array(slot.delay), 1));
      g.instanceCount = slot.delay.length;
    });
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

  update(altitude: number): void {
    this.clock.value = this.now;
    const seen = altitude < SEEN_BELOW;
    for (const mesh of this.meshes) mesh.visible = seen && mesh.geometry.instanceCount > 0;
  }
}
