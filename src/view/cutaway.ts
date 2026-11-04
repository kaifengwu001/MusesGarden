import { Box3, Matrix4, PerspectiveCamera, Quaternion, Vector3, type Vector2, type Vector4 } from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/math';
import { FLOOR } from '../life/props';
import { travel } from '../planet/geo';
import { createGroundSample } from '../planet/terrain';
import type { World } from '../world';
import type { RigPose } from './camera';

// The cutaway into Muse's hut (Kai's brief, 2026-11-01). Tap the door while
// Muse is in or about the hut, and the camera rises off the meadow while its
// view narrows to an almost orthographic one, the roof and the chimney
// lifting off and dissolving, until the room is seen from above at an angle
// with the porch and the pond's edge round it, as in Kai's mock-up. Drag to
// turn round the room or tip the view, scroll to come closer or stand back.
// Step outside and the camera goes back the way it came, the roof settling
// on again. It drives the rig as a flight does, before the world moves the
// camera: the focus goes to the room (so the near field, the light and the
// fog are the room's), the camera is held off it (CameraRig.held), and the
// tiny-planet warp eases out so the room stands square. Tap the glowing dot
// on Muse's showpiece and the camera turns to it and comes in (not straight
// on), what stands in front of it dissolving, until it fills half the screen
// or so; its favourites' white dots open their cards there.

/**
 * The view into the room: its bearing round from the front toward the right
 * end (rad), its height over the horizon (rad), its field of view (°), the
 * half-height of the view at the room (m), and the point it looks at (the
 * homestead's local m).
 */
export const VIEW = { azimuth: 0.68, elevation: 1.2, fov: 15, size: 7.2, at: [-0.8, FLOOR + 0.5, 1.2] } as const;
/** How far a drag or the wheel may take it: its height over the horizon (rad) and the half-height of the view (m). */
const LIMITS = { elevation: [0.62, 1.42], size: [2.6, 11] } as const;
/**
 * Looking at Muse's showpiece, along the left wall facing into the room: from
 * the front of the room and above, not straight on (the camera's bearing and
 * height round it, rad); near enough that it fills about `fill` of the view
 * across and up, set off to one side (`aside`, a share of the view's width) so
 * a card has room beside it. A drag or the wheel moves it within `limits`.
 */
const SHELF = { azimuth: 1.0, elevation: 0.6, fill: 0.62, aside: 0.12, limits: { azimuth: [0.55, 1.65], elevation: [0.25, 1.05], size: [1.1, 3.2] } } as const;
/** Clouds this near the line from the camera to the room draw back while it is open (m). */
const CLEARING = 9;
/** Seconds to rise into the cutaway, and to come back down. */
const RISE = 2.4;
const FALL = 1.8;

/** One end of the way in or out: the point looked at (planet space), the bearing and height of the camera round it in the room's frame (rad), the field of view (°), the half-height of the view there (m), and the camera's up. */
interface Ends {
  look: Vector3;
  azimuth: number;
  elevation: number;
  fov: number;
  size: number;
  up: Vector3;
}

const Y = new Vector3(0, 1, 0);
const NZ = new Vector3(0, 0, -1);
const sample = createGroundSample();

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

export class Cutaway {
  private phase: 'shut' | 'opening' | 'open' | 'closing' = 'shut';
  private t = 0;
  private before: RigPose | null = null;
  private from: Ends | null = null;
  private to: Ends | null = null;
  /** While open: the view's bearing, height and size, easing toward where a drag or the wheel sets them. */
  private readonly view = { azimuth: VIEW.azimuth as number, elevation: VIEW.elevation as number, size: VIEW.size as number };
  private readonly aim = { azimuth: VIEW.azimuth as number, elevation: VIEW.elevation as number, size: VIEW.size as number };
  private then: (() => void) | null = null;
  /** Toward Muse's showpiece: whether asked to be there, and how far there (0 the room's view … 1 the shelf's); the room's view to come back to. */
  private shelfAsked = false;
  private shelf = 0;
  private readonly roomAim = { azimuth: VIEW.azimuth as number, elevation: VIEW.elevation as number, size: VIEW.size as number };
  private readonly shelfLook = new Vector3();
  private readonly frameFrom = new Quaternion();
  private readonly frameTo = new Quaternion();
  private readonly held = { position: new Vector3(), target: new Vector3(), up: new Vector3(), fov: VIEW.fov as number };
  private readonly tmpCamera = new PerspectiveCamera();
  /** The room's frame at the point looked at (planet space): across the front, up, toward the pond. */
  private readonly X = new Vector3();
  private readonly U = new Vector3();
  private readonly Z = new Vector3();
  /**
   * A film holding the view (dev/hutFilm.ts): while set, the room's view looks at `at` (the homestead's local m) from
   * this bearing and height (rad), this field of view (°) and half-height at the room (m), exactly (no easing toward
   * it); a drag or the wheel does nothing.
   */
  film: { at: Vector3; azimuth: number; elevation: number; fov: number; size: number } | null = null;

  constructor(private readonly world: World) {}

  /** Whether the cutaway has the camera (going in, in, or coming out). */
  get active(): boolean {
    return this.phase !== 'shut';
  }

  /** Whether the room is open and still (its favourites can be opened). */
  get open(): boolean {
    return this.phase === 'open';
  }

  /** Whether it is on its way in or in. */
  get entering(): boolean {
    return this.phase === 'opening' || this.phase === 'open';
  }

  /** Whether the shelf's view is asked for (going there, or there). */
  get atShelf(): boolean {
    return this.shelfAsked;
  }

  /** How far the view has gone to the shelf (0 … 1). */
  get shelfAmount(): number {
    return this.shelf;
  }

  /** Turn to Muse's showpiece (once the room is open and the showpiece in). */
  toShelf(): void {
    const box = this.world.hut.showpieceBox(new Box3());
    if (!this.open || this.shelfAsked || box.isEmpty()) return;
    this.shelfAsked = true;
    Object.assign(this.roomAim, this.aim);
    // near enough that the showpiece fills about SHELF.fill of the view across and up, as seen from SHELF's bearing
    const aspect = this.world.rig.camera.aspect;
    const size = box.getSize(new Vector3());
    const across = size.z * Math.sin(SHELF.azimuth) + size.x * Math.abs(Math.cos(SHELF.azimuth));
    const up = size.y * Math.cos(SHELF.elevation) + size.x * Math.sin(SHELF.elevation);
    this.aim.azimuth = SHELF.azimuth;
    this.aim.elevation = SHELF.elevation;
    this.aim.size = Math.max(across / (2 * SHELF.fill * aspect), up / (2 * SHELF.fill));
    // the point looked at: the showpiece's middle, the view set off to one side by SHELF.aside of its width
    const mid = box.getCenter(new Vector3());
    const right = new Vector3(Math.cos(SHELF.azimuth), 0, -Math.sin(SHELF.azimuth));
    mid.addScaledVector(right, SHELF.aside * 2 * this.aim.size * aspect);
    this.shelfLook.copy(mid);
  }

  /** Back to the room's view. */
  fromShelf(): void {
    if (!this.shelfAsked) return;
    this.shelfAsked = false;
    Object.assign(this.aim, this.roomAim);
  }

  /** How far the roof is off (0 … 1). */
  get amount(): number {
    if (this.phase === 'open') return 1;
    if (this.phase === 'opening') return smoothstep(0.04, 0.62, this.t);
    if (this.phase === 'closing') return 1 - smoothstep(0.3, 0.92, this.t);
    return 0;
  }

  /** A point in the homestead's local meters as planet space (as props.vert.glsl bends the house round the planet). */
  local(x: number, y: number, z: number, out: Vector3): Vector3 {
    const w = this.world;
    const L = w.terrain.layout;
    const R = w.growth.radius;
    const across = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
    const toward = new Vector3().crossVectors(across, L.cottage).normalize();
    const d = Math.hypot(x, z);
    const t = d > 1e-6 ? across.multiplyScalar(x / d).addScaledVector(toward, z / d) : across;
    travel(L.cottage, t, Math.asin(Math.min(d / R, 1)), out);
    return out.multiplyScalar(R + w.terrain.cottageGround + y);
  }

  /** Go in: the camera rises from where it is to the view into the room. */
  enter(): void {
    if (this.phase === 'opening' || this.phase === 'open') return;
    const rig = this.world.rig;
    if (this.phase === 'shut') this.before = rig.save();
    this.shelfAsked = false;
    this.shelf = 0;
    this.view.azimuth = this.aim.azimuth = VIEW.azimuth;
    this.view.elevation = this.aim.elevation = VIEW.elevation;
    this.view.size = this.aim.size = VIEW.size;
    this.frameAt();
    this.from = this.ends(rig.camera, rig.up);
    this.to = this.inside();
    this.frameFrom.copy(rig.frame);
    this.frameTo.copy(this.frameFor(this.to.azimuth));
    this.phase = 'opening';
    this.t = 0;
    this.then = null;
  }

  /** Step outside: the camera goes back down to where it was before going in; `then` runs once it is there. */
  leave(then?: () => void): void {
    if (this.phase === 'shut') {
      then?.();
      return;
    }
    if (this.phase === 'closing') {
      if (then) this.then = then;
      return;
    }
    const w = this.world;
    const rig = w.rig;
    const before = this.before ?? rig.save();
    const up = Y.clone().applyQuaternion(before.frame);
    const ground = w.terrain.sample(up, sample).height;
    const camera = rig.placeAt(this.tmpCamera, before, w.growth.radius, ground, rig.camera.aspect);
    this.frameAt();
    this.from = this.ends(rig.camera, this.held.up.clone());
    this.to = this.ends(camera, up);
    this.frameFrom.copy(rig.frame);
    this.frameTo.copy(before.frame);
    this.phase = 'closing';
    this.t = 0;
    this.then = then ?? null;
  }

  /** Drag (px in a viewport): turn round the room, tip the view (at the shelf, a little either way). */
  drag(dx: number, dy: number, width: number, height: number): void {
    if (!this.entering || this.film) return;
    if (this.shelfAsked) {
      const l = SHELF.limits;
      this.aim.azimuth = clamp(this.aim.azimuth - (dx / width) * Math.PI * 0.5, l.azimuth[0], l.azimuth[1]);
      this.aim.elevation = clamp(this.aim.elevation + (dy / height) * 1.0, l.elevation[0], l.elevation[1]);
      return;
    }
    this.aim.azimuth -= (dx / width) * Math.PI * 0.9;
    this.aim.elevation = clamp(this.aim.elevation + (dy / height) * 1.4, LIMITS.elevation[0], LIMITS.elevation[1]);
  }

  /** The wheel or a pinch (the rig's zoom steps: + comes closer); at the shelf, scrolling out goes back to the room. */
  zoom(delta: number): void {
    if (!this.entering || this.film) return;
    if (this.shelfAsked && delta < 0) {
      this.fromShelf();
      return;
    }
    const l = this.shelfAsked ? SHELF.limits.size : LIMITS.size;
    this.aim.size = clamp(this.aim.size * Math.exp(-delta * 2.2), l[0], l[1]);
  }

  /** Each frame, before the world moves the camera. */
  update(dt: number): void {
    if (this.phase === 'shut') return;
    const w = this.world;
    const rig = w.rig;
    if (this.phase === 'open') {
      const f = this.film;
      if (f) {
        // (a film holds the view exactly)
        this.view.azimuth = this.aim.azimuth = f.azimuth;
        this.view.elevation = this.aim.elevation = f.elevation;
        this.view.size = this.aim.size = f.size;
      }
      const k = damp(dt, this.shelfAsked || this.shelf > 0.02 ? 0.3 : 0.18);
      this.view.azimuth += wrapAngle(this.aim.azimuth - this.view.azimuth) * k;
      this.view.elevation += (this.aim.elevation - this.view.elevation) * k;
      this.view.size = Math.exp(Math.log(this.view.size) + (Math.log(this.aim.size) - Math.log(this.view.size)) * k);
      this.shelf += ((this.shelfAsked ? 1 : 0) - this.shelf) * k;
      if (Math.abs((this.shelfAsked ? 1 : 0) - this.shelf) < 1e-3) this.shelf = this.shelfAsked ? 1 : 0;
      this.frameAt();
      this.pose(this.inside(), this.frameFor(this.view.azimuth));
      w.homestead.setCutaway(1);
      w.hut.open(1, this.shelf);
      this.clear(1);
      this.occlude();
      return;
    }
    const length = this.phase === 'opening' ? RISE : FALL;
    this.t = reducedMotion() ? 1 : Math.min(1, this.t + dt / length);
    const e = smoothstep(0, 1, this.t);
    const a = this.from!;
    const b = this.to!;
    this.frameAt();
    const fov = lerp(a.fov, b.fov, e);
    const ends: Ends = {
      look: a.look.clone().lerp(b.look, e),
      azimuth: a.azimuth + wrapAngle(b.azimuth - a.azimuth) * e,
      elevation: lerp(a.elevation, b.elevation, e),
      fov,
      size: Math.exp(lerp(Math.log(a.size), Math.log(b.size), e)),
      up: a.up.clone().lerp(b.up, e).normalize(),
    };
    this.pose(ends, new Quaternion().slerpQuaternions(this.frameFrom, this.frameTo, smoothstep(0.05, 0.95, this.t)));
    rig.warpScale = this.phase === 'opening' ? 1 - e : e;
    const amount = this.amount;
    w.homestead.setCutaway(amount);
    w.hut.open(amount);
    this.clear(amount);
    this.occlude();
    if (this.t < 1) return;
    if (this.phase === 'opening') {
      this.phase = 'open';
      rig.warpScale = 0;
      return;
    }
    // back outside: the rig takes the camera again exactly where the way down left it
    this.phase = 'shut';
    rig.held = null;
    rig.warpScale = 1;
    if (this.before) rig.restore(this.before);
    this.before = null;
    w.homestead.setCutaway(0);
    w.hut.open(0);
    w.clouds.clearing = null;
    const then = this.then;
    this.then = null;
    then?.();
  }

  /**
   * At the shelf: where the showpiece is on screen and how far from the camera, for what stands in front of it to
   * dissolve (life/occlude.glsl); off elsewhere.
   */
  private occlude(): void {
    const w = this.world;
    const depth = w.shared.uOccludeDepth.value as Vector2;
    const rect = w.shared.uOcclude.value as Vector4;
    const amount = this.phase === 'open' ? smoothstep(0.1, 0.7, this.shelf) : 0;
    depth.set(0, amount);
    if (amount <= 0) return;
    const camera = this.tmpCamera;
    w.rig.hold(camera, this.held, w.growth.radius, w.rig.camera.aspect);
    const box = w.hut.showpieceBox(new Box3());
    const p = new Vector3();
    let near = Infinity;
    rect.set(Infinity, Infinity, -Infinity, -Infinity);
    for (let k = 0; k < 8; k++) {
      this.local(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z, p);
      near = Math.min(near, p.distanceTo(camera.position));
      p.project(camera);
      const x = (p.x + 1) / 2;
      const y = (p.y + 1) / 2;
      rect.set(Math.min(rect.x, x), Math.min(rect.y, y), Math.max(rect.z, x), Math.max(rect.w, y));
    }
    depth.x = near;
  }

  /** Clouds out of the way between the camera and the room, as far as it is open. */
  private clear(amount: number): void {
    const c = (this.world.clouds.clearing ??= { from: new Vector3(), to: new Vector3(), radius: CLEARING, amount: 0 });
    c.from.copy(this.held.position);
    c.to.copy(this.held.target);
    c.amount = amount;
  }

  // ---- the view's geometry ------------------------------------------------------------------

  /** The room's frame at the point the view looks at. */
  private frameAt(): void {
    const L = this.world.terrain.layout;
    const at = this.local(VIEW.at[0], VIEW.at[1], VIEW.at[2], new Vector3());
    this.U.copy(at).normalize();
    this.X.crossVectors(L.cottage, L.homeBearing);
    this.X.addScaledVector(this.U, -this.X.dot(this.U)).normalize();
    this.Z.crossVectors(this.X, this.U);
  }

  /** From the point looked at toward the camera, at a bearing and a height over the horizon. */
  private toward(azimuth: number, elevation: number, out: Vector3): Vector3 {
    const c = Math.cos(elevation);
    return out.copy(this.X).multiplyScalar(Math.sin(azimuth) * c).addScaledVector(this.U, Math.sin(elevation)).addScaledVector(this.Z, Math.cos(azimuth) * c);
  }

  /** The view into the room as it stands now (toward the shelf as far as it has gone there). */
  private inside(): Ends {
    const at = this.film?.at;
    const room = at ? this.local(at.x, at.y, at.z, new Vector3()) : this.local(VIEW.at[0], VIEW.at[1], VIEW.at[2], new Vector3());
    const e = smoothstep(0, 1, this.shelf);
    return {
      look: e > 0 ? room.lerp(this.local(this.shelfLook.x, this.shelfLook.y, this.shelfLook.z, new Vector3()), e) : room,
      azimuth: this.view.azimuth,
      elevation: this.view.elevation,
      fov: this.film?.fov ?? VIEW.fov,
      size: this.view.size,
      up: this.U.clone(),
    };
  }

  /** A camera as one end of the way: looking where it looks, at the distance of the room. */
  private ends(camera: PerspectiveCamera, up: Vector3): Ends {
    const forward = camera.getWorldDirection(new Vector3());
    const room = this.local(VIEW.at[0], VIEW.at[1], VIEW.at[2], new Vector3());
    const distance = Math.max(1, camera.position.distanceTo(room));
    const back = forward.clone().negate();
    return {
      look: camera.position.clone().addScaledVector(forward, distance),
      azimuth: Math.atan2(back.dot(this.X), back.dot(this.Z)),
      elevation: Math.asin(clamp(back.dot(this.U), -1, 1)),
      fov: camera.fov,
      size: distance * Math.tan((camera.fov * Math.PI) / 360),
      up: up.clone().normalize(),
    };
  }

  /** The rig's frame for the view at a bearing: on the room, facing the way the camera looks. */
  private frameFor(azimuth: number): Quaternion {
    const up = this.U.clone();
    const forward = this.toward(azimuth, 0, new Vector3()).negate();
    const right = new Vector3().crossVectors(forward, up).normalize();
    const back = forward.clone().negate();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
  }

  /** Hold the camera at an end and put the rig's focus on the frame (its zoom by the camera's height over the room). */
  private pose(ends: Ends, frame: Quaternion): void {
    const w = this.world;
    const rig = w.rig;
    const distance = ends.size / Math.tan((ends.fov * Math.PI) / 360);
    const h = this.held;
    h.target.copy(ends.look);
    this.toward(ends.azimuth, ends.elevation, h.position).multiplyScalar(distance).add(ends.look);
    h.up.copy(ends.up);
    h.fov = ends.fov;
    rig.held = h;
    const up = Y.clone().applyQuaternion(frame);
    rig.lookAlong(up, NZ.clone().applyQuaternion(frame), true);
    const ground = w.terrain.sample(up, sample).height;
    const height = h.position.dot(up) - (w.growth.radius + ground);
    rig.setZoom(rig.zoomForAltitude(Math.max(height, 1.6)), true);
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
