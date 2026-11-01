import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';
import type { World } from '../world';

test('reference views compile, expose Muse and preserve the seasonal layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error' && /shader|webgl|error/i.test(m.text())) errors.push(m.text()); });
  await page.goto('/environments/ukiyoe-pine-hamlet/#q=high&hud=0&t=12');
  await page.waitForFunction(() => window.__meadow?.isReady,undefined,{timeout:90000});
  await page.evaluate(async()=>window.__meadow?.settle());
  mkdirSync('shots/ukiyoe-pine-hamlet',{recursive:true});
  await page.screenshot({path:'shots/ukiyoe-pine-hamlet/home-ui.png'});
  const state = await page.evaluate(()=>{
    const w=(window as unknown as {__world:World}).__world;
    return {residents:w.residents.members.length,triangles:w.scenery.triangleCount,season:w.season};
  });
  expect(state.residents).toBe(2);
  expect(state.triangles).toBeLessThan(1_500_000);
  await page.addStyleTag({content:'#ui { visibility:hidden !important; } .lil-gui { display:none !important; }'});
  await page.screenshot({path:'shots/ukiyoe-pine-hamlet/home.png'});
  for(const [preset,file] of [['bridge','bridge'],['muse','muse'],['planet','planet']] as const){
    await page.evaluate(p=>{const w=(window as unknown as {__world:World}).__world;w.cameraPreset(p);},preset);
    await page.evaluate(async()=>window.__meadow?.settle());
    await page.screenshot({path:`shots/ukiyoe-pine-hamlet/${file}.png`});
  }
  await page.evaluate(()=>{const w=(window as unknown as {__world:World}).__world;w.setSeason('rain');w.cameraPreset('home');});
  await page.evaluate(async()=>window.__meadow?.settle());
  await page.screenshot({path:'shots/ukiyoe-pine-hamlet/rain.png'});
  // Material evidence needs nearer views than the overall Home composition.
  // These exercise real instanced plants, lighting and terrain, not asset previews.
  const materials = [
    { file: 'pine-snow', season: 'snow', at: [-9, 4.5, -3], height: 5, distance: 8, azimuth: -0.6 },
    { file: 'pine-rain', season: 'rain', at: [-9, 4.5, -3], height: 5, distance: 8, azimuth: -0.6 },
    { file: 'cedar-rain', season: 'rain', at: [25, 3.2, 0], height: 4, distance: 7, azimuth: 1.2 },
    { file: 'snow-detail', season: 'snow', at: [-10, 1.0, 6], height: 2.8, distance: 5, azimuth: -0.5 },
  ] as const;
  for (const material of materials) {
    await page.evaluate(view => {
      const w = (window as unknown as { __world: World }).__world;
      w.setSeason(view.season);
      const capture = w as unknown as { frameLocal(view: { at: readonly number[]; height: number; distance: number; azimuth: number }, immediate: boolean): void };
      capture.frameLocal(view, true);
      w.markPosed();
    }, material);
    await page.evaluate(async()=>window.__meadow?.settle());
    await page.screenshot({path:`shots/ukiyoe-pine-hamlet/${material.file}.png`});
  }
  expect(errors).toEqual([]);
});
