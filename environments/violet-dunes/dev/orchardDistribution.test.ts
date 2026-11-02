import { describe, expect, it } from 'vitest';
import { Frustum, Vector3 } from 'three';
import { BuildQueue } from '../../../src/core/buildQueue';
import { salt } from '../../../src/core/hash';
import { generateLayout } from '../planet/terrain';
import { landmarkReach, LandmarkClassifier, orchardGrove, orchardKind, SEEDED } from '../life/landmarks';
import { behindHorizon, ScatterLayer } from '../life/scatter';
import { KIT_KINDS } from '../life/landmarkMeshes';

describe('planet-wide orchard distribution', () => {
  it('keeps the global layer reachable beyond the old 260 m camera cutoff at every planet size', () => {
    for (const radius of [40, 128, 400]) {
      for (const altitude of [radius, radius * 4, 1600]) {
        expect(landmarkReach(altitude, 0.001, radius)).toBeCloseTo(Math.PI * radius, 8);
      }
      expect(landmarkReach(2, 0.001, radius)).toBeGreaterThan(0);
    }
  });

  it('creates seeded groves in both hemispheres, open dunes, and regional species mixtures', () => {
    for (const seed of [1, 412, 771]) {
      const layout = generateLayout(seed);
      const classifier = new LandmarkClassifier();
      classifier.set(layout, 128, { dunes: 7, spacing: 17, swell: 3, habitat: 0.3, grain: 0.85, density: 6, patchiness: 0.8, patchSize: 9 }, 'distribution');
      const populated = [0, 0];
      let bare = 0;
      let dense = 0;
      let low = 0;
      let high = 0;
      const kinds = new Set<string>();
      for (let i = 0; i < 2048; i++) {
        const y = 1 - 2 * (i + 0.5) / 2048;
        const r = Math.sqrt(1 - y * y);
        const dir = new Vector3(r * Math.cos(i * 2.399963), y, r * Math.sin(i * 2.399963));
        const density = classifier.density(dir);
        expect(density).toBeGreaterThanOrEqual(0);
        expect(density).toBeLessThanOrEqual(SEEDED.peak);
        if (density < 0.001) bare++;
        if (density > 0.04) populated[dir.dot(layout.cottage) > 0 ? 0 : 1]++;
        if (density > 0.13) dense++;
        const grove = orchardGrove(dir, seed);
        if (grove < 0.1) low++;
        if (grove > 0.9) high++;
        kinds.add(orchardKind(dir, seed, (i % 37) / 37));
        expect(orchardGrove(dir, seed)).toBe(grove);
      }
      expect(populated[0]).toBeGreaterThan(50);
      expect(populated[1]).toBeGreaterThan(50);
      expect(bare).toBeGreaterThan(400);
      expect(dense).toBeGreaterThan(80);
      expect(low).toBeGreaterThan(100);
      expect(high).toBeGreaterThan(100);
      expect(kinds).toEqual(new Set(KIT_KINDS));
    }
  });

  it('switches near/far page lists without losing, duplicating or rebuilding the rest-space population', () => {
    const queue = new BuildQueue();
    const layer = new ScatterLayer({ name: 'orchard-lod-test', cls: { salt: salt('orchard-lod-test'), jitter: 0.9 }, tileMeters: 100, pageSize: 32, pages: 64, headroom: 1.25, channels: 2, sortByBirth: true });
    const frustum = new Frustum();
    for (const plane of frustum.planes) plane.constant = 1e9;
    // The empty second channel exercises staging-buffer reuse across tiles.
    const classifier = { version: 'one-occupied-channel', prepare: () => ({ state: null, boost: 1 }), classify: () => 0 };
    const view = { seed: 412, radius: 40, radiusHi: 40, density: 0.01, queue, classifier, focus: new Vector3(0, 1, 0), near: Math.PI * 40, falloff: () => 1, frustum, warp: { focus: new Vector3(0, 40, 0), up: new Vector3(0, 1, 0), k: 0 }, lod: { camera: new Vector3(0, 400, 0), detailDistance: 1e6 } };
    layer.update(view);
    queue.drain();
    layer.update(view);
    const population = layer.visibleInstances;
    const pages = layer.instanceCounts[0];
    expect(population).toBeGreaterThan(30);
    expect(layer.farInstanceCounts[0]).toBe(0);
    expect(layer.saturated).toBe(0);
    view.lod.detailDistance = 10;
    layer.update(view);
    expect(queue.size).toBe(0);
    expect(layer.visibleInstances).toBe(population);
    expect(layer.instanceCounts[0]).toBe(0);
    expect(layer.farInstanceCounts[0]).toBe(pages);
    view.lod.detailDistance = 1e6;
    layer.update(view);
    expect(layer.instanceCounts[0]).toBe(pages);
    expect(layer.farInstanceCounts[0]).toBe(0);
    expect(layer.visibleInstances).toBe(population);
  });

  it('releases future births when the growth band shrinks back to its initial size', () => {
    const queue = new BuildQueue();
    const layer = new ScatterLayer({ name: 'orchard-shrink-test', cls: { salt: salt('orchard-shrink-test'), jitter: 0.9 }, tileMeters: 100, pageSize: 8, pages: 2048, headroom: 1.25, sortByBirth: true });
    const frustum = new Frustum();
    for (const plane of frustum.planes) plane.constant = 1e9;
    const view = { seed: 412, radius: 40, radiusHi: 40, density: 0.01, queue, focus: new Vector3(0, 1, 0), near: Math.PI * 40, falloff: () => 1, frustum, warp: { focus: new Vector3(0, 40, 0), up: new Vector3(0, 1, 0), k: 0 } };
    const settle = (): number => { layer.update(view); queue.drain(); layer.update(view); return layer.instanceCount; };
    const initial = settle();
    view.radiusHi = 120;
    expect(settle()).toBeGreaterThan(initial * 4);
    view.radiusHi = 40;
    expect(settle()).toBe(initial);
    expect(layer.saturated).toBe(0);
    expect(queue.size).toBe(0);
  });

  it('rejects the far hemisphere while retaining raised silhouettes near the horizon', () => {
    const camera = new Vector3(0, 400, 0);
    expect(behindHorizon(new Vector3(0, 1, 0), 0.1, 128, 20, camera)).toBe(false);
    expect(behindHorizon(new Vector3(0, -1, 0), 0.1, 128, 20, camera)).toBe(true);
    expect(behindHorizon(new Vector3(1, 0, 0), 0.15, 128, 20, camera)).toBe(false);
  });
});
