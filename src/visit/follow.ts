import { Vector3 } from 'three';
import { angleBetween, slerpUnit, tangentToward, travel } from '../planet/geo';

// The guest's Muse on a visit keeps its friend company: it stands a step to one side of the host, on dry ground, and
// faces it; when the host has wandered off more than a little, it picks a new spot beside it and walks there. Pure: it
// reads only what it is given and keeps only where the guest stands and where it is going.

export const FOLLOW = {
  /** How far beside the host the guest stands (m). */
  side: 1.3,
  /** How far the host may wander from where the guest last chose its spot before the guest moves (m). */
  leash: 0.6,
  /** Nearer than this to the guest's spot (m), the host is in its way: the guest steps aside to a new spot. */
  near: 0.9,
  /** The guest's walking pace (m/s): a little brisker than the host's, so it keeps up. */
  pace: 0.75,
  /** Farther than this from its spot (m), the guest is simply there: the visit began, or the host was carried off. */
  jump: 12,
  /** A spot nearer than this (m) is where the guest already stands: it doesn't set off for it. */
  arrive: 0.02,
  /** Ground this far from the shore (m) is dry enough to stand on. */
  dry: 0.3,
} as const;

/** Bearings round the host to try for a spot (rad from its left, by turns): its left, its right, behind, then between. */
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

export class Follower {
  private at: Vector3 | null = null;
  private spot: Vector3 | null = null;
  /** Where the host stood when the spot was chosen. */
  private anchor: Vector3 | null = null;
  private walking = false;

  /**
   * One frame, `dt` seconds on: the host as it stands now, the planet's radius (m), and whether a place is dry
   * enough to stand on.
   */
  step(host: HostAt, dt: number, radius: number, dry: (dir: Vector3) => boolean): Following {
    const wandered = !this.spot || !this.anchor || angleBetween(this.anchor, host.dir) * radius > FOLLOW.leash;
    if (wandered || !this.spot || angleBetween(this.spot, host.dir) * radius < FOLLOW.near) {
      this.spot = spotBeside(host, radius, dry, this.at);
      this.anchor = host.dir.clone();
    }
    if (!this.at || angleBetween(this.at, this.spot) * radius > FOLLOW.jump) {
      this.at = this.spot.clone();
      this.walking = false;
    }
    // it sets off once its spot is more than a hair away, then walks at its pace until it stands on it
    const left = angleBetween(this.at, this.spot) * radius;
    if (left > FOLLOW.arrive) this.walking = true;
    const walking = this.walking && left > 0;
    if (walking) {
      const stride = FOLLOW.pace * Math.min(Math.max(dt, 0), 0.1);
      slerpUnit(this.at, this.spot, Math.min(1, stride / left), this.at);
      if (stride >= left) this.walking = false;
    }
    return { dir: this.at, toward: walking ? this.spot : host.dir, walk: walking ? 1 : 0 };
  }

  /** Forget where the guest was: next frame it appears beside the host again. */
  reset(): void {
    this.at = this.spot = this.anchor = null;
    this.walking = false;
  }
}

/**
 * A spot FOLLOW.side beside the host where it can stand: of the bearings round it, the good one nearest where the
 * guest stands now (so it doesn't cross over), else its left; a little nearer or farther when none a step away is.
 * With nowhere to stand, its left.
 */
export function spotBeside(host: HostAt, radius: number, dry: (dir: Vector3) => boolean, near: Vector3 | null): Vector3 {
  const forward = tangentToward(host.dir, host.heading.clone().add(host.dir), new Vector3());
  const leftOf = new Vector3().crossVectors(host.dir, forward).normalize();
  const t = new Vector3();
  for (const ring of RINGS) {
    let best: Vector3 | null = null;
    let bestD = Infinity;
    for (const bearing of AROUND) {
      t.copy(leftOf).applyAxisAngle(host.dir, bearing);
      const spot = travel(host.dir, t, (ring * FOLLOW.side) / radius, new Vector3());
      if (!dry(spot)) continue;
      if (!near) return spot;
      const d = angleBetween(spot, near);
      if (d < bestD) {
        bestD = d;
        best = spot;
      }
    }
    if (best) return best;
  }
  return travel(host.dir, leftOf, FOLLOW.side / radius, new Vector3());
}
