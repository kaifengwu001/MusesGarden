import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  HalfFloatType,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix3,
  Mesh,
  OrthographicCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../../../src/core/gpuMemory';
import type { CloudUniforms } from './clouds';
import shadowVertex from '../../../src/life/cloudShadow.vert.glsl?raw';
import shadowFragment from '../../../src/life/cloudShadow.frag.glsl?raw';

// The clouds' own shadows, apart from everything else their map holds (the
// trees, the bank stones, Muse, its neighbours and the birds cast into it
// too): the same puffs splatted down the sun into a small cube map of their
// own, so the snow can take a cloud's shadow in blue while every other
// shadow stays as it was. Drawn after the clouds' passes (clouds.ts), from
// the same cloud data, on the faces in sight; read by cloudCover.glsl.

const PUFFS = 8;
/** The cube faces (the GL convention, as clouds.ts): across, up, out. */
const FACES = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
].map(([u, v, m]) => new Matrix3().set(u.x, v.x, m.x, u.y, v.y, m.y, u.z, v.z, m.z));
const FACE_AXES = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
const FACE_REACH = Math.acos(1 / Math.sqrt(3));

export interface CloudCoverUniforms {
  /** The clouds' optical depth where their shadows reach the water table. */
  uCloudCoverCube: IUniform<Texture | null>;
  /** How blue the snow turns in a cloud's shadow (0: no clouds), the clouds' optical density (1/m), -, -. */
  uCloudSnow: IUniform<Vector4>;
}

export function createCloudCoverUniforms(): CloudCoverUniforms {
  return { uCloudCoverCube: { value: null }, uCloudSnow: { value: new Vector4() } };
}

export class CloudCover {
  private readonly cube: WebGLCubeRenderTarget;
  private readonly scene: Scene;
  private readonly geometry = new InstancedBufferGeometry();
  private readonly camera = new OrthographicCamera();
  private readonly face = { value: new Matrix3() };
  private readonly clearColour = new Color();
  /** Whether the faces hold nothing (cleared once the clouds are gone). */
  private empty = false;

  constructor(
    private readonly clouds: CloudUniforms,
    shared: Record<string, IUniform>,
    readonly uniforms: CloudCoverUniforms,
    size: number,
  ) {
    this.cube = new WebGLCubeRenderTarget(size, { type: HalfFloatType, format: RedFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
    gpuMemory.set('cloud cover on the snow', 6 * size * size * 2);
    uniforms.uCloudCoverCube.value = this.cube.texture;
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      name: 'cloud cover on the snow',
      vertexShader: shadowVertex,
      fragmentShader: shadowFragment,
      uniforms: {
        uCloudData: clouds.uCloudData,
        uCloudLook: clouds.uCloudLook,
        uCloudLumps: clouds.uCloudLumps,
        // (a face of its own: the clouds' passes keep theirs)
        uCubeFace: this.face,
        uFaceWindow: { value: new Vector3(0, 0, 1) },
        uTime: shared.uTime,
        uRadius: shared.uRadius,
        uSunAngles: shared.uSunAngles,
      },
      side: DoubleSide,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    this.scene = new Scene().add(mesh);
  }

  /**
   * Splat this frame's clouds (clouds.ts has just placed them) into the faces
   * that hold ground in sight: within `seen` (rad) of `focus`. `blue`: how blue
   * the snow turns under a cloud.
   */
  update(renderer: WebGLRenderer, focus: Vector3, seen: number, blue: number): void {
    const look = this.clouds.uCloudLook.value;
    const n = look.z;
    this.uniforms.uCloudSnow.value.set(n > 0 ? blue : 0, look.y, 0, 0);
    if (n <= 0 && this.empty) return;
    this.geometry.instanceCount = n * PUFFS;
    const previous = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColour);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    FACES.forEach((face, f) => {
      if (n > 0 && Math.acos(Math.max(-1, Math.min(1, FACE_AXES[f].dot(focus)))) > seen + FACE_REACH) return;
      this.face.value.copy(face);
      renderer.setRenderTarget(this.cube, f);
      renderer.clear(true, false, false);
      if (n > 0) renderer.render(this.scene, this.camera);
    });
    this.empty = n <= 0;
    renderer.setClearColor(this.clearColour, clearAlpha);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.cube.dispose();
    this.geometry.dispose();
  }
}
