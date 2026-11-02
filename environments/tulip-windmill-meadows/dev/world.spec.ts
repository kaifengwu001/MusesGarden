import {test,expect} from '@playwright/test';
import type {} from '../../../src/dev/harnessApi';
const url='/environments/tulip-windmill-meadows/#q=high&t=12&hud=0';
test('new world loads without shader errors and repeats frozen frames',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(url);await page.waitForFunction(()=>window.__meadow?.isReady);await page.evaluate(async()=>{await window.__meadow!.settle()});
 const hashes=await page.evaluate(()=>{const h=window.__meadow!;return[h.frameHash(),h.frameHash()]});expect(hashes[0]).toBe(hashes[1]);expect(errors).toEqual([]);
 const counts=await page.evaluate(()=>{const w=(window as unknown as {__world:{tulipScenery:{group:{children:{name:string;geometry?:{instanceCount:number}}[]}}}}).__world;return w.tulipScenery.group.children.find(c=>c.name==='Six-colour tulip fields')?.geometry?.instanceCount});expect(counts).toBeGreaterThan(30000);
 const cottages=await page.evaluate(()=>{const w=(window as unknown as {__world:{tulipScenery:{group:{children:{name:string;children:{geometry?:{uuid:string}}[]}[]}}}}).__world;return w.tulipScenery.group.children.filter(c=>c.name.startsWith('Cottage ')).map(c=>({name:c.name,geometry:c.children[0].geometry?.uuid}))});
 expect(cottages).toHaveLength(6);expect(new Set(cottages.map(c=>c.name)).size).toBe(3);expect(new Set(cottages.map(c=>c.geometry)).size).toBe(3);
});
test('windmill animation and native tulip bloom respond while returning to frozen time',async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>window.__meadow?.isReady);await page.evaluate(async()=>{await window.__meadow!.settle()});
 const result=await page.evaluate(async()=>{const h=window.__meadow!;const first=h.frameHash();h.freeze(18);await h.settle();const moving=h.frameHash();h.freeze(12);await h.settle();const returned=h.frameHash();h.set('world.bloom',0);await h.settle();const buds=h.frameHash();return{first,moving,returned,buds}});
 expect(result.moving).not.toBe(result.first);expect(result.returned).toBe(result.first);expect(result.buds).not.toBe(result.first);
});

test('dense fields reuse their buffers across remote walks and restore the exact view',async({page})=>{
 await page.goto('/environments/tulip-windmill-meadows/#q=high&t=12&hud=0&pose=0.7621,0.0711,-0.6433,-0.0197,0.83');
 await page.waitForFunction(()=>window.__meadow?.isReady);
 const result=await page.evaluate(async()=>{
  const h=window.__meadow!;
  const w=(window as unknown as {__world:{rig:{walk:(ahead:number,across:number)=>void};tulipScenery:{group:{children:{name:string;visible:boolean;geometry?:{uuid:string;instanceCount:number}}[]}}}}).__world;
  const dense=w.tulipScenery.group.children.find(c=>c.name==='Dense tulips wherever you wander')!;
  await h.settle();const hash=h.getHash(),first=h.frameHash(),geometry=dense.geometry!.uuid;
  w.rig.walk(8,4);await h.settle();const moved=h.frameHash();h.setHash(hash);await h.settle();
  return{first,moved,returned:h.frameHash(),geometry,after:dense.geometry!.uuid,count:dense.geometry!.instanceCount,visible:dense.visible};
 });
 expect(result.moved).not.toBe(result.first);expect(result.returned).toBe(result.first);expect(result.geometry).toBe(result.after);expect(result.count).toBe(50176);expect(result.visible).toBe(true);
});
