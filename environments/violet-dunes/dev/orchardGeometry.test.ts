import { describe, expect, it } from 'vitest';
import { Sphere, Vector3 } from 'three';
import { homePatch, LANDMARK_REACH, LandmarkClassifier, SEEDED } from '../life/landmarks';
import { KIT, KIT_KINDS, KIT_MESH } from '../life/landmarkMeshes';
import { scatterTileBounds } from '../life/scatter';
import { warpForZoom, warpPoint } from '../../../src/render/warp';
import { generateLayout, gradientFrame, Terrain } from '../planet/terrain';
import type { RestPoint } from '../../../src/planet/rest';
import type { FieldParams } from '../planet/fields';

describe('orchard asset and placement contracts', () => {
  it('keeps source assets finite and inside their physical height bounds', () => {
    for (const kind of KIT_KINDS) {
      const geometry = KIT_MESH[kind]();
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const part = geometry.getAttribute('aPart');
      expect(position.count).toBeGreaterThan(0);
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
        expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
        expect(position.getY(i)).toBeLessThanOrEqual(KIT[kind][2] + 0.025);
        expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(KIT[kind][0] / 2 + 0.025);
        expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(KIT[kind][1] / 2 + 0.025);
        expect(part.getX(i)).toBeGreaterThanOrEqual(0);
        expect(part.getX(i)).toBeLessThanOrEqual(6);
      }
      geometry.dispose();
    }
  });

  it('contains real calyx and fruit surfaces alongside thin orchard foliage', () => {
    const geometry = KIT_MESH.reed();
    const parts = geometry.getAttribute('aPart');
    const present = new Set(Array.from({ length: parts.count }, (_, i) => parts.getX(i)));
    expect(present).toEqual(new Set([1, 2, 3, 4]));
    geometry.dispose();
  });

  it('rejects a steep authored dune even when its natural field is flat', () => {
    const layout = generateLayout(412);
    const radius = Math.exp(Math.round(Math.log(128) / 0.04) * 0.04);
    const params: FieldParams = { dunes: 0, spacing: 17, swell: 0, habitat: 1, grain: 0.85, density: 6, patchiness: 0.8, patchSize: 9 };
    const terrain = new Terrain(layout);
    terrain.update(radius, params, 1);
    const classifier = new LandmarkClassifier();
    classifier.set(layout, 128, params, 'flat-natural-authored-dunes');
    expect(classifier.maxGroundHeight).toBe(terrain.maxHeight);
    const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing).normalize();
    const a = new Vector3();
    const b = new Vector3();
    const slope = (dir: Vector3, height: (d: Vector3) => number): number => {
      gradientFrame(dir, a, b);
      const delta = (axis: Vector3): number => height(dir.clone().addScaledVector(axis, 1 / radius).normalize()) - height(dir.clone().addScaledVector(axis, -1 / radius).normalize());
      return Math.hypot(delta(a), delta(b)) / 2;
    };
    let candidate: Vector3 | null = null;
    // Outside the authored home patch, search the planted edge of the first large dune.
    for (let x = 20; x <= 40 && !candidate; x++) for (let z = -8; z >= -44 && !candidate; z--) {
      const dir = layout.cottage.clone().multiplyScalar(Math.sqrt(1 - (x * x + z * z) / (radius * radius))).addScaledVector(across, x / radius).addScaledVector(layout.homeBearing, z / radius).normalize();
      if (classifier.density(dir) > 1e-5 && slope(dir, (d) => terrain.height0(d)) > SEEDED.slope + 0.04) candidate = dir;
    }
    expect(candidate).not.toBeNull();
    expect(slope(candidate!, (d) => terrain.fields.natural(d))).toBeLessThan(0.01);
    expect(slope(candidate!, (d) => terrain.height0(d))).toBeGreaterThan(SEEDED.slope);
    const point: RestPoint = { face: 0, level: 0, i: 0, j: 0, u: 0, v: 0, rank: 0, threshold: 1e-12, seed: 123 };
    const record = new Float32Array(8);
    record.set(candidate!.toArray());
    expect(classifier.classify({ level: 0, i: 0, j: 0 }, point, Infinity, record, 0)).toBe(-1);
    // A flat, planted site beyond the authored ridges remains eligible.
    let accepted = false;
    for (let i = 0; i < 400 && !accepted; i++) {
      const y = 1 - (i + 0.5) / 200;
      const r = Math.sqrt(1 - y * y);
      const dir = new Vector3(Math.cos(i * 2.39996) * r, y, Math.sin(i * 2.39996) * r);
      if (Math.acos(Math.min(1, dir.dot(layout.cottage))) * radius < 120) continue;
      record.set(dir.toArray());
      accepted = classifier.classify({ level: 0, i: 0, j: 0 }, point, Infinity, record, 0) >= 0;
    }
    expect(accepted).toBe(true);
  });

  it('keeps elevated, wind-displaced landmarks inside tile bounds through growth and camera warp', () => {
    const centre = new Vector3(0.24, 0.93, 0.28).normalize();
    const across = new Vector3().crossVectors(centre, new Vector3(0, 0, 1)).normalize();
    const forward = new Vector3().crossVectors(across, centre).normalize();
    const alpha = 0.28;
    const terrainHeight = 12;
    const bounds = new Sphere();
    for (const radius of [40, 128, 400]) for (const zoom of [0, 0.6, 1]) {
      const warp = { focus: new Vector3(0, radius, 0), up: new Vector3(0, 1, 0), k: warpForZoom(zoom, radius, radius * 0.3) };
      scatterTileBounds(centre, alpha, radius, terrainHeight + LANDMARK_REACH, warp, bounds);
      for (let ring = 0; ring <= 4; ring++) for (let i = 0; i < 20; i++) {
        const angle = i / 20 * Math.PI * 2;
        const radial = alpha * ring / 4;
        const tangent = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(forward, Math.sin(angle));
        const anchor = centre.clone().multiplyScalar(Math.cos(radial)).addScaledVector(tangent, Math.sin(radial));
        for (const height of [0, terrainHeight]) for (const offset of [centre, across, forward]) {
          const p = anchor.clone().multiplyScalar(radius + height).addScaledVector(offset, LANDMARK_REACH);
          warpPoint(warp, p, p);
          expect(bounds.containsPoint(p), `R${radius} zoom${zoom} ring${ring}`).toBe(true);
        }
      }
    }
  });

  it('composes all plant families around an unblocked entrance, approach and animal pockets', () => {
    const patch = homePatch();
    expect(homePatch()).toEqual(patch);
    expect(new Set(patch.map((p) => p.kind))).toEqual(new Set(KIT_KINDS));
    for (const p of patch) {
      expect(Number.isFinite(p.x + p.z + p.scale + p.yaw)).toBe(true);
      expect(p.scale).toBeGreaterThan(0);
      expect(Math.abs(p.x) < 2.3 && p.z > -2.8 && p.z < 23).toBe(false);
      for (const [x, z] of [[-4.6, 5.6], [5.4, 9.8], [-8, 13]]) {
        expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThanOrEqual(1);
      }
    }
    let triangles = 0;
    for (const kind of KIT_KINDS) {
      const geometry = KIT_MESH[kind]();
      triangles += geometry.index!.count / 3 * patch.filter((p) => p.kind === kind).length;
      geometry.dispose();
    }
    expect(triangles).toBeLessThan(300_000);
  });
});
