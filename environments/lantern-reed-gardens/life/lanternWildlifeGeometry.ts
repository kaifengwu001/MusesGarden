import { BufferGeometry, Float32BufferAttribute, SphereGeometry, Vector3 } from 'three';

/** Two authored animal meshes; leaves, plates, eyes and feet are separate 3D forms. */
class AnimalGeometry {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly kinds: number[] = [];
  private readonly joints: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, kind: number, uv: readonly (readonly [number, number])[], joint = new Vector3()): void {
    const normal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const [i, point] of [a, b, c].entries()) {
      this.positions.push(point.x, point.y, point.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(...uv[i]); this.kinds.push(kind); this.joints.push(joint.x, joint.y, joint.z);
    }
  }

  ellipsoid(centre: Vector3, scale: Vector3, kind: number, segments = 24, rings = 14): void {
    const sphere = new SphereGeometry(1, segments, rings).toNonIndexed();
    const p = sphere.getAttribute('position'), n = sphere.getAttribute('normal'), uv = sphere.getAttribute('uv');
    const normal = new Vector3();
    for (let i = 0; i < p.count; i++) {
      this.positions.push(centre.x + p.getX(i) * scale.x, centre.y + p.getY(i) * scale.y, centre.z + p.getZ(i) * scale.z);
      normal.set(n.getX(i) / scale.x, n.getY(i) / scale.y, n.getZ(i) / scale.z).normalize();
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(uv.getX(i), uv.getY(i)); this.kinds.push(kind); this.joints.push(0, 0, 0);
    }
    sphere.dispose();
  }

  /** Thin convex leaf with a raised midrib; its edges taper to a separate tip. */
  leaf(root: Vector3, tip: Vector3, across: Vector3, width: number, lift: number, kind: number, joint = root): void {
    const point = (u: number, t: number): Vector3 => root.clone().lerp(tip, t)
      .addScaledVector(across, u * width * Math.pow(Math.sin(Math.PI * t), 0.72))
      .add(new Vector3(0, Math.sin(Math.PI * t) * (lift + (1 - Math.abs(u)) * 0.035), 0));
    for (let k = 0; k < 7; k++) for (const [a, b] of [[-1, 0], [0, 1]]) {
      const t0 = k / 7, t1 = (k + 1) / 7;
      const q = [point(a, t0), point(b, t0), point(b, t1), point(a, t1)];
      this.triangle(q[0], q[1], q[2], kind, [[(a + 1) / 2, t0], [(b + 1) / 2, t0], [(b + 1) / 2, t1]], joint);
      this.triangle(q[0], q[2], q[3], kind, [[(a + 1) / 2, t0], [(b + 1) / 2, t1], [(a + 1) / 2, t1]], joint);
    }
  }

  /** Broad overlapping scutes follow the Poolglass's ellipsoid, with pale seams. */
  scute(row: number, column: number): void {
    const z0 = -0.96 + row * 0.43;
    const theta0 = -1.2 + column * 0.58 + (row % 2) * 0.16;
    const point = (u: number, v: number): Vector3 => {
      const z = z0 + v * 0.48;
      const section = Math.sqrt(Math.max(0.03, 1 - z * z / (1.37 * 1.37)));
      const angle = theta0 + u * 0.54;
      return new Vector3(Math.sin(angle) * section * 0.73, 0.25 + Math.cos(angle) * section * 0.47, z);
    };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const u0 = x / 3, u1 = (x + 1) / 3, v0 = y / 3, v1 = (y + 1) / 3;
      const a = point(u0, v0), b = point(u1, v0), c = point(u1, v1), d = point(u0, v1);
      this.triangle(a, b, c, 1 + (row + column) % 3 * 0.1, [[u0, v0], [u1, v0], [u1, v1]]);
      this.triangle(a, c, d, 1 + (row + column) % 3 * 0.1, [[u0, v0], [u1, v1], [u0, v1]]);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aKind', new Float32BufferAttribute(this.kinds, 1));
    g.setAttribute('aJoint', new Float32BufferAttribute(this.joints, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

function eyes(b: AnimalGeometry, x: number, y: number, z: number, radius: number): void {
  for (const side of [-1, 1]) {
    b.ellipsoid(v(side * x, y, z), v(radius, radius * 1.12, radius * 0.64), 3, 12, 10);
    b.ellipsoid(v(side * x - radius * 0.2, y + radius * 0.34, z + radius * 0.57), v(radius * 0.26, radius * 0.26, radius * 0.13), 4, 8, 6);
  }
}

export function poolglassGeometry(): BufferGeometry {
  const b = new AnimalGeometry();
  b.ellipsoid(v(0, 0.25, 0), v(0.72, 0.45, 1.36), 0);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) b.scute(row, col);
  // Broad leaf pectorals and a small fan tail give a fish silhouette, not a blob.
  for (const side of [-1, 1]) b.leaf(v(side * 0.56, 0.16, 0.2), v(side * 1.64, 0.18, -0.64), v(0.32 * side, 0, 0.95), 0.43, 0.08, 2);
  b.ellipsoid(v(0, 0.24, -1.32), v(0.18, 0.15, 0.24), 0, 12, 8);
  for (const side of [-1, 1]) b.leaf(v(0, 0.24, -1.38), v(side * 0.53, 0.25, -1.94), v(1, 0, 0), 0.27, 0.04, 2);
  eyes(b, 0.3, 0.39, 1.2, 0.087);
  b.ellipsoid(v(0, 0.15, 1.337), v(0.16, 0.012, 0.016), 10, 12, 6);
  return b.build();
}

export function reedWaderGeometry(): BufferGeometry {
  const b = new AnimalGeometry();
  b.ellipsoid(v(0, 0.98, -0.1), v(0.88, 0.73, 1.1), 5);
  // Four feet: short firm ankles over broad three-toed webbing.
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const x = side * 0.59, z = front * 0.6;
    b.ellipsoid(v(x, 0.25, z), v(0.15, 0.23, 0.14), 8, 10, 8);
    for (let toe = -1; toe <= 1; toe++) b.leaf(v(x, 0.08, z), v(x + toe * 0.19, 0.0, z + 0.45), v(1, 0, 0), 0.16, 0.01, 8, v(x, 0.3, z));
  }
  // Sage mantle: staggered, individually folded feather leaves overlap toward the tail.
  for (let row = 0; row < 5; row++) for (let col = -3; col <= 3; col++) {
    const angle = col * 0.37 + (row % 2) * 0.1;
    const z = 0.7 - row * 0.34;
    const section = Math.sqrt(Math.max(0.1, 1 - z * z / 1.45));
    const root = v(Math.sin(angle) * 0.86 * section, 0.96 + Math.cos(angle) * 0.72 * section, z);
    const tip = v(root.x * 1.08, root.y - 0.14 - Math.abs(col) * 0.025, z - 0.6);
    b.leaf(root, tip, v(Math.cos(angle), -Math.sin(angle), 0), 0.24, 0.06, 6 + ((row + col + 6) % 3) * 0.1);
  }
  b.ellipsoid(v(0, 1.03, 0.91), v(0.51, 0.47, 0.43), 7, 24, 14);
  // Soft drooping cheek leaves, deliberately separate from the body outline.
  for (const side of [-1, 1]) b.leaf(v(side * 0.4, 1.13, 1.02), v(side * 0.52, 0.44, 1.13), v(1, 0, 0), 0.19, 0.02, 9);
  b.leaf(v(-0.16, 1.43, 0.8), v(0.13, 1.83, 0.28), v(1, 0, 0), 0.2, 0.03, 6);
  eyes(b, 0.3, 1.21, 1.25, 0.105);
  b.ellipsoid(v(0, 0.94, 1.331), v(0.17, 0.016, 0.014), 10, 12, 6);
  return b.build();
}
