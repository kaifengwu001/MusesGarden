import { BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Matrix4, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { gnoise } from '../../../src/planet/noise';
import { BANK, HOME_LEVEL } from '../planet/terrain';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// An open riverside pavilion: six coral timber posts, a gently swept tiled
// roof, pale stone terrace and a wooden landing. The inherited support bounds
// below are kept for Muse's seating and walking; all dimensions remain meters.
// This world changes the architecture, not the engine's placement contract.

/** The floor and the terrace stand this high over the clearing (m): three steps down to the meadow. */
export const FLOOR = 0.72;
export const COTTAGE = { halfX: 4.12, halfZ: 2.45, wall: 3.45, thickness: 0.36, overhang: 0.45, pitch: 0.46 } as const;
/** The support footprint keeps the meadow API name; the pavilion has no walls. */
const OUTER = { x: COTTAGE.halfX + COTTAGE.thickness / 2, z: COTTAGE.halfZ + COTTAGE.thickness / 2 } as const;

/** The roof as built: eave half sizes, eave line height, rise, half ridge, slope length, ridge height (m). */
export const ROOF = (() => {
  const { halfX, halfZ, wall, thickness, overhang, pitch } = COTTAGE;
  const ex = halfX + thickness / 2 + overhang;
  const ez = halfZ + thickness / 2 + overhang;
  const rise = ez * Math.tan(pitch);
  // The eave is supported by the timber frame below it.
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
export const STEPS = { x0: OUTER.x - 2.3, x1: OUTER.x - 0.5, count: 3, rise: FLOOR / 3, tread: 0.33 } as const;
/** Legacy terrain culvert coordinates retained for source compatibility. */
export const ARCH = { x: PIER.x0 + 1.0, spring: -0.78, half: 0.55, depth: 1.6 } as const;
// (deep enough that on the smallest, most curved planet the water never shows under the pier's far end)
const BASE = -(HOME_LEVEL + BANK.height + 1.8);

type Kind = 'roof' | 'wood' | 'iron' | 'landing';
/** Original bench alignment retained for saved seating/navigation compatibility. */
const FRONT = { window: [1.32, 2.52], door: [4.6, 5.7] } as const;
/** The riverside bench (local m): middle, seat half length/depth and height. */
export const BENCH = { x: -OUTER.x + (FRONT.window[1] + FRONT.door[0]) / 2 - 0.12, z: OUTER.z + 0.22, half: 0.74, depth: 0.19, seat: 0.485 } as const;
/** Navigation's conservative frame perimeter (local m: z, ±x). */
export const FACE = OUTER.z;
export const SIDE = OUTER.x;
/** The chair by the house's left corner (local m: its middle), turned a little toward the pond. */
export const CHAIR = { x: -OUTER.x - 0.55, z: OUTER.z + 0.45, turn: 0.5 } as const;
/** Legacy API marker; this open pavilion has no chimney mesh. */
export const CHIMNEY = { x: 0.1, z: -0.6, half: 0.29 } as const;
const KIND_ID: Record<Kind, number> = { roof: 1, wood: 2, iron: 3, landing: 5 };

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
 * Paint data per vertex. Roof: share of the way
 * up the slope, distance to the nearest hip (m), the course (index + 0.5),
 * and a flag (0 a course, 1 the eave's edge, 2 a course's foot, 3 a capping
 * tile). Boxes: distance to the face's edge, to its sides, height, and a
 * flag (0 coral framing, 2 the bench/chair, 3 the wooden landing).
 */
type Paint = [number, number, number, number];

const e1 = new Vector3();
const e2 = new Vector3();
const fn = new Vector3();

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

/**
 * The hipped roof: four slopes of tile courses, the eaves' edge, and the
 * capping tiles along the hips and the ridge. Bent out of true (the ridge
 * sags, one end of the eaves droops, the slopes dip, the courses wander a
 * little), as a function of position, so the hips stay closed.
 */
function roof(b: Builder, rand: Rand): void {
  const { ex, ez, eave, rise, ridge, slope, top } = ROOF;
  const sag = rand.range(0.08, 0.12);
  const tip = rand.range(0.40, 0.48);
  const bend = (p: Vector3): Vector3 => {
    const up = (p.y - eave) / rise;
    const along = p.x / ex;
    p.y -= sag * Math.max(0, 1 - along * along) * up * up;
    // A continuous curved profile keeps all four hips closed. Lift increases
    // towards the four corners, with a shallow concave sweep through each face.
    const corner = Math.pow(Math.min(Math.abs(p.x) / ex, Math.abs(p.z) / ez), 4);
    p.y += tip * corner * Math.pow(1 - up, 2) + 0.09 * Math.pow(1 - up, 4);
    p.y -= 0.22 * Math.sin(Math.PI * up);
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

/** Non-overlapping support platform; top rectangles are union-partitioned. */
function landing(stone: Builder, wood: Builder): void {
  const rects = [
    { x0: -OUTER.x, x1: OUTER.x, z0: -OUTER.z, z1: OUTER.z },
    TERRACE, PIER,
  ];
  const xs = [...new Set(rects.flatMap(r => [r.x0, r.x1]))].sort((a,b) => a-b);
  const zs = [...new Set(rects.flatMap(r => [r.z0, r.z1]))].sort((a,b) => a-b);
  const contains = (x: number, z: number): boolean => rects.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  for (let i=0; i+1<xs.length; i++) for(let j=0; j+1<zs.length; j++) {
    const x0=xs[i], x1=xs[i+1], z0=zs[j], z1=zs[j+1];
    const x=(x0+x1)/2, z=(z0+z1)/2;
    if (!contains(x,z)) continue;
    const pier = x < TERRACE.x0;
    const top = pier ? FLOOR - 0.16 : FLOOR;
    let faces='Y';
    if(!contains(x0-0.001,z)) faces+='x';
    if(!contains(x1+0.001,z)) faces+='X';
    if(!contains(x,z0-0.001)) faces+='z';
    if(!contains(x,z1+0.001)) faces+='Z';
    stone.box(new Vector3(x,(BASE+top)/2,z),new Vector3((x1-x0)/2,(top-BASE)/2,(z1-z0)/2),null,FLOOR,0,faces);
    if (pier) {
      const count=Math.ceil((z1-z0)/0.28), span=(z1-z0)/count;
      for(let k=0;k<count;k++) wood.box(new Vector3(x,FLOOR-0.065,z0+(k+0.5)*span),new Vector3((x1-x0)/2,0.065,span/2-0.008),null,FLOOR,3);
    }
  }
  for(let k=0;k<STEPS.count;k++) {
    const top=FLOOR-STEPS.rise*(k+1), z0=TERRACE.z1+STEPS.tread*k;
    stone.box(new Vector3((STEPS.x0+STEPS.x1)/2,(BASE+top)/2,z0+STEPS.tread/2),new Vector3((STEPS.x1-STEPS.x0)/2,(top-BASE)/2,STEPS.tread/2),null,FLOOR,0,'xXYZ');
  }
}

/** The architecture is open between posts, so blossom branches remain visible through it. */
function pavilion(wood: Builder, stone: Builder, iron: Builder): void {
  const beamY=ROOF.eave-0.12;
  const bx=OUTER.x-0.35, bz=OUTER.z-0.28;
  for(const x of [-bx,0,bx]) for(const z of [-bz,bz]) {
    // Pale stone shoes seat each post physically on the platform.
    stone.box(new Vector3(x,FLOOR+0.09,z),new Vector3(0.21,0.09,0.21),null,FLOOR);
    wood.box(new Vector3(x,(FLOOR+beamY)/2,z),new Vector3(0.115,(beamY-FLOOR)/2,0.115),null,FLOOR);
    wood.box(new Vector3(x,beamY-0.10,z),new Vector3(0.25,0.095,0.20),null,FLOOR);
    // Visible bracket arms support the overhanging roof.
    for(const sign of [-1,1]) wood.box(new Vector3(x+sign*0.28,beamY-0.32,z),new Vector3(0.40,0.06,0.065),new Matrix4().makeRotationZ(sign*0.55),FLOOR);
  }
  for(const z of [-bz,bz]) wood.box(new Vector3(0,beamY,z),new Vector3(bx+0.35,0.12,0.12),null,FLOOR);
  for(const x of [-bx,0,bx]) wood.box(new Vector3(x,beamY,0),new Vector3(0.12,0.12,bz+0.26),null,FLOOR);
  // Thin rafters in the shaded underside, all seated between beams and roof.
  for(let i=0;i<15;i++) {
    const x=-bx+(2*bx*i)/14;
    wood.box(new Vector3(x,beamY+0.07,0),new Vector3(0.038,0.055,bz+0.36),null,FLOOR);
  }
  const bench=(x:number,z:number,half:number,seat:number):void=>{
    wood.box(new Vector3(x,FLOOR+seat-0.035,z),new Vector3(half,0.035,BENCH.depth),null,FLOOR,2);
    for(const side of [-1,1]) wood.box(new Vector3(x+side*(half-0.12),FLOOR+seat/2,z),new Vector3(0.05,seat/2-0.04,0.16),null,FLOOR,2);
    wood.box(new Vector3(x,FLOOR+0.14,z),new Vector3(half-0.10,0.025,0.025),null,FLOOR,2);
  };
  bench(BENCH.x,BENCH.z,BENCH.half,BENCH.seat);
  bench(1.8,-bz+0.28,1.35,0.48);
  const chair=new Matrix4().makeRotationY(CHAIR.turn).setPosition(CHAIR.x,0,CHAIR.z);
  const part=(x:number,y:number,z:number,hx:number,hy:number,hz:number):void=>wood.box(new Vector3(x,y,z).applyMatrix4(chair),new Vector3(hx,hy,hz),new Matrix4().extractRotation(chair),FLOOR,2);
  part(0,FLOOR+0.44,0,0.22,0.025,0.21);
  for(const x of [-0.18,0.18]) for(const z of [-0.17,0.17]) part(x,FLOOR+0.21,z,0.025,0.21,0.025);
  for(const x of [-0.18,0.18]) part(x,FLOOR+0.72,-0.19,0.025,0.28,0.025);
  part(0,FLOOR+0.86,-0.19,0.20,0.09,0.02);
  // An open timber railing protects only the back edge of the landing.
  const rx0=PIER.x0+0.15, rx1=-OUTER.x-0.2, rz=PIER.z0+0.12;
  for(let k=0;k<6;k++) wood.box(new Vector3(rx0+(rx1-rx0)*k/5,FLOOR+0.47,rz),new Vector3(0.045,0.47,0.045),null,FLOOR,2);
  wood.box(new Vector3((rx0+rx1)/2,FLOOR+0.94,rz),new Vector3((rx1-rx0)/2+0.06,0.045,0.045),null,FLOOR,2);
  // Small dark caps resolve rail intersections without a second coplanar top.
  for(const x of [rx0,rx1]) iron.box(new Vector3(x,FLOOR+0.995,rz),new Vector3(0.052,0.01,0.052),null,FLOOR);
}

const axisX=new Vector3();
const axisZ=new Vector3();

export class Homestead {
  readonly group=new Object3D();
  private readonly materials:ShaderMaterial[]=[];
  constructor(shared:Record<string,IUniform>,seed:number) {
    const stone=new Builder(),wood=new Builder(),tiles=new Builder(),iron=new Builder();
    landing(stone,wood);
    pavilion(wood,stone,iron);
    roof(tiles,new Rand(seed^0xc0ffee));
    for(const [builder,kind] of [[tiles,'roof'],[stone,'landing'],[wood,'wood'],[iron,'iron']] as const) {
      const mat=new ShaderMaterial({name:'cherry pavilion '+kind,vertexShader,fragmentShader,uniforms:{...shared,uKind:{value:KIND_ID[kind]}},side:kind==='roof'?DoubleSide:FrontSide});
      this.materials.push(mat);
      const mesh=new Mesh(builder.build(),mat);
      mesh.name='Cherry pavilion '+kind;
      mesh.frustumCulled=false;
      this.group.add(mesh);
    }
    this.group.matrixAutoUpdate=false;
  }
  place(origin:Vector3,up:Vector3,toward:Vector3):void {
    const x=axisX.crossVectors(up,toward).normalize();
    const z=axisZ.crossVectors(x,up).normalize();
    this.group.matrix.makeBasis(x,up,z).setPosition(origin);
    this.group.matrixWorldNeedsUpdate=true;
    this.group.updateMatrixWorld(true);
  }
}
