import { describe, expect, it } from 'vitest';
import { Box3, Sphere, Vector3 } from 'three';
import { homePatch, LANDMARK_REACH, LandmarkClassifier, SEEDED } from '../life/landmarks';
import { KIT, KIT_KINDS, KIT_MESH } from '../life/landmarkMeshes';
import { scatterTileBounds } from '../life/scatter';
import { warpForZoom, warpPoint } from '../../../src/render/warp';
import { generateLayout, gradientFrame, Terrain } from '../planet/terrain';
import type { RestPoint } from '../../../src/planet/rest';
import type { FieldParams } from '../planet/fields';

describe('orchard asset and placement contracts', () => {
  it('draws each thin surface once and omits collapsed tip or pole triangles', () => {
    for (const kind of KIT_KINDS) {
      const geometry = KIT_MESH[kind]();
      const positions = geometry.getAttribute('position');
      const indices = geometry.index!;
      const faces = new Set<string>();
      for (let i = 0; i < indices.count; i += 3) {
        const points = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(positions, indices.getX(i + k)));
        const area = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).length();
        expect(area, `${kind} triangle ${i / 3} has positive area`).toBeGreaterThan(1e-10);
        const key = points.map((p) => p.toArray().map((v) => Math.round(v * 1e6)).join(',')).sort().join('|');
        expect(faces.has(key), `${kind} triangle ${i / 3} repeats a double-sided face`).toBe(false);
        faces.add(key);
      }
      geometry.dispose();
    }
  });

  it('keeps papery husks ovoid around a visible fruit rather than broad flared bells', () => {
    const geometry = KIT_MESH.reed();
    const positions = geometry.getAttribute('position');
    const parts = geometry.getAttribute('aPart');
    const indices = geometry.index!;
    const parent = new Map<string, string>();
    const vertices = new Map<string, Vector3>();
    const root = (key: string): string => {
      const p = parent.get(key)!;
      if (p !== key) parent.set(key, root(p));
      return parent.get(key)!;
    };
    const fruit = new Box3();
    for (let i = 0; i < indices.count; i += 3) {
      const ids = [0, 1, 2].map((k) => indices.getX(i + k));
      if (parts.getX(ids[0]) === 4) for (const id of ids) fruit.expandByPoint(new Vector3().fromBufferAttribute(positions, id));
      if (!ids.every((id) => parts.getX(id) === 3)) continue;
      const keys = ids.map((id) => {
        const p = new Vector3().fromBufferAttribute(positions, id);
        const key = p.toArray().map((v) => Math.round(v * 1e6)).join(',');
        if (!parent.has(key)) parent.set(key, key);
        vertices.set(key, p);
        return key;
      });
      parent.set(root(keys[1]), root(keys[0]));
      parent.set(root(keys[2]), root(keys[0]));
    }
    const husks = new Map<string, Box3>();
    for (const [key, p] of vertices) {
      const r = root(key);
      if (!husks.has(r)) husks.set(r, new Box3());
      husks.get(r)!.expandByPoint(p);
    }
    expect(husks.size).toBeGreaterThanOrEqual(2);
    for (const box of husks.values()) {
      const size = box.getSize(new Vector3());
      expect(size.y).toBeGreaterThan(Math.max(size.x, size.z) * 1.05);
      expect(size.y).toBeLessThan(Math.max(size.x, size.z) * 1.8);
    }
    expect(fruit.isEmpty()).toBe(false);
    expect([...husks.values()].some((box) => box.clone().expandByScalar(0.015).containsBox(fruit))).toBe(true);
    geometry.dispose();
  });

  it('forms a dominant connected left bank with three visible height layers and quieter right ground', () => {
    const plants = homePatch().filter((p) => p.kind === 'reed' || p.kind === 'comb' || p.kind === 'tussock');
    const left = plants.filter((p) => p.x > -14 && p.x < -4 && p.z > 2 && p.z < 18);
    const right = plants.filter((p) => p.x > 4 && p.x < 14 && p.z > 2 && p.z < 18);
    expect(left.length).toBeGreaterThan(right.length * 2);
    for (const z of [3, 7, 11, 15]) expect(left.filter((p) => Math.abs(p.z - z) < 2).length).toBeGreaterThan(10);
    const height = (p: typeof plants[number]): number => KIT[p.kind][2] * p.scale;
    expect(plants.filter((p) => height(p) < 0.9).length).toBeGreaterThan(80);
    expect(plants.filter((p) => height(p) >= 0.9 && height(p) < 2).length).toBeGreaterThan(15);
    expect(plants.filter((p) => height(p) >= 2.8).length).toBeGreaterThan(15);
  });

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
