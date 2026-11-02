import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3, type ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type OrchardFaunaKind = 'dune-skipper' | 'seed-glider';
export interface OrchardRig {
  readonly root: Group;
  readonly body: Group;
  readonly feet: Group[];
  readonly wings: Group[];
  readonly meshes: Mesh<BufferGeometry, ShaderMaterial>[];
  readonly footOffsets: Array<readonly [number, number]>;
  readonly anatomy: { feet: number; wings: number; eyes: number; ears: number; tails: number };
}
interface Part { geometry: BufferGeometry; colour: string; kind?: number; transform?: Matrix4 }

const APRICOT = '#d9b58b', CREAM = '#f7edce', FUR_LIGHT = '#e8caa0', INK = '#383344', GOLD = '#e3b84c', LILAC = '#a29abd';

function transform(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 {
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rx);
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry);
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz);
  return new Matrix4().compose(new Vector3(x, y, z), qy.multiply(qx).multiply(qz), new Vector3(sx, sy, sz));
}

/** A single thin leaf blade; the tail and ear fins have real narrow edges. */
function blade(width: number, length: number, camber = 0.015): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  const rows = 9, columns = 4;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const u = i / columns, v = j / rows;
    const edge = Math.pow(Math.sin(Math.PI * v), 0.68);
    pos.push((u - 0.5) * width * edge, v * length, camber * (1 - Math.abs(u * 2 - 1)) * edge);
    uv.push(u, v);
    if (j < rows && i < columns) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function oval(colour: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, kind = 0): Part {
  return { geometry: new SphereGeometry(1, 14, 10), colour, kind, transform: transform(x, y, z, sx, sy, sz) };
}

function merged(parts: Part[]): BufferGeometry {
  const pieces = parts.map(({ geometry, colour, kind = 0, transform: at }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    if (at) g.applyMatrix4(at);
    const n = g.getAttribute('position').count, c = new Color(colour);
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('aColour', new Float32BufferAttribute(colours, 3));
    g.setAttribute('aKind', new Float32BufferAttribute(new Float32Array(n).fill(kind), 1));
    return g;
  });
  const result = mergeGeometries(pieces);
  pieces.forEach((p) => p.dispose());
  if (!result) throw new Error('Orchard animal geometry could not be joined.');
  result.computeBoundingSphere();
  return result;
}

function rig(): OrchardRig {
  const root = new Group(), body = new Group();
  root.add(body);
  return { root, body, feet: [], wings: [], meshes: [], footOffsets: [], anatomy: { feet: 0, wings: 0, eyes: 2, ears: 0, tails: 0 } };
}

function addMesh(r: OrchardRig, parent: Group, material: ShaderMaterial, name: string, parts: Part[]): Mesh<BufferGeometry, ShaderMaterial> {
  const mesh = new Mesh(merged(parts), material);
  mesh.name = name;
  mesh.frustumCulled = false;
  parent.add(mesh);
  r.meshes.push(mesh);
  return mesh;
}

/** A low four-footed forager, with two gold ear fins and one flat lilac tail. */
export function duneSkipperRig(material: ShaderMaterial): OrchardRig {
  const r = rig();
  r.anatomy.feet = 4; r.anatomy.ears = 2; r.anatomy.tails = 1;
  const parts: Part[] = [
    oval(APRICOT, 0, 0.275, -0.045, 0.215, 0.22, 0.32),
    oval(FUR_LIGHT, 0, 0.31, 0.205, 0.155, 0.17, 0.19),
    oval(CREAM, 0, 0.31, 0.327, 0.132, 0.125, 0.098),
    oval('#a17c66', 0, 0.29, 0.422, 0.021, 0.015, 0.012, 3),
  ];
  for (const side of [-1, 1]) {
    parts.push(oval(INK, side * 0.086, 0.354, 0.397, 0.016, 0.021, 0.011, 2));
    parts.push(oval('#fff8e8', side * 0.086 - 0.004, 0.361, 0.407, 0.004, 0.005, 0.002, 2));
    parts.push({ geometry: blade(0.105, 0.225, 0.018), colour: GOLD, kind: 1, transform: transform(side * 0.1, 0.415, 0.21, 1, 1, 1, -0.18, side * 0.22, -side * 0.54) });
  }
  // A handful of overlapping, pointed tufts break the coat silhouette.
  for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (Math.cos(a) > 0.7) continue;
    parts.push({ geometry: blade(0.075, 0.115, 0.006), colour: k % 3 ? APRICOT : FUR_LIGHT, kind: 0, transform: transform(Math.sin(a) * 0.205, 0.2 + ring * 0.065, Math.cos(a) * 0.3 - 0.04, 1, 1, 1, 0.15, a, Math.PI) });
  }
  for (let k = -2; k <= 2; k++) parts.push({ geometry: blade(0.1, 0.29 - Math.abs(k) * 0.025, 0.006), colour: k % 2 ? '#b6acce' : LILAC, kind: 1, transform: transform(0, 0.22, -0.29, 1, 1, 1, -1.05, k * 0.24, k * 0.17) });
  addMesh(r, r.body, material, 'Dune Skipper — low apricot coat, cream face, two ear fins, flat tail', parts);
  for (const z of [-0.2, 0.205]) for (const side of [-1, 1]) {
    const foot = new Group();
    foot.position.set(side * 0.145, 0, z);
    r.root.add(foot);
    addMesh(r, foot, material, 'Dune Skipper padded foot', [
      oval('#caa57f', 0, 0.067, 0, 0.065, 0.067, 0.093),
      oval(CREAM, 0, 0.037, 0.056, 0.064, 0.037, 0.072),
    ]);
    r.feet.push(foot);
    r.footOffsets.push([side * 0.145, z]);
  }
  return r;
}

/** Exactly two thin leaf-veined wings, carried by a small cream spindle. */
export function seedGliderRig(material: ShaderMaterial): OrchardRig {
  const r = rig();
  r.anatomy.wings = 2; r.anatomy.feet = 6;
  const parts: Part[] = [
    oval(CREAM, 0, 0.01, -0.005, 0.035, 0.037, 0.14),
    oval('#fff5d8', 0, 0.025, 0.13, 0.046, 0.042, 0.055),
  ];
  for (const side of [-1, 1]) {
    parts.push(oval(INK, side * 0.025, 0.041, 0.171, 0.008, 0.011, 0.006, 2));
    for (let k = 0; k < 3; k++) parts.push(oval('#b99c73', side * 0.038, -0.045, -0.055 + k * 0.048, 0.028, 0.009, 0.008, 3));
  }
  addMesh(r, r.body, material, 'Seed Glider — cream spindle and six small landing feet', parts);
  for (const side of [-1, 1]) {
    const wing = new Group();
    wing.position.set(side * 0.023, 0.027, 0.005);
    r.body.add(wing);
    addMesh(r, wing, material, `Seed Glider ${side < 0 ? 'left' : 'right'} wing`, [{ geometry: blade(0.145, 0.34, 0.012), colour: side < 0 ? '#e5bd4e' : '#f0cf69', kind: 4, transform: transform(0, 0, 0, 1, 1, 1, 0, 0, -side * Math.PI / 2) }]);
    r.wings.push(wing);
  }
  return r;
}

/** A physical fine stem and flat seed head support the two resting gliders. */
export function gliderPerchGeometry(height: number): BufferGeometry {
  const parts: Part[] = [
    { geometry: new CylinderGeometry(0.009, 0.019, height, 6), colour: '#a8845c', kind: 3, transform: transform(0, height / 2, 0) },
    oval('#d9ab45', 0, height - 0.015, 0, 0.052, 0.025, 0.052, 3),
  ];
  for (let k = 0; k < 5; k++) parts.push({ geometry: blade(0.09, 0.16, 0.008), colour: '#f4e6b5', kind: 1, transform: transform(0, height - 0.03, 0, 1, 1, 1, -Math.PI / 2, (k / 5) * Math.PI * 2, 0) });
  return merged(parts);
}
