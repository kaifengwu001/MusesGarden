import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { angleBetween } from '../planet/geo';
import { planRoute, ROUTE, walkable, type RouteGround } from './route';
import { newBeat, parseScene, sceneText, type Actor, type DirectorScene, type Mark } from './scene';
import { IDEA_LENGTH, MuseRig } from '../life/museRig';
import { aim, newLife, play, Take, type TakeWorld } from './timeline';

// The director's routes and takes, without a world: a planet of R 128 with a round pond and a wall on it.

const R = 128;
const H = 1.65;
const UP = new Vector3(0, 1, 0);
const EAST = new Vector3(1, 0, 0);
const SOUTH = new Vector3(0, 0, 1);

/** A place x m east and z m south of the planet's top. */
const at = (x: number, z: number): Vector3 => UP.clone().addScaledVector(EAST, x / R).addScaledVector(SOUTH, z / R).normalize();
const local = (dir: Vector3): [number, number] => [(dir.dot(EAST) / dir.dot(UP)) * R, (dir.dot(SOUTH) / dir.dot(UP)) * R];
const mark = (x: number, z: number, facing: Vector3 = EAST): Mark => {
  const d = at(x, z);
  const f = facing.clone().addScaledVector(d, -facing.dot(d)).normalize();
  return { dir: [d.x, d.y, d.z], facing: [f.x, f.y, f.z] };
};

/** A pond of 4 m about (10, 0), and a wall from (4.5, -8) to (5.5, -2). */
const ground: RouteGround = {
  water: (dir) => {
    const [x, z] = local(dir);
    return Math.hypot(x - 10, z) - 4;
  },
  standable: (dir) => {
    const [x, z] = local(dir);
    return !(x > 4.5 && x < 5.5 && z > -8 && z < -2);
  },
};

const world = (camera = at(0, 12).multiplyScalar(R + 3)): TakeWorld => ({
  R,
  H,
  ground: () => 0,
  route: (from, to) => planRoute(from, to, R, ground),
  piece: () => null,
  camera,
});

const actor = (id: string, start: Mark, beats: Actor['beats']): Actor => ({ id, name: id, look: 'tpose6', host: false, shown: true, colour: '#e05a4f', start, beats });
const scene = (actors: Actor[]): DirectorScene => ({ version: 1, planet: 'meadow', actors, pieces: [], loop: false });

describe('routes', () => {
  it('go straight where the way is clear', () => {
    const r = planRoute(at(0, 0), at(0, 8), R, ground);
    expect(r.blocked).toBe(false);
    expect(r.path.length).toBeCloseTo(8, 1);
  });

  it('go round the pond, on dry ground all the way, not much longer than they must', () => {
    const r = planRoute(at(2, 0), at(18, 0), R, ground);
    expect(r.blocked).toBe(false);
    for (const p of r.path.points) expect(ground.water(p)).toBeGreaterThan(ROUTE.dry * 0.79);
    // (the straight way is 16 m; round the pond's half circle about 4π + 8 ≈ 20.6 m)
    expect(r.path.length).toBeGreaterThan(16.5);
    expect(r.path.length).toBeLessThan(23);
  });

  it('go round a wall', () => {
    const r = planRoute(at(2, -5), at(8, -5), R, ground);
    expect(r.blocked).toBe(false);
    for (const p of r.path.points) expect(walkable(ground, p, 0)).toBe(true);
  });

  it('turn smoothly: no corner sharper than a rounded one', () => {
    const r = planRoute(at(2, 0), at(18, 0), R, ground);
    const pts = r.path.points;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i].clone().sub(pts[i - 1]);
      const b = pts[i + 1].clone().sub(pts[i]);
      expect(a.angleTo(b)).toBeLessThan(0.6);
    }
  });
});

describe('takes', () => {
  const sitThenWave = (): DirectorScene => {
    const sit = { ...newBeat('sit', mark(0, 6, SOUTH)), amount: 5 };
    const wave = { ...newBeat('wave', mark(3, 6, EAST)), cue: { kind: 'at' as const, time: 30 } };
    return scene([actor('a', mark(0, 0, SOUTH), [sit, wave])]);
  };

  it('walk to each mark, do what each beat says there, and wait for a cue sitting', () => {
    const take = Take.write(sitThenWave(), world());
    const a = take.actors.get('a')!;
    const [sit, wave] = sitThenWave().actors[0].beats.map((b) => b.id);
    const tSit = [...a.beats.values()][0];
    const tWave = [...a.beats.values()][1];
    expect(a.beats.size).toBe(2);
    void sit;
    void wave;
    const out = newLife();
    play(a, tSit.arrives + 2, 0, out);
    expect(angleBetween(out.dir, at(0, 6)) * R).toBeLessThan(0.05);
    expect(out.action.moves.some((m) => m.kind === 'sit' || m.kind === 'plop')).toBe(true);
    // (still sat as the cue nears: the sit drawn out to it)
    play(a, 29.5, 0, out);
    expect(out.action.moves.some((m) => m.kind === 'sit')).toBe(true);
    expect(tWave.starts).toBeCloseTo(30, 6);
    // (up before it walks: the rise is in the wave's own beat)
    play(a, 30.4, 0, out);
    expect(out.action.moves.some((m) => m.kind === 'rise')).toBe(true);
    play(a, tWave.arrives + 1, 0, out);
    expect(angleBetween(out.dir, at(3, 6)) * R).toBeLessThan(0.05);
    expect(out.action.wave).toBeGreaterThan(0);
    expect(take.length).toBeCloseTo(tWave.ends, 6);
  });

  it('never jumps or snaps round from one frame to the next, and its gait only runs on', () => {
    const s = scene([
      actor('a', mark(0, 0, SOUTH), [
        { ...newBeat('stand', mark(14, 3, EAST)), amount: 1 },
        { ...newBeat('nap', mark(14, -6, SOUTH)), amount: 4 },
        { ...newBeat('water', mark(0, -4, EAST.clone().negate())), amount: 2 },
        { ...newBeat('water', mark(2, -9, SOUTH)), amount: 1 },
        newBeat('bounce', null),
      ]),
    ]);
    const take = Take.write(s, world());
    const a = take.actors.get('a')!;
    const out = newLife();
    play(a, 0, 0, out);
    let dir = out.dir.clone();
    let heading = out.heading.clone();
    let gait = out.action.gait;
    for (let t = 1 / 60; t < take.length + 2; t += 1 / 60) {
      play(a, t, t, out);
      expect(angleBetween(dir, out.dir) * R).toBeLessThan(0.05);
      expect(heading.angleTo(out.heading)).toBeLessThan(0.12);
      expect(out.action.gait).toBeGreaterThanOrEqual(gait - 1e-9);
      dir = out.dir.clone();
      heading = out.heading.clone();
      gait = out.action.gait;
    }
  });

  it('keeps its can out between two waterings, and walks off the planet’s water', () => {
    const s = scene([
      actor('a', mark(2, 0, EAST), [
        { ...newBeat('water', mark(18, 0, EAST)), amount: 1 },
        { ...newBeat('water', mark(18, 6, SOUTH)), amount: 1 },
      ]),
    ]);
    const a = Take.write(s, world()).actors.get('a')!;
    const [first, second] = [...a.beats.values()];
    const out = newLife();
    for (let t = first.starts; t < first.arrives; t += 0.1) {
      play(a, t, t, out);
      expect(ground.water(out.dir)).toBeGreaterThan(ROUTE.dry * 0.79);
    }
    for (let t = second.starts; t < second.arrives; t += 0.1) {
      play(a, t, t, out);
      expect(out.cues.water?.grip).toBe(1);
    }
  });

  it('plays an idea and adoring as gestures, each its icon over its head', () => {
    const s = scene([actor('a', mark(0, 0, SOUTH), [{ ...newBeat('idea', mark(2, 0, SOUTH)), amount: 2 }, newBeat('love', null)])]);
    const take = Take.write(s, world());
    const [idea, love] = [...take.actors.get('a')!.beats.values()];
    const a = take.actors.get('a')!;
    const out = newLife();
    const rig = new MuseRig();
    // the bulb lit over its head, each of the two times
    for (const t of [idea.arrives + 1.2, idea.arrives + IDEA_LENGTH + 0.3 + 1.2]) {
      play(a, t, 0, out);
      expect(out.action.moves.some((m) => m.kind === 'idea')).toBe(true);
      rig.pose(out.action);
      expect(rig.emote.lit).toBeGreaterThan(0.99);
    }
    expect(love.starts).toBeGreaterThanOrEqual(idea.ends - 1e-6);
    play(a, love.arrives + 1.4, 0, out);
    rig.pose(out.action);
    expect(rig.emote.heart).toBeGreaterThan(0.99);
    expect(rig.squint).toBeGreaterThan(0.9);
  });

  it('waits on another Muse’s cue', () => {
    const lead = newBeat('stand', mark(0, 10, SOUTH));
    const s = scene([
      actor('a', mark(0, 0, SOUTH), [lead]),
      actor('b', mark(4, 0, SOUTH), [{ ...newBeat('wave', null), cue: { kind: 'event', actor: 'a', beat: lead.id, when: 'arrives' } }]),
    ]);
    const take = Take.write(s, world());
    expect(take.settled).toBe(true);
    const arrives = take.times(lead.id)!.arrives;
    expect(arrives).toBeGreaterThan(10);
    const b = take.actors.get('b')!;
    expect([...b.beats.values()][0].starts).toBeCloseTo(arrives, 6);
  });

  it('faces another Muse when asked, and turns its head to the camera', () => {
    const s = scene([actor('a', mark(0, 0, SOUTH), [{ ...newBeat('stand', mark(0, 4, SOUTH)), facing: { kind: 'actor', actor: 'b' } }]), actor('b', mark(6, 4, SOUTH), [])]);
    const a = Take.write(s, world()).actors.get('a')!;
    const out = newLife();
    play(a, a.end, 0, out);
    expect(out.heading.angleTo(at(6, 4).sub(at(0, 4)).normalize())).toBeLessThan(0.05);
    // (its head toward a camera off to its right: turned right, a negative yaw)
    aim(out, at(0, 4).multiplyScalar(R).addScaledVector(SOUTH, 3).addScaledVector(EAST, -3), R, H, 0);
    expect(out.action.lookYaw).toBeGreaterThan(0.2);
  });

  it('reads its scenes back as written, dropping what is malformed', () => {
    const s = sitThenWave();
    expect(parseScene(sceneText(s), 'meadow')).toEqual(s);
    expect(parseScene(sceneText(s), 'golden-rye')).toBeNull();
    expect(parseScene('{', 'meadow')).toBeNull();
    const broken = JSON.parse(sceneText(s)) as { actors: { beats: unknown[] }[] };
    broken.actors[0].beats.push({ id: 'x', action: 'dance' });
    expect(parseScene(JSON.stringify(broken), 'meadow')!.actors[0].beats).toHaveLength(2);
  });
});
