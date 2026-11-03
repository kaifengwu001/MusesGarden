import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { angleBetween, tangentToward, travel } from '../planet/geo';
import { FOLLOW, Follower, type HostAt } from './follow';

const R = 128;
const meters = (a: Vector3, b: Vector3) => angleBetween(a, b) * R;
const dryEverywhere = () => true;

/** A host at `dir` facing along `heading` (made tangent there). */
function host(dir: Vector3, heading = new Vector3(1, 0, 0)): HostAt {
  const d = dir.clone().normalize();
  return { dir: d, heading: tangentToward(d, heading.clone().add(d), new Vector3()) };
}

/** The host `m` meters on from `h` along its heading. */
function walked(h: HostAt, m: number): HostAt {
  return host(travel(h.dir, h.heading, m / R, new Vector3()), h.heading);
}

function run(f: Follower, h: HostAt, seconds: number, dry: (dir: Vector3) => boolean = dryEverywhere) {
  let last = f.step(h, 0, R, dry);
  for (let t = 0; t < seconds; t += 1 / 60) last = f.step(h, 1 / 60, R, dry);
  return last;
}

describe('the guest beside its host', () => {
  it('appears a step to the host’s side, still, facing it', () => {
    const h = host(new Vector3(0, 1, 0));
    const g = new Follower().step(h, 1 / 60, R, dryEverywhere);
    expect(meters(g.dir, h.dir)).toBeCloseTo(FOLLOW.side, 3);
    expect(g.walk).toBe(0);
    expect(g.toward.equals(h.dir)).toBe(true);
    // on its left: the side its heading turns to anticlockwise about its up
    const left = new Vector3().crossVectors(h.dir, h.heading);
    expect(g.dir.clone().sub(h.dir).dot(left)).toBeGreaterThan(0);
  });

  it('stays put while the host shifts about within the leash, still facing it', () => {
    const f = new Follower();
    const h = host(new Vector3(0, 1, 0));
    const start = f.step(h, 1 / 60, R, dryEverywhere).dir.clone();
    const shifted = walked(h, FOLLOW.leash * 0.8);
    const g = f.step(shifted, 1 / 60, R, dryEverywhere);
    expect(meters(g.dir, start)).toBeLessThan(1e-9);
    expect(g.walk).toBe(0);
    expect(g.toward.equals(shifted.dir)).toBe(true);
  });

  it('steps aside when the host comes right up to it, rather than standing in its way', () => {
    const f = new Follower();
    const h = host(new Vector3(0, 1, 0));
    const first = f.step(h, 1 / 60, R, dryEverywhere).dir.clone();
    // the host comes half a meter toward the guest: within the leash, but too close
    const toward = tangentToward(h.dir, first.clone(), new Vector3());
    const closer = host(travel(h.dir, toward, (FOLLOW.side - 0.5) / R, new Vector3()), h.heading);
    expect(meters(first, closer.dir)).toBeLessThan(FOLLOW.near);
    const g = run(f, closer, 6);
    expect(meters(g.dir, closer.dir)).toBeCloseTo(FOLLOW.side, 2);
  });

  it('walks after a host that wandered off, no faster than its pace, and arrives beside it', () => {
    const f = new Follower();
    const h = host(new Vector3(0, 1, 0));
    f.step(h, 1 / 60, R, dryEverywhere);
    const away = walked(h, 3);
    let previous = f.step(away, 0, R, dryEverywhere).dir.clone();
    let walkedFrames = 0;
    for (let i = 0; i < 60 * 10; i++) {
      const g = f.step(away, 1 / 60, R, dryEverywhere);
      expect(meters(g.dir, previous)).toBeLessThanOrEqual((FOLLOW.pace / 60) * 1.0001);
      if (g.walk === 1) {
        walkedFrames++;
        expect(meters(g.toward, away.dir)).toBeCloseTo(FOLLOW.side, 3);
      }
      previous = g.dir.clone();
    }
    expect(walkedFrames, 'it walked there').toBeGreaterThan(60);
    const g = f.step(away, 1 / 60, R, dryEverywhere);
    expect(g.walk).toBe(0);
    expect(meters(g.dir, away.dir)).toBeCloseTo(FOLLOW.side, 2);
  });

  it('keeps to the side it is on rather than crossing over the host', () => {
    const f = new Follower();
    const h = host(new Vector3(0, 1, 0));
    const first = f.step(h, 1 / 60, R, dryEverywhere).dir.clone();
    const side = Math.sign(first.clone().sub(h.dir).dot(new Vector3().crossVectors(h.dir, h.heading)));
    const g = run(f, walked(h, 2), 8);
    const moved = walked(h, 2);
    expect(Math.sign(g.dir.clone().sub(moved.dir).dot(new Vector3().crossVectors(moved.dir, moved.heading)))).toBe(side);
  });

  it('never picks a spot on the water while dry ground is to be had beside the host', () => {
    const h = host(new Vector3(0, 1, 0));
    const left = new Vector3().crossVectors(h.dir, h.heading);
    // water everywhere on the host's left
    const dry = (dir: Vector3) => dir.clone().sub(h.dir).dot(left) <= 0;
    const g = run(new Follower(), h, 2, dry);
    expect(dry(g.dir)).toBe(true);
    expect(meters(g.dir, h.dir)).toBeCloseTo(FOLLOW.side, 3);
  });

  it('stands a little nearer, or farther, when nowhere a step away will do', () => {
    const h = host(new Vector3(0, 1, 0));
    // only ground nearer than a step to the host, or farther, is good to stand on
    const ring = (dir: Vector3) => Math.abs(meters(dir, h.dir) - FOLLOW.side) > 0.1;
    const g = run(new Follower(), h, 2, ring);
    expect(meters(g.dir, h.dir)).toBeCloseTo(0.75 * FOLLOW.side, 3);
    expect(ring(g.dir)).toBe(true);
  });

  it('is simply there when the host was carried far off, rather than walking the whole way', () => {
    const f = new Follower();
    const h = host(new Vector3(0, 1, 0));
    f.step(h, 1 / 60, R, dryEverywhere);
    const far = walked(h, 50);
    const g = f.step(far, 1 / 60, R, dryEverywhere);
    expect(meters(g.dir, far.dir)).toBeCloseTo(FOLLOW.side, 3);
    expect(g.walk).toBe(0);
  });

  it('starts over beside the host after a reset', () => {
    const f = new Follower();
    f.step(host(new Vector3(0, 1, 0)), 1 / 60, R, dryEverywhere);
    f.reset();
    const elsewhere = host(new Vector3(1, 1, 0));
    expect(meters(f.step(elsewhere, 1 / 60, R, dryEverywhere).dir, elsewhere.dir)).toBeCloseTo(FOLLOW.side, 3);
  });
});
