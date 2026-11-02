import { describe,expect,it } from 'vitest';
import { Ray,Vector3,type BufferGeometry } from 'three';
import { Cabin } from '../life/cabin';
import { BENCH,buildCabinGeometry,CABIN_MATERIAL,FLOOR,STEPS,TERRACE } from '../life/cabinGeometry';
import { MuseRoam } from '../life/museRoam';
import { generateLayout,Terrain } from '../planet/terrain';
import { residenceSite,shrineSites } from '../planet/routes';
import type { FieldParams } from '../planet/fields';

const fields:FieldParams={roll:1.25,hummocks:0.12,wetlands:0,waterLevel:0,grain:0.6,density:0,patchiness:0.78,patchSize:13,weights:[0.4,0.24,0.22,0.14]};
function supportAt(g:BufferGeometry,x:number,z:number):number {
  const ray=new Ray(new Vector3(x,1,z),new Vector3(0,-1,0));
  const p=g.getAttribute('position'),a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
  let top=-Infinity;
  for(let i=0;i<p.count;i+=3){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    if(ray.intersectTriangle(a,b,c,false,hit))top=Math.max(top,hit.y);
  }
  return top;
}
function localDirection(terrain:Terrain,x:number,z:number):Vector3 {
  const site=residenceSite(terrain.layout,terrain.radius),across=new Vector3().crossVectors(site.dir,site.forward).normalize();
  const d=Math.hypot(x,z),angle=Math.asin(d/terrain.radius);
  return site.dir.clone().multiplyScalar(Math.cos(angle)).addScaledVector(across,Math.sin(angle)*x/d).addScaledVector(site.forward,Math.sin(angle)*z/d).normalize();
}

describe('Muse separate forest home',()=>{
  it('has finite domestic materials and actual porch supports matching its walking constants',()=>{
    const geometry=buildCabinGeometry(412);
    for(const key of ['position','normal','uv','aKind'])expect(Array.from(geometry.getAttribute(key).array).every(Number.isFinite)).toBe(true);
    expect(new Set(Array.from(geometry.getAttribute('aKind').array))).toEqual(new Set(Object.values(CABIN_MATERIAL)));
    expect(geometry.boundingBox!.max.y).toBeLessThan(5.5);
    expect(supportAt(geometry,0.4,4.3)).toBeCloseTo(FLOOR,5);
    for(let i=0;i<STEPS.count;i++)expect(supportAt(geometry,0,TERRACE.z1+(i+0.5)*STEPS.tread)).toBeCloseTo(Math.max(0,FLOOR-(i+1)*STEPS.rise),5);
    geometry.dispose();
  });
  it('places cabin at the supplied residence ground and disposes it',()=>{
    const cabin=new Cabin({},412);
    cabin.place(new Vector3(0,131,0),new Vector3(0,1,0),new Vector3(0,0,1));
    expect(cabin.group.matrix.elements.slice(12,15)).toEqual([0,131,0]);
    cabin.dispose();expect(cabin.group.children).toHaveLength(0);
  });
  it('anchors home bench and walking supports at the cabin, separate from the shrine at every growth size',()=>{
    for(const radius of [40,128,400]){
      const terrain=new Terrain(generateLayout(412));terrain.update(radius,fields,2*radius/512);
      const home=residenceSite(terrain.layout,radius),roam=new MuseRoam(terrain,1.65),seat=roam.benchSeat();
      expect(Math.acos(home.dir.dot(terrain.layout.cottage))*radius).toBeGreaterThan(30);
      expect(Math.acos(Math.min(1,seat.dir.dot(home.dir)))*radius).toBeLessThan(5);
      expect(seat.height).toBeCloseTo(terrain.residenceGround+FLOOR+BENCH.seat,5);
      expect(roam.groundAt(localDirection(terrain,0.4,4.3))).toBeCloseTo(terrain.residenceGround+FLOOR,5);
      for(let i=0;i<STEPS.count;i++)expect(roam.groundAt(localDirection(terrain,0,TERRACE.z1+(i+0.5)*STEPS.tread))).toBeCloseTo(terrain.residenceGround+Math.max(0,FLOOR-(i+1)*STEPS.rise),5);
    }
  });
  it('keeps actual outings out of sanctuary buildings at small and normal growth, without dry-land fishing',()=>{
    for(const radius of [40,128]){
      const terrain=new Terrain(generateLayout(412));terrain.update(radius,fields,0.5);
      const home=residenceSite(terrain.layout,radius),camera=home.dir.clone().multiplyScalar(radius+17);
      const shrines=shrineSites(terrain.layout,radius),roam=new MuseRoam(terrain,1.65);
      for(let time=0;time<=2400;time+=5){
        const life=roam.at(time,camera);
        expect(life.cues.fish).toBeNull();
        expect(life.dir.toArray().every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(life.height)).toBe(true);
        expect(Math.acos(Math.min(1,life.dir.dot(home.dir)))*radius).toBeLessThanOrEqual(24.01);
        for(const shrine of shrines){
          if(life.dir.dot(shrine.dir)<0.5)continue;
          const across=new Vector3().crossVectors(shrine.dir,shrine.forward).normalize();
          const x=life.dir.dot(across)*radius,z=life.dir.dot(shrine.forward)*radius,s=shrine.scale;
          expect(Math.abs(x)<4.35*s+0.4&&z>-4*s-0.4&&z<4.15*s+0.4).toBe(false);
        }
      }
      expect(roam.names.some(segment=>/fish|pier|shore/.test(segment.name))).toBe(false);
      expect(roam.names.some(segment=>segment.name==='bench'||segment.name==='cook')).toBe(true);
    }
  });
});
