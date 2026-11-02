import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CANYON_ROCK_SITE_LIMIT, generateCanyonRockSites } from '../life/canyonDistribution';

describe('Scarlet rock colony distribution', () => {
  it('repeats the same seed without retaining mutable state and changes for another seed', () => {
    const first = generateCanyonRockSites(412);
    const saved = JSON.stringify(first);
    expect(JSON.stringify(generateCanyonRockSites(412))).toBe(saved);
    expect(JSON.stringify(generateCanyonRockSites(413))).not.toBe(saved);
    first[0].direction.set(0, 0, 0);
    expect(JSON.stringify(generateCanyonRockSites(412))).toBe(saved);
  });

  it.each([1, 412, 771, 2026])('keeps seed %s finite, normalized and within the existing site budget', seed => {
    const sites = generateCanyonRockSites(seed);
    expect(sites.length).toBeGreaterThan(160);
    expect(sites.length).toBeLessThanOrEqual(CANYON_ROCK_SITE_LIMIT);
    for (const site of sites) {
      expect(site.direction.length()).toBeCloseTo(1, 12);
      expect(site.richness).toBeGreaterThanOrEqual(0);
      expect(site.richness).toBeLessThanOrEqual(1);
      expect(site.sizeHint).toBeGreaterThan(0.7);
      expect(site.sizeHint).toBeLessThan(1.3);
    }
  });

  it.each([1, 412, 771, 2026])('creates close colonies and broad empty regions for seed %s', seed => {
    const sites = generateCanyonRockSites(seed);
    const nearest = sites.map((site, i) => Math.acos(Math.min(1, Math.max(...sites.map((other, j) =>
      i === j ? -1 : site.direction.dot(other.direction)))))).sort((a, b) => a - b);
    // A regular 384-point sphere has ~0.17 rad neighbours. Most colony
    // members should be much closer, without duplicate roots at one point.
    expect(nearest[0]).toBeGreaterThanOrEqual(0.045 - 1e-10);
    expect(nearest[Math.floor(nearest.length / 2)]).toBeLessThan(0.085);

    // Probe coverage independently of the generator's basin definitions:
    // at least one open region must fit a 0.29-radian empty spherical cap.
    let widestGap = 0;
    const probe = new Vector3();
    for (let i = 0; i < 2048; i++) {
      const y = 1 - 2 * (i + 0.5) / 2048;
      const radius = Math.sqrt(1 - y * y), angle = i * 2.399963229728653;
      probe.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      const nearestSite = Math.max(...sites.map(site => probe.dot(site.direction)));
      widestGap = Math.max(widestGap, Math.acos(Math.min(1, nearestSite)));
    }
    expect(widestGap).toBeGreaterThan(0.29);
    const populations = new Map<number, number>();
    for (const site of sites) populations.set(site.cluster, (populations.get(site.cluster) ?? 0) + 1);
    expect(new Set(populations.values()).size).toBeGreaterThan(4);
  });
});
