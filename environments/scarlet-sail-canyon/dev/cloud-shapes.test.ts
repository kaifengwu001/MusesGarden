import { describe, expect, it } from 'vitest';
import { hash32, unit } from '../../../src/core/hash';
import { makeCloudPuffs } from '../life/cloudShapes';

function random(seed:number):()=>number {
  let state=seed;
  return ()=>unit(state=hash32((state+0x9e3779b9)>>>0));
}

describe('Scarlet cloud families',()=>{
  it('retains the eight-puff layout inside the existing animated culling bound',()=>{
    for(let family=0;family<5;family++)for(let seed=0;seed<128;seed++){
      const puffs=makeCloudPuffs(random(seed),family);
      expect(puffs).toHaveLength(8);
      for(const puff of puffs){
        expect(Object.values(puff).every(Number.isFinite)).toBe(true);
        expect(puff.r).toBeGreaterThan(0);
        expect(Math.hypot(puff.x,puff.y-.45,puff.z)+puff.r*1.05).toBeLessThan(1.45);
      }
    }
  });

  it('repeats each family deterministically and changes its spatial anatomy',()=>{
    const shapes=Array.from({length:5},(_,family)=>makeCloudPuffs(random(412),family));
    shapes.forEach((shape,family)=>expect(makeCloudPuffs(random(412),family)).toEqual(shape));
    const width=(family:number):number=>Math.max(...shapes[family].map(p=>p.x+p.r))-Math.min(...shapes[family].map(p=>p.x-p.r));
    const depth=(family:number):number=>Math.max(...shapes[family].map(p=>p.z+p.r))-Math.min(...shapes[family].map(p=>p.z-p.r));
    expect(width(1)).toBeGreaterThan(width(0)*1.4);
    expect(depth(0)).toBeGreaterThan(depth(1)*1.15);
    // The broken-bank family's two masses are physically separated.
    expect(Math.min(...shapes[2].slice(5).map(p=>p.x-p.r))).toBeGreaterThan(Math.max(...shapes[2].slice(0,5).map(p=>p.x+p.r)));
    expect(new Set(shapes.map(shape=>JSON.stringify(shape))).size).toBe(5);
  });
});
