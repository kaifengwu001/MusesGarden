import { BufferAttribute, DynamicDrawUsage, Float32BufferAttribute, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, unit } from '../core/hash';
import fragmentShader from './treeNear.frag.glsl?raw';
import vertexShader from './treeNear.vert.glsl?raw';

// The trees near the camera (Kai, 2026-11-03: the procedural trees good from orbit but not holding up close; levels
// of detail, more detailed up close): each one's crown as the far tree traces it (tree.frag.glsl: the same five
// lumps, where its seed puts them), but heaped of leafy clumps, a dark core in each lump, a trunk with a branch up
// into each side lump; lit in the same soft bands with the same painted edge, so it is the far tree come near. Within
// `near` m of the camera, fading into the far one over its last few meters (each drawn on the other's dithered
// pixels: tree.vert.glsl, tree.frag.glsl). One template, every near tree an instance of it (treeNear.vert.glsl
// places its clumps from its seed).

/** The most near trees drawn, the clumps on each lump (its top one, the three round it, the low one), and how far (m) the near tree fades into the far one. */
export const NEAR_TREES = { max: 600, clumps: [16, 13, 13, 13, 10], fade: 4 } as const;

/** One template tree: per vertex its place on its clump (unit) and normal, its kind and lump (aPuff), its clump's way out on its lump (aDir). */
function template(): InstancedBufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const puffs: number[] = [];
  const dirs: number[] = [];
  const index: number[] = [];
  const sphere = mergeVertices(new IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const sp = sphere.getAttribute('position');
  const si = sphere.index!.array;
  const v = new Vector3();
  // a clump (kind 0) or a lump's core (kind 1): a lumpy sphere, its own lumps
  const clump = (kind: number, k: number, radius: number, tint: number, way: Vector3, seed: number): void => {
    const base = positions.length / 3;
    for (let i = 0; i < sp.count; i++) {
      v.fromBufferAttribute(sp, i);
      const bump = 0.86 + 0.26 * unit(hash32((Math.round(v.x * 997) * 73856093) ^ (Math.round(v.y * 997) * 19349663) ^ (Math.round(v.z * 997) * 83492791) ^ seed) >>> 0);
      positions.push(v.x * bump, v.y * bump, v.z * bump);
      normals.push(v.x, v.y, v.z);
      puffs.push(kind, k, radius, tint);
      dirs.push(way.x, way.y, way.z);
    }
    for (let i = 0; i < si.length; i++) index.push(base + si[i]);
  };
  let h = 0x7ee5;
  const rnd = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
  const golden = Math.PI * (3 - Math.sqrt(5));
  NEAR_TREES.clumps.forEach((n, k) => {
    for (let i = 0; i < n; i++) {
      // (over its lump, most of them on its upper and outer side, a little off the even spread)
      const y = 1 - (1.55 * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(1 - y * y, 0));
      const a = i * golden + rnd() * 0.6;
      const way = new Vector3(r * Math.cos(a), y, r * Math.sin(a)).normalize();
      clump(0, k, 0.32 + 0.12 * rnd(), 0.9 + 0.18 * rnd(), way, (k * 101 + i) * 7919);
    }
    clump(1, k, 0.64, 1, new Vector3(0, 1, 0), k * 31337);
  });
  // the trunk (kind 2), and a branch (kind 3) up into each side lump: tapered eight-sided tubes, y along them, wound
  // to face out as the clumps are
  const tube = (kind: number, k: number): void => {
    const base = positions.length / 3;
    const sides = 8;
    const rings = kind === 2 ? 5 : 3;
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * 2 * Math.PI;
        positions.push(Math.cos(a), j / rings, Math.sin(a));
        normals.push(Math.cos(a), 0, Math.sin(a));
        puffs.push(kind, k, 1, 1);
        dirs.push(0, 1, 0);
      }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < sides; i++) {
        const a = base + j * sides + i;
        const b = base + j * sides + ((i + 1) % sides);
        index.push(a, b + sides, b, a, a + sides, b + sides);
      }
  };
  tube(2, 0);
  for (const k of [1, 2, 3]) tube(3, k);
  sphere.dispose();
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('aPuff', new Float32BufferAttribute(puffs, 4));
  g.setAttribute('aDir', new Float32BufferAttribute(dirs, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  return g;
}

export class NearTrees {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly tree = new InstancedBufferAttribute(new Float32Array(NEAR_TREES.max * 4), 4).setUsage(DynamicDrawUsage);
  private readonly seed = new InstancedBufferAttribute(new Float32Array(NEAR_TREES.max), 1).setUsage(DynamicDrawUsage);
  private placed: Float32Array | null = null;
  private readonly at = new Vector3(Number.NaN, 0, 0);
  private reach = -1;

  constructor(shared: Record<string, IUniform>) {
    const g = template();
    g.setAttribute('aTree', this.tree);
    g.setAttribute('aSeed', this.seed);
    g.instanceCount = 0;
    this.mesh = new Mesh(g, new ShaderMaterial({ name: 'trees near', vertexShader, fragmentShader, uniforms: { ...shared } }));
    this.mesh.frustumCulled = false;
  }

  /** Triangles a near tree has. */
  get triangles(): number {
    return (this.mesh.geometry.index?.count ?? 0) / 3;
  }

  /** The trees (per tree: direction, ground, seed) within `near` m of the eye (planet space, planet radius R), nearest first; again only once the eye has moved on. */
  update(placed: Float32Array | null, eye: Vector3, near: number, R: number): void {
    if (!placed || near <= 0) {
      this.mesh.geometry.instanceCount = 0;
      this.mesh.visible = false;
      // (found again when the reach is back, even with the eye where it was: the far trees leave the reach to them)
      this.placed = null;
      return;
    }
    if (placed === this.placed && Math.abs(near - this.reach) < 1e-6 && eye.distanceTo(this.at) < 0.5) return;
    this.placed = placed;
    this.reach = near;
    this.at.copy(eye);
    // (a little past the reach: the shader fades each by its own distance, warped)
    const reach = near + 8;
    const found: Array<[number, number]> = [];
    const p = new Vector3();
    for (let i = 0; i < placed.length; i += 5) {
      p.set(placed[i], placed[i + 1], placed[i + 2]).multiplyScalar(R + placed[i + 3] + 2.5);
      const d = p.distanceTo(eye);
      if (d < reach) found.push([d, i]);
    }
    found.sort((a, b) => a[0] - b[0]);
    const n = Math.min(found.length, NEAR_TREES.max);
    const t = this.tree.array as Float32Array;
    const s = this.seed.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = found[k][1];
      t.set(placed.subarray(i, i + 4), 4 * k);
      s[k] = placed[i + 4];
    }
    this.tree.needsUpdate = true;
    this.seed.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }
}
