import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Veil, VEIL, veilSeed, veilTurn } from '../../life/veil';
import { DEFAULT_GROWTH, schema } from '../../params';
import { FIRST_PLANET } from '../../planet/firstPlanet';
import { travel } from '../../planet/geo';
import { generateLayout } from '../../planet/terrain';
import { unfoldBloom, unfoldGrowth, UNVEILED, unveiling } from '../../planet/unfold';
import { CameraRig } from '../../view/camera';

function veilOf(seed: number): { veil: Veil; hut: Vector3; noise: number } {
  const hut = generateLayout(seed).cottage;
  const veil = new Veil();
  veil.build(seed, hut);
  return { veil, hut, noise: veilSeed(seed) };
}

/** Bearings round the hut: unit tangents there, evenly spread. */
function bearings(hut: Vector3, n: number): Vector3[] {
  const a = new Vector3().crossVectors(hut, Math.abs(hut.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
  const b = new Vector3().crossVectors(hut, a);
  return Array.from({ length: n }, (_, i) => a.clone().multiplyScalar(Math.cos((i / n) * 2 * Math.PI)).addScaledVector(b, Math.sin((i / n) * 2 * Math.PI)));
}

/** How far out from the hut (m at R 128) the clearing first meets the fog along a bearing, at an unveiling. */
function edgeAlong(hut: Vector3, along: Vector3, noise: number, turn: number): number {
  const p = new Vector3();
  for (let m = 1; m < Math.PI * 128; m += 1) if (veilTurn(travel(hut, along, m / 128, p), hut, noise) > turn) return m;
  return Math.PI * 128;
}

describe('the unfolding (planet/unfold.ts)', () => {
  it('leaves the first planet as tuned by default: unveiled, all in flower, at R 128 m (see CLAUDE.md)', () => {
    expect(schema.world.unfold.def).toBe(UNVEILED);
    expect(unveiling(UNVEILED)).toBe(1);
    // (so the bloom is the season's own: Math.min(bloom, 1) is bloom, to the bit)
    expect(unfoldBloom(UNVEILED)).toBe(1);
    expect(unfoldGrowth(UNVEILED)).toBe(DEFAULT_GROWTH);
    expect(FIRST_PLANET.growth).toBe(DEFAULT_GROWTH);
  });

  it('starts under the veil with no flowers, at the meadow’s tuned size', () => {
    expect(unveiling(0)).toBe(0);
    expect(unfoldBloom(0)).toBe(0);
    for (let i = 0; i <= 50; i++) expect(unfoldGrowth((i / 50) * UNVEILED)).toBe(FIRST_PLANET.growth);
  });

  it('unveils and brings the flowers out steadily, then grows the planet to the largest', () => {
    let veil = -Infinity;
    let bloom = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const u = (i / 100) * UNVEILED;
      expect(unveiling(u)).toBeGreaterThan(veil);
      expect(unfoldBloom(u)).toBeGreaterThan(bloom);
      veil = unveiling(u);
      bloom = unfoldBloom(u);
    }
    let g = unfoldGrowth(UNVEILED);
    for (let i = 1; i <= 100; i++) {
      const u = UNVEILED + (i / 100) * (1 - UNVEILED);
      expect(unfoldGrowth(u)).toBeGreaterThan(g);
      expect(unveiling(u)).toBe(1);
      g = unfoldGrowth(u);
    }
    expect(unfoldGrowth(1)).toBe(1);
  });
});

describe('the veil (life/veil.ts)', () => {
  it('lays out the same veil for the same planet', () => {
    const a = veilOf(412);
    const b = veilOf(412);
    for (const s of [0, 0.1, 0.37, 0.8, 0.999]) expect(a.veil.threshold(s)).toBe(b.veil.threshold(s));
    const d = new Vector3(0.3, -0.5, 0.81).normalize();
    expect(veilTurn(d, a.hut, a.noise)).toBe(veilTurn(d, b.hut, b.noise));
  });

  it('covers all of the planet but a little ground round the hut, before anything unfolds', () => {
    for (const seed of [412, 7, 2024]) {
      const { veil, hut, noise } = veilOf(seed);
      const turn = veil.threshold(0);
      // the ground round the hut is clear, and the planet's share of clear ground is what VEIL.clear asks
      for (const along of bearings(hut, 16)) expect(veilTurn(travel(hut, along, (0.9 * VEIL.core) / 128, new Vector3()), hut, noise)).toBeLessThan(turn);
      expect(veil.share(turn)).toBeCloseTo(VEIL.clear, 2);
    }
  });

  it('clears for good by the time the planet is unveiled, and only ever clears', () => {
    const { veil } = veilOf(412);
    expect(veil.threshold(1)).toBe(Number.POSITIVE_INFINITY);
    let last = -Infinity;
    for (let i = 0; i < 200; i++) {
      const turn = veil.threshold(i / 200);
      expect(turn).toBeGreaterThanOrEqual(last);
      last = turn;
    }
    expect(veil.share(veil.threshold(0.999))).toBeGreaterThan(0.995);
  });

  it('moves its edge out from the hut at an even pace', () => {
    const { veil } = veilOf(412);
    const first = Math.acos(1 - 2 * VEIL.clear);
    for (let i = 0; i <= 20; i++) {
      const s = (i / 20) * 0.98;
      // the clear share, as the angle of a cap round the hut holding as much
      const angle = Math.acos(1 - 2 * veil.share(veil.threshold(s)));
      expect(angle).toBeCloseTo(first + (Math.PI - first) * s, 1);
    }
  });

  it('clears out from the hut raggedly: in bays and fingers, islands lingering and holes opening, not in rings', () => {
    const { veil, hut, noise } = veilOf(412);
    for (const s of [0.15, 0.3, 0.5]) {
      const turn = veil.threshold(s);
      const edges = bearings(hut, 64).map((along) => edgeAlong(hut, along, noise, turn));
      // along some bearings the edge lies tens of meters nearer the hut than along others (a ring: a meter or so)
      expect(Math.max(...edges) - Math.min(...edges)).toBeGreaterThan(25);
    }
    // nearer the hut is clearer by and large, but not always: some places clear before others nearer to it
    const p = new Vector3();
    let behind = 0;
    let pairs = 0;
    for (const along of bearings(hut, 32)) {
      for (let m = 40; m < 300; m += 6) {
        const near = veilTurn(travel(hut, along, m / 128, p), hut, noise);
        const out = veilTurn(travel(hut, along, (m + 6) / 128, p), hut, noise);
        pairs++;
        if (out < near) behind++;
      }
    }
    expect(behind / pairs).toBeGreaterThan(0.05);
    expect(behind / pairs).toBeLessThan(0.45);
  });
});

describe('the camera as the planet grows under it (CameraRig.holdThrough)', () => {
  const ground = (): number => 0;

  it('holds its distance from the centre in orbit, so the planet grows in the window', () => {
    const rig = new CameraRig();
    rig.setZoom(0, true);
    rig.update(1 / 60, 128, 1.6, ground);
    const before = rig.camera.position.length();
    let r = 128;
    for (const next of [150, 200, 260, 330, 400]) {
      rig.holdThrough(r, next);
      rig.update(1 / 60, next, 1.6, ground);
      r = next;
      expect(rig.camera.position.length()).toBeCloseTo(before, 6);
    }
    // and back: at R 128 it is in orbit as it was
    for (const next of [330, 200, 128]) {
      rig.holdThrough(r, next);
      rig.update(1 / 60, next, 1.6, ground);
      r = next;
    }
    expect(rig.zoom).toBeCloseTo(0, 9);
    expect(rig.camera.position.length()).toBeCloseTo(before, 6);
  });

  it('keeps its height over the meadow at the bird’s-eye and standing stops', () => {
    for (const zoom of [0.35, 0.8301, 1]) {
      const rig = new CameraRig();
      rig.setZoom(zoom, true);
      rig.update(1 / 60, 128, 1.6, ground);
      const height = rig.altitude;
      rig.holdThrough(128, 400);
      rig.update(1 / 60, 400, 1.6, ground);
      expect(rig.altitude).toBeCloseTo(height, 6);
    }
  });
});
