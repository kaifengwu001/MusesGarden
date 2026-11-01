import { expect, test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

test('clear weather preserves resident light and returns exactly after cloudy and daylight changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/environments/lantern-reed-gardens/#seed=412&q=high&hud=0&t=12&cc=0&tod=12.5');
  await page.waitForFunction(() => window.__meadow?.isReady, undefined, { timeout: 60_000 });
  const snapshot = async (coverage: number, hour: number) => page.evaluate(async ({ coverage, hour }) => {
    const m = window.__meadow!;
    m.set('clouds.coverage', coverage);
    m.set('light.timeOfDay', hour);
    await m.settle();
    type Vec = { x: number; y: number; z: number; w: number; toArray(): number[] };
    type Uniform = { value: Vec };
    const world = (window as unknown as { __world: {
      look: { uSunAngles: Uniform };
      clouds: {
        count: number;
        mesh: { geometry: { instanceCount: number } };
        bounds(): Array<{ centre: { x: number; y: number; z: number }; radius: number }>;
        uniforms: { uCloudLook: Uniform; uCloudOrbit: Uniform; uFaceWindow: Uniform };
        shadowScene: { children: Array<{ material: { uniforms: { uSunAngles?: Uniform; uMuseModel?: unknown } } }> };
      };
    } }).__world;
    const clouds = world.clouds;
    const shadowSuns = clouds.shadowScene.children.map(child => child.material.uniforms.uSunAngles).filter((uniform): uniform is Uniform => uniform !== undefined);
    return {
      hash: m.frameHash(), count: clouds.mesh.geometry.instanceCount,
      cloudLook: clouds.uniforms.uCloudLook.value.toArray(),
      orbit: clouds.uniforms.uCloudOrbit.value.toArray(),
      sun: world.look.uSunAngles.value.toArray(),
      shadowSuns: shadowSuns.map(uniform => uniform.value.toArray()),
      liveShadowSun: shadowSuns.every(uniform => uniform.value === world.look.uSunAngles.value),
      window: clouds.uniforms.uFaceWindow.value.toArray(),
      finiteBounds: clouds.bounds().every(bound => [bound.centre.x, bound.centre.y, bound.centre.z, bound.radius].every(Number.isFinite)),
    };
  }, { coverage, hour });

  const day = await snapshot(0, 12.5);
  expect(day.count).toBe(0);
  expect(day.cloudLook[2]).toBe(0);
  expect(day.orbit.every(Number.isFinite)).toBe(true);
  expect(day.shadowSuns.length).toBeGreaterThanOrEqual(4);
  expect(day.liveShadowSun).toBe(true);
  expect(day.window).toEqual([0, 0, 1]);
  const cloudyDay = await snapshot(0.45, 12.5);
  expect(cloudyDay.count).toBeGreaterThan(0);
  expect(cloudyDay.finiteBounds).toBe(true);
  expect(cloudyDay.hash).not.toBe(day.hash);
  expect((await snapshot(0, 12.5)).hash).toBe(day.hash);

  const dusk = await snapshot(0, 17.8);
  expect(dusk.sun).not.toEqual(day.sun);
  expect(dusk.liveShadowSun).toBe(true);
  expect(dusk.shadowSuns.every(sun => JSON.stringify(sun) === JSON.stringify(dusk.sun))).toBe(true);
  expect(dusk.hash).not.toBe(day.hash);
  const cloudyDusk = await snapshot(0.45, 17.8);
  expect(cloudyDusk.count).toBeGreaterThan(0);
  expect(cloudyDusk.finiteBounds).toBe(true);
  expect((await snapshot(0, 17.8)).hash).toBe(dusk.hash);
  expect((await snapshot(0, 12.5)).hash).toBe(day.hash);
  expect(errors).toEqual([]);
});
