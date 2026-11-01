import { BufferAttribute, InstancedBufferGeometry, Vector3 } from 'three';
import { hash32, mix, unit } from '../../../src/core/hash';

// Paper Orchard's reusable meshes, in meters: y up from the ground, the base
// centred on the origin, +z the front. Geometry carries the silhouettes (the
// slate's broken planes, the leaves' tapered outlines, the stems); the
// shader (landmark.frag.glsl) carries the small marks.
//
// Per vertex: position, normal and aPart = (part, t, slot, shade):
//   part   0 slate, 1 woody stem, 2 gold leaf, 3 papery calyx, 4 berry,
//          5 ivory comb leaflet, 6 periwinkle tussock blade
//   t      height as a fraction of the mesh's (the wind bends the top most)
//   slot   reserved leaf-variation slot; the orchard uses 0 so fruit and
//          structural foliage are never pruned by the old lance-count gate
//   shade  a random per face (slate: planar colour variation) or, on a leaf,
//          the position across it, −1 at one edge … 1 at the other
// and aLeaf = (along the leaf 0..1, its length m) for a leaf's veins.

/** Kit sizes (m): width (x), depth (z), height (y). */
export const KIT = {
  slab: [3.0, 1.8, 1.05],
  block: [1.35, 1.05, 0.9],
  wedge: [0.48, 0.32, 0.24],
  /** Open, arched orchard shrubs, with broad thin leaves and Physalis calyces. */
  reed: [3.8, 3.4, 3.8],
  comb: [1.45, 1.45, 1.3],
  tussock: [1.1, 1.1, 0.75],
} as const;
export type KitKind = keyof typeof KIT;
export const KIT_KINDS: readonly KitKind[] = ['slab', 'block', 'wedge', 'reed', 'comb', 'tussock'];
/** Orchard shrub heights (m); the reed name remains for the scatter channel. */
export const REED_HEIGHT = [2.8, 4.2] as const;

interface Mesh {
  pos: number[];
  normal: number[];
  part: number[];
  leaf: number[];
  idx: number[];
}

function mesh(): Mesh {
  return { pos: [], normal: [], part: [], leaf: [], idx: [] };
}

/** Add a vertex; returns its index. */
function vertex(m: Mesh, p: Vector3, n: Vector3, part: readonly [number, number, number, number], leaf: readonly [number, number]): number {
  m.pos.push(p.x, p.y, p.z);
  m.normal.push(n.x, n.y, n.z);
  m.part.push(...part);
  m.leaf.push(...leaf);
  return m.pos.length / 3 - 1;
}

function finish(m: Mesh): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const positions = new Float32Array(m.pos);
  const indices: number[] = [];
  const seen = new Set<string>();
  const at = (i: number): Vector3 => new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  for (let i = 0; i < m.idx.length; i += 3) {
    const ids = m.idx.slice(i, i + 3);
    const points = ids.map(at);
    const cross = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (cross.lengthSq() < 1e-20) continue;
    // A single thin surface is already visible from both sides. Never submit mirrored copies.
    const key = points.map((p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e6)).join(',')).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    indices.push(...ids);
  }
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(m.normal), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(m.part), 4));
  g.setAttribute('aLeaf', new BufferAttribute(new Float32Array(m.leaf), 2));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

const e1 = new Vector3();
const e2 = new Vector3();
const fn = new Vector3();

const mid = new Vector3();

/** One flat-shaded triangle (its own face normal), turned to face away from `inside` (the solid is convex). */
function facet(m: Mesh, a: Vector3, b: Vector3, c: Vector3, inside: Vector3, height: number, shade: number): void {
  fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
  const out = fn.dot(mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(inside)) >= 0;
  if (!out) fn.negate();
  for (const p of out ? [a, b, c] : [a, c, b]) m.idx.push(vertex(m, p, fn, [0, Math.max(p.y, 0) / height, 0, shade], [0, 0]));
}

interface SlateSpec {
  readonly size: readonly [number, number, number];
  /** Sides of its plan, its shoulder (fraction of the height where the sides break to the top), bevel (m), top tilt (m per m in x, z), chipped corners. */
  readonly sides: number;
  readonly shoulder: number;
  readonly bevel: number;
  readonly tilt: readonly [number, number];
  readonly chips: number;
  /** How far the top's middle sinks below its rim (m): the top breaks into a few planes. */
  readonly dish: number;
  readonly seed: number;
}

/**
 * A slate: an irregular plan, near-vertical broken sides from below the
 * ground to a shoulder, a bevel up to a tilted top whose middle sits a little
 * low (so it reads as a few fracture planes, not a flat lid), a few corners
 * chipped deeper. Flat-shaded: every plane its own colour.
 */
function slate(spec: SlateSpec): InstancedBufferGeometry {
  const m = mesh();
  const [w, d, h] = spec.size;
  let s = hash32(spec.seed >>> 0);
  const rand = (): number => unit((s = hash32(mix(s, 0x9e3779b9))));
  const n = spec.sides;
  const base: Vector3[] = [];
  const middle: Vector3[] = [];
  const bed: Vector3[] = [];
  const bedLip: Vector3[] = [];
  const shoulder: Vector3[] = [];
  const rim: Vector3[] = [];
  const tiltTop = (Math.abs(spec.tilt[0]) * w + Math.abs(spec.tilt[1]) * d) * 0.5;
  const top = (x: number, z: number): number => h - tiltTop + spec.tilt[0] * x + spec.tilt[1] * z;
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.35 * (rand() - 0.5)) / n) * Math.PI * 2;
    const r = 0.8 + 0.2 * rand();
    // Broken rectangular bedding planes, not a ring of regular hexagonal pavers.
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** 0.55 * (w / 2) * r;
    const z = Math.sign(sn) * Math.abs(sn) ** 0.55 * (d / 2) * r;
    base.push(new Vector3(x, -0.12 * h - 0.03, z));
    // each side breaks once on the way up: in or out a little, at its own height (two planes, not one)
    const bulge = 0.9 + 0.1 * rand();
    const localHeight = top(x, z);
    middle.push(new Vector3(x * bulge, localHeight * (0.14 + 0.05 * rand()), z * bulge));
    const joint = 0.025 * localHeight * (rand() - 0.5);
    bed.push(new Vector3(x * 0.91, localHeight * 0.34 + joint, z * 0.91));
    bedLip.push(new Vector3(x * 0.99, localHeight * 0.42 + joint, z * 0.99));
    shoulder.push(new Vector3(x, localHeight * (0.56 + spec.shoulder * 0.1 + 0.025 * rand()), z));
    const chip = rand() < spec.chips ? 1.8 : 1;
    const inset = (spec.bevel * chip) / Math.hypot(w / 2, d / 2);
    const rx = x * (1 - inset * 1.4);
    const rz = z * (1 - inset * 1.4);
    rim.push(new Vector3(rx, top(rx, rz) - (chip > 1 ? spec.bevel * 0.8 : 0), rz));
  }
  const centre = new Vector3(0, top(0, 0) - spec.dish, 0);
  const inside = new Vector3(0, 0.35 * h, 0);
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const shade = (): number => rand();
    // Sparse physical bedding edges break a solid mineral mass into chipped strata.
    const rings = [base, middle, bed, bedLip, shoulder];
    for (let j = 0; j < rings.length - 1; j++) {
      const face = shade();
      facet(m, rings[j][k], rings[j][k1], rings[j + 1][k1], inside, h, face);
      facet(m, rings[j][k], rings[j + 1][k1], rings[j + 1][k], inside, h, face);
    }
    // bevel: shoulder → rim
    facet(m, shoulder[k], shoulder[k1], rim[k1], inside, h, shade());
    facet(m, shoulder[k], rim[k1], rim[k], inside, h, shade());
    // top: rim → the sunken middle
    facet(m, rim[k], rim[k1], centre, inside, h, shade());
  }
  return finish(m);
}

/** R01 split slab, R02 fractured block, R03 wedge (assets.json). */
export function slab(): InstancedBufferGeometry {
  return slate({ size: KIT.slab, sides: 12, shoulder: 0.76, bevel: 0.14, tilt: [0.025, -0.045], chips: 0.5, dish: 0.055, seed: 101 });
}

export function block(): InstancedBufferGeometry {
  return slate({ size: KIT.block, sides: 8, shoulder: 0.7, bevel: 0.12, tilt: [0.09, 0.04], chips: 0.45, dish: 0.04, seed: 202 });
}

export function wedge(): InstancedBufferGeometry {
  const m = mesh();
  const [w, d, h] = KIT.wedge;
  const bottom = -0.12 * h - 0.03;
  const p = [
    new Vector3(-w / 2, bottom, -d / 2), new Vector3(w / 2, bottom, -d / 2),
    new Vector3(w / 2, bottom, d / 2), new Vector3(-w / 2, bottom, d / 2),
    new Vector3(-w / 2, h * 0.12, -d / 2), new Vector3(w / 2, h, -d / 2),
    new Vector3(w / 2, h * 0.92, d / 2), new Vector3(-w / 2, h * 0.08, d / 2),
  ];
  const inside = new Vector3(0, h * 0.25, 0);
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  faces.forEach(([a, b, c, dd], k) => {
    facet(m, p[a], p[b], p[c], inside, h, k / faces.length);
    facet(m, p[a], p[c], p[dd], inside, h, k / faces.length);
  });
  return finish(m);
}

// ---- the sail-reed --------------------------------------------------------

const UP = new Vector3(0, 1, 0);

/** A woody stem: two crossed tapering ribbons along a gently curving line from the base to `tip`. */
function stem(m: Mesh, root: Vector3, tip: Vector3, bow: Vector3, width: number, height: number): void {
  const segments = 6;
  const point = (t: number, out: Vector3): Vector3 => out.copy(root).lerp(tip, t).addScaledVector(bow, Math.sin(Math.PI * t));
  const along = new Vector3();
  const sideA = new Vector3();
  const sideB = new Vector3();
  const p = new Vector3();
  const q = new Vector3();
  for (const turn of [0, Math.PI / 2]) {
    let prev: [number, number] | null = null;
    for (let k = 0; k <= segments; k++) {
      const t = k / segments;
      point(t, p);
      point(Math.min(t + 0.01, 1), q);
      along.subVectors(q, point(Math.max(t - 0.01, 0), sideA)).normalize();
      sideA.set(Math.cos(turn), 0, Math.sin(turn)).addScaledVector(along, -along.x * Math.cos(turn) - along.z * Math.sin(turn)).normalize();
      sideB.crossVectors(along, sideA).normalize();
      const half = (width / 2) * (1 - 0.6 * t);
      const a = p.clone().addScaledVector(sideA, -half);
      const b = p.clone().addScaledVector(sideA, half);
      const ia = vertex(m, a, sideB, [1, Math.max(a.y, 0) / height, 0, 0], [0, 0]);
      const ib = vertex(m, b, sideB, [1, Math.max(b.y, 0) / height, 0, 0], [0, 0]);
      if (prev) m.idx.push(prev[0], prev[1], ib, prev[0], ib, ia);
      prev = [ia, ib];
    }
  }
}

/** A thin, folded leaf. Wide bases give orchard leaves their heart/kite silhouette. */
function leaf(m: Mesh, at: Vector3, dir: Vector3, length: number, width: number, droop: number, slot: number, height: number, part = 2, broad = false): void {
  const segments = part === 5 ? 2 : part === 6 ? 4 : height <= 1 ? 4 : 7;
  const across = new Vector3().crossVectors(dir, UP);
  if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
  across.normalize();
  const face = new Vector3().crossVectors(across, dir).normalize();
  const rows: Vector3[][] = [];
  for (let k = 0; k <= segments; k++) {
    const u = k / segments;
    const profile = broad ? Math.pow(Math.sin(Math.PI * Math.pow(u, 0.86)), 0.85) * (1 - 0.15 * u) : Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 1.1);
    const half = width * 0.5 * profile;
    const spine = at.clone().addScaledVector(dir, u * length).addScaledVector(face, -droop * length * u * u).addScaledVector(UP, -droop * 0.6 * length * u * u * u);
    const fold = half * (broad ? 0.18 : 0.25);
    rows.push([spine.clone().addScaledVector(across, -half).addScaledVector(face, -fold), spine.clone(), spine.clone().addScaledVector(across, half).addScaledVector(face, -fold)]);
  }
  const n = new Vector3();
  const du = new Vector3();
  const dv = new Vector3();
  const index = rows.map((row, k) => row.map((v, c) => {
    du.subVectors(rows[Math.min(k + 1, segments)][c], rows[Math.max(k - 1, 0)][c]);
    dv.subVectors(rows[k][Math.min(c + 1, 2)], rows[k][Math.max(c - 1, 0)]);
    n.crossVectors(dv, du);
    if (n.lengthSq() < 1e-12) n.copy(face);
    n.normalize();
    return vertex(m, v, n, [part, Math.max(v.y, 0) / height, slot, c - 1], [k / segments, length]);
  }));
  for (let k = 0; k < segments; k++) for (let c = 0; c < 2; c++) {
    m.idx.push(index[k][c], index[k + 1][c], index[k + 1][c + 1], index[k][c], index[k + 1][c + 1], index[k][c + 1]);
  }
}

/** Small visible fruit; hidden fruit is omitted from closed calyces. */
function berry(m: Mesh, centre: Vector3, radius: number, height: number, slot = 0): void {
  const nx = 10;
  const ny = 6;
  const rows: number[][] = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    const y = Math.cos(v * Math.PI);
    const r = Math.sin(v * Math.PI);
    const row: number[] = [];
    for (let k = 0; k <= nx; k++) {
      const a = k / nx * Math.PI * 2;
      const n = new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const p = centre.clone().addScaledVector(n, radius);
      row.push(vertex(m, p, n, [4, Math.max(p.y, 0) / height, slot, k / nx * 2 - 1], [v, radius * 2]));
    }
    rows.push(row);
  }
  for (let j = 0; j < ny; j++) for (let k = 0; k < nx; k++) {
    m.idx.push(rows[j][k], rows[j + 1][k], rows[j + 1][k + 1], rows[j][k], rows[j + 1][k + 1], rows[j][k + 1]);
  }
}

/** Physalis: a softly inflated, five-ribbed papery calyx, not a geometric lamp. */
function calyx(m: Mesh, top: Vector3, size: number, height: number, open: boolean, turn: number, slot = 0): void {
  const nx = 20;
  const ny = 7;
  const rows: number[][] = [];
  // The lower lobe is wider than the neck. A gently rounded shoulder avoids diamond silhouettes.
  const radii = [0.025, 0.34, 0.48, 0.52, 0.49, 0.40, 0.23, 0.045];
  const centre = top.clone().add(new Vector3(0, -size * 0.47, 0));
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    const row: number[] = [];
    for (let k = 0; k <= nx; k++) {
      const a = k / nx * Math.PI * 2 + turn;
      const rib = 1 + 0.065 * Math.cos(a * 5);
      const r = radii[j] * size * 0.78 * rib;
      const opening = open ? Math.pow(v, 1.6) * size * 0.065 : 0;
      const p = top.clone().add(new Vector3(Math.cos(a) * (r + opening), -v * size, Math.sin(a) * (r + opening)));
      const n = new Vector3(Math.cos(a), (0.5 - v) * 0.6, Math.sin(a)).normalize();
      row.push(vertex(m, p, n, [3, Math.max(p.y, 0) / height, slot, a / Math.PI - 1], [v, size]));
    }
    rows.push(row);
  }
  for (let j = 0; j < ny; j++) for (let k = 0; k < nx; k++) {
    // Open calyces split into five sepals; two peel away and reveal the little fruit.
    if (open && j > 2 && ((k >= 3 && k < 7) || (k >= 13 && k < 16))) continue;
    m.idx.push(rows[j][k], rows[j + 1][k], rows[j + 1][k + 1], rows[j][k], rows[j + 1][k + 1], rows[j][k + 1]);
  }
  if (open) berry(m, centre, size * 0.24, height, slot);
}

/** Arched orchard shrub: stems, broad golden leaves and natural papery husks. */
export function reed(): InstancedBufferGeometry {
  const m = mesh();
  const H = KIT.reed[2];
  const trunkRoot = new Vector3(0, -0.05, 0);
  const trunkTip = new Vector3(0.08, 1.35, 0.02);
  const trunkBow = new Vector3(-0.10, 0.03, 0.035);
  const trunkAt = (t: number): Vector3 => trunkRoot.clone().lerp(trunkTip, t).addScaledVector(trunkBow, Math.sin(Math.PI * t));
  stem(m, trunkRoot, trunkTip, trunkBow, 0.068, H);
  const stems = [
    { root: trunkAt(0.90), tip: new Vector3(0.58, 2.65, 0.04), bow: new Vector3(-0.15, 0.2, 0.02) },
    { root: trunkAt(0.62), tip: new Vector3(-0.68, 2.25, 0.27), bow: new Vector3(0.03, 0.18, 0.12) },
    { root: trunkAt(0.42), tip: new Vector3(0.28, 1.75, -0.6), bow: new Vector3(-0.06, 0.15, -0.05) },
  ];
  const on = (i: number, t: number): Vector3 => {
    const st = stems[i];
    return st.root.clone().lerp(st.tip, t).addScaledVector(st.bow, Math.sin(Math.PI * t));
  };
  for (const [i, st] of stems.entries()) stem(m, st.root, st.tip, st.bow, i === 0 ? 0.05 : 0.035, H);
  const specs: Array<[number, number, number, number, number]> = [
    [0, 0.94, 1.30, 0.58, 0.1], [1, 0.94, 1.18, 0.56, 2.6], [2, 0.91, 1.06, 0.49, 4.3],
    [0, 0.60, 1.02, 0.53, 3.2], [1, 0.57, 0.95, 0.49, 1.2],
    [0, 0.36, 0.79, 0.40, 1.9], [2, 0.55, 0.88, 0.44, 5.5], [1, 0.32, 0.72, 0.37, 4.1],
  ];
  specs.forEach(([i, t, len, wid, yaw]) => {
    const dir = new Vector3(Math.cos(yaw) * 0.88, 0.8, Math.sin(yaw) * 0.88).normalize();
    leaf(m, on(i, t), dir, len, wid, 0.22, 0, H, 2, true);
  });
  const fruits: Array<[number, number, number, boolean]> = [[0, 0.79, 0.39, false], [1, 0.77, 0.38, true], [2, 0.68, 0.35, false]];
  fruits.forEach(([i, t, size, open], k) => {
    const root = on(i, t);
    const tip = root.clone().add(new Vector3(k % 2 ? -0.24 : 0.25, -0.15, k % 2 ? 0.15 : -0.18));
    stem(m, root, tip, new Vector3(0, 0.05, 0), 0.015, H);
    calyx(m, tip, size, H, open, k * 0.7, k === 2 ? 4 : 0);
  });
  return finish(m);
}

/** Three feathered ivory ribs with fine upswept leaflets and open air between them. */
export function comb(): InstancedBufferGeometry {
  const m = mesh();
  const H = KIT.comb[2];
  for (let frond = 0; frond < 5; frond++) {
    const yaw = frond * 2.3;
    const side = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const tip = side.clone().multiplyScalar(0.32).add(new Vector3(0, H * (0.64 + frond * 0.075), 0));
    const root = new Vector3(0, -0.03, 0);
    const bow = side.clone().multiplyScalar(0.05);
    stem(m, root, tip, bow, 0.014, H);
    for (let k = 0; k < 10; k++) {
      const t = 0.12 + k * 0.075;
      const at = root.clone().lerp(tip, t).addScaledVector(bow, Math.sin(Math.PI * t));
      const width = 0.27 * Math.sin(t * Math.PI) + 0.035;
      for (const sign of [-1, 1]) {
        const dir = side.clone().multiplyScalar(sign).add(new Vector3(0, 0.85 + 0.45 * t, 0)).normalize();
        leaf(m, at, dir, width, 0.065, 0.06, 0, H, 5);
      }
    }
  }
  return finish(m);
}

/** Low dusty-lilac narrow foliage, visually different from the ivory feathers. */
export function tussock(): InstancedBufferGeometry {
  const m = mesh();
  const H = KIT.tussock[2];
  for (let k = 0; k < 22; k++) {
    const a = k * 2.39996;
    const len = 0.42 + 0.22 * ((k * 7 % 13) / 13);
    const dir = new Vector3(Math.cos(a) * 0.65, 0.75 + (k % 3) * 0.22, Math.sin(a) * 0.65).normalize();
    const root = new Vector3(Math.cos(a) * 0.035, -0.025, Math.sin(a) * 0.035);
    leaf(m, root, dir, len, 0.11, 0.2, 0, H, k % 5 === 0 ? 2 : 6);
  }
  return finish(m);
}

export const KIT_MESH: Record<KitKind, () => InstancedBufferGeometry> = { slab, block, wedge, reed, comb, tussock };
