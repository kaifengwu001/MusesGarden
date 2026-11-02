import { expect,test } from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';

test('harvest views render real rye, keep the world dry and expose its controls',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|GL_INVALID/i.test(m.text()))errors.push(m.text())});
 await page.goto('/environments/golden-rye/#q=high&t=12&hud=0');
 await page.waitForFunction(()=>window.__meadow?.isReady,undefined,{timeout:90000});
 await expect(page.getByRole('heading',{name:'Golden Rye',exact:true})).toBeVisible();
 for(const name of ['Across the rye','Among the ears','Whole planet']){
  await page.getByRole('button',{name,exact:true}).click();await page.evaluate(async()=>window.__meadow!.settle());
 }
 const probe=await page.evaluate(()=>{
  const w=(window as unknown as {__world:{rye:{instanceCount:number;triangles:number};harvest:{group:{children:{name:string}[]}};terrain:{sample(d:unknown,o:unknown):{water:number;depth:number};layout:{cottage:unknown}}}}).__world;
  const sample=w.terrain.sample(w.terrain.layout.cottage,{});
  return{rye:w.rye.instanceCount,triangles:w.rye.triangles,dry:sample.water,depth:sample.depth,groups:w.harvest.group.children.map(g=>g.name),flowerInstances:window.__meadow!.stats().flowerInstances,gpuBytes:window.__meadow!.stats().gpuBytes};
 });
 expect(probe.gpuBytes).toBeLessThan(256*1024*1024);expect(probe.rye).toBeGreaterThan(20000);expect(probe.triangles).toBeLessThan(2500000);
 expect(probe.dry).toBeGreaterThan(.5);expect(probe.depth).toBe(0);expect(probe.flowerInstances).toBe(0);expect(probe.groups.length).toBe(3);expect(errors).toEqual([]);
});

test('Ripen changes cereal colour and named views return a frozen frame',async({page})=>{
 await page.goto('/environments/golden-rye/#q=high&t=12&hud=0');await page.waitForFunction(()=>window.__meadow?.isReady,undefined,{timeout:90000});
 const frames=await page.evaluate(async()=>{
  const h=window.__meadow!,w=(window as unknown as {__world:{harvestView(name:string):void}}).__world;
  w.harvestView('detail');h.set('world.bloom',0);await h.settle();const green=h.frameHash();
  h.set('world.bloom',1);await h.settle();const ripe=h.frameHash();
  await h.settle();const repeat=h.frameHash();
  w.harvestView('globe');await h.settle();w.harvestView('detail');await h.settle();const returned=h.frameHash();
  return{green,ripe,repeat,returned};
 });
 expect(frames.green).not.toBe(frames.ripe);expect(frames.repeat).toBe(frames.ripe);expect(frames.returned).toBe(frames.ripe);
});
