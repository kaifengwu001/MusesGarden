import { BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from '../../../src/life/props.vert.glsl?raw';

// Paper Orchard's small stone-and-timber home, with an airy ivory canopy,
// an open work nook and a clear door. Procedural geometry in local meters (x to the right seen
// from the front, y up from the pad, +z toward the door and the approach),
// painted in the shader (props.frag.glsl), never textured. Nothing here
// depends on R: the frame is placed on the planet each frame and
// props.vert.glsl bends it round the pad.
//
//   plinth  5.0 × 4.8 m of dry stone, its top FLOOR over the pad (the walking
//           floor), its faces battered a little, its top edge chamfered
//   frame   four corner posts up to the eaves (2.1 m over the floor), wall
//           plates along the sides, tie beams across the gables, a king post
//           and two rafters in each gable carrying the ridge beam, which runs
//           front to back 3.2 m over the floor; studs between the corners; a
//           door frame and a plank door, 1.0 × 1.7 m, under the front gable
//   cloth   two canvas slopes resting on the ridge and the plates, sagging a
//           little between their supports, standing 0.3 m out all round,
//           hemmed; canvas in the gables and either side of the door; woven
//           mats on the sides and the back, set in from the posts
//   rope    lashings where the posts meet the beams
//
// Paint data (uv, aPaint) per kind, for props.frag.glsl:
//   stone   uv along the face and up (m; the top: x, z); aPaint: height over
//           the pad, distance to the nearest corner along the face (m), the
//           face (0..3 the sides, 4 the top), flag (0 a side, 1 the top,
//           2 the chamfer)
//   timber  uv across the face from one arris (m) and along the member (m);
//           aPaint: the face's width, the member's length (m), the face's
//           index plus the member's seed (0..1), flag (0 timber, 1 a cut end,
//           2 the door's planks, 3 iron). A cut end's uv is its point on the
//           cut, from the axis (m), and its aPaint the half sizes
//   cloth   the roof: uv along the ridge (z) and down the slope from it (m);
//           aPaint: share of the way down, distance to the nearest free edge
//           (m), how far it sags (0..1), flag 0. A hem: uv along it (m) and
//           round it (0..1), flag 1. A panel: uv from its lower left (m);
//           aPaint: its width and height (m), seed, flag (2 canvas, 3 woven)
//   rope    uv across the band of turns and round the loop (m); aPaint: the
//           same two, seed, 0

/** The walking floor: the plinth's top over the pad (m). */
export const FLOOR = 0.25;

/** The plinth's half sizes at the pad, how far its foot goes into the sand, its batter (m per m) and top chamfer (m). */
const PLINTH = { x: 2.5, z: 2.4, foot: -0.35, batter: 0.05, chamfer: 0.03 } as const;
/** The walls' outline (half sizes to the posts' axes, m). */
const WALL = { x: 2.2, z: 1.8 } as const;
/** The canvas's line over the walls and at the ridge (m over the pad), and its fall per meter out from the ridge. */
const EAVE = FLOOR + 2.1;
const RIDGE = FLOOR + 3.2;
const SLOPE = (RIDGE - EAVE) / WALL.x;
/** Modest eaves: 0.3 m beyond the side walls and 0.5 m beyond the gables. */
const ROOF = { x: WALL.x + 0.3, z: WALL.z + 0.5 } as const;
/** The door's half width and height over the floor (m). */
const DOOR = { half: 0.5, height: 1.7 } as const;

/** The canvas's line over a point x across (m over the pad), before it sags. */
const roofLine = (x: number): number => RIDGE - SLOPE * Math.abs(x);

// The frame's members (m): their sections, and the heights their axes run at.
const POST = 0.18;
const STUD = 0.12;
const PLATE = { w: 0.13, h: 0.15, y: EAVE - 0.075 } as const;
const TIE = { w: 0.13, h: 0.13, y: 2.17 } as const;
const RAFTER = { w: 0.11, h: 0.13 } as const;
const RIDGE_BEAM = { w: 0.13, h: 0.15 } as const;
const ARRIS = 0.2;
const MAX_ROOF_BAY_SAG = 0.18;
// A flat beam top cannot sit at the canvas's pointed ridge: its shoulders
// would emerge through both slopes. Seat its actual chamfered section below
// the lowest possible canvas at the shoulder, including the bay's sag.
const RIDGE_SHOULDER = RIDGE_BEAM.w / 2 - ARRIS * Math.min(RIDGE_BEAM.w, RIDGE_BEAM.h);
const RIDGE_BEAM_Y = RIDGE - RIDGE_BEAM.h / 2 - SLOPE * RIDGE_SHOULDER - MAX_ROOF_BAY_SAG * Math.sin(Math.PI * RIDGE_SHOULDER / WALL.x);
const KING = 0.13;
const JAMB = { w: 0.11, h: 0.12, x: DOOR.half + 0.055 } as const;
const LINTEL = { h: 0.08, y: FLOOR + DOOR.height + 0.04 } as const;
/** The rafters' axes lie this far under the canvas, measured straight down (m). */
const RAFTER_DROP = (RAFTER.h / 2 + 0.008) * Math.hypot(1, SLOPE);
/** The studs: along each side (z) and across the back (x) (m). */
const SIDE_STUDS = [-0.6, 0.6] as const;
const BACK_STUDS = [-0.73, 0.73] as const;
/** How far the cloth panels stand in from the posts' axes (m). */
const INSET = 0.025;
/** How far the rope's turns stand proud of the timber, and the bands' widths (m). */
const ROPE = 0.011;
const SLEEVE_W = 0.08;
const CROSS_W = 0.034;

type Kind = 'stone' | 'timber' | 'cloth' | 'rope';
const KIND_ID: Record<Kind, number> = { stone: 0, timber: 1, cloth: 2, rope: 3 };
const TIMBER_FLAG = { timber: 0, end: 1, door: 2, iron: 3 } as const;
const CLOTH_FLAG = { roof: 0, hem: 1, canvas: 2, woven: 3 } as const;

class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = hash32(seed >>> 0);
  }
  next(): number {
    this.s = hash32((this.s + 0x9e3779b9) >>> 0);
    return unit(this.s);
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

type Paint = [number, number, number, number];

const e1 = new Vector3();
const e2 = new Vector3();
const fn = new Vector3();
const vn = new Vector3();

/** Accumulates indexed painted geometry: positions, normals, face uv and paint data. */
class Builder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uvs: number[] = [];
  private readonly paint: number[] = [];
  private readonly index: number[] = [];

  vertex(p: Vector3, n: Vector3, u: number, v: number, paint: Paint): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.paint.push(...paint);
    return this.pos.length / 3 - 1;
  }

  /** A triangle, wound to face the way its first corner's normal points. */
  tri(a: number, b: number, c: number): void {
    const P = this.pos;
    e1.set(P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]);
    e2.set(P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]);
    vn.fromArray(this.nrm, 3 * a);
    if (fn.crossVectors(e1, e2).dot(vn) >= 0) this.index.push(a, b, c);
    else this.index.push(a, c, b);
  }

  /** A grid of (cols + 1) × (rows + 1) corners made by `at`, joined into quads. */
  grid(cols: number, rows: number, at: (i: number, j: number) => number): void {
    const ids: number[] = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) ids.push(at(i, j));
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * (cols + 1) + i;
        this.tri(ids[k], ids[k + 1], ids[k + cols + 2]);
        this.tri(ids[k], ids[k + cols + 2], ids[k + cols + 1]);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aPaint', new Float32BufferAttribute(this.paint, 4));
    g.setIndex(this.index);
    return g;
  }
}

/** `count` + 1 evenly spaced values from a to b. */
function steps(a: number, b: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, k) => a + ((b - a) * k) / count);
}

/** A rectangle's outline with its corners cut by `cut`, as 8 points round it (half sizes a, b). */
function chamfered(a: number, b: number, cut: number): Array<[number, number]> {
  return [
    [a - cut, b],
    [a, b - cut],
    [a, -b + cut],
    [a - cut, -b],
    [-a + cut, -b],
    [-a, -b + cut],
    [-a, b - cut],
    [-a + cut, b],
  ];
}

// ---------------------------------------------------------------- the plinth

/** The plinth's half size along x or z at height y: battered, so a touch wider at the foot. */
const plinthHalf = (half: number, y: number): number => half - PLINTH.batter * y;

/** Dry stone: four battered faces from the foot (in the sand) to the chamfer, the chamfer, and the top. */
function plinth(b: Builder): void {
  const yTop = FLOOR;
  const yEdge = FLOOR - PLINTH.chamfer;
  const sides: Array<{ out: Vector3; along: Vector3; half: number; across: number }> = [
    { out: new Vector3(0, 0, 1), along: new Vector3(1, 0, 0), half: PLINTH.z, across: PLINTH.x },
    { out: new Vector3(1, 0, 0), along: new Vector3(0, 0, -1), half: PLINTH.x, across: PLINTH.z },
    { out: new Vector3(0, 0, -1), along: new Vector3(-1, 0, 0), half: PLINTH.z, across: PLINTH.x },
    { out: new Vector3(-1, 0, 0), along: new Vector3(0, 0, 1), half: PLINTH.x, across: PLINTH.z },
  ];
  const p = new Vector3();
  sides.forEach((s, face) => {
    const cols = Math.ceil((2 * s.across) / 0.6);
    // a point on this face at share t along it and height y; inset pulls it in from the battered line (the chamfer)
    const at = (t: number, y: number, inset: number): Vector3 => {
      const along = (2 * t - 1) * (plinthHalf(s.across, y) - inset);
      return p.copy(s.out).multiplyScalar(plinthHalf(s.half, y) - inset).addScaledVector(s.along, along).setY(y);
    };
    const n = s.out.clone().setY(PLINTH.batter).normalize();
    b.grid(cols, 1, (i, j) => {
      const t = i / cols;
      const y = j ? yEdge : PLINTH.foot;
      const length = 2 * plinthHalf(s.across, y);
      return b.vertex(at(t, y, 0), n, t * length, y, [y, Math.min(t, 1 - t) * length, face, 0]);
    });
    const nc = s.out.clone().setY(1).normalize();
    b.grid(cols, 1, (i, j) => {
      const t = i / cols;
      const y = j ? yTop : yEdge;
      const length = 2 * plinthHalf(s.across, yEdge);
      return b.vertex(at(t, y, j ? PLINTH.chamfer : 0), nc, t * length, y, [y, Math.min(t, 1 - t) * length, face, 2]);
    });
  });
  const hx = plinthHalf(PLINTH.x, yTop) - PLINTH.chamfer;
  const hz = plinthHalf(PLINTH.z, yTop) - PLINTH.chamfer;
  const up = new Vector3(0, 1, 0);
  b.grid(10, 10, (i, j) => {
    p.set(-hx + (2 * hx * i) / 10, yTop, -hz + (2 * hz * j) / 10);
    return b.vertex(p, up, p.x, p.z, [yTop, 0, 4, 1]);
  });
}

/** A solid, chipped slate block. Real plane changes carry the stone at normal viewing distance. */
function wallBlock(b: Builder, centre: Vector3, along: Vector3, width: number, depth: number, height: number, seed: number): void {
  const forward = new Vector3().crossVectors(along, Y).normalize();
  const cut = Math.min(0.055, width * 0.13, depth * 0.18);
  const outline = chamfered(width / 2, depth / 2, cut);
  const top: Vector3[] = [], bottom: Vector3[] = [];
  const tilt = (seed - 0.5) * 0.035;
  for (const [x, z] of outline) {
    const p = centre.clone().addScaledVector(along, x).addScaledVector(forward, z);
    bottom.push(p.clone());
    top.push(p.addScaledVector(Y, height + tilt * x));
  }
  for (let k = 0; k < outline.length; k++) {
    const next = (k + 1) % outline.length;
    const edge = new Vector3().subVectors(bottom[next], bottom[k]);
    const n = new Vector3().crossVectors(edge, Y).normalize();
    const faceWidth = edge.length();
    const ids = [
      b.vertex(bottom[k], n, 0, 0, [faceWidth, height, seed, 3]),
      b.vertex(bottom[next], n, faceWidth, 0, [faceWidth, height, seed, 3]),
      b.vertex(top[next], n, faceWidth, height, [faceWidth, height, seed, 3]),
      b.vertex(top[k], n, 0, height, [faceWidth, height, seed, 3]),
    ];
    b.tri(ids[0], ids[1], ids[2]);
    b.tri(ids[0], ids[2], ids[3]);
  }
  const normal = Y.clone().addScaledVector(along, -tilt).normalize();
  const ids = top.map((p, k) => b.vertex(p, normal, outline[k][0] + width / 2, outline[k][1] + depth / 2, [width, depth, seed, 4]));
  for (let k = 1; k + 1 < ids.length; k++) b.tri(ids[0], ids[k], ids[k + 1]);
  // The first course sits directly on the existing floor. It has no hidden,
  // coplanar bottom face over that floor, and other courses have open mortar joints.
}

/** A run of offset courses with a fractured, uneven top rather than one extruded wall box. */
function stoneRun(b: Builder, from: Vector3, to: Vector3, depth: number, height: number, rand: Rand): void {
  const along = new Vector3().subVectors(to, from);
  const length = along.length();
  along.divideScalar(length);
  const rows = Math.max(2, Math.ceil(height / 0.28));
  const rise = height / rows;
  for (let row = 0; row < rows; row++) {
    let x = 0;
    let first = true;
    while (x < length - 0.04) {
      const desired = first && row % 2 ? 0.29 : rand.range(0.46, 0.69);
      const span = Math.min(desired, length - x);
      const gap = Math.min(0.012, span * 0.1);
      const h = rise - 0.014 + (row === rows - 1 ? rand.range(-0.025, 0.018) : 0);
      const p = from.clone().addScaledVector(along, x + span / 2).addScaledVector(Y, row * rise);
      wallBlock(b, p, along, span - gap, depth + rand.range(-0.018, 0.018), h, rand.next());
      x += span;
      first = false;
    }
  }
}

/** Taller slate beside the door, lower walls round the open work side. */
function stoneWalls(b: Builder, rand: Rand): void {
  stoneRun(b, at3(-1.94, FLOOR, 1.72), at3(-0.65, FLOOR, 1.72), 0.32, 1.52, rand);
  stoneRun(b, at3(0.65, FLOOR, 1.72), at3(1.94, FLOOR, 1.72), 0.32, 0.81, rand);
  stoneRun(b, at3(-2.1, FLOOR, -1.62), at3(-2.1, FLOOR, 1.56), 0.3, 1.22, rand);
  stoneRun(b, at3(2.1, FLOOR, -1.62), at3(2.1, FLOOR, 0.48), 0.3, 0.86, rand);
  stoneRun(b, at3(-1.92, FLOOR, -1.72), at3(1.92, FLOOR, -1.72), 0.3, 1.08, rand);
}

// ----------------------------------------------------------------- the frame

interface Member {
  from: Vector3;
  to: Vector3;
  /** Its section: width across, depth along `up` (m). */
  w: number;
  h: number;
  /** The way its depth is measured: any direction not along it. */
  up: Vector3;
  /** An end cut through `to`, rather than a square cut across the axis. */
  endNormal?: Vector3;
  flag?: 'timber' | 'door' | 'iron';
}

const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const at3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const upright = (x: number, z: number, y0: number, y1: number, w: number, h = w): Member => ({ from: at3(x, y0, z), to: at3(x, y1, z), w, h, up: Z });
const level = (from: Vector3, to: Vector3, w: number, h: number): Member => ({ from, to, w, h, up: Y });

/** Every timber in the shelter, from the drawing's scheme. */
function frame(): Member[] {
  const m: Member[] = [];
  const postTop = EAVE - 0.07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.push(upright(sx * WALL.x, sz * WALL.z, FLOOR, postTop, POST));
  for (const z of SIDE_STUDS) for (const sx of [-1, 1]) m.push(upright(sx * WALL.x, z, FLOOR, PLATE.y, STUD));
  for (const x of BACK_STUDS) m.push(upright(x, -WALL.z, FLOOR, TIE.y, STUD));
  // the wall plates along the sides and the tie beams across the gables, each standing a little past the posts
  for (const sx of [-1, 1]) m.push(level(at3(sx * WALL.x, PLATE.y, -WALL.z - 0.15), at3(sx * WALL.x, PLATE.y, WALL.z + 0.15), PLATE.w, PLATE.h));
  for (const sz of [-1, 1]) m.push(level(at3(-WALL.x - 0.15, TIE.y, sz * WALL.z), at3(WALL.x + 0.15, TIE.y, sz * WALL.z), TIE.w, TIE.h));
  // each gable: a king post from the tie beam to the ridge beam, two rafters from past the posts up to the ridge
  for (const sz of [-1, 1]) {
    const z = sz * WALL.z;
    m.push(upright(0, z, TIE.y + TIE.h / 2, RIDGE_BEAM_Y - 0.05, KING));
    for (const sx of [-1, 1]) {
      const x = sx * (WALL.x + 0.14);
      // The two rafters meet on the ridge's vertical plane. Square end cuts
      // let their front/back faces cover the same small patch at the apex.
      m.push({ ...level(at3(x, roofLine(x) - RAFTER_DROP, z), at3(0, RIDGE - RAFTER_DROP, z), RAFTER.w, RAFTER.h), endNormal: at3(-sx, 0, 0) });
    }
  }
  // the ridge beam, front to back, stopping short of the canvas's ends
  m.push(level(at3(0, RIDGE_BEAM_Y, -ROOF.z + 0.1), at3(0, RIDGE_BEAM_Y, ROOF.z - 0.1), RIDGE_BEAM.w, RIDGE_BEAM.h));
  // the door frame: jambs up to the tie beam, a lintel over the door, a threshold under it
  const z = WALL.z;
  for (const sx of [-1, 1]) m.push(upright(sx * JAMB.x, z, FLOOR, TIE.y, JAMB.w, JAMB.h));
  // Jambs own the corners; horizontal pieces butt against their inner faces.
  // In particular, the threshold must not duplicate the jambs' bottom caps.
  m.push(level(at3(-DOOR.half, LINTEL.y, z), at3(DOOR.half, LINTEL.y, z), JAMB.h, LINTEL.h));
  m.push(level(at3(-DOOR.half, FLOOR + 0.02, z), at3(DOOR.half, FLOOR + 0.02, z), 0.14, 0.04));
  // the door, its planks set back a little in the frame, and an iron pull
  const doorTop = LINTEL.y - LINTEL.h / 2;
  m.push({ from: at3(0, FLOOR + 0.04, z - 0.01), to: at3(0, doorTop - 0.005, z - 0.01), w: 2 * DOOR.half - 0.02, h: 0.045, up: Z, flag: 'door' });
  m.push({ from: at3(0.36, FLOOR + 0.74, z + 0.025), to: at3(0.36, FLOOR + 0.92, z + 0.025), w: 0.024, h: 0.024, up: Z, flag: 'iron' });
  return m;
}

/** A small supported sorting shelf and two open seed trays in the right-hand shade nook. */
function workNook(): Member[] {
  const m: Member[] = [];
  const top = FLOOR + 0.63;
  const loX = 0.93, hiX = 2.03, loZ = 1.91, hiZ = 2.25;
  for (const x of [loX + 0.08, hiX - 0.08]) for (const z of [loZ + 0.055, hiZ - 0.055]) m.push(upright(x, z, FLOOR, top - 0.025, 0.055));
  m.push(level(at3(loX, top, (loZ + hiZ) / 2), at3(hiX, top, (loZ + hiZ) / 2), hiZ - loZ, 0.05));
  for (const x of [1.2, 1.73]) {
    const z = 2.075, w = 0.36, d = 0.235;
    const rim = 0.021;
    m.push(level(at3(x - w / 2, top + 0.036, z), at3(x + w / 2, top + 0.036, z), d, 0.022));
    for (const zz of [z - d / 2, z + d / 2]) m.push(level(at3(x - w / 2, top + 0.0745, zz), at3(x + w / 2, top + 0.0745, zz), rim, 0.055));
    // Long rims own each corner; end rims fit between them without layered caps.
    for (const xx of [x - (w - rim) / 2, x + (w - rim) / 2]) m.push(level(at3(xx, top + 0.0745, z - (d - rim) / 2), at3(xx, top + 0.0745, z + (d - rim) / 2), rim, 0.055));
  }
  return m;
}

/** A member as a prism with its arrises chamfered: eight long faces (cut along it every meter or so, to follow the bend) and two cut ends. */
function member(b: Builder, m: Member, seed: number): void {
  const dir = new Vector3().subVectors(m.to, m.from);
  const len = dir.length();
  dir.divideScalar(len);
  const side = new Vector3().crossVectors(m.up, dir).normalize();
  const up = new Vector3().crossVectors(dir, side);
  const ring = chamfered(m.w / 2, m.h / 2, ARRIS * Math.min(m.w, m.h));
  const flag = TIMBER_FLAG[m.flag ?? 'timber'];
  const segs = Math.max(1, Math.ceil(len / 0.9));
  const p = new Vector3();
  const n = new Vector3();
  const at = (s: number, u: number, along: number): Vector3 => {
    let end = len;
    if (m.endNormal) end -= (m.endNormal.dot(side) * s + m.endNormal.dot(up) * u) / m.endNormal.dot(dir);
    return p.copy(m.from).addScaledVector(dir, along / len * end).addScaledVector(side, s).addScaledVector(up, u);
  };
  ring.forEach(([s0, u0], k) => {
    const [s1, u1] = ring[(k + 1) % ring.length];
    const width = Math.hypot(s1 - s0, u1 - u0);
    // outward: across the edge, away from the axis
    const flip = (u1 - u0) * (s0 + s1) - (s1 - s0) * (u0 + u1) < 0 ? -1 : 1;
    n.copy(side)
      .multiplyScalar((u1 - u0) * flip)
      .addScaledVector(up, -(s1 - s0) * flip)
      .normalize();
    const paint: Paint = [width, len, k + seed, flag];
    b.grid(1, segs, (i, j) => {
      const along = (len * j) / segs;
      return b.vertex(i ? at(s1, u1, along) : at(s0, u0, along), n, i ? width : 0, along, paint);
    });
  });
  const endFlag = flag === TIMBER_FLAG.iron ? flag : TIMBER_FLAG.end;
  for (const [along, sign] of [
    [0, -1],
    [len, 1],
  ] as const) {
    n.copy(sign > 0 && m.endNormal ? m.endNormal : dir).multiplyScalar(sign);
    const ids = ring.map(([s, u]) => b.vertex(at(s, u, along), n, s, u, [m.w / 2, m.h / 2, seed, endFlag]));
    for (let k = 1; k + 1 < ids.length; k++) b.tri(ids[0], ids[k], ids[k + 1]);
  }
}

// ----------------------------------------------------------------- the rope

interface Lashing {
  centre: Vector3;
  /** The loop's plane: across the joint (a) and through it (b), with its half extents along them (m). */
  a: Vector3;
  b: Vector3;
  ha: number;
  hb: number;
  /** The band of turns, across the loop (m). */
  width: number;
}

/** Where the rope binds the frame: a sleeve round each corner post's head, crossed turns over every post-and-beam joint. */
function lashings(): Lashing[] {
  const out: Lashing[] = [];
  const X = new Vector3(1, 0, 0);
  const diag = (p: Vector3, q: Vector3, sign: number): Vector3 => p.clone().addScaledVector(q, sign).normalize();
  // crossed turns over the joint of an upright and a beam along `beam`, seen through `through`
  const cross = (centre: Vector3, beam: Vector3, through: Vector3, depth: number, reach = 0.105): void => {
    for (const sign of [-1, 1]) out.push({ centre, a: diag(Y, beam, sign), b: through, ha: reach, hb: depth + 0.003, width: CROSS_W });
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * WALL.x;
      const z = sz * WALL.z;
      out.push({ centre: at3(x, TIE.y - TIE.h / 2 - SLEEVE_W / 2 - 0.01, z), a: X, b: Z, ha: POST / 2 + 0.003, hb: POST / 2 + 0.003, width: SLEEVE_W });
      // (each set low enough that its turns stay under the canvas)
      cross(at3(x, TIE.y, z), X, Z, POST / 2, 0.12);
      cross(at3(x, TIE.y + 0.01, z), Z, X, POST / 2, 0.11);
    }
  }
  for (const sz of [-1, 1]) {
    const z = sz * WALL.z;
    cross(at3(0, TIE.y + TIE.h / 2 + 0.01, z), X, Z, KING / 2);
    cross(at3(0, RIDGE_BEAM_Y - 0.1, z), X, Z, KING / 2, 0.095);
  }
  for (const sx of [-1, 1]) cross(at3(sx * JAMB.x, TIE.y, WALL.z), X, Z, JAMB.h / 2);
  for (const z of SIDE_STUDS) for (const sx of [-1, 1]) cross(at3(sx * WALL.x, PLATE.y - 0.03, z), Z, X, PLATE.w / 2);
  for (const x of BACK_STUDS) cross(at3(x, TIE.y, -WALL.z), X, Z, TIE.w / 2);
  return out;
}

/** A band of rope turns round a loop: three rows across it (the middle standing proud), eight points round it. */
function lashing(b: Builder, l: Lashing, seed: number): void {
  const N = new Vector3().crossVectors(l.a, l.b).normalize();
  const loop = chamfered(l.ha, l.hb, 0.45 * Math.min(l.ha, l.hb));
  const around: number[] = [0];
  for (let k = 1; k <= loop.length; k++) {
    const [pa, pb] = loop[k - 1];
    const [qa, qb] = loop[k % loop.length];
    around.push(around[k - 1] + Math.hypot(qa - pa, qb - pb));
  }
  const p = new Vector3();
  const o = new Vector3();
  const n = new Vector3();
  b.grid(loop.length, 2, (i, j) => {
    const [pa, pb] = loop[i % loop.length];
    o.copy(l.a)
      .multiplyScalar(pa / (l.ha * l.ha))
      .addScaledVector(l.b, pb / (l.hb * l.hb))
      .normalize();
    const across = (j - 1) * (l.width / 2);
    p.copy(l.centre)
      .addScaledVector(l.a, pa)
      .addScaledVector(l.b, pb)
      .addScaledVector(o, j === 1 ? ROPE : 0.002)
      .addScaledVector(N, across);
    n.copy(o);
    if (j !== 1) n.multiplyScalar(0.55).addScaledVector(N, (j - 1) * 0.85).normalize();
    return b.vertex(p, n, across, around[i], [across, around[i], seed, 0]);
  });
}

// ---------------------------------------------------------------- the cloth

/** How far the canvas sags (m): between the ridge and the plates in each bay, and along its free edges. */
interface Sag {
  bay: number;
  eave: number;
  end: number;
}

/** How far below its line the canvas hangs at |x| = x (0..ROOF.x) and z (m). */
function drop(x: number, z: number, sag: Sag): number {
  const inBay = x < WALL.x && Math.abs(z) < WALL.z ? Math.sin((Math.PI * x) / WALL.x) * Math.sin((Math.PI * (z + WALL.z)) / (2 * WALL.z)) ** 0.6 : 0;
  const outX = Math.max(0, x - WALL.x) / (ROOF.x - WALL.x);
  const outZ = Math.max(0, Math.abs(z) - WALL.z) / (ROOF.z - WALL.z);
  return sag.bay * inBay + sag.eave * outX * outX * Math.sin((Math.PI * (z + ROOF.z)) / (2 * ROOF.z)) + sag.end * outZ * outZ * Math.sin((Math.PI * x) / ROOF.x);
}

/** The canvas at |x| = x, z on the slope `side` (+1 right, -1 left), and its normal there. */
function canvasAt(x: number, z: number, side: number, sag: Sag, p: Vector3, n?: Vector3): Vector3 {
  if (n) {
    const h = 0.01;
    const dx = (drop(Math.min(x + h, ROOF.x), z, sag) - drop(Math.max(x - h, 0), z, sag)) / (Math.min(x + h, ROOF.x) - Math.max(x - h, 0));
    const dz = (drop(x, z + h, sag) - drop(x, z - h, sag)) / (2 * h);
    // y = RIDGE - SLOPE·x - drop: the gradient in |x| and z, mirrored for the left slope
    n.set(side * (SLOPE + dx), 1, dz).normalize();
  }
  return p.set(side * x, roofLine(x) - drop(x, z, sag), z);
}

/** The two slopes, each a grid with lines over the ridge, the plates and the gables, and their hems. */
function roof(b: Builder, sag: Sag): void {
  const xs = [...steps(0, WALL.x, 11), ...steps(WALL.x, ROOF.x, 2).slice(1)];
  const zs = [...steps(-ROOF.z, -WALL.z, 2), ...steps(-WALL.z, WALL.z, 18).slice(1), ...steps(WALL.z, ROOF.z, 2).slice(1)];
  const run = Math.hypot(1, SLOPE);
  const deepest = sag.bay + 0.5 * (sag.eave + sag.end);
  const p = new Vector3();
  const n = new Vector3();
  for (const side of [-1, 1]) {
    b.grid(zs.length - 1, xs.length - 1, (i, j) => {
      const x = xs[j];
      const z = zs[i];
      canvasAt(x, z, side, sag, p, n);
      const free = Math.min((ROOF.x - x) * run, ROOF.z - Math.abs(z));
      return b.vertex(p, n, z, x * run, [x / ROOF.x, free, drop(x, z, sag) / deepest, CLOTH_FLAG.roof]);
    });
    hem(
      b,
      zs.map((z) => [ROOF.x, z]),
      side,
      sag,
    );
    for (const sz of [-1, 1]) {
      hem(
        b,
        xs.map((x) => [x, sz * ROOF.z]),
        side,
        sag,
      );
    }
  }
}

/** A hem: a thin rolled edge along the canvas through the points (|x|, z), hugging its underside. */
function hem(b: Builder, path: Array<[number, number]>, side: number, sag: Sag): void {
  const R = 0.016;
  const pts = path.map(([x, z]) => {
    const n = new Vector3();
    const p = canvasAt(x, z, side, sag, new Vector3(), n);
    return { p: p.addScaledVector(n, -R * 0.5), n };
  });
  const t = new Vector3();
  const bn = new Vector3();
  const q = new Vector3();
  const r = new Vector3();
  let along = 0;
  b.grid(4, pts.length - 1, (i, j) => {
    const { p, n } = pts[j];
    t.subVectors(pts[Math.min(j + 1, pts.length - 1)].p, pts[Math.max(j - 1, 0)].p).normalize();
    bn.crossVectors(t, n).normalize();
    const a = (Math.PI * 2 * i) / 4;
    r.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(bn, Math.sin(a));
    if (i === 0 && j > 0) along += pts[j].p.distanceTo(pts[j - 1].p);
    return b.vertex(q.copy(p).addScaledVector(r, R), r, along, i / 4, [along, i / 4, 0, CLOTH_FLAG.hem]);
  });
}

/**
 * A wall panel: a rectangle from `origin` along `ua` (lenU) and up (lenV),
 * facing `out`, bellying in by `belly` (m) at its middle.
 */
function panel(b: Builder, origin: Vector3, ua: Vector3, out: Vector3, lenU: number, lenV: number, belly: number, flag: number, seed: number): void {
  const cols = Math.max(2, Math.ceil(lenU / 0.4));
  const rows = Math.max(1, Math.ceil(lenV / 0.4));
  const p = new Vector3();
  const n = new Vector3();
  b.grid(cols, rows, (i, j) => {
    const s = i / cols;
    const t = j / rows;
    const f = Math.sin(Math.PI * s) * Math.sin(Math.PI * t);
    p.copy(origin)
      .addScaledVector(ua, s * lenU)
      .addScaledVector(Y, t * lenV)
      .addScaledVector(out, -belly * f);
    // the belly's slope tips the normal toward the panel's middle
    n.copy(out)
      .addScaledVector(ua, ((belly * Math.PI) / lenU) * Math.cos(Math.PI * s) * Math.sin(Math.PI * t))
      .addScaledVector(Y, ((belly * Math.PI) / lenV) * Math.sin(Math.PI * s) * Math.cos(Math.PI * t))
      .normalize();
    return b.vertex(p, n, s * lenU, t * lenV, [lenU, lenV, seed, flag]);
  });
}

/** Short cloth windbreaks sit above stone; the front gable and work nook remain open. */
function walls(b: Builder, rand: Rand): void {
  const { canvas, woven } = CLOTH_FLAG;
  const front = WALL.z - INSET;
  const Xp = new Vector3(1, 0, 0);
  // The back gable shelters the interior, while the open front shows the canopy's underside.
  {
    const z = -(WALL.z - INSET);
    const out = new Vector3(0, 0, -1);
    const height = RIDGE - RAFTER_DROP - TIE.y;
    const seed = rand.next();
    const p = new Vector3();
    b.grid(8, 3, (i, j) => {
      const x = -WALL.x + (2 * WALL.x * i) / 8;
      const y = TIE.y + (j / 3) * (roofLine(x) - RAFTER_DROP - TIE.y);
      return b.vertex(p.set(x, y, z), out, x + WALL.x, y - TIE.y, [2 * WALL.x, height, seed, canvas]);
    });
  }
  // One short upper-left windbreak is quieter than a symmetrical canvas facade.
  const out = new Vector3(0, 0, 1);
  const beside = WALL.x - JAMB.x;
  const frontBase = FLOOR + 1.54;
  panel(b, at3(-WALL.x, frontBase, front), Xp, out, beside, TIE.y - frontBase, 0.045, canvas, rand.next());
  panel(b, at3(-JAMB.x, LINTEL.y, front), Xp, out, 2 * JAMB.x, TIE.y - LINTEL.y, 0, canvas, rand.next());
  // the sides, front to back between the corner posts and the studs, seen from outside left to right
  for (const sx of [-1, 1]) {
    const posts = [-WALL.z, ...SIDE_STUDS, WALL.z];
    const outward = new Vector3(sx, 0, 0);
    const along = new Vector3(0, 0, -sx);
    for (let k = 0; k + 1 < posts.length; k++) {
      if (sx > 0 && k === posts.length - 2) continue; // open working bay
      const z0 = sx > 0 ? posts[k + 1] : posts[k];
      const base = FLOOR + (sx < 0 ? 1.24 : 0.88);
      panel(b, at3(sx * (WALL.x - INSET), base, z0), along, outward, posts[k + 1] - posts[k], PLATE.y - base, 0.045, woven, rand.next());
    }
  }
  // the back, between the corner posts and the studs
  const posts = [-WALL.x, ...BACK_STUDS, WALL.x];
  for (let k = 0; k + 1 < posts.length; k++) {
    const base = FLOOR + 1.1;
    panel(b, at3(posts[k + 1], base, -(WALL.z - INSET)), new Vector3(-1, 0, 0), new Vector3(0, 0, -1), posts[k + 1] - posts[k], TIE.y - base, 0.045, woven, rand.next());
  }
}

// ---------------------------------------------------------------- the shelter

export class Homestead {
  readonly group = new Object3D();

  constructor(shared: Record<string, IUniform>, seed: number) {
    const rand = new Rand(seed ^ 0x5e17e2);
    const stone = new Builder();
    plinth(stone);
    stoneWalls(stone, rand);
    const timber = new Builder();
    for (const m of [...frame(), ...workNook()]) member(timber, m, rand.next());
    const cloth = new Builder();
    roof(cloth, { bay: rand.range(0.14, MAX_ROOF_BAY_SAG), eave: rand.range(0.075, 0.1), end: rand.range(0.085, 0.115) });
    walls(cloth, rand);
    const rope = new Builder();
    for (const l of lashings()) lashing(rope, l, rand.next());
    for (const [builder, kind] of [
      [stone, 'stone'],
      [timber, 'timber'],
      [cloth, 'cloth'],
      [rope, 'rope'],
    ] as const) {
      const mesh = new Mesh(builder.build(), material(shared, kind));
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.matrixAutoUpdate = false;
  }

  /** Seat the shelter: origin on its pad, up = local vertical, +z toward its front (the door and the approach). */
  place(origin: Vector3, up: Vector3, front: Vector3): void {
    const x = axisX.crossVectors(up, front).normalize();
    const z = axisZ.crossVectors(x, up).normalize();
    this.group.matrix.makeBasis(x, up, z).setPosition(origin);
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateMatrixWorld(true);
  }
}

const axisX = new Vector3();
const axisZ = new Vector3();

/** The cloth is seen from both sides (under the eaves, the roof's underside); everything else from outside. */
function material(shared: Record<string, IUniform>, kind: Kind): ShaderMaterial {
  return new ShaderMaterial({
    name: kind,
    vertexShader,
    fragmentShader,
    uniforms: { ...shared, uKind: { value: KIND_ID[kind] } },
    side: kind === 'cloth' ? DoubleSide : FrontSide,
  });
}
