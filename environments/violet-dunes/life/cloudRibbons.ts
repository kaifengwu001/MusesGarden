import { BufferAttribute, BufferGeometry, DoubleSide, Matrix3, Matrix4, Mesh, ShaderMaterial, Vector2, Vector3, type IUniform, type Texture } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { geometryBytes, gpuMemory } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import vertexShader from './cloudRibbons.vert.glsl?raw';
import fragmentShader from './cloudRibbons.frag.glsl?raw';

/** Thin high ice-cloud streaks: partial arcs with tapered ends, never a closed ring. */
export const CIRRUS_BANDS = 28;
const STEPS = 72;

/** Unit-sphere geometry keeps the weather continuous while the world grows. */
export function cloudRibbonGeometry(seed: number): BufferGeometry {
  const positions: number[] = [];
  const coords: number[] = [];
  const indices: number[] = [];
  let state = hash32(seed ^ 0x7c1649);
  const rand = (): number => unit(state = hash32(state + 0x9e3779b9));
  const tilt = new Matrix4().makeRotationAxis(new Vector3(0.7, 0.2, 0.45).normalize(), 0.72);
  const dir = new Vector3();
  for (let band = 0; band < CIRRUS_BANDS; band++) {
    // Spread streak centres around the entire sphere; alternating latitudes
    // and unequal lengths leave broad clear regions between weather systems.
    const latitude = Math.asin(-0.86 + 1.72 * ((band + 0.5) / CIRRUS_BANDS));
    const start = band * 2.39996323 + rand() * 0.5;
    const length = 0.62 + rand() * 1.05;
    const width = (0.019 + rand() * 0.025) * 2.25;
    const phase = rand() * Math.PI * 2;
    const sway = 0.035 + rand() * 0.075;
    const first = positions.length / 3;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const angle = start + length * (t - 0.5);
      const lat = latitude + sway * Math.sin(t * 4.2 + phase) + 0.09 * (t - 0.5);
      const taper = 0.12 + 0.88 * Math.pow(Math.sin(Math.PI * t), 0.6);
      for (const side of [-1, 1]) {
        const across = lat + side * width * taper;
        dir.set(Math.cos(across) * Math.cos(angle), Math.sin(across), Math.cos(across) * Math.sin(angle)).applyMatrix4(tilt);
        positions.push(dir.x, dir.y, dir.z);
        coords.push(t, side, phase);
      }
      if (i < STEPS) {
        const a = first + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aRibbon', new BufferAttribute(new Float32Array(coords), 3));
  geometry.setIndex(indices);
  return geometry;
}

export class CloudRibbons {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private seed = Number.NaN;
  private readonly rotation = new Matrix4();
  private readonly uniforms = {
    uCirrusRadius: { value: 160 },
    uCirrusRotation: { value: new Matrix3() },
    uCirrusOpacity: { value: 0.55 },
    uCirrusDepth: { value: null as Texture | null },
    uCirrusDepthSize: { value: new Vector2(1, 1) },
  };

  constructor(shared: Record<string, IUniform>) {
    const material = new ShaderMaterial({
      name: 'violet high cirrus ribbons', vertexShader, fragmentShader,
      uniforms: { ...shared, ...this.uniforms },
      side: DoubleSide, transparent: true, depthWrite: false, depthTest: false,
      // These are thin sheets, not volumes needing back/front transparency
      // passes. Submit each triangle once with one fixed shader program.
      forceSinglePass: true,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(new BufferGeometry(), material);
    // World positions are generated in the shader, including the planet warp.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** The opaque scene's resolved depth, in the same lower-left render viewport. */
  setDepth(texture: Texture, width: number, height: number): void {
    this.uniforms.uCirrusDepth.value = texture;
    this.uniforms.uCirrusDepthSize.value.set(width, height);
  }

  /** The streaks on a shell `height` above R (m). */
  update(seed: number, radius: number, height: number, time: number, windAxis: Vector3, eye: Vector3, speed: number): void {
    if (seed !== this.seed) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = cloudRibbonGeometry(seed);
      gpuMemory.set('cirrus geometry', geometryBytes(this.mesh.geometry));
      this.seed = seed;
    }
    // Where a dune rises through the shell, the scene's depth hides the streak
    // behind it. Thin cirrus casts no discernible ground shadow.
    this.uniforms.uCirrusRadius.value = radius + height;
    this.rotation.makeRotationAxis(windAxis, time * (0.0007 + speed * 0.0018));
    this.uniforms.uCirrusRotation.value.setFromMatrix4(this.rotation);
    const orbit = smoothstep(0.2, 0.8, (eye.length() - radius) / radius);
    this.uniforms.uCirrusOpacity.value = 0.28 + 0.36 * orbit;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    gpuMemory.delete('cirrus geometry');
  }
}
