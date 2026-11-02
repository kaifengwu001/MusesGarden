import { Ray, Triangle, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { CHERRY_VARIANTS, makeCherryGeometry } from '../life/cherryGeometry';

interface BranchSpan {
  first: number;
  count: number;
  parent: number;
  start: number[];
  points: number[][];
}

// The attachment starts use doubles, while the rendered surface uses Float32.
// Twenty micrometers admits their rounding difference, not a visible joint gap.
const CONTACT_EPSILON = 0.00002;
const AXES = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
  new Vector3(1, 0.71, 0.39).normalize(),
];

function renderedTriangles(geometry: BufferGeometry, span: BranchSpan): Triangle[] {
  const position = geometry.getAttribute('position');
  const triangles: Triangle[] = [];
  for (let i = span.first; i < span.first + span.count; i += 3) {
    triangles.push(new Triangle(
      new Vector3().fromBufferAttribute(position, i),
      new Vector3().fromBufferAttribute(position, i + 1),
      new Vector3().fromBufferAttribute(position, i + 2),
    ));
  }
  return triangles;
}

function distanceToSurface(point: Vector3, triangles: Triangle[]): number {
  let minimum = Infinity;
  const nearest = new Vector3();
  for (const triangle of triangles) {
    triangle.closestPointToPoint(point, nearest);
    minimum = Math.min(minimum, nearest.distanceTo(point));
  }
  return minimum;
}

function rayDistance(point: Vector3, direction: Vector3, triangles: Triangle[]): number {
  const ray = new Ray(point, direction), hit = new Vector3();
  let nearest = Infinity;
  for (const triangle of triangles) {
    // backfaceCulling=false is the geometric equivalent of a DoubleSide material.
    if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) nearest = Math.min(nearest, hit.distanceTo(point));
  }
  return nearest;
}

describe('rendered cherry and willow branch joints', () => {
  for (const detail of ['full', 'far'] as const) {
    it(`keeps every ${detail} child attachment inside or on its actual parent surface`, () => {
      for (let variant = 0; variant < CHERRY_VARIANTS; variant++) {
        const geometry = makeCherryGeometry(variant, detail);
        const spans = geometry.userData.branchSpans as BranchSpan[];
        expect(spans.length).toBeGreaterThan(10);
        const surfaces = spans.map(span => renderedTriangles(geometry, span));
        let linked = 0;
        for (const [index, child] of spans.entries()) {
          if (child.parent < 0) continue; // Deliberately independent below-ground buttresses.
          linked++;
          const label = `variant${variant}/${detail}/branch${index}->${child.parent}`;
          expect(child.parent, `${label} must refer to an existing earlier branch`).toBeLessThan(index);
          const start = new Vector3(child.start[0], child.start[1], child.start[2]);
          expect(distanceToSurface(start, surfaces[index]), `${label} reported attachment belongs to the drawn child`).toBeLessThan(CONTACT_EPSILON);
          const parent = surfaces[child.parent];
          const contact = distanceToSurface(start, parent);
          if (contact <= CONTACT_EPSILON) continue; // Tip-cap contact is valid, including the inner crown.

          // An interior point intersects the closed parent in both directions.
          // Test four independent lines against rendered triangles, not the authored curve.
          const pairs = AXES.map(axis => [rayDistance(start, axis, parent), rayDistance(start, axis.clone().negate(), parent)]);
          expect(pairs.every(pair => pair.every(Number.isFinite)), `${label} detached start is outside the parent mesh`).toBe(true);
          expect(Math.min(...pairs.map(pair => Math.max(...pair))), `${label} enclosing parent is nearby`).toBeLessThan(1.2);
        }
        expect(linked, `variant${variant}/${detail} linkage audit exercised`).toBeGreaterThanOrEqual(detail === 'full' ? 25 : 6);
        geometry.dispose();
      }
    });
  }
});
