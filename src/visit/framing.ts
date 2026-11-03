import { Vector3 } from 'three';
import { angleBetween, slerpUnit, tangentToward, travel } from '../planet/geo';
import type { Framing } from '../view/flight';
import type { VisitBody, VisitWorld } from './world';

// The camera's views of the Muses on a world as a visit (visitUi.ts) and the photo studio (studio.ts) frame them: the
// two side on, the host alone, the host's house, and a selfie of them at arm's length.

/**
 * The two Muses' framing, side on to the pair (musesFraming): the camera at least this far off and this high (m),
 * farther and higher in step where it needs the room for both, looking this high over their ground (m).
 */
const MUSES_VIEW = { distance: 6.2, height: 1.9, aim: 0.8 } as const;
/** Room left across the view on each side of the two Muses (m). */
const MUSES_ROOM = 1.1;
/** How many places on the way from the camera to the two are looked at for what stands in it, and how near a house's middle (m) is in its walls. */
const SIGHT_SAMPLES = 8;
const HOUSE_REACH = 6;
/** How much the side the host faces counts toward the camera's side, against open places (of SIGHT_SAMPLES): its face over a little more room. */
const FACING = 3;
/** The host's house as the camera comes to it, where the world has no view of its own (homeFraming). */
const HOME_VIEW = { distance: 16, height: 6, aim: 1.5 } as const;
/**
 * A selfie (selfieFraming): the camera this much over the heads' middle (m), as an arm holds it up; room about each
 * head's middle across the view and up and down it, for the head itself (m); and a head's middle over its feet, where
 * a Muse has no head of its own to read (m).
 */
const SELFIE = { over: 0.12, across: 0.55, up: 0.45, head: 0.85 } as const;

/** The host alone, from in front of it. */
export function hostFraming(world: VisitWorld): Framing {
  const host = world.host.where;
  return { dir: host.dir.clone(), ground: host.height, ...(world.musesView ?? MUSES_VIEW), from: host.heading.clone() };
}

/** The host's house from out in front of it, where the world has no view of its own (every world's layout names its cottage and the way it faces; without them, wherever the host is). */
export function homeFraming(world: VisitWorld): Framing {
  const layout = world.shape() as { readonly cottage?: unknown; readonly homeBearing?: unknown };
  const house = layout.cottage instanceof Vector3 ? layout.cottage.clone().normalize() : world.host.where.dir.clone();
  const from = layout.homeBearing instanceof Vector3 ? layout.homeBearing.clone() : undefined;
  return { dir: house, ground: world.ground(house).height, ...HOME_VIEW, from };
}

/**
 * The two Muses side on: from across the line between them, at their middle, far enough back that both fit across
 * the view with room to spare (the world's own musesView, or MUSES_VIEW, at least; higher in step, so it looks down
 * as steeply; and higher by as much as the camera's own ground rises above theirs, so it never stands down in what
 * grows on a slope), from the side with more open ground between the camera and the two (no rise of the ground,
 * wall in the way, never in toward the house) and toward the side the host faces. Null with no guest beside the host.
 */
export function musesFraming(world: VisitWorld, guest: VisitBody['where'] | null): Framing | null {
  const base = world.musesView ?? MUSES_VIEW;
  const R = world.scene.growth.radius;
  const host = world.host.where;
  const apart = guest ? angleBetween(host.dir, guest.dir) * R : 0;
  if (!guest || apart < 0.3) return null;
  const middle = slerpUnit(host.dir, guest.dir, 0.5, new Vector3());
  const along = tangentToward(middle, guest.dir, new Vector3());
  const across = new Vector3().crossVectors(middle, along).normalize();
  // (the view's half width at the height it comes down to, as the rig opens its lens there)
  const halfWidth = halfView(world, base.height);
  const distance = Math.max(base.distance, (apart / 2 + MUSES_ROOM) / Math.tan(halfWidth));
  const scale = distance / base.distance;
  const framing = { dir: middle, ground: (host.height + guest.height) / 2, distance, height: base.height * scale, aim: base.aim };
  const sides = [across, across.clone().negate()];
  // (a side whose way runs in toward the house, through it or to a camera in it, is no side: of two opposite ways
  // from the two, at most one runs in toward it)
  const scores = sides.map((side) => {
    const open = openness(world, framing, side);
    return open < 0 ? -Infinity : open + FACING * side.dot(host.heading);
  });
  const from = scores[1] > scores[0] ? sides[1] : sides[0];
  const camera = travel(middle, from, distance / R, new Vector3());
  const rise = Math.max(0, world.ground(camera).height - framing.ground);
  return { ...framing, height: framing.height + rise, from };
}

/**
 * A selfie of the Muses drawn (one or two): the camera at arm's length (`reach`, m) from the middle of their heads, a
 * little over them, looking back at them from the side they face, farther only as far as each head needs to be in
 * the view (a head nearer the camera takes more of it). Each head is read where the Muse has one (its body's
 * spheres: the fourth is its head's), else taken SELFIE.head over its feet.
 */
export function selfieFraming(world: VisitWorld, bodies: readonly VisitBody[], reach: number): Framing {
  const R = world.scene.growth.radius;
  const heads = bodies.map((b) => headOf(b, R));
  const middle = new Vector3();
  for (const h of heads) middle.add(h);
  middle.divideScalar(heads.length);
  const dir = middle.clone().normalize();
  const ground = bodies.reduce((sum, b) => sum + b.where.height, 0) / bodies.length;
  const aim = middle.length() - R - ground;
  // the side they face: their headings together, or across the line between two that face each other, toward the host's
  const facing = new Vector3();
  for (const b of bodies) facing.add(b.where.heading);
  facing.addScaledVector(dir, -facing.dot(dir));
  if (facing.lengthSq() < 0.04 && heads.length > 1) {
    const along = tangentToward(dir, heads[1].clone().normalize(), new Vector3());
    facing.crossVectors(dir, along);
    if (facing.dot(bodies[0].where.heading) < 0) facing.negate();
  }
  if (facing.lengthSq() < 1e-8) facing.copy(bodies[0].where.heading);
  facing.normalize();
  // (each head in the view with room about it: how far across it and up or down from their middle, and how much
  // nearer the camera)
  const height = aim + SELFIE.over;
  const across = Math.tan(halfView(world, height));
  const up = Math.tan(halfView(world, height, 1));
  const side = new Vector3().crossVectors(dir, facing);
  const off = new Vector3();
  let distance = reach;
  for (const h of heads) {
    off.subVectors(h, middle);
    const near = off.dot(facing);
    distance = Math.max(distance, near + (Math.abs(off.dot(side)) + SELFIE.across) / across, near + (Math.abs(off.dot(dir)) + SELFIE.up) / up);
  }
  // (no lower than the rig comes down to over the ground under it: from there, looking down at shorter Muses' heads,
  // or theirs sat down)
  const camera = travel(dir, facing, distance / R, new Vector3());
  const low = world.scene.rig.framing(1).altitude + world.ground(camera).height - ground - (distance * distance) / (2 * R);
  return { dir, ground, distance, height: Math.max(height, low), aim, from: facing };
}

/** The middle of a Muse's head (planet space, m): its head's sphere where it has its body's spheres, else SELFIE.head over its feet. */
export function headOf(body: VisitBody, R: number): Vector3 {
  const head = body.spheres?.[3];
  if (head) return new Vector3(head.x, head.y, head.z);
  return body.where.dir.clone().multiplyScalar(R + body.where.height + SELFIE.head);
}

/** Half the view's width (rad) with the camera this high, as the rig opens its lens there (or its height, `aspect` 1). */
function halfView(world: VisitWorld, height: number, aspect = world.scene.rig.camera.aspect): number {
  const rig = world.scene.rig;
  const fov = (rig.framing(rig.zoomForAltitude(height)).fov * Math.PI) / 180;
  return Math.atan(Math.tan(fov / 2) * aspect);
}

/**
 * How open the way is from a framing's camera, on one side, to the two Muses: of the places along it, how many have
 * nothing in the line of sight (the ground below it, no wall where a Muse may not stand); -1 when the way runs in
 * toward the house (a place on it within HOUSE_REACH of the house and nearer it than the two stand, who may well be
 * on its own deck or terrace), so the camera neither looks through it nor stands in it.
 */
function openness(world: VisitWorld, f: Omit<Framing, 'from'>, side: Vector3): number {
  const R = world.scene.growth.radius;
  // (every world's layout names its cottage: its house stands about it)
  const cottage = (world.shape() as { readonly cottage?: unknown }).cottage;
  const house = cottage instanceof Vector3 ? cottage : null;
  const theirs = house ? angleBetween(f.dir, house) * R : 0;
  const p = new Vector3();
  let open = 0;
  for (let k = 1; k <= SIGHT_SAMPLES; k++) {
    const u = k / SIGHT_SAMPLES;
    travel(f.dir, side, (f.distance * u) / R, p);
    if (house) {
      const d = angleBetween(p, house) * R;
      if (d < HOUSE_REACH && d < theirs) return -1;
    }
    const sight = f.ground + f.aim + (f.height - f.aim) * u;
    if (world.ground(p).height > sight - 0.25) continue;
    if (world.standable && !world.standable(p)) continue;
    open++;
  }
  return open;
}
