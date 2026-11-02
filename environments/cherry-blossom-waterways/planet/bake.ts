import {
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLCubeRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../../../src/core/gpuMemory';
import { fullscreenMesh } from '../../../src/render/fullscreen';
import fragmentShader from './bake.frag.glsl?raw';
import { createFieldUniforms, type Fields, type FieldUniforms } from './fields';

// The meadow fields baked into two direction-space cube maps, so the ground,
// the paint and the vegetation read them back with one fetch instead of
// re-running the noise per vertex and per pixel:
//   terrain  natural height (m), lushness, wetness, colour variant
//   flora    flowers per m² for the four species, at half resolution
//            (colonies are meters wide)
// Re-baked only when the fields change: the seed, a parameter, or R while
// the planet grows. A full bake is heavy (~10 ms of GPU on an M1 Pro), so
// while things are changing a quarter-size set is baked every frame, and the
// full set once they have held still for a few frames.

function cube(size: number): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(size, {
    type: HalfFloatType,
    format: RGBAFormat,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
}

interface BakeSet {
  readonly size: number;
  readonly terrain: WebGLCubeRenderTarget;
  readonly flora: WebGLCubeRenderTarget;
  key: string;
}

function bakeSet(size: number): BakeSet {
  return { size, terrain: cube(size), flora: cube(size / 2), key: '' };
}

export class TerrainBake {
  readonly uniforms: FieldUniforms;
  /** Bakes so far (perf stat). */
  bakes = 0;
  private readonly full: BakeSet;
  private readonly quick: BakeSet;
  private readonly face = { value: 0 };
  private readonly pass = { value: 0 };
  private readonly sizeU = { value: 0 };
  private readonly baked: { value: Texture | null } = { value: null };
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();

  constructor(size: number) {
    this.full = bakeSet(size);
    this.quick = bakeSet(size / 2);
    const bytes = (s: number): number => 6 * 8 * (s * s + (s / 2) ** 2);
    gpuMemory.set('terrain bake', bytes(size) + bytes(size / 2));
    this.uniforms = createFieldUniforms();
    const material = new ShaderMaterial({
      name: 'terrain bake',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      uniforms: { ...this.uniforms, uFace: this.face, uPass: this.pass, uSize: this.sizeU, uBakedTerrain: this.baked },
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new Scene().add(fullscreenMesh(material));
  }

  /** Meters per terrain texel at a face centre (the coarsest spot), full or quick set. */
  texelMeters(radius: number, full: boolean): number {
    return (2 * radius) / (full ? this.full : this.quick).size;
  }

  terrainTexture(full: boolean): Texture {
    return (full ? this.full : this.quick).terrain.texture;
  }

  floraTexture(full: boolean): Texture {
    return (full ? this.full : this.quick).flora.texture;
  }

  /** Bake the full or the quick set when `key` (everything the fields depend on) has changed. */
  bake(renderer: WebGLRenderer, fields: Fields, key: string, full: boolean): boolean {
    const set = full ? this.full : this.quick;
    if (key === set.key) return false;
    set.key = key;
    fields.writeUniforms(this.uniforms);
    const previous = renderer.getRenderTarget();
    for (const [target, pass] of [
      [set.terrain, 0],
      [set.flora, 1],
    ] as const) {
      this.pass.value = pass;
      // the flora pass reads the terrain it follows; the terrain pass must not
      // have its own target bound as a sampler (a feedback loop drops the draw)
      this.baked.value = pass === 1 ? set.terrain.texture : null;
      this.sizeU.value = target.width;
      for (let face = 0; face < 6; face++) {
        this.face.value = face;
        renderer.setRenderTarget(target, face);
        renderer.render(this.scene, this.camera);
      }
    }
    renderer.setRenderTarget(previous);
    this.bakes++;
    return true;
  }

  /** Forget what was baked: the next bake of each set runs whatever it is given. */
  invalidate(): void {
    this.full.key = '';
    this.quick.key = '';
  }
}
