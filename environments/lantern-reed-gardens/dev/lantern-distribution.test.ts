import { describe, expect, it } from 'vitest';
import { Vector3, Mesh, DoubleSide, MeshBasicMaterial, Raycaster } from 'three';
import { lanternRegions, regionDirection } from '../life/lanternDistribution';
import { remoteRockGeometry } from '../life/remoteRockGeometry';
import { generateLayout } from '../planet/terrain';

describe('Lantern remote regions', () => {
  for (const seed of [1, 412, 771, 2026]) it(`covers every side with unequal deterministic regions at seed ${seed}`, () => {
    const { cottage, homeBearing } = generateLayout(seed);
    const regions = lanternRegions(seed, cottage, homeBearing);
    expect(regions).toEqual(lanternRegions(seed, cottage, homeBearing));
    expect(regions.length).toBeGreaterThan(85);
    expect(regions.length).toBeLessThanOrEqual(128);
    expect(new Set(regions.map(r => r.rockKind)).size).toBe(3);
    const east = new Vector3().crossVectors(cottage, homeBearing);
    for (const axis of [cottage, homeBearing, east]) for (const sign of [-1, 1]) {
      expect(regions.filter(r => r.centre.dot(axis) * sign > 0.5).length).toBeGreaterThan(12);
    }
    const richness = regions.map(r => r.richness);
    expect(Math.max(...richness) - Math.min(...richness)).toBeGreaterThan(0.7);
    for (const region of regions) {
      expect(region.centre.length()).toBeCloseTo(1, 10);
      expect(region.centre.dot(cottage)).toBeLessThanOrEqual(Math.cos(0.45));
      expect(region.across.dot(region.centre)).toBeCloseTo(0, 10);
      const direction = regionDirection(region, region.extent, -region.extent);
      expect(direction.length()).toBeCloseTo(1, 10);
      expect(direction.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(regions).not.toEqual(lanternRegions(seed + 1, cottage, homeBearing));
  });

  it('keeps planted rock caps solid and all three geological profiles distinct', () => {
    const profiles: number[] = [];
    for (let variant = 0; variant < 3; variant++) {
      const geometry = remoteRockGeometry(variant);
      const position = geometry.getAttribute('position'), kind = geometry.getAttribute('aKind');
      let low = Infinity, high = -Infinity;
      // Compare the geological profiles independently of their living crowns.
      for (let i = 0; i < position.count; i++) if (kind.getX(i) === 2 || kind.getX(i) === 13) {
        low = Math.min(low, position.getY(i)); high = Math.max(high, position.getY(i));
      }
      profiles.push(high - low);
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < normal.count; i++) expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      // A ray from above must hit the mineral cap at the central planted root.
      const height = [5.7, 14.5, 2.8][variant];
      const x = height * (variant === 1 ? 0.09 : 0.025);
      const material = new MeshBasicMaterial({ side: DoubleSide });
      const mesh = new Mesh(geometry, material);
      const hits = new Raycaster(new Vector3(x, height + 0.01, Math.sin(7.2) * 0.16), new Vector3(0, -1, 0), 0, 0.02).intersectObject(mesh);
      expect(hits.length).toBeGreaterThan(0);
      geometry.dispose(); material.dispose();
    }
    expect(profiles[1]).toBeGreaterThan(profiles[0] * 1.5);
    expect(profiles[0]).toBeGreaterThan(profiles[2]);
  });
});
