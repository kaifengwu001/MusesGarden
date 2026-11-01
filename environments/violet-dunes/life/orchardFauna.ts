import { AdditiveBlending, DoubleSide, Group, Matrix4, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { Terrain } from '../planet/terrain';
import { duneSkipperRig, gliderPerchGeometry, seedGliderRig, type OrchardFaunaKind, type OrchardRig } from './orchardFaunaGeometry';
import { ORCHARD_FAUNA_ANCHORS, OrchardFaunaMotion } from './orchardFaunaMotion';
import vertexShader from './orchardFauna.vert.glsl?raw';
import fragmentShader from './orchardFauna.frag.glsl?raw';
import shadowVertex from './orchardFaunaShadow.vert.glsl?raw';
import shadowFragment from './museShadow.frag.glsl?raw';

export interface OrchardSpecies { readonly id: OrchardFaunaKind; readonly name: string; readonly count: number; readonly description: string }
interface Animal { rig: OrchardRig; motion: OrchardFaunaMotion; maxFootPenetration: number }
export interface OrchardFaunaSnapshot {
  readonly id: string;
  readonly kind: OrchardFaunaKind;
  readonly dir: readonly number[];
  readonly height: number;
  readonly groundHeight: number;
  /** Radial root clearance above the terrain, in metres; zero for ground walkers. */
  readonly clearance: number;
  readonly maxFootPenetration: number;
  readonly walking: number;
  readonly perched: number;
  readonly feet: number;
  readonly wings: number;
  readonly finite: boolean;
  readonly visible: boolean;
}

/** Local native animals; their shapes and routines are independent of Muse. */
export class OrchardFauna {
  readonly group = new Group();
  readonly shadowMeshes: Mesh[] = [];
  readonly species: readonly OrchardSpecies[] = [
    { id: 'dune-skipper', name: 'Dune Skipper', count: 3, description: 'Four padded feet carry small seed foragers between the paper orchard and slate shade.' },
    { id: 'seed-glider', name: 'Seed Glider', count: 4, description: 'Two golden leaf wings flutter between flowering stems and real landing perches.' },
  ];
  private readonly animals: Animal[] = [];
  private readonly shadowPairs: Array<{ source: Mesh; shadow: Mesh; root: Group | Mesh }> = [];
  private readonly perches: Array<{ mesh: Mesh; motion: OrchardFaunaMotion }> = [];
  private readonly material: ShaderMaterial;
  private readonly shadowMaterial: ShaderMaterial;
  private readonly across = new Vector3();
  private readonly forward = new Vector3();
  private readonly footDir = new Vector3();
  private readonly frame = new Matrix4();
  private disposed = false;

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    this.group.name = 'Paper Orchard native fauna';
    this.material = new ShaderMaterial({ name: 'pencil orchard fauna', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide });
    this.shadowMaterial = new ShaderMaterial({ name: 'orchard fauna cloud-map shadows', vertexShader: shadowVertex, fragmentShader: shadowFragment, uniforms: { ...shared }, side: DoubleSide, blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    ORCHARD_FAUNA_ANCHORS.forEach((anchor, index) => {
      const rig = anchor.kind === 'dune-skipper' ? duneSkipperRig(this.material) : seedGliderRig(this.material);
      rig.root.name = anchor.id;
      rig.root.scale.setScalar(anchor.scale);
      this.group.add(rig.root);
      const motion = new OrchardFaunaMotion(anchor, index);
      this.animals.push({ rig, motion, maxFootPenetration: 0 });
      for (const source of rig.meshes) this.addShadow(source, rig.root);
      if (anchor.perch) {
        const mesh = new Mesh(gliderPerchGeometry(anchor.lift ?? 2), this.material);
        mesh.name = `${anchor.id} physical landing stem`;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.perches.push({ mesh, motion });
        this.addShadow(mesh, mesh);
      }
    });
    this.update(0, terrain);
  }

  private addShadow(source: Mesh, root: Group | Mesh): void {
    const shadow = new Mesh(source.geometry, this.shadowMaterial);
    shadow.name = `${source.name} shadow`;
    shadow.matrixAutoUpdate = false;
    shadow.frustumCulled = false;
    this.shadowMeshes.push(shadow);
    this.shadowPairs.push({ source, shadow, root });
  }

  invalidate(): void { this.animals.forEach(({ motion }) => motion.invalidate()); }

  /** Run before the cloud-shadow pass; both passes use these exact animated matrices. */
  update(time: number, terrain: Terrain, camera?: Vector3): void {
    if (this.disposed) return;
    for (const animal of this.animals) {
      const { rig, motion } = animal, p = motion.at(time, terrain);
      this.across.crossVectors(p.dir, p.heading).normalize();
      this.frame.makeBasis(this.across, p.dir, p.heading);
      rig.root.quaternion.setFromRotationMatrix(this.frame);
      rig.root.position.copy(p.dir).multiplyScalar(terrain.radius + p.height);
      rig.root.visible = !camera || rig.root.position.distanceTo(camera) < 110;
      animal.maxFootPenetration = 0;
      if (motion.anchor.kind === 'dune-skipper') {
        rig.body.position.y = Math.abs(Math.sin(p.gait)) * 0.016 * p.walking;
        rig.body.rotation.set(0.11 * p.forage, 0, Math.sin(p.gait) * 0.025 * p.walking);
        rig.feet.forEach((foot, i) => {
          const [x, z] = rig.footOffsets[i], scale = motion.anchor.scale;
          const beat = Math.sin(p.gait + (i === 0 || i === 3 ? 0 : Math.PI));
          const stride = beat * 0.035 * p.walking;
          this.footDir.copy(p.dir).addScaledVector(this.across, x * scale / terrain.radius).addScaledVector(p.heading, (z + stride) * scale / terrain.radius).normalize();
          const support = terrain.height(this.footDir) - p.height;
          const lift = Math.max(0, beat) * 0.052 * p.walking;
          foot.position.set(x, support / scale + lift, z + stride);
          foot.rotation.x = beat * 0.08 * p.walking;
          // The sole's nominal low point is zero; conservatively account for the small toe rotation.
          animal.maxFootPenetration = Math.max(animal.maxFootPenetration, Math.max(0, Math.abs(foot.rotation.x) * 0.11 * scale - lift * scale));
        });
      } else {
        rig.body.rotation.x = -0.04 + 0.08 * Math.sin(time * 1.1 + motion.index) * (1 - p.perched);
        rig.wings.forEach((wing, i) => {
          const side = i === 0 ? -1 : 1;
          wing.rotation.z = side * (0.18 + 0.78 * p.flap - 0.06 * p.perched);
          wing.rotation.y = side * (0.08 + 0.12 * p.perched);
        });
      }
    }
    for (const { mesh, motion } of this.perches) {
      const dir = motion.perchDirection(terrain);
      this.across.crossVectors(dir, terrain.layout.homeBearing).normalize();
      this.forward.crossVectors(this.across, dir).normalize();
      this.frame.makeBasis(this.across, dir, this.forward);
      mesh.quaternion.setFromRotationMatrix(this.frame);
      mesh.position.copy(dir).multiplyScalar(terrain.radius + terrain.height(dir));
      mesh.visible = !camera || mesh.position.distanceTo(camera) < 110;
    }
    this.group.updateMatrixWorld(true);
    for (const { source, shadow, root } of this.shadowPairs) {
      shadow.matrix.copy(source.matrixWorld);
      shadow.matrixWorldNeedsUpdate = true;
      shadow.visible = this.group.visible && root.visible && source.visible;
    }
  }

  focus(kind: string): { dir: Vector3; height: number; heading: Vector3; distance: number } | null {
    const animal = this.animals.find(({ motion }) => motion.anchor.kind === kind);
    if (!animal) return null;
    const p = animal.motion.pose, skipper = kind === 'dune-skipper';
    return { dir: p.dir.clone(), height: p.height + (skipper ? 0.33 : 0.06), heading: p.heading.clone(), distance: skipper ? 3.2 : 2.6 };
  }

  snapshot(): OrchardFaunaSnapshot[] {
    return this.animals.map(({ rig, motion, maxFootPenetration }) => {
      const p = motion.pose;
      const values = [...p.dir.toArray(), ...p.heading.toArray(), p.height, ...rig.root.matrixWorld.elements];
      return { id: motion.anchor.id, kind: motion.anchor.kind, dir: p.dir.toArray(), height: p.height, groundHeight: p.groundHeight, clearance: p.height - p.groundHeight, maxFootPenetration, walking: p.walking, perched: p.perched, feet: rig.anatomy.feet, wings: rig.anatomy.wings, finite: values.every(Number.isFinite), visible: rig.root.visible };
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const { rig } of this.animals) rig.meshes.forEach((mesh) => mesh.geometry.dispose());
    this.perches.forEach(({ mesh }) => mesh.geometry.dispose());
    this.shadowMeshes.forEach((mesh) => mesh.removeFromParent());
    this.material.dispose();
    this.shadowMaterial.dispose();
    this.group.clear();
  }
}
