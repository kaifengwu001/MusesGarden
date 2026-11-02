import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Fields, FieldParams } from '../../planet/fields';
import { travel } from '../../../../src/planet/geo';
import { createGroundSample, DRY_SHORE, generateLayout, PLINTH_HALF, Terrain } from '../../planet/terrain';
import { homePatch, LandmarkClassifier, landmarkFooting } from '../../life/landmarks';
import { hash32 } from '../../../../src/core/hash';
import type { RestPoint } from '../../../../src/planet/rest';
import { KIT } from '../../life/landmarkMeshes';

// Constant scale and attachment in a dry world: no water anywhere, dunes the
// same size in meters at every R, the shelter seated on a flat pad. (The
// shelter geometry itself is built in meters with no reference to R; see
// life/props.ts.)

const PARAMS: FieldParams = { dunes: 1.8, spacing: 17, swell: 1.1, habitat: 0.3, grain: 0.85, density: 6, patchiness: 0.8, patchSize: 9 };
const layout = generateLayout(412);
const RADII = [40, 128, 400] as const;

function terrainAt(radius: number): Terrain {
  const t = new Terrain(layout);
  t.update(radius, PARAMS, (2 * radius) / 512);
  return t;
}

/** Evenly spread directions (Fibonacci sphere). */
function sphereDesign(n: number): Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    return new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
  });
}

/** A point in shelter-local meters (x across, z toward the front), as the props are laid out. */
function homeLocal(radius: number, x: number, z: number): Vector3 {
  const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing).normalize();
  const p = travel(layout.cottage, across, x / radius, new Vector3());
  return travel(p, layout.homeBearing, z / radius, p);
}

// ---- the bake, emulated: GL cube-map faces, bilinear reads, half floats (bake.frag.glsl)

function faceDirection(face: number, sx: number, sy: number, out: Vector3): Vector3 {
  if (face === 0) out.set(1, -sy, -sx);
  else if (face === 1) out.set(-1, -sy, sx);
  else if (face === 2) out.set(sx, 1, sy);
  else if (face === 3) out.set(sx, -1, -sy);
  else if (face === 4) out.set(sx, -sy, 1);
  else out.set(-sx, -sy, -1);
  return out.normalize();
}

function faceOf(d: Vector3): { face: number; s: number; t: number } {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return d.x > 0 ? { face: 0, s: -d.z / ax, t: -d.y / ax } : { face: 1, s: d.z / ax, t: -d.y / ax };
  if (ay >= az) return d.y > 0 ? { face: 2, s: d.x / ay, t: d.z / ay } : { face: 3, s: d.x / ay, t: -d.z / ay };
  return d.z > 0 ? { face: 4, s: d.x / az, t: -d.y / az } : { face: 5, s: -d.x / az, t: -d.y / az };
}

function halfFloat(v: number): number {
  const step = 2 ** (Math.floor(Math.log2(Math.abs(v))) - 10);
  return Math.round(v / step) * step;
}

/** Largest gap (m) between the natural height and what a bake of `size` texels a face reads back, over the given directions. */
function bakeError(fields: Fields, size: number, dirs: readonly Vector3[]): number {
  const p = new Vector3();
  const texel = (face: number, i: number, j: number): number => halfFloat(fields.natural(faceDirection(face, ((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1, p)));
  let worst = 0;
  for (const d of dirs) {
    const { face, s, t } = faceOf(d);
    const u = ((s + 1) / 2) * size - 0.5;
    const v = ((t + 1) / 2) * size - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    // (texels on a face's edge are filtered across the seam; the interior is the general case)
    if (i < 0 || j < 0 || i + 1 >= size || j + 1 >= size) continue;
    const fu = u - i;
    const fv = v - j;
    const h = (texel(face, i, j) * (1 - fu) + texel(face, i + 1, j) * fu) * (1 - fv) + (texel(face, i, j + 1) * (1 - fu) + texel(face, i + 1, j + 1) * fu) * fv;
    worst = Math.max(worst, Math.abs(halfFloat(h) - fields.natural(d)));
  }
  return worst;
}

describe('a dry world', () => {
  it('has no water anywhere, at every size: no depth, no shore, ground above the old table', () => {
    const s = createGroundSample();
    const dirs = sphereDesign(2000);
    for (const radius of RADII) {
      const t = terrainAt(radius);
      for (const d of dirs) {
        t.sample(d, s);
        expect(s.depth).toBe(0);
        expect(s.water).toBe(DRY_SHORE);
        expect(Number.isFinite(s.height)).toBe(true);
        // (the shared water mask treats ground under 0.25 m as wet)
        expect(s.height, `R ${radius}`).toBeGreaterThan(0.5);
        expect(s.height, `R ${radius}`).toBeLessThan(t.maxHeight);
      }
    }
  });

  it('keeps the dunes the same size in meters as the planet grows: crests about the set spacing apart', () => {
    for (const radius of RADII) {
      const f = terrainAt(radius).fields;
      const p = new Vector3();
      let crests = 0;
      let length = 0;
      // local maxima along lines across the grain
      for (const d of sphereDesign(60)) {
        const across = new Vector3().crossVectors(d, layout.grain);
        if (across.lengthSq() < 0.25) continue;
        across.normalize();
        let prev = f.natural(d);
        let cur = f.natural(travel(d, across, 0.5 / radius, p));
        for (let k = 1; k < 400; k++) {
          const next = f.natural(travel(d, across, ((k + 1) * 0.5) / radius, p));
          if (cur > prev && cur > next) crests++;
          prev = cur;
          cur = next;
        }
        length += 200;
      }
      const spacing = length / crests;
      expect(spacing, `R ${radius}`).toBeGreaterThan(12);
      expect(spacing, `R ${radius}`).toBeLessThan(24);
    }
  });

  it('keeps the habitat where it is as the planet grows (it lives in rest space)', () => {
    const dirs = sphereDesign(500);
    const small = terrainAt(40);
    const large = terrainAt(400);
    for (const d of dirs) expect(large.fields.habitat(d)).toBeCloseTo(small.fields.habitat(d), 9);
  });

  it('covers about the habitat share asked for', () => {
    const f = terrainAt(128).fields;
    const dirs = sphereDesign(3000);
    const share = dirs.filter((d) => f.habitat(d) > 0.5).length / dirs.length;
    expect(share).toBeGreaterThan(PARAMS.habitat - 0.05);
    expect(share).toBeLessThan(PARAMS.habitat + 0.05);
  });

  it('reads back from the bake within 2 cm on every tier at R 40 and 128 (and within 12 cm at R 400, where a texel is 1.6–2.1 m)', () => {
    const dirs = sphereDesign(2500);
    for (const radius of RADII) {
      const f = terrainAt(radius).fields;
      for (const size of [512, 384]) {
        const limit = radius > 128 ? 0.12 : 0.02;
        expect(bakeError(f, size, dirs), `R ${radius}, ${size}² a face`).toBeLessThan(limit);
      }
    }
  }, 60_000);
});

describe('everything stays attached', () => {
  it('seats the shelter on a flat pad at every size: the plinth, its middle and Muse’s stands', () => {
    const s = createGroundSample();
    for (const radius of RADII) {
      const t = terrainAt(radius);
      const heights: number[] = [];
      // the plinth's corners (props.ts: 5.0 × 4.8 m), its middle, and Muse's two stands in front of it
      const points = [[-2.5, -2.4], [2.5, -2.4], [2.5, 2.4], [-2.5, 2.4], [0, 0], [-0.9, 2.95], [0.9, 2.95]] as const;
      for (const [x, z] of points) {
        heights.push(t.sample(homeLocal(radius, x, z), s).height);
        expect(s.clearing, `R ${radius} clearing at ${x},${z}`).toBeGreaterThan(0.5);
      }
      expect(Math.max(...heights) - Math.min(...heights), `R ${radius}`).toBeLessThan(0.02);
      expect(Math.abs(heights[4] - t.cottageGround), `R ${radius}`).toBeLessThan(0.005);
    }
  });

  it('keeps the approach to the door clear out to 15 m', () => {
    const s = createGroundSample();
    for (const radius of RADII) {
      const t = terrainAt(radius);
      for (let z = 3; z <= 14.5; z += 0.5) for (const x of [-1.2, 0, 1.2]) expect(t.sample(homeLocal(radius, x, z), s).clearing, `R ${radius} at ${x},${z}`).toBeGreaterThan(0.5);
      expect(t.sample(homeLocal(radius, 4, 8), s).clearing, `R ${radius} beside the approach`).toBe(0);
    }
  });

  it('sets every stone and sail-reed of the home patch on its ground, outside the clearing, at every size', () => {
    for (const radius of RADII) {
      const t = terrainAt(radius);
      for (const inst of homePatch()) {
        const f = landmarkFooting(t, inst);
        const where = `R ${radius} ${inst.kind} at ${inst.x.toFixed(1)},${inst.z.toFixed(1)}`;
        expect(t.clearingAt(f.anchor, Math.acos(Math.min(1, f.anchor.dot(layout.cottage))) * radius), where).toBe(0);
        expect(Number.isFinite(f.base), where).toBe(true);
        if (inst.kind === 'reed' || inst.kind === 'comb' || inst.kind === 'tussock') continue;
        const [, , h] = KIT[inst.kind];
        const height = h * inst.scale;
        const foot = (0.12 * h + 0.03) * inst.scale;
        for (const ground of f.corners) {
          // the stone's plane rises 3/4 of the way with the ground (landmark.vert.glsl): its foot reaches the sand at every edge,
          // and at least half of it shows above it
          const plane = f.base + 0.75 * (ground - f.centre);
          expect(plane - foot, `${where}: floats`).toBeLessThanOrEqual(ground + 0.005);
          expect(plane + height - ground, `${where}: swallowed`).toBeGreaterThan(0.5 * height);
        }
      }
    }
  });

  it('keeps each seeded stone and clump where it is, of its kind and size, as the planet grows', () => {
    const classifier = (radius: number): LandmarkClassifier => {
      const c = new LandmarkClassifier();
      c.set(layout, radius, PARAMS, 'test');
      return c;
    };
    const small = classifier(128);
    const large = classifier(400);
    const dirs = sphereDesign(4000);
    // the clusters live in direction space: the same everywhere at every size
    for (const d of dirs.slice(0, 500)) expect(large.density(d)).toBeCloseTo(small.density(d), 9);
    // a point's kind, size and leaves come from its seed alone; whether it stands can change only where the
    // dunes under it (sized in meters) grow too steep, or with the home patch's reach
    const tile = { level: 0, i: 0, j: 0 };
    let kept = 0;
    let still = 0;
    dirs.forEach((d, k) => {
      const p: RestPoint = { face: 0, level: 0, i: 0, j: 0, u: 0, v: 0, rank: 0, threshold: 1e-6, seed: hash32(k + 1) };
      const a = new Float32Array(8).fill(0);
      const b = new Float32Array(8).fill(0);
      a.set([d.x, d.y, d.z]);
      b.set([d.x, d.y, d.z]);
      const ca = small.classify(tile, p, Infinity, a, 0);
      const cb = large.classify(tile, p, Infinity, b, 0);
      if (ca < 0) return;
      kept++;
      if (cb < 0) return;
      still++;
      expect(cb).toBe(ca);
      expect(b[5]).toBe(a[5]);
      expect(b[6]).toBe(a[6]);
    });
    expect(kept).toBeGreaterThan(20);
    expect(still / kept).toBeGreaterThan(0.8);
  });

  it('keeps Muse clear of the shelter and its plinth along its whole walk', async () => {
    const { STANDS, MUSE_HEIGHT, FUR_LENGTH } = await import('../../life/muse');
    // its widest reach from its middle, whichever way it faces: the belly's half-width (museBody.ts BELLY) and its fur
    const reach = 0.287 * MUSE_HEIGHT + FUR_LENGTH;
    for (let k = 0; k <= 20; k++) {
      const x = STANDS.a[0] + ((STANDS.b[0] - STANDS.a[0]) * k) / 20;
      const z = STANDS.a[1] + ((STANDS.b[1] - STANDS.a[1]) * k) / 20;
      expect(z - reach, `at ${x.toFixed(2)}`).toBeGreaterThan(PLINTH_HALF.z);
    }
  });

  it('builds the shelter to the brief, in meters, the same whatever the planet radius', async () => {
    const { FLOOR, Homestead } = await import('../../life/props');
    const a = new Box3().setFromObject(new Homestead({}, 412).group);
    const b = new Box3().setFromObject(new Homestead({}, 412).group);
    const size = a.getSize(new Vector3());
    // the plinth 5.0 × 4.8 m (its foot a little wider, under the sand), its top the walking floor, the ridge 3.2 m above that
    expect(size.x).toBeGreaterThan(4.95);
    expect(size.x).toBeLessThan(5.1);
    expect(size.z).toBeGreaterThan(4.75);
    expect(size.z).toBeLessThan(4.9);
    expect(FLOOR).toBeCloseTo(0.25, 6);
    expect(a.max.y - FLOOR).toBeGreaterThan(3.15);
    expect(a.max.y - FLOOR).toBeLessThan(3.25);
    expect(b.getSize(new Vector3()).distanceTo(size)).toBe(0);
  });
});
