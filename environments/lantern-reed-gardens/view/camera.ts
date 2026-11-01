import type { Vector3 } from 'three';
import { CameraRig as SharedCameraRig } from '../../../src/view/camera';

const MAX_PITCH = Math.PI / 2;

/** Lantern's shared views include the named view's pitch as well as its frame and zoom. */
export class CameraRig extends SharedCameraRig {
  private requestedPitch = 0;

  override lookUp(angle: number, immediate = true): void {
    this.requestedPitch = angle;
    super.lookUp(angle, immediate);
  }

  override poseString(): string {
    return `${super.poseString()},${Number(this.requestedPitch.toFixed(6))}`;
  }

  /** Five-number meadow links remain valid; new links add a bounded pitch in radians. */
  override applyPose(text: string): boolean {
    const parts = text.split(',');
    if ((parts.length !== 5 && parts.length !== 6) || parts.some(part => part.trim() === '')) return false;
    const values = parts.map(Number);
    if (values.some(value => !Number.isFinite(value))) return false;
    const length = Math.hypot(...values.slice(0, 4));
    const pitch = values[5] ?? 0;
    if (!Number.isFinite(length) || length < 1e-12 || Math.abs(pitch) > MAX_PITCH) return false;

    // Normalize before passing through the shared parser, avoiding squared-length
    // overflow for otherwise finite input. Reject everything before changing state.
    const pose = [...values.slice(0, 4).map(value => value / length), values[4]].join(',');
    if (!super.applyPose(pose)) return false;
    this.lookUp(pitch);
    return true;
  }

  override drag(dx: number, dy: number, width: number, height: number): void {
    this.requestedPitch = 0;
    super.drag(dx, dy, width, height);
  }

  override zoomBy(delta: number): void {
    this.requestedPitch = 0;
    super.zoomBy(delta);
  }

  override walk(ahead: number, across: number): void {
    if (ahead !== 0 || across !== 0) this.requestedPitch = 0;
    super.walk(ahead, across);
  }

  override turn(angle: number): void {
    if (angle !== 0) this.requestedPitch = 0;
    super.turn(angle);
  }

  override glideTo(dir: Vector3): void {
    this.requestedPitch = 0;
    super.glideTo(dir);
  }
}
