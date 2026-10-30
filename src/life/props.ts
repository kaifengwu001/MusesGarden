import { BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Matrix4, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../core/hash';
import { smoothstep } from '../core/math';
import { gnoise } from '../planet/noise';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// The cottage, its landing and their furniture: an original design, built
// from procedural geometry in a local frame in meters (y up, +z toward the
// pond) and painted in the shader (props.frag.glsl), never textured. Nothing
// here depends on R; the frame is placed on the planet each frame, so the
// cottage keeps its size and stays seated on its clearing. A long, low
// house under a big roof, as the painted meadow cottages are:
//
//   walls    solid, plastered and washed a butter cream, low (2.1 m) and long
//            (7.6 m). Every face carries how far it is from an edge
//            (corner, foot, top, an opening) and from a corner, so the
//            shader can paint the stones faintly where the plaster thins:
//            at the corners, round the openings, along the foot
//   roof     hipped with a long ridge (about half the length), deep eaves
//            just above the door, a little crooked: the ridge sags, one end
//            droops, the slopes dip. Each slope carries how far it is from
//            the eave and from the hips, for the tile courses, the moss and
//            the capping tiles
//   chimney  small and plastered, on the ridge
//   landing  a pale stone platform stepping down into the pond, a low brick
//            arch at the waterline (painted), an iron rail, a bench under a
//            window, a doorstep

export const COTTAGE = { halfX: 3.6, halfZ: 2.1, wall: 2.1, thickness: 0.36, ridgeRise: 2.35, overhang: 0.45, ridge: 2.0 } as const;
/** Landing extent in local meters (x from, x to, z from, z to). */
export const LANDING = { x0: -2.6, x1: 1.3, z0: 2.1, z1: 5.3, top: 0.02, base: -0.75 } as const;

type Kind = 'wall' | 'roof' | 'wood' | 'iron' | 'glass' | 'landing';
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
 * (m), to the nearest corner of the building (m), height above the ground
 * (m), and a flag (1 plain plaster, as the chimney). Roof: distance up the
 * slope from the eave (m), to the nearest hip (m), share of the way up, and
 * a flag (1 the eave's edge). Boxes: distance to the face's edge, to its
 * sides, height, and a flag (1 the door).
 */
type Paint = [number, number, number, number];

/** Accumulates painted geometry: positions, normals, face uv (m) and paint data. */
class Builder {
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
interface Opening {
  from: number;
  to: number;
  bottom: number;
  top: number;
  door: boolean;
}

/** A wall's outer face: its left end (seen from outside), the axis along it, its outward normal. */
interface WallFace {
  start: Vector3;
  along: Vector3;
  out: Vector3;
  length: number;
  openings: Opening[];
}

/** Distance from (u, v) to a rectangle's outline (0 inside it). */
function rectDistance(u: number, v: number, o: Opening): number {
  const du = Math.max(o.from - u, 0, u - o.to);
  const dv = Math.max(o.bottom - v, 0, v - o.top);
  return Math.hypot(du, dv);
}

/** The house's walls: plastered faces with their openings, and the reveals inside the openings. */
function walls(b: Builder, rand: Rand): WallFace[] {
  const { halfX, halfZ, wall, thickness } = COTTAGE;
  const ex = halfX + thickness / 2;
  const ez = halfZ + thickness / 2;
  const foot = -0.12;
  const W = (sx: number, sz: number, ax: number, az: number, ox: number, oz: number, length: number, openings: Opening[]): WallFace => ({
    start: new Vector3(sx, foot, sz),
    along: new Vector3(ax, 0, az),
    out: new Vector3(ox, 0, oz),
    length,
    openings,
  });
  const faces = [
    // front (toward the pond): a small window, the door left of the middle, a window over the bench
    W(-ex, ez, 1, 0, 0, 1, 2 * ex, [
      { from: 0.9, to: 1.6, bottom: 0.95, top: 1.5, door: false },
      { from: 2.6, to: 3.45, bottom: 0, top: 1.72, door: true },
      { from: 4.6, to: 5.5, bottom: 0.85, top: 1.55, door: false },
    ]),
    // right side: a window
    W(ex, ez, 0, -1, 1, 0, 2 * ez, [{ from: 1.75, to: 2.55, bottom: 0.9, top: 1.55, door: false }]),
    // back: a small window
    W(ex, -ez, -1, 0, 0, -1, 2 * ex, [{ from: ex - 0.35, to: ex + 0.35, bottom: 0.95, top: 1.5, door: false }]),
    // left side: blind
    W(-ex, -ez, 0, 1, -1, 0, 2 * ez, []),
  ];
  const height = wall - foot;
  const p = new Vector3();
  for (const f of faces) {
    // hand-built: each wall leans in a touch and bellies out a little
    const lean = rand.range(0.012, 0.03);
    const belly = rand.range(-0.025, 0.035);
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
    // reveals: the wall's thickness inside each opening, stone all over
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
 * The hipped roof, bent out of true: the ridge sags in the middle, one end of
 * the eaves droops, the slopes dip between the rafters, and the eaves wander
 * a little, kicking up a touch at the very edge. Displacement is a function
 * of position, so the hips stay closed. uv: meters along the eave and up the
 * slope (for the tile courses).
 */
function roof(b: Builder, rand: Rand): void {
  const { halfX, halfZ, wall, thickness, ridgeRise, overhang, ridge } = COTTAGE;
  const ex = halfX + thickness / 2 + overhang;
  const ez = halfZ + thickness / 2 + overhang;
  // the slope clears the top of the walls' outer face by a few centimetres
  const y0 = wall + 0.08 - (overhang * ridgeRise) / ez;
  const y1 = y0 + ridgeRise;
  const sag = rand.range(0.1, 0.15);
  const droop = rand.range(0.07, 0.11) * (rand.next() < 0.5 ? -1 : 1);
  const bend = (p: Vector3): Vector3 => {
    const up = (p.y - y0) / ridgeRise;
    const along = p.x / ex;
    p.y -= sag * Math.max(0, 1 - along * along) * up * up;
    p.y -= droop * Math.max(0, along * Math.sign(droop)) ** 2 * (1 - up);
    p.y -= 0.035 * Math.sin(Math.PI * up) * (1 - along * along) * 0.8;
    p.y += 0.03 * gnoise(p.x * 1.4, p.z * 1.4, 1.5, 4402) * (1 - up * 0.5);
    p.y += 0.07 * (1 - smoothstep(0, 0.12, up)); // the eave's kick
    return p;
  };
  const A = new Vector3(-ex, y0, ez);
  const B = new Vector3(ex, y0, ez);
  const C = new Vector3(ex, y0, -ez);
  const D = new Vector3(-ex, y0, -ez);
  const P = new Vector3(ridge, y1, 0);
  const Q = new Vector3(-ridge, y1, 0);
  const slope = Math.hypot(ez, ridgeRise);
  const hip = Math.hypot(ex - ridge, ridgeRise);
  const rows = 10;
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  // each slope a grid in (s along the eave, t up the slope), its uv scaled to meters after
  const slopeFace = (a: Vector3, bb: Vector3, top0: Vector3, top1: Vector3, lenU: number, lenV: number): void => {
    const start = b.uv.length;
    const ua = new Vector3().subVectors(bb, a).normalize();
    const va = new Vector3().subVectors(top0.clone().add(top1).multiplyScalar(0.5), a.clone().add(bb).multiplyScalar(0.5)).normalize();
    const topLength = top0.distanceTo(top1);
    b.face(
      ua,
      va,
      1,
      1,
      (s, t, out) => bend(out.lerpVectors(tmpA.lerpVectors(a, bb, s), tmpB.lerpVectors(top0, top1, s), t)),
      (s, t) => [t * lenV, Math.min(s, 1 - s) * (lenU + (topLength - lenU) * t), t, 0],
      Array.from({ length: 19 }, (_, k) => (k + 1) / 20),
      Array.from({ length: rows - 1 }, (_, k) => (k + 1) / rows),
    );
    for (let i = start; i < b.uv.length; i += 2) {
      b.uv[i] *= lenU;
      b.uv[i + 1] *= lenV;
    }
  };
  slopeFace(A, B, Q, P, 2 * ex, slope);
  slopeFace(C, D, P, Q, 2 * ex, slope);
  slopeFace(B, C, P, P, 2 * ez, hip);
  slopeFace(D, A, Q, Q, 2 * ez, hip);
  // the roof's thickness at the eaves: a band all round, the tiles' ends
  const band = 0.1;
  for (const [a, bb, len] of [
    [A, B, 2 * ex],
    [B, C, 2 * ez],
    [C, D, 2 * ex],
    [D, A, 2 * ez],
  ] as const) {
    const start = b.uv.length;
    b.face(
      new Vector3().subVectors(bb, a).normalize(),
      new Vector3(0, 1, 0),
      1,
      band,
      (s, t, out) => {
        const y = bend(tmpA.lerpVectors(a, bb, s)).y;
        return out.copy(tmpA).setY(y - band + t);
      },
      () => [0, 9, 0, 1],
      Array.from({ length: 19 }, (_, k) => (k + 1) / 20),
    );
    for (let i = start; i < b.uv.length; i += 2) b.uv[i] *= len;
  }
}

/** The landing, its steps and the doorstep: stone all over, painted per face. */
function landing(b: Builder, rand: Rand): void {
  const L = LANDING;
  const top = L.top - 0.02;
  b.box(new Vector3((L.x0 + L.x1) / 2, (L.base + top) / 2, (L.z0 + L.z1) / 2), new Vector3((L.x1 - L.x0) / 2, (top - L.base) / 2, (L.z1 - L.z0) / 2), null, L.top, 0, 'xXYZ');
  for (let k = 0; k < 3; k++) {
    b.box(new Vector3(L.x1 - 0.55, L.top - 0.2 * (k + 1) - 0.04, L.z1 + 0.16 + 0.3 * k), new Vector3(0.46, 0.1, 0.17), new Matrix4().makeRotationY(rand.range(-0.04, 0.04)), L.top - 0.6, 0, 'xXYZz');
  }
  // the doorstep, under the door
  b.box(new Vector3(-0.755, 0.04, COTTAGE.halfZ + COTTAGE.thickness / 2 + 0.2), new Vector3(0.55, 0.07, 0.2), null, 0, 0, 'xXYZz');
}

/** Wood (door, window frames, bench), glass and iron, from boxes (flags: 1 the door, 2 the bench). */
function fittings(wood: Builder, glass: Builder, iron: Builder, faces: WallFace[]): void {
  const { thickness, halfZ } = COTTAGE;
  const L = LANDING;
  for (const f of faces) {
    const inward = f.out.clone().negate();
    const along = (u: number, y: number, depth: number): Vector3 => f.start.clone().addScaledVector(f.along, u).setY(y).addScaledVector(inward, depth);
    const turn = new Matrix4().makeBasis(f.along, new Vector3(0, 1, 0), f.out);
    for (const o of f.openings) {
      const w = o.to - o.from;
      const h = o.top - o.bottom;
      const mid = (o.from + o.to) / 2;
      if (o.door) {
        // planks, painted with their iron straps (flag 1)
        wood.box(along(mid, o.bottom + h / 2, thickness * 0.55), new Vector3(w / 2, h / 2, 0.03), turn, 0, 1);
        continue;
      }
      // frame, small panes (glazing bars in thirds), the glass set back
      const fy = o.bottom + h / 2;
      wood.box(along(mid, o.bottom + 0.035, 0.1), new Vector3(w / 2 + 0.02, 0.035, 0.05), turn, 0);
      wood.box(along(mid, o.top - 0.035, 0.1), new Vector3(w / 2 + 0.02, 0.035, 0.05), turn, 0);
      wood.box(along(o.from + 0.035, fy, 0.1), new Vector3(0.035, h / 2, 0.05), turn, 0);
      wood.box(along(o.to - 0.035, fy, 0.1), new Vector3(0.035, h / 2, 0.05), turn, 0);
      for (const k of [1, 2]) {
        wood.box(along(o.from + (w * k) / 3, fy, 0.11), new Vector3(0.016, h / 2, 0.025), turn, 0);
        wood.box(along(mid, o.bottom + (h * k) / 3, 0.11), new Vector3(w / 2, 0.016, 0.025), turn, 0);
      }
      glass.box(along(mid, fy, 0.14), new Vector3(w / 2, h / 2, 0.01), turn, 0);
    }
  }
  // a bench under the window right of the door
  const face = halfZ + thickness / 2;
  wood.box(new Vector3(1.27, 0.45, face + 0.22), new Vector3(0.7, 0.035, 0.19), null, 0, 2);
  wood.box(new Vector3(0.67, 0.21, face + 0.22), new Vector3(0.05, 0.21, 0.16), null, 0, 2);
  wood.box(new Vector3(1.87, 0.21, face + 0.22), new Vector3(0.05, 0.21, 0.16), null, 0, 2);
  // the rail along the landing's open side
  for (const z of [2.4, 3.6, 4.8]) iron.box(new Vector3(L.x0 + 0.12, L.top + 0.45, z), new Vector3(0.022, 0.45, 0.022), null, 0);
  iron.box(new Vector3(L.x0 + 0.12, L.top + 0.9, 3.6), new Vector3(0.02, 0.022, 1.25), null, 0);
  iron.box(new Vector3(L.x0 + 0.12, L.top + 0.48, 3.6), new Vector3(0.015, 0.015, 1.2), null, 0);
}

const axisX = new Vector3();
const axisZ = new Vector3();

export class Homestead {
  readonly group = new Object3D();
  private readonly materials: ShaderMaterial[] = [];

  constructor(shared: Record<string, IUniform>, seed: number) {
    const rand = new Rand(seed ^ 0xc0ffee);
    const wallB = new Builder();
    const faces = walls(wallB, rand);
    // a small plastered chimney on the ridge, left of the middle, leaning a touch
    const C = COTTAGE;
    const ridgeTop = C.wall + 0.08 - (C.overhang * C.ridgeRise) / (C.halfZ + C.thickness / 2 + C.overhang) + C.ridgeRise;
    const lean = new Matrix4().makeRotationZ(rand.range(-0.025, -0.01)).multiply(new Matrix4().makeRotationX(rand.range(-0.012, 0.012)));
    wallB.box(new Vector3(-1.05, ridgeTop + 0.02, 0.05), new Vector3(0.22, 0.5, 0.22), lean, ridgeTop - 0.4, 1, 'xXYzZ');
    wallB.box(new Vector3(-1.05, ridgeTop + 0.56, 0.05), new Vector3(0.27, 0.045, 0.27), lean, ridgeTop - 0.4, 1);
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
    }
    this.group.matrixAutoUpdate = false;
  }

  private material(shared: Record<string, IUniform>, kind: Kind): ShaderMaterial {
    const mat = new ShaderMaterial({
      name: kind,
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, uKind: { value: KIND_ID[kind] } },
      side: kind === 'roof' ? DoubleSide : FrontSide,
    });
    this.materials.push(mat);
    return mat;
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
