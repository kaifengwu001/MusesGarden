import { Color, HalfFloatType, LinearFilter, Matrix4, PerspectiveCamera, Plane, Vector3, Vector4, WebGLRenderTarget, type IUniform, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { gpuMemory } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import { warpNormal, warpPoint, type WarpFrame } from '../../../src/render/warp';
import type { Terrain } from '../planet/terrain';

/** A local basin mirror. The globe uses the sky reflection; ground views reflect actual scene geometry. */
export class PoolReflection {
  readonly target = new WebGLRenderTarget(1024, 768, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true, generateMipmaps: false });
  readonly uniforms = {
    uPoolMirror: { value: this.target.texture },
    uPoolMirrorMatrix: { value: new Matrix4() },
    uPoolMirrorStrength: { value: 0 },
    uPoolMirrorCentre: { value: new Vector3() },
  } satisfies Record<string, IUniform>;
  private readonly camera = new PerspectiveCamera();
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private readonly direction = new Vector3();
  private readonly right = new Vector3();
  private readonly look = new Vector3();
  private readonly plane = new Plane();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly clear = new Color();
  private readonly visibility: Array<readonly [Object3D, boolean]> = [];

  constructor() {
    this.target.texture.name = 'Lantern basin geometry reflection';
    gpuMemory.set('lantern basin reflection', 1024 * 768 * 12);
  }

  render(renderer: WebGLRenderer, scene: Scene, source: PerspectiveCamera, terrain: Terrain, warp: WarpFrame, zoom: number, objects: readonly Object3D[]): void {
    // Close walking deliberately exaggerates planet curvature. A single
    // tangent mirror is only credible in the broad garden framing.
    this.uniforms.uPoolMirrorStrength.value = smoothstep(0.43, 0.66, zoom) * (1 - smoothstep(0.89, 0.99, zoom));
    if (this.uniforms.uPoolMirrorStrength.value === 0) return;
    const R = terrain.radius;
    const home = terrain.layout.cottage;
    const forward = terrain.layout.homeBearing;
    this.right.crossVectors(home, forward).normalize();
    // A plane tangent to the authored pool, in the same warped space as the water shader.
    const x = -25, z = 24, angle = Math.asin(Math.min(Math.hypot(x, z) / R, 0.9));
    this.direction.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(this.right, x / Math.hypot(x, z) * Math.sin(angle)).addScaledVector(forward, z / Math.hypot(x, z) * Math.sin(angle)).normalize();
    this.uniforms.uPoolMirrorCentre.value.copy(this.direction);
    this.point.copy(this.direction).multiplyScalar(R);
    warpNormal(warp, this.point, this.direction, this.normal);
    warpPoint(warp, this.point, this.point);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.point);
    if (this.plane.distanceToPoint(source.position) <= 0.1) {
      this.uniforms.uPoolMirrorStrength.value = 0;
      return;
    }
    const camera = this.camera;
    camera.copy(source, false);
    camera.position.copy(source.position).addScaledVector(this.normal, -2 * this.plane.distanceToPoint(source.position));
    source.getWorldDirection(this.look);
    this.look.reflect(this.normal).add(camera.position);
    camera.up.set(0, 1, 0).transformDirection(source.matrixWorld).reflect(this.normal);
    camera.lookAt(this.look);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.projectionMatrix.copy(source.projectionMatrix);
    // Clip the submerged half of swimmers and the foot of each stone at the common water level.
    this.plane.applyMatrix4(camera.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = camera.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + e[8]) / e[0], (Math.sign(this.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x; e[6] = this.clip.y; e[10] = this.clip.z + 1 - 0.003; e[14] = this.clip.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.uniforms.uPoolMirrorMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const previous = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    const autoClear = renderer.autoClear;
    this.visibility.length = 0;
    for (const child of scene.children) {
      this.visibility.push([child, child.visible]);
      child.visible = child.visible && objects.includes(child);
    }
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      for (const [object, visible] of this.visibility) object.visible = visible;
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.clear, alpha);
      renderer.setRenderTarget(previous);
    }
  }

  dispose(): void { this.target.dispose(); gpuMemory.set('lantern basin reflection', 0); }
}
