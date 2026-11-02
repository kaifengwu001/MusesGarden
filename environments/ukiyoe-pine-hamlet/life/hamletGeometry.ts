import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three';

export const HAMLET_KIND = { bark: 0, needle: 1, slate: 2, reed: 3, bud: 4, snow: 5 } as const;
export type HamletSpecies = 'pine' | 'cedar' | 'plum' | 'reeds' | 'rock';
export interface HamletAsset { geometry: BufferGeometry; ink: BufferGeometry; footprint: number; }

const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const TAU = Math.PI * 2;

/** Solid branches, folded needle blades and selected drawn contours. No leaf billboards. */
class MeshBuilder {
  constructor(readonly coarse = false, readonly species = 0) {}
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly uv: number[] = [];
  private readonly kind: number[] = [];
  private readonly printStyle: number[] = [];
  private readonly lobe: number[] = [];
  private readonly ground: number[] = [];
  private readonly lp: number[] = [];
  private readonly ln: number[] = [];
  private readonly lk: number[] = [];
  private readonly lg: number[] = [];

  tri(a: Vector3, b: Vector3, c: Vector3, kind: number, grounded: readonly number[] = [0, 0, 0], normals?: readonly Vector3[], chart?: readonly (readonly number[])[], style = this.species, lobe?: readonly Vector3[]): void {
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (normal.lengthSq() < 0.5) return;
    for (const [i, point] of [a, b, c].entries()) {
      this.p.push(point.x, point.y, point.z);
      const n = normals?.[i] ?? normal;
      this.n.push(n.x, n.y, n.z);
      this.uv.push(chart?.[i][0] ?? point.x, chart?.[i][1] ?? point.y);
      this.printStyle.push(style);
      this.lobe.push(...(lobe?.[i].toArray() ?? [0, 0, 0]));
      this.kind.push(kind);
      this.ground.push(grounded[i]);
    }
  }

  line(points: Vector3[], kind: number, normal = V(0, 1, 0), ground = false): void {
    for (let i = 0; i < points.length - 1; i++) for (const p of [points[i], points[i + 1]]) {
      const q = p.clone().addScaledVector(normal, 0.012);
      this.lp.push(q.x, q.y, q.z); this.ln.push(normal.x, normal.y, normal.z);
      this.lk.push(kind); this.lg.push(ground ? 1 : 0);
    }
  }

  tube(points: Vector3[], radii: number[], kind: number = HAMLET_KIND.bark, sides = 6, root = false): void {
    if (points.length > 2 && radii[0] > 0.1) {
      const originalRadii = radii;
      const intervals = (points.length - 1) * (this.coarse ? 1 : 3);
      const curve = new CatmullRomCurve3(points);
      points = curve.getPoints(intervals);
      radii = points.map((_, i) => {
        const t = i / intervals * (originalRadii.length - 1), j = Math.min(originalRadii.length - 2, Math.floor(t));
        return originalRadii[j] + (originalRadii[j + 1] - originalRadii[j]) * (t - j);
      });
    }
    const rings = points.map((p, i) => {
      const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const x = tangent.clone().cross(Math.abs(tangent.z) < 0.9 ? V(0, 0, 1) : V(1, 0, 0)).normalize();
      const z = tangent.clone().cross(x).normalize();
      return Array.from({ length: sides }, (_, k) => p.clone().addScaledVector(x, radii[i] * Math.cos(k * TAU / sides)).addScaledVector(z, radii[i] * Math.sin(k * TAU / sides)));
    });
    const distances = [0];
    for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
    // Branch-local arc length and circumference keep engraved grain aligned
    // through bends. A repeated triangle UV would expose the triangulation.
    const chart = (i: number, k: number): number[] => [k * TAU / sides * radii[0], distances[i]];
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides, g = root && i === 0 ? 1 : 0;
      this.tri(rings[i][k], rings[i + 1][j], rings[i][j], kind, [g, 0, g], undefined, [chart(i, k), chart(i + 1, k + 1), chart(i, k + 1)]);
      this.tri(rings[i][k], rings[i + 1][k], rings[i + 1][j], kind, [g, 0, 0], undefined, [chart(i, k), chart(i + 1, k), chart(i + 1, k + 1)]);
    }
    const last = rings.length - 1;
    for (let k = 0; k < sides; k++) this.tri(points[last], rings[last][k], rings[last][(k + 1) % sides], kind);
    // Bark is drawn in the single colour surface; overlaid lines clipped in
    // and out of curved branches as the camera moved.
  }

  /** Dense overlapping needles need a dark internal volume at normal app scale.
   * This irregular three-dimensional foliage core supports the fine external
   * needles; it is neither a leaf card nor a horizontal canopy disc. */
  needleVolume(center: Vector3, rx: number, ry: number, rz: number, phase: number, turn = 0): void {
    const sides = this.coarse ? 7 : 12;
    const at = (x: number, y: number, z: number): Vector3 => V(center.x + x * Math.cos(turn) - z * Math.sin(turn), center.y + y, center.z + x * Math.sin(turn) + z * Math.cos(turn));
    const emit = (a: Vector3, b: Vector3, c: Vector3): void => {
      // The needle mass is a connected canopy, so lighting must not expose a
      // patchwork of large flat polygons between the fine projecting needles.
      const normals = [a, b, c].map(p => {
        const q = p.clone().sub(center).applyAxisAngle(V(0, 1, 0), turn);
        return q.set(q.x / (rx * rx), q.y / (ry * ry), q.z / (rz * rz)).normalize().applyAxisAngle(V(0, 1, 0), -turn);
      });
      const radius = Math.sqrt(rx * rz);
      const chart = [a, b, c].map(p => {
        const q = p.clone().sub(center).applyAxisAngle(V(0, 1, 0), turn);
        return [Math.atan2(q.z / rz, q.x / rx), Math.asin(Math.max(-1, Math.min(1, q.y / ry))) * ry];
      });
      // Unwrap each local crown seam before interpolation, including its poles.
      if (Math.max(...chart.map(p => p[0])) - Math.min(...chart.map(p => p[0])) > Math.PI) {
        for (const p of chart) if (p[0] < 0) p[0] += TAU;
      }
      for (const p of chart) p[0] *= radius;
      this.tri(a, b, c, HAMLET_KIND.needle, [0, 0, 0], normals, chart);
    };
    const rings = [-0.7, -0.05, 0.68].map((h, level) => Array.from({ length: sides }, (_, i) => {
      const a = i * TAU / sides;
      const lobe = (level === 1 ? 1 : 0.72) * (1 + 0.14 * Math.sin(a * 3 + phase) + 0.07 * Math.cos(a * 5 - phase));
      return at(Math.cos(a) * rx * lobe, h * ry + Math.sin(a * 2 + phase) * ry * 0.12, Math.sin(a) * rz * lobe);
    }));
    for (let row = 0; row < 2; row++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      emit(rings[row][i], rings[row][j], rings[row + 1][j]);
      emit(rings[row][i], rings[row + 1][j], rings[row + 1][i]);
    }
    const top = at(rx * 0.08, ry, -rz * 0.08), bottom = at(-rx * 0.08, -ry, rz * 0.08);
    for (let i = 0; i < sides; i++) {
      emit(top, rings[2][(i + 1) % sides], rings[2][i]);
      emit(bottom, rings[0][i], rings[0][(i + 1) % sides]);
    }
  }

  /** One rounded pine fan. Several intersecting lobes make a scalloped cloud.
   * Its local coordinates belong to this lobe, not a repeating world texture. */
  pineLobe(center: Vector3, size: number, phase: number, turn: number, snowy: boolean): void {
    const sides = this.coarse ? 10 : 20;
    const rows = this.coarse ? 4 : 8;
    const rx = size * 0.70, ry = size * 0.73, rz = size * 0.60;
    const rotate = (v: Vector3): Vector3 => v.applyAxisAngle(V(0, 1, 0), turn);
    const vertex = (angle: number, latitude: number, snow = false) => {
      const q = V(Math.cos(latitude) * Math.cos(angle), Math.sin(latitude), Math.cos(latitude) * Math.sin(angle));
      // The lower half is gently flattened, with no planar top or rim facets.
      const lower = q.y < 0 ? 0.64 : 1;
      const local = V(q.x * rx, q.y * ry * lower, q.z * rz);
      const n = V(q.x / rx, q.y / (ry * lower), q.z / rz).normalize();
      const p = rotate(local).add(center);
      const normal = rotate(n);
      if (snow) p.addScaledVector(normal, 0.045 * size);
      return { p, normal, q };
    };
    const emit = (a: ReturnType<typeof vertex>, c: ReturnType<typeof vertex>, d: ReturnType<typeof vertex>, snow = false): void => {
      const winding = c.p.clone().sub(a.p).cross(d.p.clone().sub(a.p)).dot(a.normal.clone().add(c.normal).add(d.normal));
      const p1 = winding < 0 ? d : c, p2 = winding < 0 ? c : d;
      this.tri(a.p, p1.p, p2.p, snow ? HAMLET_KIND.snow : HAMLET_KIND.needle, [0, 0, 0],
        [a.normal, p1.normal, p2.normal], undefined, 20 + (phase % 1) * 0.9, [a.q, p1.q, p2.q]);
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < sides; i++) {
      const a = i * TAU / sides, c = (i + 1) * TAU / sides;
      const lo = -Math.PI / 2 + j * Math.PI / rows, hi = -Math.PI / 2 + (j + 1) * Math.PI / rows;
      const p = vertex(a, lo), q = vertex(c, lo), r = vertex(c, hi), t = vertex(a, hi);
      if (j > 0) emit(p, q, r);
      if (j < rows - 1) emit(p, r, t);
    }
    if (!snowy) return;
    // Conforming snow uses the same dome, leaving the lower fan visible.
    // Its shallow lip meets the foliage rather than floating as a broad plate.
    const snowRows = this.coarse ? 1 : 4;
    const edge = (a: number): number => 0.48 + 0.055 * Math.sin(a * 3 + phase) + 0.035 * Math.sin(a * 5 - phase);
    for (let j = 0; j < snowRows; j++) for (let i = 0; i < sides; i++) {
      const a = i * TAU / sides, c = (i + 1) * TAU / sides;
      const lat = (angle: number, row: number): number => edge(angle) + (Math.PI / 2 - edge(angle)) * row / snowRows;
      const p = vertex(a, lat(a, j), true), q = vertex(c, lat(c, j), true);
      const r = vertex(c, lat(c, j + 1), true), t = vertex(a, lat(a, j + 1), true);
      emit(p, q, r, true);
      if (j < snowRows - 1) emit(p, r, t, true);
      if (j === 0) {
        const b0 = vertex(a, edge(a)), b1 = vertex(c, edge(c));
        emit(b0, b1, q, true); emit(b0, q, p, true);
      }
    }
  }

  /** A narrow, folded blade has thickness in silhouette without a cylindrical needle's cost. */
  blade(base: Vector3, tip: Vector3, width: number, kind: number, turn = 0, root = false): void {
    const axis = tip.clone().sub(base);
    const side = axis.clone().cross(Math.abs(axis.z / axis.length()) < 0.9 ? V(0, 0, 1) : V(1, 0, 0)).normalize();
    side.applyAxisAngle(axis.clone().normalize(), turn);
    const fold = axis.clone().cross(side).normalize();
    const shoulder = base.clone().addScaledVector(axis, 0.35);
    const left = shoulder.clone().addScaledVector(side, width);
    const right = shoulder.clone().addScaledVector(side, -width);
    const ridge = shoulder.clone().addScaledVector(fold, width * 0.52);
    const uBase = [0, 0], uLeft = [-1, 0.35], uRight = [1, 0.35], uRidge = [0, 0.35], uTip = [0, 1];
    this.tri(base, left, ridge, kind, [root ? 1 : 0, 0, 0], undefined, [uBase, uLeft, uRidge], this.species + 10);
    this.tri(left, tip, ridge, kind, [0, 0, 0], undefined, [uLeft, uTip, uRidge], this.species + 10);
    this.tri(base, ridge, right, kind, [root ? 1 : 0, 0, 0], undefined, [uBase, uRidge, uRight], this.species + 10);
    this.tri(ridge, tip, right, kind, [0, 0, 0], undefined, [uRidge, uTip, uRight], this.species + 10);
  }

  /** Slightly scalloped upper blanket, with a shallow edge and no stacked snow balls. */
  snowCap(center: Vector3, rx: number, rz: number, depth: number, turn = 0, phase = 0): void {
    const count = this.coarse ? 8 : 12;
    const at = (x: number, y: number, z: number): Vector3 => V(center.x + x * Math.cos(turn) - z * Math.sin(turn), center.y + y, center.z + x * Math.sin(turn) + z * Math.cos(turn));
    const top = at(-rx * 0.08, depth, -rz * 0.07);
    const rim = Array.from({ length: count }, (_, i) => {
      const a = i * TAU / count, scallop = 1 + 0.065 * Math.sin(a * 3 + phase);
      return at(Math.cos(a) * rx * scallop, 0.03 * Math.sin(a * 2 + phase), Math.sin(a) * rz * scallop);
    });
    const lip = rim.map((p, i) => p.clone().add(V(0, -0.065 - depth * (0.16 + 0.12 * Math.sin(i * 2.4 + phase)), 0)));
    const crown = rim.map((p, i) => p.clone().lerp(top, 0.47).add(V(0, depth * (0.24 + 0.08 * Math.sin(i * 2.1)), 0)));
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      this.tri(top, crown[j], crown[i], HAMLET_KIND.snow);
      this.tri(crown[i], crown[j], rim[j], HAMLET_KIND.snow);
      this.tri(crown[i], rim[j], rim[i], HAMLET_KIND.snow);
      this.tri(rim[i], rim[j], lip[j], HAMLET_KIND.snow);
      this.tri(rim[i], lip[j], lip[i], HAMLET_KIND.snow);
    }
    // The snow edge is a real vertical lip, without a coincident ink overlay.
  }

  bud(center: Vector3, radius: number): void {
    const top = center.clone().add(V(0, radius * 1.35, 0));
    const bottom = center.clone().add(V(0, -radius, 0));
    const ring = Array.from({ length: 5 }, (_, i) => center.clone().add(V(Math.cos(i * TAU / 5) * radius, 0, Math.sin(i * TAU / 5) * radius)));
    for (let i = 0; i < 5; i++) {
      this.tri(top, ring[i], ring[(i + 1) % 5], HAMLET_KIND.bud, [0, 0, 0], undefined, [[0, 1], [-1, 0], [1, 0]]);
      this.tri(bottom, ring[(i + 1) % 5], ring[i], HAMLET_KIND.bud, [0, 0, 0], undefined, [[0, -1], [1, 0], [-1, 0]]);
    }
  }

  finish(footprint: number): HamletAsset {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('aKind', new Float32BufferAttribute(this.kind, 1));
    geometry.setAttribute('aPrintStyle', new Float32BufferAttribute(this.printStyle, 1));
    geometry.setAttribute('aLobe', new Float32BufferAttribute(this.lobe, 3));
    geometry.setAttribute('aGround', new Float32BufferAttribute(this.ground, 1));
    const ink = new BufferGeometry();
    ink.setAttribute('position', new Float32BufferAttribute(this.lp, 3));
    ink.setAttribute('normal', new Float32BufferAttribute(this.ln, 3));
    ink.setAttribute('uv', new Float32BufferAttribute(new Float32Array(this.lk.length * 2), 2));
    ink.setAttribute('aKind', new Float32BufferAttribute(this.lk, 1));
    ink.setAttribute('aPrintStyle', new Float32BufferAttribute(new Float32Array(this.lk.length), 1));
    ink.setAttribute('aLobe', new Float32BufferAttribute(new Float32Array(this.lk.length * 3), 3));
    ink.setAttribute('aGround', new Float32BufferAttribute(this.lg, 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    ink.computeBoundingSphere();
    return { geometry, ink, footprint };
  }
}

function tuft(b: MeshBuilder, center: Vector3, scale: number, phase: number, count = 14): void {
  b.needleVolume(center.clone().add(V(0, 0.10 * scale, 0)), 0.60 * scale, 0.39 * scale, 0.57 * scale, phase);
  // Small radial whorls project from the connected foliage mass. The inner
  // rosettes continue as surface drawing, keeping distant trees inexpensive.
  const fans = b.coarse ? 2 : 4, spokes = b.coarse ? 2 : Math.round(count * 1.45 / fans);
  for (let f = 0; f < fans; f++) {
    const a = phase + f * TAU / fans;
    const radial = V(Math.cos(a), 0, Math.sin(a)), tangent = V(-Math.sin(a), 0, Math.cos(a));
    const origin = center.clone().addScaledVector(radial, 0.54 * scale).add(V(0, (0.05 + 0.08 * Math.sin(a)) * scale, 0));
    for (let i = 0; i < spokes; i++) {
      const angle = i * TAU / spokes + f * 0.37, length = (0.19 + (i % 3) * 0.025) * scale;
      const tip = origin.clone().addScaledVector(tangent, Math.cos(angle) * length).add(V(0, Math.sin(angle) * length, 0)).addScaledVector(radial, 0.08 * scale);
      b.blade(origin, tip, 0.013 * scale, HAMLET_KIND.needle, a * 0.5);
    }
  }
}

export function pineGeometry(coarse = false): HamletAsset {
  const b = new MeshBuilder(coarse);
  const trunk = [V(0, -0.16, 0), V(0.3, 1.6, -0.03), V(-0.43, 3.35, 0.12), V(-0.12, 4.7, 0), V(0.88, 6.2, -0.13), V(0.54, 7.55, 0.1), V(1.18, 8.45, 0.1)];
  b.tube(trunk, [0.52, 0.41, 0.31, 0.25, 0.19, 0.12, 0.05], HAMLET_KIND.bark, coarse ? 5 : 9, true);
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5 + 0.2;
    b.tube([V(Math.cos(a) * 1.05, -0.12, Math.sin(a) * 0.95), V(Math.cos(a) * 0.58, 0.18, Math.sin(a) * 0.53), V(0.06, 0.8, 0)], [0.09, 0.18, 0.28], HAMLET_KIND.bark, 5, true);
  }
  const branches = [
    { start: trunk[2], end: V(-3.7, 4.05, 0.7), a: -0.25 },
    { start: trunk[2], end: V(2.9, 3.95, 1.4), a: 0.5 },
    { start: trunk[3], end: V(-2.1, 5.6, -2.2), a: 2.6 },
    { start: trunk[3], end: V(3.5, 5.3, -0.9), a: -0.35 },
    { start: trunk[4], end: V(-2.7, 6.9, 0.4), a: 3.1 },
    { start: trunk[4], end: V(2.5, 7.05, 1.3), a: 0.6 },
    { start: trunk[5], end: V(-0.9, 7.9, -1.8), a: 2.7 },
    { start: trunk[5], end: V(2.1, 8.25, 0.2), a: 0.2 },
  ];
  branches.forEach(({ start, end, a }, i) => {
    if (coarse && (i === 1 || i === 2 || i === 5 || i === 6)) return;
    const bend = start.clone().lerp(end, 0.5).add(V(0, -0.22, 0.16));
    b.tube([start, bend, end], [0.22 - i * 0.016, 0.12 - i * 0.008, 0.035], HAMLET_KIND.bark, 6);
    const size = 1.08 - i * 0.032;
    const across = V(Math.cos(a), 0, Math.sin(a)), depth = V(-Math.sin(a), 0, Math.cos(a));
    // Back row rises behind the lower foreground lobes, like the overlapping
    // fans in the reference. Unequal diameters break a row of identical balls.
    const lobes = coarse
      ? [[-0.86, 0.05, 0.45, 0.97], [0.05, -0.17, 0.70, 1.18], [0.94, 0.16, 0.39, 0.88]]
      : [[-0.74, -0.27, 0.52, 0.91], [0.04, -0.39, 0.77, 1.08], [0.82, -0.22, 0.48, 0.85],
         [-1.18, 0.25, 0.29, 0.72], [-0.43, 0.35, 0.37, 0.95], [0.40, 0.37, 0.38, 0.98], [1.10, 0.28, 0.26, 0.72]];
    lobes.forEach(([x, z, y, scale], k) => {
      const center = end.clone().addScaledVector(across, x * size).addScaledVector(depth, z * size).add(V(0, y * size, 0));
      const root = center.clone().add(V(0, -scale * size * 0.43, 0));
      b.tube([end, root], [0.035, 0.012], HAMLET_KIND.bark, 4);
      b.pineLobe(center, size * scale, i * 1.71 + k * 0.63, a + k * 0.17, k !== 3 && k !== 6);
    });
  });
  for (const [x, z, y, size] of [[-0.48, 0.04, 0.17, 0.71], [0.03, -0.08, 0.40, 0.91], [0.58, 0.11, 0.14, 0.64]]) {
    b.pineLobe(trunk[6].clone().add(V(x, y, z)), size, 3.4 + x, 0.2, true);
  }
  return b.finish(1.15);
}

export function cedarGeometry(coarse = false): HamletAsset {
  const b = new MeshBuilder(coarse, 1);
  const trunk = Array.from({ length: 8 }, (_, i) => V(Math.sin(i * 0.7) * 0.09, i * 1.5 - 0.12, Math.cos(i * 0.8) * 0.06));
  b.tube(trunk, trunk.map((_, i) => Math.max(0.025, 0.42 * (1 - i / 7))), HAMLET_KIND.bark, 7, true);
  for (let level = 0; level < 8; level++) {
    if (coarse && (level === 1 || level === 4)) continue;
    const height = 1.6 + level * 1.08, length = 2.3 - level * 0.24;
    const branches = coarse ? 4 : 5;
    for (let k = 0; k < branches; k++) {
      const a = k * TAU / branches + level * 0.53;
      const mid = V(Math.cos(a) * length * 0.56, height - 0.28, Math.sin(a) * length * 0.56);
      const tip = V(Math.cos(a) * length, height - 0.48, Math.sin(a) * length);
      b.tube([V(0, height, 0), mid, tip], [0.085 - level * 0.008, 0.04, 0.012], HAMLET_KIND.bark, 4);
      b.needleVolume(mid.clone().lerp(tip, 0.08).add(V(0, -0.16, 0)), length * 0.47, 0.36 - level * 0.015, 0.41 - level * 0.019, level * 0.8 + k, a);
      for (let s = 0; s < (coarse ? 2 : 3); s++) {
        const centre = mid.clone().lerp(tip, s * 0.44).add(V(0, -s * 0.08, 0));
        for (let i = 0; i < (coarse ? 2 : 10); i++) {
          const aa = a + (i % 2 ? 1 : -1) * (0.35 + i * 0.14);
          const end = centre.clone().add(V(Math.cos(aa) * (0.36 + i * 0.025), -0.32 - (i % 3) * 0.09, Math.sin(aa) * (0.36 + i * 0.025)));
          b.blade(centre, end, 0.018, HAMLET_KIND.needle, aa);
        }
      }
      if ((k + level) % 2 === 0) b.snowCap(mid.clone().lerp(tip, 0.15).add(V(0, 0.27, 0)), length * 0.4, 0.35 + length * 0.065, 0.24, a, level + k);
    }
  }
  tuft(b, V(0.03, 9.95, 0.02), 0.44, 0.7, 12);
  b.snowCap(V(0.03, 10.12, 0.02), 0.32, 0.29, 0.15);
  return b.finish(0.5);
}

export function plumGeometry(): HamletAsset {
  const b = new MeshBuilder(false, 2);
  b.tube([V(0, -0.12, 0), V(-0.22, 0.8, 0.02), V(0.13, 1.7, 0.05), V(-0.14, 2.7, -0.12), V(0.3, 3.35, 0.08)], [0.23, 0.19, 0.12, 0.065, 0.012], HAMLET_KIND.bark, 6, true);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996323, h = 0.95 + i * 0.29, spread = 1.5 - i * 0.08;
    const root = V(i % 2 ? 0.1 : -0.12, h, 0);
    const mid = V(Math.cos(a) * spread * 0.6, h + 0.25, Math.sin(a) * spread * 0.6);
    const end = V(Math.cos(a) * spread, h + 0.76, Math.sin(a) * spread);
    b.tube([root, mid, end], [0.075, 0.045, 0.009], HAMLET_KIND.bark, 5);
    for (let j = 0; j < 3; j++) {
      const p = mid.clone().lerp(end, 0.2 + j * 0.3);
      const tip = p.clone().add(V(Math.cos(a + (j % 2 ? 1 : -1)) * 0.37, 0.38, Math.sin(a + (j % 2 ? 1 : -1)) * 0.37));
      b.tube([p, tip], [0.025, 0.006], HAMLET_KIND.bark, 4);
      b.bud(tip, 0.058 + (j % 2) * 0.014);
      b.bud(tip.clone().lerp(p, 0.43), 0.048);
    }
    if (i % 2 === 0) b.snowCap(mid.clone().add(V(0, 0.09, 0)), 0.4, 0.15, 0.085, a, i);
  }
  return b.finish(0.33);
}

export function reedsGeometry(): HamletAsset {
  const b = new MeshBuilder(false, 3);
  for (let i = 0; i < 17; i++) {
    const a = i * 2.39996323, radius = 0.11 + (i % 5) * 0.062, h = 0.7 + (i % 7) * 0.105;
    const base = V(Math.cos(a) * radius, -0.08, Math.sin(a) * radius);
    const mid = base.clone().add(V(Math.cos(a) * 0.14, h * 0.65, Math.sin(a) * 0.14));
    const tip = base.clone().add(V(Math.cos(a) * 0.56, h, Math.sin(a) * 0.56));
    b.blade(base, mid, 0.036, HAMLET_KIND.reed, a, true);
    b.blade(mid, tip, 0.029, HAMLET_KIND.reed, a);
    if (i % 4 === 0) {
      b.tube([base, mid, tip.clone().add(V(0, 0.3, 0))], [0.014, 0.011, 0.006], HAMLET_KIND.reed, 3);
      for (let s = 0; s < 4; s++) {
        const p = tip.clone().add(V(0, 0.1 + s * 0.055, 0));
        const end = p.clone().add(V(Math.cos(a) * 0.16, 0.07, Math.sin(a) * 0.16));
        b.blade(p, end, 0.025, HAMLET_KIND.reed, a);
      }
    }
  }
  // Two low deposits leave golden blades projecting above the snow.
  b.snowCap(V(-0.14, 0.23, 0.08), 0.34, 0.25, 0.11, 0.3);
  b.snowCap(V(0.19, 0.3, -0.08), 0.28, 0.22, 0.09, -0.5);
  return b.finish(0.43);
}

export function rockGeometry(): HamletAsset {
  const b = new MeshBuilder(false, 4);
  for (const [cx, cz, sx, sz, height, phase] of [[0, 0, 1.13, 0.78, 1.15, 0.4], [-0.76, 0.33, 0.72, 0.54, 0.52, 1.7], [0.78, -0.22, 0.8, 0.62, 0.76, 2.7]]) {
    const sides = 6;
    const rings = [0, 0.48, 1].map((t, level) => Array.from({ length: sides }, (_, i) => {
      const a = i * TAU / sides, radius = (level === 0 ? 1.02 : level === 1 ? 0.90 : 0.63) * (1 + 0.21 * Math.sin(i * 2.7 + phase));
      return V(cx + Math.cos(a) * sx * radius + t * 0.26, level === 0 ? -0.16 : height * t + Math.sin(i * 2.3 + phase) * (level === 2 ? 0.17 : 0.11), cz + Math.sin(a) * sz * radius - t * 0.14);
    }));
    for (let level = 0; level < 2; level++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, g = level === 0 ? 1 : 0;
      b.tri(rings[level][i], rings[level + 1][i], rings[level + 1][j], HAMLET_KIND.slate, [g, 0, 0]);
      b.tri(rings[level][i], rings[level + 1][j], rings[level][j], HAMLET_KIND.slate, [g, 0, g]);
    }
    const top = V(cx + 0.15, height + 0.02, cz - 0.08);
    for (let i = 0; i < sides; i++) b.tri(top, rings[2][(i + 1) % sides], rings[2][i], HAMLET_KIND.slate);
    // Selected mineral fractures follow real edges; the complete triangulation remains invisible.
    for (const i of [1, 4]) b.line([rings[0][i].clone().lerp(rings[1][i], 0.24), rings[1][i], rings[2][i]], HAMLET_KIND.slate, V(Math.cos(i * TAU / sides), 0.1, Math.sin(i * TAU / sides)).normalize());
    b.snowCap(V(cx + 0.12, height + 0.04, cz - 0.06), sx * 0.7, sz * 0.76, 0.17, 0, phase);
  }
  return b.finish(1.45);
}

export function createHamletAssets(coarse = false): Record<HamletSpecies, HamletAsset> {
  return { pine: pineGeometry(coarse), cedar: cedarGeometry(coarse), plum: plumGeometry(), reeds: reedsGeometry(), rock: rockGeometry() };
}
