import { Color, Matrix4, ShaderMaterial, Vector3, type Mesh, type PerspectiveCamera } from 'three';
import { fullscreenMesh } from './fullscreen';
import fragmentShader from './sky.frag.glsl?raw';
import vertexShader from './sky.vert.glsl?raw';

/**
 * Gradient sky drawn first on a fullscreen triangle. Colours are the brief's
 * by-eye values until the palette texture takes over (S2), which also adds the
 * sun and aerial perspective.
 */
export class Sky {
  readonly mesh: Mesh;
  private readonly uniforms = {
    uInvProjection: { value: new Matrix4() },
    uCameraWorld: { value: new Matrix4() },
    uZenith: { value: new Color('#2F7CC4') },
    uHorizon: { value: new Color('#A9D3EE') },
    uHaze: { value: new Color('#D3E8EF') },
    uSkyUp: { value: new Vector3(0, 1, 0) },
    /** 0: backdrop behind the planet (Overview), 1: dome around the viewer (Wander). */
    uDome: { value: 0 },
  };

  constructor() {
    const material = new ShaderMaterial({
      name: 'sky',
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = fullscreenMesh(material);
    this.mesh.renderOrder = -1000;
  }

  update(camera: PerspectiveCamera, skyUp: Vector3, dome: number): void {
    this.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    this.uniforms.uSkyUp.value.copy(skyUp);
    this.uniforms.uDome.value = dome;
  }
}
