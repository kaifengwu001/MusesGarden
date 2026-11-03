import {
  HalfFloatType,
  FloatType,
  LinearFilter,
  OrthographicCamera,
  Vector4,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLCubeRenderTarget,
  type Texture,
  type Vector3,
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
//   parcels  Golden Rye's fields: crop depth (m), field tone, road (m), cut
//            (parcels.glsl), at half the terrain's resolution
// Re-baked only when the fields change: the seed, a parameter, or R while
// the planet grows. A full bake is heavy (~10 ms of GPU on an M1 Pro), so
// while things are changing a quarter-size set is baked every frame, and the
// full set once they have held still for a few frames.

function cube(size: number, fullPrecision=false): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(size, {
    type: fullPrecision?FloatType:HalfFloatType,
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
  readonly parcels: WebGLCubeRenderTarget;
  /** What the fields bake measures to find tiny pieces of crop (parcels.glsl pass 3), at half its size. */
  readonly areas: WebGLCubeRenderTarget;
  key: string;
}

/** Texels per face edge of the fields map for a terrain bake of `size`. */
export function parcelSize(size: number): number {
  return Math.min(512, size / 2);
}

function bakeSet(size: number): BakeSet {
  return { size, terrain: cube(size,true), flora: cube(Math.min(64,size / 2)), parcels: cube(parcelSize(size)), areas: cube(parcelSize(size) / 2), key: '' };
}

/** How many yards and reaped rings the fields bake takes (parcels.glsl PARCEL_YARDS). */
export const PARCEL_YARDS = 32;

/** The fields' recipe (parcels.glsl), after Ryo Takemasa's terraces. Lengths
 * are for R 128 and scale with the planet, so the fields grow with it. */
export const PARCELS = {
  /** Strip period across the bands (m): a strip and its bund. */
  period: 10.5,
  /** How far the bands waver (bands), so strips swell and narrow. */
  waver: 0.72,
  /** Mean length of a strip's segment (m): strips run 5–20 times as long as wide. */
  segment: 105,
  /** Bund half width (m); each bund and each segment's end gap is 0.7–3.2× it. */
  bund: 0.9,
  /** Rounding of a strip's corners (m). */
  rounding: 4,
  /** The roads' half width and their grass verges (m). */
  road: 1.35,
  verge: 0.7,
  /** How far the farm road passes in front of the cottage, and the side road beside it (m): just outside its yard. */
  home: 13.5,
  /** A piece of crop smaller than this (m², for R 128; it scales with the fields) is not drawn: grass instead. */
  leastArea: 70,
  /** Radius of the disk a piece is measured in (m, for R 128): pieces up to twice it across are measured whole. */
  measure: 9,
} as const;

/** A grass yard (radius > 0, m) or a reaped ring round a sheaf (radius < 0). */
export interface Clearing { direction: Vector3; radius: number }

interface ParcelUniforms {
  uParcelRadius: { value: number };
  uParcelShape: { value: Vector4 };
  uParcelEdge: { value: Vector4 };
  uParcelHome: { value: Vector4 };
  uParcelFront: { value: Vector4 };
  uParcelYards: { value: Vector4[] };
  uParcelYardCount: { value: number };
  uParcelPatch: { value: Vector4 };
  uBakedParcels: { value: Texture | null };
  uBakedArea: { value: Texture | null };
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
  private readonly parcels: ParcelUniforms = {
    uParcelRadius: { value: 128 },
    uParcelShape: { value: new Vector4(PARCELS.period / 128, PARCELS.waver, PARCELS.segment, PARCELS.bund) },
    uParcelEdge: { value: new Vector4(PARCELS.rounding, 0, PARCELS.road, PARCELS.verge) },
    uParcelHome: { value: new Vector4(0, 1, 0, PARCELS.home) },
    uParcelFront: { value: new Vector4(1, 0, 0, 0) },
    uParcelYards: { value: Array.from({ length: PARCEL_YARDS }, () => new Vector4()) },
    uParcelYardCount: { value: 0 },
    uParcelPatch: { value: new Vector4(PARCELS.measure, PARCELS.leastArea / (Math.PI * PARCELS.measure ** 2), 0, 0) },
    uBakedParcels: { value: null },
    uBakedArea: { value: null },
  };

  constructor(size: number) {
    this.full = bakeSet(size);
    this.quick = bakeSet(Math.min(256,size / 2));
    const bytes = (s: number): number => 6 * (16*s*s + 8*Math.min(64,s/2)**2 + 8*parcelSize(s)**2 + 8*(parcelSize(s)/2)**2);
    gpuMemory.set('terrain bake', bytes(this.full.size) + bytes(this.quick.size));
    this.uniforms = createFieldUniforms();
    const material = new ShaderMaterial({
      name: 'terrain bake',
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      uniforms: { ...this.uniforms, ...this.parcels, uFace: this.face, uPass: this.pass, uSize: this.sizeU, uBakedTerrain: this.baked },
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

  parcelTexture(full: boolean): Texture {
    return (full ? this.full : this.quick).parcels.texture;
  }

  /**
   * What the fields bake needs beyond the field uniforms: the radius (its
   * distances are meters), the cottage and the way it faces (the strips run
   * along its front, the roads pass it), and the yards and reaped rings. Part
   * of what the bake key must cover.
   */
  setParcels(radius: number, home: Vector3, front: Vector3, clearings: readonly Clearing[]): void {
    const u = this.parcels;
    u.uParcelRadius.value = radius;
    // the strips scale with the planet; the bunds, roads and corners only part way, so neither vanishes
    const scale = radius / 128;
    const soft = Math.min(1.6, Math.max(0.6, scale));
    u.uParcelShape.value.set(PARCELS.period / 128, PARCELS.waver, PARCELS.segment * scale, PARCELS.bund * soft);
    u.uParcelEdge.value.set(PARCELS.rounding * soft, 0, PARCELS.road * soft, PARCELS.verge * soft);
    u.uParcelHome.value.set(home.x, home.y, home.z, PARCELS.home);
    u.uParcelFront.value.set(front.x, front.y, front.z, 0);
    // (the least area scales with the fields, as does the disk, so the share it is of the disk stays put)
    u.uParcelPatch.value.set(PARCELS.measure * scale, PARCELS.leastArea / (Math.PI * PARCELS.measure ** 2), 0, 0);
    const count = Math.min(PARCEL_YARDS, clearings.length);
    for (let i = 0; i < count; i++) {
      const c = clearings[i];
      u.uParcelYards.value[i].set(c.direction.x, c.direction.y, c.direction.z, c.radius);
    }
    u.uParcelYardCount.value = count;
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
      [set.parcels, 2],
      [set.areas, 3],
      [set.parcels, 4],
    ] as const) {
      this.pass.value = pass;
      // the flora pass reads the terrain it follows, the areas the fields, the
      // final fields the areas; no pass may have its own target bound as a
      // sampler (a feedback loop drops the draw)
      this.baked.value = pass === 1 ? set.terrain.texture : null;
      this.parcels.uBakedParcels.value = pass === 3 ? set.parcels.texture : null;
      this.parcels.uBakedArea.value = pass === 4 ? set.areas.texture : null;
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
