import { Matrix4, Quaternion, Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { angleBetween, tangentToward, travel } from '../planet/geo';
import type { CameraRig } from './camera';

// Flights between places on the planet: to a find's bed, a basket's patch,
// Muse or its cottage. The camera's frame turns along the great circle,
// skims the meadow under the clouds (a long hop climbs over them, like a
// bird crossing a valley) and comes down to frame the place: from a
// distance and a height over the place's ground, looking at a point above it,
// with the place a little below the middle of the view. Driven through the
// rig's own controls each frame; any drag, zoom or key ends a flight.

export interface Framing {
  /** The place: a unit direction and its ground's height over R (m). */
  dir: Vector3;
  ground: number;
  /** The camera's distance from it over the ground (m) and its height over the place's ground (m). */
  distance: number;
  height: number;
  /** The height over the place's ground the view centres on (m). */
  aim: number;
  /** Which side to look from: a tangent at the place pointing toward the camera; by default, from where the camera is now. */
  from?: Vector3;
}

type Ground = (dir: Vector3) => number;

const Y = new Vector3(0, 1, 0);
const NZ = new Vector3(0, 0, -1);
/** A hop longer than this (m) goes over the clouds, this high (m) at least. */
const LONG_HOP = 110;
const OVER_CLOUDS = 80;

export class Flight {
  private active = false;
  private t = 0;
  private duration = 1;
  private readonly startFrame = new Quaternion();
  private readonly endFrame = new Quaternion();
  private readonly frame = new Quaternion();
  private startAlt = 1;
  private endAlt = 1;
  private peakAlt = 1;
  private startPitch = 0;
  private endPitch = 0;
  /** The pitch this flight last set (a named view's look up eases away on its own once the flight ends). */
  private pitch = 0;
  private done: (() => void) | null = null;
  private readonly up = new Vector3();
  private readonly forward = new Vector3();

  constructor(private readonly rig: CameraRig) {}

  get flying(): boolean {
    return this.active;
  }

  /** The pose that frames a place: the camera's focus direction and heading, its altitude over the focus's ground, and its look up. */
  pose(f: Framing, radius: number, ground: Ground): { focus: Vector3; forward: Vector3; altitude: number; pitch: number } {
    const R = radius;
    const from = f.from ?? tangentToward(f.dir, this.rig.camera.position.clone().normalize(), new Vector3());
    if (from.lengthSq() < 1e-9 || angleBetween(this.rig.up, f.dir) * R < 0.5) from.copy(tangentToward(f.dir, this.rig.forward.clone().negate().add(f.dir), new Vector3()));
    const focus = travel(f.dir, from, f.distance / R, new Vector3());
    const forward = tangentToward(focus, f.dir, new Vector3());
    const curve = (f.distance * f.distance) / (2 * R);
    const altitude = Math.max(0.6, f.ground + f.height + curve - ground(focus));
    const zoom = this.rig.zoomForAltitude(altitude);
    const { tilt } = this.rig.framing(zoom);
    // the place a little below the middle: look up from straight at it by a tenth of the view
    const pitch = Math.atan2(f.distance, f.height - f.aim + curve) - tilt + 0.06;
    return { focus, forward, altitude, pitch };
  }

  /** Fly to frame a place; `then` runs on arrival. */
  to(f: Framing, radius: number, ground: Ground, then?: () => void): void {
    const pose = this.pose(f, radius, ground);
    const rig = this.rig;
    this.startFrame.copy(rig.frame);
    // the end frame as lookAlong builds it: columns right, up, back
    const up = pose.focus.clone().normalize();
    const right = new Vector3().crossVectors(pose.forward, up).normalize();
    const fwd = new Vector3().crossVectors(up, right);
    this.endFrame.setFromRotationMatrix(new Matrix4().makeBasis(right, up, fwd.negate()));
    const hop = angleBetween(rig.up, up) * radius;
    this.startAlt = rig.altitude;
    this.endAlt = pose.altitude;
    // The clouds float some 5 to 45 m up (life/clouds.ts), so a hop skims the meadow under them, as
    // high as its higher end; only a long one (most of the way round a small planet) climbs over them.
    const low = Math.max(this.startAlt, this.endAlt);
    this.peakAlt = hop > LONG_HOP && low < OVER_CLOUDS ? Math.max(OVER_CLOUDS, hop * 0.6) : low;
    this.startPitch = this.pitch;
    this.endPitch = pose.pitch;
    this.duration = Math.min(3.4, 1.1 + 0.55 * Math.log1p(hop / 12) + (Math.abs(Math.log(this.endAlt / this.startAlt)) > 2 ? 0.5 : 0));
    this.t = 0;
    this.active = true;
    this.done = then ?? null;
  }

  /** Stop where the camera is (a drag, a zoom or a key took over). */
  cancel(): void {
    this.active = false;
    this.done = null;
    this.pitch = 0;
  }

  /** Advance; call before the rig's own update. */
  update(dt: number): void {
    if (!this.active) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    const t = this.t;
    const e = smoothstep(0, 1, t);
    this.frame.slerpQuaternions(this.startFrame, this.endFrame, smoothstep(0.05, 0.95, t));
    this.up.copy(Y).applyQuaternion(this.frame);
    this.forward.copy(NZ).applyQuaternion(this.frame);
    this.rig.lookAlong(this.up, this.forward, true);
    // altitude: in log space through the peak (a quadratic Bézier), so the climb and the descent feel even
    const a0 = Math.log(this.startAlt);
    const a1 = Math.log(this.endAlt);
    const ap = Math.log(this.peakAlt);
    const mid = 2 * ap - 0.5 * (a0 + a1);
    const u = smoothstep(0, 1, t);
    const alt = Math.exp((1 - u) * (1 - u) * a0 + 2 * (1 - u) * u * mid + u * u * a1);
    this.rig.setZoom(this.rig.zoomForAltitude(alt), true);
    // the look up eases out while high and into the place's framing on the way down
    const high = this.peakAlt > Math.max(this.startAlt, this.endAlt) * 1.05 ? Math.sin(Math.PI * t) : 0;
    this.pitch = (this.startPitch + (this.endPitch - this.startPitch) * e) * (1 - 0.85 * high);
    this.rig.lookUp(this.pitch, true);
    if (t >= 1) {
      this.active = false;
      const done = this.done;
      this.done = null;
      done?.();
    }
  }
}
