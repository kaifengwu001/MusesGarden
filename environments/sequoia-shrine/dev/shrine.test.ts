import { describe,expect,it } from 'vitest';
import { Ray,Vector3,type BufferGeometry } from 'three';
import { buildShrineGeometry,SHRINE_LAYOUT,shrineRoofHeight } from '../life/shrineGeometry';
import { Homestead } from '../life/props';

function stoneAt(geometry:BufferGeometry,x:number,z:number):number {
  const ray=new Ray(new Vector3(x,20,z),new Vector3(0,-1,0));
  const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind');
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
  let top=-Infinity;
  for(let i=0;i<p.count;i+=3){
    if(kind.getX(i)!==3)continue;
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    if(ray.intersectTriangle(a,b,c,false,hit))top=Math.max(top,hit.y);
  }
  return top;
}

describe('forest shrine',()=>{
  it('has finite material-separated sanctuary, swept roof and lantern/torii geometry at human scale',()=>{
    const geometry=buildShrineGeometry(412),p=geometry.getAttribute('position');
    for(const name of ['position','normal','uv','aKind'])expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true);
    expect(new Set(Array.from(geometry.getAttribute('aKind').array))).toEqual(new Set([0,1,2,3,4,5,6,7,8]));
    expect(p.count/3).toBeLessThan(15000);
    expect(geometry.boundingBox?.max.y).toBeLessThan(8);
    expect(geometry.boundingBox?.max.z).toBeGreaterThan(12);
    expect(shrineRoofHeight(5,0)).toBeGreaterThan(shrineRoofHeight(4.75,0));
    geometry.dispose();
  });

  it('has real continuous descending stone treads and an open torii passage',()=>{
    const geometry=buildShrineGeometry();
    const heights=SHRINE_LAYOUT.steps.map(step=>stoneAt(geometry,0,(step.z0+step.z1)/2));
    heights.forEach((height,i)=>expect(height).toBeCloseTo([0.72,0.54,0.36,0.18][i],5));
    // No low crossbar, solid decorative gate or stone foundation blocks the passage.
    const p=geometry.getAttribute('position');
    let lowGateTriangles=0;
    for(let i=0;i<p.count;i+=3){
      const triangle=[0,1,2].map(k=>new Vector3().fromBufferAttribute(p,i+k));
      if(triangle.every(v=>Math.abs(v.x)<2.8&&Math.abs(v.z-12)<0.7&&v.y<3.2))lowGateTriangles++;
    }
    expect(lowGateTriangles).toBe(0);
    geometry.dispose();
  });

  it('places its origin on the supplied ground and disposes its resources',()=>{
    const shrine=new Homestead({},12);
    shrine.place(new Vector3(0,138,0),new Vector3(0,1,0),new Vector3(0,0,1));
    expect(shrine.group.matrix.elements.slice(12,15)).toEqual([0,138,0]);
    expect(shrine.group.children).toHaveLength(1);
    shrine.dispose();expect(shrine.group.children).toHaveLength(0);
  });
});
