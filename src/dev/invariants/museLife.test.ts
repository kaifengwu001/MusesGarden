import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { JOINT, JOINTS } from '../../life/museBody';
import { MuseLife } from '../../life/museLife';
import { SCULPTS } from '../../life/museMesh';
import { BOUNCE, MuseRig, type MuseAction, type Move } from '../../life/museRig';

const still = (time: number, moves: Move[] = []): MuseAction => ({ time, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0, moves });
const camera = { x: 0.5, y: 1.7, z: 4.3 };

describe("Muse's moves", () => {
  it('poses a move in closed form: the same moment draws the same pose', () => {
    const a = new MuseRig();
    const b = new MuseRig();
    const at = still(7.3, [{ kind: 'fish', time: 8.1, amount: 1 }]);
    a.pose(at);
    b.pose(still(2, [{ kind: 'sleep', time: 3, amount: 1 }]));
    b.pose(at);
    for (let j = 0; j < JOINTS; j++) expect(Array.from(a.skin[j].elements)).toEqual(Array.from(b.skin[j].elements));
    expect(a.squeeze).toBe(b.squeeze);
  });

  it('keeps its feet on the ground as it squashes for a hop, and leaves it in the air', () => {
    const rig = new MuseRig();
    const feet = new Float32Array(JOINTS * 3);
    // squashed on the ground at the middle of a landing, up in the air at the middle of a flight
    rig.pose(still(0, [{ kind: 'bounce', time: BOUNCE.period * (1 + 0.16), amount: 1 }]));
    expect(rig.joints(feet)[JOINT.root * 3 + 1]).toBeCloseTo(0, 6);
    rig.pose(still(0, [{ kind: 'bounce', time: BOUNCE.period * (1 + 0.66), amount: 1 }]));
    expect(rig.joints(feet)[JOINT.root * 3 + 1]).toBeGreaterThan(0.6 * BOUNCE.height);
  });

  it('reaches its mitten into its belly pocket', () => {
    const rig = new MuseRig(SCULPTS.tpose6.fit);
    rig.pose(still(0, [{ kind: 'pocket', time: 0.5, amount: 1 }]));
    const hand = new Vector3().setFromMatrixPosition(rig.handFrame(-1, new Matrix4()));
    // the pocket, carried by the spine (at rest the spine is unturned, so this is where it is), give or take the rummage
    expect(hand.distanceTo(new Vector3(-0.1, 0.31, 0.21))).toBeLessThan(0.04);
  });

  it('squeezes its eyes shut as you pet it, and blushes', () => {
    const rig = new MuseRig();
    rig.pose(still(0, [{ kind: 'pet', time: 1, amount: 1, side: 1, release: -1 }]));
    expect(rig.squeeze).toBeGreaterThan(0.9);
    expect(rig.blush).toBeGreaterThan(0.5);
  });
});

describe("Muse's day", () => {
  it('runs on from one part to the next without a jump in where it is or which way it faces', () => {
    const life = new MuseLife();
    for (const { name, start } of life.names) {
      if (start === 0) continue;
      life.seek(0, start - 1e-3);
      const a = { ...life.at(0, camera) };
      life.seek(0, start + 1e-3);
      const b = life.at(0, camera);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), name).toBeLessThan(0.01);
      expect(Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))), name).toBeLessThan(0.02);
    }
  });

  it('stops and turns to you when you tap it, then goes back to its day', () => {
    const life = new MuseLife();
    const walk = life.names.find((n) => n.name === 'walk');
    life.seek(0, (walk?.start ?? 0) + 1.5);
    const before = life.at(0, camera).heading;
    life.tap(0.1);
    const turned = life.at(1.2, camera);
    const toYou = Math.atan2(camera.x - turned.x, camera.z - turned.z);
    expect(Math.abs(Math.atan2(Math.sin(turned.heading - toYou), Math.cos(turned.heading - toYou)))).toBeLessThan(0.05);
    expect(turned.action.walk).toBeLessThan(0.1);
    // its day held back while it answered (a wave's length or so), then going on: walking the way it was
    const held = 6 - (life.clock(6) - (walk?.start ?? 0) - 1.5);
    expect(held).toBeGreaterThan(2.5);
    expect(held).toBeLessThan(4.5);
    life.seek(0, (walk?.start ?? 0) + 1.5);
    const after = life.at(0.5, camera);
    expect(Math.abs(after.heading - before)).toBeLessThan(0.05);
  });
});
