import { BufferAttribute, BufferGeometry, type Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { placeholderSource } from '../../garden/placeholder';
import type { GardenSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import { fit, PIECES, ROOM, type Piece } from '../../life/hut';
import { CUT, cutAt, FLOOR, OUTER, STEPS } from '../../life/props';

// Muse's hut inside (hut.ts, view/cutaway.ts): the furniture Kai made in
// Tripo fitted into the room as Kai laid it out, the walls cut straight, the
// steps clear of the meadow, and Muse's favourites for its showpiece.

const found = import.meta.glob<string>('/src/assets/interior/*.glb', { query: '?inline', import: 'default', eager: true });

/** A GLB's first primitive (a data URL), read by hand: its positions and indices. */
function readGlb(url: string): BufferGeometry {
  const text = atob(url.slice(url.indexOf(',') + 1));
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  const view = new DataView(b.buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLength))) as {
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
    bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  };
  const bin = 20 + jsonLength + 8;
  const a = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const bv = json.bufferViews[a.bufferView];
  const offset = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  const position = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) position[i * 3 + k] = view.getFloat32(offset + i * stride + k * 4, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  return g;
}

const fitted = PIECES.map((piece) => {
  const file = `/src/assets/interior/${piece.url.split('/').pop() ?? ''}`;
  const glb = found[file];
  return { piece, footprint: glb ? fit(piece, readGlb(glb)).footprint : null };
});

const named = (name: string): { piece: Piece; footprint: Vector4 } => {
  const f = fitted.find((p) => p.piece.name === name);
  if (!f?.footprint) throw new Error(`no ${name}`);
  return { piece: f.piece, footprint: f.footprint };
};

describe('Muse’s hut inside', () => {
  it('has every model it lays out, in the project', () => {
    for (const { piece, footprint } of fitted) expect(footprint, piece.name).not.toBeNull();
  });

  it('stands every piece inside the room, clear of its walls', () => {
    for (const { piece, footprint: f } of fitted) {
      if (!f) continue;
      expect(f.x - f.z, piece.name).toBeGreaterThanOrEqual(-ROOM.x - 1e-6);
      expect(f.x + f.z, piece.name).toBeLessThanOrEqual(ROOM.x + 1e-6);
      expect(f.y - f.w, piece.name).toBeGreaterThanOrEqual(-ROOM.z - 1e-6);
      expect(f.y + f.w, piece.name).toBeLessThanOrEqual(ROOM.z + 1e-6);
    }
  });

  it('stands nothing on the floor inside another', () => {
    const resting = fitted.filter((p) => p.piece.rests && p.footprint);
    for (let i = 0; i < resting.length; i++) {
      for (let j = i + 1; j < resting.length; j++) {
        const a = resting[i].footprint!;
        const b = resting[j].footprint!;
        const overlap = Math.min(a.z + b.z - Math.abs(a.x - b.x), a.w + b.w - Math.abs(a.y - b.y));
        expect(overlap, `${resting[i].piece.name} and ${resting[j].piece.name}`).toBeLessThan(0.05);
      }
    }
  });

  it('lays the room out as Kai asked: the showpiece along the left wall, the hearth in the middle of the back, the bed in the back corner on the right, the low shelf along the right end, the desk under the front window', () => {
    const show = named('display-cabinet').footprint;
    expect(show.x - show.z).toBeCloseTo(-ROOM.x + 0.02, 2);
    expect(2 * show.w).toBeGreaterThan(0.55 * 2 * ROOM.z);
    expect(PIECES.filter((p) => p.showpiece)).toHaveLength(1);
    const hearth = named('wood-stove').footprint;
    expect(hearth.y - hearth.w).toBeCloseTo(-ROOM.z, 2);
    expect(Math.abs(hearth.x - 0.1)).toBeLessThan(0.05);
    const bed = named('single-bed').footprint;
    expect(bed.x + bed.z).toBeCloseTo(ROOM.x - 0.02, 2);
    expect(bed.y - bed.w).toBeCloseTo(-ROOM.z + 0.02, 2);
    const shelf = named('display-shelf').footprint;
    expect(shelf.x + shelf.z).toBeCloseTo(ROOM.x - 0.02, 2);
    expect(shelf.y).toBeGreaterThan(0);
    const desk = named('work-desk').footprint;
    expect(desk.y + desk.w).toBeCloseTo(ROOM.z - 0.02, 2);
    // the pots and pans hang high over the stove
    expect(Math.abs(named('wall-shelf').footprint.x - hearth.x)).toBeLessThan(0.05);
  });

  it('cuts the walls straight: the front and the right end low, over the front’s lintels; the back and the left end whole', () => {
    expect(cutAt(0, OUTER.z)).toBe(CUT.front);
    expect(cutAt(OUTER.x, 0)).toBe(CUT.front);
    expect(cutAt(0, -OUTER.z)).toBe(CUT.back);
    expect(cutAt(-OUTER.x, 0)).toBe(CUT.back);
    // the corners go with the whole walls, but for the front's right one
    expect(cutAt(-OUTER.x + 0.1, OUTER.z - 0.1)).toBe(CUT.back);
    expect(cutAt(OUTER.x - 0.1, -OUTER.z + 0.1)).toBe(CUT.back);
    expect(cutAt(OUTER.x - 0.1, OUTER.z - 0.1)).toBe(CUT.front);
    // over the door and the window (2.15 m up), under the eaves
    expect(CUT.front - FLOOR).toBeGreaterThan(2.15);
    expect(CUT.back).toBeGreaterThan(CUT.front);
  });

  it('stands the last step a riser over the meadow, not flush with it', () => {
    const last = FLOOR - STEPS.rise * STEPS.count;
    expect(last).toBeCloseTo(STEPS.rise, 6);
    expect(last).toBeGreaterThan(0.1);
  });
});

describe('Muse’s favourites', () => {
  it('are the ones the gallery names, in its order', async () => {
    const state = new GardenState(placeholderSource());
    await state.start();
    const ids = state.favourites;
    expect(ids.length).toBeGreaterThanOrEqual(12);
    for (const id of ids) expect(state.find(id), id).toBeDefined();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('without them from the source, are picked: one a topic, newest first', async () => {
    const base = placeholderSource();
    const source: GardenSource = {
      ...base,
      load: async () => {
        const snap = await base.load();
        return { ...snap, favourites: undefined };
      },
    };
    const state = new GardenState(source);
    await state.start();
    const ids = state.favourites;
    const topics = ids.map((id) => state.find(id)?.topic);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(12);
    expect(new Set(topics).size).toBe(topics.length);
    expect(ids[0]).toBe(state.browseOrder[0]);
  });
});
