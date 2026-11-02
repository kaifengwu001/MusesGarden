import { afterAll, describe, expect, test } from 'vitest';
import { createWindfieldAnchors, clearsWindfieldRoutes, type WindfieldAnchor } from '../life/windfieldScenery';
import { makeGeologyPrototypes } from '../life/windGeology';
import { generateLayout } from '../planet/terrain';

const prototypes=makeGeologyPrototypes();
afterAll(()=>prototypes.forEach(p=>{p.geometry.dispose();p.outline.dispose();}));
const position=(a:WindfieldAnchor):readonly[number,number]=>a.local??a.offset??[0,0];

describe('unequal coral fields',()=>{
  test.each([412,413,5])('seed %i has broad colonies, small pockets and a bounded plant budget',seed=>{
    const ecology=createWindfieldAnchors(generateLayout(seed),prototypes),rocks=ecology.rocks;
    const local=ecology.coral.flat().filter(a=>a.local),global=ecology.coral.flat().filter(a=>!a.local);
    const localFields=ecology.colonies.filter(c=>c.anchor.local);
    expect(local.length).toBeGreaterThanOrEqual(350);
    expect(local.length).toBeLessThanOrEqual(680);
    expect(global.length).toBeGreaterThan(400);
    expect(global.length).toBeLessThanOrEqual(3600);
    expect(localFields.filter(c=>c.members>=45&&c.radius>5).length).toBeGreaterThanOrEqual(3);
    expect(localFields.some(c=>c.members<25)).toBe(true);
    for(const a of local)expect(clearsWindfieldRoutes(a.local![0],a.local![1],Math.max(.28,.40*a.scale))).toBe(true);
    const hosts=new Map(rocks.flat().map(a=>[a.id,a]));
    expect(ecology.coral.flat().every(a=>hosts.has(a.rockId)&&a.threshold===hosts.get(a.rockId)!.threshold&&a.scale>=.38&&a.scale<=1.42)).toBe(true);
  });

  test('repeats exactly without duplicate coral roots across touching fields',()=>{
    const a=createWindfieldAnchors(generateLayout(412),prototypes),b=createWindfieldAnchors(generateLayout(412),prototypes);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plants=a.coral.flat();
    const buckets=new Map<string,WindfieldAnchor[]>();
    let smallest=Infinity;
    for(const p of plants) {
      const key=p.local?'local':p.direction.toArray().join(',');
      const prior=buckets.get(key)??[],[x,z]=position(p);
      for(const q of prior) {
        const [qx,qz]=position(q);
        smallest=Math.min(smallest,Math.hypot(x-qx,z-qz)/(p.scale+q.scale));
      }
      prior.push(p);buckets.set(key,prior);
    }
    expect(smallest).toBeGreaterThanOrEqual(.16);
  });
});
