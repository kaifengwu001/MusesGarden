import { Vector3 } from 'three';
import { angleBetween, slerpUnit, tangentToward, travel } from '../planet/geo';

// The guest's Muse on a visit keeps its friend company: it stands a step to one side of the host, on dry ground, and
// faces it; when the host has wandered off more than a little, it picks a new spot beside it and walks there. While
// the host keeps walking, the guest walks abreast of it, on the side it is on: its spot goes with the host, a step to
// that side and a touch ahead of where the host is, and it walks a little brisker than the host until it is there.
// Pure: it reads only what it is given and keeps only where the guest stands, where it is going, and how the host has
// been moving.

export const FOLLOW = {
  /** How far beside the host the guest stands (m). */
  side: 1.3,
  /** How far the host may wander from where the guest last chose its spot before the guest moves (m). */
  leash: 0.6,
  /** Nearer than this to the guest's spot (m), the host is in its way: the guest steps aside to a new spot. */
  near: 0.9,
  /** The guest's walking pace (m/s): a little brisker than the host's, so it keeps up. */
  pace: 0.75,
  /** Its quickest pace (m/s), catching up with a host that walks on. */
  run: 1.3,
  /** The host walks while it moves faster than this (m/s); faster than `carried` it was carried there, not walking. */
  walking: 0.15,
  carried: 2.5,
  /** How long the host's pace takes to read (s): a step's sway is not a walk. */
  settle: 0.3,
  /** How far ahead of the host's place a guest walking with it aims, in the host's own time (s). */
  lead: 0.4,
  /** Farther than this from its spot (m), the guest is simply there: the visit began, or the host was carried off. */
  jump: 12,
  /** A spot nearer than this (m) is where the guest already stands: it doesn't set off for it. */
  arrive: 0.02,
  /** Ground this far from the shore (m) is dry enough to stand on. */
  dry: 0.3,
} as const;

/** Bearings round the host to try for a spot (rad from the side preferred, by turns): that side, the other, then behind and between. */
const AROUND = [0, Math.PI, Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4, -Math.PI / 2];
/** The rings to try them on (× FOLLOW.side): a step away, then a little nearer, then farther out (a host on a narrow pier). */
const RINGS = [1, 0.75, 1.3, 1.7, 2.2];

export interface HostAt {
  /** Where the host stands: a unit direction. */
  readonly dir: Vector3;
  /** The way it faces there: a unit tangent. */
  readonly heading: Vector3;
}

/** The guest this frame: where it stands, what it faces or walks toward, and whether it is walking (1) or not (0). */
export interface Following {
  readonly dir: Vector3;
  readonly toward: Vector3;
  readonly walk: 0 | 1;
}

const step = new Vector3();
const going = new Vector3();
const ahead = new Vector3();

export class Follower {
  private at: Vector3 | null = null;
  private spot: Vector3 | null = null;
  /** Where the host stood when the spot was chosen. */
  private anchor: Vector3 | null = null;
  private walking = false;
  /** Where the host stood last frame, and how it has been moving (planet space, m/s: along the ground). */
  private last: Vector3 | null = null;
  private readonly motion = new Vector3();
  private readonly toward = new Vector3();

  /**
   * One frame, `dt` seconds on: the host as it stands now, the planet's radius (m), and whether a place is dry
   * enough to stand on.
   */
  step(host: HostAt, dt: number, radius: number, dry: (dir: Vector3) => boolean): Following {
    const speed = this.read(host, dt, radius);
    const moving = speed > FOLLOW.walking;
    if (moving && this.at) {
      // walking with it: a step to the side it is on, a touch ahead of where the host is now
      travel(host.dir, going.copy(this.motion).divideScalar(speed), Math.min(speed * FOLLOW.lead, FOLLOW.side) / radius, ahead);
      this.spot = spotBeside(host, radius, dry, this.at, ahead);
      this.anchor = host.dir.clone();
    } else {
      const wandered = !this.spot || !this.anchor || angleBetween(this.anchor, host.dir) * radius > FOLLOW.leash;
      if (wandered || !this.spot || angleBetween(this.spot, host.dir) * radius < FOLLOW.near) {
        this.spot = spotBeside(host, radius, dry, this.at);
        this.anchor = host.dir.clone();
      }
    }
    if (!this.at || angleBetween(this.at, this.spot) * radius > FOLLOW.jump) {
      this.at = this.spot.clone();
      this.walking = false;
    }
    // it sets off once its spot is more than a hair away, then walks at its pace until it stands on it; with a host
    // that walks on, it walks along with it, a little brisker the farther behind it is
    const left = angleBetween(this.at, this.spot) * radius;
    if (left > FOLLOW.arrive) this.walking = true;
    const pace = moving ? Math.min(FOLLOW.run, Math.max(FOLLOW.pace, speed + 0.8 * left)) : FOLLOW.pace;
    if (this.walking && left > 0) {
      const stride = pace * Math.min(Math.max(dt, 0), 0.1);
      slerpUnit(this.at, this.spot, Math.min(1, stride / left), this.at);
      if (stride >= left && !moving) this.walking = false;
    }
    if (!moving && left <= 0) this.walking = false;
    const walking = this.walking;
    // (walking: toward its spot, or, once abreast of a host that walks on, the way the host goes)
    const toward = !walking ? host.dir : left > 0.05 || !moving ? this.spot : travel(this.at, this.motion.clone().divideScalar(speed), 1 / radius, this.toward);
    return { dir: this.at, toward, walk: walking ? 1 : 0 };
  }

  /** The host's pace (m/s) as it has been moving: smoothed over FOLLOW.settle; a move faster than a walk was a jump, not a walk. */
  private read(host: HostAt, dt: number, radius: number): number {
    const last = this.last;
    this.last = host.dir.clone();
    if (!last) return 0;
    const moved = angleBetween(last, host.dir) * radius;
    if (dt <= 0 || moved > FOLLOW.carried * dt) {
      // carried, or the same moment: no walk to read
      if (moved > 0) this.motion.set(0, 0, 0);
      return this.motion.length();
    }
    step.subVectors(host.dir, last).multiplyScalar(radius / dt);
    step.addScaledVector(host.dir, -step.dot(host.dir));
    this.motion.addScaledVector(host.dir, -this.motion.dot(host.dir));
    this.motion.lerp(step, 1 - Math.exp(-dt / FOLLOW.settle));
    return this.motion.length();
  }

  /** Forget where the guest was: next frame it appears beside the host again. */
  reset(): void {
    this.at = this.spot = this.anchor = this.last = null;
    this.motion.set(0, 0, 0);
    this.walking = false;
  }
}

/**
 * A spot FOLLOW.side beside the host where it can stand, to its left or right as it faces: on the side the guest
 * stands now (so it doesn't cross over), else the other, else behind or between, else its left; a little nearer or
 * farther when none a step away is (a host on a narrow pier). Beside `at` when given (a place a touch ahead of the
 * host, for a guest walking along with it), else beside the host itself. With nowhere to stand, its left.
 */
export function spotBeside(host: HostAt, radius: number, dry: (dir: Vector3) => boolean, near: Vector3 | null, at: Vector3 = host.dir): Vector3 {
  const forward = tangentToward(at, host.heading.clone().add(at), new Vector3());
  const leftOf = new Vector3().crossVectors(at, forward).normalize();
  // (the side the guest is on: its right when it stands to the host's right)
  if (near && near.clone().sub(host.dir).dot(leftOf) < 0) leftOf.negate();
  const t = new Vector3();
  for (const ring of RINGS) {
    for (const bearing of AROUND) {
      t.copy(leftOf).applyAxisAngle(at, bearing);
      const spot = travel(at, t, (ring * FOLLOW.side) / radius, new Vector3());
      if (dry(spot)) return spot;
    }
  }
  return travel(at, leftOf, FOLLOW.side / radius, new Vector3());
}
