import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  CustomBlending,
  DataTexture,
  DataUtils,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LessDepth,
  LinearFilter,
  Matrix3,
  Matrix4,
  MaxEquation,
  Mesh,
  NearestFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RedFormat,
  RGFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import { hash32 } from '../core/hash';
import type { PlanetField } from './build/field';
import mistFragment from './mist.frag.glsl?raw';
import mistVertex from './mist.vert.glsl?raw';
import { ribbonMesh, type RibbonMesh } from './mistRibbons';
import mistStrokeFragment from './mistStroke.frag.glsl?raw';
import mistStrokeVertex from './mistStroke.vert.glsl?raw';
import { makeStrokes, type StrokeParams } from './mistStrokes';

// The terraces' mist (Kai, 2026-11-02: the paintings' meandering bands of mist; "meander between hills instead of
// across the whole planet"; "branch and merge"; then, of the blue-green landscape, "match as close as possible":
// lower, denser, its meanders less simple and mechanical, its widths growing and shrinking as the painting's; then
// one layer, a little more in it, no shadows, translucent by its breadth; then a lever for how many, the layer a full
// sphere, each cloud offset up or down from it at random within a range of Kai's). Its strokes are brushed as the
// painting's ribbons are (mistStrokes.ts): meandering as a river does, steered round the hills, swelling and pinching,
// scalloped, pointed at its tail, now and then curled at its end, forking, stacked. A stroke with its branch and its
// sibling is a cloud, at its own height. Their shapes are drawn once a seed into a cube map as the distance from
// their edges and their breadth there (mistStroke.*.glsl: every segment's, the greatest kept), and beside it which
// stroke's chunk reaches furthest in at each place, and its height (its owner). Each stroke is drawn as a ribbon at
// its cloud's height (mistRibbons.ts); each place of the clouds at a height is painted once, by the chunk that owns
// it, from the shapes' map, so a cloud's strokes merge where they fork and cross (and clouds at the same height, as
// all are with no range); where a stroke at another height owns a place, a ribbon paints itself there by its own
// shape, so two clouds that cross at different heights are each whole. They drift
// with the wind (the strokes' space turned about the wind's axis), and are painted as the paintings paint their mist
// (mist.frag.glsl), the thinner the more translucent; the hills rise through the layer, and it thins where the ground
// comes up to it. The paddies' water reflects the layer's shapes on its sphere (mist.glsl `mistReflected`).

/** The layer: its strokes (how many, and how far their clouds' heights range, the panel's), its drift (× the panel's speed). */
export interface MistLayer extends StrokeParams {
  readonly drift: number;
}

/**
 * One layer (Kai: the layers' overlapping did not look good; one, with a little more in it), on a sphere at Kai's
 * height over the radius (the panel's Cloud height), as many clouds as the panel's Cloud count, each up or down
 * from the sphere by as much as its Cloud height range; their way twisted off the wind's across the globe (the
 * panel's Cloud twist).
 */
export const MIST: MistLayer = { strokes: 120, range: 3, half: 2.9, length: [50, 140], wavelength: [30, 55], sinuosity: [0.2, 1.75], curl: 0.4, branch: 0.35, stack: 0.3, lobe: 3, steer: 0.04, twist: 0.6, drift: 0.4 };

/** The cube maps' side, and the ground's raster's (texels a cube face). */
const BANDS = 512;
const GROUND = 96;
/** How far past a stroke's edge its distance is drawn (m), and the offset the shapes' map keeps distances at (m: none drawn is 0, −10 m). */
const MARGIN = 2;
const OFFSET = 10;
/** How far the ribbons reach past their strokes' edges (m): past their soft edge, by more than half a texel of the cube maps. */
const RIM = 0.6;

/** Each face of the cube maps (the GL cube-map convention, as bake.frag.glsl): a direction's coordinates on it are (across, up) / out. */
const FACES = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
].map(([u, v, m]) => new Matrix3().set(u.x, v.x, m.x, u.y, v.y, m.y, u.z, v.z, m.z));

export class TerraceMist {
  /** For the shared uniforms (the ground and the paddies' water read them): the shapes, the layer's drift and settings, the ground's height. */
  readonly uniforms: Record<string, IUniform>;
  /** The clouds, as two meshes: those above the camera, then those below it (each the far ones first); add to the scene. */
  readonly group = new Group();
  /** The last bake's (dev stats). */
  strokes = { clouds: 0, strokes: 0, children: 0, segments: 0, area: 0, triangles: 0 };
  private readonly bands = new WebGLCubeRenderTarget(BANDS, { type: HalfFloatType, format: RGFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
  private readonly owners = new WebGLCubeRenderTarget(BANDS, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: true, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter });
  private readonly ground: DataTexture;
  /** The same raster, at full precision, for the strokes' placement: per texel the ground's height. */
  private readonly groundCpu = new Float32Array(6 * GROUND * GROUND);
  private bakedFor = Number.NaN;
  private groundFor = Number.NaN;
  /** The wind's axis the strokes were made for (made again if it turns), what else they were made for, what was last asked for, and when that last changed (ms). */
  private readonly bakedAxis = new Vector3();
  private baked = '';
  private wanted = '';
  private changedAt = 0;
  private readonly bake: ShaderMaterial;
  private readonly bakeOwners: ShaderMaterial;
  private readonly bakeMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly bakeScene: Scene;
  private readonly camera = new OrthographicCamera();
  private readonly turn = new Matrix4();
  private readonly clearColor = new Color();
  private readonly above: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly below: Mesh<BufferGeometry, ShaderMaterial>;
  /** The clouds' offsets, lowest first, and the index the triangles of each end at (in that order). */
  private heights: Float32Array = new Float32Array(0);
  private ends = new Uint32Array(0);

  constructor(shared: Record<string, IUniform>) {
    gpuMemory.set('mist strokes', 6 * BANDS * BANDS * 4);
    gpuMemory.set('mist owners', 6 * BANDS * BANDS * 8);
    this.ground = new DataTexture(new Uint16Array(GROUND * 6 * GROUND), GROUND, 6 * GROUND, RedFormat, HalfFloatType);
    this.ground.minFilter = LinearFilter;
    this.ground.magFilter = LinearFilter;
    this.ground.wrapS = ClampToEdgeWrapping;
    this.ground.wrapT = ClampToEdgeWrapping;
    this.uniforms = {
      uMistBands: { value: this.bands.texture },
      uMistDrift: { value: new Matrix3() },
      uMistLayer: { value: new Vector4(3.5, 0, OFFSET, 1) },
      uMistGround: { value: this.ground },
    };
    Object.assign(shared, this.uniforms);
    // (every segment of the strokes splatted as the distance from its edge and its breadth there, the greatest kept;
    // then again as its chunk and cloud, the one reaching furthest in kept, by depth)
    this.bake = new ShaderMaterial({
      name: 'mist strokes',
      vertexShader: mistStrokeVertex,
      fragmentShader: mistStrokeFragment,
      uniforms: { uCubeFace: { value: new Matrix3() }, uShell: { value: 128 }, uMargin: { value: MARGIN }, uOffset: { value: OFFSET } },
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    this.bakeOwners = new ShaderMaterial({
      name: 'mist owners',
      vertexShader: mistStrokeVertex,
      fragmentShader: mistStrokeFragment,
      defines: { OWNERS: '' },
      uniforms: this.bake.uniforms,
      side: DoubleSide,
      depthTest: true,
      depthWrite: true,
      depthFunc: LessDepth,
      blending: NoBlending,
    });
    this.bakeMesh = new Mesh(new InstancedBufferGeometry(), this.bake);
    this.bakeMesh.frustumCulled = false;
    this.bakeScene = new Scene().add(this.bakeMesh);
    const material = new ShaderMaterial({
      name: 'mist',
      vertexShader: mistVertex,
      fragmentShader: mistFragment,
      uniforms: { ...shared, uMistOwners: { value: this.owners.texture } },
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.above = new Mesh(new BufferGeometry(), material);
    this.below = new Mesh(new BufferGeometry(), material);
    for (const [mesh, order] of [
      [this.above, 3],
      [this.below, 3.5],
    ] as const) {
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.group.add(mesh);
    }
  }

  /**
   * Make and draw a seed's strokes (again if the wind turns, or the count, range, height or twist change: a moment
   * after the last change, so a slider's drag does not make them at every step) and the ground's height (once a
   * seed), then set the layer for now: its height (at once) and density (the panel's sliders), its drift, which
   * clouds are above the camera (at `altitude`, m over the radius) and which below.
   */
  update(renderer: WebGLRenderer, seed: number, field: PlanetField, R: number, time: number, speed: number, windAxis: Vector3, altitude: number, count: number, range: number, height: number, density: number, twist: number): void {
    if (seed !== this.groundFor) {
      this.bakeGround(field);
      this.groundFor = seed;
    }
    const now = performance.now();
    const wanted = `${count}/${range}/${height}/${twist}`;
    if (wanted !== this.wanted) {
      this.wanted = wanted;
      this.changedAt = now;
    }
    if (seed !== this.bakedFor || this.bakedAxis.dot(windAxis) < 0.9999 || (now - this.changedAt > 300 && wanted !== this.baked)) {
      this.bakeStrokes(renderer, seed, R, windAxis, count, range, height, twist);
      this.bakedFor = seed;
      this.bakedAxis.copy(windAxis);
      this.baked = wanted;
    }
    (this.uniforms.uMistLayer.value as Vector4).set(height, 0, OFFSET, density);
    // (the strokes' space turned back about the wind's axis as far as the wind has carried them: they go with it)
    const angle = (time * (0.4 + 3.2 * speed) * MIST.drift) / (R + height);
    (this.uniforms.uMistDrift.value as Matrix3).setFromMatrix4(this.turn.makeRotationAxis(windAxis, -angle));
    // (the clouds above the camera drawn first, the highest first; then those below it, the lowest first)
    let below = 0;
    while (below < this.heights.length && height + this.heights[below] <= altitude) below++;
    const total = this.ends.length > 0 ? this.ends[this.ends.length - 1] : 0;
    const split = below > 0 ? this.ends[below - 1] : 0;
    this.below.geometry.setDrawRange(0, split);
    this.above.geometry.setDrawRange(0, total - split);
  }

  /** The strokes, made (mistStrokes.ts) and drawn into the cube maps a face at a time, and as ribbons (mistRibbons.ts). */
  private bakeStrokes(renderer: WebGLRenderer, seed: number, R: number, windAxis: Vector3, count: number, range: number, height: number, twist: number): void {
    const previous = renderer.getRenderTarget();
    const shell = R + height;
    // (how far the layer's sphere clears the ground, read from the ground's raster as the mist's paint reads it)
    const clearance = (d: readonly number[]): number => height - this.groundAt(d);
    const made = makeStrokes({ ...MIST, strokes: count, range, twist }, hash32((seed + 0x3157) >>> 0), shell, [windAxis.x, windAxis.y, windAxis.z], clearance);
    const ribbons = ribbonMesh(made, shell, RIM);
    this.setRibbons(ribbons);
    this.strokes = { clouds: made.clouds, strokes: made.strokes, children: made.children, segments: made.count, area: Math.round(made.area), triangles: ribbons.ascending.length / 3 };
    const segments = new InstancedInterleavedBuffer(made.data, 8, 1);
    const quads = new InstancedBufferGeometry();
    quads.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quads.setIndex([0, 1, 2, 0, 2, 3]);
    quads.setAttribute('aA', new InterleavedBufferAttribute(segments, 3, 0));
    quads.setAttribute('aB', new InterleavedBufferAttribute(segments, 3, 3));
    quads.setAttribute('aH', new InterleavedBufferAttribute(segments, 2, 6));
    quads.setAttribute('aIds', new InstancedBufferAttribute(ribbons.segments, 2));
    quads.instanceCount = made.count;
    const was = this.bakeMesh.geometry;
    this.bakeMesh.geometry = quads;
    this.bake.uniforms.uShell.value = shell;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const [target, material] of [
      [this.bands, this.bake],
      [this.owners, this.bakeOwners],
    ] as const) {
      this.bakeMesh.material = material;
      for (let f = 0; f < 6; f++) {
        (this.bake.uniforms.uCubeFace.value as Matrix3).copy(FACES[f]);
        renderer.setRenderTarget(target, f);
        renderer.clear(true, target === this.owners, false);
        if (made.count > 0) renderer.render(this.bakeScene, this.camera);
      }
    }
    renderer.setClearColor(this.clearColor, clearAlpha);
    this.bakeMesh.material = this.bake;
    this.bakeMesh.geometry = was;
    quads.dispose();
    renderer.setRenderTarget(previous);
  }

  /** The ribbons' mesh, for both draws (the same vertices, the clouds in each's order). */
  private setRibbons(mesh: RibbonMesh): void {
    const position = new Float32BufferAttribute(mesh.position, 3);
    const ribbon = new Float32BufferAttribute(mesh.ribbon, 3);
    const owner = new Float32BufferAttribute(mesh.owner, 2);
    for (const [draw, index] of [
      [this.above, mesh.descending],
      [this.below, mesh.ascending],
    ] as const) {
      draw.geometry.dispose();
      const g = new BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('aRibbon', ribbon);
      g.setAttribute('aOwner', owner);
      g.setIndex(new BufferAttribute(index, 1));
      draw.geometry = g;
    }
    this.heights = mesh.heights;
    this.ends = new Uint32Array(mesh.counts.length);
    let at = 0;
    for (let i = 0; i < mesh.counts.length; i++) {
      at += mesh.counts[i];
      this.ends[i] = at;
    }
    gpuMemory.set('mist ribbons', mesh.position.byteLength + mesh.ribbon.byteLength + mesh.owner.byteLength + 2 * mesh.ascending.byteLength);
  }

  /** The ground's height (m over the radius) on a raster a cube face, the six stacked (mist.glsl mistGround reads it). */
  private bakeGround(field: PlanetField): void {
    const data = this.ground.image.data as Uint16Array;
    const d = new Vector3();
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j < GROUND; j++) {
        for (let i = 0; i < GROUND; i++) {
          const u = (2 * (i + 0.5)) / GROUND - 1;
          const v = (2 * (j + 0.5)) / GROUND - 1;
          if (face === 0) d.set(1, u, v);
          else if (face === 1) d.set(-1, u, v);
          else if (face === 2) d.set(u, 1, v);
          else if (face === 3) d.set(u, -1, v);
          else if (face === 4) d.set(u, v, 1);
          else d.set(u, v, -1);
          d.normalize();
          const k = (face * GROUND + j) * GROUND + i;
          const h = field.height(d.x, d.y, d.z);
          data[k] = DataUtils.toHalfFloat(h);
          this.groundCpu[k] = h;
        }
      }
    }
    this.ground.needsUpdate = true;
  }

  /** The ground's raster at a direction, bilinear between its texels' middles, as mist.glsl mistGround reads it (m over the radius). */
  private groundAt(d: readonly number[]): number {
    const [x, y, z] = d;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    let face: number;
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) [face, u, v] = [x > 0 ? 0 : 1, y / ax, z / ax];
    else if (ay >= az) [face, u, v] = [y > 0 ? 2 : 3, x / ay, z / ay];
    else [face, u, v] = [z > 0 ? 4 : 5, x / az, y / az];
    const fx = Math.min(Math.max(((u + 1) / 2) * GROUND - 0.5, 0), GROUND - 1.001);
    const fy = Math.min(Math.max(((v + 1) / 2) * GROUND - 0.5, 0), GROUND - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const g = this.groundCpu;
    const k00 = (face * GROUND + j) * GROUND + i;
    const k01 = k00 + GROUND;
    return (g[k00] * (1 - tx) + g[k00 + 1] * tx) * (1 - ty) + (g[k01] * (1 - tx) + g[k01 + 1] * tx) * ty;
  }
}
