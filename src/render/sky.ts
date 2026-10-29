import { Color, Matrix4, ShaderMaterial, Vector3, type IUniform, type Mesh, type PerspectiveCamera } from 'three';
import { fullscreenMesh } from './fullscreen';
import { ROW, type Palette } from './palette';
import fragmentShader from './sky.frag.glsl?raw';
import vertexShader from './sky.vert.glsl?raw';

/**
 * Gradient sky drawn first on a fullscreen triangle: a backdrop behind the
 * planet in Overview, a dome with the sun and the high cloud deck in Wander
 * (the deck whose shadows cross the meadow; cloudShadow.glsl). Colours come
 * from the palette, so the sky moves with the time of day.
 */
/** World uniforms the sky reads (the cloud deck and what it depends on). */
const SHARED = ['uRadius', 'uTerrainSeed', 'uWindVec', 'uCloudShadows', 'uCloudAxes', 'uCloudTops', 'uCloudLook', 'uCloudDeck', 'uCloudDrift'] as const;
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
    uCloudLit: { value: new Color() },
    uCloudShade: { value: new Color() },
    /** 0: backdrop behind the planet (Overview), 1: dome around the viewer (Wander). */
    uDome: { value: 0 },
  };

  constructor(shared: Record<string, IUniform>) {
    const uniforms: Record<string, IUniform> = { ...this.uniforms };
    for (const key of SHARED) uniforms[key] = shared[key];
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

  update(camera: PerspectiveCamera, palette: Palette, skyUp: Vector3, sun: Vector3, dome: number): void {
    const u = this.uniforms;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    palette.get(ROW.SKY, 0, u.uZenith.value);
    palette.get(ROW.SKY, 1, u.uHorizon.value);
    palette.get(ROW.SKY, 2, u.uHaze.value);
    palette.get(ROW.SKY, 3, u.uSunGlow.value);
    palette.get(ROW.CLOUD, 0, u.uCloudLit.value);
    palette.get(ROW.CLOUD, 1, u.uCloudShade.value);
    u.uSkyUp.value.copy(skyUp);
    u.uSun.value.copy(sun);
    u.uDome.value = dome;
  }
}
