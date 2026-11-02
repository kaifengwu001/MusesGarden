import { expect,test,type Page } from '@playwright/test';
import type { Vector3 } from 'three';
const route='/environments/rice-terraces/#seed=412&radius=128&view=planet';
interface Probe {isReady:boolean;settle():Promise<void>;frameHash():string;setHash(hash:string):void;getHash():string;stats():{radius:number;terrain:{triangles:number;waterTriangles:number;landTriangles:number;plots:number};life:{trees:number;riceTufts:number};cottage:{gableWalls:number;wetFraction:number}};}
declare global {interface Window {__rice?:Probe;}}
async function prepare(page:Page){
  await page.goto(route);
  await page.waitForFunction(()=>Reflect.get(window,'__meadow')?.isReady);
  await page.evaluate(()=>{window.__rice=Reflect.get(window,'__meadow') as Probe;});
  await page.evaluate(async()=>window.__rice!.settle());
}
test('renders terraced water, planted fields and groves without browser errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await prepare(page);
  const stats=await page.evaluate(()=>window.__rice!.stats());
  expect(stats.terrain.waterTriangles).toBeGreaterThan(1000);expect(stats.terrain.landTriangles).toBeGreaterThan(1000);
  expect(stats.terrain.plots).toBeGreaterThan(50);expect(stats.life.trees).toBeGreaterThan(30);
  expect(stats.life.riceTufts).toBeGreaterThan(200);expect(stats.terrain.triangles).toBeLessThan(1200000);
  await page.getByRole('button',{name:'Across the paddies',exact:true}).click();await page.evaluate(async()=>window.__rice!.settle());
  expect(await page.evaluate(()=>window.__rice!.getHash())).toContain('view=paddies');
  await page.getByRole('button',{name:'From above',exact:true}).click();await page.evaluate(async()=>window.__rice!.settle());
  expect(await page.evaluate(()=>window.__rice!.getHash())).toContain('view=above');expect(errors).toEqual([]);
});
test('frozen frames repeat and radius/seed returns restore the same world',async({page})=>{
  await prepare(page);const first=await page.evaluate(()=>window.__rice!.frameHash());
  expect(await page.evaluate(()=>window.__rice!.frameHash())).toBe(first);
  await page.evaluate(async()=>{const h=window.__rice!;h.setHash('seed=771&radius=180&view=planet');await h.settle();});
  expect(await page.evaluate(()=>window.__rice!.frameHash())).not.toBe(first);
  await page.evaluate(async()=>{const h=window.__rice!;h.setHash('seed=412&radius=128&view=planet');await h.settle();});
  expect(await page.evaluate(()=>window.__rice!.frameHash())).toBe(first);
  await page.reload();await page.waitForFunction(()=>Reflect.get(window,'__meadow')?.isReady);
  expect(await page.evaluate(()=>Reflect.get(window,'__meadow').frameHash())).toBe(first);
});
test('mobile viewport keeps camera controls and seeded landscape usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await prepare(page);
  await expect(page.getByRole('button',{name:'Whole planet',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Another landscape',exact:false}).click();
  await expect(page.locator('#world-stats')).toContainText('549');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test('cottage view retains its supported home through radius and seed changes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await prepare(page);await page.getByRole('button',{name:'Muse’s cottage',exact:true}).click();
  await page.evaluate(async()=>window.__rice!.settle());
  const initial=await page.evaluate(()=>{
    const h=window.__rice!,w=Reflect.get(window,'__world') as {camera:{up:Vector3};cottage:{site:{direction:Vector3}}};
    return {hash:h.frameHash(),state:h.getHash(),stats:h.stats().cottage,up:w.camera.up.dot(w.cottage.site.direction)};
  });
  expect(initial.state).toContain('view=cottage');expect(initial.stats.gableWalls).toBe(3);
  expect(initial.stats.wetFraction).toBe(0);expect(initial.up).toBeCloseTo(1,6);
  await page.evaluate(async()=>{const h=window.__rice!;h.setHash('seed=771&radius=220&view=cottage');await h.settle();});
  await page.evaluate(async()=>{const h=window.__rice!;h.setHash('seed=412&radius=128&view=cottage');await h.settle();});
  expect(await page.evaluate(()=>window.__rice!.frameHash())).toBe(initial.hash);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Muse’s cottage',exact:true}).click();
  await expect(page.getByRole('button',{name:'Muse’s cottage',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
});
