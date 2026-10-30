import { BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, unit } from '../core/hash';
import { gnoise } from '../planet/noise';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// The cottage, its landing and their furniture: an original design, built
// from procedural geometry in a local frame in meters (y up, +z toward the
// pond) and painted in the shader (props.frag.glsl), never textured. Nothing
// here depends on R; the frame is placed on the planet each frame, so the
// cottage keeps its size and stays seated on its clearing.
//
//   walls    solid, limewashed a warm butter cream and painted in strokes.
//            Every face carries how far it is from an edge (corner, foot,
//            top, an opening) and from a corner, so the shader can hint at
//            the stones under the wash near the edges only, stain the wash
//            where rain runs and damp rises, and shade it under the eaves
//   roof     hipped, a little crooked: the ridge sags, the eaves wander and
//            droop at one end, the slopes dip. Tiles painted in courses,
//            mossy, with ridge and hip tiles along the ridge and the hips
//   chimney  a small plastered stack by the ridge, leaning a touch
//   landing  a plastered platform stepping down into the pond, a low arch
//            at the waterline (painted), an iron rail, and a bench by the door

export const COTTAGE = { halfX: 2.5, halfZ: 2.0, wall: 2.1, thickness: 0.36, ridgeRise: 2.25, overhang: 0.42 } as const;
/** Landing extent in local meters (x from, x to, z from, z to). */
export const LANDING = { x0: -2.3, x1: 1.0, z0: 2.0, z1: 5.3, top: 0.02, base: -0.75 } as const;

type Kind = 'wall' | 'roof' | 'wood' | 'iron' | 'glass' | 'landing' | 'frame';
const KIND_ID: Record<Kind, number> = { wall: 0, roof: 1, wood: 2, iron: 3, glass: 4, landing: 5, frame: 6 };

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
 * Paint data per vertex: distance to the nearest edge of its face (m),
 * distance to the nearest corner of the building (m; on the roof, which part
 * it is: 1 ridge and hip tiles, 5 the eaves' edge, 9 the slopes), height
 * above the ground (m), and how much the stones may show near its edges (0..1).
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
  box(centre: Vector3, half: Vector3, turn: Matrix4 | null, groundY: number, stones = 0, faces = 'xXyYzZ'): void {
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
        return [Math.min(u, lu - u, v, lv - v), Math.min(u, lu - u), p.y - groundY, stones];
      });
    }
  }

  /** The geometry, every vertex tagged with the material it is painted as. */
  build(kind: Kind): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aPaint', new Float32BufferAttribute(this.paint, 4));
    g.setAttribute('aKind', new Float32BufferAttribute(new Float32Array(this.pos.length / 3).fill(KIND_ID[kind]), 1));
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

/** The house's walls: limewashed faces with their openings, and the reveals inside the openings. */
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
    // front (toward the pond): the door, a window
    W(-ex, ez, 1, 0, 0, 1, 2 * ex, [
      { from: ex - 1.05, to: ex - 0.15, bottom: 0, top: 1.78, door: true },
      { from: ex + 0.9, to: ex + 1.7, bottom: 0.92, top: 1.6, door: false },
    ]),
    // right side: a small window
    W(ex, ez, 0, -1, 1, 0, 2 * ez, [{ from: ez - 0.45, to: ez + 0.05, bottom: 1.05, top: 1.55, door: false }]),
    // back: a window
    W(ex, -ez, -1, 0, 0, -1, 2 * ex, [{ from: ex - 0.35, to: ex + 0.35, bottom: 0.95, top: 1.6, door: false }]),
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
      return [Math.max(edge, 0), Math.min(u, f.length - u), v + foot, 1];
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
        b.face(ua, va, lu, lv, (u, v, out) => out.copy(origin).addScaledVector(ua, u).addScaledVector(va, v), (_u, v) => [0, 1, origin.y + va.y * v, 0.6]);
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
 * a little. Displacement is a function of position, so the hips stay closed.
 * uv: meters along the eave and up the slope (for the slate courses).
 */
function roof(b: Builder, rand: Rand): void {
  const { halfX, halfZ, wall, ridgeRise, overhang } = COTTAGE;
  const ex = halfX + overhang;
  const ez = halfZ + overhang;
  const slopeK = ridgeRise / ez;
  const y0 = wall + 0.04 - (overhang - 0.22) * slopeK;
  const y1 = y0 + ridgeRise;
  const r = ex - ez;
  const sag = rand.range(0.11, 0.16);
  const droop = rand.range(0.08, 0.12) * (rand.next() < 0.5 ? -1 : 1);
  const bend = (p: Vector3): Vector3 => {
    const up = (p.y - y0) / ridgeRise;
    const along = p.x / ex;
    p.y -= sag * Math.max(0, 1 - along * along) * up * up;
    p.y -= droop * Math.max(0, along * Math.sign(droop)) ** 2 * (1 - up);
    p.y -= 0.035 * Math.sin(Math.PI * up) * (1 - along * along) * 0.8;
    p.y += 0.03 * gnoise(p.x * 1.4, p.z * 1.4, 1.5, 4402) * (1 - up * 0.5);
    return p;
  };
  const A = new Vector3(-ex, y0, ez);
  const B = new Vector3(ex, y0, ez);
  const C = new Vector3(ex, y0, -ez);
  const D = new Vector3(-ex, y0, -ez);
  const P = new Vector3(r, y1, 0);
  const Q = new Vector3(-r, y1, 0);
  const slope = Math.hypot(ez, ridgeRise);
  const hip = Math.hypot(ex - r, ridgeRise);
  const rows = 8;
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  // each slope a grid in (s along the eave, t up the slope), its uv scaled to meters after
  const slopeFace = (a: Vector3, bb: Vector3, top0: Vector3, top1: Vector3, lenU: number, lenV: number): void => {
    const start = b.uv.length;
    const ua = new Vector3().subVectors(bb, a).normalize();
    const va = new Vector3().subVectors(top0.clone().add(top1).multiplyScalar(0.5), a.clone().add(bb).multiplyScalar(0.5)).normalize();
    b.face(
      ua,
      va,
      1,
      1,
      (s, t, out) => bend(out.lerpVectors(tmpA.lerpVectors(a, bb, s), tmpB.lerpVectors(top0, top1, s), t)),
      (_s, t) => [t * lenV, 9, 3, 0],
      Array.from({ length: 14 }, (_, k) => (k + 1) / 15),
      Array.from({ length: rows - 1 }, (_, k) => (k + 1) / rows),
    );
    for (let i = start; i < b.uv.length; i += 2) {
      b.uv[i] *= lenU;
      b.uv[i + 1] *= lenV;
    }
  };
  // ridge and hip tiles: a low rounded cap along the ridge and each hip, bent with the roof
  const capFace = (from: Vector3, to: Vector3): void => {
    const len = from.distanceTo(to);
    const along = new Vector3().subVectors(to, from).normalize();
    const side = new Vector3().crossVectors(along, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(side, along);
    const width = 0.075;
    const lift = 0.075;
    for (const s of [-1, 1]) {
      const start = b.uv.length;
      // one slope of the cap: from its foot on the roof (v = 0) to its crown (v = 1)
      const at = (u: number, v: number, out: Vector3): Vector3 => {
        const base = bend(tmpA.lerpVectors(from, to, Math.min(Math.max(u / len, 0), 1)));
        const a = (1 - v) * (Math.PI / 2);
        return out.copy(base).addScaledVector(side, s * width * Math.sin(a)).addScaledVector(up, lift * (0.35 + 0.65 * Math.cos(a)));
      };
      const va = up.clone().addScaledVector(side, -s).normalize();
      const ua = s > 0 ? along.clone() : along.clone().negate();
      b.face(
        ua,
        va,
        len,
        1,
        (u, v, out) => at(s > 0 ? u : len - u, v, out),
        () => [0.5, 1, 3, 0],
        Array.from({ length: Math.ceil(len / 0.2) }, (_, k) => (k + 1) * 0.2),
        [0.5],
      );
      if (s < 0) for (let i = start; i < b.uv.length; i += 2) b.uv[i] = len - b.uv[i];
    }
  };
  slopeFace(A, B, Q, P, 2 * ex, slope);
  slopeFace(C, D, P, Q, 2 * ex, slope);
  slopeFace(B, C, P, P, 2 * ez, hip);
  slopeFace(D, A, Q, Q, 2 * ez, hip);
  capFace(Q, P);
  capFace(A, Q);
  capFace(D, Q);
  capFace(B, P);
  capFace(C, P);
  // the roof's thickness at the eaves: a band all round, under the slates' edge
  const band = 0.09;
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
      () => [0, 5, 3, 0],
      Array.from({ length: 14 }, (_, k) => (k + 1) / 15),
    );
    for (let i = start; i < b.uv.length; i += 2) b.uv[i] *= len;
  }
}

/** The landing, its steps and the doorstep: plastered stone, painted per face. */
function landing(b: Builder, rand: Rand): void {
  const L = LANDING;
  const top = L.top - 0.02;
  b.box(new Vector3((L.x0 + L.x1) / 2, (L.base + top) / 2, (L.z0 + L.z1) / 2), new Vector3((L.x1 - L.x0) / 2, (top - L.base) / 2, (L.z1 - L.z0) / 2), null, L.top, 0.5, 'xXYZ');
  for (let k = 0; k < 3; k++) {
    b.box(new Vector3(L.x1 - 0.55, L.top - 0.2 * (k + 1) - 0.04, L.z1 + 0.16 + 0.3 * k), new Vector3(0.46, 0.1, 0.17), new Matrix4().makeRotationY(rand.range(-0.04, 0.04)), L.top - 0.6, 0.5, 'xXYZz');
  }
  b.box(new Vector3(-0.6, 0.04, COTTAGE.halfZ + 0.4), new Vector3(0.58, 0.07, 0.22), null, 0, 0.5, 'xXYZz');
}

/** Wood (the door, the bench, eave boards), window frames, glass and iron, from boxes. */
function fittings(wood: Builder, frame: Builder, glass: Builder, iron: Builder, faces: WallFace[]): void {
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
        // planks set back in the wall, two iron straps across them
        const depth = thickness * 0.55;
        wood.box(along(mid, o.bottom + h / 2, depth), new Vector3(w / 2, h / 2, 0.03), turn, 0);
        for (const y of [0.3, 1.42]) iron.box(along(mid - 0.06, o.bottom + y, depth - 0.035), new Vector3(w * 0.36, 0.022, 0.008), turn, 0);
        continue;
      }
      // a frame, glazing bars in a grid of small panes, the glass set back
      const fy = o.bottom + h / 2;
      frame.box(along(mid, o.bottom + 0.03, 0.1), new Vector3(w / 2, 0.03, 0.05), turn, 0);
      frame.box(along(mid, o.top - 0.03, 0.1), new Vector3(w / 2, 0.03, 0.05), turn, 0);
      frame.box(along(o.from + 0.03, fy, 0.1), new Vector3(0.03, h / 2, 0.05), turn, 0);
      frame.box(along(o.to - 0.03, fy, 0.1), new Vector3(0.03, h / 2, 0.05), turn, 0);
      const cols = w > 0.6 ? 3 : 2;
      const rows = h > 0.6 ? 3 : 2;
      for (let k = 1; k < cols; k++) frame.box(along(o.from + (w * k) / cols, fy, 0.11), new Vector3(0.012, h / 2, 0.02), turn, 0);
      for (let k = 1; k < rows; k++) frame.box(along(mid, o.bottom + (h * k) / rows, 0.11), new Vector3(w / 2, 0.012, 0.02), turn, 0);
      glass.box(along(mid, fy, 0.13), new Vector3(w / 2, h / 2, 0.01), turn, 0);
    }
  }
  // a bench by the door
  wood.box(new Vector3(1.15, 0.47, halfZ + 0.36), new Vector3(0.65, 0.035, 0.2), null, 0);
  wood.box(new Vector3(0.6, 0.22, halfZ + 0.36), new Vector3(0.05, 0.22, 0.17), null, 0);
  wood.box(new Vector3(1.7, 0.22, halfZ + 0.36), new Vector3(0.05, 0.22, 0.17), null, 0);
  // the rail along the landing's open side
  for (const z of [2.4, 3.6, 4.8]) iron.box(new Vector3(L.x0 + 0.12, L.top + 0.45, z), new Vector3(0.022, 0.45, 0.022), null, 0);
  iron.box(new Vector3(L.x0 + 0.12, L.top + 0.9, 3.6), new Vector3(0.02, 0.022, 1.25), null, 0);
  iron.box(new Vector3(L.x0 + 0.12, L.top + 0.48, 3.6), new Vector3(0.015, 0.015, 1.2), null, 0);
}

const axisX = new Vector3();
const axisZ = new Vector3();

export class Homestead {
  readonly group = new Object3D();

  constructor(shared: Record<string, IUniform>, seed: number) {
    const rand = new Rand(seed ^ 0xc0ffee);
    const wallB = new Builder();
    const faces = walls(wallB, rand);
    // a small plastered chimney through the back slope by the ridge's end, leaning a touch, with a cap
    const lean = new Matrix4().makeRotationZ(rand.range(-0.03, -0.012)).multiply(new Matrix4().makeRotationX(rand.range(-0.015, 0.015)));
    wallB.box(new Vector3(0.62, 4.12, -0.48), new Vector3(0.2, 0.62, 0.18), lean, 4.3, 0.15, 'xXYzZ');
    wallB.box(new Vector3(0.6, 4.76, -0.48), new Vector3(0.25, 0.045, 0.23), lean, 4.3, 0);
    const roofB = new Builder();
    roof(roofB, rand);
    const stoneB = new Builder();
    landing(stoneB, rand);
    const woodB = new Builder();
    const frameB = new Builder();
    const glassB = new Builder();
    const ironB = new Builder();
    fittings(woodB, frameB, glassB, ironB, faces);
    // one mesh, one draw: each vertex carries its material
    const geometry = mergeGeometries([wallB.build('wall'), roofB.build('roof'), stoneB.build('landing'), woodB.build('wood'), frameB.build('frame'), glassB.build('glass'), ironB.build('iron')]);
    // double-sided for the roof's underside (seen under the eaves); the rest is closed or seen from outside
    const mesh = new Mesh(geometry, new ShaderMaterial({ name: 'homestead', vertexShader, fragmentShader, uniforms: { ...shared }, side: DoubleSide }));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.group.matrixAutoUpdate = false;
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
