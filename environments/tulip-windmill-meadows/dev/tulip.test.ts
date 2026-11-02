import { describe,expect,it } from 'vitest';
import { Vector3 } from 'three';
import { Terrain,generateLayout,createGroundSample } from '../planet/terrain';
import { tulipGeometry,windmillGeometry,windmillSailsGeometry,cottageGeometry } from '../life/tulipGeometry';
import { tulipSites,millSites,fieldColour } from '../life/tulipScenery';
import { farmSites,fieldCoordinates,fieldPhase,inFarmPlot,FARM_LIMIT } from '../life/farmLayout';
import { DenseTulips,DENSE_SPACING } from '../life/denseTulips';
const params={roll:0.45,hummocks:0.12,wetlands:0,waterLevel:0,grain:0.9,density:0,patchiness:0.95,patchSize:13,weights:[0.21,0.35,0.33,0.11] as [number,number,number,number]};
function terrainAt(radius=128,seed=412):Terrain{const t=new Terrain(generateLayout(seed));t.update(radius,params,0.5);return t;}
describe('Tulipwind Meadows',()=>{
 it('builds finite six-petal cups, a mill and four balanced sail arms',()=>{
  for(const g of [tulipGeometry(),tulipGeometry(false),windmillGeometry(),windmillSailsGeometry(),...[0,1,2].map(cottageGeometry)]){
   expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
   expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
   expect(g.boundingSphere?.radius).toBeGreaterThan(0);g.dispose();
  }
  const tulip=tulipGeometry(),p=tulip.getAttribute('position'),kind=tulip.getAttribute('aKind');
  const directions=new Set<number>();for(let i=0;i<p.count;i++)if(kind.getX(i)>0.5&&p.getY(i)>0.9)directions.add(Math.round(Math.atan2(p.getZ(i),p.getX(i))*3/Math.PI));
  expect(directions.size).toBeGreaterThanOrEqual(6);tulip.dispose();
 });
 it('reuses a bounded dense planting lattice while walking and growing, and restores its exact placement',()=>{
  const t=terrainAt(),dense=new DenseTulips({},{value:12},{value:1},{value:0.45});
  const geometry=dense.mesh.geometry,cells=geometry.getAttribute('aCell').array;
  expect(geometry.instanceCount).toBe(50176);expect(DENSE_SPACING).toBeLessThanOrEqual(0.35);
  const lod=tulipGeometry(false);expect(lod.getAttribute('position').count/3).toBe(22);lod.dispose();
  dense.update(t,t.layout.cottage,t.layout.homeBearing,4);
  const initial=dense.grid.value.toArray();
  for(const radius of [40,400,128]){
   const other=terrainAt(radius);dense.update(other,other.farms[14].direction,other.farms[14].along,4);
   expect(dense.grid.value.toArray().every(Number.isFinite)).toBe(true);expect(dense.mesh.geometry).toBe(geometry);expect(geometry.getAttribute('aCell').array).toBe(cells);
  }
  dense.update(t,t.layout.cottage,t.layout.homeBearing,4);expect(dense.grid.value.toArray()).toEqual(initial);
  dense.update(t,t.layout.cottage,t.layout.homeBearing,200);expect(dense.mesh.visible).toBe(false);dense.dispose();
 });
 for(const radius of [40,128,400])it(`keeps the lowland dry and within culling bounds at R${radius}`,()=>{
  const t=terrainAt(radius),d=new Vector3(),sample=createGroundSample();
  for(let i=0;i<400;i++){
   const y=1-2*(i+0.5)/400,a=i*2.399963;d.set(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
   t.sample(d,sample);expect(sample.height).toBeGreaterThan(0);expect(sample.height).toBeLessThan(t.maxHeight);expect(sample.depth).toBe(0);
  }
 });
 it('repeats seeded field placement, excludes mills and spans both hemispheres',()=>{
  const t=terrainAt(),sites=tulipSites(t),mills=millSites(t),farms=farmSites(t.layout,t.radius);
  expect(sites.length).toBeGreaterThan(30000);expect(sites.length).toBeLessThan(70000);
  expect(tulipSites(t)).toEqual(sites);
  expect(mills.some(m=>m.direction.dot(t.layout.cottage)<-0.2)).toBe(true);
  for(const s of sites){expect(s.direction.length()).toBeCloseTo(1,7);expect(s.colour).toBeGreaterThanOrEqual(0);expect(s.colour).toBeLessThan(6);expect(farms.every(m=>!inFarmPlot(s.direction,m,t.radius))).toBe(true);}
  expect(tulipSites(terrainAt(128,731))[0]).not.toEqual(sites[0]);
  for(const x of [-100,-20,0,100])expect(fieldColour(x,27)).toBeGreaterThanOrEqual(0);
 });
 for(const radius of [40,128,400])it(`aligns farm ridges with rows and connects every gate to a field track at R${radius}`,()=>{
  const t=terrainAt(radius),farms=t.farms,cottages=farms.filter(s=>s.kind==='cottage');
  expect(cottages).toHaveLength(6);expect(new Set(cottages.map(s=>s.variant)).size).toBe(3);
  expect(cottages.some(s=>s.direction.dot(t.layout.cottage)<-0.25)).toBe(true);
  expect(farms.length).toBeLessThanOrEqual(FARM_LIMIT);
  for(const s of farms){
   expect(s.across.dot(s.direction)).toBeCloseTo(0,7);expect(s.along.dot(s.direction)).toBeCloseTo(0,7);
   const before=s.direction.clone().addScaledVector(s.along,-0.001).normalize(),after=s.direction.clone().addScaledVector(s.along,0.001).normalize();
   expect(Math.abs(fieldPhase(...fieldCoordinates(after,t.layout))-fieldPhase(...fieldCoordinates(before,t.layout)))).toBeLessThan(0.00001);
   const gate=s.direction.clone().addScaledVector(s.across,s.gate*s.scale/radius).addScaledVector(s.along,8*s.scale/radius).normalize();
   const phase=fieldPhase(...fieldCoordinates(gate,t.layout));expect(phase-Math.floor(phase)).toBeCloseTo(0.97,4);
   expect(inFarmPlot(s.direction,s,radius)).toBe(true);
   expect(inFarmPlot(gate,s,radius)).toBe(true);
  }
 });
});
