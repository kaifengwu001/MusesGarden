import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { geometryBytes, gpuMemory } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { poolglassGeometry, reedWaderGeometry } from './lanternWildlifeGeometry';
import vertexShader from './lanternWildlife.vert.glsl?raw';
import fragmentShader from './lanternWildlife.frag.glsl?raw';

export type LanternSpecies = 'poolglass' | 'reed-wader';
interface Animal {
  readonly id: string;
  readonly species: LanternSpecies;
  readonly x: number;
  /** Poolglass z is relative to the current pond centre; wader z is local metres. */
  readonly z: number;
  readonly scale: number;
  readonly phase: number;
  readonly turn: number;
}
/** A foreground adult and two smaller neighbours of each species. */
const ANIMALS: readonly Animal[] = [
  { id: 'poolglass-adult', species: 'poolglass', x: -34, z: 13, scale: 0.55, phase: -1.55, turn: 0 },
  { id: 'poolglass-young', species: 'poolglass', x: -26, z: 5, scale: 0.28, phase: 0.8, turn: 0 },
  { id: 'poolglass-small', species: 'poolglass', x: -20, z: -3, scale: 0.23, phase: 3.4, turn: 0 },
  { id: 'reed-wader-adult', species: 'reed-wader', x: -26, z: 36, scale: 0.72, phase: 0, turn: -0.9 },
  { id: 'reed-wader-bank', species: 'reed-wader', x: -15, z: 33, scale: 0.5, phase: 11, turn: -0.7 },
  { id: 'reed-wader-small', species: 'reed-wader', x: -12, z: 25, scale: 0.43, phase: 31, turn: 1.3 },
];
export interface WildlifePose {
  readonly id: string;
  readonly species: LanternSpecies;
  readonly dir: Vector3;
  readonly forward: Vector3;
  x: number;
  z: number;
  height: number;
  scale: number;
  phase: number;
  moving: number;
  visible: boolean;
}
interface Home { x: number; z: number; pondCentre: number; walk: number }
export interface WildlifeBanks {
  shelfHeightAt(x: number, z: number): number | null;
  waterClearAt?(x: number, z: number, radius: number): boolean;
}
interface Batch {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly species: LanternSpecies;
  readonly anchors: InstancedBufferAttribute;
  readonly across: InstancedBufferAttribute;
  readonly animals: InstancedBufferAttribute;
}

/** Six independent ecological inhabitants, rendered in two instanced draws. */
export class LanternWildlife {
  readonly group = new Group();
  readonly ready = true;
  /** Read-only-by-convention poses also let tests verify physical habitat placement. */
  readonly poses: WildlifePose[] = ANIMALS.map(a => ({ id: a.id, species: a.species, dir: new Vector3(), forward: new Vector3(), x: 0, z: 0, height: 0, scale: a.scale, phase: 0, moving: 0, visible: false }));
  private readonly material: ShaderMaterial;
  private readonly batches: Batch[] = [];
  private readonly time = { value: 0 };
  private readonly homes: Home[] = [];
  private readonly right = new Vector3();
  private readonly dir = new Vector3();
  private readonly ahead = new Vector3();
  private readonly across = new Vector3();
  private readonly ground = createGroundSample();
  private seed = Number.NaN;
  private radius = Number.NaN;
  private pendingHomes = false;
  private dirty = true;
  private disposed = false;

  constructor(shared: Record<string, IUniform>, terrain: Terrain, private readonly banks?: WildlifeBanks) {
    this.material = new ShaderMaterial({
      name: 'Poolglass and Reed Waders — mineral plates and leaf feathers',
      vertexShader, fragmentShader, uniforms: { ...shared, uWildlifeTime: this.time }, side: DoubleSide,
    });
    this.group.name = 'Poolglass swimmers and Reed Waders';
    this.batch(poolglassGeometry(), 'poolglass', 'Three Poolglass, mint fins over lavender plates');
    this.batch(reedWaderGeometry(), 'reed-wader', 'Three Reed Waders, sage leaf mantles and webbed feet');
    gpuMemory.set('lantern wildlife', this.batches.reduce((bytes, batch) => bytes + geometryBytes(batch.mesh.geometry), 0));
    this.update(0, terrain);
  }

  invalidate(): void { this.dirty = true; }

  private batch(base: BufferGeometry, species: LanternSpecies, name: string): void {
    const geometry = new InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) geometry.setAttribute(name, base.getAttribute(name));
    const anchors = new InstancedBufferAttribute(new Float32Array(3 * 4), 4);
    const across = new InstancedBufferAttribute(new Float32Array(3 * 3), 3);
    const animals = new InstancedBufferAttribute(new Float32Array(3 * 4), 4);
    geometry.setAttribute('aAnchor', anchors); geometry.setAttribute('aAcross', across); geometry.setAttribute('aAnimal', animals);
    geometry.instanceCount = 0;
    const mesh = new Mesh(geometry, this.material);
    mesh.name = name; mesh.frustumCulled = false;
    this.group.add(mesh); this.batches.push({ mesh, species, anchors, across, animals });
  }

  private direction(terrain: Terrain, x: number, z: number, out: Vector3): Vector3 {
    const distance = Math.hypot(x, z), sin = Math.min(distance / terrain.radius, 0.95);
    return out.copy(terrain.layout.cottage).multiplyScalar(Math.sqrt(1 - sin * sin))
      .addScaledVector(this.right, distance ? x / distance * sin : 0)
      .addScaledVector(terrain.layout.homeBearing, distance ? z / distance * sin : 0).normalize();
  }

  private safe(terrain: Terrain, x: number, z: number, species: LanternSpecies, scale: number): boolean {
    // The full body, leaf fins and tail need open water, including the real
    // scenery shelves and rooted reed footings above the sampled pool floor.
    if (species === 'poolglass' && this.banks?.waterClearAt?.(x, z, 2 * scale + 0.1) === false) return false;
    const shelf = species === 'reed-wader' ? this.banks?.shelfHeightAt(x, z) : null;
    if (shelf !== null && shelf !== undefined) {
      // Check the full webbed-foot footprint against the actual stone support.
      for (let k = 0; k < 8; k++) {
        const angle = k * Math.PI / 4, radius = scale * 1.05;
        const foot = this.banks?.shelfHeightAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
        if (foot === null || foot === undefined || Math.abs(foot - shelf) > 0.12) return false;
      }
      return true;
    }
    this.direction(terrain, x, z, this.dir);
    const g = terrain.sample(this.dir, this.ground);
    if (species === 'poolglass') return g.depth > 0.28 && g.water < -1.2;
    if (g.water < 0.85 || g.height > 3.5) return false;
    const h = g.height;
    for (const side of [-0.45, 0.45]) {
      this.direction(terrain, x + side, z, this.dir);
      if (Math.abs(terrain.height(this.dir) - h) > 0.24) return false;
    }
    return true;
  }

  private preference(terrain: Terrain, animal: Animal, index: number): { x: number; z: number } {
    if (animal.species === 'poolglass') return { x: animal.x, z: terrain.pondCentre + animal.z };
    // On the smallest globe, the distant bank lies beyond the local hemisphere.
    // Its waders use the inhabited island's nearer banks instead.
    const near = [[-11, 19], [-12, 25], [-8, 23]][index - 3];
    const t = smoothstep(40, 80, terrain.radius);
    return { x: near[0] + (animal.x - near[0]) * t, z: near[1] + (animal.z - near[1]) * t };
  }

  /** Bounded habitat search, used on creation/editing or if growth moves a bank. */
  private habitat(terrain: Terrain, x: number, z: number, animal: Animal, index: number): Home | null {
    const phase = unit(hash32(terrain.layout.seed + index * 7919)) * Math.PI * 2;
    for (let ring = 0; ring <= 10; ring++) for (let k = 0; k < (ring ? 12 : 1); k++) {
      const angle = phase + k / 12 * Math.PI * 2;
      const px = x + Math.cos(angle) * ring * 0.85, pz = z + Math.sin(angle) * ring * 0.85;
      if (!this.safe(terrain, px, pz, animal.species, animal.scale)) continue;
      // Leave room for the entire gentle swim/walk, not just its centre.
      const onShelf = animal.species === 'reed-wader' && this.banks?.shelfHeightAt(px, pz) != null;
      const radii = animal.species === 'poolglass'
        ? this.banks?.waterClearAt ? [1.4, 0.8, 0.4, 0.18, 0] : [1.4]
        : onShelf ? [0.24, 0.12, 0] : [0.75];
      for (const radius of radii) {
        let room = true;
        for (let j = 0; j < (radius ? 6 : 1) && room; j++) room = this.safe(terrain, px + Math.cos(j * Math.PI / 3) * radius, pz + Math.sin(j * Math.PI / 3) * radius, animal.species, animal.scale);
        // A small shelf can host a resting wader without forcing it to walk off.
        if (room) return { x: px, z: pz, pondCentre: terrain.pondCentre, walk: animal.species === 'poolglass' || onShelf ? radius * 0.9 : 0.6 };
      }
    }
    return null;
  }

  private home(terrain: Terrain, animal: Animal, index: number): Home | null {
    const target = this.preference(terrain, animal, index);
    const preferred = this.habitat(terrain, target.x, target.z, animal, index);
    if (preferred) return preferred;
    // A seed can flood a natural bank. The authored basin and protected island
    // supply a reliable alternate home, instead of hiding an inhabitant.
    const fallback = animal.species === 'poolglass'
      ? [-25 + (index - 1) * 3, terrain.pondCentre]
      : [[-11, 19], [-10, 23], [-9, 21]][index - 3];
    return this.habitat(terrain, fallback[0], fallback[1], animal, index);
  }

  update(time: number, terrain: Terrain): void {
    if (this.disposed) return;
    this.time.value = time;
    this.right.crossVectors(terrain.layout.cottage, terrain.layout.homeBearing).normalize();
    const growing = terrain.radius !== this.radius;
    // Keep habitat work bounded during growth. The first still frame resolves
    // every home from its authored preference again, making settled placement
    // a pure function of seed and terrain after any radius round trip.
    const resolveHomes = this.dirty || this.seed !== terrain.layout.seed || (!growing && this.pendingHomes);
    this.pendingHomes = growing && Number.isFinite(this.radius);
    this.radius = terrain.radius;
    if (resolveHomes) {
      this.seed = terrain.layout.seed; this.dirty = false; this.homes.length = 0;
      ANIMALS.forEach((animal, i) => {
        const target = this.preference(terrain, animal, i);
        this.homes[i] = this.home(terrain, animal, i) ?? { ...target, pondCentre: terrain.pondCentre, walk: 0.6 };
      });
    }
    ANIMALS.forEach((animal, i) => {
      const pose = this.poses[i], home = this.homes[i];
      const phase = animal.phase + unit(hash32(this.seed + i * 13)) * 0.14;
      let x = home.x, z = home.z, dx: number, dz: number, moving = 1;
      if (animal.species === 'poolglass') {
        const angle = time * 0.055 + phase;
        z += terrain.pondCentre - home.pondCentre;
        // Tight channels allow a slow stationary paddle, with the same complete
        // footprint clearance as open-water swimming. No body crosses a shelf.
        x -= Math.sin(angle) * home.walk; z += Math.cos(angle) * home.walk * 0.615;
        dx = -Math.cos(angle) * 1.3; dz = -Math.sin(angle) * 0.8;
      } else {
        const cycle = ((time + animal.phase) % 64 + 64) % 64;
        const returning = cycle >= 32;
        const t = returning ? cycle - 32 : cycle;
        const progress = smoothstep(0, 24, Math.min(t, 24));
        const travel = (returning ? 1 - progress : progress) * 2 - 1;
        x += Math.sin(animal.turn) * travel * home.walk; z += Math.cos(animal.turn) * travel * home.walk;
        moving = t < 24 && home.walk > 0.04 ? Math.sin(Math.PI * t / 24) : 0;
        dx = Math.sin(animal.turn) * (returning ? -1 : 1); dz = Math.cos(animal.turn) * (returning ? -1 : 1);
      }
      if (!this.safe(terrain, x, z, animal.species, animal.scale)) {
        const replacement = this.home(terrain, animal, i);
        if (replacement) { this.homes[i] = replacement; x = replacement.x; z = replacement.z; }
        else { pose.visible = false; pose.dir.set(0, 0, 0); pose.forward.set(0, 0, 0); pose.height = pose.phase = pose.moving = 0; return; }
      }
      this.direction(terrain, x, z, pose.dir);
      const sample = terrain.sample(pose.dir, this.ground);
      this.direction(terrain, x + dx * 0.1, z + dz * 0.1, this.ahead);
      pose.forward.copy(this.ahead).addScaledVector(pose.dir, -this.ahead.dot(pose.dir)).normalize();
      pose.x = x; pose.z = z; pose.phase = phase; pose.moving = moving; pose.visible = true;
      pose.height = animal.species === 'poolglass' ? -0.15 * pose.scale + 0.008 * Math.sin(time * 1.1 + phase) : (this.banks?.shelfHeightAt(x, z) ?? sample.height) + 0.015;
    });
    for (const batch of this.batches) {
      let count = 0;
      for (const pose of this.poses) {
        if (pose.species !== batch.species || !pose.visible) continue;
        this.across.crossVectors(pose.dir, pose.forward).normalize();
        batch.anchors.setXYZW(count, pose.dir.x, pose.dir.y, pose.dir.z, pose.height);
        batch.across.setXYZ(count, this.across.x, this.across.y, this.across.z);
        batch.animals.setXYZW(count, pose.scale, pose.phase, pose.moving, pose.species === 'poolglass' ? 0 : 1);
        count++;
      }
      batch.mesh.geometry.instanceCount = count;
      batch.anchors.needsUpdate = batch.across.needsUpdate = batch.animals.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const batch of this.batches) batch.mesh.geometry.dispose();
    this.material.dispose(); this.group.clear();
    gpuMemory.delete('lantern wildlife');
  }
}
