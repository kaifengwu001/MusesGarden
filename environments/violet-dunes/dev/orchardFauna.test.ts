import { Box3, Mesh, ShaderMaterial, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { OrchardFauna } from '../life/orchardFauna';
import { duneSkipperRig, seedGliderRig } from '../life/orchardFaunaGeometry';
import { ORCHARD_FAUNA_ANCHORS, OrchardFaunaMotion, orchardDirection } from '../life/orchardFaunaMotion';
import { generateLayout, Terrain } from '../planet/terrain';

const PARAMS = { dunes: 1.8, spacing: 17, swell: 1.1, habitat: 0.3, grain: 0.85, density: 6, patchiness: 0.8, patchSize: 9 };

function terrainAt(radius: number, seed = 412): Terrain {
  const terrain = new Terrain(generateLayout(seed));
  terrain.update(radius, PARAMS, 2 * radius / 512);
  return terrain;
}

describe('Paper Orchard native fauna', () => {
  it('keeps the quadruped and two-wing anatomy distinct from Muse', () => {
    const material = new ShaderMaterial();
    const skipper = duneSkipperRig(material), glider = seedGliderRig(material);
    expect(skipper.anatomy).toEqual({ feet: 4, wings: 0, eyes: 2, ears: 2, tails: 1 });
    expect(skipper.feet).toHaveLength(4);
    expect(glider.anatomy.wings).toBe(2);
    expect(glider.wings).toHaveLength(2);
    skipper.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(skipper.root), size = box.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(size.y);
    expect(size.z).toBeLessThan(1.2);
    for (const rig of [skipper, glider]) for (const mesh of rig.meshes) {
      const p = mesh.geometry.getAttribute('position');
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.getAttribute('aColour').count).toBe(p.count);
      expect(mesh.geometry.getAttribute('aKind').count).toBe(p.count);
      mesh.geometry.dispose();
    }
    material.dispose();
  });

  it('repeats frozen motion and preserves support through radius roundtrips', () => {
    const terrain = terrainAt(128);
    const motion = new OrchardFaunaMotion(ORCHARD_FAUNA_ANCHORS[0], 0);
    const before = motion.at(12, terrain), direction = before.dir.clone(), height = before.height;
    motion.at(36, terrain);
    const repeated = motion.at(12, terrain);
    expect(repeated.dir.distanceTo(direction)).toBeLessThan(1e-12);
    expect(repeated.height).toBe(height);
    for (const radius of [40, 400, 128]) {
      terrain.update(radius, PARAMS, 2 * radius / 512);
      const p = motion.at(12, terrain);
      expect(p.dir.length()).toBeCloseTo(1, 12);
      expect(p.height).toBeCloseTo(terrain.height(p.dir), 10);
      expect(Math.abs(p.dir.dot(p.heading))).toBeLessThan(1e-9);
    }
    expect(motion.at(12, terrain).dir.distanceTo(direction)).toBeLessThan(1e-12);
  });

  it('lands gliders over actual matching stems and keeps seven finite poses', () => {
    const terrain = terrainAt(128);
    const fauna = new OrchardFauna({}, terrain);
    expect(fauna.snapshot()).toHaveLength(7);
    for (const radius of [40, 128, 400]) {
      terrain.update(radius, PARAMS, 2 * radius / 512);
      fauna.invalidate();
      for (const t of [0, 12, 25, 48]) {
        fauna.update(t, terrain);
        for (const s of fauna.snapshot()) {
          expect(s.finite).toBe(true);
          if (s.kind === 'dune-skipper') {
            expect(s.clearance).toBe(0);
            expect(s.maxFootPenetration).toBeLessThan(0.02);
          } else expect(s.clearance).toBeGreaterThan(1.5);
        }
      }
    }
    const anchor = ORCHARD_FAUNA_ANCHORS.find((a) => a.perch)!;
    const motion = new OrchardFaunaMotion(anchor, 3);
    let found = false;
    for (let t = 0; t < 80; t++) {
      const p = motion.at(t, terrain);
      if (p.perched > 0.999) {
        expect(p.dir.distanceTo(motion.perchDirection(terrain))).toBeLessThan(1e-10);
        expect(p.height - terrain.height(p.dir)).toBeCloseTo(anchor.lift! + anchor.scale * 0.055, 9);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    expect(fauna.focus('dune-skipper')).not.toBeNull();
    expect(fauna.focus('seed-glider')).not.toBeNull();
    expect(fauna.focus('unknown')).toBeNull();
    fauna.dispose();
  });

  it('uses the same source geometry and exact animated matrices for shadows', () => {
    const terrain = terrainAt(128), fauna = new OrchardFauna({}, terrain);
    fauna.update(17.5, terrain);
    expect(fauna.shadowMeshes.length).toBeGreaterThan(20);
    const matrices = new Set<string>();
    fauna.group.traverse((o) => {
      if ('geometry' in o) matrices.add(o.matrixWorld.elements.join(','));
    });
    for (const shadow of fauna.shadowMeshes) expect(matrices.has(shadow.matrix.elements.join(','))).toBe(true);
    const origin = orchardDirection(terrain, 0, 0);
    expect(origin.distanceTo(terrain.layout.cottage)).toBeLessThan(1e-12);
    fauna.dispose();
  });

  it('supports the actual lower foot vertices rather than only the root anchor', () => {
    const terrain = terrainAt(128), fauna = new OrchardFauna({}, terrain), point = new Vector3();
    for (const radius of [40, 128, 400]) {
      terrain.update(radius, PARAMS, 2 * radius / 512);
      fauna.invalidate();
      for (const time of [0, 12, 25]) {
        fauna.update(time, terrain);
        fauna.group.traverse((object) => {
          if (!(object instanceof Mesh) || object.name !== 'Dune Skipper padded foot') return;
          const geometry = object.geometry as BufferGeometry;
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            if (positions.getY(i) > 0.015) continue;
            point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
            const radialHeight = point.length() - radius;
            const supportHeight = terrain.height(point.normalize());
            expect(supportHeight - radialHeight).toBeLessThan(0.04);
          }
        });
      }
    }
    fauna.dispose();
  });
});
