import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { riceParcelCoordinate, riceParcelPhase } from '../planet/riceFields';

function directions(count:number):Vector3[]{
  return Array.from({length:count},(_,i)=>{
    const y=1-2*(i+.5)/count,a=i*2.3999632297;
    return new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
  });
}

describe('Ti Tian continuous parcel layout',()=>{
  it('varies continuously across every cube edge instead of changing region ownership there',()=>{
    const epsilon=1e-6;
    for(const seed of [1,412,771])for(const t of [-.9,-.4,0,.35,.87]){
      for(let free=0;free<3;free++)for(const a of [-1,1])for(const b of [-1,1]){
        const fixed=[0,1,2].filter(axis=>axis!==free);
        const point=new Vector3().setComponent(free,t).setComponent(fixed[0],a).setComponent(fixed[1],b);
        const across=new Vector3().setComponent(fixed[0],a).setComponent(fixed[1],-b);
        const left=point.clone().addScaledVector(across,-epsilon).normalize();
        const right=point.clone().addScaledVector(across,epsilon).normalize();
        const middle=riceParcelCoordinate(point.normalize(),seed);
        const values=[riceParcelCoordinate(left,seed),riceParcelCoordinate(right,seed)];
        // A tiny step across the mesh-face boundary must not produce a
        // finite plot-coordinate jump. This tests both sides of all 12 edges.
        expect(Math.abs(values[0]-values[1])).toBeLessThan(.001);
        expect(Math.max(...values.map(value=>Math.abs(value-middle)))).toBeLessThan(.001);
      }
    }
  });

  it('does not continue a parcel divider through neighboring terrace levels',()=>{
    const axis=new Vector3(.31,.77,.55).normalize();
    const ring=Array.from({length:129},(_,i)=>new Vector3(Math.cos(i*Math.PI/64),Math.sin(i*Math.PI/64),0).applyAxisAngle(axis,.62));
    for(const seed of [1,412,771])for(const band of [5,9,13,18]){
      const phase=riceParcelPhase(seed,band);
      expect(phase).toBeGreaterThanOrEqual(0);expect(phase).toBeLessThan(1);
      let checked=0;
      for(let i=0;i<ring.length-1&&checked<16;i++){
        const a=ring[i],b=ring[i+1];
        const av=riceParcelCoordinate(a,seed)+phase,bv=riceParcelCoordinate(b,seed)+phase;
        const boundary=Math.ceil(Math.min(av,bv));
        if(boundary>=Math.max(av,bv))continue;
        // Find a real scalar isoline, rather than checking a particular
        // implementation's phase constant or preselected random coordinates.
        let lo=0,hi=1;
        const point=new Vector3();
        for(let step=0;step<40;step++){
          const mid=(lo+hi)*.5;
          const value=riceParcelCoordinate(point.copy(a).lerp(b,mid).normalize(),seed)+phase;
          if((value<boundary)===(av<boundary))lo=mid;else hi=mid;
        }
        point.copy(a).lerp(b,(lo+hi)*.5).normalize();
        const coordinate=riceParcelCoordinate(point,seed);
        expect(Math.abs(coordinate+phase-boundary)).toBeLessThan(1e-7);
        for(const neighbor of [band-1,band+1]){
          const value=coordinate+riceParcelPhase(seed,neighbor);
          // The adjacent level's nearest divider must be well away from
          // this one, preventing the former multi-level panel seams.
          expect(Math.abs(value-Math.round(value))).toBeGreaterThan(.2);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(4);
    }
  });

  it('has bounded geographic variation and regenerates independently of another seed',()=>{
    const points=directions(256);
    const sample=(seed:number):number[]=>points.map(direction=>riceParcelCoordinate(direction,seed));
    const first=sample(412),other=sample(771);
    expect(sample(412)).toEqual(first);
    expect(first).not.toEqual(other);
    for(const values of [first,other]){
      expect(values.every(value=>Number.isFinite(value)&&Math.abs(value)<32)).toBe(true);
      expect(Math.max(...values)-Math.min(...values)).toBeGreaterThan(3);
      expect(new Set(values.map(value=>Math.floor(value))).size).toBeGreaterThan(4);
    }
  });
});
