import { describe,expect,it } from 'vitest';
import { Vector3,Vector4 } from 'three';
import { createRyeSites,createNearRyeSites,ryeLaneClear,ryeCellDirection,RYE_SITE_LIMIT,RYE_NEAR_LIMIT,RYE_FAR_GRID } from '../life/ryeDistribution';
import { ryeStalkGeometry,ryeDistantGeometry } from '../life/ryeGeometry';
import { RyeFields } from '../life/rye';
import { Terrain,generateLayout,createGroundSample } from '../planet/terrain';
import { gpuMemory } from '../../../src/core/gpuMemory';
import type { FieldParams } from '../planet/fields';

const PARAMS:FieldParams={roll:2.2,hummocks:.12,wetlands:0,waterLevel:0,grain:.48,density:0,patchiness:.9,patchSize:16,weights:[0,0,0,0]};

describe('Golden Rye crop anatomy and placement',()=>{
  it('has real bending ears, alternate kernel faces and long awns in finite geometry',()=>{
    const geometry=ryeStalkGeometry(),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),part=geometry.getAttribute('aPart');
    expect(geometry.index).not.toBeNull();expect(geometry.userData.kernelCount).toBe(10);expect(geometry.userData.awnCount).toBe(10);expect(geometry.index!.count/3).toBeLessThan(65);
    expect(new Set(Array.from(part.array))).toEqual(new Set([0,1,2,3]));
    let maxAwn=0,minRoot=Infinity;
    for(let i=0;i<p.count;i++){
      expect([p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))).toBeCloseTo(1,5);if(part.getX(i)===2)maxAwn=Math.max(maxAwn,p.getX(i));minRoot=Math.min(minRoot,p.getY(i));
    }
    expect(maxAwn).toBeGreaterThan(.6);expect(minRoot).toBe(0);
    const distant=ryeDistantGeometry();expect(distant.index!.count/3).toBe(18);
    expect(geometry.index!.count/3*RYE_NEAR_LIMIT+distant.index!.count/3*RYE_SITE_LIMIT).toBeLessThan(2_500_000);
    geometry.dispose();distant.dispose();
  });

  it('covers all six faces without biome gaps or harvesting-lane exclusions',()=>{
    const a=createRyeSites(412),b=createRyeSites(412);
    expect(a).toEqual(b);expect(a.length).toBe(RYE_SITE_LIMIT);
    expect(createRyeSites(771)[1000]).not.toEqual(a[1000]);
    expect(ryeLaneClear(0,0)).toBe(false);expect(ryeLaneClear(0,8)).toBe(true);expect(ryeLaneClear(0,17.5)).toBe(true);expect(ryeLaneClear(22,30)).toBe(true);
    const perFace=RYE_FAR_GRID*RYE_FAR_GRID;
    for(let face=0;face<6;face++){
      const axis=ryeCellDirection(face,0,0);
      const facePoints=a.slice(face*perFace,(face+1)*perFace);
      expect(facePoints).toHaveLength(perFace);
      for(let i=0;i<facePoints.length;i+=13){expect(facePoints[i].direction.length()).toBeCloseTo(1,8);expect(facePoints[i].direction.dot(axis)).toBeGreaterThan(.57);}
    }
    // Independent spherical probes bound empty holes, including face seams.
    let worst=0;
    for(let i=0;i<48;i++){
      const y=1-2*(i+.5)/48,t=i*2.3999632297,r=Math.sqrt(1-y*y),probe=new Vector3(r*Math.cos(t),y,r*Math.sin(t));
      let dot=-1;for(const site of a)dot=Math.max(dot,probe.dot(site.direction));worst=Math.max(worst,Math.acos(dot));
    }
    expect(worst).toBeLessThan(.025);
  });

  it('provides dense detailed crop at remote and polar walking focuses through growth',()=>{
    const focuses=[new Vector3(0,1,0),new Vector3(1,0,0),new Vector3(.7,-.4,.3).normalize()];
    for(const radius of [40,128,400])for(const focus of focuses){
      const sites=createNearRyeSites(412,focus,radius);
      expect(sites.length).toBeGreaterThan(6500);expect(sites.length).toBeLessThanOrEqual(RYE_NEAR_LIMIT);
      expect(sites.every(site=>Math.acos(Math.min(1,site.direction.dot(focus)))*radius<18.51)).toBe(true);
    }
    const original=createNearRyeSites(412,focuses[2],128);
    createNearRyeSites(412,focuses[2],400);
    expect(createNearRyeSites(412,focuses[2],128)).toEqual(original);
  });

  it('grounds exact float32 roots, keeps physical anatomy and restores a moved/grown cap',()=>{
    const terrain=new Terrain(generateLayout(412));terrain.update(128,PARAMS,.5);
    const shared={uWarpUp:{value:terrain.layout.cottage.clone()},uFog:{value:new Vector4(0,0,8,0)}};
    const memoryBefore=gpuMemory.total(),rye=new RyeFields(shared,terrain);rye.update(12,terrain);
    expect(rye.instanceCount).toBeGreaterThan(100000);expect(rye.mesh.geometry.instanceCount).toBeGreaterThan(6500);expect(rye.triangles).toBeLessThan(2_500_000);
    expect(gpuMemory.total()-memoryBefore).toBeGreaterThan(5_000_000);expect(gpuMemory.total()-memoryBefore).toBeLessThan(8_000_000);
    const direction=new Vector3(),ground=createGroundSample();
    for(const mesh of [rye.mesh,rye.farMesh]){
      const anchor=mesh.geometry.getAttribute('aRyeAnchor');
      for(let i=0;i<mesh.geometry.instanceCount;i+=389){direction.set(anchor.getX(i),anchor.getY(i),anchor.getZ(i)).normalize();terrain.sample(direction,ground);expect(anchor.getW(i)).toBeCloseTo(ground.height-.015,4);}
    }
    const anchor=rye.mesh.geometry.getAttribute('aRyeAnchor'),initialCount=rye.mesh.geometry.instanceCount,initial=Array.from(anchor.array).slice(0,initialCount*4);
    shared.uWarpUp.value.applyAxisAngle(terrain.layout.homeBearing,.18).normalize();rye.update(12,terrain);
    expect(Array.from(anchor.array).slice(0,rye.mesh.geometry.instanceCount*4)).not.toEqual(initial);
    shared.uWarpUp.value.copy(terrain.layout.cottage);rye.update(12,terrain);
    expect(rye.mesh.geometry.instanceCount).toBe(initialCount);expect(Array.from(anchor.array).slice(0,initialCount*4)).toEqual(initial);
    terrain.update(400,PARAMS,.5);rye.update(23,terrain);expect(rye.triangles).toBeLessThan(2_500_000);
    const size=rye.mesh.geometry.getAttribute('aRyePlant');for(let i=0;i<rye.mesh.geometry.instanceCount;i+=67)expect(size.getW(i)).toBe(1);
    terrain.update(128,PARAMS,.5);rye.update(12,terrain);
    expect(rye.mesh.geometry.instanceCount).toBe(initialCount);expect(Array.from(anchor.array).slice(0,initialCount*4)).toEqual(initial);
    rye.dispose();expect(gpuMemory.total()).toBe(memoryBefore);
  });

  it('refreshes hidden detailed roots after a terrain change in overview',()=>{
    const terrain=new Terrain(generateLayout(412));terrain.update(128,PARAMS,.5);
    let height=3;
    // An independently changing, cheap ground fixture isolates the cache
    // behavior from terrain recipe details. Even eligibility flags cannot
    // remove crop: only the actual building is now a permitted exclusion.
    terrain.sample=(_dir,out)=>Object.assign(out,{height,water:-1,depth:2,clearing:1,wet:1});
    terrain.height=()=>height;
    const shared={uWarpUp:{value:terrain.layout.cottage.clone()},uFog:{value:new Vector4(0,0,8,0)}};
    const rye=new RyeFields(shared,terrain);rye.update(12,terrain);
    expect(rye.mesh.geometry.instanceCount).toBeGreaterThan(6500);
    shared.uFog.value.z=300;rye.update(12,terrain);expect(rye.mesh.geometry.instanceCount).toBe(0);
    height=9;rye.invalidate();rye.update(12,terrain);
    shared.uFog.value.z=8;rye.update(12,terrain);
    const fresh=new RyeFields(shared,terrain);fresh.update(12,terrain);
    const count=fresh.mesh.geometry.instanceCount;
    expect(rye.mesh.geometry.instanceCount).toBe(count);
    const current=rye.mesh.geometry.getAttribute('aRyeAnchor'),expected=fresh.mesh.geometry.getAttribute('aRyeAnchor');
    expect(Array.from(current.array).slice(0,count*4)).toEqual(Array.from(expected.array).slice(0,count*4));
    for(let i=0;i<count;i+=123)expect(current.getW(i)).toBeCloseTo(8.985,4);
    rye.dispose();fresh.dispose();
  });
});
