import {
  BackSide,
  DoubleSide,
  FrontSide,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, unit } from '../core/hash';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// The cottage, its landing and their furniture: an original design, built
// from procedural primitives in a local frame in meters (y up, +z toward the
// pond). Nothing here depends on R; the frame is placed on the planet each
// frame, so the cottage keeps its size and stays seated on its clearing.
//
//   walls    ~200 instanced rounded stones in running bond, per-stone tint,
//            over a mortar core, with door and window openings and lintels
//   roof     steep hipped roof; shingle rows are painted in the shader
//   landing  stone platform stepping down into the pond, a low arch at the
//            waterline, an iron rail, and a bench by the door

export const COTTAGE = { halfX: 2.5, halfZ: 2.0, wall: 2.3, ridgeRise: 2.0, overhang: 0.32 } as const;
/** Landing extent in local meters (x from, x to, z from, z to). */
export const LANDING = { x0: -2.3, x1: 1.0, z0: 2.0, z1: 5.3, top: 0.02, base: -0.75 } as const;

type Kind = 'stone' | 'roof' | 'wood' | 'iron' | 'glass' | 'mortar';
const KIND_ID: Record<Kind, number> = { stone: 0, roof: 1, wood: 2, iron: 3, glass: 4, mortar: 5 };

interface Stone {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  tint: number;
}

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

/** Openings in a wall run, in (along, y) meters: [from, to, bottom, top]. */
type Opening = [number, number, number, number];

/**
 * Lay a stone wall from a to b (local xz), outward normal n, courses from y0
 * to y1, skipping openings and spanning them with a lintel.
 */
function layWall(out: Stone[], rand: Rand, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, thickness: number, openings: Opening[], course = 0.3): void {
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const yaw = Math.atan2(dx, dz) - Math.PI / 2;
  let row = 0;
  for (let y = y0; y < y1 - 0.05; y += course, row++) {
    const h = Math.min(course, y1 - y);
    let s = row % 2 === 0 ? 0 : -0.3;
    while (s < len) {
      const l = rand.range(0.42, 0.8);
      const from = Math.max(s, 0);
      const to = Math.min(s + l, len);
      s += l;
      if (to - from < 0.12) continue;
      const mid = (from + to) / 2;
      const cy = y + h / 2;
      if (openings.some(([o0, o1, b, t]) => mid > o0 - 0.05 && mid < o1 + 0.05 && cy > b && cy < t)) continue;
      out.push({
        x: ax + dx * mid,
        y: cy,
        z: az + dz * mid,
        sx: (to - from) * 0.96,
        sy: h * 0.9,
        sz: thickness * rand.range(0.92, 1.06),
        yaw: yaw + rand.range(-0.03, 0.03),
        tilt: rand.range(-0.025, 0.025),
        tint: rand.next(),
      });
    }
  }
  for (const [o0, o1, , t] of openings) {
    if (t >= y1) continue;
    const mid = (o0 + o1) / 2;
    out.push({ x: ax + dx * mid, y: t + 0.13, z: az + dz * mid, sx: o1 - o0 + 0.5, sy: 0.24, sz: thickness * 1.04, yaw, tilt: 0, tint: rand.next() * 0.3 });
  }
}

function quad(pos: number[], uvs: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3, uv: [number, number][]): void {
  // two triangles a-b-c, a-c-d (counter-clockwise from the front)
  for (const [p, t] of [
    [a, uv[0]],
    [b, uv[1]],
    [c, uv[2]],
    [a, uv[0]],
    [c, uv[2]],
    [d, uv[3]],
  ] as const) {
    pos.push(p.x, p.y, p.z);
    uvs.push(t[0], t[1]);
  }
}

/** Hipped roof with uv = (along the eave, up the slope) in meters for shingles. */
function roofGeometry(rand: Rand): BufferGeometry {
  const { halfX, halfZ, wall, ridgeRise, overhang } = COTTAGE;
  const ex = halfX + overhang;
  const ez = halfZ + overhang;
  // the roof plane clears the outer face of the top course by a few centimetres
  const slopeK = ridgeRise / ez;
  const y0 = wall + 0.04 - (overhang - 0.22) * slopeK;
  const y1 = y0 + ridgeRise;
  const r = ex - ez; // half ridge length
  const sag = rand.range(0.02, 0.06);
  const A = new Vector3(-ex, y0, ez);
  const B = new Vector3(ex, y0, ez);
  const C = new Vector3(ex, y0, -ez);
  const D = new Vector3(-ex, y0, -ez);
  const P = new Vector3(r, y1 - sag, 0);
  const Q = new Vector3(-r, y1 - sag, 0);
  const slope = Math.hypot(ez, y1 - y0);
  const side = Math.hypot(ex - r, y1 - y0);
  const pos: number[] = [];
  const uvs: number[] = [];
  quad(pos, uvs, A, B, P, Q, [[0, 0], [2 * ex, 0], [ex + r, slope], [ex - r, slope]]); // front (+z)
  quad(pos, uvs, C, D, Q, P, [[0, 0], [2 * ex, 0], [ex + r, slope], [ex - r, slope]]); // back
  // hips (triangles, written as degenerate quads)
  quad(pos, uvs, B, C, P, P, [[0, 0], [2 * ez, 0], [ez, side], [ez, side]]);
  quad(pos, uvs, D, A, Q, Q, [[0, 0], [2 * ez, 0], [ez, side], [ez, side]]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, radius = 0.015): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 2, h / 2, d / 2));
  g.translate(x, y, z);
  return g;
}

function withUvScale(g: BufferGeometry, s: number): BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  return g;
}

const axisX = new Vector3();
const axisZ = new Vector3();

export class Homestead {
  readonly group = new Object3D();
  readonly stoneCount: number;
  private readonly materials: ShaderMaterial[] = [];

  constructor(shared: Record<string, IUniform>, seed: number) {
    const rand = new Rand(seed ^ 0xc0ffee);
    const { halfX, halfZ, wall } = COTTAGE;
    const t = 0.36;
    const stones: Stone[] = [];
    // walls (front faces the pond, +z): door left of centre, a window right; a window on +x
    layWall(stones, rand, -halfX, halfZ, halfX, halfZ, 0, wall, t, [
      [1.45, 2.4, 0, 1.85],
      [3.45, 4.15, 0.95, 1.65],
    ]);
    layWall(stones, rand, halfX, halfZ, halfX, -halfZ, 0, wall, t, [[1.6, 2.3, 0.95, 1.6]]);
    layWall(stones, rand, halfX, -halfZ, -halfX, -halfZ, 0, wall, t, [[2.2, 2.8, 1.0, 1.55]]);
    layWall(stones, rand, -halfX, -halfZ, -halfX, halfZ, 0, wall, t, []);
    // chimney through the back slope
    layWall(stones, rand, 1.0, -0.95, 1.65, -0.95, 2.5, 4.95, 0.62, [], 0.28);
    // landing: side walls and front face down to below the waterline, an arch in the front
    const L = LANDING;
    layWall(stones, rand, L.x0, L.z0, L.x0, L.z1, L.base, L.top - 0.06, 0.4, []);
    layWall(stones, rand, L.x1, L.z1, L.x1, L.z0, L.base, L.top - 0.06, 0.4, []);
    layWall(stones, rand, L.x0, L.z1, L.x1, L.z1, L.base, L.top - 0.06, 0.4, [[0.9, 1.75, L.base - 0.1, -0.2]]);
    // the arch: voussoirs around the opening
    const archX = L.x0 + 1.32;
    for (let k = 0; k <= 6; k++) {
      const a = Math.PI * (k / 6);
      stones.push({ x: archX - Math.cos(a) * 0.5, y: L.base + 0.35 + Math.sin(a) * 0.42, z: L.z1, sx: 0.2, sy: 0.17, sz: 0.44, yaw: 0, tilt: a - Math.PI / 2, tint: rand.next() });
    }
    // deck flagstones
    for (let x = L.x0 + 0.05; x < L.x1 - 0.1; x += 0.82) {
      for (let z = L.z0 + 0.05; z < L.z1 - 0.1; z += 0.74) {
        stones.push({ x: x + 0.4, y: L.top - 0.04, z: z + 0.36, sx: 0.78, sy: 0.08, sz: 0.7, yaw: rand.range(-0.03, 0.03), tilt: 0, tint: 0.5 + rand.next() * 0.5 });
      }
    }
    // steps down to the water at the front-right
    for (let k = 0; k < 3; k++) stones.push({ x: L.x1 - 0.55, y: L.top - 0.2 * (k + 1), z: L.z1 + 0.18 + 0.3 * k, sx: 0.9, sy: 0.18, sz: 0.34, yaw: 0, tilt: 0, tint: rand.next() });
    // a doorstep and a few loose stones
    stones.push({ x: -0.6 + 0.0, y: 0.06, z: halfZ + 0.32, sx: 1.1, sy: 0.12, sz: 0.4, yaw: 0, tilt: 0, tint: 0.7 });
    for (let k = 0; k < 5; k++) {
      const a = rand.range(0, Math.PI * 2);
      const d = rand.range(3.6, 4.4);
      stones.push({ x: Math.cos(a) * d, y: 0.05, z: Math.sin(a) * d * 0.85 - 0.6, sx: rand.range(0.25, 0.45), sy: rand.range(0.14, 0.22), sz: rand.range(0.22, 0.4), yaw: rand.range(0, 3), tilt: rand.range(-0.1, 0.1), tint: rand.next() });
    }
    this.stoneCount = stones.length;

    // instanced stones
    const stoneGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.16);
    const stoneMesh = new InstancedMesh(stoneGeo, this.material(shared, 'stone', false), stones.length);
    const tints = new Float32Array(stones.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Vector3();
    stones.forEach((s, i) => {
      q.setFromAxisAngle(e.set(0, 1, 0), s.yaw).multiply(new Quaternion().setFromAxisAngle(e.set(0, 0, 1), s.tilt));
      m.compose(new Vector3(s.x, s.y, s.z), q, new Vector3(s.sx, s.sy, s.sz));
      stoneMesh.setMatrixAt(i, m);
      tints[i] = s.tint;
    });
    stoneGeo.setAttribute('aTint', new InstancedBufferAttribute(tints, 1));
    stoneMesh.frustumCulled = false;
    const stoneOutline = new InstancedMesh(stoneGeo, this.material(shared, 'stone', true), stones.length);
    stoneOutline.instanceMatrix = stoneMesh.instanceMatrix;
    stoneOutline.frustumCulled = false;

    // mortar core so the gaps between stones read as mortar, and close the house
    const core = mergeGeometries([
      box(2 * halfX - 0.2, wall - 0.05, 2 * halfZ - 0.2, 0, wall / 2, 0, 0.02),
      box(0.5, 2.3, 0.5, 1.33, 3.85, -0.95, 0.02),
      box(L.x1 - L.x0 - 0.3, L.top - L.base - 0.08, L.z1 - L.z0 - 0.2, (L.x0 + L.x1) / 2, (L.base + L.top) / 2 - 0.05, (L.z0 + L.z1) / 2 + 0.05, 0.02),
    ]);
    const roof = roofGeometry(rand);
    const wood = mergeGeometries([
      withUvScale(box(0.86, 1.8, 0.06, -0.6, 0.92, halfZ - 0.08), 1),
      // window frames (front, side, back) and bench
      box(0.74, 0.07, 0.1, 1.3, 0.98, halfZ - 0.04),
      box(0.74, 0.07, 0.1, 1.3, 1.62, halfZ - 0.04),
      box(0.07, 0.64, 0.1, 0.96, 1.3, halfZ - 0.04),
      box(0.07, 0.64, 0.1, 1.64, 1.3, halfZ - 0.04),
      box(0.05, 0.6, 0.08, 1.3, 1.3, halfZ - 0.03),
      box(0.1, 0.07, 0.72, halfX - 0.04, 0.98, 0.45),
      box(0.1, 0.07, 0.72, halfX - 0.04, 1.6, 0.45),
      box(1.3, 0.07, 0.4, 0.55 + 0.6, 0.47, halfZ + 0.33),
      box(0.1, 0.44, 0.34, 0.55 + 0.05, 0.22, halfZ + 0.33),
      box(0.1, 0.44, 0.34, 0.55 + 1.15, 0.22, halfZ + 0.33),
      // fascia along the eaves
      box(2 * (halfX + COTTAGE.overhang) + 0.05, 0.08, 0.06, 0, COTTAGE.wall - 0.24, halfZ + COTTAGE.overhang),
      box(2 * (halfX + COTTAGE.overhang) + 0.05, 0.08, 0.06, 0, COTTAGE.wall - 0.24, -halfZ - COTTAGE.overhang),
    ]);
    const glass = mergeGeometries([box(0.58, 0.58, 0.04, 1.3, 1.3, halfZ - 0.14, 0.01), box(0.04, 0.56, 0.6, halfX - 0.14, 1.28, 0.45, 0.01), box(0.5, 0.5, 0.04, -0.0, 1.27, -halfZ + 0.14, 0.01)]);
    const iron = mergeGeometries([
      ...[2.4, 3.6, 4.8].map((z) => box(0.045, 0.9, 0.045, L.x0 + 0.12, L.top + 0.45, z, 0.01)),
      box(0.04, 0.045, 2.5, L.x0 + 0.12, L.top + 0.9, 3.6, 0.01),
      box(0.03, 0.03, 2.4, L.x0 + 0.12, L.top + 0.48, 3.6, 0.01),
    ]);

    for (const [geometry, kind] of [
      [core, 'mortar'],
      [roof, 'roof'],
      [wood, 'wood'],
      [glass, 'glass'],
      [iron, 'iron'],
    ] as const) {
      const mesh = new Mesh(geometry, this.material(shared, kind, false));
      mesh.frustumCulled = false;
      this.group.add(mesh);
      if (kind !== 'glass' && kind !== 'mortar') {
        const outline = new Mesh(geometry, this.material(shared, kind, true));
        outline.frustumCulled = false;
        this.group.add(outline);
      }
    }
    this.group.add(stoneMesh, stoneOutline);
    this.group.matrixAutoUpdate = false;
  }

  private material(shared: Record<string, IUniform>, kind: Kind, outline: boolean): ShaderMaterial {
    const mat = new ShaderMaterial({
      name: `${kind}${outline ? ' outline' : ''}`,
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, uKind: { value: KIND_ID[kind] } },
      defines: outline ? { OUTLINE: 1 } : {},
      side: outline ? BackSide : kind === 'roof' ? DoubleSide : FrontSide,
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
