import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Matrix4, Mesh, Quaternion, SphereGeometry, Vector2, Vector3, type ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type FaunaKind = 'chalkstep' | 'fern-sifter' | 'dewwing';
export interface FaunaRig {
  root: Group;
  body: Group;
  feet: Mesh<BufferGeometry, ShaderMaterial>[];
  wings: Group[];
  meshes: Mesh<BufferGeometry, ShaderMaterial>[];
  /** Verified design counts, rather than treating eyes or plate markings as limbs. */
  anatomy: { feet: number; wings: number; plates: number; eyes: number };
}
type Part = { geometry: BufferGeometry; colour: string; kind?: number; at?: Matrix4 };
const BLUE = '#aebed8', FEATHER = '#bacbe0', IVORY = '#f7efd9', INK = '#343334', SCARLET = '#ce5356', MINT = '#9abeb2', LEG = '#899895';

function matrix(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 {
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rx);
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry);
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz);
  return new Matrix4().compose(new Vector3(x, y, z), qy.multiply(qx).multiply(qz), new Vector3(sx, sy, sz));
}

/** Thin gently cambered leaf, with a crisp perimeter and a deliberate central ridge. */
function leaf(width: number, length: number, camber: number, fan = false): BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const rows = 10, columns = fan ? 24 : 8;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const u = i / columns, v = j / rows;
    if (fan) {
      const a = (u - 0.5) * 2.5;
      const r = length * v * (1 - 0.028 * Math.cos(u * Math.PI * 18));
      positions.push(Math.sin(a) * r * width, Math.cos(a) * r, camber * Math.sin(Math.PI * v) + 0.018 * Math.cos(u * Math.PI * 18) * v);
    } else {
      const edge = Math.pow(Math.sin(Math.PI * v), 0.72);
      positions.push((u - 0.5) * width * edge, v * length, camber * (1 - Math.abs(u * 2 - 1)) * edge);
    }
    uvs.push(u, v);
    if (j < rows && i < columns) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function merged(parts: Part[]): BufferGeometry {
  const pieces = parts.map(({ geometry, colour, kind = 0, at }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    if (at) g.applyMatrix4(at);
    const count = g.getAttribute('position').count;
    const color = new Color(colour);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('aColour', new Float32BufferAttribute(colors, 3));
    g.setAttribute('aKind', new Float32BufferAttribute(new Float32Array(count).fill(kind), 1));
    return g;
  });
  const result = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  if (!result) throw new Error('The canyon creature could not be meshed.');
  result.computeBoundingSphere();
  return result;
}

function oval(colour: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, kind = 0): Part {
  return { geometry: new SphereGeometry(1, 16, 12), colour, kind, at: matrix(x, y, z, rx, ry, rz) };
}

function rig(): FaunaRig {
  const root = new Group(), body = new Group();
  root.add(body);
  return { root, body, feet: [], wings: [], meshes: [], anatomy: { feet: 0, wings: 0, plates: 0, eyes: 2 } };
}

function mesh(r: FaunaRig, parent: Group, material: ShaderMaterial, name: string, parts: Part[]): Mesh<BufferGeometry, ShaderMaterial> {
  const object = new Mesh(merged(parts), material);
  object.name = name;
  object.frustumCulled = false;
  parent.add(object);
  r.meshes.push(object);
  return object;
}

export function chalkstepRig(material: ShaderMaterial): FaunaRig {
  const r = rig();
  r.anatomy.feet = 2;
  const profile = [[0, 0.17], [0.15, 0.18], [0.25, 0.3], [0.285, 0.47], [0.245, 0.66], [0.17, 0.84], [0.12, 0.97], [0, 1.025]].map(([x, y]) => new Vector2(x, y));
  const parts: Part[] = [{ geometry: new LatheGeometry(profile, 24), colour: BLUE, at: matrix(0, 0, 0, 1, 1, 0.78) }];
  // Actual overlapping feather blades catch the light at their pointed edges;
  // no fur shells or inflated clay-like bumps.
  for (let ring = 0; ring < 4; ring++) for (let k = 0; k < 11; k++) {
    const angle = ((k + (ring % 2) * 0.5) / 11) * Math.PI * 2;
    const y = 0.4 + ring * 0.14;
    const radius = [0.264, 0.274, 0.238, 0.187][ring];
    if (ring > 1 && Math.cos(angle) > 0.55) continue;
    parts.push({ geometry: leaf(0.145, 0.22, 0.025), colour: (k + ring) % 3 ? FEATHER : BLUE, kind: 1, at: matrix(Math.sin(angle) * radius, y, Math.cos(angle) * radius * 0.82, 1, 1, 1, 0, angle, Math.PI) });
  }
  parts.push(oval(IVORY, 0, 0.865, 0.139, 0.142, 0.15, 0.08, 3));
  for (const side of [-1, 1]) {
    parts.push(oval(INK, side * 0.078, 0.884, 0.208, 0.0175, 0.022, 0.009, 4));
    parts.push(oval('#fff8e9', side * 0.078 - 0.004, 0.891, 0.216, 0.004, 0.005, 0.003, 4));
  }
  parts.push({ geometry: leaf(0.74, 0.42, 0.018, true), colour: SCARLET, kind: 2, at: matrix(0, 0.39, -0.17, 1, 1, 1, -0.9, 0, 0) });
  const body = mesh(r, r.body, material, 'Chalkstep — pear body, feather blades, cream face, fan tail', parts);
  // The reference is a broad little pear, not a narrow standing cylinder.
  body.geometry.scale(1.14, 0.93, 1.18);
  body.geometry.computeBoundingSphere();
  for (const side of [-1, 1]) {
    const foot = mesh(r, r.root, material, `Chalkstep ${side < 0 ? 'left' : 'right'} foot`, [
      oval('#8e9eaf', 0, 0.075, 0.035, 0.071, 0.075, 0.13, 6),
      ...[-1, 0, 1].map((toe) => oval('#9dabb9', toe * 0.041, 0.032, 0.12, 0.028, 0.027, 0.087, 6)),
    ]);
    foot.position.x = side * 0.145;
    r.feet.push(foot);
  }
  return r;
}

export function sifterRig(material: ShaderMaterial): FaunaRig {
  const r = rig();
  r.body.position.y = -0.04;
  r.anatomy.feet = 6;
  r.anatomy.plates = 3;
  const parts: Part[] = [oval('#748e83', 0, 0.2, -0.02, 0.26, 0.12, 0.38)];
  // Three distinct roof-like leaves overlap from tail to head. Each has a
  // hard rim, central ridge and pointed rear; they are never coiled shells.
  for (let k = 0; k < 3; k++) parts.push({
    geometry: leaf(0.76 - 0.025 * k, 0.58, 0.11), colour: [MINT, '#a9c7b8', '#bfd2bd'][k], kind: 5,
    at: matrix(0, 0.29 + 0.018 * k, 0.04 + k * 0.22, 1, 1, 1, -Math.PI / 2, 0, 0),
  });
  parts.push(oval(IVORY, 0, 0.205, 0.46, 0.143, 0.105, 0.12, 3));
  for (const side of [-1, 1]) parts.push(oval(INK, side * 0.084, 0.224, 0.549, 0.014, 0.017, 0.01, 4));
  mesh(r, r.body, material, 'Fern Sifter — three rigid overlapping leaf plates and cream face', parts);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    const foot = mesh(r, r.root, material, `Fern Sifter ${side < 0 ? 'left' : 'right'} leg ${k + 1}`, [
      oval(LEG, side * 0.05, 0.14, 0, 0.11, 0.055, 0.048, 6),
      oval('#a9b4a4', side * 0.12, 0.072, 0.018, 0.05, 0.08, 0.048, 6),
      oval('#9aa598', side * 0.14, 0.024, 0.046, 0.06, 0.025, 0.07, 6),
    ]);
    foot.position.set(side * 0.19, 0, -0.24 + k * 0.24);
    foot.geometry.scale(1, 0.64, 1);
    foot.geometry.computeBoundingSphere();
    r.feet.push(foot);
  }
  return r;
}

export function dewwingRig(material: ShaderMaterial): FaunaRig {
  const r = rig();
  r.anatomy.feet = 6;
  r.anatomy.wings = 2;
  const profile = [[0, -0.27], [0.035, -0.2], [0.052, -0.06], [0.048, 0.08], [0, 0.15]].map(([x, y]) => new Vector2(x, y));
  const parts: Part[] = [{ geometry: new LatheGeometry(profile, 16), colour: IVORY, at: matrix(0, 0.02, 0, 1, 1, 1, Math.PI / 2) }];
  parts.push(oval(IVORY, 0, 0.027, 0.18, 0.068, 0.052, 0.076, 3));
  for (const side of [-1, 1]) parts.push(oval(INK, side * 0.041, 0.051, 0.231, 0.011, 0.014, 0.01, 4));
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) parts.push(oval('#bdb8a4', side * 0.07, -0.035, -0.09 + k * 0.065, 0.06, 0.009, 0.009, 6));
  mesh(r, r.body, material, 'Dewwing — ivory spindle, six small legs, two eyes', parts);
  for (const side of [-1, 1]) {
    const wing = new Group();
    wing.position.set(side * 0.04, 0.055, 0);
    r.body.add(wing);
    mesh(r, wing, material, `Dewwing ${side < 0 ? 'left' : 'right'} scarlet fan wing`, [{ geometry: leaf(0.72, 0.66, 0.025, true), colour: SCARLET, kind: 2 }]);
    r.wings.push(wing);
  }
  return r;
}

/** A slender nectar stem gives the two foreground insects a real landing surface. */
export function dewPerchGeometry(height: number): BufferGeometry {
  return merged([
    { geometry: new CylinderGeometry(0.012, 0.032, height, 7), colour: '#a6b99a', kind: 6, at: matrix(0, height / 2, 0) },
    { geometry: leaf(0.76, 0.36, 0.025, true), colour: '#ce6660', kind: 2, at: matrix(0, height - 0.04, 0, 1, 1, 1, -Math.PI / 2) },
    oval(IVORY, 0, height - 0.035, 0, 0.075, 0.025, 0.075, 3),
  ]);
}
