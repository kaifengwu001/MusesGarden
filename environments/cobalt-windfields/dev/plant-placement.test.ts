import { afterAll, describe, expect, test } from 'vitest';
import { createWindfieldAnchors, clearsWindfieldRoutes, type WindfieldAnchor } from '../life/windfieldScenery';
import { makeGeologyPrototypes } from '../life/windGeology';
import { generateLayout } from '../planet/terrain';

const prototypes=makeGeologyPrototypes();
afterAll(()=>prototypes.forEach(prototype=>{prototype.geometry.dispose();prototype.outline.dispose();}));

const plans=new Map<number,ReturnType<typeof createWindfieldAnchors>>();
const planFor=(seed:number)=>{
  let plan=plans.get(seed);
  if(!plan){plan=createWindfieldAnchors(generateLayout(seed),prototypes);plans.set(seed,plan);}
  return plan;
};
const domains=(anchors:WindfieldAnchor[]):WindfieldAnchor[][]=>{
  const groups=new Map<string,WindfieldAnchor[]>();
  for(const anchor of anchors){
    const key=anchor.local?'local':anchor.direction.toArray().join(',');
    const group=groups.get(key)??[];group.push(anchor);groups.set(key,group);
  }
  return [...groups.values()];
};

const separation=(a:WindfieldAnchor,b:WindfieldAnchor):number=>{
  if(a.local&&b.local) return Math.hypot(a.local[0]-b.local[0],a.local[1]-b.local[1]);
  if(!a.local&&!b.local&&a.direction.distanceToSquared(b.direction)<1e-12) {
    return Math.hypot((a.offset?.[0]??0)-(b.offset?.[0]??0),(a.offset?.[1]??0)-(b.offset?.[1]??0));
  }
  return Infinity;
};

describe('windfield living colonies',()=>{
  test.each([412,413,5])('seed %i keeps several ages and blade bearings in the local scene',seed=>{
    const plan=planFor(seed);
    const local=plan.sails.flat().filter(anchor=>anchor.local);
    const sizes=local.map(anchor=>anchor.scale),bearings=local.map(anchor=>anchor.turn);
    expect(local.length).toBeGreaterThan(10);
    expect(Math.max(...sizes)/Math.min(...sizes)).toBeGreaterThan(3.5);
    expect(Math.min(...sizes)).toBeLessThan(0.65);
    expect(Math.max(...sizes)).toBeGreaterThan(1.45);
    expect(Math.max(...bearings)-Math.min(...bearings)).toBeGreaterThan(2.5);
    const cohorts=new Map<string,number[]>();
    for(const anchor of local) cohorts.set(anchor.rockId!,[...(cohorts.get(anchor.rockId!)??[]),anchor.scale]);
    expect([...cohorts.values()].filter(scales=>scales.length>1&&Math.max(...scales)/Math.min(...scales)>2).length).toBeGreaterThan(3);
    for(const anchor of local) expect(clearsWindfieldRoutes(anchor.local![0],anchor.local![1],0.42+0.32*anchor.scale)).toBe(true);
  });

  test('roots stay separate where neighbouring rock habitats overlap',()=>{
    const plan=planFor(412);
    for(const [groups,spacing] of [[plan.sails,0.34],[plan.coral,0.16]] as const) {
      let nearestRatio=Infinity;
      for(const anchors of domains(groups.flat())) for(let i=0;i<anchors.length;i++)for(let j=0;j<i;j++) {
        nearestRatio=Math.min(nearestRatio,separation(anchors[i],anchors[j])/(anchors[i].scale+anchors[j].scale));
      }
      expect(nearestRatio).toBeGreaterThanOrEqual(spacing);
    }
    let duplicateSurfaces=0;
    for(const category of plan.rocks) for(const group of domains(category)) for(let i=0;i<group.length;i++) for(let j=0;j<i;j++) {
      const a=group[i],b=group[j];
      const sameSurface=separation(a,b)<0.06&&Math.abs(a.scale-b.scale)<0.015&&Math.abs(Math.sin((a.turn-b.turn)/2))<0.006;
      if(sameSurface)duplicateSurfaces++;
    }
    expect(duplicateSurfaces).toBe(0);
  });
});
