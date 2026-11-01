import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Sphere, Vector3, type InstancedBufferGeometry, type Mesh } from 'three';
import { warpPoint, type WarpFrame } from '../../../src/render/warp';
import { chalkGeometry, fernGeometry, lampPetalGeometry, mesaGeometry, reedColonyGeometry } from './canyonGeometry';
import { CanyonScenery } from './canyonScenery';
import { placeScenerySphere, sceneryBounds, warpScenerySphere } from './sceneryCulling';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const params: FieldParams = { roll: 1.5, hummocks: 0.25, wetlands: 0.58, waterLevel: 0, grain: 0.5, density: 0.5, patchiness: 0.9, patchSize: 13, weights: [0.1, 0.7, 0.1, 0.1] };

function placements(scenery: CanyonScenery): number[][] {
  return scenery.group.children.map(child => {
    const geometry = (child as Mesh<InstancedBufferGeometry>).geometry;
    return ['aAnchor', 'aAcross', 'aPlacement'].flatMap(name => Array.from(geometry.getAttribute(name).array));
  });
}

describe('Lantern scenery culling', () => {
  it('encloses animated vertices under curved placement and positive or negative warp', () => {
    const templates = [reedColonyGeometry(0), reedColonyGeometry(2), reedColonyGeometry(3), fernGeometry(), chalkGeometry(), mesaGeometry(), lampPetalGeometry()];
    const up = new Vector3(0.24, 0.83, -0.5).normalize(), across = new Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const forward = new Vector3().crossVectors(across, up).normalize();
    const planet = new Vector3(), world = new Vector3(), sphere = new Sphere(), warped = new Sphere();
    let worst = -Infinity;
    for (const geometry of templates) {
      const bounds = sceneryBounds(geometry), positions = geometry.getAttribute('position'), kinds = geometry.getAttribute('aKind'), uv = geometry.getAttribute('uv');
      for (const radius of [40, 128, 400]) {
        const height = 0.37, scale = 1.3;
        placeScenerySphere(bounds, radius, up.x, up.y, up.z, height, scale, sphere);
        for (const k of [-0.48 / radius, 0, 2.83 / radius]) {
          const warp: WarpFrame = { focus: new Vector3(0, radius, 0), up: new Vector3(0, 1, 0), k };
          warpScenerySphere(sphere, warp, warped);
          for (const direction of [-1, 1]) for (let i = 0; i < positions.count; i++) {
            let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
            const material = kinds.getX(i);
            if (material === 1 || material === 3 || (material >= 7 && material <= 9)) x += direction * y * y * 0.0025;
            if (material === 1) z += direction * 0.04 * uv.getY(i) ** 2;
            if (material === 10) y += direction * Math.abs(x) * 0.65;
            x *= scale; y *= scale; z *= scale;
            const distance = Math.hypot(x, z), angle = Math.asin(Math.min(distance / radius, 0.9));
            planet.copy(up).multiplyScalar(Math.cos(angle));
            if (distance > 1e-5) planet.addScaledVector(across, x / distance * Math.sin(angle)).addScaledVector(forward, z / distance * Math.sin(angle));
            planet.multiplyScalar(radius + height + y);
            warpPoint(warp, planet, world);
            worst = Math.max(worst, world.distanceTo(warped.center) - warped.radius);
          }
        }
      }
      geometry.dispose();
    }
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('keeps complete placements through rejected, main and reflected camera passes', () => {
    const terrain = new Terrain(generateLayout(412));
    terrain.update(128, params, 0.5);
    const scenery = new CanyonScenery({}, terrain), original = placements(scenery);
    const populations = scenery.populationCounts.map(batch => batch.count), total = populations.reduce((sum, count) => sum + count, 0);
    const warp: WarpFrame = { focus: new Vector3(0, 128, 0), up: new Vector3(0, 1, 0), k: 0 };
    const camera = new PerspectiveCamera(10, 1.6, 0.1, 2000);
    camera.position.set(0, 0, 600); camera.lookAt(0, 0, 1000); camera.updateMatrixWorld();
    scenery.prepareView(camera, warp);
    expect(scenery.populationCounts.reduce((sum, batch) => sum + batch.visible, 0)).toBe(0);
    expect(scenery.populationCounts.map(batch => batch.count)).toEqual(populations);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    scenery.prepareView(camera, warp);
    const mainVisible = scenery.populationCounts.reduce((sum, batch) => sum + batch.visible, 0);
    expect(mainVisible).toBeGreaterThan(0);
    expect(mainVisible).toBeLessThan(total);
    const main = placements(scenery);
    camera.position.z = -600; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    scenery.prepareView(camera, warp);
    camera.position.z = 600; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    scenery.prepareView(camera, warp);
    // Compare only submitted ranges; rejected trailing buffer slots are irrelevant.
    for (const [i, child] of scenery.group.children.entries()) {
      const geometry = (child as Mesh<InstancedBufferGeometry>).geometry;
      const actual = placements(scenery)[i];
      let offset = 0;
      for (const name of ['aAnchor', 'aAcross', 'aPlacement']) {
        const attribute = geometry.getAttribute(name), end = offset + geometry.instanceCount * attribute.itemSize;
        expect(actual.slice(offset, end)).toEqual(main[i].slice(offset, end));
        offset += attribute.array.length;
      }
    }
    scenery.cullingEnabled = false;
    scenery.prepareView(camera, warp);
    expect(placements(scenery)).toEqual(original);
    expect(scenery.populationCounts.map(batch => batch.visible)).toEqual(populations);
    scenery.dispose();
  });
});
