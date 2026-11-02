import { expect, test } from '@playwright/test';
import type { World } from '../world';
import type {} from '../../../src/dev/harnessApi';

test('native cherry canopy, bloom and camera travel remain attached to the same planet', async ({page})=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/environments/cherry-blossom-waterways/#q=high&hud=0&t=12');
  await page.waitForFunction(()=>window.__meadow?.isReady,undefined,{timeout:90000});
  const result=await page.evaluate(async()=>{
    const h=window.__meadow!,w=(window as unknown as {__world:World}).__world;
    await h.settle();
    const identities=w.scenery.sites.map(s=>s.id);
    const variants=[...new Set(w.scenery.sites.map(s=>s.variant))];
    h.set('world.bloom',0);await h.settle();const green=h.frameHash();
    h.set('world.bloom',1);await h.settle();const pink=h.frameHash();
    w.cameraPreset('homestead');await h.settle();const home=h.frameHash();
    const detailed=w.scenery.group.children.filter(m=>m.name.startsWith('Detailed')).length;
    h.freeze(18);await h.settle();const drift=h.frameHash();
    h.freeze(12);await h.settle();const returned=h.frameHash();
    return {identities,after:w.scenery.sites.map(s=>s.id),variants,green,pink,home,drift,returned,detailed};
  });
  expect(result.identities.length).toBeGreaterThan(200);
  expect(result.variants).toHaveLength(4);
  expect(result.after).toEqual(result.identities);
  expect(result.green).not.toBe(result.pink);
  expect(result.drift).not.toBe(result.home);
  expect(result.returned).toBe(result.home);
  expect(result.detailed).toBe(4);
  expect(errors).toEqual([]);
});
