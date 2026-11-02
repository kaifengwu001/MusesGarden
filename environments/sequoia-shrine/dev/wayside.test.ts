import { describe,expect,it } from 'vitest';
import { Ray,Vector3,type BufferGeometry } from 'three';
import { buildWaysideShrineGeometry,WAYSIDE_STEPS } from '../life/waysideShrineGeometry';

function topStone(geometry:BufferGeometry,x:number,z:number):number {
  const ray=new Ray(new Vector3(x,15,z),new Vector3(0,-1,0)),p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind');
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();let top=-Infinity;
  for(let i=0;i<p.count;i+=3){
    if(kind.getX(i)!==3)continue;
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    if(ray.intersectTriangle(a,b,c,false,hit))top=Math.max(top,hit.y);
  }
  return top;
}

describe('distinct wayside sanctuaries',()=>{
  it('has three different human-scale silhouettes with compatible finite materials',()=>{
    const sizes:number[][]=[];
    for(let variant=0;variant<3;variant++){
      const geometry=buildWaysideShrineGeometry(variant,412),size=geometry.boundingBox!.getSize(new Vector3());sizes.push(size.toArray());
      for(const key of ['position','normal','uv','aKind'])expect(Array.from(geometry.getAttribute(key).array).every(Number.isFinite)).toBe(true);
      expect(geometry.getAttribute('position').count/3).toBeLessThan(15000);
      expect(size.y).toBeGreaterThan(3.5);expect(size.y).toBeLessThan(6);
      expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
      expect(geometry.boundingBox!.min.x).toBeGreaterThan(-7);expect(geometry.boundingBox!.max.x).toBeLessThan(7);
      expect(geometry.boundingBox!.min.z).toBeGreaterThan(-9);expect(geometry.boundingBox!.max.z).toBeLessThan(14);
      expect(Array.from(geometry.getAttribute('aKind').array).every(k=>Number.isInteger(k)&&k>=0&&k<=8)).toBe(true);
      geometry.dispose();
    }
    expect(new Set(sizes.map(s=>s.join(','))).size).toBe(3);
    expect(sizes[1][1]).toBeLessThan(sizes[0][1]);expect(sizes[0][1]).toBeLessThan(sizes[2][1]);
  });

  it('connects every sanctuary porch to the same descending open stone approach',()=>{
    for(let variant=0;variant<3;variant++){
      const geometry=buildWaysideShrineGeometry(variant);
      expect(topStone(geometry,0,3.95)).toBeCloseTo(0.72,5);
      for(const step of WAYSIDE_STEPS)expect(topStone(geometry,0,(step.z0+step.z1)/2)).toBeCloseTo(step.height,5);
      // Stone gate sits high above walking height; the centre remains open.
      if(variant===1){
        const p=geometry.getAttribute('position');let obstructing=0;
        for(let i=0;i<p.count;i+=3){
          if([0,1,2].every(k=>Math.abs(p.getX(i+k))<2.0&&Math.abs(p.getZ(i+k)-10.3)<0.7&&p.getY(i+k)<2.0))obstructing++;
        }
        expect(obstructing).toBe(0);
      }
      geometry.dispose();
    }
  });
});
