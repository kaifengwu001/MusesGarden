import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { JOINT, JOINTS } from '../../life/museBody';
import { MuseLife } from '../../life/museLife';
import { SCULPTS } from '../../life/museMesh';
import { BOUNCE, IDEA, IDEA_LENGTH, LOVE, LOVE_LENGTH, MuseRig, type MuseAction, type Move } from '../../life/museRig';

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

  it('throws both arms up as an idea comes to it, beaming, a lit bulb over its head; nothing there before or after', () => {
    const rig = new MuseRig(SCULPTS.tpose6.fit);
    const at = new Float32Array(JOINTS * 3);
    rig.pose(still(0));
    const head = rig.joints(at)[JOINT.head * 3 + 1];
    expect(rig.emote.bulb).toBe(0);
    rig.pose(still(0, [{ kind: 'idea', time: 1.3, amount: 1 }]));
    // both mittens up over its shoulders, the eyes in happy arcs, the bulb lit and its rays out
    for (const side of [1, -1]) expect(new Vector3().setFromMatrixPosition(rig.handFrame(side, new Matrix4())).y).toBeGreaterThan(head);
    expect(rig.squint).toBeGreaterThan(0.9);
    expect(rig.emote.bulb).toBeGreaterThan(0.99);
    expect(rig.emote.lit).toBeGreaterThan(0.99);
    expect(rig.emote.rays).toBeGreaterThan(0.5);
    // unlit as it dawns, gone by the end
    rig.pose(still(0, [{ kind: 'idea', time: (IDEA.bulb[1] + IDEA.on) / 2, amount: 1 }]));
    expect(rig.emote.bulb).toBeGreaterThan(0.9);
    expect(rig.emote.lit).toBe(0);
    rig.pose(still(0, [{ kind: 'idea', time: IDEA_LENGTH, amount: 1 }]));
    expect(rig.emote.bulb).toBe(0);
  });

  it('tilts its head as it adores you, its eyes in happy arcs, a heart over its head that beats', () => {
    const rig = new MuseRig(SCULPTS.tpose6.fit);
    const head = new Matrix4();
    rig.pose(still(0, [{ kind: 'love', time: 1.4, amount: 1, side: 1 }]));
    const up = new Vector3(0, 1, 0).transformDirection(rig.frameOf(JOINT.head, head));
    expect(Math.abs(up.x)).toBeGreaterThan(0.2);
    expect(rig.squint).toBeGreaterThan(0.9);
    expect(rig.blush).toBeGreaterThan(0.8);
    expect(rig.emote.heart).toBeGreaterThan(0.99);
    const rest = rig.emote.heartSize;
    rig.pose(still(0, [{ kind: 'love', time: LOVE.beats[1] + 0.065, amount: 1, side: 1 }]));
    expect(rig.emote.heartSize).toBeGreaterThan(rest * 1.1);
    rig.pose(still(0, [{ kind: 'love', time: LOVE_LENGTH, amount: 1, side: 1 }]));
    expect(rig.emote.heart).toBe(0);
    expect(rig.squint).toBeCloseTo(0, 6);
  });

  it('sets its icon in closed form: the same moment shows the same icon, whatever came before', () => {
    const a = new MuseRig();
    const b = new MuseRig();
    const at = still(4.2, [{ kind: 'idea', time: 0.9, amount: 1 }]);
    a.pose(at);
    b.pose(still(1, [{ kind: 'love', time: 2, amount: 1 }]));
    b.pose(at);
    expect(b.emote).toEqual(a.emote);
    b.pose(still(1));
    expect(Object.values(b.emote).every((x) => x === 0)).toBe(true);
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
