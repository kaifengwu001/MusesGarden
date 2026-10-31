import { describe, expect, it } from 'vitest';
import { JOINT } from '../../life/museBody';
import { rigSculpt, SCULPTS, type Sculpt, type SculptKind } from '../../life/museMesh';
import { MuseRig } from '../../life/museRig';

// The Tripo sculpts rigged on Muse's skeleton (museMesh.ts): its first (arms
// hanging, grown into the sides) and its T-poses (src/assets/muse/).
const found = import.meta.glob<string>('/src/assets/muse/{tripo,tripo-tpose,tripo-tpose2,tripo-tpose5,tripo-tpose6}.glb', { query: '?inline', import: 'default', eager: true });
const GLBS: Record<SculptKind, string | undefined> = {
  tripo: found['/src/assets/muse/tripo.glb'],
  tpose: found['/src/assets/muse/tripo-tpose.glb'],
  tpose2: found['/src/assets/muse/tripo-tpose2.glb'],
  tpose5: found['/src/assets/muse/tripo-tpose5.glb'],
  tpose6: found['/src/assets/muse/tripo-tpose6.glb'],
};
/** Where each sculpt's left arm is as made (H): out past x, between two heights. */
/** How high each sculpt's armpits are (H): its sides below them are the body's alone. */
const ARMPIT: Record<SculptKind, number> = { tripo: 0.34, tpose: 0.42, tpose2: 0.42, tpose5: 0.36, tpose6: 0.34 };
const ARM_AT: Record<SculptKind, { x: number; y: [number, number] }> = {
  tripo: { x: 0.34, y: [0.18, 0.42] },
  tpose: { x: 0.34, y: [0.45, 0.68] },
  tpose2: { x: 0.34, y: [0.42, 0.62] },
  tpose5: { x: 0.45, y: [0.22, 0.45] },
  tpose6: { x: 0.34, y: [0.38, 0.56] },
};

/** The first primitive of a GLB (a data URL), read by hand: positions, normals, uvs, indices. */
function readGlb(url: string): { position: Float32Array; normal: Float32Array; uv: Float32Array; index: Uint16Array | Uint32Array } {
  const text = atob(url.slice(url.indexOf(',') + 1));
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  const view = new DataView(b.buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength))) as {
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const bin = 20 + jsonLength + 8;
  const size: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const read = (i: number): Float32Array | Uint16Array | Uint32Array => {
    const a = json.accessors[i];
    const offset = bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * size[a.type];
    const copy = b.buffer.slice(offset, offset + n * (a.componentType === 5123 ? 2 : 4));
    return a.componentType === 5126 ? new Float32Array(copy) : a.componentType === 5123 ? new Uint16Array(copy) : new Uint32Array(copy);
  };
  const p = json.meshes[0].primitives[0];
  return { position: read(p.attributes.POSITION) as Float32Array, normal: read(p.attributes.NORMAL) as Float32Array, uv: read(p.attributes.TEXCOORD_0) as Float32Array, index: read(p.indices) as Uint16Array | Uint32Array };
}

for (const kind of ['tripo', 'tpose', 'tpose2', 'tpose5', 'tpose6'] as const) describe.skipIf(!GLBS[kind])(`Muse from the Tripo sculpt (${kind})`, () => {
  const glb = GLBS[kind];
  const g = glb ? readGlb(glb) : null;
  const m = g ? rigSculpt(g.position, g.normal, g.uv, g.index, undefined, SCULPTS[kind]) : null;

  it('stands in Muse’s frame: feet on the ground, a height tall, centred', () => {
    if (!m) return;
    let low = Infinity;
    let high = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) {
      low = Math.min(low, m.position[i + 1]);
      high = Math.max(high, m.position[i + 1]);
      left = Math.min(left, m.position[i]);
      right = Math.max(right, m.position[i]);
    }
    expect(low).toBeGreaterThan(-0.002);
    expect(high).toBeGreaterThan(0.97);
    expect(high).toBeLessThanOrEqual(1.0001);
    expect(left + right).toBeCloseTo(0, 2);
  });

  it('hangs its arms on the arms’ joints and its legs on the legs’', () => {
    if (!m) return;
    const arms = new Set<number>([JOINT.upperArmL, JOINT.foreArmL, JOINT.upperArmR, JOINT.foreArmR]);
    let onArms = 0;
    let armVertices = 0;
    let onLegs = 0;
    let legVertices = 0;
    for (let i = 0; i < m.position.length / 3; i++) {
      const x = Math.abs(m.position[i * 3]);
      const y = m.position[i * 3 + 1];
      let arm = 0;
      let leg = 0;
      for (let k = 0; k < 4; k++) {
        const j = m.skinIndex[i * 4 + k];
        if (arms.has(j)) arm += m.skinWeight[i * 4 + k];
        if (j === JOINT.legL || j === JOINT.legR) leg += m.skinWeight[i * 4 + k];
      }
      // well out at the sides where the arms are as made: the arms (the front silhouette shows nothing else there)
      if (x > ARM_AT[kind].x && y > ARM_AT[kind].y[0] && y < ARM_AT[kind].y[1]) {
        armVertices++;
        onArms += arm;
      }
      if (y < 0.06) {
        legVertices++;
        onLegs += leg;
      }
    }
    expect(armVertices).toBeGreaterThan(50);
    expect(onArms / armVertices).toBeGreaterThan(0.9);
    expect(onLegs / legVertices).toBeGreaterThan(0.9);
  });

  it('grows no fur on the face’s plate, nor on the soles', () => {
    if (!m) return;
    let plate = 0;
    for (let i = 0; i < m.position.length / 3; i++) {
      const x = m.position[i * 3];
      const y = m.position[i * 3 + 1];
      const z = m.position[i * 3 + 2];
      if (Math.abs(x) < 0.05 && Math.abs(y - 0.77) < 0.03 && z > 0.15) {
        plate++;
        expect(m.fur[i]).toBe(0);
      }
      if (y < 0.001) expect(m.fur[i]).toBeLessThan(0.01);
    }
    expect(plate).toBeGreaterThan(5);
  });

  it('keeps the arms’ weight off the body’s sides, below the armpits and over the belly', () => {
    if (!m) return;
    // the sides below the armpits and the belly between them: only the body's joints move them
    const arms = new Set<number>([JOINT.upperArmL, JOINT.foreArmL, JOINT.upperArmR, JOINT.foreArmR]);
    let side = 0;
    for (let i = 0; i < m.position.length / 3; i++) {
      const x = Math.abs(m.position[i * 3]);
      const y = m.position[i * 3 + 1];
      if (x > 0.25 || y < 0.12 || y > ARMPIT[kind]) continue;
      side++;
      let arm = 0;
      for (let k = 0; k < 4; k++) if (arms.has(m.skinIndex[i * 4 + k])) arm += m.skinWeight[i * 4 + k];
      expect(arm).toBeLessThan(0.01);
    }
    expect(side).toBeGreaterThan(200);
  });

  it('is refined without cracks: no more holes in it than the sculpt had', () => {
    if (!m || !g) return;
    // the holes: loops of edges with one triangle (welded by position, across the sculpt's seams)
    const holes = (position: ArrayLike<number>, index: ArrayLike<number>): number => {
      const ids = new Map<string, number>();
      const id = (i: number): number => {
        const key = `${position[i * 3].toFixed(5)},${position[i * 3 + 1].toFixed(5)},${position[i * 3 + 2].toFixed(5)}`;
        if (!ids.has(key)) ids.set(key, ids.size);
        return ids.get(key) ?? -1;
      };
      const edges = new Map<string, number>();
      for (let t = 0; t < index.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = id(index[t + e]);
          const b = id(index[t + ((e + 1) % 3)]);
          if (a === b) continue;
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      const parent = new Map<number, number>();
      const find = (v: number): number => {
        while (parent.get(v) !== v) v = parent.get(v) ?? v;
        return v;
      };
      for (const [key, n] of edges) {
        if (n !== 1) continue;
        const [a, b] = key.split(',').map(Number);
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
        parent.set(find(a), find(b));
      }
      return new Set([...parent.keys()].map(find)).size;
    };
    // (the eyes and the mouth left out take their own rims with them)
    expect(holes(m.position, m.index)).toBeLessThanOrEqual(holes(g.position, g.index));
  });

  it('hangs its arms beside the belly, and waves with the left up beside the hood, the corrective only about that shoulder (and its mirror)', () => {
    if (!m) return;
    // the left hand: the forearm's point farthest from the shoulder
    const fit = SCULPTS[kind].fit;
    const shoulder = fit.rest[JOINT.upperArmL];
    const far = (i: number): number => Math.hypot(m.position[i * 3] - shoulder[0], m.position[i * 3 + 1] - shoulder[1], m.position[i * 3 + 2] - shoulder[2]);
    let hand = -1;
    for (let i = 0; i < m.position.length / 3; i++) {
      if (m.skinIndex[i * 4] !== JOINT.foreArmL || m.skinWeight[i * 4] < 0.99) continue;
      if (hand < 0 || far(i) > far(hand)) hand = i;
    }
    expect(hand).toBeGreaterThanOrEqual(0);
    const rig = new MuseRig(fit);
    rig.pose({ time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0 });
    const idle = rig.deform(m.position, m.skinIndex, m.skinWeight, new Float32Array(m.position.length));
    expect(idle[hand * 3 + 1]).toBeLessThan(0.35);
    expect(idle[hand * 3]).toBeGreaterThan(0.25);
    rig.raiseLeft();
    const posed = rig.deform(m.position, m.skinIndex, m.skinWeight, new Float32Array(m.position.length));
    // up past the eyes, out beside the hood
    expect(posed[hand * 3 + 1]).toBeGreaterThan(0.75);
    expect(posed[hand * 3]).toBeGreaterThan(0.25);
    expect(posed[hand * 3]).toBeLessThan(0.55);
    // a T-pose's hung corrective: about the two shoulders only, and slight
    if (m.hang) {
      for (let i = 0; i < m.position.length / 3; i++) {
        const d = Math.hypot(m.hang[i * 3], m.hang[i * 3 + 1], m.hang[i * 3 + 2]);
        expect(d).toBeLessThan(0.05);
        if (Math.abs(m.position[i * 3]) < 0.1 || m.position[i * 3 + 1] < 0.25 || m.position[i * 3 + 1] > 0.85) expect(d).toBe(0);
      }
    }
    // the corrective: about the left shoulder, none far from it nor on the right side; where the right side is made
    // the left's mirror, the right shoulder has the left's, mirrored (so either arm can go up)
    const mirrored = (SCULPTS[kind] as Sculpt).mirrorArm === true;
    const most = [0, 0];
    const raise = m.raise ?? new Float32Array(m.position.length);
    for (let i = 0; i < m.position.length / 3; i++) {
      const d = Math.hypot(raise[i * 3], raise[i * 3 + 1], raise[i * 3 + 2]);
      const right = m.position[i * 3] < 0;
      most[right ? 1 : 0] = Math.max(most[right ? 1 : 0], d);
      if ((right && !mirrored) || m.position[i * 3 + 1] < 0.2 || m.position[i * 3 + 1] > 0.85) expect(d).toBe(0);
    }
    // (it slides the skin along the surface too, evening its stretch out: up to a tenth of the height)
    expect(most[0]).toBeGreaterThan(0);
    expect(most[0]).toBeLessThan(0.12);
    if (mirrored) expect(most[1]).toBeCloseTo(most[0], 1);
  });
});
