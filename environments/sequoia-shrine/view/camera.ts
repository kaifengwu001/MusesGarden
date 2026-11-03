import type { PerspectiveCamera, Vector3 } from 'three';
import { clamp, smoothstep } from '../../../src/core/math';
import { CameraRig as SharedCameraRig } from '../../../src/view/camera';

/** The farthest orbit (zoom 0, where Overview and Whole planet open) stands this much higher than the shared rig's. */
const ORBIT_REACH = 1.3;
/** The extra height is gone by this zoom, so the bird's-eye, standing and eye-level views are the shared rig's. */
const ORBIT_EASE = 0.15;

const reach = (z: number): number => 1 + (ORBIT_REACH - 1) * (1 - smoothstep(0, ORBIT_EASE, z));

/** The shared navigation rig, with an orbit that stands farther out over the tall forest. */
export class CameraRig extends SharedCameraRig {
  override framing(z: number): { altitude: number; tilt: number; fov: number } {
    const frame = super.framing(z);
    frame.altitude *= reach(z);
    return frame;
  }

  override get altitude(): number { return this.framing(this.zoom).altitude; }

  override place(out: PerspectiveCamera, up: Vector3, forward: Vector3, z: number, pitch: number, radius: number, ground: number, aspect: number): number {
    const shared = super.place(out, up, forward, z, pitch, radius, ground, aspect);
    const height = shared * reach(z);
    out.position.addScaledVector(up, height - shared);
    out.near = clamp(height * 0.2, 0.05, 0.5 * radius);
    out.far = height + radius * 3;
    out.updateProjectionMatrix();
    out.updateMatrixWorld();
    return height;
  }
}
