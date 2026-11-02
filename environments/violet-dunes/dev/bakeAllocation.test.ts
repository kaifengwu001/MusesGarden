import { Vector3, type WebGLCubeRenderTarget, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { gpuMemory } from '../../../src/core/gpuMemory';
import { TerrainBake } from '../planet/bake';
import { Fields } from '../planet/fields';

const PARAMS = { dunes: 1.8, spacing: 17, swell: 1.1, habitat: 0.3, grain: 0.85, density: 6, patchiness: 0.8, patchSize: 9 };
// Allocation and disposal are CPU contracts; rendering is deliberately absent.
const renderer = { getRenderTarget: () => null, setRenderTarget: () => {}, render: () => {} } as unknown as WebGLRenderer;
type Allocation = { terrain: WebGLCubeRenderTarget; flora: WebGLCubeRenderTarget };

describe('large-planet height bake allocation', () => {
  it('retains cheap scrubbing, upgrades settled height only, and releases large targets on shrinking', () => {
    const bake = new TerrainBake(512), fields = new Fields(412, new Vector3(0, 1, 0));
    const initialBytes = gpuMemory.entries().get('terrain bake')!;
    const original = (bake as unknown as { full: Allocation }).full;
    let originalDisposed = 0;
    original.terrain.addEventListener('dispose', () => { originalDisposed++; });
    original.flora.addEventListener('dispose', () => { originalDisposed++; });

    fields.update(400, PARAMS);
    // The consumer needs the future full resolution before the bake replaces its allocation.
    expect(bake.texelMeters(400, true)).toBe(800 / 1024);
    expect(bake.texelMeters(400, false)).toBe(800 / 256);
    bake.bake(renderer, fields, 'growing-400', false);
    expect((bake as unknown as { full: Allocation }).full.terrain.width).toBe(512);
    expect(originalDisposed).toBe(0);
    expect(gpuMemory.entries().get('terrain bake')).toBe(initialBytes);

    bake.bake(renderer, fields, 'settled-400', true);
    const large = (bake as unknown as { full: Allocation }).full;
    expect(originalDisposed).toBe(2);
    expect(large.terrain.width).toBe(1024);
    expect(large.flora.width).toBe(256);
    expect(gpuMemory.entries().get('terrain bake')! - initialBytes).toBe(36 * 1024 * 1024);
    let largeDisposed = 0;
    large.terrain.addEventListener('dispose', () => { largeDisposed++; });
    large.flora.addEventListener('dispose', () => { largeDisposed++; });

    fields.update(128, PARAMS);
    bake.bake(renderer, fields, 'shrinking-128', false);
    expect(largeDisposed).toBe(2);
    expect((bake as unknown as { full: Allocation }).full.terrain.width).toBe(512);
    expect(gpuMemory.entries().get('terrain bake')).toBe(initialBytes);
    expect(bake.texelMeters(128, true)).toBe(256 / 512);
    expect(bake.bake(renderer, fields, 'settled-128', true)).toBe(true);
    expect(bake.bake(renderer, fields, 'settled-128', true)).toBe(false);
  });
});
