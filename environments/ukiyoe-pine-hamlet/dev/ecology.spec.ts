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
  expect(errors).toEqual([]);
});
