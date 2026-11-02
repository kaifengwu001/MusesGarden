import { Ray, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { BENCH, COTTAGE, FLOOR, PIER, STEPS, TERRACE, shelterGeometry } from '../life/props';

function hits(geometry: BufferGeometry, x: number, z: number, start: number, kind?: number): number[] {
  const ray = new Ray(new Vector3(x, start, z), new Vector3(0, -1, 0));
  const positions = geometry.getAttribute('position'), kinds = geometry.getAttribute('aKind');
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
  const heights: number[] = [];
  for (let k = 0; k < positions.count; k += 3) {
    if (kind !== undefined && kinds.getX(k) !== kind) continue;
    a.fromBufferAttribute(positions, k); b.fromBufferAttribute(positions, k + 1); c.fromBufferAttribute(positions, k + 2);
    if (ray.intersectTriangle(a, b, c, false, hit) && !heights.some((height) => Math.abs(height - hit.y) < 1e-5)) heights.push(hit.y);
  }
  return heights.sort((a, b) => b - a);
}

describe('Rock-attached Scarlet shelter', () => {
  it('builds one continuous sloping cloth sheet, with no second porch roof', () => {
    const geometry = shelterGeometry(412);
    for (const x of [-3, 0, 3]) for (const z of [-2.7, 0, 2.8]) expect(hits(geometry, x, z, 10, 4)).toHaveLength(1);
    const back = hits(geometry, 0, -2.7, 10, 4)[0], front = hits(geometry, 0, 2.8, 10, 4)[0];
    expect(back - front).toBeGreaterThan(1);
    expect(front).toBeGreaterThan(FLOOR + 1.8);
    geometry.dispose();
  });

  it('pins every canopy edge to its rope while leaving the cloth interior free to move', () => {
    const geometry = shelterGeometry(412), uv = geometry.getAttribute('uv'), kind = geometry.getAttribute('aKind');
    const width = Math.PI / 0.324, depth = Math.PI / 0.462;
    let boundary = 0, movingInterior = 0;
    for (let i = 0; i < uv.count; i++) {
      if (kind.getX(i) !== 4) continue;
      const u = uv.getX(i), v = uv.getY(i);
      const windWeight = Math.sin(u * 0.324) * Math.sin(v * 0.462);
      if (Math.min(u, v, Math.abs(u - width), Math.abs(v - depth)) < 1e-5) {
        expect(Math.abs(windWeight)).toBeLessThan(1e-5);
        boundary++;
      } else if (windWeight > 0.5) movingInterior++;
    }
    expect(boundary).toBeGreaterThan(200);
    expect(movingInterior).toBeGreaterThan(300);
    geometry.dispose();
  });

  it('has one sewn rear curtain surface without overlapping panel strips', () => {
    const geometry = shelterGeometry(412), positions = geometry.getAttribute('position'), kinds = geometry.getAttribute('aKind');
    const triangles: [Vector3, Vector3, Vector3][] = [];
    for (let i = 0; i < positions.count; i += 3) {
      if (kinds.getX(i) !== 5) continue;
      const points = [0, 1, 2].map(offset => new Vector3().fromBufferAttribute(positions, i + offset)) as [Vector3, Vector3, Vector3];
      if (points.every(point => point.z > -3.03 && point.z < -2.74)) triangles.push(points);
    }
    const ray = new Ray(new Vector3(), new Vector3(0, 0, -1)), hit = new Vector3();
    let samples = 0;
    for (let x = -3.813; x < 2.04; x += 0.137) for (let y = 1.113; y < 3.19; y += 0.127) {
      ray.origin.set(x, y, 0);
      const count = triangles.filter(([a, b, c]) => ray.intersectTriangle(a, b, c, false, hit)).length;
      expect(count, `curtain coverage at ${x}, ${y}`).toBe(1);
      samples++;
    }
    expect(samples).toBeGreaterThan(650);
    geometry.dispose();
  });

  it('preserves flat walking, step and sitting support surfaces', () => {
    const geometry = shelterGeometry(412);
    const sample = (x: number, z: number, height: number): void => expect(hits(geometry, x, z, height + 0.005)[0]).toBeCloseTo(height, 5);
    sample(0, 0, FLOOR);
    sample(0, TERRACE.z1 - 0.2, FLOOR);
    sample((PIER.x0 + PIER.x1) / 2, PIER.z1 - 0.4, FLOOR);
    for (let k = 0; k < STEPS.count; k++) sample((STEPS.x0 + STEPS.x1) / 2, TERRACE.z1 + (k + 0.5) * STEPS.tread, FLOOR - k * STEPS.rise);
    sample(BENCH.x, BENCH.z, FLOOR + BENCH.seat);
    geometry.dispose();
  });

  it('has exactly one physical top across the house, terrace, lookout and steps', () => {
    const geometry = shelterGeometry(412), positions = geometry.getAttribute('position'), kinds = geometry.getAttribute('aKind');
    const halfX = COTTAGE.halfX + COTTAGE.thickness / 2, halfZ = COTTAGE.halfZ + COTTAGE.thickness / 2;
    const rectangles = [
      { x0: -halfX, x1: halfX, z0: -halfZ, z1: halfZ, top: FLOOR },
      { ...TERRACE, top: FLOOR }, { ...PIER, top: FLOOR },
      ...Array.from({ length: STEPS.count }, (_, k) => ({ x0: STEPS.x0, x1: STEPS.x1, z0: TERRACE.z1 + k * STEPS.tread, z1: TERRACE.z1 + (k + 1) * STEPS.tread, top: FLOOR - k * STEPS.rise })),
    ];
    const caps: { a: Vector3; b: Vector3; c: Vector3; kind: number; area: number }[] = [];
    for (let k = 0; k < positions.count; k += 3) {
      const a = new Vector3().fromBufferAttribute(positions, k), b = new Vector3().fromBufferAttribute(positions, k + 1), c = new Vector3().fromBufferAttribute(positions, k + 2);
      const twiceArea = b.clone().sub(a).cross(c.clone().sub(a)).y;
      if (twiceArea > 1e-8 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.y - c.y) < 1e-6 && rectangles.some(r => Math.abs(a.y - r.top) < 1e-6)) caps.push({ a, b, c, kind: kinds.getX(k), area: twiceArea / 2 });
    }
    // Inclusion/exclusion is independent of the geometry's cell subdivision.
    // Duplicate slab/board tops increase this area even if they share a height.
    let unionArea = 0;
    for (let mask = 1; mask < 1 << rectangles.length; mask++) {
      const subset = rectangles.filter((_, index) => mask & (1 << index));
      const width = Math.max(0, Math.min(...subset.map(r => r.x1)) - Math.max(...subset.map(r => r.x0)));
      const depth = Math.max(0, Math.min(...subset.map(r => r.z1)) - Math.max(...subset.map(r => r.z0)));
      unionArea += (subset.length % 2 ? 1 : -1) * width * depth;
    }
    expect(caps.reduce((area, cap) => area + cap.area, 0)).toBeCloseTo(unionArea, 4);

    // Count actual triangle coverage, NOT distinct hit heights: the former
    // height test hid the coplanar wooden planks and overlapping slab caps.
    let checked = 0;
    for (let x = PIER.x0 - 0.173; x < halfX + 0.2; x += 0.239) for (let z = -halfZ - 0.151; z < TERRACE.z1 + STEPS.count * STEPS.tread + 0.2; z += 0.227) {
      const supporting = rectangles.filter(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
      const top = supporting.length ? Math.max(...supporting.map(r => r.top)) : null;
      let onEdge = false;
      const covering = caps.filter(({ a, b, c }) => {
        const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
        const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
        const w = 1 - u - v;
        if (Math.min(u, v, w) >= -1e-6 && Math.min(u, v, w) <= 1e-6) onEdge = true;
        return Math.min(u, v, w) > 1e-6;
      });
      if (onEdge) continue; // Shared triangle boundaries have zero surface area.
      expect(covering, `floor coverage at ${x}, ${z}`).toHaveLength(top === null ? 0 : 1);
      if (top !== null) {
        expect(covering[0].a.y).toBeCloseTo(top, 5);
        expect(covering[0].kind).toBe(Math.abs(x) < halfX && Math.abs(z) < halfZ ? 9 : 2);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(1_000);
    geometry.dispose();
  });

  it('has finite positions/normals across seeds and a modest geometry budget', () => {
    for (const seed of [1, 412, 771]) {
      const geometry = shelterGeometry(seed);
      expect(geometry.getAttribute('position').array.every(Number.isFinite)).toBe(true);
      expect(geometry.getAttribute('normal').array.every(Number.isFinite)).toBe(true);
      expect(geometry.getAttribute('position').count).toBeLessThan(35_000);
      geometry.dispose();
    }
  });
});
