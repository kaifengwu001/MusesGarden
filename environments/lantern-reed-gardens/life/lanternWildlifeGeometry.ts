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
  leaf(root: Vector3, tip: Vector3, across: Vector3, width: number, lift: number, kind: number, joint = root, outward = new Vector3(0, 1, 0)): void {
    const point = (u: number, t: number): Vector3 => root.clone().lerp(tip, t)
      .addScaledVector(across, u * width * Math.pow(Math.sin(Math.PI * t), 0.72))
      .addScaledVector(outward, Math.sin(Math.PI * t) * (lift + (1 - Math.abs(u)) * 0.035));
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
  // A low, long animal underneath the mantle, with its small face emerging from
  // the narrow front. The visible silhouette comes from the leaf tips above it.
  b.ellipsoid(v(0, 0.78, -0.12), v(0.76, 0.52, 1.3), 5);
  // Four feet: short firm ankles over broad three-toed webbing.
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const x = side * 0.51, z = front * 0.55;
    b.ellipsoid(v(x, 0.21, z), v(0.11, 0.19, 0.12), 8, 10, 8);
    for (let toe = -1; toe <= 1; toe++) b.leaf(v(x, 0.065, z), v(x + toe * 0.15, 0.0, z + 0.26), v(1, 0, 0), 0.12, 0.01, 8, v(x, 0.27, z));
  }
  // Shingles follow the outside of the complete ellipsoid. Both ends remain
  // outside the body, so the pale overlapping leaves cannot disappear into it.
  for (let row = 0; row < 7; row++) for (let col = -4; col <= 4; col++) {
    const angle = col * 0.37 + (row % 2) * 0.08;
    const z = 1.02 - row * 0.32;
    const endZ = z - 0.54 - 0.035 * Math.sin(row * 3.1 + col * 1.7);
    const point = (along: number): Vector3 => {
      const section = Math.sqrt(Math.max(0.04, 1 - (along + 0.12) ** 2 / (1.44 * 1.44)));
      return v(Math.sin(angle) * 0.81 * section, 0.78 + Math.cos(angle) * 0.58 * section, along);
    };
    const root = point(z), tip = point(endZ);
    const outward = v(Math.sin(angle), Math.cos(angle), 0);
    tip.addScaledVector(outward, 0.055);
    const width = 0.22 + 0.025 * Math.sin(row * 1.8 + col);
    b.leaf(root, tip, v(Math.cos(angle), -Math.sin(angle), 0), width, 0.07, 6 + ((row + col + 9) % 5) * 0.08, root, outward);
  }
  b.ellipsoid(v(0, 0.81, 1.04), v(0.4, 0.32, 0.39), 7, 24, 14);
  // Soft drooping cheek leaves, deliberately separate from the body outline.
  for (const side of [-1, 1]) b.leaf(v(side * 0.31, 0.9, 1.13), v(side * 0.44, 0.34, 1.18), v(1, 0, 0), 0.135, 0.015, 9);
  b.leaf(v(-0.11, 1.16, 0.96), v(0.08, 1.43, 0.35), v(1, 0, 0), 0.15, 0.025, 6.16);
  eyes(b, 0.25, 0.95, 1.322, 0.065);
  b.ellipsoid(v(0, 0.745, 1.422), v(0.1, 0.007, 0.009), 10, 12, 6);
  return b.build();
}
