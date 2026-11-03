import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';

/** Meter-sized native plants: spreading cherry, weeping cherry, airy young cherry, willow. */
export const CHERRY_VARIANTS = 4;

class Rand {
  private state: number;
  constructor(seed: number) { this.state = hash32(seed); }
  next(): number { this.state = hash32(this.state + 0x9e3779b9); return unit(this.state); }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
}

/** All surfaces are opaque, double-sided at the renderer, with no coincident blossom cards. */
class PlantMesh {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly kinds: number[] = [];
  readonly tints: number[] = [];
  /** How deep a blossom puff's surface lies in its crown: 0 open, 1 tucked between puffs. */
  readonly shades: number[] = [];
  /** A far puff's proxy: its ellipsoid's top and bottom (× radius) and the proxy's radius (m), or 0 for any other surface. */
  readonly puffs: number[] = [];
  private puff: readonly number[] = [1, 1, 0];
  readonly branchTips: number[][] = [];
  readonly branchSpans: Array<{ first: number; count: number; parent: number; start: number[]; points: number[][] }> = [];
  readonly flex: number[] = [];
  /** One hanging stem and its leaves share a fixed attachment and bend field. */
  readonly bendOrigin = new Vector3();
  bendLength = 0;
  private readonly normal = new Vector3();
  private readonly edge = new Vector3();
  private leaves = 0;
  constructor(readonly detail: 'full' | 'far') {}

  tri(a: Vector3, b: Vector3, c: Vector3, kind: number, tint: number, normals?: readonly Vector3[], shades?: readonly number[], uvs?: readonly number[]): void {
    this.normal.crossVectors(this.edge.subVectors(b, a), new Vector3().subVectors(c, a)).normalize();
    for (const [i, p] of [a, b, c].entries()) {
      const n = normals ? normals[i] : this.normal;
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      if (uvs) this.uvs.push(uvs[2 * i], uvs[2 * i + 1]);
      else this.uvs.push(i === 1 ? 1 : 0, i === 2 ? 1 : 0);
      this.kinds.push(kind);
      this.tints.push(tint);
      this.shades.push(shades ? shades[i] : 0);
      this.puffs.push(...this.puff);
      const reach = this.bendLength > 0 ? Math.max(0, Math.min(1, (this.bendOrigin.y - p.y) / this.bendLength)) : 0;
      this.flex.push(this.bendOrigin.x, this.bendOrigin.y, this.bendOrigin.z, reach * reach);
    }
  }

  /** A continuous taper along an authored curve. Seven sides keep dark trunks angular. */
  branch(points: Vector3[], radius: number, tint: number, end = 0.018, sides = 7, flowing = false, parent = -1): number {
    if (this.detail === 'far') {
      if (radius < 0.095) return -1;
      // Roots, and cherry limbs whose bends hide in their blossom, need only one straight span.
      const straight = (points[0].y < 0.8 && radius < 0.2) || (!flowing && radius < 0.25);
      points = straight ? [points[0], points[points.length - 1]] : [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
      sides = 4;
    } else if (radius < 0.095 && !flowing) {
      // At twig width, extra cylinder faces do not contribute to the silhouette.
      // Spend those triangles on overlapping blossom dabs and trailing curtains.
      points = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
      sides = 3;
    }
    const first = this.positions.length / 3;
    const rings: Vector3[][] = [];
    for (let j = 0; j < points.length; j++) {
      const tangent = points[Math.min(points.length - 1, j + 1)].clone().sub(points[Math.max(0, j - 1)]).normalize();
      const x = new Vector3().crossVectors(tangent, Math.abs(tangent.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
      const z = new Vector3().crossVectors(x, tangent).normalize();
      const r = radius * (1 - j / (points.length - 1)) + end * j / (points.length - 1);
      rings.push(Array.from({ length: sides }, (_, i) => points[j].clone().addScaledVector(x, r * Math.cos(i / sides * Math.PI * 2)).addScaledVector(z, r * Math.sin(i / sides * Math.PI * 2))));
    }
    for (let j = 1; j < rings.length; j++) for (let k = 0; k < sides; k++) {
      const n = (k + 1) % sides;
      this.tri(rings[j - 1][k], rings[j][k], rings[j][n], 0, tint);
      this.tri(rings[j - 1][k], rings[j][n], rings[j - 1][n], 0, tint);
    }
    // Root cap and branch tip close the volume; the root's lowest ring embeds into ground.
    for (let i = 0; i < sides; i++) {
      this.tri(points[0], rings[0][(i + 1) % sides], rings[0][i], 0, tint);
      this.tri(points[points.length - 1], rings[rings.length - 1][i], rings[rings.length - 1][(i + 1) % sides], 0, tint);
    }
    this.branchTips.push(points[points.length - 1].toArray());
    this.branchSpans.push({first,count:this.positions.length/3-first,parent,start:points[0].toArray(),points:points.map(p=>p.toArray())});
    return this.branchSpans.length-1;
  }

  /**
   * One cherry blossom: a square card `size` (m) from its centre to each side,
   * facing `normal` and turned by `turn`, on which the shader paints the five
   * petals from uv (−1 to 1 across the card) and cuts away the rest.
   */
  blossom(p: Vector3, size: number, normal: Vector3, turn: number, kind: number, tint: number): void {
    const x = new Vector3().crossVectors(normal, Math.abs(normal.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).normalize();
    const z = new Vector3().crossVectors(x, normal).normalize();
    const u = x.clone().multiplyScalar(Math.cos(turn) * size).addScaledVector(z, Math.sin(turn) * size);
    const w = z.clone().multiplyScalar(Math.cos(turn) * size).addScaledVector(x, -Math.sin(turn) * size);
    const a = p.clone().sub(u).sub(w), b = p.clone().add(u).sub(w), c = p.clone().add(u).add(w), d = p.clone().sub(u).add(w);
    this.tri(a, b, c, kind, tint, undefined, undefined, [-1, -1, 1, -1, 1, 1]);
    this.tri(a, c, d, kind, tint, undefined, undefined, [-1, -1, 1, 1, -1, 1]);
  }

  /**
   * A hanging curtain of blossom seen from far off: one narrow sheet from
   * `top` to `bottom`, facing `out`, painted as a string of blossoms `width` across.
   */
  streak(top: Vector3, bottom: Vector3, out: Vector3, width: number, kind: number, tint: number): void {
    const side = new Vector3().crossVectors(new Vector3().subVectors(bottom, top), out).normalize().multiplyScalar(width / 2);
    const a = top.clone().add(side), b = top.clone().sub(side), c = bottom.clone().sub(side), d = bottom.clone().add(side);
    // uv.y runs on past 1, one blossom for every 2 units, which the shader repeats.
    const end = -1 + 2 * top.distanceTo(bottom) / width;
    this.tri(a, b, c, kind, tint, undefined, undefined, [1, -1, -1, -1, -1, end]);
    this.tri(a, c, d, kind, tint, undefined, undefined, [1, -1, -1, end, 1, end]);
  }

  /** A folded lanceolate willow leaf. */
  leaf(p: Vector3, length: number, direction: Vector3, width: number, tint: number, kind = 4): void {
    // A cherry's spring leaves sit in its blossom clouds, out of sight far off.
    if (this.detail === 'far' && kind === 3) return;
    if (this.detail === 'far') {
      if (this.leaves++ % 4 !== 0) return;
      length *= 1.8;
      width *= 2;
    }
    const across = new Vector3().crossVectors(direction, new Vector3(0, 0, 1)).normalize().multiplyScalar(width);
    const tip = p.clone().addScaledVector(direction, length);
    const mid = p.clone().addScaledVector(direction, length * 0.44);
    const crest = mid.clone().add(new Vector3(0, 0.025, 0));
    const left = mid.clone().add(across), right = mid.clone().sub(across);
    if (this.detail === 'far') {
      this.tri(p, left, tip, kind, tint);
      this.tri(tip, right, p, kind, tint);
    } else {
      this.tri(p, left, crest, kind, tint);
      this.tri(left, tip, crest, kind, tint);
      this.tri(tip, right, crest, kind, tint);
      this.tri(right, p, crest, kind, tint);
    }
  }

  /** Curved willow blades: a bowed spine and tapered outline, rather than a rigid diamond. */
  willowLeaf(p: Vector3, length: number, direction: Vector3, width: number, tint: number): void {
    if (this.detail === 'far') {
      // Leaf fans cover the same streamed foliage positions without a solid enclosing crown.
      if (this.leaves++ % 5 !== 0) return;
      length *= 1.85;
      width *= 2.4;
    }
    const across = new Vector3().crossVectors(direction, new Vector3(0, 0, 1)).normalize();
    const curl = new Vector3().crossVectors(across, direction).normalize();
    const tip = p.clone().addScaledVector(direction, length).addScaledVector(curl, length * 0.22);
    const mid = p.clone().addScaledVector(direction, length * 0.44).addScaledVector(curl, -length * 0.07);
    if (this.detail === 'far') {
      this.tri(p, mid.clone().addScaledVector(across, width), tip, 4, tint);
      this.tri(tip, mid.clone().addScaledVector(across, -width), p, 4, tint);
      return;
    }
    const shoulder = p.clone().addScaledVector(direction, length * 0.73).addScaledVector(curl, length * 0.035);
    const left = mid.clone().addScaledVector(across, width), right = mid.clone().addScaledVector(across, -width);
    const left2 = shoulder.clone().addScaledVector(across, width * 0.64), right2 = shoulder.clone().addScaledVector(across, -width * 0.64);
    this.tri(p, left, mid, 4, tint); this.tri(p, mid, right, 4, tint);
    this.tri(mid, left, left2, 4, tint); this.tri(mid, right2, right, 4, tint);
    this.tri(mid, left2, tip, 4, tint); this.tri(mid, tip, right2, 4, tint);
  }

  /**
   * The crown's blossom puffs, each an icosahedron just enclosing the puff's
   * ellipsoid (flatter underneath), which the shader traces for a round
   * outline and smooth shading: its normals point along each vertex's
   * direction, so they interpolate to the point's offset from the centre over
   * the proxy radius. Faces buried in a neighbouring puff are left out; each
   * vertex records how far its puff's surface lies tucked among the others (aShade).
   */
  cloud(all: readonly Lobe[]): void {
    // Far off, the puffs by the trunk hide among the rest.
    const lobes = this.detail === 'far' ? all.filter(lobe => !lobe.inner) : all;
    const sphere = icosphere(0);
    for (const lobe of lobes) {
      const proxy = lobe.radius / PROXY_INSET;
      const points = sphere.vertices.map(v => new Vector3(v.x, v.y * (v.y > 0 ? lobe.top : lobe.bottom), v.z).multiplyScalar(proxy).add(lobe.centre));
      const shades = sphere.vertices.map(v => occlusion(lobeSurface(lobe, v, new Vector3()), lobeNormal(lobe, v, new Vector3()), lobes, lobe));
      const hidden = points.map(p => lobes.some(other => other !== lobe && insideLobe(other, p, 0.76)));
      this.puff = [lobe.top, lobe.bottom, proxy];
      for (const [a, b, c] of sphere.faces) {
        if (hidden[a] && hidden[b] && hidden[c]) continue;
        const normals = [sphere.vertices[a], sphere.vertices[b], sphere.vertices[c]];
        this.tri(points[a], points[b], points[c], 5, lobe.tint, normals, [shades[a], shades[b], shades[c]]);
      }
    }
    this.puff = [1, 1, 0];
  }

  /** A blossom dab tucked `shade` deep in the crown's puffs, the same over the whole dab. */
  shadedBlossom(p: Vector3, size: number, normal: Vector3, turn: number, kind: number, tint: number, shade: number): void {
    const from = this.shades.length;
    this.blossom(p, size, normal, turn, kind, tint);
    this.shades.fill(shade, from);
  }

  finish(variant: number): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('aKind', new Float32BufferAttribute(this.kinds, 1));
    geometry.setAttribute('aTint', new Float32BufferAttribute(this.tints, 1));
    geometry.setAttribute('aShade', new Float32BufferAttribute(this.shades, 1));
    geometry.setAttribute('aPuff', new Float32BufferAttribute(this.puffs, 3));
    geometry.setAttribute('aFlex', new Float32BufferAttribute(this.flex, 4));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.variant = variant;
    geometry.userData.detail = this.detail;
    geometry.userData.branchTips = this.branchTips;
    geometry.userData.branchSpans = this.branchSpans;
    return geometry;
  }
}

/** One blossom puff: centre, radius (m), its upper and lower half heights (× radius) and pigment. */
interface Lobe {
  centre: Vector3;
  radius: number;
  top: number;
  bottom: number;
  tint: number;
  /** A puff by the trunk, mostly hidden among the others: drawn only near. */
  inner: boolean;
}

function makeLobe(random: Rand, centre: Vector3, radius: number, inner = false): Lobe {
  return { centre, radius, top: random.range(0.74, 0.86), bottom: random.range(0.5, 0.6), tint: random.next(), inner };
}

/** The puff's surface along unit direction `v`: rounded on top, flatter underneath. */
function lobeSurface(lobe: Lobe, v: Vector3, out: Vector3): Vector3 {
  return out.set(v.x, v.y * (v.y > 0 ? lobe.top : lobe.bottom), v.z).multiplyScalar(lobe.radius).add(lobe.centre);
}

/** The puff's outward normal where direction `v` meets its surface. */
function lobeNormal(lobe: Lobe, v: Vector3, out: Vector3): Vector3 {
  return out.set(v.x, v.y / (v.y > 0 ? lobe.top : lobe.bottom), v.z).normalize();
}

/** Whether `p` lies inside the puff, shrunk to `share` of its size. */
function insideLobe(lobe: Lobe, p: Vector3, share = 1): boolean {
  const x = p.x - lobe.centre.x, y = p.y - lobe.centre.y, z = p.z - lobe.centre.z;
  const yy = y / (y > 0 ? lobe.top : lobe.bottom);
  return x * x + yy * yy + z * z < (lobe.radius * share) ** 2;
}

const REACH = [0.4, 0.9, 1.6];
const probe = new Vector3();
/**
 * How tucked a point on the crown is, 0 open to 1 enclosed: the share of
 * rays out over its normal's side that run into another puff within 1.6 m,
 * the nearer the deeper.
 */
function occlusion(p: Vector3, normal: Vector3, lobes: readonly Lobe[], self?: Lobe): number {
  let blocked = 0, total = 0;
  for (const ray of icosphere(0).vertices) {
    const facing = ray.dot(normal);
    if (facing < 0.1) continue;
    total += facing;
    for (const [k, reach] of REACH.entries()) {
      probe.copy(p).addScaledVector(ray, reach);
      if (lobes.some(lobe => lobe !== self && insideLobe(lobe, probe))) { blocked += facing * (1 - k * 0.25); break; }
    }
  }
  return total > 0 ? Math.min(1, 1.3 * blocked / total) : 0;
}

/**
 * An icosahedron's inradius over its circumradius: a far puff's proxy, this
 * much larger than its ellipsoid, encloses it (PROXY in cherry.frag.glsl).
 */
const PROXY_INSET = 0.7947;

const icospheres = new Map<number, { vertices: Vector3[]; faces: number[][] }>();
/** Unit icosphere, `level` times subdivided (20 × 4^level faces). */
function icosphere(level: number): { vertices: Vector3[]; faces: number[][] } {
  const cached = icospheres.get(level);
  if (cached) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => new Vector3(x, y, z).normalize());
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < level; k++) {
    const middle = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = middle.get(key);
      if (i === undefined) { i = vertices.length; vertices.push(vertices[a].clone().add(vertices[b]).normalize()); middle.set(key, i); }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  const sphere = { vertices, faces };
  icospheres.set(level, sphere);
  return sphere;
}

/**
 * A loose blossom's size against its spray dab's, 0.2–0.4 m across in the
 * template: about the blossoms the shader paints over the puffs (FLOWER in
 * cherry.frag.glsl).
 */
const BLOSSOM = 0.55;

/** A blossom dab waiting for the crown's puffs, to settle on their surface. */
interface Dab { p: Vector3; size: number; normal: Vector3; turn: number; kind: number; tint: number }

function curved(a: Vector3, b: Vector3, c: Vector3, count = 6): Vector3[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(b, 2 * t * (1 - t)).addScaledVector(c, t * t);
  });
}

function cubic(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3 {
  const u = 1 - t;
  return a.clone().multiplyScalar(u ** 3).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t ** 3);
}

/** Sample the rendered polyline, not its ideal curve between the retained rings. */
function onBranch(points: Vector3[], t: number): Vector3 {
  const f = Math.max(0,Math.min(1,t))*(points.length-1), i=Math.min(points.length-2,Math.floor(f));
  return points[i].clone().lerp(points[i+1],f-i);
}

function trunkAt(points: Vector3[], height: number): Vector3 {
  for(let i=1;i<points.length;i++) if(height<=points[i].y) {
    return points[i-1].clone().lerp(points[i],(height-points[i-1].y)/(points[i].y-points[i-1].y));
  }
  return points[points.length-1].clone();
}

/** Lifted, spreading boughs feed unequal, gently bowed green curtains. */
function willowCrown(mesh: PlantMesh, random: Rand, trunk: Vector3[]): void {
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.39996 + random.range(-0.23, 0.23);
    const radial = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const across = new Vector3(-radial.z, 0, radial.x);
    const start = trunkAt(trunk,3.7+i*0.29);
    const reach = random.range(4.1, 5.5) * (i > 5 ? 0.87 : 1);
    const shoulder = start.clone().addScaledVector(radial, 0.75).add(new Vector3(0, 3.1, 0));
    const arch = radial.clone().multiplyScalar(reach * 0.72).addScaledVector(across, random.range(-0.6, 0.6));
    arch.y = random.range(8.8, 9.7);
    const end = radial.clone().multiplyScalar(reach); end.y = random.range(6.2, 7.7);
    const main = Array.from({length: 10}, (_, k) => cubic(start, shoulder, arch, end, k / 9));
    const mainId=mesh.branch(main, 0.19 - i * 0.009, random.range(0.3, 0.55), 0.018, 5, true,0);

    for (let j = 0; j < 4; j++) {
      const t = 0.46 + j * 0.16;
      const base = onBranch(main,t);
      const side = (j % 2 ? 1 : -1) * random.range(0.45, 1.05);
      const attach = base.clone().addScaledVector(across, side).addScaledVector(radial, 0.25);
      attach.y += random.range(-0.1, 0.3);
      const twig = curved(base, base.clone().lerp(attach, 0.5).add(new Vector3(0,0.35,0)), attach, 5);
      const twigId=mesh.branch(twig, 0.052, 0.4, 0.014, 3, true,mainId);
      for (let leaf = 1; leaf < 4; leaf++) {
        const direction = across.clone().multiplyScalar(leaf%2?0.85:-0.85).addScaledVector(radial,0.35).add(new Vector3(0,-0.3,0)).normalize();
        mesh.willowLeaf(twig[leaf],random.range(0.62,0.86),direction,0.15,random.range(0.35,0.9));
      }
      // Two inner curtains overlap, while outer boughs have a more open edge.
      const strands = j < 2 ? 2 : 1;
      for (let strand = 0; strand < strands; strand++) {
        const origin = strand ? twig[2].clone() : attach.clone();
        const length = random.range(2.8, 5.0) * (strand ? 0.78 : 1);
        const lateral = random.range(-0.5, 0.5);
        const b = origin.clone().addScaledVector(radial, 0.65).addScaledVector(across, lateral);
        b.y -= length * 0.14;
        const c = origin.clone().addScaledVector(radial, 0.35).addScaledVector(across, lateral + 0.35);
        c.y -= length * 0.78;
        const tip = origin.clone().addScaledVector(radial, random.range(0.25, 0.85)).addScaledVector(across, lateral - 0.2);
        tip.y -= length;
        mesh.bendOrigin.copy(origin); mesh.bendLength = length;
        const hanging=Array.from({length: 8}, (_, k) => cubic(origin, b, c, tip, k / 7));
        mesh.branch(hanging, 0.021, 0.42, 0.0035, 3, true,twigId);
        for (let k = 0; k < 19; k++) {
          const u = (k + random.range(0.1,0.7)) / 19;
          const leafAt = onBranch(hanging,u);
          const sideSign = k % 2 ? 1 : -1;
          const tangent = onBranch(hanging,Math.min(1,u+0.035)).sub(leafAt).normalize();
          const direction = tangent.addScaledVector(across, sideSign * random.range(0.45,0.85)).addScaledVector(radial, random.range(-0.25,0.4)).normalize();
          mesh.willowLeaf(leafAt, random.range(0.52,0.82) * (1 - 0.25*u), direction, random.range(0.115,0.17), random.next());
        }
        mesh.bendLength = 0;
      }
    }
    // Short upward-growing leaves fill the arched shoulder, keeping the tree lively.
    for (let k = 0; k < 18; k++) {
      const t = 0.28 + k * 0.037;
      const point = onBranch(main,t);
      const direction = radial.clone().multiplyScalar(0.25).addScaledVector(across,k%2?0.8:-0.8).add(new Vector3(0,-0.65,0)).normalize();
      mesh.willowLeaf(point,random.range(0.6,0.9),direction,0.15,random.range(0.45,0.95));
    }
  }
}

/**
 * Unequal overlapping sprays around a twig end. Their dabs wait in `dabs` and
 * settle on the crown's blossom clouds once every lobe is known.
 */
function blossomSpray(random: Rand, dabs: Dab[], anchor: Vector3, reach: number, tilt: number, richness: number, ivoryBias: number): void {
  const count = Math.round(10 + richness * 10);
  for (let i = 0; i < count; i++) {
    const angle = random.range(0, Math.PI * 2);
    const radius = Math.sqrt(random.next()) * reach;
    const p = anchor.clone().add(new Vector3(Math.cos(angle) * radius, random.range(-0.27, 0.34) * reach + Math.sin(angle) * radius * tilt, Math.sin(angle) * radius * 0.73));
    const normal = new Vector3(random.range(-0.75, 0.75), random.range(0.42, 1), random.range(-0.75, 0.75)).normalize();
    const kind = random.next() < ivoryBias ? 2 : 1;
    const size = random.range(0.22, 0.38) * (0.8 + richness * 0.2);
    const turn = random.range(0, 6.28), tint = random.next();
    dabs.push({ p, size, normal, turn, kind, tint });
  }
}

/**
 * Dabs settle on the nearest puff's surface, some lying on it and some
 * standing out from it at their own tilt, so its outline breaks into blossom.
 */
function settleDabs(mesh: PlantMesh, random: Rand, dabs: readonly Dab[], lobes: readonly Lobe[]): void {
  const direction = new Vector3(), surface = new Vector3();
  for (const dab of dabs) {
    const lift = random.range(-0.02, 0.16), lean = random.range(0, 0.4);
    // Every dab consumes the same stream at both levels; far off, the puffs' painted blossoms stand in.
    if (mesh.detail === 'far' || lobes.length === 0) continue;
    let best = lobes[0], bestDistance = Infinity;
    for (const lobe of lobes) {
      const d = dab.p.distanceTo(lobe.centre) / lobe.radius;
      if (d < bestDistance) { bestDistance = d; best = lobe; }
    }
    direction.subVectors(dab.p, best.centre);
    if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0);
    direction.normalize();
    lobeSurface(best, direction, surface).addScaledVector(direction, lift);
    if (lobes.some(lobe => lobe !== best && insideLobe(lobe, surface, 0.76))) continue;
    mesh.shadedBlossom(surface, dab.size * BLOSSOM, dab.normal.clone().lerp(direction, lean).normalize(), dab.turn, dab.kind, dab.tint, occlusion(surface, direction, lobes, best));
  }
}

/** Blossom cards over each square metre of puff surface: near, and far off, where fewer, larger ones fringe the outlines. */
const COAT = { full: 9, far: 0.45 } as const;

/**
 * The blossoms over the puffs, massed as in the reference: cards spread
 * evenly over each puff's surface wherever no other puff covers it, each
 * facing out from its puff but tilted its own way (by up to about 55°), some
 * standing a little proud, so the puffs' outlines break into blossoms. Their
 * own random stream leaves the branches as they were.
 */
function coatPuffs(mesh: PlantMesh, all: readonly Lobe[], seed: number, ivory: number): void {
  const far = mesh.detail === 'far', grow = far ? 1.7 : 1;
  const lobes = far ? all.filter(lobe => !lobe.inner) : all;
  const random = new Rand(seed);
  const v = new Vector3(), p = new Vector3(), normal = new Vector3(), facing = new Vector3();
  for (const lobe of lobes) {
    const count = Math.round(COAT[mesh.detail] * 4 * Math.PI * lobe.radius ** 2 * (1 + lobe.top + lobe.bottom) / 3);
    for (let i = 0; i < count; i++) {
      // A jittered Fibonacci spiral: even cover with no rows showing.
      const y = 1 - 2 * (i + random.range(0.2, 0.8)) / count, a = i * 2.39996 + random.range(-0.3, 0.3);
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      v.set(ring * Math.cos(a), y, ring * Math.sin(a));
      lobeNormal(lobe, v, normal);
      lobeSurface(lobe, v, p).addScaledVector(normal, random.range(-0.05, 0.12) * grow);
      facing.set(random.range(-0.8, 0.8), random.range(-0.8, 0.8), random.range(-0.8, 0.8)).add(normal).normalize();
      const size = random.range(0.09, 0.15) * grow, turn = random.range(0, 6.28), tint = random.next(), kind = random.next() < ivory ? 2 : 1;
      if (lobes.some(other => other !== lobe && insideLobe(other, p, 0.97))) continue;
      mesh.shadedBlossom(p, size, facing, turn, kind, tint, occlusion(p, normal, lobes, lobe));
    }
  }
}

/**
 * Source geometry stays in meters and local Y-up. All instances may use the same shader and
 * spherical support transform. aKind: 0 bark, 1 pink blossom, 2 ivory blossom, 3 young leaf,
 * 4 willow leaf, 5 blossom puff. aTint is a stable 0..1 pigment variation, constant across
 * each whole dab or lobe; aShade is how deep a puff or dab lies in its crown.
 *
 * A cherry's blossom gathers in puffs, after the reference of pink clouds over
 * a meadow, one over each twig's spray and three broader ones over the trunk,
 * with gaps between them where the branches show. Half the spray's dabs settle
 * on them as loose blossom, breaking up their round outlines.
 */
export function makeCherryGeometry(variant: number, detail: 'full' | 'far' = 'full'): BufferGeometry {
  const v = ((Math.floor(variant) % CHERRY_VARIANTS) + CHERRY_VARIANTS) % CHERRY_VARIANTS;
  const random = new Rand(7429 + v * 1709);
  const mesh = new PlantMesh(detail);
  const willow = v === 3, weeping = v === 1, young = v === 2;
  const height = young ? 7.3 : willow ? 10.5 : weeping ? 9.5 : 10.1;
  const trunk = [new Vector3(0, -0.12, 0), new Vector3(-0.22, 1.05, 0.08), new Vector3(0.14, 2.3, -0.16), new Vector3(0.52, 3.4, 0.02), new Vector3(0.13, 4.8, 0.19), new Vector3(0.49, 6.1, -0.02)];
  if (willow) {
    const top = trunk[trunk.length-1].clone();
    trunk.splice(0,trunk.length,...Array.from({length:10},(_,k)=>cubic(new Vector3(0,-0.12,0),new Vector3(-0.4,2.3,0.1),new Vector3(0.7,4.2,0.2),top,k/9)));
  }
  if (young) trunk.forEach(p => p.multiplyScalar(0.8));
  mesh.branch(trunk, young ? 0.29 : willow ? 0.55 : 0.48, 0.42, 0.08);
  const renderedTrunk=mesh.branchSpans[0].points.map(p=>new Vector3(...p as [number,number,number]));
  // Buttressed roots emerge from the dark, bent trunk and sink just below its support plane.
  for (let i = 0; i < 5; i++) {
    const a = i * 1.31 + random.range(-0.28, 0.28);
    mesh.branch(curved(new Vector3(0, 0.46, 0), new Vector3(Math.cos(a) * 0.52, 0.2, Math.sin(a) * 0.52), new Vector3(Math.cos(a) * 1.0, -0.12, Math.sin(a) * 1.0), 4), young ? 0.10 : 0.18, 0.32, 0.035, 6);
  }

  if (willow) {
    willowCrown(mesh, random, renderedTrunk);
    return mesh.finish(v);
  }

  const dabs: Dab[] = [], lobes: Lobe[] = [];
  const limbs = young ? 6 : 8;
  for (let i = 0; i < limbs; i++) {
    const angle = i * 2.39996 + random.range(-0.43, 0.43);
    const radial = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const across = new Vector3(-radial.z, 0, radial.x);
    const trunkHeight = young ? 2.2 + i * 0.38 : 3.0 + i * 0.40;
    const start = trunkAt(renderedTrunk,trunkHeight);
    const reach = (young ? 3.0 : willow ? 4.5 : 4.8) * random.range(0.74, 1.12) * (i > 5 ? 0.76 : 1);
    const tip = radial.clone().multiplyScalar(reach).add(new Vector3(0, height - random.range(1.2, 3.2), 0));
    const elbow = radial.clone().multiplyScalar(reach * 0.52).add(new Vector3(random.range(-0.35, 0.35), height - random.range(1.0, 2.1), random.range(-0.25, 0.25)));
    const main = curved(start,elbow,tip,6);
    const mainId=mesh.branch(main, young ? 0.14 : 0.21 - i * 0.008, random.range(0.15, 0.72), 0.025, 6,false,0);

    const sprays = young ? 4 : 5;
    for (let j = 0; j < sprays; j++) {
      const t = 0.48 + j * 0.115;
      const base = onBranch(main,t);
      const side = (j % 2 ? -1 : 1) * random.range(0.65, 1.35);
      const end = base.clone().addScaledVector(across, side).addScaledVector(radial, random.range(0.25, 0.80));
      end.y += random.range(0.25, 1.0);
      const bend = base.clone().lerp(end, 0.55).add(new Vector3(0, 0.40, 0));
      const twigId=mesh.branch(curved(base, bend, end, 4), 0.065, random.next(), 0.012, 4,false,mainId);
      if (!willow) {
        const spread = young ? 0.72 : 0.94;
        blossomSpray(random, dabs, end, spread, random.range(-0.32, 0.32), young || weeping ? 0.3 : 1, v === 0 ? 0.29 : v === 1 ? 0.45 : 0.20);
        // The spray's puff; the two by the limb's base hide among the rest far off.
        lobes.push(makeLobe(random, end.clone().add(new Vector3(0, 0.15, 0)), spread * random.range(1.05, 1.3), j < 2));
        if (j < 2 && !young && !weeping) blossomSpray(random, dabs, base.clone().add(new Vector3(0, 0.35, 0)), 0.72, 0.1, 0.45, 0.3);
      }
      if (weeping || willow) {
        const length = random.range(willow ? 2.6 : 1.8, willow ? 5.0 : 3.6);
        const bottom = end.clone().addScaledVector(radial, random.range(0.2, 0.7)).add(new Vector3(random.range(-0.2, 0.2), -length, 0));
        const bow = end.clone().addScaledVector(radial, 0.72).add(new Vector3(0, -length * 0.25, 0));
        const hanging = curved(end, bow, bottom, 6);
        mesh.branch(hanging, 0.028, 0.35, 0.006, 4,false,twigId);
        const count = willow ? 22 : 16;
        for (let k = 0; k < count; k++) {
          const u = (k + 0.4) / count;
          const p = end.clone().multiplyScalar((1 - u) ** 2).addScaledVector(bow, 2 * u * (1 - u)).addScaledVector(bottom, u * u);
          if (willow) {
            const d = new Vector3((k % 2 ? -1 : 1) * radial.x * 0.6 + random.range(-0.25, 0.25), -1, (k % 2 ? -1 : 1) * radial.z * 0.6 + random.range(-0.25, 0.25)).normalize();
            mesh.leaf(p, random.range(0.36, 0.72), d, random.range(0.055, 0.1), random.next());
          } else {
            p.add(new Vector3(random.range(-0.13, 0.13), 0, random.range(-0.13, 0.13)));
            const size = random.range(0.2, 0.33), turn = random.range(0, 6.28), kind = random.next() < 0.42 ? 2 : 1, tint = random.next();
            if (detail === 'full') mesh.blossom(p, size * BLOSSOM * 1.2, new Vector3(radial.x, 0.3, radial.z).normalize(), turn, kind, tint);
            // Far off, every other curtain is one narrow sheet of blossom.
            else if (k === 0 && j % 2 === 0) mesh.streak(onBranch(hanging, 0.12), onBranch(hanging, 0.92), radial, 0.4, kind, tint);
          }
        }
      }
      // A few chartreuse spring leaves break up the pink, concentrated at growing tips.
      if (!willow && random.next() < 0.7) for (let k = 0; k < 3; k++) {
        mesh.leaf(end.clone().add(new Vector3(random.range(-0.4, 0.4), random.range(0.1, 0.4), random.range(-0.4, 0.4))), random.range(0.27, 0.46), new Vector3(random.range(-0.7, 0.7), 0.2, random.range(-0.7, 0.7)).normalize(), 0.095, random.next(), 3);
      }
    }
  }
  if (!willow && !young) {
    // The reference's crowns join above the crooked trunk; tip-only blossom
    // placement left an empty umbrella centre visible from both orbit and below.
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      const top = new Vector3(Math.cos(a) * 0.95, height - 1.65 + i * 0.18, Math.sin(a) * 0.95);
      mesh.branch(curved(trunk[trunk.length - 1], top.clone().add(new Vector3(-0.18, -0.6, 0.15)), top, 4), 0.07, 0.42, 0.012, 3,false,0);
      blossomSpray(random, dabs, top, 1.35, -0.05, 0.75, weeping ? 0.42 : 0.28);
      lobes.push(makeLobe(random, top.clone().add(new Vector3(0, 0.2, 0)), (weeping ? 1.6 : 1.85) * random.range(0.9, 1.1)));
    }
  } else {
    // The young tree's crown closes over its short trunk in one more puff.
    lobes.push(makeLobe(random, trunkAt(renderedTrunk, height - 1.6).add(new Vector3(0, 0.3, 0)), 1.3));
  }
  mesh.cloud(lobes);
  coatPuffs(mesh, lobes, 7429 + v * 1709 + 31, v === 0 ? 0.29 : v === 1 ? 0.45 : 0.20);
  settleDabs(mesh, random, dabs, lobes);
  return mesh.finish(v);
}
