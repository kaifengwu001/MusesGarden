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

// The canyon fields baked into two direction-space cube maps, so the ground,
// the paint and the vegetation read them back with one fetch instead of
// re-running the noise per vertex and per pixel:
//   terrain  smooth relief integer / lushness / relief fraction / colour variant
//            terrace shaping happens AFTER lookup so cliffs remain precise
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

function bakeSet(size: number, floraSize = size / 2): BakeSet {
  return { size, terrain: cube(size), flora: cube(floraSize), key: '' };
}

function setBytes(set: BakeSet): number {
  return 6 * 8 * (set.terrain.width ** 2 + set.flora.width ** 2);
}

export class TerrainBake {
  readonly uniforms: FieldUniforms;
  /** Bakes so far (perf stat). */
  bakes = 0;
  private full: BakeSet;
  private readonly quick: BakeSet;
  private readonly face = { value: 0 };
  private readonly pass = { value: 0 };
  private readonly sizeU = { value: 0 };
  private readonly baked: { value: Texture | null } = { value: null };
  private readonly scene: Scene;
  private readonly camera = new OrthographicCamera();

  constructor(private readonly baseSize: number) {
    this.full = bakeSet(baseSize);
    this.quick = bakeSet(baseSize / 2);
    this.recordMemory();
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

  private recordMemory(): void {
    gpuMemory.set('terrain bake', setBytes(this.full) + setBytes(this.quick));
  }

  /** Large planets need finer height texels; flora retains the quality tier's original size. */
  private fullSize(radius: number): number {
    return this.baseSize * (radius > 256 ? 2 : 1);
  }

  private resizeFull(radius: number, full: boolean): void {
    const size = this.fullSize(radius);
    // Growth scrubbing keeps the cheap quick set. Upgrade only when settled;
    // release the larger allocation immediately when the world shrinks.
    if (size === this.full.size || (!full && size > this.full.size)) return;
    this.full.terrain.dispose();
    this.full.flora.dispose();
    this.baked.value = null;
    this.full = bakeSet(size, this.baseSize / 2);
    this.recordMemory();
  }

  /** Meters per terrain texel at a face centre (the coarsest spot), full or quick set. */
  texelMeters(radius: number, full: boolean): number {
    return (2 * radius) / (full ? this.fullSize(radius) : this.quick.size);
  }

  terrainTexture(full: boolean): Texture {
    return (full ? this.full : this.quick).terrain.texture;
  }

  floraTexture(full: boolean): Texture {
    return (full ? this.full : this.quick).flora.texture;
  }

  /** Bake the full or the quick set when `key` (everything the fields depend on) has changed. */
  bake(renderer: WebGLRenderer, fields: Fields, key: string, full: boolean): boolean {
    this.resizeFull(fields.radius, full);
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
