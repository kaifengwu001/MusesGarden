import { BufferAttribute, BufferGeometry, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector2, type IUniform } from 'three';
import { gpuMemory, geometryBytes } from '../../../src/core/gpuMemory';
import vertexShader from './ryeCanopy.vert.glsl?raw';
import fragmentShader from './ryeCanopy.frag.glsl?raw';

/** Height of the top shell above the ground (m): over the tallest field's ears. */
export const CANOPY_TOP = 1.24;
/** Quads per cube-face edge of each shell. The ground is flat, so the shells need no more. */
export const CANOPY_GRID = 64;
/** Shells per quality tier. */
export const CANOPY_SHELLS = { high: 16, medium: 12, low: 8 } as const;
/** Shells seen from orbit, whatever the tier. */
export const CANOPY_FAR_SHELLS = 6;

/** Longest edge of any triangle of a canopy sphere (rad): how far its chords sag below the true sphere. */
export function canopyEdgeAngle(sphere: BufferGeometry): number {
  const p = sphere.getAttribute('position');
  const index = sphere.getIndex()!;
  let longest = 0;
  for (let t = 0; t < index.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index.getX(t + e);
      const b = index.getX(t + ((e + 1) % 3));
      const dot = p.getX(a) * p.getX(b) + p.getY(a) * p.getY(b) + p.getZ(a) * p.getZ(b);
      longest = Math.max(longest, Math.acos(Math.min(1, dot)));
    }
  }
  return longest;
}

/**
 * How far (m) a shell must lift to clear the ground everywhere between its
 * vertices: a chord of `edge` (rad) sags edge²/8 · curvature, and the warp
 * (k > 0) bends the ground as a sphere of curvature 1/R + 2k. Mirrors
 * ryeCanopy.vert.glsl.
 */
export function canopyLift(edge: number, radius: number, warpK: number): number {
  const length = edge * radius;
  return length * length * 0.125 * (1 / radius + 2 * Math.max(warpK, 0)) + 0.005;
}

/** A unit sphere as six equi-angular cube faces of grid × grid quads, indexed. */
export function canopySphere(grid: number): BufferGeometry {
  const n = grid + 1;
  const positions = new Float32Array(6 * n * n * 3);
  const index = new Uint32Array(6 * grid * grid * 6);
  const axes: readonly (readonly [number, number, number])[] = [
    [0, 1, 2], [0, 2, 1], [1, 2, 0], [1, 0, 2], [2, 0, 1], [2, 1, 0],
  ];
  let p = 0;
  let o = 0;
  for (let face = 0; face < 6; face++) {
    const [major, a, b] = axes[face];
    const sign = face % 2 === 0 ? 1 : -1;
    const base = face * n * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = Math.tan(((i / grid) * 2 - 1) * (Math.PI / 4));
        const v = Math.tan(((j / grid) * 2 - 1) * (Math.PI / 4));
        const d = [0, 0, 0];
        d[major] = sign;
        d[a] = u;
        d[b] = v;
        const l = Math.hypot(d[0], d[1], d[2]);
        positions[p++] = d[0] / l;
        positions[p++] = d[1] / l;
        positions[p++] = d[2] / l;
      }
    }
    // wound to face outward: test one triangle of the face, the rest share its turn
    const at = (k: number): [number, number, number] => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]];
    const [x0, y0, z0] = at(base);
    const [x1, y1, z1] = at(base + 1);
    const [x2, y2, z2] = at(base + n + 1);
    const cx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
    const cy = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
    const cz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    const outward = cx * x0 + cy * y0 + cz * z0 > 0;
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const k = base + j * n + i;
        index.set(outward ? [k, k + 1, k + n + 1, k, k + n + 1, k + n] : [k, k + n + 1, k + 1, k, k + n, k + n + 1], o);
        o += 6;
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

let nextCanopyId = 0;

/**
 * The standing crop as a mass: stacked shells over the whole planet, each
 * keeping only the cross-sections of the stalks that reach it (a fur-shell
 * crop). Each field is a raised fuzzy slab with a rounded edge and dark
 * sides; the bunds carry short grass and the road none (crop.glsl). Shells
 * thin out close to the camera, where the detailed ears (rye.ts) take over.
 */
export class RyeCanopy {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly shells: InstancedBufferAttribute;
  private readonly ledger = `golden-rye/canopy-${nextCanopyId++}`;
  readonly uniforms = {
    uCanopyTop: { value: CANOPY_TOP },
    uCanopyFade: { value: new Vector2(4.5, 9.0) },
    uCanopyCoverage: { value: 1 },
    uCanopyEdge: { value: 0 },
    uCanopyStep: { value: CANOPY_TOP / CANOPY_SHELLS.high },
  };

  constructor(shared: Record<string, IUniform>, shells: number) {
    const sphere = canopySphere(CANOPY_GRID);
    this.uniforms.uCanopyEdge.value = canopyEdgeAngle(sphere);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', sphere.getAttribute('position'));
    geometry.setIndex(sphere.getIndex());
    const max = CANOPY_SHELLS.high;
    this.shells = new InstancedBufferAttribute(new Float32Array(max), 1);
    geometry.setAttribute('aShell', this.shells);
    const material = new ShaderMaterial({
      name: 'Golden Rye: standing crop canopy',
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...this.uniforms },
      // Both sides: near the visual horizon the eye's ray, having passed over a
      // road or bund, runs up through a field's crop and leaves through a
      // shell's underside; without it the field shows as separate lines.
      side: DoubleSide,
      alphaToCoverage: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'Standing rye canopy';
    this.mesh.frustumCulled = false;
    // after the ground, so the planet's far side (all undersides now) fails the depth test before it is shaded
    this.mesh.renderOrder = 1;
    this.setShells(shells);
    gpuMemory.set(this.ledger, geometryBytes(geometry));
  }

  /** How many shells (quality): drawn top first, so the ones under them are hidden early. */
  setShells(count: number): void {
    const n = Math.max(2, Math.min(CANOPY_SHELLS.high, Math.round(count)));
    if (n === this.mesh.geometry.instanceCount) return;
    for (let i = 0; i < n; i++) this.shells.setX(i, (n - i - 0.5) / n);
    this.shells.needsUpdate = true;
    this.uniforms.uCanopyStep.value = CANOPY_TOP / n;
    this.mesh.geometry.instanceCount = n;
  }

  get shellCount(): number {
    return this.mesh.geometry.instanceCount;
  }

  get triangles(): number {
    return (this.mesh.geometry.index!.count / 3) * this.mesh.geometry.instanceCount;
  }

  /** Whether the frame has MSAA: strands then fade by coverage, otherwise they are cut at half. */
  set coverage(on: boolean) {
    this.uniforms.uCanopyCoverage.value = on ? 1 : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    gpuMemory.delete(this.ledger);
  }
}
