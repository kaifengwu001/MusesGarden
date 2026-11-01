import { AdditiveBlending, DoubleSide, Group, Matrix4, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { Terrain } from '../planet/terrain';
import { chalkstepRig, dewPerchGeometry, dewwingRig, sifterRig, type FaunaKind, type FaunaRig } from './canyonFaunaGeometry';
import { FAUNA_ANCHORS, FaunaMotion } from './canyonFaunaMotion';
import vertexShader from './canyonFauna.vert.glsl?raw';
import fragmentShader from './canyonFauna.frag.glsl?raw';
import shadowVertex from './canyonFaunaShadow.vert.glsl?raw';
import shadowFragment from '../../../src/life/museShadow.frag.glsl?raw';

export interface FaunaSpecies { readonly id: FaunaKind; readonly name: string; readonly count: number; readonly description: string }
interface Animal { rig: FaunaRig; motion: FaunaMotion }

/** The native ecosystem alongside the Muse neighbours. Tiny on a planet, readable close up. */
export class CanyonFauna {
  readonly group = new Group();
  readonly shadowGroup = new Group();
  readonly shadowMeshes: Mesh[] = [];
  readonly species: readonly FaunaSpecies[] = [
    { id: 'chalkstep', name: 'Chalkstep', count: 3, description: 'Blue feathered walkers tap the chalk for fallen seeds.' },
    { id: 'fern-sifter', name: 'Fern Sifter', count: 3, description: 'Six little feet carry three mint leaf plates through the fern litter.' },
    { id: 'dewwing', name: 'Dewwing', count: 5, description: 'Ivory spindles flutter between the sails on two scarlet wings.' },
  ];
  private readonly animals: Animal[] = [];
  private readonly shadowPairs: Array<{ source: Mesh; shadow: Mesh; root: Group }> = [];
  private readonly perches: Array<{ mesh: Mesh; motion: FaunaMotion }> = [];
  private readonly material: ShaderMaterial;
  private readonly shadowMaterial: ShaderMaterial;
  private readonly across = new Vector3();
  private readonly frame = new Matrix4();
  private disposed = false;
  private dirty = true;
  private seed = Number.NaN;
  private radius = Number.NaN;

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    this.group.name = 'Native canyon fauna — Chalksteps, Fern Sifters and Dewwings';
    this.shadowGroup.name = 'Native fauna cloud-map shadows';
    this.material = new ShaderMaterial({ name: 'illustrated canyon fauna', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide });
    this.shadowMaterial = new ShaderMaterial({ name: 'canyon fauna shadows', vertexShader: shadowVertex, fragmentShader: shadowFragment, uniforms: { ...shared }, side: DoubleSide, blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    FAUNA_ANCHORS.forEach((anchor, index) => {
      const rig = anchor.kind === 'chalkstep' ? chalkstepRig(this.material) : anchor.kind === 'fern-sifter' ? sifterRig(this.material) : dewwingRig(this.material);
      rig.root.name = anchor.id;
      rig.root.scale.setScalar(anchor.scale);
      this.group.add(rig.root);
      this.animals.push({ rig, motion: new FaunaMotion(anchor, index) });
      for (const source of rig.meshes) {
        const shadow = new Mesh(source.geometry, this.shadowMaterial);
        shadow.name = `${source.name} shadow`;
        shadow.matrixAutoUpdate = false;
        shadow.frustumCulled = false;
        this.shadowGroup.add(shadow);
        this.shadowMeshes.push(shadow);
        this.shadowPairs.push({ source, shadow, root: rig.root });
      }
      if (anchor.perch) {
        const perch = new Mesh(dewPerchGeometry(anchor.lift ?? 2), this.material);
        perch.name = 'Dewwing nectar stem and landing blossom';
        perch.frustumCulled = false;
        this.group.add(perch);
        this.perches.push({ mesh: perch, motion: this.animals[this.animals.length - 1].motion });
      }
    });
    this.update(0, terrain);
  }

  invalidate(): void {
    this.dirty = true;
    this.animals.forEach(({ motion }) => motion.invalidate());
  }

  update(time: number, terrain: Terrain, camera?: Vector3): void {
    if (this.disposed) return;
    const replaced = this.dirty || terrain.radius !== this.radius || terrain.layout.seed !== this.seed;
    this.dirty = false;
    this.radius = terrain.radius;
    this.seed = terrain.layout.seed;
    for (const { rig, motion } of this.animals) {
      if (camera && !replaced && rig.root.position.distanceTo(camera) > 100) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;
      const p = motion.at(time, terrain);
      this.across.crossVectors(p.dir, p.heading).normalize();
      this.frame.makeBasis(this.across, p.dir, p.heading);
      rig.root.quaternion.setFromRotationMatrix(this.frame);
      rig.root.position.copy(p.dir).multiplyScalar(terrain.radius + p.height);
      const gait = p.gait;
      if (motion.anchor.kind === 'chalkstep') {
        rig.body.position.y = Math.abs(Math.sin(gait)) * 0.025 * p.walking;
        rig.body.rotation.set(0.25 * p.forage, 0, Math.sin(gait) * 0.07 * p.walking);
        rig.feet.forEach((foot, i) => {
          const beat = Math.sin(gait + i * Math.PI);
          foot.position.y = Math.max(0, beat) * 0.07 * p.walking + (i ? Math.max(0, Math.sin(time * 8)) * 0.035 * p.forage : 0);
          foot.position.z = beat * 0.065 * p.walking;
          foot.rotation.x = beat * 0.13 * p.walking;
        });
      } else if (motion.anchor.kind === 'fern-sifter') {
        rig.body.position.z = p.forage * 0.045;
        rig.body.rotation.x = p.forage * 0.06;
        rig.feet.forEach((foot, i) => {
          const phase = gait + (i % 2 ? Math.PI : 0);
          foot.position.y = Math.max(0, Math.sin(phase)) * 0.024 * p.walking;
          foot.rotation.y = Math.sin(phase) * 0.18 * p.walking;
        });
      } else {
        rig.body.rotation.x = -0.12 + 0.16 * Math.sin(time * 1.2 + motion.index) * (1 - p.perched);
        rig.wings.forEach((wing, i) => {
          const side = i === 0 ? -1 : 1;
          wing.rotation.z = -side * (1.0 + 0.49 * p.flap - 0.58 * p.perched);
          wing.rotation.y = side * (0.13 + 0.14 * p.perched);
        });
      }
    }
    for (const { mesh, motion } of this.perches) {
      const dir = motion.perchDirection(terrain);
      this.across.crossVectors(dir, terrain.layout.homeBearing).normalize();
      const forward = new Vector3().crossVectors(this.across, dir).normalize();
      this.frame.makeBasis(this.across, dir, forward);
      mesh.quaternion.setFromRotationMatrix(this.frame);
      mesh.position.copy(dir).multiplyScalar(terrain.radius + terrain.height(dir));
    }
    this.group.updateMatrixWorld(true);
    // Cloud-shadow casters live in another scene; copy their fully animated
    // world transforms, including the limb/wings and planet tangent frame.
    for (const { source, shadow, root } of this.shadowPairs) {
      shadow.matrix.copy(source.matrixWorld);
      shadow.matrixWorldNeedsUpdate = true;
      shadow.visible = this.group.visible && root.visible && source.visible;
    }
  }

  focus(kind: string): { dir: Vector3; height: number; heading: Vector3; distance: number } | null {
    const animal = this.animals.find(({ motion }) => motion.anchor.kind === kind);
    if (!animal) return null;
    const p = animal.motion.pose;
    return { dir: p.dir.clone(), height: p.height + (kind === 'chalkstep' ? 0.43 : kind === 'fern-sifter' ? 0.2 : 0.15), heading: p.heading.clone(), distance: kind === 'chalkstep' ? 4.2 : kind === 'fern-sifter' ? 3.4 : 3.7 };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const { rig } of this.animals) for (const object of rig.meshes) object.geometry.dispose();
    this.perches.forEach(({ mesh }) => mesh.geometry.dispose());
    this.material.dispose();
    this.shadowMaterial.dispose();
    this.shadowMeshes.forEach((shadow) => shadow.removeFromParent());
    this.group.clear();
    this.shadowGroup.clear();
  }
}
