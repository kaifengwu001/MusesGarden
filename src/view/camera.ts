import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/math';

// One camera for the whole range, driven by a single zoom value z ∈ [0, 1]:
//
//   z = 0  Overview: the whole planet, looking at its centre, FOV 35°
//   z = 1  Wander:   a glide 1.6 m above the grass, looking at the horizon, FOV 55°
//
// The wheel and the keys settle on four stops: the two ends, a bird's-eye
// view and a standing view (STOPS_M, chosen by Kai), when you stop zooming
// near one. The stops, and the camera's tilt, go by height in meters, so a
// view 4 m up looks the same on every planet; the zoom's scale between the
// ends does not (it reaches orbit at 4.2 R).
//
// The camera rides a surface frame (up = local vertical at the focus F,
// forward, right) stored as a quaternion, so there are no poles. Altitude is
// log-interpolated; tilt toward the horizon, FOV and the tiny-planet warp
// weight all ramp in over the lower part of the range.

export const EYE_HEIGHT = 1.6;
const OVERVIEW_ALTITUDE = 4.2; // × R
const MAX_TILT = (82 * Math.PI) / 180;
/** Heights (m) at the zoom of a planet of R 128, the reference Kai's views were chosen on. */
const REF_TOP = OVERVIEW_ALTITUDE * 128;
const refHeight = (z: number): number => REF_TOP * Math.pow(EYE_HEIGHT / REF_TOP, z);
/**
 * The heights (m) between which the camera tilts from looking straight down
 * to the horizon, log-spaced (zoom 0.15 to 0.9 at R 128): early, so a
 * bird's-eye view still sees far.
 */
const TILT_HEIGHTS = [refHeight(0.15), refHeight(0.9)] as const;
/**
 * Stops between the ends (height over the ground, m, the same on every
 * planet): a bird's-eye view (zoom 0.35 at R 128: about 70 m up, looking
 * down over the meadow) and a standing view (zoom 0.83 at R 128: about
 * 4.3 m up, looking out across it).
 */
const STOPS_M = [refHeight(0.35), refHeight(0.83)] as const;
/** Zoom settles on a stop when it is left this near one (in z: half a wheel notch), after this long without zooming (s). */
const SNAP = { reach: 0.06, after: 0.18 } as const;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const NZ = new Vector3(0, 0, -1);
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpF = new Vector3();

export type GroundFn = (dir: Vector3) => number;

/** The rig's own pose: its frame, its zoom and its look up (where it is and where it is headed), to come back to. */
export interface RigPose {
  readonly frame: Quaternion;
  readonly zoom: number;
  readonly pitch: number;
  readonly pitchTarget: number;
}

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
  /** Seconds since the last zoom by the wheel or the keys (Infinity: settled). */
  private zoomIdle = Number.POSITIVE_INFINITY;
  /**
   * A view held off the focus (the cutaway into Muse's hut, view/cutaway.ts):
   * the camera at `position` looking at `target` (planet space), its up
   * toward `up`, with a field of view of its own (°). The frame and the zoom
   * still say where the focus is and how high the view stands over it, and
   * the near field, the fog and the light follow them. Null: the rig places
   * the camera itself.
   */
  held: { readonly position: Vector3; readonly target: Vector3; readonly up: Vector3; readonly fov: number } | null = null;
  /** How much of the tiny-planet warp the view takes (1; the cutaway eases it out, so the room stands square). */
  warpScale = 1;

  /** Altitude (m), tilt from straight down (rad) and vertical field of view (°) at zoom z. */
  framing(z: number): { altitude: number; tilt: number; fov: number } {
    const top = this.overviewAltitude * this.radius;
    const t = smoothstep(0.3, 1, z);
    const altitude = top * Math.pow(EYE_HEIGHT / top, z);
    return { altitude, tilt: this.tiltAt(altitude, z), fov: lerp(35, 55, t) };
  }

  /** The camera's tilt from straight down (rad) at a height (m): by height, so the same on every planet (and straight down in orbit). */
  private tiltAt(altitude: number, z: number): number {
    const [hi, lo] = TILT_HEIGHTS;
    const u = (Math.log(hi) - Math.log(Math.max(altitude, 1e-3))) / (Math.log(hi) - Math.log(lo));
    return MAX_TILT * smoothstep(0, 1, u) * smoothstep(0, 0.08, z);
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
    this.zoomIdle = 0;
    this.changed = true;
  }

  /** Settle the zoom on the nearest stop, if it was left near one (SNAP). */
  private snapZoom(): void {
    let best = this.zoomTarget;
    let gap: number = SNAP.reach;
    for (const stop of [0, ...STOPS_M.map((m) => this.zoomForAltitude(m)), 1]) {
      const g = Math.abs(stop - this.zoomTarget);
      if (g < gap) {
        gap = g;
        best = stop;
      }
    }
    this.zoomTarget = best;
  }

  setZoom(z: number, immediate = false): void {
    this.zoomTarget = clamp(z, 0, 1);
    if (immediate) this.zoom = this.zoomTarget;
    this.changed = true;
  }

  /**
   * Hold the camera where it is while the planet's radius goes from r0 to r1 (the unfolding grows it,
   * planet/unfold.ts). In orbit it keeps its distance from the planet's centre, so the planet grows in the window;
   * down over the meadow it keeps its height over the ground, as the stops do; between the bird's-eye height and the
   * height where the view starts to tilt it eases from one to the other. Shrinking, it can come no farther out than
   * the overview.
   */
  holdThrough(r0: number, r1: number): void {
    const keep = (z: number): number => {
      const top0 = this.overviewAltitude * r0;
      const alt0 = top0 * Math.pow(EYE_HEIGHT / top0, z);
      const alt1 = Math.max(EYE_HEIGHT, alt0 - smoothstep(STOPS_M[0], TILT_HEIGHTS[0], alt0) * (r1 - r0));
      const top1 = this.overviewAltitude * r1;
      return clamp(Math.log(alt1 / top1) / Math.log(EYE_HEIGHT / top1), 0, 1);
    };
    this.zoom = keep(this.zoom);
    this.zoomTarget = keep(this.zoomTarget);
    this.changed = true;
  }

  /** Look up by `angle` (rad) from the zoom's tilt until the next move (named views). */
  lookUp(angle: number, immediate = true): void {
    this.pitchTarget = angle;
    if (immediate) this.pitch = angle;
    this.changed = true;
  }

  /** Glide the focus to a direction on the planet over ~1.6 s. */
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

  /**
   * The camera where the rig is headed (the end of a glide, the zoom asked
   * for, a named view's pitch), placed as update() would place it, so what it
   * will see can be built before it gets there. Returns the altitude (m).
   */
  aim(radius: number, ground: GroundFn, out: PerspectiveCamera, up: Vector3): number {
    const q = this.glideT < 1 ? this.glideEnd : this.frameTarget;
    up.copy(Y).applyQuaternion(q);
    const forward = tmpF.copy(NZ).applyQuaternion(q);
    return this.place(out, up, forward, this.zoomTarget, this.pitchTarget, radius, ground(up), this.camera.aspect);
  }

  /**
   * Place a camera as update() does: over the focus frame (up, forward) at zoom z with a look up of
   * `pitch` (rad), on a planet of `radius` whose ground under the focus is `ground` (m). Returns the altitude (m).
   */
  place(out: PerspectiveCamera, up: Vector3, forward: Vector3, z: number, pitch: number, radius: number, ground: number, aspect: number): number {
    const top = this.overviewAltitude * radius;
    const alt = top * Math.pow(EYE_HEIGHT / top, z);
    const tilt = Math.min(this.tiltAt(alt, z) + pitch, Math.PI / 2 - 0.02);
    out.position.copy(up).multiplyScalar(radius + ground + alt);
    out.up.copy(forward).multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt));
    tmpV.copy(up).multiplyScalar(-Math.cos(tilt)).addScaledVector(forward, Math.sin(tilt));
    out.lookAt(tmpV.add(out.position));
    out.fov = lerp(35, 55, smoothstep(0.3, 1, z));
    out.aspect = aspect;
    out.near = clamp(alt * 0.2, 0.05, 0.5 * radius);
    out.far = alt + radius * 3;
    out.updateProjectionMatrix();
    out.updateMatrixWorld();
    return alt;
  }

  /** The zoom the rig is headed to. */
  get zoomAim(): number {
    return this.zoomTarget;
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
    if (this.zoomIdle < SNAP.after) {
      this.zoomIdle += realDt;
      if (this.zoomIdle >= SNAP.after) this.snapZoom();
    }
    this.zoom += (this.zoomTarget - this.zoom) * damp(realDt, 0.16);
    if (Math.abs(this.zoomTarget - this.zoom) < 1e-5) this.zoom = this.zoomTarget;
    this.axes(this.frame);

    const g = ground(this.up);
    this.ground = Number.isFinite(this.ground) ? this.ground + (g - this.ground) * damp(realDt, 0.12) : g;
    this.focus.copy(this.up).multiplyScalar(radius + this.ground);

    this.pitch += (this.pitchTarget - this.pitch) * damp(realDt, 0.25);
    this.place(this.camera, this.up, this.forward, this.zoom, this.pitch, radius, this.ground, aspect);
    if (this.held) this.hold(this.camera, this.held, radius, aspect);
  }

  /** Place a camera as a held view has it. */
  hold(out: PerspectiveCamera, view: NonNullable<CameraRig['held']>, radius: number, aspect: number): void {
    out.position.copy(view.position);
    out.up.copy(view.up);
    out.lookAt(view.target);
    out.fov = view.fov;
    out.aspect = aspect;
    const d = view.position.distanceTo(view.target);
    out.near = clamp(d * 0.1, 0.05, 4);
    out.far = d + radius * 3;
    out.updateProjectionMatrix();
    out.updateMatrixWorld();
  }

  /** The rig's pose as it is headed (the cutaway comes back to it). */
  save(): RigPose {
    return { frame: this.frameTarget.clone(), zoom: this.zoomTarget, pitch: this.pitch, pitchTarget: this.pitchTarget };
  }

  /** Back to a saved pose, at once. */
  restore(pose: RigPose): void {
    this.frameTarget.copy(pose.frame);
    this.frame.copy(pose.frame);
    this.axes(this.frame);
    this.zoomTarget = this.zoom = pose.zoom;
    this.pitch = pose.pitch;
    this.pitchTarget = pose.pitchTarget;
    this.glideT = 1;
    // (the ground under it is taken afresh, as placeAt had it)
    this.ground = Number.NaN;
    this.changed = true;
  }

  /** The camera a saved pose places (as update() would, over ground `ground` m), into `out`. */
  placeAt(out: PerspectiveCamera, pose: RigPose, radius: number, ground: number, aspect: number): PerspectiveCamera {
    const up = tmpV.copy(Y).applyQuaternion(pose.frame).clone();
    const forward = tmpF.copy(NZ).applyQuaternion(pose.frame).clone();
    this.place(out, up, forward, pose.zoom, pose.pitch, radius, ground, aspect);
    return out;
  }

  /** The smoothed ground under the focus (m over R), as the camera stands on it. */
  get groundLevel(): number {
    return this.ground;
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
    if (this.zoomIdle < SNAP.after) {
      this.snapZoom();
      this.zoomIdle = Number.POSITIVE_INFINITY;
    }
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
