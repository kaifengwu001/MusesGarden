import { BufferAttribute, BufferGeometry, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fit, PIECES } from '../../life/hut';
import { MuseRoam, type Indoors, type Room } from '../../life/museRoam';
import { COTTAGE, DOORWAY, FLOOR, OUTER } from '../../life/props';
import type { FieldParams } from '../../planet/fields';
import { generateLayout, Terrain } from '../../planet/terrain';

// Muse coming into its hut when you knock and going out when you step out
// (museRoam.ts comeIn, goOut): it walks in and out only through the door,
// which is open whenever it is in the doorway and shut once it is through;
// it keeps clear of the walls and of what stands on the floor; it gets to
// what it does there (greeting you, cooking at the hearth, asleep on its
// bed); it never jumps from one place to another or snaps round, whatever it
// was doing when you knocked; and out again its days go on from its porch.

const PARAMS: FieldParams = { roll: 1.25, hummocks: 0.35, wetlands: 0.42, waterLevel: 0, grain: 0.6, density: 10, patchiness: 0.78, patchSize: 13, weights: [0.4, 0.24, 0.22, 0.14] };
const H = 1.65;
const R = 128;

const found = import.meta.glob<string>('/src/assets/interior/*.glb', { query: '?inline', import: 'default', eager: true });

/** A GLB's first primitive's positions (a data URL), read by hand. */
function readGlb(url: string): BufferGeometry {
  const text = atob(url.slice(url.indexOf(',') + 1));
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  const view = new DataView(b.buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength))) as {
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const a = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const bv = json.bufferViews[a.bufferView];
  const offset = 20 + jsonLength + 8 + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  const position = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) position[i * 3 + k] = view.getFloat32(offset + i * stride + k * 4, true);
  return new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3));
}

// the room as Kai laid it out: what stands on the floor (the hut's own fit), and the places the garden gives Muse
// there (gardenUi.ts room, as measured in the app: the pot on the hearth's stove, the bed's middle)
const things = PIECES.filter((p) => p.name !== 'wall-shelf').map((p) => {
  const f = fit(p, readGlb(found[`/src/assets/interior/${p.url.split('/').pop() ?? ''}`])).footprint;
  return { x0: f.x - f.z, x1: f.x + f.z, z0: f.y - f.w, z1: f.y + f.w };
});
const ROOM: Room = {
  things,
  greet: { x: 0.6, z: 0.75, facing: [Math.sin(0.68), Math.cos(0.68)] },
  cook: { x: 0, z: -1.02, facing: [-Math.sin(0.96), -Math.cos(0.96)], pot: [-0.635, 1.931, -1.787] },
  bed: { x: 2.758, z: 0.396, y: 1.413, foot: [0, 1], side: [-1, 0], edge: 0.64 },
};
const SPOTS: Record<Indoors, { x: number; z: number }> = { greet: ROOM.greet, cook: ROOM.cook, sleep: ROOM.bed };

function terrainAt(radius: number, seed = 412): Terrain {
  const t = new Terrain(generateLayout(seed));
  t.update(radius, PARAMS, (2 * radius) / 512);
  return t;
}

interface Walk {
  worstStep: number;
  worstTurn: number;
  troubles: string[];
  end: { x: number; z: number; height: number };
}

/** Muse from t0 to t1 (s): its worst step and turn from one moment to the next, and where it broke the rules. */
function follow(roam: MuseRoam, terrain: Terrain, camera: Vector3, t0: number, t1: number): Walk {
  const walk: Walk = { worstStep: 0, worstTurn: 0, troubles: [], end: { x: 0, z: 0, height: 0 } };
  const c = { x: 0, z: 0 };
  let prev: Vector3 | null = null;
  let prevHeading: Vector3 | null = null;
  for (let t = t0; t <= t1 + 1e-9; t += 0.05) {
    const m = roam.at(t, camera);
    const p = m.dir.clone().multiplyScalar(R + m.height);
    if (prev) walk.worstStep = Math.max(walk.worstStep, p.distanceTo(prev));
    if (prevHeading) walk.worstTurn = Math.max(walk.worstTurn, Math.acos(Math.max(-1, Math.min(1, m.heading.dot(prevHeading)))));
    prev = p;
    prevHeading = m.heading.clone();
    terrain.cottageLocal(m.dir, c);
    const raised = m.height - terrain.cottageGround - FLOOR;
    const trouble = (what: string): void => {
      if (walk.troubles.length < 8) walk.troubles.push(`${what} at ${t.toFixed(2)} s (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
    };
    // in the house: only in its room, or in the doorway with the door open
    if (Math.abs(c.x) < OUTER.x && Math.abs(c.z) < OUTER.z) {
      const inRoom = Math.abs(c.x) < COTTAGE.halfX - COTTAGE.thickness / 2 - 0.3 && Math.abs(c.z) < COTTAGE.halfZ - COTTAGE.thickness / 2 - 0.3;
      const inDoorway = c.x > DOORWAY.x0 + 0.25 && c.x < DOORWAY.x1 - 0.25 && c.z > 0;
      if (!inRoom && !inDoorway) trouble('in a wall');
      if (!inRoom && inDoorway && Math.abs(c.z - DOORWAY.z) < 0.5 && roam.doorAt(t) < 0.9) trouble('the door not open');
      // standing on the floor, clear of what stands there (on its bed it is up off the floor)
      if (raised < 0.2) for (const k of things) if (c.x > k.x0 + 0.1 && c.x < k.x1 - 0.1 && c.z > k.z0 + 0.1 && c.z < k.z1 - 0.1) trouble('in the furniture');
    }
    walk.end = { x: c.x, z: c.z, height: raised };
  }
  return walk;
}

describe('Muse coming into its hut and going out', { timeout: 60_000 }, () => {
  const terrain = terrainAt(R);
  const camera = terrain.layout.cottage.clone().multiplyScalar(R + 30);
  // (whatever it is doing when you knock: knocks spread over its day)
  const knocks = [40, 333, 777, 1234, 1888, 2600];
  const doings: Indoors[] = ['greet', 'cook', 'sleep'];

  knocks.forEach((t0, i) => {
    const doing = doings[i % 3];
    it(`knocked at ${t0} s: walks in through the door to ${doing}, and out again onto its porch`, () => {
      const roam = new MuseRoam(terrain, H);
      roam.at(t0 - 1, camera);
      roam.comeIn(t0, doing, ROOM);
      const inside = follow(roam, terrain, camera, t0 - 1, t0 + 180);
      expect(inside.troubles).toEqual([]);
      // a waddle, a hop: no jumps, no snaps round
      expect(inside.worstStep).toBeLessThan(0.2);
      expect(inside.worstTurn).toBeLessThan(0.25);
      // at what it does there, the door shut behind it
      const spot = SPOTS[doing];
      expect(Math.hypot(inside.end.x - spot.x, inside.end.z - spot.z), `${doing}: at (${inside.end.x.toFixed(2)}, ${inside.end.z.toFixed(2)})`).toBeLessThan(doing === 'sleep' ? 0.4 : 0.15);
      if (doing === 'sleep') expect(inside.end.height).toBeGreaterThan(0.5);
      expect(roam.doorAt(t0 + 180)).toBe(0);
      // out again: through the door, onto its porch, the door shut, and on with its days
      roam.goOut(t0 + 180);
      const out = follow(roam, terrain, camera, t0 + 180, t0 + 240);
      expect(out.troubles).toEqual([]);
      expect(out.worstStep).toBeLessThan(0.2);
      expect(out.worstTurn).toBeLessThan(0.25);
      expect(roam.doorAt(t0 + 240)).toBe(0);
      const parts = roam.names.filter((n) => n.start >= t0 + 180).map((n) => n.name);
      expect(parts).toContain('out');
      expect(parts.length - parts.indexOf('look about')).toBeGreaterThan(2);
    });
  });

  it('stepped out of before it got in: it goes on with its days from where it was', () => {
    for (const t0 of [100, 900, 2222]) {
      const roam = new MuseRoam(terrain, H);
      roam.at(t0 - 1, camera);
      roam.comeIn(t0, 'cook', ROOM);
      roam.goOut(t0 + 2);
      const w = follow(roam, terrain, camera, t0 - 1, t0 + 60);
      expect(w.troubles, `${t0}`).toEqual([]);
      expect(w.worstStep, `${t0}`).toBeLessThan(0.2);
      expect(w.worstTurn, `${t0}`).toBeLessThan(0.25);
    }
  });

  it('keeps its door shut while it is out about its days', () => {
    const roam = new MuseRoam(terrain, H);
    for (let t = 0; t < 1800; t += 0.5) {
      roam.at(t, camera);
      expect(roam.doorAt(t), `at ${t} s`).toBe(0);
    }
  });
});
