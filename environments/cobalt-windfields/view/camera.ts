import { CameraRig as SharedCameraRig } from '../../../src/view/camera';
import type { PerspectiveCamera, Vector3 } from 'three';

/** Lower the lens for small wildlife while retaining the shared navigation rig. */
export class CameraRig extends SharedCameraRig {
  detailEyeHeight = 1.6;

  override framing(z: number): { altitude: number; tilt: number; fov: number } {
    const frame = super.framing(z);
    frame.altitude *= Math.pow(this.detailEyeHeight / 1.6, z);
    return frame;
  }

  override get altitude(): number { return this.framing(this.zoom).altitude; }

  override place(out: PerspectiveCamera, up: Vector3, forward: Vector3, z: number, pitch: number, radius: number, ground: number, aspect: number): number {
    const normalHeight = super.place(out, up, forward, z, pitch, radius, ground, aspect);
    const height = normalHeight * Math.pow(this.detailEyeHeight / 1.6, z);
    out.position.addScaledVector(up, height - normalHeight);
    out.near = Math.max(0.02, Math.min(height * 0.2, 0.5 * radius));
    out.far = height + radius * 3;
    out.updateProjectionMatrix();
    out.updateMatrixWorld();
    return height;
  }
}
