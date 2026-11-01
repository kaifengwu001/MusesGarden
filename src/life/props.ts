import { BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Matrix4, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { gnoise } from '../planet/noise';
import { BANK, HOME_LEVEL } from '../planet/terrain';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// The cottage, its terrace and their furniture, built after the meadow
// cottage of the reference painting (its layout matched one to one, at
// Kai's request after iteration 5), from procedural geometry in a local
// frame in meters (y up on the clearing, +z toward the pond, +x to the right
// seen from the front) and painted in the shader (props.frag.glsl), never
// textured. Nothing here depends on R; the frame is placed on the planet each
// frame, so the cottage keeps its size and stays seated on its clearing.
// Proportions measured from the painting (the ridge a third of the eaves'
// length, so the roof's pitch and the plan follow): a house 8.6 × 5.3 m under
// a steep roof a little taller than its walls:
//
//   walls    solid, plastered, standing on the clearing, the floor raised
//            FLOOR above it; the eaves 2.4 m over the floor. On the front a
//            tall window toward the left end and the door right of the
//            middle, a bench between them; a small window high on the right
//            end toward the back; a small one at the back. Every face carries
//            how far it is from an edge (corner, foot, top, an opening) and
//            from a corner, for the paint
//   roof     hipped, the same 45° pitch all round (so the ridge is the eaves'
//            length less their depth), the eaves standing out half a meter,
//            a little crooked: the ridge sags, one end droops, the slopes
//            dip. Built of fourteen courses of tiles a side, each course's foot standing proud of
//            the one below (a real step that catches the light and throws a
//            line of shadow), with beaded capping tiles along the hips and
//            the ridge
//   chimney  plastered stone with a cap, just behind the ridge on the back
//            slope (the ridge's capping runs in front of its foot)
//   terrace  a plastered stone terrace along the front at the floor's
//            height, three steps down to the meadow at its right end; at its
//            left end a pier out over the pond, an arched tunnel at the
//            waterline running into it (real: the water runs in under its
//            vault to a back wall) and an iron rail along its back; a wooden
//            chair by the house's corner, a doorstep

/** The floor and the terrace stand this high over the clearing (m): three steps down to the meadow. */
export const FLOOR = 0.72;
export const COTTAGE = { halfX: 4.12, halfZ: 2.45, wall: 3.45, thickness: 0.36, overhang: 0.45, pitch: Math.PI / 4 } as const;
/** The walls' outer faces (half sizes, m). */
export const OUTER = { x: COTTAGE.halfX + COTTAGE.thickness / 2, z: COTTAGE.halfZ + COTTAGE.thickness / 2 } as const;

/** The roof as built: eave half sizes, eave line height, rise, half ridge, slope length, ridge height (m). */
export const ROOF = (() => {
  const { halfX, halfZ, wall, thickness, overhang, pitch } = COTTAGE;
  const ex = halfX + thickness / 2 + overhang;
  const ez = halfZ + thickness / 2 + overhang;
  const rise = ez * Math.tan(pitch);
  // the slope clears the top of the walls' outer face by a few centimetres
  const eave = wall + 0.12 - overhang * Math.tan(pitch);
  return { ex, ez, eave, rise, ridge: ex - ez, slope: ez / Math.cos(pitch), top: eave + rise };
})();

/** Tile courses up each slope, how far each course's foot stands proud (m), the eave's edge (m), capping tiles' radius (m). */
const COURSES = 14;
const STEP_OUT = 0.035;
const EAVE_BAND = 0.11;
const CAP = 0.085;
/** How far the capping's bedding reaches down into the slopes under it (m). */
const SKIRT = 0.09;

/**
 * The terrace along the front, the pier out over the pond at its left end
 * and the steps down to the meadow at its right (local meters: x from, x to,
 * z from, z to); their tops are the floor, their feet just under the water.
 */
export const TERRACE = { x0: -OUTER.x - 0.1, x1: OUTER.x - 0.2, z0: OUTER.z - 0.3, z1: OUTER.z + 2.1 } as const;
export const PIER = { x0: -OUTER.x - 3.9, x1: -OUTER.x + 0.9, z0: OUTER.z - 0.8, z1: OUTER.z + 3.0 } as const;
// (four equal risers: the last step stands a riser over the meadow, not flush with it, where it flickered and the grass grew through)
export const STEPS = { x0: OUTER.x - 2.3, x1: OUTER.x - 0.5, count: 3, rise: FLOOR / 4, tread: 0.33 } as const;
/**
 * The tunnel through the pier's face at the waterline: centre x, springing
 * height (local m; a half-round vault above it), half width, and how far it
 * runs in to its back wall (m). terrain.ts and terrain.glsl (CULVERT) cut the
 * water in under it; props.frag.glsl and water.glsl paint and mirror it.
 */
export const ARCH = { x: PIER.x0 + 1.0, spring: -0.78, half: 0.55, depth: 1.6 } as const;
// (deep enough that on the smallest, most curved planet the water never shows under the pier's far end)
const BASE = -(HOME_LEVEL + BANK.height + 1.8);

type Kind = 'wall' | 'roof' | 'wood' | 'iron' | 'glass' | 'landing';
/** Where the front's openings are, along it from its left end (m), the end window along the right end from its front corner. */
export const FRONT = { window: [1.32, 2.52], door: [4.6, 5.7] } as const;
/** The bench against the front, between the window and the door (local m): its middle, its seat's half length and half depth, the seat's top over the floor. */
export const BENCH = { x: -OUTER.x + (FRONT.window[1] + FRONT.door[0]) / 2 - 0.12, z: OUTER.z + 0.22, half: 0.74, depth: 0.19, seat: 0.485 } as const;
/** The house's front face and its side walls (local m: z, ±x): what stands on the terrace stands clear of them. */
export const FACE = OUTER.z;
export const SIDE = OUTER.x;
/** The chair by the house's left corner (local m: its middle), turned a little toward the pond. */
export const CHAIR = { x: -OUTER.x - 0.55, z: OUTER.z + 0.45, turn: 0.5 } as const;
export const END_WINDOW = [3.3, 3.85] as const;
/** The chimney, just behind the ridge on the back slope, as in the painting: x, z (m) and half width. */
export const CHIMNEY = { x: 0.1, z: -0.6, half: 0.29 } as const;
/** How deep the window frames sit in the wall, from its face to the frame's middle (m; the wall is COTTAGE.thickness). */
const WINDOW_DEPTH = 0.22;
const KIND_ID: Record<Kind, number> = { wall: 0, roof: 1, wood: 2, iron: 3, glass: 4, landing: 5 };

/** Grid step (m) of the painted faces: fine enough that the edge distances interpolate. */
const STEP = 0.2;

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

/**
 * Paint data per vertex. Walls: distance to the nearest edge of the face
 * (m), to the nearest corner of the building (m), height above the floor
 * (m), and a flag (1 plain plaster, as the chimney). Roof: share of the way
 * up the slope, distance to the nearest hip (m), the course (index + 0.5),
 * and a flag (0 a course, 1 the eave's edge, 2 a course's foot, 3 a capping
 * tile). Boxes: distance to the face's edge, to its sides, height, and a
 * flag (1 the door, 2 the bench).
 */
export type Paint = [number, number, number, number];

const e1 = new Vector3();
const e2 = new Vector3();
const fn = new Vector3();

/** Accumulates painted geometry: positions, normals, face uv (m) and paint data. */
export class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly paint: number[] = [];

  vertex(p: Vector3, n: Vector3, u: number, v: number, paint: Paint): void {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.paint.push(...paint);
  }

  /** A triangle facing `n` (wound to match it), each corner with its uv and paint. */
  tri(p: [Vector3, Vector3, Vector3], n: Vector3, uv: [number, number][], paint: Paint[]): void {
    fn.crossVectors(e1.subVectors(p[1], p[0]), e2.subVectors(p[2], p[0]));
    const order = fn.dot(n) >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) this.vertex(p[i], n, uv[i][0], uv[i][1], paint[i]);
  }

  /**
   * A flat face from `origin` along unit axes `ua` (lenU) and `va` (lenV),
   * facing ua × va, cut into a grid (breaks: extra lines, e.g. at openings),
   * cells for which `skip` is true left out. `at` maps (u, v) to the vertex
   * (so a face can be bent), `paint` gives each vertex its paint data.
   */
  face(ua: Vector3, va: Vector3, lenU: number, lenV: number, at: (u: number, v: number, out: Vector3) => Vector3, paint: (u: number, v: number) => Paint, breaksU: number[] = [], breaksV: number[] = [], skip: (u: number, v: number) => boolean = () => false): void {
    const lines = (len: number, breaks: number[]): number[] => {
      const set = [0, len, ...breaks.filter((b) => b > 0 && b < len)].sort((a, b) => a - b);
      const out: number[] = [set[0]];
      for (let i = 1; i < set.length; i++) {
        const span = set[i] - set[i - 1];
        if (span < 1e-4) continue;
        const n = Math.max(1, Math.ceil(span / STEP));
        for (let k = 1; k <= n; k++) out.push(set[i - 1] + (span * k) / n);
      }
      return out;
    };
    const us = lines(lenU, breaksU);
    const vs = lines(lenV, breaksV);
    const n = new Vector3().crossVectors(ua, va).normalize();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const d = new Vector3();
    for (let i = 0; i + 1 < us.length; i++) {
      for (let j = 0; j + 1 < vs.length; j++) {
        const u0 = us[i];
        const u1 = us[i + 1];
        const v0 = vs[j];
        const v1 = vs[j + 1];
        if (skip((u0 + u1) / 2, (v0 + v1) / 2)) continue;
        at(u0, v0, a);
        at(u1, v0, b);
        at(u1, v1, c);
        at(u0, v1, d);
        const quad: Array<[Vector3, number, number]> = [
          [a, u0, v0],
          [b, u1, v0],
          [c, u1, v1],
          [a, u0, v0],
          [c, u1, v1],
          [d, u0, v1],
        ];
        for (const [p, u, v] of quad) this.vertex(p, n, u, v, paint(u, v));
      }
    }
  }

  /**
   * A grid over (s, f) ∈ [0, 1]², `cols` × `rows`, wound so that the
   * s-direction × the f-direction faces out. `at` gives each corner its
   * position, normal, uv and paint.
   */
  grid(cols: number, rows: number, at: (s: number, f: number) => { p: Vector3; n: Vector3; u: number; v: number; paint: Paint }): void {
    const corners = Array.from({ length: (cols + 1) * (rows + 1) }, (_, k) => at((k % (cols + 1)) / cols, Math.floor(k / (cols + 1)) / rows));
    const c = (i: number, j: number): (typeof corners)[number] => corners[j * (cols + 1) + i];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        for (const v of [c(i, j), c(i + 1, j), c(i + 1, j + 1), c(i, j), c(i + 1, j + 1), c(i, j + 1)]) this.vertex(v.p, v.n, v.u, v.v, v.paint);
      }
    }
  }

  /** A box (centre, half sizes), turned by `turn`, every face painted by distance to its own edges. */
  box(centre: Vector3, half: Vector3, turn: Matrix4 | null, groundY: number, flag = 0, faces = 'xXyYzZ'): void {
    const axes: Array<[string, Vector3, Vector3, Vector3, number, number]> = [
      ['X', new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(half.x, -half.y, half.z), 2 * half.z, 2 * half.y],
      ['x', new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(-half.x, -half.y, -half.z), 2 * half.z, 2 * half.y],
      ['Y', new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(-half.x, half.y, half.z), 2 * half.x, 2 * half.z],
      ['y', new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(-half.x, -half.y, -half.z), 2 * half.x, 2 * half.z],
      ['Z', new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(-half.x, -half.y, half.z), 2 * half.x, 2 * half.y],
      ['z', new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(half.x, -half.y, -half.z), 2 * half.x, 2 * half.y],
    ];
    const p = new Vector3();
    for (const [name, ua, va, o, lu, lv] of axes) {
      if (!faces.includes(name)) continue;
      const ut = ua.clone();
      const vt = va.clone();
      if (turn) {
        ut.transformDirection(turn);
        vt.transformDirection(turn);
      }
      const at = (u: number, v: number, out: Vector3): Vector3 => {
        out.copy(o).addScaledVector(ua, u).addScaledVector(va, v);
        if (turn) out.applyMatrix4(turn);
        return out.add(centre);
      };
      this.face(ut, vt, lu, lv, at, (u, v) => {
        at(u, v, p);
        return [Math.min(u, lu - u, v, lv - v), Math.min(u, lu - u), p.y - groundY, flag];
      });
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aPaint', new Float32BufferAttribute(this.paint, 4));
    return g;
  }
}

/** An opening in a wall: along the wall from its left end seen from outside (m), and up (m). */
export interface Opening {
  from: number;
  to: number;
  bottom: number;
  top: number;
  door: boolean;
}

/** A wall's outer face: its left end (seen from outside), the axis along it, its outward normal, how far its top leans in and how far it bellies out (m). */
export interface WallFace {
  start: Vector3;
  along: Vector3;
  out: Vector3;
  length: number;
  openings: Opening[];
  lean: number;
  belly: number;
}

/** Distance from (u, v) to a rectangle's outline (0 inside it). */
function rectDistance(u: number, v: number, o: Opening): number {
  const du = Math.max(o.from - u, 0, u - o.to);
  const dv = Math.max(o.bottom - v, 0, v - o.top);
  return Math.hypot(du, dv);
}

/** The walls go well into the ground (local m): on a small planet its curve falls away from the corners. */
const WALL_FOOT = -0.7;

/**
 * Where a wall's outer face stands (local m), `u` along it from its left end
 * and `y` over the clearing, as walls() bends the face: leaning in, bellying
 * out, with its wobble. The inside of the hut is fitted to it (hut.ts).
 */
export function wallAt(f: WallFace, u: number, y: number, out: Vector3): Vector3 {
  const height = COTTAGE.wall - WALL_FOOT;
  const v = y - WALL_FOOT;
  const t = v / height;
  const ends = Math.min(u, f.length - u);
  const bulge = f.belly * Math.sin(Math.PI * Math.min(u / f.length, 1)) * Math.sin(Math.PI * t) * Math.min(ends / 0.4, 1);
  const wobble = 0.012 * gnoise(u * 1.3, v * 1.3, 0.5, 4401) * Math.min(ends / 0.3, 1);
  return out.copy(f.start).addScaledVector(f.along, u).setY(y).addScaledVector(f.out, bulge + wobble - f.lean * t);
}

/**
 * The cutaway's cut (view/cutaway.ts, hut.ts), straight, as Kai asked: the
 * front and the right end (the walls toward the view) cut low, just over the
 * lintels of the front's door and window; the back and the left end stand
 * whole, with the corners they share; heights over the clearing (m).
 */
export const CUT = { front: FLOOR + 2.3, back: COTTAGE.wall } as const;

/** The room's inner faces (local m: x = -CUT_X the left end's, z = -CUT_Z the back's): what lies in front of the back and right of the left end is cut low. */
const CUT_X = COTTAGE.halfX - COTTAGE.thickness / 2;
const CUT_Z = COTTAGE.halfZ - COTTAGE.thickness / 2;

/** The cut's height (m over the clearing) at a point of the walls (local m). */
export function cutAt(x: number, z: number): number {
  return x > -CUT_X + 0.01 && z > -CUT_Z + 0.01 ? CUT.front : CUT.back;
}

/** The house's walls: plastered faces with their openings, and the reveals inside the openings. */
function walls(b: Builder, rand: Rand): WallFace[] {
  const { wall, thickness } = COTTAGE;
  const ex = OUTER.x;
  const ez = OUTER.z;
  const foot = WALL_FOOT;
  const W = (sx: number, sz: number, ax: number, az: number, ox: number, oz: number, length: number, openings: Opening[]): WallFace => ({
    start: new Vector3(sx, foot, sz),
    along: new Vector3(ax, 0, az),
    out: new Vector3(ox, 0, oz),
    length,
    openings,
    lean: 0,
    belly: 0,
  });
  // the door and the tall window reach up to just under the eaves, as in the painting
  const top = FLOOR + 2.15;
  const faces = [
    // front (toward the pond): the tall window toward the left end, the door right of the middle
    W(-ex, ez, 1, 0, 0, 1, 2 * ex, [
      { from: FRONT.window[0], to: FRONT.window[1], bottom: FLOOR + 0.85, top, door: false },
      { from: FRONT.door[0], to: FRONT.door[1], bottom: FLOOR, top, door: true },
    ]),
    // right end: a small window high up, toward the back
    W(ex, ez, 0, -1, 1, 0, 2 * ez, [{ from: END_WINDOW[0], to: END_WINDOW[1], bottom: FLOOR + 1.35, top: FLOOR + 2.05, door: false }]),
    // back: a small window
    W(ex, -ez, -1, 0, 0, -1, 2 * ex, [{ from: ex - 0.35, to: ex + 0.35, bottom: FLOOR + 1.3, top: FLOOR + 2.05, door: false }]),
    // left end: blind
    W(-ex, -ez, 0, 1, -1, 0, 2 * ez, []),
  ];
  const height = wall - foot;
  const p = new Vector3();
  for (const f of faces) {
    // hand-built: each wall leans in a touch and bellies out a little
    const lean = rand.range(0.008, 0.02);
    const belly = rand.range(-0.02, 0.03);
    f.lean = lean;
    f.belly = belly;
    const at = (u: number, v: number, out: Vector3): Vector3 => {
      const t = v / height;
      const ends = Math.min(u, f.length - u);
      const bulge = belly * Math.sin(Math.PI * Math.min(u / f.length, 1)) * Math.sin(Math.PI * t) * Math.min(ends / 0.4, 1);
      const wobble = 0.012 * gnoise(u * 1.3, v * 1.3, 0.5, 4401) * Math.min(ends / 0.3, 1);
      return out
        .copy(f.start)
        .addScaledVector(f.along, u)
        .addScaledVector(p.set(0, 1, 0), v)
        .addScaledVector(f.out, bulge + wobble - lean * t);
    };
    const paint = (u: number, v: number): Paint => {
      let edge = Math.min(u, f.length - u, Math.max(v + foot, 0), height - v);
      for (const o of f.openings) edge = Math.min(edge, rectDistance(u, v + foot, o));
      return [Math.max(edge, 0), Math.min(u, f.length - u), v + foot, 0];
    };
    const breaksU = f.openings.flatMap((o) => [o.from, o.to]);
    const breaksV = f.openings.flatMap((o) => [o.bottom - foot, o.top - foot]);
    const inside = (u: number, v: number): boolean => f.openings.some((o) => u > o.from && u < o.to && v + foot > o.bottom && v + foot < o.top);
    b.face(f.along, new Vector3(0, 1, 0), f.length, height, at, paint, breaksU, breaksV, inside);
    // reveals: the wall's thickness inside each opening
    for (const o of f.openings) {
      const depth = thickness;
      const inward = f.out.clone().negate();
      const corner = (u: number, y: number): Vector3 => f.start.clone().addScaledVector(f.along, u).setY(y);
      const reveal = (origin: Vector3, ua: Vector3, va: Vector3, lu: number, lv: number): void => {
        b.face(ua, va, lu, lv, (u, v, out) => out.copy(origin).addScaledVector(ua, u).addScaledVector(va, v), (_u, v) => [0, 1, origin.y + va.y * v, 0]);
      };
      // jambs facing into the opening, the head facing down, the sill up
      reveal(corner(o.from, o.bottom), inward, new Vector3(0, 1, 0), depth, o.top - o.bottom);
      reveal(corner(o.to, o.top), inward, new Vector3(0, -1, 0), depth, o.top - o.bottom);
      reveal(corner(o.from, o.top), inward, f.along.clone(), depth, o.to - o.from);
      if (!o.door) reveal(corner(o.from, o.bottom), f.along.clone(), inward, o.to - o.from, depth);
    }
  }
  return faces;
}

/**
 * The hipped roof: four slopes of tile courses, the eaves' edge, and the
 * capping tiles along the hips and the ridge. Bent out of true (the ridge
 * sags, one end of the eaves droops, the slopes dip, the courses wander a
 * little), as a function of position, so the hips stay closed.
 */
function roof(b: Builder, rand: Rand): void {
  const { ex, ez, eave, rise, ridge, slope, top } = ROOF;
  const sag = rand.range(0.08, 0.12);
  const droop = rand.range(0.05, 0.09) * (rand.next() < 0.5 ? -1 : 1);
  const bend = (p: Vector3): Vector3 => {
    const up = (p.y - eave) / rise;
    const along = p.x / ex;
    p.y -= sag * Math.max(0, 1 - along * along) * up * up;
    p.y -= droop * Math.max(0, along * Math.sign(droop)) ** 2 * (1 - up);
    p.y -= 0.03 * Math.sin(Math.PI * up) * (1 - along * along);
    p.y += 0.025 * gnoise(p.x * 1.4, p.z * 1.4, 1.5, 4402) * (1 - up * 0.5);
    return p;
  };
  const A = new Vector3(-ex, eave, ez);
  const B = new Vector3(ex, eave, ez);
  const C = new Vector3(ex, eave, -ez);
  const D = new Vector3(-ex, eave, -ez);
  const P = new Vector3(ridge, top, 0);
  const Q = new Vector3(-ridge, top, 0);
  const course = slope / COURSES;
  const lerp3 = (a: Vector3, c: Vector3, t: number, out: Vector3): Vector3 => out.lerpVectors(a, c, t);
  const tmpA = new Vector3();
  const tmpB = new Vector3();

  // the four slopes: the eave from a to bb (left to right seen from outside), the top edge t0 → t1
  const slopes = [
    [A, B, Q, P],
    [C, D, P, Q],
    [B, C, P, P],
    [D, A, Q, Q],
  ].map(([a, bb, t0, t1]) => {
    const ua = new Vector3().subVectors(bb, a).normalize();
    const va = new Vector3().subVectors(tmpA.addVectors(t0, t1).multiplyScalar(0.5), tmpB.addVectors(a, bb).multiplyScalar(0.5)).normalize();
    const n = new Vector3().crossVectors(ua, va).normalize();
    return { a, bb, t0, t1, ua, va, n, lenU: a.distanceTo(bb), topLen: t0.distanceTo(t1) };
  });
  for (const f of slopes) {
    const point = (s: number, t: number, out: Vector3): Vector3 => bend(lerp3(lerp3(f.a, f.bb, s, tmpA), lerp3(f.t0, f.t1, s, tmpB), t, out));
    const width = (t: number): number => f.lenU + (f.topLen - f.lenU) * t;
    const tilted = f.n.clone().multiplyScalar(course).addScaledVector(f.va, STEP_OUT).normalize();
    const down = f.va.clone().negate();
    for (let k = 0; k < COURSES; k++) {
      const cols = Math.max(2, Math.round(20 * width(k / COURSES) / f.lenU));
      // the course: its foot stands STEP_OUT proud, its top tucked under the next course
      b.grid(cols, 4, (s, g) => {
        const t = (k + g) / COURSES;
        const p = point(s, t, new Vector3()).addScaledVector(f.n, STEP_OUT * (1 - g));
        return { p, n: tilted, u: (s - 0.5) * width(t), v: t * slope, paint: [t, Math.min(s, 1 - s) * width(t), k + 0.5, 0] };
      });
      // the course's foot: the step down to the course below, facing down the slope
      if (k === 0) continue;
      b.grid(cols, 1, (s, g) => {
        const t = k / COURSES;
        const p = point(s, t, new Vector3()).addScaledVector(f.n, STEP_OUT * g);
        return { p, n: down, u: (s - 0.5) * width(t), v: t * slope + g * STEP_OUT, paint: [t, Math.min(s, 1 - s) * width(t), k + 0.5, 2] };
      });
    }
    // the eave's edge: the lowest course's tile ends, hanging down from its foot
    const out = f.n.clone().setY(0).normalize();
    b.grid(20, 1, (s, g) => {
      const p = point(s, 0, new Vector3()).addScaledVector(f.n, STEP_OUT);
      p.y -= EAVE_BAND * (1 - g);
      return { p, n: out, u: (s - 0.5) * f.lenU, v: g * EAVE_BAND, paint: [0, Math.min(s, 1 - s) * f.lenU, 0.5, 1] };
    });
  }

  // the capping tiles: a chain of half-round tiles along each hip and the ridge,
  // each tile's foot lifted and flared a little over the head of the one below
  const capLine = (from: Vector3, to: Vector3, up: Vector3, count: number): void => {
    const axis = new Vector3();
    const side = new Vector3();
    const ring = (centre: Vector3, r: number, theta: number, out: Vector3): Vector3 =>
      out.copy(centre).addScaledVector(side, Math.cos(theta) * r).addScaledVector(up, Math.sin(theta) * r);
    const SEG = 7;
    for (let k = 0; k < count; k++) {
      const c0 = bend(lerp3(from, to, k / count, new Vector3()));
      const c1 = bend(lerp3(from, to, (k + 1) / count, new Vector3()));
      axis.subVectors(c1, c0).normalize();
      side.crossVectors(up, axis).normalize();
      // seated on the courses' feet, each tile's foot a little over the head of the one below
      const lift = STEP_OUT * 0.6;
      c0.addScaledVector(up, lift + 0.012);
      c1.addScaledVector(up, lift - 0.012);
      const r0 = CAP * 1.06;
      const r1 = CAP * 0.86;
      const pa = new Vector3();
      const pb = new Vector3();
      const pc = new Vector3();
      const pd = new Vector3();
      const n = new Vector3();
      const paint = (along: number, across: number): Paint => [along, across, k + 0.5, 3];
      for (let i = 0; i < SEG; i++) {
        const t0 = (Math.PI * i) / SEG;
        const t1 = (Math.PI * (i + 1)) / SEG;
        ring(c0, r0, t0, pa);
        ring(c0, r0, t1, pb);
        ring(c1, r1, t1, pc);
        ring(c1, r1, t0, pd);
        const tm = (t0 + t1) / 2;
        n.copy(side).multiplyScalar(Math.cos(tm)).addScaledVector(up, Math.sin(tm)).addScaledVector(axis, -0.12).normalize();
        const a0 = i / SEG;
        const a1 = (i + 1) / SEG;
        b.tri([pa, pb, pc], n, [[0, a0], [0, a1], [1, a1]], [paint(0, a0), paint(0, a1), paint(1, a1)]);
        b.tri([pa, pc, pd], n, [[0, a0], [1, a1], [1, a0]], [paint(0, a0), paint(1, a1), paint(1, a0)]);
        // the tile's foot, its half-round end facing down the line
        b.tri([c0.clone(), pa.clone(), pb.clone()], axis.clone().negate(), [[0, 0.5], [0, a0], [0, a1]], [paint(-1, 0.5), paint(-1, a0), paint(-1, a1)]);
      }
      // the bedding under each side of the tile, down into the slopes, so no daylight shows under it
      for (const [theta, out] of [[0, 1], [Math.PI, -1]] as const) {
        ring(c0, r0, theta, pa);
        ring(c1, r1, theta, pd);
        pb.copy(pa).addScaledVector(up, -SKIRT);
        pc.copy(pd).addScaledVector(up, -SKIRT);
        n.copy(side).multiplyScalar(out);
        const s0 = theta === 0 ? 0 : 1;
        b.tri([pa, pd, pc], n, [[0, s0], [1, s0], [1, s0]], [paint(0, s0), paint(1, s0), paint(1, s0)]);
        b.tri([pa, pc, pb], n, [[0, s0], [1, s0], [0, s0]], [paint(0, s0), paint(1, s0), paint(0, s0)]);
      }
    }
  };
  const hipCount = COURSES;
  const capUp = (i: number, j: number): Vector3 => slopes[i].n.clone().add(slopes[j].n).normalize();
  capLine(B, P, capUp(0, 2), hipCount);
  capLine(A, Q, capUp(0, 3), hipCount);
  capLine(C, P, capUp(1, 2), hipCount);
  capLine(D, Q, capUp(1, 3), hipCount);
  capLine(Q, P, capUp(0, 1), Math.max(2, Math.round((2 * ridge) / course)));
}

/** The terrace, the pier, the steps and the doorstep: plastered stone, painted per face. */
function landing(b: Builder, rand: Rand): void {
  const top = FLOOR - 0.02;
  const slab = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, faces: string, turn: Matrix4 | null = null): void =>
    b.box(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2), turn, FLOOR, 0, faces);
  slab(TERRACE.x0, TERRACE.x1, TERRACE.z0, TERRACE.z1, BASE, top, 'xXYZ');
  slab(PIER.x0, PIER.x1, PIER.z0, PIER.z1, BASE, top, 'xXYz');
  pierFace(b, top);
  // three steps down to the meadow from the terrace's right end, each a little out of true
  const { rise, tread } = STEPS;
  for (let k = 0; k < STEPS.count; k++) {
    const stepTop = FLOOR - rise * (k + 1);
    const z0 = TERRACE.z1 + tread * k;
    slab(STEPS.x0, STEPS.x1, z0, z0 + tread + 0.02, BASE, stepTop, 'xXYZ', new Matrix4().makeRotationY(rand.range(-0.012, 0.012)));
  }
  // the doorstep, under the door
  const door = -OUTER.x + (FRONT.door[0] + FRONT.door[1]) / 2;
  b.box(new Vector3(door, FLOOR + 0.04, OUTER.z + 0.17), new Vector3(0.68, 0.05, 0.17), null, FLOOR, 0, 'xXYZz');
}

/**
 * The pier's face, cut by the arch, and the tunnel behind it: side walls up
 * to the springing, the half-round vault, the back wall. The face's uv runs
 * across it from the pier's left end and up from its foot (so the stones'
 * courses carry on round the arch); the tunnel is flagged 1 for the paint.
 */
function pierFace(b: Builder, top: number): void {
  const A = ARCH;
  const zf = PIER.z1;
  const zb = PIER.z1 - A.depth;
  const left = A.x - A.half;
  const right = A.x + A.half;
  const SEG = 16;
  const front = new Vector3(0, 0, 1);
  const quad = (a: Vector3, c: Vector3, d: Vector3, e: Vector3, n: Vector3, flag: number, uvOf: (p: Vector3) => [number, number]): void => {
    const paint = (p: Vector3): Paint => [1, 1, p.y - FLOOR, flag];
    b.tri([a, c, d], n, [uvOf(a), uvOf(c), uvOf(d)], [paint(a), paint(c), paint(d)]);
    b.tri([a, d, e], n, [uvOf(a), uvOf(d), uvOf(e)], [paint(a), paint(d), paint(e)]);
  };
  const faceUv = (p: Vector3): [number, number] => [p.x - PIER.x0, p.y - BASE];
  const at = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
  const arc = (k: number): [number, number] => {
    const theta = Math.PI * (1 - k / SEG);
    return [A.x + A.half * Math.cos(theta), A.spring + A.half * Math.sin(theta)];
  };
  // the face: either side of the arch, and the spandrel over it
  quad(at(PIER.x0, BASE, zf), at(left, BASE, zf), at(left, top, zf), at(PIER.x0, top, zf), front, 0, faceUv);
  quad(at(right, BASE, zf), at(PIER.x1, BASE, zf), at(PIER.x1, top, zf), at(right, top, zf), front, 0, faceUv);
  for (let k = 0; k < SEG; k++) {
    const [x0, y0] = arc(k);
    const [x1, y1] = arc(k + 1);
    quad(at(x0, y0, zf), at(x1, y1, zf), at(x1, top, zf), at(x0, top, zf), front, 0, faceUv);
  }
  // the tunnel: its walls, the vault, the back wall
  const inUv = (p: Vector3): [number, number] => [zf - p.z, p.y - BASE];
  quad(at(left, BASE, zb), at(left, BASE, zf), at(left, A.spring, zf), at(left, A.spring, zb), new Vector3(1, 0, 0), 1, inUv);
  quad(at(right, BASE, zf), at(right, BASE, zb), at(right, A.spring, zb), at(right, A.spring, zf), new Vector3(-1, 0, 0), 1, inUv);
  for (let k = 0; k < SEG; k++) {
    const [x0, y0] = arc(k);
    const [x1, y1] = arc(k + 1);
    const mid = Math.PI * (1 - (k + 0.5) / SEG);
    const n = new Vector3(-Math.cos(mid), -Math.sin(mid), 0);
    quad(at(x0, y0, zb), at(x0, y0, zf), at(x1, y1, zf), at(x1, y1, zb), n, 1, (p) => [zf - p.z, (k * A.half * Math.PI) / SEG]);
  }
  quad(at(left, BASE, zb), at(right, BASE, zb), at(right, A.spring, zb), at(left, A.spring, zb), front, 1, faceUv);
  const centre = at(A.x, A.spring, zb);
  for (let k = 0; k < SEG; k++) {
    const [x0, y0] = arc(k);
    const [x1, y1] = arc(k + 1);
    const pts: [Vector3, Vector3, Vector3] = [centre, at(x0, y0, zb), at(x1, y1, zb)];
    b.tri(pts, front, pts.map(faceUv), pts.map((p): Paint => [1, 1, p.y - FLOOR, 1]));
  }
}

/** Wood (door, window frames, bench, chair), glass and iron, from boxes (flags: 1 the door, 2 the bench and the chair). */
function fittings(wood: Builder, glass: Builder, iron: Builder, faces: WallFace[]): void {
  const { thickness } = COTTAGE;
  for (const f of faces) {
    const inward = f.out.clone().negate();
    const along = (u: number, y: number, depth: number): Vector3 => f.start.clone().addScaledVector(f.along, u).setY(y).addScaledVector(inward, depth);
    const turn = new Matrix4().makeBasis(f.along, new Vector3(0, 1, 0), f.out);
    for (const o of f.openings) {
      const w = o.to - o.from;
      const h = o.top - o.bottom;
      const mid = (o.from + o.to) / 2;
      if (o.door) {
        // planks, painted with their iron straps (flag 1), set back in the wall
        wood.box(along(mid, o.bottom + h / 2, thickness * 0.6), new Vector3(w / 2, h / 2, 0.03), turn, FLOOR, 1);
        continue;
      }
      // a dark frame and small panes (two across and three up in the tall window, two by two in the small), the glass set back
      const fy = o.bottom + h / 2;
      const across = 2;
      const up = h > 1 ? 3 : 2;
      // set deep in the wall, as in the painting: the reveals around them in shade
      const d = WINDOW_DEPTH;
      wood.box(along(mid, o.bottom + 0.035, d), new Vector3(w / 2 + 0.02, 0.035, 0.05), turn, FLOOR);
      wood.box(along(mid, o.top - 0.035, d), new Vector3(w / 2 + 0.02, 0.035, 0.05), turn, FLOOR);
      wood.box(along(o.from + 0.035, fy, d), new Vector3(0.035, h / 2, 0.05), turn, FLOOR);
      wood.box(along(o.to - 0.035, fy, d), new Vector3(0.035, h / 2, 0.05), turn, FLOOR);
      for (let k = 1; k < across; k++) wood.box(along(o.from + (w * k) / across, fy, d + 0.01), new Vector3(0.02, h / 2, 0.025), turn, FLOOR);
      for (let k = 1; k < up; k++) wood.box(along(mid, o.bottom + (h * k) / up, d + 0.01), new Vector3(w / 2, 0.018, 0.025), turn, FLOOR);
      glass.box(along(mid, fy, d + 0.04), new Vector3(w / 2, h / 2, 0.01), turn, FLOOR);
    }
  }
  // the bench against the front, between the window and the door
  const bx = BENCH.x;
  const bz = BENCH.z;
  wood.box(new Vector3(bx, FLOOR + BENCH.seat - 0.035, bz), new Vector3(BENCH.half, 0.035, BENCH.depth), null, FLOOR, 2);
  wood.box(new Vector3(bx - 0.62, FLOOR + 0.23, bz), new Vector3(0.05, 0.21, 0.16), null, FLOOR, 2);
  wood.box(new Vector3(bx + 0.62, FLOOR + 0.23, bz), new Vector3(0.05, 0.21, 0.16), null, FLOOR, 2);
  wood.box(new Vector3(bx, FLOOR + 0.14, bz), new Vector3(0.62, 0.025, 0.02), null, FLOOR, 2);
  // a wooden chair by the house's left corner, turned a little toward the pond
  const chair = new Matrix4().makeRotationY(CHAIR.turn).setPosition(CHAIR.x, 0, CHAIR.z);
  const part = (x: number, y: number, z: number, hx: number, hy: number, hz: number): void => {
    const c = new Vector3(x, y, z).applyMatrix4(chair);
    wood.box(c, new Vector3(hx, hy, hz), new Matrix4().extractRotation(chair), FLOOR, 2);
  };
  part(0, FLOOR + 0.44, 0, 0.22, 0.025, 0.21);
  for (const [x, z] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) part(x, FLOOR + 0.21, z, 0.025, 0.21, 0.025);
  for (const x of [-0.18, 0.18]) part(x, FLOOR + 0.72, -0.19, 0.025, 0.28, 0.025);
  part(0, FLOOR + 0.86, -0.19, 0.2, 0.09, 0.02);
  // the iron rail along the pier's back, its posts set into the stone
  const railZ = PIER.z0 + 0.12;
  const rx0 = PIER.x0 + 0.15;
  const rx1 = -OUTER.x - 0.2;
  const posts = 6;
  for (let k = 0; k < posts; k++) iron.box(new Vector3(rx0 + ((rx1 - rx0) * k) / (posts - 1), FLOOR + 0.47, railZ), new Vector3(0.022, 0.47, 0.022), null, FLOOR);
  iron.box(new Vector3((rx0 + rx1) / 2, FLOOR + 0.94, railZ), new Vector3((rx1 - rx0) / 2 + 0.03, 0.022, 0.024), null, FLOOR);
  iron.box(new Vector3((rx0 + rx1) / 2, FLOOR + 0.5, railZ), new Vector3((rx1 - rx0) / 2, 0.015, 0.015), null, FLOOR);
}

const axisX = new Vector3();
const axisZ = new Vector3();

export class Homestead {
  readonly group = new Object3D();
  /** The walls' outer faces as built (the inside of the hut is fitted to them: hut.ts). */
  readonly faces: WallFace[];
  private readonly materials: ShaderMaterial[] = [];
  /**
   * The cutaway into the hut (view/cutaway.ts): the walls and the roof drawn
   * with their CUTAWAY builds while it is open, the roof and the chimney
   * lifting off and dissolving as `uCutaway` runs 0 → 1; shut, the house is
   * drawn with its own materials, exactly as ever.
   */
  private readonly cut: Array<{ mesh: Mesh; own: ShaderMaterial; cutaway: ShaderMaterial }> = [];
  private readonly cutaway: IUniform<number> = { value: 0 };
  /** Where the chimney goes in the cutaway (local m): onto the back wall's top, over the hearth inside (Kai's mock-up). */
  private readonly chimney: IUniform<Vector3> = { value: new Vector3() };
  private roof: Mesh | null = null;

  constructor(shared: Record<string, IUniform>, seed: number) {
    const rand = new Rand(seed ^ 0xc0ffee);
    const wallB = new Builder();
    const faces = walls(wallB, rand);
    this.faces = faces;
    // the chimney: plastered stone just behind the ridge, rising out of the back slope to a cap, leaning a touch
    const lean = new Matrix4().makeRotationZ(rand.range(-0.025, -0.01)).multiply(new Matrix4().makeRotationX(rand.range(-0.012, 0.012)));
    const foot = ROOF.top + CHIMNEY.z - CHIMNEY.half - 0.25; // inside the roof, under its back face's foot
    const head = ROOF.top + 0.75;
    this.chimney.value.set(0, COTTAGE.wall - foot - 0.04, -COTTAGE.halfZ - CHIMNEY.z);
    wallB.box(new Vector3(CHIMNEY.x, (foot + head) / 2, CHIMNEY.z), new Vector3(CHIMNEY.half, (head - foot) / 2, CHIMNEY.half), lean, foot, 1, 'xXYzZ');
    wallB.box(new Vector3(CHIMNEY.x, head + 0.05, CHIMNEY.z), new Vector3(CHIMNEY.half + 0.06, 0.05, CHIMNEY.half + 0.06), lean, foot, 1);
    const roofB = new Builder();
    roof(roofB, rand);
    const stoneB = new Builder();
    landing(stoneB, rand);
    const woodB = new Builder();
    const glassB = new Builder();
    const ironB = new Builder();
    fittings(woodB, glassB, ironB, faces);
    for (const [builder, kind] of [
      [wallB, 'wall'],
      [roofB, 'roof'],
      [stoneB, 'landing'],
      [woodB, 'wood'],
      [glassB, 'glass'],
      [ironB, 'iron'],
    ] as const) {
      const mesh = new Mesh(builder.build(), this.material(shared, kind));
      mesh.frustumCulled = false;
      this.group.add(mesh);
      if (kind === 'wall' || kind === 'roof') this.cut.push({ mesh, own: mesh.material, cutaway: this.material(shared, kind, true) });
      if (kind === 'roof') this.roof = mesh;
    }
    this.group.matrixAutoUpdate = false;
  }

  private material(shared: Record<string, IUniform>, kind: Kind, cutaway = false): ShaderMaterial {
    const mat = new ShaderMaterial({
      name: cutaway ? `${kind} (cutaway)` : kind,
      vertexShader,
      fragmentShader,
      uniforms: cutaway ? { ...shared, uKind: { value: KIND_ID[kind] }, uCutaway: this.cutaway, uChimney: this.chimney } : { ...shared, uKind: { value: KIND_ID[kind] } },
      defines: cutaway
        ? { CUTAWAY: '', CUT_FRONT: CUT.front.toFixed(4), CUT_BACK: CUT.back.toFixed(4), CUT_X: CUT_X.toFixed(4), CUT_Z: CUT_Z.toFixed(4), CHIMNEY_TOP: `vec3(${CHIMNEY.x.toFixed(3)}, ${CHIMNEY.z.toFixed(3)}, ${CHIMNEY.half.toFixed(3)})` }
        : {},
      side: kind === 'roof' ? DoubleSide : FrontSide,
    });
    this.materials.push(mat);
    return mat;
  }

  /** The cutaway's materials, to compile ahead of their first use (a walk-up to the door). */
  get cutawayMaterials(): ShaderMaterial[] {
    return this.cut.map((c) => c.cutaway);
  }

  /** How far the roof and the chimney have lifted off (0: the house as ever, 1: gone, the room open from above). */
  setCutaway(amount: number): void {
    const open = amount > 0;
    for (const c of this.cut) c.mesh.material = open ? c.cutaway : c.own;
    this.cutaway.value = amount;
    if (this.roof) this.roof.visible = amount < 1;
  }

  /** Seat the homestead: origin on the cottage clearing, up = local vertical, +z toward the pond. */
  place(origin: Vector3, up: Vector3, toward: Vector3): void {
    const x = axisX.crossVectors(up, toward).normalize();
    const z = axisZ.crossVectors(x, up).normalize();
    this.group.matrix.makeBasis(x, up, z).setPosition(origin);
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateMatrixWorld(true);
  }
}
