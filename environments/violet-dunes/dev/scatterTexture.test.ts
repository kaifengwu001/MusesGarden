import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, Frustum, RGBAFormat, Sphere, Vector3 } from 'three';
import { BuildQueue } from '../../../src/core/buildQueue';
import { salt } from '../../../src/core/hash';
import type { RestPoint } from '../../../src/planet/rest';
import { NEVER, ScatterLayer, scatterTextureShape, scatterTextureUpdate, scatterTileBounds, scatterTileDistance } from '../life/scatter';
import { warpPoint } from '../../../src/render/warp';

/** CPU equivalent of the shader's textureSize-based flattened fetch. */
function texel(texture: DataTexture, index: number): number[] {
  const x = index % texture.image.width;
  const y = Math.floor(index / texture.image.width);
  expect(y).toBeLessThan(texture.image.height);
  const data = texture.image.data as Float32Array;
  return Array.from(data.subarray((y * texture.image.width + x) * 4, (y * texture.image.width + x + 1) * 4));
}

describe('portable scatter texture storage', () => {
  it('keeps distant flattened tiles coarse with a conservative distance for either warp sign', () => {
    const centre = new Vector3(1, 0, 0);
    const radius = 128;
    const alpha = 0.27;
    const padding = 25;
    const camera = new Vector3(0, 145, 0);
    const r = 2 * radius * Math.sin(alpha / 2) + padding;
    for (const k of [-0.0036, 0, 0.0036]) {
      const warp = { focus: new Vector3(0, radius, 0), up: new Vector3(0, 1, 0), k };
      const lower = scatterTileDistance(centre, alpha, radius, padding, warp, camera);
      expect(lower).toBeGreaterThan(40);
      // Actual warped points throughout the sphere must never be closer than
      // the bound; otherwise nearby foliage could incorrectly lose detail.
      for (let i = 0; i < 300; i++) {
        const y = 1 - 2 * (i + 0.5) / 300;
        const ring = Math.sqrt(1 - y * y);
        const p = new Vector3(ring * Math.cos(i * 2.39996), y, ring * Math.sin(i * 2.39996)).multiplyScalar(r * (0.1 + 0.9 * (i % 7) / 6)).addScaledVector(centre, radius);
        warpPoint(warp, p, p);
        expect(lower).toBeLessThanOrEqual(p.distanceTo(camera) + 1e-9);
      }
      if (k < 0) {
        const loose = scatterTileBounds(centre, alpha, radius, padding, warp, new Sphere());
        expect(loose.center.distanceTo(camera) - loose.radius).toBeLessThan(lower);
      }
    }
  });

  it('retains the complete 16384-page landmark capacity below the portable texture limit', () => {
    const layer = new ScatterLayer({ name: 'texture-capacity-test', cls: { salt: salt('texture-capacity'), jitter: 0.9 }, tileMeters: 40, pageSize: 8, pages: 16384, headroom: 1.25, stride: 8 });
    for (const texture of [...layer.mainTextures, ...layer.restTextures, ...layer.listTextures, ...layer.farListTextures]) {
      expect(texture.image.width).toBeLessThanOrEqual(2048);
      expect(texture.image.height).toBeLessThanOrEqual(2048);
      expect((texture.image.data as Float32Array).length).toBe(texture.image.width * texture.image.height * 4);
    }
    expect((layer.mainTextures[0].image.data as Float32Array).length).toBe(16384 * 8 * 4);
    expect((layer.restTextures[0].image.data as Float32Array).length).toBe(16384 * 8 * 4);
    expect((layer.listTextures[0].image.data as Float32Array).length).toBe(16384);
    expect(scatterTextureShape(2048 * 2048)).toEqual({ width: 2048, height: 2048 });
    expect(() => scatterTextureShape(2048 * 2048 + 1)).toThrow();
  });

  it('splits dirty ranges at physical rows without dropping or uploading extra components', () => {
    const texture = new DataTexture(new Float32Array(8 * 4 * 4), 8, 4, RGBAFormat, FloatType);
    scatterTextureUpdate(texture, 20, 80);
    expect(texture.updateRanges).toEqual([{ start: 20, count: 12 }, { start: 32, count: 32 }, { start: 64, count: 32 }, { start: 96, count: 4 }]);
    expect(texture.updateRanges.reduce((sum, range) => sum + range.count, 0)).toBe(80);
    for (const range of texture.updateRanges) expect(Math.floor(range.start / 32)).toBe(Math.floor((range.start + range.count - 1) / 32));
    texture.dispose();
  });

  it('uploads every populated near and far page-list row on its first rendered frame', () => {
    const queue = new BuildQueue();
    const layer = new ScatterLayer({ name: 'texture-first-list', cls: { salt: salt('texture-first-list'), jitter: 0.9 }, tileMeters: 100, pageSize: 4, pages: 2048, headroom: 1.25 });
    const frustum = new Frustum();
    for (const plane of frustum.planes) plane.constant = 1e9;
    const view = { seed: 412, radius: 40, radiusHi: 40, density: 0.12, queue, focus: new Vector3(0, 1, 0), near: Math.PI * 40, falloff: () => 1, frustum, warp: { focus: new Vector3(0, 40, 0), up: new Vector3(0, 1, 0), k: 0 }, lod: { camera: new Vector3(0, 400, 0), detailDistance: 1e6 } };
    const firstUpload = (texture: DataTexture, pages: number): void => {
      expect(pages).toBeGreaterThan(texture.image.width * 4);
      const cpu = texture.image.data as Float32Array;
      const gpu = new Float32Array(cpu.length);
      // Three uploads the full image only when there are no partial ranges.
      if (texture.updateRanges.length === 0) gpu.set(cpu);
      else for (const range of texture.updateRanges) gpu.set(cpu.subarray(range.start, range.start + range.count), range.start);
      expect(Array.from(gpu.subarray(0, pages))).toEqual(Array.from(cpu.subarray(0, pages)));
      expect(gpu[pages - 1]).toBeGreaterThan(0);
    };
    layer.update(view);
    queue.drain();
    layer.update(view);
    firstUpload(layer.listTextures[0], layer.instanceCounts[0] / 4);
    view.lod.detailDistance = 10;
    layer.update(view);
    firstUpload(layer.farListTextures[0], layer.farInstanceCounts[0] / 4);
    expect(layer.saturated).toBe(0);
  });

  for (const stride of [5, 7, 8]) it(`preserves page-list and instance addressing with stride ${stride}, including cross-row writes`, () => {
    const queue = new BuildQueue();
    const layer = new ScatterLayer({ name: `texture-stride-${stride}`, cls: { salt: salt('texture-stride'), jitter: 0.9 }, tileMeters: 100, pageSize: 256, pages: 9, headroom: 1.25, stride });
    const expected = new Map<string, number[]>();
    const classifier = {
      version: 'texture-payload',
      prepare: () => ({ state: null, boost: 1 }),
      classify: (_state: unknown, _point: RestPoint, _sigma: number, record: Float32Array, offset: number): number => {
        if (stride > 5) record[offset + 5] = record[offset + 4] * 2 + 1;
        if (stride > 6) record[offset + 6] = record[offset + 4] * 3 + 2;
        if (stride > 7) record[offset + 7] = record[offset + 4] * 4 + 3;
        expected.set(Array.from(record.subarray(offset, offset + 3)).join(','), Array.from(record.subarray(offset + 4, offset + stride)));
        return 0;
      },
    };
    const frustum = new Frustum();
    for (const plane of frustum.planes) plane.constant = 1e9;
    const view = { seed: 412, radius: 10, radiusHi: 10, density: 0.1, classifier, queue, focus: new Vector3(0, 1, 0), near: Math.PI * 10, falloff: () => 1, frustum, warp: { focus: new Vector3(0, 10, 0), up: new Vector3(0, 1, 0), k: 0 } };
    layer.update(view);
    queue.drain();
    layer.update(view);
    expect(layer.saturated).toBe(0);
    const found = new Map<string, number[]>();
    for (let draw = 0; draw < layer.instanceCounts[0] / 256; draw++) {
      const page = texel(layer.listTextures[0], Math.floor(draw / 4))[draw % 4];
      for (let slot = 0; slot < 256; slot++) {
        const instance = page * 256 + slot;
        const point = texel(layer.mainTextures[0], instance);
        if (point[3] >= NEVER * 0.5) continue;
        const rest = stride === 5 ? [texel(layer.restTextures[0], Math.floor(instance / 4))[instance % 4]] : texel(layer.restTextures[0], instance).slice(0, stride - 4);
        found.set(point.slice(0, 3).join(','), rest);
      }
    }
    expect(found.size).toBeGreaterThan(40);
    expect(found).toEqual(expected);
    for (const texture of [...layer.mainTextures, ...layer.restTextures]) {
      const row = texture.image.width * 4;
      for (const range of texture.updateRanges) expect(Math.floor(range.start / row)).toBe(Math.floor((range.start + range.count - 1) / row));
    }
  });
});
