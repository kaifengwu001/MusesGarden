import { describe, expect, it } from 'vitest';
import { buildMuseBody, JOINT, JOINTS, museField, SKIN_INSET } from '../../life/museBody';
import { blink, MuseRig, STEP, type MuseAction } from '../../life/museRig';

const body = buildMuseBody();
const count = body.position.length / 3;

const still = (time: number): MuseAction => ({ time, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0 });

describe('Muse', () => {
  it('is one closed skin, a height tall, standing on the ground', () => {
    const edges = new Map<string, number>();
    for (let t = 0; t < body.index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = body.index[t + k];
        const b = body.index[t + ((k + 1) % 3)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const n of edges.values()) expect(n).toBe(2);
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < count; i++) {
      low = Math.min(low, body.position[i * 3 + 1]);
      high = Math.max(high, body.position[i * 3 + 1]);
    }
    expect(low).toBeCloseTo(0, 2);
    expect(high).toBeCloseTo(1 - SKIN_INSET, 2);
  });

  it('keeps the reference silhouette: the hood and belly as wide as measured, less the fur', () => {
    // half-widths measured off reference/muse/1.webp (fur included), at heights of 0.8 and 0.3
    expect(Math.abs(museField(0.2535 - SKIN_INSET, 0.8, 0))).toBeLessThan(0.006);
    expect(Math.abs(museField(-(0.2535 - SKIN_INSET), 0.8, 0))).toBeLessThan(0.006);
    expect(museField(0.25, 0.3, 0)).toBeLessThan(0);
    // the arms hang clear of the belly below the elbow (the mesh keeps them apart)
    expect(museField(0.3, 0.32, 0)).toBeGreaterThan(0);
  });

  it('weights every vertex fully, by at most four joints, with no fur on the face or the soles', () => {
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        expect(body.skinIndex[i * 4 + k]).toBeLessThan(JOINTS);
        sum += body.skinWeight[i * 4 + k];
      }
      expect(sum).toBeCloseTo(1, 4);
      const y = body.position[i * 3 + 1];
      if (y < 0.002) expect(body.fur[i]).toBeLessThan(0.05);
    }
    // the middle of the face: skin, no fur
    let face = Infinity;
    for (let i = 0; i < count; i++) {
      const x = body.position[i * 3];
      const y = body.position[i * 3 + 1];
      const z = body.position[i * 3 + 2];
      if (z > 0.1 && Math.abs(x) < 0.05 && Math.abs(y - 0.77) < 0.03) face = Math.min(face, body.fur[i]);
    }
    expect(face).toBeLessThan(0.05);
  });

  it('keeps a planted foot planted: it slides back under the body exactly as far as the body walks on', () => {
    const rig = new MuseRig();
    const at = (gait: number): number => {
      rig.pose({ ...still(3), walk: 1, gait });
      // the left foot's place under Muse, plus how far Muse has walked
      return rig.skin[JOINT.legL].elements[14] + gait * 2 * STEP.length;
    };
    // the left foot is down for the second half of each cycle
    const first = at(0.55);
    for (const g of [0.62, 0.7, 0.8, 0.9, 0.98]) expect(at(g)).toBeCloseTo(first, 6);
  });

  it('is posed in closed form: the same time draws the same pose', () => {
    const a = new MuseRig();
    const b = new MuseRig();
    a.pose({ ...still(17.3), wave: 1.1 });
    b.pose(still(2));
    b.pose({ ...still(17.3), wave: 1.1 });
    for (let j = 0; j < JOINTS; j++) expect(Array.from(a.skin[j].elements)).toEqual(Array.from(b.skin[j].elements));
    expect(blink(12.4)).toBe(blink(12.4));
  });

  it('mostly has its eyes open', () => {
    let shut = 0;
    for (let t = 0; t < 600; t += 0.01) if (blink(t) < 0.5) shut++;
    expect(shut / 60000).toBeLessThan(0.06);
  });
});
