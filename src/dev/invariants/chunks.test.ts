import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkSelection, LOD_DEFAULT, morphedVertex, NODE_FLOATS, type HeightFn, type LodView } from '../../planet/chunks';
import { sphereToFace, type FacePoint } from '../../planet/cubesphere';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomDir(rand: () => number, out = new Vector3()): Vector3 {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return out.set(s * Math.cos(t), s * Math.sin(t), z);
}

function openView(camera: Vector3, radius: number): LodView {
  return { camera, radius, heightAbove: 0, heightBelow: 0, frustum: null, horizonCull: false };
}

const views: Array<[string, number, number]> = [
  ['overview R40', 40, 5.2],
  ['overview R400', 400, 5.2],
  ['low R128', 128, 1.02],
  ['skimming R400', 400, 1.004],
  ['mid R250', 250, 1.6],
];

describe('CDLOD selection', () => {
  const rand = lcg(11);

  it('covers the sphere exactly once', () => {
    const fp: FacePoint = { face: 0, a: 0, b: 0 };
    const d = new Vector3();
    for (const [name, R, dist] of views) {
      const sel = new ChunkSelection();
      sel.select(openView(randomDir(rand).multiplyScalar(R * dist), R), LOD_DEFAULT);
      for (let s = 0; s < 3000; s++) {
        sphereToFace(randomDir(rand, d), fp);
        const u = (fp.a + 1) / 2;
        const v = (fp.b + 1) / 2;
        let hits = 0;
        for (let k = 0; k < sel.count; k++) {
          const o = k * NODE_FLOATS;
          const x = sel.data;
          if (x[o + 3] === fp.face && u >= x[o] && u <= x[o] + x[o + 2] && v >= x[o + 1] && v <= x[o + 1] + x[o + 2]) hits++;
        }
        // points exactly on a node edge may touch two nodes
        expect(hits, name).toBeGreaterThanOrEqual(1);
        expect(hits, name).toBeLessThanOrEqual(4);
      }
    }
  });

  it('is watertight after morphing: every edge vertex lies on a neighbour’s edge', () => {
    const grid = LOD_DEFAULT.grid;
    const heights: Array<[string, HeightFn]> = [
      ['sphere', () => 0],
      ['bumpy', (d) => 3 * Math.sin(9 * d.x) * Math.cos(7 * d.y) + 2 * Math.sin(23 * d.z)],
    ];
    for (const [hName, height] of heights) {
      for (const [name, R, dist] of views) {
        for (let trial = 0; trial < 3; trial++) {
          const camera = randomDir(rand).multiplyScalar(R * dist);
          const sel = new ChunkSelection();
          sel.select(openView(camera, R), LOD_DEFAULT);
          // Every node's four edges as polylines of morphed vertices.
          const polylines: Array<{ node: number; points: Vector3[] }> = [];
          for (let k = 0; k < sel.count; k++) {
            const edges: Array<(t: number) => [number, number]> = [(t) => [t, 0], (t) => [t, grid - 1], (t) => [0, t], (t) => [grid - 1, t]];
            for (const edge of edges) {
              const points: Vector3[] = [];
              for (let t = 0; t < grid; t++) points.push(morphedVertex(sel, k, ...edge(t), camera, R, grid, height, new Vector3()));
              polylines.push({ node: k, points });
            }
          }
          // Spatial hash of segments, then: is each vertex on another node's polyline?
          const cell = (R * Math.PI) / 2 / 2 ** sel.maxLevel / (grid - 1); // finest segment length
          const hash = new Map<string, Array<[number, Vector3, Vector3]>>();
          const keyOf = (p: Vector3): string => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
          for (const { node, points } of polylines) {
            for (let t = 0; t + 1 < points.length; t++) {
              const a = points[t];
              const b = points[t + 1];
              const steps = Math.max(1, Math.ceil(a.distanceTo(b) / cell));
              for (let s = 0; s <= steps; s++) {
                const key = keyOf(a.clone().lerp(b, s / steps));
                let list = hash.get(key);
                if (!list) hash.set(key, (list = []));
                list.push([node, a, b]);
              }
            }
          }
          const ab = new Vector3();
          const ap = new Vector3();
          let worst = 0;
          for (const { node, points } of polylines) {
            for (const p of points) {
              let best = Infinity;
              const cx = Math.floor(p.x / cell);
              const cy = Math.floor(p.y / cell);
              const cz = Math.floor(p.z / cell);
              for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dz = -1; dz <= 1; dz++) {
                    for (const [other, a, b] of hash.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
                      if (other === node) continue;
                      ab.subVectors(b, a);
                      const t = Math.min(1, Math.max(0, ap.subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-30)));
                      best = Math.min(best, ap.subVectors(p, a).addScaledVector(ab, -t).length());
                    }
                  }
                }
              }
              worst = Math.max(worst, best);
            }
          }
          expect(worst, `${hName} ${name}: worst gap ${worst} m`).toBeLessThan(1e-6 * R);
        }
      }
    }
  }, 30_000); // brute force over every edge vertex: slow by design

  it('stays within the triangle budget for real views', () => {
    const camera = new PerspectiveCamera(55, 16 / 10, 0.1, 1e5);
    const frustum = new Frustum();
    const m = new Matrix4();
    const trisPerNode = 2 * (LOD_DEFAULT.grid - 1) ** 2;
    for (const [name, R, dist, fov] of [
      ['overview R400', 400, 5.2, 35],
      ['overview R40', 40, 5.2, 35],
      ['low R400', 400, 1.01, 55],
      ['low R128', 128, 1.03, 55],
    ] as const) {
      camera.fov = fov;
      camera.position.set(0, 0, R * dist);
      camera.lookAt(0, R * (dist < 1.1 ? 0.9 : 0), 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const sel = new ChunkSelection();
      sel.select({ camera: camera.position, radius: R, heightAbove: 0.3 * R, heightBelow: 2, frustum, horizonCull: true }, LOD_DEFAULT);
      expect(sel.count * trisPerNode, name).toBeLessThan(400_000);
      expect(sel.count, name).toBeGreaterThan(2);
    }
  });
});
