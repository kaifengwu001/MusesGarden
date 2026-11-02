import { describe,expect,it } from 'vitest';
import { type Mesh,type InstancedBufferGeometry,Vector3 } from 'three';
import { cypressGeometry,farmGeometry,harvestSheafGeometry } from '../life/harvestGeometry';
import { HarvestScenery } from '../life/harvestScenery';
import { Terrain,generateLayout,createGroundSample } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const params:FieldParams={roll:2.8,hummocks:.15,wetlands:0,waterLevel:0,grain:.6,density:0,patchiness:.8,patchSize:13,weights:[0,0,0,0]};
function terrain(radius:number):Terrain {const t=new Terrain(generateLayout(412));t.update(radius,params,.5);return t;}

describe('harvest landscape landmarks',()=>{
 it('uses finite, distinct cypress, farm and bound-sheaf anatomy',()=>{
  const cypress=cypressGeometry(),farm=farmGeometry(),sheaf=harvestSheafGeometry();
  for(const geometry of [cypress,farm,sheaf]){
   for(const name of ['position','normal','uv','aKind'])expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true);
   const normal=geometry.getAttribute('normal');for(let i=0;i<normal.count;i++)expect(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))).toBeCloseTo(1,5);
   geometry.computeBoundingBox();expect(geometry.boundingBox!.min.y).toBeLessThan(0);
  }
  const size=new Vector3();cypress.boundingBox!.getSize(size);expect(size.y).toBeGreaterThan(size.x*3.5);
  expect(new Set(Array.from(farm.getAttribute('aKind').array))).toEqual(new Set([0,2,3,6]));
  expect(cypress.getAttribute('position').count/3+farm.getAttribute('position').count/3+sheaf.getAttribute('position').count/3).toBeLessThan(1400);
  cypress.dispose();farm.dispose();sheaf.dispose();
 });
 for(const radius of [40,128,400])it(`keeps root directions, physical ground contact and home clearance at R${radius}`,()=>{
  const t=terrain(radius),scenery=new HarvestScenery({},t),sample=createGroundSample();
  let trees=0,triangles=0;
  const octants=new Array<number>(8).fill(0);
  for(const child of scenery.group.children){
   const mesh=child as Mesh<InstancedBufferGeometry>,g=mesh.geometry,a=g.getAttribute('aAnchor'),placement=g.getAttribute('aPlacement');
   expect(g.instanceCount).toBeGreaterThan(0);expect(mesh.frustumCulled).toBe(false);
   triangles+=(g.index?.count??g.getAttribute('position').count)/3*g.instanceCount;
   for(let i=0;i<g.instanceCount;i++){
    const dir=new Vector3(a.getX(i),a.getY(i),a.getZ(i)).normalize();
    expect(dir.length()).toBeCloseTo(1,6);
    const local=t.cottageLocal(dir,{x:0,z:0});
    if(dir.dot(t.layout.cottage)>0)expect(local.x>-10&&local.x<7&&local.z>-7&&local.z<8).toBe(false);
    if(mesh.name.includes('cypress')){t.sample(dir,sample);expect(a.getW(i)).toBeCloseTo(sample.height-.08*placement.getX(i),4);trees++;octants[(dir.x>=0?1:0)+(dir.y>=0?2:0)+(dir.z>=0?4:0)]++;}
   }
  }
  expect(trees).toBeGreaterThan(250);
  // On a tiny planet the protected physical home clearing occupies a large
  // angular cap, so octant balance is checked once that cap is proportionate.
  if(radius>=128)expect(Math.min(...octants)).toBeGreaterThan(12);
  expect(triangles).toBeLessThan(450_000);
  scenery.dispose();expect(scenery.group.children).toHaveLength(0);
 });
 it('repeats the landmark anchors exactly after a radius roundtrip',()=>{
  const t=terrain(128),s=new HarvestScenery({},t);
  const snapshot=()=>s.group.children.map(child=>{const g=(child as Mesh<InstancedBufferGeometry>).geometry;return{count:g.instanceCount,anchor:Array.from(g.getAttribute('aAnchor').array).slice(0,g.instanceCount*4),placement:Array.from(g.getAttribute('aPlacement').array).slice(0,g.instanceCount*4)};});
  const first=snapshot();t.update(400,params,.5);s.update(12,t);t.update(128,params,.5);s.update(12,t);expect(snapshot()).toEqual(first);s.dispose();
 });
});
