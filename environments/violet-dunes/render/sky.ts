import { Color, Matrix4, ShaderMaterial, Vector3, type IUniform, type Mesh, type PerspectiveCamera } from 'three';
import { fullscreenMesh } from '../../../src/render/fullscreen';
import { ROW, type Palette } from './palette';
import fragmentShader from './sky.frag.glsl?raw';
import vertexShader from '../../../src/render/sky.vert.glsl?raw';

/**
 * Gradient sky drawn first on a fullscreen triangle: a backdrop behind the
 * planet in Overview, a dome with the sun in Wander. Colours come from the
 * palette; the clouds are drawn over it (clouds.ts).
 */
export class Sky {
  readonly mesh: Mesh;
  private readonly uniforms = {
    uInvProjection: { value: new Matrix4() },
    uCameraWorld: { value: new Matrix4() },
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uHaze: { value: new Color() },
    uSunGlow: { value: new Color() },
    uSkyUp: { value: new Vector3(0, 1, 0) },
    uSun: { value: new Vector3(0, 1, 0) },
    uSkyGrain: { value: new Vector3(1, 0, 0) },
    uCloudTint: { value: new Color() },
    /** 0: backdrop behind the planet (Overview), 1: dome around the viewer (Wander). */
    uDome: { value: 0 },
  };

  constructor() {
    const uniforms: Record<string, IUniform> = { ...this.uniforms };
    const material = new ShaderMaterial({
      name: 'sky',
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = fullscreenMesh(material);
    this.mesh.renderOrder = -1000;
  }

  update(camera: PerspectiveCamera, palette: Palette, skyUp: Vector3, sun: Vector3, dome: number, grain: Vector3): void {
    const u = this.uniforms;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    palette.get(ROW.SKY, 0, u.uZenith.value);
    palette.get(ROW.SKY, 1, u.uHorizon.value);
    palette.get(ROW.SKY, 2, u.uHaze.value);
    palette.get(ROW.SKY, 3, u.uSunGlow.value);
    u.uSkyUp.value.copy(skyUp);
    u.uSun.value.copy(sun);
    u.uDome.value = dome;
    u.uSkyGrain.value.copy(grain);
    palette.get(ROW.CLOUD, 1, u.uCloudTint.value);
  }
}
