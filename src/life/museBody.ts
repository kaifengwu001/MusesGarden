import type { Box } from './meshField';

// Muse's body: one signed distance field, measured off the front reference
// (reference/muse/1.webp, kept out of git) in units of Muse's height H, and
// meshed once by surface nets. The skin weights, the fur's length and the
// creases' shade are all read from the same field, so the shape, its
// skeleton and its paint can never disagree.
//
// The parts, in Muse's own frame (x to its left, y up, z forward; the
// ground at y = 0):
//   hood     a superellipsoid (2.5 up its profile): the domed top, the face
//            on its front a shallow plate sunk a little into it
//   belly    a boxier one (4.8) below it, blended in with no neck, wider
//            than the hood: together they are the pear of the silhouette
//   arms     two round cones a side (shoulder → elbow → the mitten's end),
//            hanging a little wider than the reference (an A-pose) so the
//            mesh keeps them apart from the belly; the idle pose brings them in
//   legs     two short rounded cylinders, flat-soled, merging into the belly
// The silhouette was fitted fur included; the skin is the fitted surface
// brought in by SKIN_INSET, and the fur (muse.vert.glsl) carries it back out.

/** How far inside the measured silhouette the skin lies (H): about the visible depth of the fur. */
export const SKIN_INSET = 0.018;

/** The hood and the belly (H): centre height, half-width, half-height, depth as a share of width, exponent up the profile and round the waist. */
const HOOD = { c: 0.6652, a: 0.265, b: 0.3346, depth: 0.86, n: 2.52, m: 2.4 } as const;
const BELLY = { c: 0.4012, a: 0.287, b: 0.3027, depth: 0.82, n: 4.8, m: 2.0 } as const;
/** How broadly the hood and the belly blend (H). */
const WAIST = 0.0164;

/** The face (H): its middle, half sizes and exponent (a rounded oblong, measured), how far it is sunk into the hood. */
export const FACE = { y: 0.772, half: [0.182, 0.127], n: 2.6, sink: 0.003 } as const;
/** The eyes, mouth and blush on the face (H), measured: eye centres (±x, y) and radius; the mouth's middle, half width and rise to its corners; the blush's centres and radius. */
export const FEATURES = {
  eye: { x: 0.0973, y: 0.7709, r: 0.0198 },
  mouth: { x: 0.004, y: 0.7228, half: 0.0285, rise: 0.0106, width: 0.0045 },
  blush: { x: 0.106, y: 0.727, r: 0.036 },
} as const;

/**
 * One arm in the field's A-pose (H, Muse's left; the right mirrors it):
 * where it starts, buried in the body, the elbow and the mitten's centre,
 * with their radii; and the joint it turns about, on its axis where it comes
 * out of the body's side. Brought in to hang (ARMS_IN), its outer edge meets
 * the hood's side about 0.6 up at the reference's slope (about 30° out from
 * the vertical) and runs on down to the mitten, so the line from the head
 * into the arm is one curve: the top of the arm never shows as a bump.
 */
export const ARM = {
  shoulder: [0.168, 0.638, 0.0],
  elbow: [0.3525, 0.389, 0.01],
  hand: [0.405, 0.249, 0.015],
  radius: [0.05, 0.05, 0.05],
  pivot: [0.233, 0.55, 0.0],
  /** How broadly the arm blends into the body (H): at the shoulder, a fillet where the arm's edge leaves the hood; below, barely, so it hangs free. */
  blend: [0.04, 0.008],
  elbowBlend: 0.02,
} as const;

/** The arms' turn in from the field's A-pose to hang against the belly (rad). */
export const ARMS_IN = 0.125;

/** A turn of an arm from the field's A-pose (rad, Muse's left; the right mirrors it): forward (about x, negative swings a hanging arm forward), in (about z) and the forearm's own bend (about z). */
export interface ArmTurn {
  x: number;
  z: number;
  fore: number;
}

/** The left arm's turn at the top of a wave, from the bind (rad, about x, y, z, and the forearm's bend about z; the right mirrors it), and how much it stretches as it reaches up (H, the forearm out along the upper arm). */
export interface ArmWave {
  x: number;
  y: number;
  z: number;
  fore: number;
  reach?: number;
}

/**
 * How a body sits on the skeleton: where its joints are (H, rest), how its
 * arms sit as its mesh was made (bind), as they hang when Muse stands idle,
 * and where the left one goes at the top of a wave. The field's own mesh is
 * made in the A-pose and hangs its arms in; a sculpt (museMesh.ts) is made
 * with its arms already hanging, so it hangs them as made.
 */
export interface MuseFit {
  rest: readonly (readonly [number, number, number])[];
  bind: ArmTurn;
  hang: ArmTurn;
  wave: ArmWave;
  /** How much longer the arms are drawn than made (H, the forearm moved out along the upper arm: the elbow's blend stretches, the arm keeps its thickness). */
  reach?: number;
  /** The share of each upper arm's turn its shoulder takes (0 … 1): the skin round the arm's root then bends over both. */
  shoulder?: number;
  /** The left mitten's middle as made (H): where it holds things (museRig.ts), and where the arm reaches from. */
  hand?: readonly [number, number, number];
  /** How high its top stands (H, rest), a hat's included: an icon floats over it (museEmotes.ts). Not given, tpose6's: 1. */
  crown?: number;
}

/** One leg (H, Muse's left): centre x and z, radius, top (inside the belly) and the rounding of the sole's edge. */
const LEG = { x: 0.128, z: 0.005, r: 0.0835, top: 0.22, round: 0.035, blend: 0.03 } as const;

/**
 * Grid step of the mesher (H): a cell is about 1.8 cm on a Muse 1.1 m tall.
 * The vertices are settled onto the surface, so the outline strays from it
 * by about a millimetre (a quarter of a pixel with Muse filling the screen).
 */
const CELL = 0.016;
/** The box the mesher samples (H), with a cell or two to spare. */
const BOX = { x: [-0.47, 0.47], y: [-0.02, 1.02], z: [-0.31, 0.31] } as const;

/**
 * The skeleton (H, rest pose): each joint's parent and position. The legs
 * hang from the root, not the pelvis, so the feet stay planted while the
 * body sways over them; each arm hangs from a shoulder inside the body, off
 * the chest, which takes a share of the arm's every turn (MuseFit.shoulder),
 * so the skin round its root bends over two joints, not one.
 */
export const JOINT = {
  root: 0,
  pelvis: 1,
  spine: 2,
  chest: 3,
  head: 4,
  upperArmL: 5,
  foreArmL: 6,
  upperArmR: 7,
  foreArmR: 8,
  legL: 9,
  legR: 10,
  shoulderL: 11,
  shoulderR: 12,
} as const;
export const JOINTS = 13;
export const PARENT: readonly number[] = [-1, 0, 1, 2, 3, 11, 5, 12, 7, 0, 0, 3, 3];
/** The joints in an order that puts each after its parent. */
export const ORDER: readonly number[] = [0, 1, 2, 3, 4, 11, 5, 6, 12, 7, 8, 9, 10];
export const REST: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 0.14, 0],
  [0, 0.36, 0],
  [0, 0.55, 0],
  [0, 0.7, 0],
  [ARM.pivot[0], ARM.pivot[1], ARM.pivot[2]],
  [ARM.elbow[0], ARM.elbow[1], ARM.elbow[2]],
  [-ARM.pivot[0], ARM.pivot[1], ARM.pivot[2]],
  [-ARM.elbow[0], ARM.elbow[1], ARM.elbow[2]],
  [LEG.x, LEG.top - 0.08, LEG.z],
  [-LEG.x, LEG.top - 0.08, LEG.z],
  [0.15, ARM.pivot[1], 0],
  [-0.15, ARM.pivot[1], 0],
];

/** The field's fit: its wave throws the upper arm up and out from the side (about 50° over level), the elbow bent so the forearm stands up in one soft curve. */
export const FIELD_FIT: MuseFit = {
  rest: REST,
  bind: { x: 0, z: 0, fore: 0 },
  hang: { x: 0, z: -ARMS_IN, fore: -0.03 },
  wave: { x: 0.15, y: 0.08, z: 1.75, fore: 0.95 },
  hand: [ARM.hand[0], ARM.hand[1], ARM.hand[2]],
};

export interface MuseBody {
  /** Rest positions (H). */
  position: Float32Array;
  normal: Float32Array;
  index: Uint16Array | Uint32Array;
  /** Four joints and their weights per vertex. */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Fur length (× the full length): none on the face and the soles, a fuller roll round the face. */
  fur: Float32Array;
  /** Open sky above the skin (0 deep in a crease … 1 open), from the field. */
  open: Float32Array;
}

// ---- the field ----

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/** A superellipsoid about the y axis (exponent n up its profile, m round it), as an approximate distance: its norm less one, times its smaller radius. */
function superellipsoid(x: number, y: number, z: number, c: number, a: number, b: number, depth: number, n: number, m: number): number {
  const ax = Math.abs(x) / a;
  const az = Math.abs(z) / (a * depth);
  const r = Math.pow(Math.pow(ax, m) + Math.pow(az, m), 1 / m);
  const t = Math.abs(y - c) / b;
  return (Math.pow(Math.pow(r, n) + Math.pow(t, n), 1 / n) - 1) * Math.min(a * depth, b);
}

/** Round cone from a (radius ra) to b (radius rb) (Inigo Quilez's uneven capsule, exact). */
export function roundCone(px: number, py: number, pz: number, a: readonly number[], b: readonly number[], ra: number, rb: number): number {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const qx = px - a[0];
  const qy = py - a[1];
  const qz = pz - a[2];
  const y = qx * bx + qy * by + qz * bz;
  const z = y - l2;
  const xx = qx * l2 - bx * y;
  const xy = qy * l2 - by * y;
  const xz = qz * l2 - bz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
}

/** A flat-soled leg: a cylinder from the ground to LEG.top, its sole's edge rounded. */
function leg(x: number, y: number, z: number): number {
  const half = LEG.top / 2;
  const dx = Math.hypot(x, z) - (LEG.r - LEG.round);
  const dy = Math.abs(y - half) - (half - LEG.round);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - LEG.round;
}

/** How much of the face a point at (x, y) on the front is in: 1 inside, 0 outside, over a soft rim; and its radial measure (1 at the face's edge). */
export function faceRadius(x: number, y: number): number {
  const u = Math.abs(x) / FACE.half[0];
  const v = Math.abs(y - FACE.y) / FACE.half[1];
  return Math.pow(Math.pow(u, FACE.n) + Math.pow(v, FACE.n), 1 / FACE.n);
}

/**
 * A point carried back into the left arm's A-pose frame from a body whose
 * arms sit turned (MuseFit.bind): about the shoulder's pivot, then (for the
 * forearm) about the elbow. side −1 mirrors it for the right arm.
 */
function toArmRest(x: number, y: number, z: number, side: number, turn: ArmTurn, fore: boolean, out: number[]): void {
  // into the left arm's frame, then undo the turn (applied as x after z: undo x, then z)
  let px = side * x - ARM.pivot[0];
  let py = y - ARM.pivot[1];
  let pz = z - ARM.pivot[2];
  const cx = Math.cos(-turn.x);
  const sx = Math.sin(-turn.x);
  [py, pz] = [py * cx - pz * sx, py * sx + pz * cx];
  const cz = Math.cos(-turn.z);
  const sz = Math.sin(-turn.z);
  [px, py] = [px * cz - py * sz, px * sz + py * cz];
  px += ARM.pivot[0];
  py += ARM.pivot[1];
  pz += ARM.pivot[2];
  if (fore && turn.fore !== 0) {
    const cf = Math.cos(-turn.fore);
    const sf = Math.sin(-turn.fore);
    const ex = px - ARM.elbow[0];
    const ey = py - ARM.elbow[1];
    px = ARM.elbow[0] + ex * cf - ey * sf;
    py = ARM.elbow[1] + ex * sf + ey * cf;
  }
  out[0] = px;
  out[1] = py;
  out[2] = pz;
}

const armPoint = [0, 0, 0];

/** The parts' fields at a point: body (hood ∪ belly, the face sunk), upper and fore arms (left, right), legs (left, right); the arms where the fit sits them. */
function parts(x: number, y: number, z: number, out: Float64Array, fit: MuseFit = FIELD_FIT): void {
  const i = SKIN_INSET;
  const hood = superellipsoid(x, y, z, HOOD.c, HOOD.a - i, HOOD.b - i, HOOD.depth, HOOD.n, HOOD.m);
  const belly = superellipsoid(x, y, z, BELLY.c, BELLY.a - i, BELLY.b - i, BELLY.depth, BELLY.n, BELLY.m);
  let body = smin(hood, belly, WAIST);
  if (z > 0.06) {
    // the face, a shallow plate sunk into the front of the hood
    const r = faceRadius(x, y);
    if (r < 1.3) body += FACE.sink * (1 - smooth01((r - 0.92) / 0.3)) * smooth01((z - 0.06) / 0.08);
  }
  out[0] = body;
  const [rs, re, rh] = ARM.radius;
  const p = armPoint;
  for (const [side, slot] of [
    [1, 1],
    [-1, 3],
  ] as const) {
    toArmRest(x, y, z, side, fit.bind, false, p);
    out[slot] = roundCone(p[0], p[1], p[2], ARM.shoulder, ARM.elbow, rs, re);
    toArmRest(x, y, z, side, fit.bind, true, p);
    out[slot + 1] = roundCone(p[0], p[1], p[2], ARM.elbow, ARM.hand, re, rh);
  }
  out[5] = leg(x - LEG.x, y, z - LEG.z);
  out[6] = leg(x + LEG.x, y, z - LEG.z);
}

export function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

const scratch = new Float64Array(7);

/** Muse's field (H): negative inside the skin; its arms where the fit sits them (by default, the A-pose it is meshed in). */
export function museField(x: number, y: number, z: number, fit: MuseFit = FIELD_FIT): number {
  parts(x, y, z, scratch, fit);
  return combine(scratch, y);
}

/** How broadly an arm blends into the body at a height (H): a fillet at the shoulder, barely below, so it hangs free. */
function armBlend(y: number): number {
  return ARM.blend[1] + (ARM.blend[0] - ARM.blend[1]) * smooth01((y - 0.5) / 0.1);
}

function combine(p: Float64Array, y: number): number {
  const armL = smin(p[1], p[2], ARM.elbowBlend);
  const armR = smin(p[3], p[4], ARM.elbowBlend);
  const k = armBlend(y);
  let d = smin(p[0], armL, k);
  d = smin(d, armR, k);
  d = smin(d, p[5], LEG.blend);
  return smin(d, p[6], LEG.blend);
}

// ---- the mesh ----

/**
 * Surface nets over the field: a vertex in each cell the surface crosses
 * (the mean of its edges' crossings, then settled onto the surface along
 * the field's gradient), a quad across each crossed grid edge. Cells far
 * from the surface (by a coarse pass, the field being nearly a distance)
 * are never sampled finely.
 */
export function surfaceNets(field: (x: number, y: number, z: number) => number, box: Box, cell: number): Pick<MuseBody, 'position' | 'normal' | 'index'> {
  const nx = Math.round((box.x[1] - box.x[0]) / cell);
  const ny = Math.round((box.y[1] - box.y[0]) / cell);
  const nz = Math.round((box.z[1] - box.z[0]) / cell);
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const at = (i: number, j: number, k: number): number => i + sx * (j + sy * k);
  const px = (i: number): number => box.x[0] + i * cell;
  const py = (j: number): number => box.y[0] + j * cell;
  const pz = (k: number): number => box.z[0] + k * cell;
  const grid = new Float32Array(sx * sy * sz);

  // coarse pass: blocks of B cells whose centre is far from the surface take its sign without sampling
  const B = 4;
  const reach = 1.6 * cell * B * Math.sqrt(3) * 0.5 + cell;
  for (let k0 = 0; k0 < sz; k0 += B) {
    for (let j0 = 0; j0 < sy; j0 += B) {
      for (let i0 = 0; i0 < sx; i0 += B) {
        const i1 = Math.min(i0 + B, sx);
        const j1 = Math.min(j0 + B, sy);
        const k1 = Math.min(k0 + B, sz);
        const c = field(px((i0 + i1 - 1) / 2), py((j0 + j1 - 1) / 2), pz((k0 + k1 - 1) / 2));
        const far = Math.abs(c) > reach;
        for (let k = k0; k < k1; k++)
          for (let j = j0; j < j1; j++)
            for (let i = i0; i < i1; i++) grid[at(i, j, k)] = far ? c : field(px(i), py(j), pz(k));
      }
    }
  }

  // a vertex per crossed cell
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const cellAt = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
  const pos: number[] = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float64Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = grid[at(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
          if (v[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let mx = 0;
        let my = 0;
        let mz = 0;
        let n = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          mx += corners[a][0] + t * (corners[b][0] - corners[a][0]);
          my += corners[a][1] + t * (corners[b][1] - corners[a][1]);
          mz += corners[a][2] + t * (corners[b][2] - corners[a][2]);
          n++;
        }
        cellVertex[cellAt(i, j, k)] = pos.length / 3;
        pos.push(px(i + mx / n), py(j + my / n), pz(k + mz / n));
      }
    }
  }

  // a quad across each crossed grid edge, wound outward
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++) {
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // the x edge from (i, j, k) to (i + 1, j, k)
        const a = grid[at(i, j, k)] < 0;
        if (a === grid[at(i + 1, j, k)] < 0) continue;
        quad(cellVertex[cellAt(i, j - 1, k - 1)], cellVertex[cellAt(i, j, k - 1)], cellVertex[cellAt(i, j, k)], cellVertex[cellAt(i, j - 1, k)], !a);
      }
    }
  }
  for (let k = 1; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const a = grid[at(i, j, k)] < 0;
        if (a === grid[at(i, j + 1, k)] < 0) continue;
        quad(cellVertex[cellAt(i - 1, j, k - 1)], cellVertex[cellAt(i - 1, j, k)], cellVertex[cellAt(i, j, k)], cellVertex[cellAt(i, j, k - 1)], !a);
      }
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const a = grid[at(i, j, k)] < 0;
        if (a === grid[at(i, j, k + 1)] < 0) continue;
        quad(cellVertex[cellAt(i - 1, j - 1, k)], cellVertex[cellAt(i, j - 1, k)], cellVertex[cellAt(i, j, k)], cellVertex[cellAt(i - 1, j, k)], !a);
      }
    }
  }

  // settle each vertex onto the surface, and take its normal from the field's gradient
  const count = pos.length / 3;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const e = cell * 0.25;
  const g = [0, 0, 0];
  const gradient = (x: number, y: number, z: number): number => {
    const f = field(x, y, z);
    g[0] = field(x + e, y, z) - f;
    g[1] = field(x, y + e, z) - f;
    g[2] = field(x, y, z + e) - f;
    return f;
  };
  for (let n = 0; n < count; n++) {
    let x = pos[n * 3];
    let y = pos[n * 3 + 1];
    let z = pos[n * 3 + 2];
    for (let step = 0; step < 2; step++) {
      const f = gradient(x, y, z);
      const l2 = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (e * e);
      if (l2 < 1e-12) break;
      const s = f / l2 / e;
      x -= s * g[0];
      y -= s * g[1];
      z -= s * g[2];
    }
    gradient(x, y, z);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    position.set([x, y, z], n * 3);
    normal.set([g[0] / l, g[1] / l, g[2] / l], n * 3);
  }

  return { position, normal, index: count < 65536 ? new Uint16Array(index) : new Uint32Array(index) };
}

/** Muse's own body: its field meshed, weighted, furred and shaded. */
export function buildMuseBody(): MuseBody {
  const mesh = surfaceNets(museField, BOX, CELL);
  return { ...mesh, ...bodyAttributes(mesh.position, mesh.normal, mesh.index) };
}

/**
 * What the shaders need besides the shape, for any skin laid where the field
 * is (this mesh, or a sculpt of Muse set in its frame: museMesh.ts): the
 * joints' weights, the fur's length and the open sky over each vertex.
 */
export function bodyAttributes(
  position: Float32Array,
  normal: Float32Array,
  index: ArrayLike<number> | null,
  fit: MuseFit = FIELD_FIT,
  shape: (x: number, y: number, z: number) => number = (x, y, z) => museField(x, y, z, fit),
  membership: Membership = fieldMembership(position, fit),
): Pick<MuseBody, 'skinIndex' | 'skinWeight' | 'fur' | 'open'> {
  const count = position.length / 3;
  const { skinIndex, skinWeight } = skin(position, index, fit, membership);
  const fur = new Float32Array(count);
  const open = new Float32Array(count);
  for (let n = 0; n < count; n++) {
    const x = position[n * 3];
    const y = position[n * 3 + 1];
    const z = position[n * 3 + 2];
    fur[n] = furAt(x, y, z);
    open[n] = openness(x, y, z, normal[n * 3], normal[n * 3 + 1], normal[n * 3 + 2], shape);
  }
  return { skinIndex, skinWeight, fur, open };
}

/** The fur's length at a point of the skin (× the full length). */
function furAt(x: number, y: number, z: number): number {
  // none on the face; round it a fuller roll, the hood's edge
  let f = 1;
  if (z > 0.06) {
    const r = faceRadius(x, y);
    const front = smooth01((z - 0.06) / 0.08);
    const edge = smooth01((r - 1.0) / 0.035);
    const roll = Math.exp(-(((r - 1.07) / 0.06) ** 2));
    f = 1 - front * (1 - edge) + front * 0.45 * roll;
  }
  // and none on the soles: the feet stand on the ground
  return f * smooth01(y / 0.035);
}

/** Open sky above the skin: the field sampled out along the normal (a crease reads its neighbour close by). */
export function openness(x: number, y: number, z: number, nx: number, ny: number, nz: number, shape: (x: number, y: number, z: number) => number): number {
  let shut = 0;
  let w = 0.5;
  for (let s = 1; s <= 4; s++) {
    const d = 0.018 * s;
    shut += (w * Math.max(0, d - shape(x + nx * d, y + ny * d, z + nz * d))) / d;
    w *= 0.5;
  }
  // and the underside shut in by the ground close below it
  const low = 1 - smooth01(y / 0.12);
  const down = smooth01(-ny);
  return Math.max(0, Math.min(1, 1 - 1.4 * shut)) * (1 - 0.3 * low * (0.4 + 0.6 * down));
}

/** What a vertex belongs to (shares summing to 1): the body, the left and right arms, the left and right legs. */
export type Membership = (i: number, out: Float64Array) => void;

/** The parts' fields decide membership: a vertex belongs wholly to the part whose surface is nearest (so an arm's weight never reaches the side it hangs against). */
function fieldMembership(position: Float32Array, fit: MuseFit): Membership {
  const p = new Float64Array(7);
  const part = [0, 1, 1, 2, 2, 3, 4];
  return (i, out) => {
    parts(position[i * 3], position[i * 3 + 1], position[i * 3 + 2], p, fit);
    let best = 0;
    for (let k = 1; k < 7; k++) if (p[k] < p[best]) best = k;
    out.fill(0);
    out[part[best]] = 1;
  };
}

/**
 * Skin weights, for any skin of Muse: each vertex's membership (the body, an
 * arm, a leg) passed along its bones. An arm's share goes from the chest to
 * the upper arm across the shoulder by how far along the upper arm the
 * vertex lies (the root blended over its first third), and from the upper
 * arm to the forearm across the elbow (half the upper arm's length, a soft
 * bend). The body over the top of a shoulder (above its arm's bone, near
 * its root) shares in the arm by how near the bone it is, so the shoulder
 * rounds as the arm lifts; the body below the armpit never does, so a
 * raised arm leaves the side where it is. A leg's share goes from the
 * pelvis to the leg across the hip, by height. The body's is shared up its
 * height between the pelvis, spine, chest and head. The four largest are
 * kept.
 */
function skin(position: Float32Array, index: ArrayLike<number> | null, fit: MuseFit, membership: Membership): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const count = position.length / 3;
  const full = new Float32Array(count * JOINTS);
  const m = new Float64Array(5);
  // the arms' bones as the mesh holds them (the fit's bind turn about the shoulder)
  const bones = [1, -1].map((side) => {
    const pivot = [side * ARM.pivot[0], ARM.pivot[1], ARM.pivot[2]];
    const elbow = boundPoint(ARM.elbow, side, fit.bind);
    const hand = boundPoint(ARM.hand, side, fit.bind);
    const u = [elbow[0] - pivot[0], elbow[1] - pivot[1], elbow[2] - pivot[2]];
    const lu = Math.hypot(u[0], u[1], u[2]);
    const f = [hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]];
    const lf = Math.hypot(f[0], f[1], f[2]);
    const un = u.map((c) => c / lu);
    // across the bone, up and out: the top of the shoulder lies this way of it
    const top = [-un[0] * un[1], 1 - un[1] * un[1], -un[2] * un[1]];
    const lt = Math.hypot(top[0], top[1], top[2]);
    return { pivot, elbow, u: un, lu, f: f.map((c) => c / lf), lf, top: top.map((c) => c / lt) };
  });
  const reach = ARM.radius[0] + 0.03;
  const J = JOINT;
  for (let n = 0; n < count; n++) {
    const x = position[n * 3];
    const y = position[n * 3 + 1];
    const z = position[n * 3 + 2];
    membership(n, m);
    const w = full.subarray(n * JOINTS, (n + 1) * JOINTS);
    let chest = 0;
    let pelvis = 0;
    for (const [k, b, upper, fore] of [
      [1, bones[0], J.upperArmL, J.foreArmL],
      [2, bones[1], J.upperArmR, J.foreArmR],
    ] as const) {
      if (m[k] <= 0) continue;
      // along the upper arm from the shoulder (in its lengths), and along the forearm from the elbow
      const t = ((x - b.pivot[0]) * b.u[0] + (y - b.pivot[1]) * b.u[1] + (z - b.pivot[2]) * b.u[2]) / b.lu;
      const tf = ((x - b.elbow[0]) * b.f[0] + (y - b.elbow[1]) * b.f[1] + (z - b.elbow[2]) * b.f[2]) / b.lu;
      // over the top of the shoulder the root blends broadly (it rounds as the arm lifts); under it,
      // at the armpit, at once (the arm's underside goes with the arm, a crease against the side)
      const above = (x - b.pivot[0]) * b.top[0] + (y - b.pivot[1]) * b.top[1] + (z - b.pivot[2]) * b.top[2];
      const broad = smooth01(above / ARM.radius[0] + 0.5);
      const root = smooth01((t + 0.1 * broad + 0.02) / (0.08 + 0.37 * broad));
      const bend = smooth01((Math.max(t - 1, tf) + 0.4) / 0.8);
      w[upper] += m[k] * root * (1 - bend);
      w[fore] += m[k] * root * bend;
      chest += m[k] * (1 - root);
    }
    if (m[0] > 0) {
      // the body over the top of a shoulder rides with its arm, the nearer the bone the more
      for (const [b, upper] of [
        [bones[0], J.upperArmL],
        [bones[1], J.upperArmR],
      ] as const) {
        const dx = x - b.pivot[0];
        const dy = y - b.pivot[1];
        const dz = z - b.pivot[2];
        const t = (dx * b.u[0] + dy * b.u[1] + dz * b.u[2]) / b.lu;
        const above = dx * b.top[0] + dy * b.top[1] + dz * b.top[2];
        if (above <= 0 || t < -0.4 || t > 0.5) continue;
        const along = t * b.lu;
        const off = Math.hypot(dx - along * b.u[0], dy - along * b.u[1], dz - along * b.u[2]);
        const share = 0.45 * (1 - smooth01((off - ARM.radius[0]) / reach)) * (1 - smooth01((Math.abs(t) - 0.1) / 0.3)) * smooth01(above / 0.02);
        w[upper] += m[0] * share;
        m[0] *= 1 - share;
      }
    }
    for (const [k, leg] of [
      [3, J.legL],
      [4, J.legR],
    ] as const) {
      if (m[k] <= 0) continue;
      const hip = smooth01((y - 0.06) / 0.12);
      w[leg] += m[k] * (1 - hip);
      pelvis += m[k] * hip;
    }
    // up the body: pelvis → spine → chest → head
    const body = m[0];
    const s1 = smooth01((y - 0.2) / 0.14);
    const s2 = smooth01((y - 0.4) / 0.14);
    const s3 = smooth01((y - 0.58) / 0.1);
    w[J.pelvis] += body * (1 - s1) + pelvis;
    w[J.spine] += body * s1 * (1 - s2);
    w[J.chest] += body * s2 * (1 - s3) + chest;
    w[J.head] += body * s3;
  }
  if (index) smoothWeights(full, index, 1);
  return packWeights(full);
}

/** Every joint's weight per vertex (JOINTS each) as the shaders take them: the four largest, summing to one. */
export function packWeights(full: Float32Array): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const count = full.length / JOINTS;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const order = Array.from({ length: JOINTS }, (_, i) => i);
  for (let n = 0; n < count; n++) {
    const w = full.subarray(n * JOINTS, (n + 1) * JOINTS);
    order.sort((a, b) => w[b] - w[a]);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += w[order[k]];
    for (let k = 0; k < 4; k++) {
      skinIndex[n * 4 + k] = order[k];
      skinWeight[n * 4 + k] = sum > 0 ? w[order[k]] / sum : k === 0 ? 1 : 0;
    }
  }
  return { skinIndex, skinWeight };
}

/** A point of the left arm in the A-pose (H), as the fit binds it (turned about the shoulder), on a side. */
function boundPoint(point: readonly number[], side: number, turn: ArmTurn): number[] {
  // the inverse of toArmRest for the upper arm: turn about z, then x, about the pivot
  let px = point[0] - ARM.pivot[0];
  let py = point[1] - ARM.pivot[1];
  let pz = point[2] - ARM.pivot[2];
  const cz = Math.cos(turn.z);
  const sz = Math.sin(turn.z);
  [px, py] = [px * cz - py * sz, px * sz + py * cz];
  const cx = Math.cos(turn.x);
  const sx = Math.sin(turn.x);
  [py, pz] = [py * cx - pz * sx, py * sx + pz * cx];
  return [side * (px + ARM.pivot[0]), py + ARM.pivot[1], pz + ARM.pivot[2]];
}

/** Weights averaged with their neighbours' along the mesh's edges, a few rounds. */
export function smoothWeights(full: Float32Array, index: ArrayLike<number>, rounds: number): void {
  const count = full.length / JOINTS;
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e];
      const b = index[t + ((e + 1) % 3)];
      if (!neighbours[a].includes(b)) neighbours[a].push(b);
      if (!neighbours[b].includes(a)) neighbours[b].push(a);
    }
  }
  const next = new Float32Array(full.length);
  for (let r = 0; r < rounds; r++) {
    for (let n = 0; n < count; n++) {
      const ns = neighbours[n];
      const k = 1 / (2 + ns.length);
      for (let j = 0; j < JOINTS; j++) {
        let sum = 2 * full[n * JOINTS + j];
        for (const q of ns) sum += full[q * JOINTS + j];
        next[n * JOINTS + j] = sum * k;
      }
    }
    full.set(next);
  }
}
