import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/math';

// One camera for the whole range, driven by a single zoom value z ∈ [0, 1]:
//
//   z = 0  Overview: the whole planet, looking at its centre, FOV 35°
//   z = 1  Wander:   a glide 1.6 m above the grass, looking at the horizon, FOV 55°
//
// The camera rides a surface frame (up = local vertical at the focus F,
// forward, right) stored as a quaternion, so there are no poles. Altitude is
// log-interpolated; tilt toward the horizon, FOV and the tiny-planet warp
// weight all ramp in over the lower part of the range.

export const EYE_HEIGHT = 1.6;
const OVERVIEW_ALTITUDE = 4.2; // × R
const MAX_TILT = (82 * Math.PI) / 180;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const NZ = new Vector3(0, 0, -1);
const tmpQ = new Quaternion();
const tmpV = new Vector3();

export type GroundFn = (dir: Vector3) => number;

export class CameraRig {
  readonly camera = new PerspectiveCamera(35, 1, 0.1, 1e5);
  /** Surface frame of the focus point (target and smoothed current). */
  readonly frame = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.32).premultiply(new Quaternion().setFromAxisAngle(Y, 0.52));
  private readonly frameTarget = this.frame.clone();
  zoom = 0;
  private zoomTarget = 0;
  /** Smoothed ground height under the focus, m. */
  private ground = 0;
  private radius = 128;
  /** Overview altitude in R: the planet's disc fits the narrower field-of-view axis. */
  private overviewAltitude = OVERVIEW_ALTITUDE;
  /** Glide in progress (double-click): start, end, progress. */
  private glideStart = new Quaternion();
  private glideEnd = new Quaternion();
  private glideT = 1;

  readonly up = new Vector3(0, 1, 0);
  readonly forward = new Vector3(0, 0, -1);
  readonly right = new Vector3(1, 0, 0);
  /** Focus point on the surface, planet space. */
  readonly focus = new Vector3();
  /** True when the pose changed since the last `consumeChange`. */
  private changed = false;
  /**
   * A look up toward the horizon on top of the zoom's tilt (rad), which a
   * named view sets to frame what it shows; it eases away as soon as you
   * drag, zoom, walk or glide, back to the zoom's own tilt.
   */
  private pitch = 0;
  private pitchTarget = 0;

  /** Altitude (m), tilt from straight down (rad) and vertical field of view (°) at zoom z. */
  framing(z: number): { altitude: number; tilt: number; fov: number } {
    const top = this.overviewAltitude * this.radius;
    const t = smoothstep(0.3, 1, z);
    return { altitude: top * Math.pow(EYE_HEIGHT / top, z), tilt: MAX_TILT * t, fov: lerp(35, 55, t) };
  }

  /** The zoom at which the camera stands `altitude` m over the ground. */
  zoomForAltitude(altitude: number): number {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const z = (lo + hi) / 2;
      if (this.framing(z).altitude > altitude) lo = z;
      else hi = z;
    }
    return (lo + hi) / 2;
  }

  get altitude(): number {
    const top = this.overviewAltitude * this.radius;
    return top * Math.pow(EYE_HEIGHT / top, this.zoom);
  }

  /** 0 in Overview → 1 in Wander: tilt toward the horizon and the FOV ramp. */
  get tilt(): number {
    return smoothstep(0.3, 1, this.zoom);
  }

  get mode(): 'overview' | 'wander' {
    return this.zoomTarget >= 0.5 ? 'wander' : 'overview';
  }

  /**
   * Drag by (dx, dy) pixels in a viewport of the given size. Both axes hold
   * the scene: drag down and the meadow comes toward you (you glide forward),
   * drag right and it swings right (you turn left), as in a street-view panorama.
   */
  drag(dx: number, dy: number, width: number, height: number): void {
    this.pitchTarget = 0;
    const t = this.tilt;
    const perPixel = (0.75 * (this.altitude + 8)) / (this.radius * height);
    this.axes(this.frameTarget);
    // vertical: roll the planet about the right axis (glide forward / back), quicker down in the meadow
    this.rotate(this.right, -dy * perPixel * (1 + 0.7 * t));
    // horizontal: spin the globe (Overview) blending into turning on the spot (Wander)
    if (t < 1) this.rotate(this.forward, -dx * perPixel * (1 - t));
    if (t > 0) this.rotate(this.up, (dx * Math.PI * 0.9 * t) / width);
    this.glideT = 1;
    this.changed = true;
  }

  /** Walking speed for the keys (m/s): a brisk pace in the meadow, faster higher up. */
  get walkSpeed(): number {
    return 4 + 0.35 * this.altitude;
  }

  /** Move over the surface by `ahead` and `across` meters along the current heading (keys). */
  walk(ahead: number, across: number): void {
    if (ahead === 0 && across === 0) return;
    this.pitchTarget = 0;
    this.axes(this.frameTarget);
    this.rotate(this.right, -ahead / this.radius);
    this.rotate(this.forward, across / this.radius);
    this.glideT = 1;
    this.changed = true;
  }

  /** Turn on the spot by `angle` (rad; positive turns left). */
  turn(angle: number): void {
    if (angle === 0) return;
    this.pitchTarget = 0;
    this.axes(this.frameTarget);
    this.rotate(this.up, angle);
    this.glideT = 1;
    this.changed = true;
  }

  zoomBy(delta: number): void {
    this.pitchTarget = 0;
    this.zoomTarget = clamp(this.zoomTarget + delta, 0, 1);
    this.changed = true;
  }

  setZoom(z: number, immediate = false): void {
    this.zoomTarget = clamp(z, 0, 1);
    if (immediate) this.zoom = this.zoomTarget;
    this.changed = true;
  }

  /** Glide the focus to a direction on the planet over ~1.6 s. */
  /** Look up by `angle` (rad) from the zoom's tilt until the next move (named views). */
  lookUp(angle: number, immediate = true): void {
    this.pitchTarget = angle;
    if (immediate) this.pitch = angle;
    this.changed = true;
  }

  glideTo(dir: Vector3): void {
    this.pitchTarget = 0;
    this.axes(this.frameTarget);
    tmpQ.setFromUnitVectors(this.up, tmpV.copy(dir).normalize());
    this.glideStart.copy(this.frameTarget);
    this.glideEnd.copy(tmpQ).multiply(this.frameTarget);
    this.glideT = 0;
    this.changed = true;
  }

  /** Place the focus at `dir`, facing along tangent `forward`: at once, or by gliding there. */
  lookAlong(dir: Vector3, forward: Vector3, immediate = true): void {
    const up = tmpV.copy(dir).normalize();
    const right = new Vector3().crossVectors(forward, up).normalize();
    const fwd = new Vector3().crossVectors(up, right);
    // columns: right (x), up (y), back (z = -forward)
    const m = new Matrix4().makeBasis(right, up, fwd.negate());
    this.frameTarget.setFromRotationMatrix(m);
    if (immediate) {
      this.frame.copy(this.frameTarget);
      this.axes(this.frame);
    }
    this.glideT = 1;
    this.changed = true;
  }

  update(realDt: number, radius: number, aspect: number, ground: GroundFn): void {
    this.radius = radius;
    // portrait screens: keep the whole planet in frame (disc ≤ 80 % of the narrow axis)
    const halfV = (35 * Math.PI) / 360;
    const halfH = Math.atan(aspect * Math.tan(halfV));
    this.overviewAltitude = Math.max(OVERVIEW_ALTITUDE, 1 / Math.sin(0.8 * Math.min(halfV, halfH)) - 1);
    if (this.glideT < 1) {
      this.glideT = Math.min(1, this.glideT + realDt / 1.6);
      const e = smoothstep(0, 1, this.glideT);
      this.frameTarget.slerpQuaternions(this.glideStart, this.glideEnd, e);
    }
    this.frame.slerp(this.frameTarget, damp(realDt, 0.09)).normalize();
    this.zoom += (this.zoomTarget - this.zoom) * damp(realDt, 0.16);
    if (Math.abs(this.zoomTarget - this.zoom) < 1e-5) this.zoom = this.zoomTarget;
    this.axes(this.frame);

    const g = ground(this.up);
    this.ground = Number.isFinite(this.ground) ? this.ground + (g - this.ground) * damp(realDt, 0.12) : g;
    this.focus.copy(this.up).multiplyScalar(radius + this.ground);

    this.pitch += (this.pitchTarget - this.pitch) * damp(realDt, 0.25);
    const tilt = Math.min(MAX_TILT * this.tilt + this.pitch, Math.PI / 2 - 0.02);
    const alt = this.altitude;
    const cam = this.camera;
    cam.position.copy(this.up).multiplyScalar(radius + this.ground + alt);
    cam.up.copy(this.forward).multiplyScalar(Math.cos(tilt)).addScaledVector(this.up, Math.sin(tilt));
    tmpV.copy(this.up).multiplyScalar(-Math.cos(tilt)).addScaledVector(this.forward, Math.sin(tilt));
    cam.lookAt(tmpV.add(cam.position));
    cam.fov = lerp(35, 55, this.tilt);
    cam.aspect = aspect;
    cam.near = clamp(alt * 0.2, 0.05, 0.5 * radius);
    cam.far = alt + radius * 3;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** True once after any pose change (for URL sync). */
  consumeChange(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  isSettled(): boolean {
    return this.glideT >= 1 && this.zoom === this.zoomTarget && this.frame.angleTo(this.frameTarget) < 1e-5;
  }

  /** Snap to the targets (deterministic captures). */
  settle(): void {
    this.glideT = 1;
    this.frame.copy(this.frameTarget);
    this.zoom = this.zoomTarget;
    this.ground = Number.NaN;
  }

  poseString(): string {
    const q = this.frameTarget;
    return [q.x, q.y, q.z, q.w, this.zoomTarget].map((v) => String(Number(v.toFixed(4)))).join(',');
  }

  applyPose(text: string): boolean {
    const v = text.split(',').map(Number);
    if (v.length !== 5 || v.some((x) => !Number.isFinite(x))) return false;
    this.frameTarget.set(v[0], v[1], v[2], v[3]).normalize();
    this.frame.copy(this.frameTarget);
    this.zoomTarget = this.zoom = clamp(v[4], 0, 1);
    this.glideT = 1;
    return true;
  }

  private axes(q: Quaternion): void {
    this.up.copy(Y).applyQuaternion(q);
    this.forward.copy(NZ).applyQuaternion(q);
    this.right.copy(X).applyQuaternion(q);
  }

  private rotate(axis: Vector3, angle: number): void {
    this.frameTarget.premultiply(tmpQ.setFromAxisAngle(axis, angle)).normalize();
    this.axes(this.frameTarget);
  }
}
