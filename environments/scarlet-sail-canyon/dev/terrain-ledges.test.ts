import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ChunkSelection, LOD_DEFAULT, morphedVertex, NODE_FLOATS } from '../../../src/planet/chunks';
import { uvToSphere } from '../../../src/planet/cubesphere';
import { travel } from '../../../src/planet/geo';
import { CameraRig } from '../../../src/view/camera';
import { HOME_LEVEL, SETTLEMENT, Terrain, generateLayout } from '../planet/terrain';
import { canyonSurfaceLod } from '../planet/surface';
import type { FieldParams } from '../planet/fields';
import { CHALK_STEP } from '../planet/fields';

const params: FieldParams = {
  roll: 3.6, hummocks: 0.16, wetlands: 0, waterLevel: 0, grain: 0.45,
  density: 0.7, patchiness: 0.95, patchSize: 13, weights: [0.15, 0.8, 0.05, 0],
};
function makeTerrain(radius = 128): Terrain {
  const terrain = new Terrain(generateLayout(412));
  terrain.update(radius, params, 0.5);
  return terrain;
}

describe('Scarlet terrain ledge resolution', () => {
  it.each([40, 128, 400])('spreads a shallow access ledge across its full physical riser at R%s', radius => {
    const terrain = makeTerrain(radius);
    const side = new Vector3().crossVectors(terrain.layout.cottage, terrain.layout.homeBearing).normalize();
    const boundary = Math.asin(SETTLEMENT.halfWidth / radius) * radius;
    const height = (run: number): number => terrain.homestead(
      travel(terrain.layout.cottage, side, (boundary + 2 + run) / radius, new Vector3()),
      HOME_LEVEL - 0.8,
    );
    // The 0.8m final step must not use only the first fraction of the ramp
    // intended for a full 5.6m bed. That produced a sub-cell cliff and teeth.
    expect(height(0)).toBeCloseTo(HOME_LEVEL, 8);
    expect(height(1.2)).toBeCloseTo(HOME_LEVEL - 0.4, 8);
    expect(height(2.4)).toBeCloseTo(HOME_LEVEL - 0.8, 8);
  });

  it.each([
    { name: 'reported shallow ledge', x: [13, 18], z: [-2, 20], error: 0.05, relief: 0.5 },
    { name: 'rear opening cliff', x: [13, 17], z: [-45, -24], error: 0.22, relief: CHALK_STEP },
  ])('bounds actual morphed triangle error along the $name', ({ x: across, z: along, error, relief }) => {
    const terrain = makeTerrain();
    const radius = terrain.radius;
    const rig = new CameraRig();
    rig.applyPose('0.1015,-0.1997,0.6176,0.754,0.647');
    rig.settle();
    rig.update(1 / 60, radius, 1.6, dir => terrain.height(dir));
    const selection = new ChunkSelection();
    const cfg = canyonSurfaceLod(LOD_DEFAULT);
    selection.select({
      camera: rig.camera.position, radius, heightAbove: terrain.maxHeight,
      heightBelow: 3, frustum: null, horizonCull: true,
    }, cfg);
    const grid = cfg.grid;
    const direction = new Vector3();
    const local = { x: 0, z: 0 };
    const middle = new Vector3();
    let samples = 0;
    let maxError = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let node = 0; node < selection.count; node++) {
      const o = node * NODE_FLOATS;
      const data = selection.data;
      uvToSphere(data[o + 3], data[o] + data[o + 2] / 2, data[o + 1] + data[o + 2] / 2, direction);
      if (direction.angleTo(terrain.layout.cottage) * radius > 65) continue;
      const points: Vector3[] = [];
      for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
        points.push(morphedVertex(selection, node, x, y, rig.camera.position, radius, grid, dir => terrain.height(dir), new Vector3()));
      }
      for (let y = 0; y < grid - 1; y++) for (let x = 0; x < grid - 1; x++) {
        const a = y * grid + x, b = a + 1, c = a + grid, d = c + 1;
        // Same diagonal as Surface.createGrid. Test the rendered triangle
        // interior, not merely vertices sampled from the same height field.
        for (const ids of [[a, b, d], [a, d, c]]) {
          middle.copy(points[ids[0]]).add(points[ids[1]]).add(points[ids[2]]).divideScalar(3);
          const meshHeight = middle.length() - radius;
          direction.copy(middle).normalize();
          terrain.cottageLocal(direction, local);
          if (local.x < across[0] || local.x > across[1] || local.z < along[0] || local.z > along[1]) continue;
          const actualHeight = terrain.height(direction);
          maxError = Math.max(maxError, Math.abs(meshHeight - actualHeight));
          lowest = Math.min(lowest, actualHeight);
          highest = Math.max(highest, actualHeight);
          samples++;
        }
      }
    }
    expect(samples).toBeGreaterThan(1000);
    // Original shallow step reached 0.639m; the rear opening reached 2.30m.
    // Preserve the height range: flattening the ledges is not a resolution fix.
    expect(highest - lowest).toBeGreaterThan(relief);
    expect(maxError).toBeLessThan(error);
  });
});
