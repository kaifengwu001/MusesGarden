import {
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLCubeRenderTarget,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { fullscreenMesh } from '../render/fullscreen';
import fragmentShader from './bake.frag.glsl?raw';
import { createFieldUniforms, type FieldUniforms } from './fields';

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

/** What a bake draws: its fragment shader (passes 0 and 1, as bake.frag.glsl) and the uniforms its fields write. */
export interface BakeProgram<U> {
  /** The material's name, and the GPU memory ledger's. */
  readonly name: string;
  readonly fragmentShader: string;
  readonly uniforms: U;
}

/** Fields a bake can draw: they write its uniforms. */
export interface BakedFields<U> {
  writeUniforms(u: U): void;
}

export class TerrainBake<U extends object = FieldUniforms> {
  readonly uniforms: U;
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

  /** The meadow's fields by default; another planet passes its own (terraces/bake.frag.glsl). */
  constructor(size: number, program?: BakeProgram<U>) {
    const p = program ?? ({ name: 'terrain bake', fragmentShader, uniforms: createFieldUniforms() } as unknown as BakeProgram<U>);
    this.full = bakeSet(size);
    this.quick = bakeSet(size / 2);
    const bytes = (s: number): number => 6 * 8 * (s * s + (s / 2) ** 2);
    gpuMemory.set(p.name, bytes(size) + bytes(size / 2));
    this.uniforms = p.uniforms;
    const material = new ShaderMaterial({
      name: p.name,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: p.fragmentShader,
      uniforms: { ...(this.uniforms as Record<string, IUniform>), uFace: this.face, uPass: this.pass, uSize: this.sizeU, uBakedTerrain: this.baked },
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
  bake(renderer: WebGLRenderer, fields: BakedFields<U>, key: string, full: boolean): boolean {
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
