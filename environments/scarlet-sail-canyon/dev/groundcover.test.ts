import { describe, expect, it } from 'vitest';
import { Ray, Vector3 } from 'three';
import { generateGroundcoverSites, groundcoverSupport, mossPlantCommunity, selectMossTreeSites } from '../life/canyonGroundcover';
import { mossGeometry, plantedMossGeometry } from '../life/canyonGeometry';
import { generateCanyonRockSites } from '../life/canyonDistribution';
import type { Terrain } from '../planet/terrain';

const up=new Vector3(0,1,0),x=new Vector3(1,0,0),z=new Vector3(0,0,1);
function surface(height:(x:number,z:number)=>number):Terrain {
  return {radius:128,sample(dir:Vector3,out:{height:number}){
    out.height=height(dir.x/dir.y*128,dir.z/dir.y*128);return out;
  }} as unknown as Terrain;
}

describe('open-land vegetation',()=>{
  it('selects a capped, spaced, repeatable tree population from existing moss without moving its source sites',()=>{
    const sites=generateGroundcoverSites(412,generateCanyonRockSites(412));
    const before=JSON.stringify(sites),references=sites.slice(),supplied=new Set(sites);
    const selected=selectMossTreeSites(412,sites);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(880);
    expect(new Set(selected.map(tree=>tree.site)).size).toBe(selected.length);
    for(const [i,tree] of selected.entries()){
      expect(supplied.has(tree.site)).toBe(true);
      expect(Number.isFinite(tree.scale)).toBe(true);
      expect(tree.scale).toBeGreaterThan(0);
      expect(tree.scale).toBeLessThan(tree.site.scale);
      expect(Number.isFinite(tree.phase)).toBe(true);
      for(let j=0;j<i;j++)expect(tree.site.direction.dot(selected[j].site.direction)).toBeLessThanOrEqual(Math.cos(0.05)+1e-12);
    }
    expect(new Set(selected.map(tree=>tree.scale)).size).toBeGreaterThan(1);
    expect(new Set(selected.map(tree=>tree.phase)).size).toBeGreaterThan(1);
    selectMossTreeSites(771,sites);
    expect(selectMossTreeSites(412,sites)).toEqual(selected);
    expect(JSON.stringify(sites)).toBe(before);
    expect(sites.every((site,i)=>site===references[i])).toBe(true);
    const subset=sites.filter((_,i)=>i%29===0),subsetReferences=new Set(subset);
    expect(selectMossTreeSites(412,subset).every(tree=>subsetReferences.has(tree.site))).toBe(true);
    expect(selectMossTreeSites(412,[])).toEqual([]);
  });

  it('roots both understory communities in the actual raised moss surface',()=>{
    const moss=mossGeometry(1),original=moss.getAttribute('position');
    for(const variant of [0,1]){
      const geometry=plantedMossGeometry(variant),p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind');
      // Replacing a plain mat must preserve its entire body, not duplicate or
      // remove its support while adding the plant community.
      expect(Array.from(p.array).slice(0,original.array.length)).toEqual(Array.from(original.array));
      const kinds=new Set(Array.from(kind.array));
      expect(kinds).toEqual(new Set([9,8,variant===0?Math.fround(3.3):Math.fround(3.1)]));
      expect(p.count/3).toBeLessThan(500);
      const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
      for(const root of geometry.userData.plantRoots as {x:number;y:number;z:number}[]){
        const ray=new Ray(new Vector3(root.x,3,root.z),new Vector3(0,-1,0));
        let top=-Infinity;
        for(let i=0;i<p.count;i+=3){
          if(kind.getX(i)!==9)continue;
          a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
          if(ray.intersectTriangle(a,b,c,false,hit))top=Math.max(top,hit.y);
        }
        expect(top-root.y).toBeGreaterThan(0);
        expect(top-root.y).toBeLessThan(0.025);
        expect(root.y).toBeGreaterThan(0.08);
      }
      geometry.dispose();
    }
    moss.dispose();
  });

  it('keeps varied planted pockets interspersed with open moss deterministically',()=>{
    const sites=generateGroundcoverSites(412,generateCanyonRockSites(412));
    const choices=sites.map(site=>mossPlantCommunity(412,site.direction));
    const planted=choices.filter(choice=>choice>=0).length;
    expect(planted).toBeGreaterThan(sites.length*0.2);
    expect(planted).toBeLessThan(sites.length*0.36);
    expect(new Set(choices)).toEqual(new Set([-1,0,1]));
    expect(sites.map(site=>mossPlantCommunity(412,site.direction))).toEqual(choices);
  });

  it('fits a gentle continuous plane but rejects cliffs and interior humps',()=>{
    const slope=groundcoverSupport(surface((x,z)=>12+0.12*x-0.08*z),up,x,z,3);
    expect(slope?.[0]).toBeCloseTo(0.12,8);
    expect(slope?.[1]).toBeCloseTo(-0.08,8);
    expect(groundcoverSupport(surface(x=>x>0.2?6:0),up,x,z,3)).toBeNull();
    expect(groundcoverSupport(surface((x,z)=>0.4*Math.exp(-x*x-z*z)),up,x,z,3)).toBeNull();
    expect(groundcoverSupport(surface(x=>x*0.7),up,x,z,3)).toBeNull();
  });

  it('creates repeatable broad colonies in rock-poor spaces without changing rock sites',()=>{
    const rocks=generateCanyonRockSites(412);
    const prior=JSON.stringify(rocks);
    const sites=generateGroundcoverSites(412,rocks);
    expect(sites.length).toBeGreaterThan(1000);
    expect(sites.length).toBeLessThan(20*880);
    generateGroundcoverSites(771,generateCanyonRockSites(771));
    expect(generateGroundcoverSites(412,rocks)).toEqual(sites);
    expect(JSON.stringify(rocks)).toBe(prior);
    const colony=sites.filter(site=>site.colony===0);
    expect(colony.some(a=>colony.some(b=>a.direction.dot(b.direction)<Math.cos(0.35)))).toBe(true);
    for(const site of sites){
      expect(site.direction.length()).toBeCloseTo(1,8);
      expect(rocks.every(rock=>rock.direction.dot(site.direction)<=Math.cos(0.065))).toBe(true);
    }
  });
});
