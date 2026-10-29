import { IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3, Vector4, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { normalQuantile } from '../planet/fields';
import { tangentToward } from '../planet/geo';
import fragmentShader from './cloud.frag.glsl?raw';
import vertexShader from './cloud.vert.glsl?raw';

// Clouds: clusters of soft spheres, toon-shaded with a lumpy edge, drifting
// round the planet with the wind field. Each casts its shadow down the sun
// (cloudShadow.glsl reads one record per cloud) and shows in the lakes. A
// high broken deck adds shadows that sweep across the meadow, painted in the
// sky from the meadow (sky.frag.glsl) and mirrored in the water; how much of
// the ground it shades follows the coverage. Clouds are landscape, so they
// scale with R (altitude and size are fractions of R).

const MAX_PUFFS = 240;
export const MAX_CLOUDS = 12;
const Y_AXIS = new Vector3(0, 1, 0);

interface Puff {
  /** Offset in the cluster frame, × cluster size: x along, y up, z across. */
  x: number;
  y: number;
  z: number;
  r: number;
  phase: number;
}

interface Cluster {
  dir: Vector3;
  /** Heading of the long axis (tangent at dir). */
  along: Vector3;
  size: number; // × R
  elongation: number;
  puffs: Puff[];
}

export interface CloudParams {
  coverage: number;
  altitude: number;
  speed: number;
  shadow: number;
}

/** Cloud uniforms shared by every material that shades the ground or water. */
export interface CloudUniforms {
  uCloudShadows: IUniform<Vector4[]>;
  uCloudAxes: IUniform<Vector4[]>;
  uCloudTops: IUniform<Vector4[]>;
  uCloudLook: IUniform<Vector4>;
  uCloudDeck: IUniform<Vector4>;
  uCloudDrift: IUniform<Vector4>;
}

function rng(seed: number): () => number {
  let s = hash32(seed >>> 0);
  return () => unit((s = hash32((s + 0x9e3779b9) >>> 0)));
}

function makePuffs(rand: () => number, count: number, elongation: number): Puff[] {
  const puffs: Puff[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const big = 1 - Math.abs(t) * 1.2;
    puffs.push({
      x: t * elongation + (rand() - 0.5) * 0.25,
      y: big * 0.28 + rand() * 0.12,
      z: (rand() - 0.5) * 0.45,
      r: 0.22 + 0.22 * big + rand() * 0.1,
      phase: rand() * Math.PI * 2,
    });
  }
  return puffs;
}

export function createCloudUniforms(): CloudUniforms {
  const v4s = (): Vector4[] => Array.from({ length: MAX_CLOUDS }, () => new Vector4(0, 1, 0, 0));
  return {
    uCloudShadows: { value: v4s() },
    uCloudAxes: { value: v4s() },
    uCloudTops: { value: v4s() },
    uCloudLook: { value: new Vector4(0.7, 0.22, 0, 0) },
    uCloudDeck: { value: new Vector4(8, 9, 0.05, 0) },
    uCloudDrift: { value: new Vector4(1, 0, 0, 0) },
  };
}

/** Height of the high cloud deck, × R. */
export const DECK_HEIGHT = 0.55;
/** The deck's shadow noise (a + b/2 of two gnoise octaves) has this spread. */
const DECK_STD = 0.27 * Math.hypot(1, 0.5);

export class Clouds {
  readonly mesh: InstancedMesh;
  private clusters: Cluster[] = [];
  private readonly seeds: InstancedBufferAttribute;
  private key = '';
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly up = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly centre = new Vector3();

  /** `uniforms` must already be in `shared` (materials copy it when they are made). */
  constructor(shared: Record<string, IUniform>, readonly uniforms: CloudUniforms) {
    const geometry = new IcosahedronGeometry(1, 3);
    this.seeds = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    geometry.setAttribute('aSeed', this.seeds);
    const material = new ShaderMaterial({ name: 'clouds', vertexShader, fragmentShader, uniforms: { ...shared } });
    this.mesh = new InstancedMesh(geometry, material, MAX_PUFFS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  private build(seed: number, coverage: number): void {
    const rand = rng(seed ^ 0x5eed);
    const clusters: Cluster[] = [];
    const count = Math.min(MAX_CLOUDS, Math.round(3 + 9 * coverage));
    for (let k = 0; k < count; k++) {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const dir = new Vector3(s * Math.cos(a), s * Math.sin(a), z);
      const along = tangentToward(dir, new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5), new Vector3());
      const elongation = 1.4 + 1.2 * rand();
      clusters.push({ dir, along, size: 0.09 + 0.07 * rand(), elongation, puffs: makePuffs(rand, 6 + Math.floor(rand() * 6), elongation) });
    }
    this.clusters = clusters;
  }

  /** puffScale: 1 shows the puffs at full size, 0 hides them (their shadows stay). */
  update(seed: number, radius: number, time: number, p: CloudParams, windAxis: Vector3, sunDir: Vector3, puffScale = 1): void {
    const key = `${seed}/${p.coverage.toFixed(2)}`;
    if (key !== this.key) {
      this.key = key;
      this.build(seed, p.coverage);
    }
    const u = this.uniforms;
    let n = 0;
    let k = 0;
    // drift: a few meters a second at the speed setting
    const omega = (1.5 + 10 * p.speed) / radius / 2;
    const angle = time * omega;
    for (const c of this.clusters) {
      const dir = this.up.copy(c.dir).applyAxisAngle(windAxis, angle);
      const size = c.size * radius;
      const alt = p.altitude * radius;
      const along = this.tmp.copy(c.along).applyAxisAngle(windAxis, angle);
      along.addScaledVector(dir, -along.dot(dir)).normalize();
      const across = this.tmp2.crossVectors(dir, along);
      for (const puff of c.puffs) {
        if (n >= MAX_PUFFS || puffScale <= 0.01) break;
        const breathe = 1 + 0.06 * Math.sin(time * 0.3 + puff.phase * 2);
        this.pos
          .copy(dir)
          .multiplyScalar(radius + alt + puff.y * size)
          .addScaledVector(along, puff.x * size)
          .addScaledVector(across, puff.z * size);
        const r = puff.r * size * breathe * puffScale;
        this.scale.set(r, r * 0.72, r);
        this.q.setFromUnitVectors(Y_AXIS, dir);
        this.m.compose(this.pos, this.q, this.scale);
        this.mesh.setMatrixAt(n, this.m);
        this.seeds.setX(n, puff.phase);
        n++;
      }
      // footprint: half width ≈ 0.65 size, half length ≈ (elongation / 2 + 0.45) size
      const halfWidth = (0.65 * size) / radius;
      const stretch = (c.elongation / 2 + 0.45) / 0.65;
      // shadow: down the sun from the cloud's middle to the ground
      this.centre.copy(dir).multiplyScalar(radius + alt + 0.15 * size);
      const b = this.centre.dot(sunDir);
      const disc = b * b - this.centre.lengthSq() + radius * radius;
      const shadow = u.uCloudShadows.value[k];
      if (disc > 0 && sunDir.dot(dir) > 0.05) {
        this.centre.addScaledVector(sunDir, -(b - Math.sqrt(disc))).normalize();
        shadow.set(this.centre.x, this.centre.y, this.centre.z, halfWidth);
      } else shadow.set(0, 1, 0, 0);
      u.uCloudAxes.value[k].set(along.x, along.y, along.z, stretch);
      u.uCloudTops.value[k].set(dir.x, dir.y, dir.z, alt - 0.1 * size);
      k++;
    }
    for (; k < MAX_CLOUDS; k++) u.uCloudShadows.value[k].set(0, 1, 0, 0);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seeds.needsUpdate = true;

    // the deck: patches about 40 m across at R 128, larger on larger planets
    const patch = 42 * Math.pow(radius / 128, 0.6);
    const share = 0.06 + 0.42 * p.coverage;
    const deckAngle = time * omega * 1.4;
    u.uCloudDeck.value.set(radius / patch, DECK_STD * normalQuantile(1 - share), 0.045, DECK_HEIGHT * radius);
    u.uCloudDrift.value.set(Math.cos(-deckAngle), Math.sin(-deckAngle), 0, 0);
    u.uCloudLook.value.set(p.shadow, 0.22, puffScale, 0);
  }
}
