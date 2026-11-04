import { describe, expect, it } from 'vitest';
import { ANCHORS, FloorView, free, keepClear, keepsakeSpot, place, proportionalRoom, ROOM, type Found, type RoomInfo, type Sample } from './place';

// Placing the home's pieces: the floor seen through a camera posed as the cutaway's (view/cutaway.ts VIEW: 0.68 rad
// round from the front, 1.2 rad up, a 15° view 7.2 m half-high, looking at -0.8, floor + 0.5, 1.2), pieces kept clear
// of the bed, the hearth, the showpiece, the door's way and the greeting spot, and the anchors checked against the
// meadow's own hut.

const VIEW = { azimuth: 0.68, elevation: 1.2, fov: 15, size: 7.2, at: [-0.8, ROOM.floor + 0.5, 1.2] } as const;
const SIZE = { width: 1405, height: 860 } as const;
/** How a piece out on the floor stands: facing the view (0.68 rad to the nearest 15°). */
const TURN = Math.PI / 4;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A pinhole camera posed as the cutaway's: a room point (local m) to the picture (0 … 1). */
function camera(): (p: V3) => [number, number] {
  const c = Math.cos(VIEW.elevation);
  const toward: V3 = [Math.sin(VIEW.azimuth) * c, Math.sin(VIEW.elevation), Math.cos(VIEW.azimuth) * c];
  const tan = Math.tan((VIEW.fov * Math.PI) / 360);
  const distance = VIEW.size / tan;
  const at = VIEW.at as unknown as V3;
  const eye: V3 = [at[0] + toward[0] * distance, at[1] + toward[1] * distance, at[2] + toward[2] * distance];
  const forward = unit(sub(at, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const aspect = SIZE.width / SIZE.height;
  return (p) => {
    const d = sub(p, eye);
    const z = dot(d, forward);
    return [0.5 + dot(d, right) / (z * tan * aspect) / 2, 0.5 - dot(d, up) / (z * tan) / 2];
  };
}

function room(): RoomInfo {
  const see = camera();
  const samples: Sample[] = [];
  for (const y of [0, 1] as const)
    for (const x of [-ROOM.x, -ROOM.x / 2, 0, ROOM.x / 2, ROOM.x])
      for (const z of [-ROOM.z, 0, ROOM.z]) {
        const [u, v] = see([x, ROOM.floor + y, z]);
        samples.push({ x, z, y, u, v });
      }
  return { samples, anchors: ANCHORS, showpiece: proportionalRoom().showpiece };
}

/** The box (pixels) a w × h × d block standing at (x, z), turned (rad: as a piece out on the floor faces the view), shows in the picture. */
function boxOf(x: number, z: number, w: number, h: number, d: number, turn = TURN): [number, number, number, number] {
  const see = camera();
  const us: number[] = [];
  const vs: number[] = [];
  for (let k = 0; k < 8; k++) {
    const [a, b] = [k & 1 ? w / 2 : -w / 2, k & 4 ? d / 2 : -d / 2];
    const [u, v] = see([x + a * Math.cos(turn) + b * Math.sin(turn), ROOM.floor + (k & 2 ? h : 0), z - a * Math.sin(turn) + b * Math.cos(turn)]);
    us.push(u * SIZE.width);
    vs.push(v * SIZE.height);
  }
  return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
}

const block = (name: string, x: number, z: number, w: number, h: number, d: number, turn = TURN): Found => ({ name, box: boxOf(x, z, w, h, d, turn), ...SIZE, model: { x: w, y: h, z: d } });

describe('the floor through the cutaway’s camera', () => {
  it('maps the floor to the picture and back exactly (a homography from the samples)', () => {
    const info = room();
    const view = new FloorView(info.samples);
    const see = camera();
    for (const [x, z] of [[-3, -2], [0.4, 1.1], [3.5, 2], [-1.2, 0]]) {
      const [u, v] = see([x, ROOM.floor, z]);
      const [px, pz] = view.toPicture(x, z);
      expect(px).toBeCloseTo(u, 6);
      expect(pz).toBeCloseTo(v, 6);
      const [bx, bz] = view.toFloor(u, v);
      expect(bx).toBeCloseTo(x, 4);
      expect(bz).toBeCloseTo(z, 4);
    }
  });

  it('stands a piece in open floor about where the picture has it, about as tall as it is', () => {
    // (both on floor clear of everything Muse needs, so neither is moved)
    const [p] = place([block('armchair', -1.5, 1.6, 0.8, 1.0, 0.8)], room());
    expect(p).not.toBeNull();
    expect(Math.hypot(p!.x + 1.5, p!.z - 1.6)).toBeLessThan(0.3);
    expect(p!.height).toBeGreaterThan(0.8);
    expect(p!.height).toBeLessThan(1.25);
    const [lamp] = place([block('floor lamp', -1.0, 0.1, 0.4, 1.7, 0.4)], room());
    expect(Math.hypot(lamp!.x + 1.0, lamp!.z - 0.1)).toBeLessThan(0.3);
    expect(lamp!.height).toBeGreaterThan(1.35);
    expect(lamp!.height).toBeLessThan(2.1);
  });

  it('keeps every piece clear of the bed, the hearth, the showpiece, the door’s way and the greeting spot', () => {
    const zones = keepClear(ANCHORS);
    const onThem = [
      block('on the bed', 3.0, -0.8, 0.8, 1, 0.8),
      block('at the hearth', -0.5, -1.0, 0.8, 1, 0.8),
      block('in the doorway', 1.0, 1.9, 0.8, 1, 0.8),
      block('on the greeting spot', 0.6, 0.75, 0.6, 0.9, 0.6),
      block('before the showpiece', -2.9, -0.4, 0.6, 1, 0.6),
    ];
    const placed = place(onThem, room());
    const rects = placed.map((p) => p?.rect).filter((r) => r !== undefined);
    expect(rects.length).toBeGreaterThan(0);
    placed.forEach((p, k) => {
      if (!p) return;
      expect(free(p.rect, zones, []), onThem[k].name).toBe(true);
      // and of each other
      for (const r of rects) if (r !== p.rect) expect(p.rect.x1 <= r.x0 || p.rect.x0 >= r.x1 || p.rect.z1 <= r.z0 || p.rect.z0 >= r.z1).toBe(true);
    });
  });

  it('keeps pieces within the walls and their heights within reason', () => {
    const placed = place([block('wardrobe', -3.8, 2.2, 1.6, 2.6, 0.7), block('tiny', -2, 1, 0.1, 0.1, 0.1)], room());
    for (const p of placed) {
      expect(p).not.toBeNull();
      expect(p!.rect.x0).toBeGreaterThanOrEqual(-ROOM.x);
      expect(p!.rect.z1).toBeLessThanOrEqual(ROOM.z);
      expect(p!.height).toBeGreaterThanOrEqual(0.3);
      expect(p!.height).toBeLessThanOrEqual(2.3);
    }
  });

  it('turns a piece by a wall away from it, one out on the floor toward the view', () => {
    const [byWall, out] = place([block('by the front wall', -2.4, 2.0, 0.6, 1, 0.4, Math.PI), block('out', -2.0, 0.6, 0.4, 0.8, 0.4)], room());
    expect(byWall!.turn).toBeCloseTo(Math.PI, 3);
    // (the view's bearing, 0.68 rad, to the nearest 15°)
    expect(out!.turn).toBeCloseTo((45 * Math.PI) / 180, 3);
  });

  it('works from the proportional stand-in when there is no camera', () => {
    const [p] = place([{ name: 'chair', box: [150, 500, 250, 640], width: 1405, height: 860, model: { x: 1, y: 1, z: 1 } }], proportionalRoom());
    expect(p).not.toBeNull();
  });

  it('puts a keepsake on the showpiece’s bottom shelf', () => {
    const info = room();
    const s = keepsakeSpot(info, 0.28);
    const box = info.showpiece!;
    expect(s.x).toBeGreaterThan(box.min[0]);
    expect(s.x).toBeLessThan(box.max[0]);
    expect(s.z).toBeGreaterThan(box.min[2]);
    expect(s.z).toBeLessThan(box.max[2]);
    expect(s.lift).toBeGreaterThan(0.5);
  });
});

describe('the room as the meadow lays it out', () => {
  it('matches hut.ts: the room’s size and the anchors’ footprints', async () => {
    // (by a computed path, so the server's type check doesn't follow the browser code)
    const hut = (await import(['..', '..', '..', 'src', 'life', 'hut'].join('/'))) as {
      ROOM: { x: number; z: number; floor: number };
      PIECES: ReadonlyArray<{ name: string; url: string }>;
      fit: (piece: unknown, geometry: unknown) => { footprint: { x: number; y: number; z: number; w: number } };
    };
    const three = (await import(['three'].join(''))) as { BufferGeometry: new () => { setAttribute: (n: string, a: unknown) => void }; BufferAttribute: new (a: Float32Array, n: number) => unknown };
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    expect(hut.ROOM.x).toBeCloseTo(ROOM.x, 6);
    expect(hut.ROOM.z).toBeCloseTo(ROOM.z, 6);
    expect(hut.ROOM.floor).toBeCloseTo(ROOM.floor, 6);
    for (const anchor of ANCHORS) {
      const piece = hut.PIECES.find((p) => p.name === anchor.name)!;
      const glb = readFileSync(fileURLToPath(new URL(`../../../src/assets/interior/${anchor.name}.glb`, import.meta.url)));
      const jsonLength = glb.readUInt32LE(12);
      const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as {
        meshes: { primitives: { attributes: Record<string, number> }[] }[];
        accessors: { bufferView: number; byteOffset?: number; count: number }[];
        bufferViews: { byteOffset?: number; byteStride?: number }[];
      };
      const a = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
      const bv = json.bufferViews[a.bufferView];
      const at = 20 + jsonLength + 8 + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const position = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) position[i * 3 + k] = glb.readFloatLE(at + i * (bv.byteStride ?? 12) + k * 4);
      const g = new three.BufferGeometry();
      g.setAttribute('position', new three.BufferAttribute(position, 3));
      const f = hut.fit(piece, g).footprint;
      const fitted = [f.x - f.z, f.x + f.z, f.y - f.w, f.y + f.w];
      [anchor.rect.x0, anchor.rect.x1, anchor.rect.z0, anchor.rect.z1].forEach((v, k) => expect(fitted[k], anchor.name).toBeCloseTo(v, 2));
    }
  });
});
