// Where the home's new pieces stand in Muse's room (the hut inside: src/life/hut.ts). A piece is found as a box in
// the furnished picture; the cutaway's camera (src/view/cutaway.ts) maps the room's floor onto the picture, so the
// box's foot gives its place on the floor and its size its height. Then it is kept clear of what Muse needs: its
// bed, its hearth, its showpiece, the front door's way in and the spot on the rug where it greets you; the roomier
// aprons round them too, when that moves it only a little.
// All in the homestead's local metres: x across the front, z toward the pond, y over the clearing.

/** The room inside the walls (hut.ts ROOM): half its width and depth to the walls' inner faces, its floor's height. */
export const ROOM = { x: 3.94, z: 2.27, floor: 0.72 } as const;

/** A box on the floor (local m). */
export interface Rect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** A piece of the meadow's room that a Muse's home keeps, and what stands on the floor round it. */
export interface Anchor {
  readonly name: string;
  readonly rect: Rect;
  /** How high it stands (m over the floor). */
  readonly top: number;
}

/**
 * The meadow's pieces a home keeps: Muse sleeps on the bed (hut.ts bedAt finds it by name), cooks at the hearth's
 * stove (its fire) and keeps its favourites in the showpiece; without the first two it can't go about its room.
 */
export const KEEP = ['wood-stove', 'single-bed', 'display-cabinet'] as const;

/** Their footprints as the meadow lays them out (hut.ts fit; checked against it in place.test.ts). */
export const ANCHORS: readonly Anchor[] = [
  { name: 'wood-stove', rect: { x0: -1.965, x1: 0.865, z0: -2.525, z1: -1.295 }, top: 2.69 },
  { name: 'single-bed', rect: { x0: 2.039, x1: 4.061, z0: -2.23, z1: 0.73 }, top: 1.73 },
  { name: 'display-cabinet', rect: { x0: -4.014, x1: -3.266, z0: -1.775, z1: 0.975 }, top: 3.24 },
];

/** Floor out from each side of an anchor's footprint (m). */
interface Margins {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * The floor kept clear round each anchor where there's room (m out from each side of its footprint): in front of the
 * stove where it cooks and a little either side, the side of the bed toward the room's middle where it climbs in, in
 * front of the showpiece where the camera looks at its shelves and a little past each end.
 */
const APRON: Readonly<Record<string, Margins>> = {
  'wood-stove': { x0: 0.35, x1: 0.45, z0: 0, z1: 1.05 },
  'single-bed': { x0: 0.85, x1: 0, z0: 0, z1: 0.35 },
  'display-cabinet': { x0: 0, x1: 0.7, z0: 0.2, z1: 0.2 },
};

/**
 * The floor Muse can't do without round each anchor, kept clear always: in front of the stove across its own width,
 * the bed's side and foot, and in front of the showpiece only along where its favourites stand (`ends`: the share of
 * its length, z, left off each end; hut.ts COLUMNS 0.14 … 0.86).
 */
const NEED: Readonly<Record<string, Margins & { readonly ends?: number }>> = {
  'wood-stove': { x0: 0, x1: 0, z0: 0, z1: 1.05 },
  'single-bed': { x0: 0.85, x1: 0, z0: 0, z1: 0.35 },
  'display-cabinet': { x0: 0, x1: 0.7, z0: 0, z1: 0, ends: 0.14 },
};

/**
 * The rest of the floor Muse walks: in through the front door (props.ts DOORWAY: its opening across 0.30 … 1.65 m,
 * the door swinging 1.35 m into the room on its hinge, Muse's arms 0.6 m either side of its middle), and on the rug
 * where it greets you (gardenUi.ts INSIDE: 0.6, 0.75). The bench stands outside against the front wall, past the
 * room's floor, so nothing in the room comes near it.
 */
const WAYS: readonly Rect[] = [
  { x0: 0.0, x1: 1.95, z0: 0.85, z1: ROOM.z },
  { x0: 0.05, x1: 1.15, z0: 0.2, z1: 1.3 },
];

/** How far apart two pieces stand at least (m). */
const GAP = 0.1;
/** The step of the search for a free place (m); how far it looks clear of the aprons, and how far at all. */
const STEP = 0.05;
const NEAR = 0.5;
const REACH = 4;
/** A new piece's height (m): no smaller or larger than this. */
const HEIGHT = [0.3, 2.3] as const;

/** One point of the room as the cutaway's camera sees it: local m (y 0 on the floor, 1 a metre over it), and where it lands in the picture (0 … 1 across, 0 … 1 down). */
export interface Sample {
  readonly x: number;
  readonly z: number;
  readonly y: 0 | 1;
  readonly u: number;
  readonly v: number;
}

/** The room as rendered (render.ts): the camera's view of the floor and a metre over it, what stands there, the showpiece's box. */
export interface RoomInfo {
  readonly samples: readonly Sample[];
  readonly anchors: readonly Anchor[];
  /** The showpiece's box (local m: min and max corners), for a keepsake on its shelves. */
  readonly showpiece: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } | null;
}

/** Without a render: the room's floor laid onto the picture proportionally (its back at the top), a metre up as a tenth of the picture higher. */
export function proportionalRoom(): RoomInfo {
  const samples: Sample[] = [];
  for (const y of [0, 1] as const)
    for (const x of [-ROOM.x, 0, ROOM.x])
      for (const z of [-ROOM.z, 0, ROOM.z]) samples.push({ x, z, y, u: 0.1 + (0.8 * (x + ROOM.x)) / (2 * ROOM.x), v: 0.1 + (0.8 * (z + ROOM.z)) / (2 * ROOM.z) - 0.1 * y });
  return { samples, anchors: ANCHORS, showpiece: { min: [-4.014, ROOM.floor, -1.775], max: [-3.266, ROOM.floor + 3.24, 0.975] } };
}

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** The plane-to-picture map (a homography, row-major) that best takes each sample's (x, z) to its (u, v), by least squares. */
export function homography(samples: readonly Sample[]): Mat3 {
  if (samples.length < 4) throw new Error('a homography needs at least 4 points');
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const atb = new Array<number>(8).fill(0);
  const add = (row: readonly number[], b: number): void => {
    for (let i = 0; i < 8; i++) {
      atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
    }
  };
  for (const { x, z, u, v } of samples) {
    add([x, z, 1, 0, 0, 0, -u * x, -u * z], u);
    add([0, 0, 0, x, z, 1, -v * x, -v * z], v);
  }
  const h = solve(ata, atb);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error('the samples do not fix a plane');
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * out[k];
    out[r] = s / a[r][r];
  }
  return out;
}

function apply(m: Mat3, a: number, b: number): [number, number] {
  const w = m[6] * a + m[7] * b + m[8];
  return [(m[0] * a + m[1] * b + m[2]) / w, (m[3] * a + m[4] * b + m[5]) / w];
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error('the camera does not see the floor');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** The floor as the picture sees it. */
export class FloorView {
  private readonly floor: Mat3;
  private readonly back: Mat3;

  constructor(samples: readonly Sample[]) {
    this.floor = homography(samples.filter((s) => s.y === 0));
    this.back = invert(this.floor);
  }

  /** Where a point of the picture (0 … 1) lies on the floor (local m). */
  toFloor(u: number, v: number): [number, number] {
    return apply(this.back, u, v);
  }

  /** Where a point of the floor (local m) lands in the picture. */
  toPicture(x: number, z: number): [number, number] {
    return apply(this.floor, x, z);
  }
}

/** A piece found in the furnished picture: its box (pixels, corners inclusive) and the picture's size. */
export interface Found {
  readonly name: string;
  readonly box: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  /** Its model's size as made (any unit: only its proportions count), from the GLB. */
  readonly model: { readonly x: number; readonly y: number; readonly z: number };
}

/** A piece stood in the room: its foot's middle, its turn (rad about up: 0 faces the front), its height (m), and the box it takes on the floor. */
export interface Placement {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly height: number;
  readonly rect: Rect;
}

/** The way the cutaway looks into the room (cutaway.ts VIEW.azimuth, rad round from the front toward the right end): a piece out on the floor faces it. */
const VIEW_AZIMUTH = 0.68;
const deg = (d: number): number => (d * Math.PI) / 180;
const snapTurn = (a: number): number => Math.round(a / deg(15)) * deg(15);

/** The floor a piece takes, turned (its model's footprint scaled to its height). */
function footprint(found: Found, x: number, z: number, turn: number, height: number): Rect {
  const s = height / Math.max(found.model.y, 1e-6);
  const hx = (found.model.x * s) / 2;
  const hz = (found.model.z * s) / 2;
  const c = Math.abs(Math.cos(turn));
  const n = Math.abs(Math.sin(turn));
  const ax = c * hx + n * hz;
  const az = n * hx + c * hz;
  return { x0: x - ax, x1: x + ax, z0: z - az, z1: z + az };
}

const overlaps = (a: Rect, b: Rect, margin = 0): boolean => a.x0 < b.x1 + margin && a.x1 > b.x0 - margin && a.z0 < b.z1 + margin && a.z1 > b.z0 - margin;

const grown = (r: Rect, m: Margins): Rect => ({ x0: r.x0 - m.x0, x1: r.x1 + m.x1, z0: r.z0 - m.z0, z1: r.z1 + m.z1 });

/** The floor kept clear: each anchor with its apron (or, `needsOnly`, with only the floor Muse needs round it), and the ways Muse walks. */
export function keepClear(anchors: readonly Anchor[], needsOnly = false): Rect[] {
  const even = { x0: 0.25, x1: 0.25, z0: 0.25, z1: 0.25 };
  const zones = anchors.flatMap(({ name, rect: r }) => {
    if (!needsOnly) return [grown(r, APRON[name] ?? even)];
    const need = NEED[name] ?? even;
    const front = grown(r, need);
    const cut = (r.z1 - r.z0) * (need.ends ?? 0);
    return [r, { ...front, z0: front.z0 + cut, z1: front.z1 - cut }];
  });
  return [...zones, ...WAYS];
}

/** Whether a piece's floor lies within the walls and clear of every zone and of the pieces already stood. */
export function free(rect: Rect, zones: readonly Rect[], placed: readonly Rect[]): boolean {
  if (rect.x0 < -ROOM.x || rect.x1 > ROOM.x || rect.z0 < -ROOM.z || rect.z1 > ROOM.z) return false;
  return zones.every((z) => !overlaps(rect, z)) && placed.every((p) => !overlaps(rect, p, GAP));
}

/**
 * Stand each found piece in the room: its foot under its box's bottom middle (moved back by half its depth, the box's
 * bottom being its front), turned away from a wall it stands by or else to face the view; its size from its box's
 * width against the camera's scale there and its model's own proportions as it is turned (seen from 69° above, a
 * box's height is mostly floor going back, too unsteady to read a height from); then moved to the nearest floor clear
 * of the aprons within half a metre, or else to the nearest clear of what Muse needs (on a 5 cm grid), so it stays
 * about where the picture put it. A piece with no free floor within reach is left out (null).
 */
export function place(found: readonly Found[], room: RoomInfo): Array<Placement | null> {
  const view = new FloorView(room.samples);
  const roomy = keepClear(room.anchors);
  const needs = keepClear(room.anchors, true);
  const placed: Rect[] = [];
  return found.map((f) => {
    const [x1, , x2, y2] = f.box;
    const u = (x1 + x2) / 2 / f.width;
    const v = y2 / f.height;
    const [fx, fz] = view.toFloor(u, v);
    // the camera's scale at the foot: metres of floor per pixel across, and the way back (straight up the picture)
    const du = 0.01;
    const [ax, az] = view.toFloor(u + du, v);
    const [bx, bz] = view.toFloor(u, v - du);
    const across = Math.hypot(ax - fx, az - fz) / (du * f.width);
    const backLength = Math.hypot(bx - fx, bz - fz);
    const away: [number, number] = backLength > 1e-9 ? [(bx - fx) / backLength, (bz - fz) / backLength] : [0, -1];
    const wide = (x2 - x1) * across;
    // turned as it will stand, the model shows this much of its width and depth across the view, and this much going back
    const turned = (turn: number): { scale: number; back: number } => {
      const t = turn - VIEW_AZIMUTH;
      const [c, n] = [Math.abs(Math.cos(t)), Math.abs(Math.sin(t))];
      const scale = wide / Math.max(c * f.model.x + n * f.model.z, 1e-6);
      const s = clamp(scale * f.model.y, HEIGHT[0], HEIGHT[1]) / Math.max(f.model.y, 1e-6);
      return { scale: s, back: s * (n * f.model.x + c * f.model.z) };
    };
    const first = turned(facing(fx, fz));
    const cx = fx + away[0] * (first.back / 2);
    const cz = fz + away[1] * (first.back / 2);
    const turn = facing(cx, cz);
    const height = turned(turn).scale * f.model.y;
    const spot = nearestFree(f, cx, cz, turn, height, roomy, placed, NEAR) ?? nearestFree(f, cx, cz, turn, height, needs, placed, REACH);
    if (!spot) return null;
    placed.push(spot.rect);
    return { name: f.name, x: round(spot.x), z: round(spot.z), turn: round(turn, 4), height: round(height), rect: spot.rect };
  });
}

/** Turned away from a wall within half a metre, or else toward the view into the room. */
function facing(x: number, z: number): number {
  const near = [
    { d: z + ROOM.z, turn: 0 },
    { d: x + ROOM.x, turn: Math.PI / 2 },
    { d: ROOM.x - x, turn: -Math.PI / 2 },
    { d: ROOM.z - z, turn: Math.PI },
  ].sort((a, b) => a.d - b.d)[0];
  return near.d < 0.5 ? near.turn : snapTurn(VIEW_AZIMUTH);
}

/** The free floor nearest (x, z) within `reach`, else null. */
function nearestFree(f: Found, x: number, z: number, turn: number, height: number, zones: readonly Rect[], placed: readonly Rect[], reach: number): { x: number; z: number; rect: Rect } | null {
  let best: { x: number; z: number; rect: Rect; d: number } | null = null;
  const n = Math.round(reach / STEP);
  for (let i = -n; i <= n; i++)
    for (let k = -n; k <= n; k++) {
      const d = Math.hypot(i, k) * STEP;
      if (d > reach + 1e-9 || (best && d >= best.d)) continue;
      const px = x + i * STEP;
      const pz = z + k * STEP;
      const rect = footprint(f, px, pz, turn, height);
      if (free(rect, zones, placed)) best = { x: px, z: pz, rect, d };
    }
  return best;
}

/** A keepsake on the showpiece's bottom shelf, its last place (hut.ts SLOTS: columns 0.14 … 0.86 across, the bottom shelf 0.37 up), so the favourites keep the first. */
export function keepsakeSpot(room: RoomInfo, height: number): { x: number; z: number; lift: number; turn: number } {
  const box = room.showpiece ?? proportionalRoom().showpiece!;
  // the showpiece stands along the left wall facing into the room (+x): across its front runs from the front of the room (z max) back
  const fx = 0.86;
  const fy = 0.37;
  const depth = box.max[0] - box.min[0];
  return {
    x: round(box.max[0] - depth * 0.35),
    z: round(box.max[2] - (box.max[2] - box.min[2]) * fx),
    lift: round(box.min[1] - ROOM.floor + (box.max[1] - box.min[1]) * fy - height / 2),
    turn: round(Math.PI / 2, 4),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number, d = 3): number {
  return Number(v.toFixed(d));
}
