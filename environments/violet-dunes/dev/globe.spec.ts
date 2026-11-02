/// <reference types="vite/client" />
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type * as Quality from '../../../src/core/quality';
import type {} from '../../../src/dev/harnessApi';

test('remote globe planting and cirrus survive orbit, zoom and growth return', async ({ page }) => {
  test.setTimeout(240_000);
  const out = 'shots/violet-dunes/globe';
  mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/environments/violet-dunes/#q=high&hud=0&t=12');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 120_000 });
  const captures: unknown[] = [];
  const capture = async (name: string, pose?: string, growth?: number) => {
    const result = await page.evaluate(async ({ pose, growth }) => {
      const m = window.__meadow!;
      // Resolve through Vite: quality imports shader-backed modules that the
      // Node-side Playwright loader cannot evaluate directly.
      const qualityModule = '/src/core/quality.ts';
      const { TIERS } = await import(qualityModule) as typeof Quality;
      const w = (window as unknown as { __world: {
        rig: { applyPose(pose: string): boolean; lookUp(angle: number, immediate: boolean): void };
        landmarks: { layer: { visibleInstances: number; saturated: number; mainTextures: Array<{ image: { width: number; height: number } }>; restTextures: Array<{ image: { width: number; height: number } }>; listTextures: Array<{ image: { width: number; height: number } }>; farListTextures: Array<{ image: { width: number; height: number } }> }; meshes: Array<{ visible: boolean; geometry: { instanceCount: number } }> };
        cirrus: { mesh: { visible: boolean; geometry: { index: { count: number } } } };
      } }).__world;
      m.freeze(12);
      m.setScale(1);
      if (growth !== undefined) m.set('world.growth', growth);
      if (pose) { w.rig.applyPose(pose); w.rig.lookUp(0, true); }
      else m.preset('homestead');
      await m.settle();
      await m.settle();
      const hashes = Array.from({ length: 16 }, () => m.frameHash());
      const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
      const gl = canvas.getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      m.renderFrame();
      return {
        hashes, stats: m.stats(), budgets: TIERS.high.budgets, plants: w.landmarks.layer.visibleInstances, saturated: w.landmarks.layer.saturated,
        cloudTriangles: w.cirrus.mesh.geometry.index.count / 3,
        scatterTextureMax: Math.max(...[...w.landmarks.layer.mainTextures, ...w.landmarks.layer.restTextures, ...w.landmarks.layer.listTextures, ...w.landmarks.layer.farListTextures].flatMap(texture => [texture.image.width, texture.image.height])),
        renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
        png: canvas.toDataURL('image/png'),
      };
    }, { pose, growth });
    const { png: _png, ...evidence } = result;
    captures.push({ name, ...evidence });
    // Continue collecting all views if a backend fails exact redraw equality;
    // soft assertions still fail this test and preserve the original threshold.
    expect.soft(new Set(result.hashes).size, `${name} frozen redraws`).toBe(1);
    expect(result.cloudTriangles, `${name} cirrus is present`).toBeGreaterThan(0);
    expect(result.saturated, `${name} never truncates habitat because of a full pool`).toBe(0);
    expect(result.scatterTextureMax, `${name} scatter fits modest WebGL2 texture limits`).toBeLessThanOrEqual(2048);
    expect.soft(result.stats.gpuBytes, `${name} GPU allocation budget`).toBeLessThanOrEqual(result.budgets.gpuMemoryMB * 1024 * 1024);
    expect.soft(result.stats.triangles, `${name} effective triangle budget`).toBeLessThanOrEqual(result.budgets.triangles);
    if (pose) expect(result.plants, `${name} has remote streamed vegetation and rocks`).toBeGreaterThan(100);
    writeFileSync(`${out}/${name}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
    return { hash: result.hashes[0], triangles: result.stats.trianglesSubmitted };
  };
  try {
    const first = await capture('whole-planet', '0.6344,0.0466,0.0069,0.7716,0', 0.1886);
    await capture('far-hemisphere', '0.0069,0.7716,-0.6344,-0.0466,0');
    await capture('middle-distance', '0.6344,0.0466,0.0069,0.7716,0.16');
    await capture('large-planet', '0.6344,0.0466,0.0069,0.7716,0', 1);
    await capture('large-orchard');
    const returned = await capture('whole-planet-return', '0.6344,0.0466,0.0069,0.7716,0', 0.1886);
    expect(returned.hash).toBe(first.hash);
    expect(returned.triangles, 'shrinking releases excess future-birth submissions').toBeLessThanOrEqual(first.triangles * 1.1);
    await capture('orchard');
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(`${out}/evidence.json`, JSON.stringify({ errors, captures }, null, 2));
  }
});
