import { describe,expect,it } from 'vitest';
import { Vector3 } from 'three';
import { Terrain,generateLayout,createGroundSample } from '../planet/terrain';
import { tulipGeometry,windmillGeometry,windmillSailsGeometry,cottageGeometry } from '../life/tulipGeometry';
import { tulipSites,millSites } from '../life/tulipScenery';
import { farmGround,farmSites,FARM_LIMIT } from '../life/farmLayout';
import { TRACK,bedOf,breaksAt,doubleBed,fieldCell,fieldCoordinates,fieldPhase,runStart } from '../life/fieldGrid';
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
  for(const s of sites){expect(s.direction.length()).toBeCloseTo(1,7);expect(s.colour).toBeGreaterThanOrEqual(0);expect(s.colour).toBeLessThan(6);expect(farms.every(m=>farmGround(s.direction,m,t.radius,t.layout)===null)).toBe(true);}
  expect(tulipSites(terrainAt(128,731))[0]).not.toEqual(sites[0]);
 });
 it('keeps every ribbon near its home width out to both poles, with no pinch',()=>{
  const layout=terrainAt().layout,d=new Vector3(),t1=new Vector3(),t2=new Vector3(),h=2e-4,widths:number[]=[];
  const at=(a:number,b:number):[number,number]=>fieldCoordinates(d.clone().addScaledVector(t1,a).addScaledVector(t2,b).normalize(),layout);
  for(let i=0;i<4000;i++){
   const y=1-2*(i+0.5)/4000,a=i*2.399963;d.set(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
   t1.crossVectors(d,Math.abs(d.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();t2.crossVectors(d,t1);
   const s=[at(h,0),at(-h,0),at(0,h),at(0,-h)];
   // Skip samples straddling the far meridian or a cap's edge, where the pattern legitimately restarts.
   if(s.some(p=>Math.abs(p[0]-s[0][0])>5||Math.abs(p[1]-s[0][1])>5))continue;
   const g1=fieldPhase(...s[0])-fieldPhase(...s[1]),g2=fieldPhase(...s[2])-fieldPhase(...s[3]);
   widths.push(2*h*128/Math.hypot(g1,g2));
  }
  // 8.6 m at the home; meridian ribbons once narrowed to 0.13 m at the poles.
  expect(widths.length).toBeGreaterThan(3900);
  expect(Math.min(...widths)).toBeGreaterThan(0.8*8.63);expect(Math.max(...widths)).toBeLessThan(1.1*8.63);
 });
 it('varies the beds: runs of one to four blocks, double beds and resting runs, the home beds as before',()=>{
  const runs=new Map<number,number>(),colours=new Set<number>();let doubles=0,fallow=0,cells=0;
  for(let lead=-200;lead<200;lead++){
   if(bedOf(lead)!==lead)continue;
   // Run lengths between breaks along each bed, away from the cap rings.
   let last=NaN;for(let n=3;n<60;n++)if(breaksAt(lead,n)){if(!Number.isNaN(last))runs.set(n-last,(runs.get(n-last)??0)+1);last=n;}
   if(lead>=-4&&lead<=8)for(const k of [-1,0,1]){
    const cell=fieldCell(lead*9-24-0.18*(k*52)+4.5,k*52+5);
    expect(cell.stripe).toBe(lead);expect(cell.colour).toBe(((lead+k)%6+6)%6);expect(cell.rowGap&&cell.runEnd&&!cell.fallow).toBe(true);
   }
  }
  for(let j=-100;j<100;j++)if(doubleBed(j))doubles++;
  for(let x=-400;x<400;x+=3)for(let z=-75;z<75;z+=7){const c=fieldCell(x,z);cells++;colours.add(c.colour);if(c.fallow)fallow++;}
  expect([...runs.keys()].sort()).toEqual([1,2,3,4]);
  expect(runs.get(1)!).toBeLessThan(runs.get(2)!+runs.get(3)!+runs.get(4)!);
  expect(doubles).toBeGreaterThan(40);expect(doubles).toBeLessThan(80);
  expect(colours.size).toBe(6);
  expect(fallow/cells).toBeGreaterThan(0.08);expect(fallow/cells).toBeLessThan(0.3);
  // The cap rings are continuous tracks, and a run never outlasts four blocks.
  for(let lead=-60;lead<60;lead++){expect(breaksAt(lead,-1)&&breaksAt(lead,2)).toBe(true);for(let k=-30;k<30;k++)expect(runStart(lead,k)).toBeGreaterThan(k-4);}
 });
 for(const radius of [40,128,400])it(`sets each farm in a lawn of whole beds whose front track its walk meets, at R${radius}`,()=>{
  const t=terrainAt(radius),farms=t.farms,cottages=farms.filter(s=>s.kind==='cottage');
  expect(cottages).toHaveLength(6);expect(new Set(cottages.map(s=>s.variant)).size).toBe(3);
  expect(cottages.some(s=>s.direction.dot(t.layout.cottage)<-0.25)).toBe(true);
  expect(farms.length).toBeLessThanOrEqual(FARM_LIMIT);
  const local=(s:typeof farms[number],x:number,z:number):Vector3=>s.direction.clone().addScaledVector(s.across,x*s.scale/radius).addScaledVector(s.along,z*s.scale/radius).normalize();
  for(const s of farms){
   expect(s.across.dot(s.direction)).toBeCloseTo(0,7);expect(s.along.dot(s.direction)).toBeCloseTo(0,7);
   const before=s.direction.clone().addScaledVector(s.along,-0.001).normalize(),after=s.direction.clone().addScaledVector(s.along,0.001).normalize();
   expect(Math.abs(fieldPhase(...fieldCoordinates(after,t.layout,s.lot.region))-fieldPhase(...fieldCoordinates(before,t.layout,s.lot.region)))).toBeLessThan(0.00001);
   // Whole beds: the lot's sides are real row gaps, not the middle of a double bed.
   const L=s.lot;expect(bedOf(L.i0)).toBe(L.i0);expect(bedOf(L.i1+1)).toBe(L.i1+1);
   expect(L.i1-L.i0).toBeLessThan(12);expect(L.zh-L.zl).toBeLessThan(30*128/radius+6);
   // The whole fenced yard is lawn or soil, and the walk ends in the front track.
   for(let x=-5.8;x<=5.8;x+=0.58)for(let z=-6.6;z<=5.4;z+=0.6)expect(farmGround(local(s,x,z),s,radius,t.layout)).not.toBeNull();
   const end=local(s,0.9,s.walk-0.01);expect(farmGround(end,s,radius,t.layout)).toBe('soil');
   const z=fieldCoordinates(end,t.layout,L.region)[1];expect(z).toBeGreaterThan(L.zh);expect(z).toBeLessThanOrEqual(L.zh+TRACK);
   expect(farmGround(local(s,0,0),s,radius,t.layout)).toBe('lawn');
  }
 });
});
