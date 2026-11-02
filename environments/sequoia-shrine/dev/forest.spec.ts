import { expect, test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';
import type * as SculptLoader from '../../../src/life/museSculptLoader';

interface GardenProbe {
  state:{snapshot?:unknown};
  newest():{finds:string[]}|undefined;
  open(id:string):void;
  replant():void;
  flying():boolean;
}

test('connected shrines, grove, separate cabin and planet render without errors',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/shader|WebGL|GL_INVALID/i.test(message.text()))errors.push(message.text());});
  await page.goto('/environments/sequoia-shrine/#q=high&t=12&hud=0');
  await page.waitForFunction(()=>window.__meadow?.isReady);
  for(const name of ['Shrine approach','Ancient grove','Wayside shrines','Wayside shrines','Wayside shrines','Wayside shrines','Muse’s cabin','Whole planet']){
    await page.getByRole('button',{name,exact:true}).click();
    await page.evaluate(()=>window.__meadow!.settle());
    expect(await page.evaluate(()=>window.__meadow!.stats().flowerInstances)).toBe(0);
  }
  await expect(page.locator('h1')).toHaveText('Sequoia Shrine');
  expect(errors).toEqual([]);
});

test('frozen rendering survives repeat draws and growth return',async({page})=>{
  await page.goto('/environments/sequoia-shrine/#q=high&t=12&hud=0');
  await page.waitForFunction(()=>window.__meadow?.isReady);
  const frames=await page.evaluate(async()=>{
    const h=window.__meadow!;await h.settle();
    const originalGrowth=h.stats().growth;
    const initial=h.frameHash(),repeat=h.frameHash();
    h.set('world.growth',0.7);await h.settle();
    h.set('world.growth',originalGrowth);await h.settle();
    return{initial,repeat,returned:h.frameHash()};
  });
  expect(frames.repeat).toBe(frames.initial);
  expect(frames.returned).toBe(frames.initial);
});

test('dry forest CPU and GPU ground remain within 2 cm',async({page})=>{
  test.setTimeout(240000);
  await page.goto('/environments/sequoia-shrine/#q=high&t=12&hud=0');
  await page.waitForFunction(()=>window.__meadow?.isReady);
  for(const growth of [0,0.1886,1]){
    await page.evaluate(growth=>window.__meadow!.set('world.growth',growth),growth);
    for(const name of ['Shrine approach','Wayside shrines','Muse’s cabin']){
      await page.getByRole('button',{name,exact:true}).click();
      const parity=await page.evaluate(async()=>{const h=window.__meadow!;await h.settle();return h.parity();});
      expect(parity.heightError).toBeLessThan(0.02);
      expect(parity.waterError).toBeLessThan(0.02);
      expect(parity.warpError).toBeLessThan(0.02);
    }
  }
});

test('optional local garden retains basket planting and find cards on mainline',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('/environments/sequoia-shrine/?garden=#q=high&t=12&hud=0');
  await page.waitForFunction(()=>window.__meadow?.isReady&&(window as unknown as {__garden?:GardenProbe}).__garden?.state.snapshot);
  await page.getByRole('button',{name:'Baskets',exact:true}).click();
  await expect(page.locator('.g-day-row').first()).toBeVisible();
  await page.locator('.g-day-row').first().click();
  await page.waitForFunction(()=>!(window as unknown as {__garden:GardenProbe}).__garden.flying());
  await page.evaluate(()=>{const g=(window as unknown as {__garden:GardenProbe}).__garden;g.open(g.newest()!.finds[0]);});
  await expect(page.locator('.g-card.is-up')).toBeVisible();
  await page.evaluate(()=>window.__meadow!.settle());
  expect(errors).toEqual([]);
});

test('renamed sculpt loader resolves all five Muse bodies',async({page})=>{
  await page.goto('/environments/sequoia-shrine/#q=high&t=12&hud=0');
  await page.waitForFunction(()=>window.__meadow?.isReady);
  const bodies=await page.evaluate(async()=>{
    const url='/src/life/museSculptLoader.ts';
    const {loadSculpt}=await import(url) as typeof SculptLoader;
    const results=[];
    for(const kind of ['sculpt','tpose','tpose2','tpose5','tpose6'] as const){
      const loaded=await loadSculpt(kind);
      results.push({kind,vertices:loaded.body.position.length/3,finite:loaded.body.position.every(Number.isFinite),indices:loaded.body.index.length});
      loaded.raw.geometry.dispose();loaded.raw.material.map?.dispose();loaded.raw.material.dispose();
    }
    return results;
  });
  expect(bodies).toHaveLength(5);
  for(const body of bodies){expect(body.vertices).toBeGreaterThan(1000);expect(body.indices).toBeGreaterThan(3000);expect(body.finite).toBe(true);}
});
