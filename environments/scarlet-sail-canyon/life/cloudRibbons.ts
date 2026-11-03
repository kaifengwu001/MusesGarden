import { BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix3, Matrix4, Mesh, ShaderMaterial, Vector3, type HSL, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { geometryBytes, gpuMemory } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import vertexShader from './cloudRibbons.vert.glsl?raw';
import fragmentShader from './cloudRibbons.frag.glsl?raw';

// Violet Dunes' high cirrus (environments/violet-dunes/life/cloudRibbons.ts), the canyon's only clouds. Violet
// composites them after its scene in a pass of its own post pipeline; here they are drawn last in the scene itself,
// depth-tested against the ground, so the shared post pipeline stays as it is. Their number, height and colour
// follow the Parameters panel (Clouds); at its defaults they are Violet's.

/** Thin high ice-cloud streaks: partial arcs with tapered ends, never a closed ring. Violet has 28. */
export const CIRRUS_BANDS = 28;
const STEPS = 72;
/**
 * The canyon's coral pink, from the user's swatch (Violet's are an ivory light and a little lilac): the light is the
 * swatch's top, and the colour across each streak's edge puts a streak's average on the swatch's middle, #F8B9B0.
 */
const LIGHT = new Color('#F8C8BF');
const SHADE = new Color('#F88178');
/** Saturation of the tint's hue, at each colour's own lightness. */
const TINT_SATURATION = 0.65;

/** Unit-sphere geometry keeps the weather continuous while the world grows. */
export function cloudRibbonGeometry(seed: number, bands = CIRRUS_BANDS): BufferGeometry {
  const positions: number[] = [];
  const coords: number[] = [];
  const indices: number[] = [];
  let state = hash32(seed ^ 0x7c1649);
  const rand = (): number => unit(state = hash32(state + 0x9e3779b9));
  const tilt = new Matrix4().makeRotationAxis(new Vector3(0.7, 0.2, 0.45).normalize(), 0.72);
  const dir = new Vector3();
  for (let band = 0; band < bands; band++) {
    // Spread streak centres around the entire sphere; alternating latitudes
    // and unequal lengths leave broad clear regions between weather systems.
    const latitude = Math.asin(-0.86 + 1.72 * ((band + 0.5) / bands));
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
  private built = '';
  private tinted = '';
  private readonly rotation = new Matrix4();
  private readonly hsl: HSL = { h: 0, s: 0, l: 0 };
  private readonly hue = new Color();
  private readonly uniforms = {
    uCirrusRadius: { value: 160 },
    uCirrusRotation: { value: new Matrix3() },
    uCirrusOpacity: { value: 0.55 },
    uCirrusLight: { value: LIGHT.clone() },
    uCirrusShade: { value: SHADE.clone() },
  };

  constructor(shared: Record<string, IUniform>) {
    const material = new ShaderMaterial({
      name: 'high cirrus ribbons (from Violet Dunes)', vertexShader, fragmentShader,
      uniforms: { ...shared, ...this.uniforms },
      // the scene's depth keeps far-side streaks behind the planet
      side: DoubleSide, transparent: true, depthWrite: false, depthTest: true,
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

  /** `bands` streaks on a shell `height` above R (m), `opacity` × Violet's. */
  update(seed: number, bands: number, radius: number, height: number, opacity: number, time: number, windAxis: Vector3, eye: Vector3, speed: number): void {
    const key = `${seed} ${bands}`;
    if (key !== this.built) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = cloudRibbonGeometry(seed, bands);
      gpuMemory.set('cirrus geometry', geometryBytes(this.mesh.geometry));
      this.built = key;
    }
    // Thin cirrus casts no discernible ground shadow.
    this.uniforms.uCirrusRadius.value = radius + height;
    this.rotation.makeRotationAxis(windAxis, time * (0.0007 + speed * 0.0018));
    this.uniforms.uCirrusRotation.value.setFromMatrix4(this.rotation);
    const orbit = smoothstep(0.2, 0.8, (eye.length() - radius) / radius);
    this.uniforms.uCirrusOpacity.value = (0.28 + 0.36 * orbit) * opacity;
  }

  /**
   * The two colours drawn toward a hue (degrees) by `tint` (0 leaves them as they are), each at its own lightness,
   * then scaled by `brightness`.
   */
  setColour(hue: number, tint: number, brightness: number): void {
    const key = `${hue} ${tint} ${brightness}`;
    if (key === this.tinted) return;
    this.tinted = key;
    for (const [out, base] of [[this.uniforms.uCirrusLight.value, LIGHT], [this.uniforms.uCirrusShade.value, SHADE]] as const) {
      base.getHSL(this.hsl);
      this.hue.setHSL(hue / 360, TINT_SATURATION, this.hsl.l);
      out.copy(base).lerp(this.hue, tint).multiplyScalar(brightness);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    gpuMemory.delete('cirrus geometry');
  }
}
