import { Color, Matrix4, NormalBlending, ShaderMaterial, Vector4, type Mesh, type PerspectiveCamera } from 'three';
import { hash32, unit } from '../core/hash';
import { fullscreenMesh } from '../render/fullscreen';
import type { Palette } from '../render/palette';
import vertexShader from '../render/sky.vert.glsl?raw';
import fragmentShader from './backdrop.frag.glsl?raw';
import { TROW } from './palette';

// The backdrop round the terraces (backdrop.frag.glsl): the planet painting's
// sea of mist with karst towers standing up out of it all round the frame,
// painted on the frame behind the planet (as the sky's own backdrop is from
// orbit), over the sky and under everything else (at the far plane: the
// planet hides it), fading out as the view comes down to stand on the planet.

/** The towers: in three ranks, back to front (count per rank), the mist's drift (frame units per s). */
export const BACKDROP = { ranks: [14, 14, 12], drift: 0.006 } as const;

export class Backdrop {
  readonly mesh: Mesh;
  private readonly uniforms = {
    uInvProjection: { value: new Matrix4() },
    uCameraWorld: { value: new Matrix4() },
    uBackFrame: { value: new Vector4(1, 0, 0, 1) },
    uTowers: { value: Array.from({ length: 40 }, () => new Vector4()) },
    uMistLit: { value: new Color() },
    uMistShade: { value: new Color() },
    uMistDeep: { value: new Color() },
    uTowerNear: { value: new Color() },
    uTowerFar: { value: new Color() },
  };

  constructor(seed: number) {
    const material = new ShaderMaterial({ name: 'terraces backdrop', vertexShader, fragmentShader, uniforms: this.uniforms, depthTest: true, depthWrite: false, transparent: true, blending: NormalBlending });
    this.mesh = fullscreenMesh(material);
    this.mesh.renderOrder = -999;
    // the towers: spread across the frame (wider than any screen), the ranks behind smaller and higher up it
    let h = hash32((seed ^ 0xbac4d) >>> 0);
    const rand = (): number => unit((h = hash32((h + 0x9e3779b9) >>> 0)));
    let i = 0;
    BACKDROP.ranks.forEach((count, rank) => {
      for (let k = 0; k < count; k++) {
        const x = -1.9 + (3.8 * (k + 0.2 + 0.6 * rand())) / count;
        const scale = 0.55 + 0.25 * rank;
        const foot = -0.2 + 0.5 * (1 - rank / 2) * rand() - 0.55 * rank * rand();
        const tall = (0.25 + 0.45 * rand() ** 1.4) * scale;
        this.uniforms.uTowers.value[i++].set(x, foot, foot + tall, tall * (0.2 + 0.12 * rand()));
      }
    });
  }

  /** Each frame: the camera, the frame's aspect, the time (s), how much shows (1 from orbit … 0 standing). */
  update(camera: PerspectiveCamera, palette: Palette, time: number, amount: number): void {
    const u = this.uniforms;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    u.uBackFrame.value.set(camera.aspect, 0, time * BACKDROP.drift, amount);
    // (the painting's cloud sea a mid grey-blue, #94A1B7, its puffs paler; its towers #70849F, the far ones paler)
    palette.get(TROW.FOG, 1, u.uMistLit.value);
    palette.get(TROW.FOG, 2, u.uMistShade.value);
    palette.get(TROW.FOG, 2, u.uMistDeep.value).multiplyScalar(0.88);
    palette.get(TROW.PEAK, 0, u.uTowerNear.value);
    palette.get(TROW.PEAK, 1, u.uTowerFar.value);
  }
}
