import { DoubleSide, Ray, Vector3, type BufferGeometry, type Mesh, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { FLOOR, Homestead } from '../life/props';

type Point = [number, number];
interface Face {
  name: string;
  triangle: number;
  flag: number;
  points: Vector3[];
  normal: Vector3;
  offset: number;
  doubleSided: boolean;
}

function faces(geometry: BufferGeometry, material: ShaderMaterial): Face[] {
  const position = geometry.getAttribute('position'), paint = geometry.getAttribute('aPaint'), index = geometry.index!;
  return Array.from({ length: index.count / 3 }, (_, triangle) => {
    const ids = [0, 1, 2].map(k => index.getX(triangle * 3 + k));
    const points = ids.map(id => new Vector3().fromBufferAttribute(position, id));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    return { name: material.name, triangle, flag: paint.getW(ids[0]), points, normal, offset: normal.dot(points[0]), doubleSided: material.side === DoubleSide };
  }).filter(face => face.normal.lengthSq() > 0.99);
}

const cross = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Clip actual triangle interiors, so shared vertices/edges never count as coverage. */
function overlapArea(a: Face, b: Face): number {
  const axis = a.normal.toArray().map(Math.abs).indexOf(Math.max(...a.normal.toArray().map(Math.abs)));
  const project = (p: Vector3): Point => axis === 0 ? [p.y, p.z] : axis === 1 ? [p.z, p.x] : [p.x, p.y];
  const clip = b.points.map(project);
  const direction = Math.sign(cross(clip[0], clip[1], clip[2]));
  let polygon = a.points.map(project);
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const from = clip[edge], to = clip[(edge + 1) % 3], previous = polygon;
    polygon = [];
    for (let i = 0; i < previous.length; i++) {
      const p = previous[i], q = previous[(i + 1) % previous.length];
      const dp = direction * cross(from, to, p), dq = direction * cross(from, to, q);
      if (dp >= 0) polygon.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        polygon.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  const projected = Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  return projected / Math.abs(a.normal.getComponent(axis));
}

function conflicts(all: Face[]): string[] {
  const planes = new Map<string, Face[]>();
  for (const face of all) {
    const n = face.normal.clone();
    const first = n.toArray().find(v => Math.abs(v) > 1e-5)!;
    const sign = Math.sign(first);
    n.multiplyScalar(sign);
    const key = [...n.toArray(), face.offset * sign].map(v => Math.round(v * 1e4)).join('/');
    const plane = planes.get(key) ?? [];
    plane.push(face);
    planes.set(key, plane);
  }
  const overlaps: string[] = [];
  for (const plane of planes.values()) for (let i = 0; i < plane.length; i++) for (let j = i + 1; j < plane.length; j++) {
    const a = plane[i], b = plane[j];
    // Opposite-facing opaque contact caps cannot be visible together. Thin
    // double-sided cloth, however, must own its area from either direction.
    if (!a.doubleSided && !b.doubleSided && a.normal.dot(b.normal) < 0) continue;
    if (b.points.some(p => Math.abs(a.normal.dot(p) - a.offset) > 2e-6)) continue;
    if (a.points.some(p => Math.abs(b.normal.dot(p) - b.offset) > 2e-6)) continue;
    const area = overlapArea(a, b);
    if (area > 1e-8) {
      const centre = a.points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(3).toArray().map(v => v.toFixed(3)).join(',');
      overlaps.push(`${a.name}[${a.flag}]#${a.triangle} / ${b.name}[${b.flag}]#${b.triangle}: ${area.toExponential(2)} m² near ${centre}`);
    }
  }
  return overlaps;
}

function withHome(seed: number, check: (all: Face[]) => void): void {
  const home = new Homestead({}, seed);
  const meshes = home.group.children as Mesh<BufferGeometry, ShaderMaterial>[];
  try { check(meshes.flatMap(mesh => faces(mesh.geometry, mesh.material))); }
  finally { for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); } }
}

describe('shelter surface ownership', () => {
  it.each([1, 412, 771])('does not give two visible triangles the same area at seed %i', seed => {
    withHome(seed, all => { expect(conflicts(all)).toEqual([]); });
  });

  it.each([1, 412, 771])('keeps the actual ridge-beam shoulders beneath the roof at seed %i', seed => {
    withHome(seed, all => {
      const roof = all.filter(face => face.name === 'cloth' && face.flag === 0);
      const beam = all.filter(face => face.name === 'timber' && face.normal.y > 0 && face.points.every(p => Math.abs(p.x) < 0.07 && p.y > 3.3));
      const ray = new Ray(new Vector3(), new Vector3(0, -1, 0)), hit = new Vector3();
      let checked = 0;
      for (const face of beam) {
        const samples = [...face.points, face.points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(3)];
        for (const p of samples) {
          ray.origin.set(p.x, 10, p.z);
          const heights: number[] = [];
          for (const sheet of roof) if (ray.intersectTriangle(sheet.points[0], sheet.points[1], sheet.points[2], false, hit)) heights.push(hit.y);
          expect(heights.length, `roof above beam at ${p.x}, ${p.z}`).toBeGreaterThan(0);
          expect(p.y - Math.min(...heights), `beam emerges through canvas at ${p.x}, ${p.z}`).toBeLessThanOrEqual(2e-6);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(80);
    });
  });

  it('preserves one supported walking floor across the sheltered interior', () => {
    withHome(412, all => {
      const caps = all.filter(face => face.name === 'stone' && face.normal.y > 0.99 && face.points.every(p => Math.abs(p.y - FLOOR) < 1e-6));
      const ray = new Ray(new Vector3(), new Vector3(0, -1, 0)), hit = new Vector3();
      for (const x of [-1.731, -0.813, 0.173, 0.917, 1.741]) for (const z of [-1.513, -0.713, 0.131, 0.913, 1.519]) {
        ray.origin.set(x, 10, z);
        const heights: number[] = [];
        for (const cap of caps) if (ray.intersectTriangle(cap.points[0], cap.points[1], cap.points[2], false, hit)) heights.push(hit.y);
        expect(heights, `floor triangle coverage at ${x}, ${z}`).toHaveLength(1);
        expect(heights[0]).toBeCloseTo(FLOOR, 6);
      }
    });
  });
});
