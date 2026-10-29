import { IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3, Vector4, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { slerpUnit, tangentToward, travel } from '../planet/geo';
import type { Layout } from '../planet/terrain';
import fragmentShader from './cloud.frag.glsl?raw';
import vertexShader from './cloud.vert.glsl?raw';

// Clouds: clusters of soft spheres, toon-shaded with a lumpy edge. Drifting
// clusters orbit the planet with the wind field and cast blob shadows; low
// banks hug the mountain flanks and roll slowly. Clouds are landscape, so
// they scale with R (altitude and size are fractions of R).

const MAX_PUFFS = 220;
const Y_AXIS = new Vector3(0, 1, 0);
const MAX_SHADOWS = 8;

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
  drifting: boolean;
  /** Along-direction (tangent) for banks; random heading for drifting clouds. */
  along: Vector3;
  size: number; // × R
  altitude: number; // × R above the base sphere (banks: absolute fraction)
  puffs: Puff[];
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

export class Clouds {
  readonly mesh: InstancedMesh;
  readonly shadows: Vector4[] = Array.from({ length: MAX_SHADOWS }, () => new Vector4());
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

  constructor(shared: Record<string, IUniform>) {
    const geometry = new IcosahedronGeometry(1, 3);
    this.seeds = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
    geometry.setAttribute('aSeed', this.seeds);
    const material = new ShaderMaterial({ name: 'clouds', vertexShader, fragmentShader, uniforms: { ...shared } });
    this.mesh = new InstancedMesh(geometry, material, MAX_PUFFS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  private build(layout: Layout, coverage: number, bank: number): void {
    const rand = rng(layout.seed ^ 0x5eed);
    const clusters: Cluster[] = [];
    // drifting clouds, scattered around the planet
    const drifting = Math.round(3 + 7 * coverage);
    for (let k = 0; k < drifting; k++) {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const dir = new Vector3(s * Math.cos(a), s * Math.sin(a), z);
      const along = tangentToward(dir, new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5), new Vector3());
      clusters.push({ dir, drifting: true, along, size: 0.07 + 0.06 * rand(), altitude: 0, puffs: makePuffs(rand, 5 + Math.floor(rand() * 6), 1.6 + rand()) });
    }
    // low banks along the range, on the meadow side, rolling against the flanks
    const banks = Math.round(2 + 6 * bank);
    const { a, b } = layout.range;
    for (let k = 0; k < banks; k++) {
      const onRange = slerpUnit(a, b, (k + 0.5) / banks + (rand() - 0.5) * 0.08, new Vector3());
      const out = tangentToward(onRange, layout.cottage, new Vector3());
      const dir = travel(onRange, out, 0.12 + 0.08 * rand(), new Vector3());
      const along = tangentToward(dir, b, new Vector3());
      clusters.push({ dir, drifting: false, along, size: 0.06 + 0.04 * rand(), altitude: 0.04 + 0.04 * rand(), puffs: makePuffs(rand, 8 + Math.floor(rand() * 5), 2.6) });
    }
    this.clusters = clusters;
  }

  update(layout: Layout, radius: number, time: number, p: { coverage: number; altitude: number; speed: number; mountainBank: number; mountainHeight: number }, windAxis: Vector3): void {
    const key = `${layout.seed}/${p.coverage.toFixed(2)}/${p.mountainBank.toFixed(2)}`;
    if (key !== this.key) {
      this.key = key;
      this.build(layout, p.coverage, p.mountainBank);
    }
    let n = 0;
    let shadow = 0;
    const omega = ((1 + 7 * p.speed) / radius) * 0.6;
    for (const c of this.clusters) {
      // drifting clusters ride the wind's rotation field
      const dir = this.up.copy(c.dir);
      if (c.drifting) dir.applyAxisAngle(windAxis, time * omega);
      const size = c.size * radius;
      const alt = c.drifting ? p.altitude * radius : (c.altitude + 0.35 * p.mountainHeight) * radius;
      const along = this.tmp.copy(c.along);
      if (c.drifting) along.applyAxisAngle(windAxis, time * omega);
      along.addScaledVector(dir, -along.dot(dir)).normalize();
      const across = this.tmp2.crossVectors(dir, along);
      for (const puff of c.puffs) {
        if (n >= MAX_PUFFS) break;
        // banks roll: puffs breathe and drift slowly along the flank
        const roll = c.drifting ? 0 : Math.sin(time * 0.15 + puff.phase) * 0.12;
        const breathe = 1 + 0.06 * Math.sin(time * 0.3 + puff.phase * 2);
        this.pos
          .copy(dir)
          .multiplyScalar(radius + alt + puff.y * size)
          .addScaledVector(along, (puff.x + roll) * size)
          .addScaledVector(across, puff.z * size);
        const r = puff.r * size * breathe;
        this.scale.set(r, r * (c.drifting ? 0.72 : 0.62), r);
        this.q.setFromUnitVectors(Y_AXIS, dir);
        this.m.compose(this.pos, this.q, this.scale);
        this.mesh.setMatrixAt(n, this.m);
        this.seeds.setX(n, puff.phase);
        n++;
      }
      if (c.drifting && shadow < MAX_SHADOWS) {
        this.shadows[shadow++].set(dir.x, dir.y, dir.z, c.size * 1.3); // angular radius
      }
    }
    for (let k = shadow; k < MAX_SHADOWS; k++) this.shadows[k].set(0, 1, 0, 0);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seeds.needsUpdate = true;
  }
}
