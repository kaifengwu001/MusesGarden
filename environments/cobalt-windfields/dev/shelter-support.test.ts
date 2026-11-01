import { expect, test } from 'vitest';
import { Ray, Vector3 } from 'three';
import { FLOOR, shelterSupportGeometry } from '../life/props';

test('shelter, terrace, lookout and steps have one supported cap per point',()=>{
  const geometry=shelterSupportGeometry(),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
  const capArea=new Map<number,number>();
  const caps:Array<readonly [Vector3,Vector3,Vector3]>=[];
  for(let i=0;i<position.count;i+=3){
    const triangle=[0,1,2].map(offset=>new Vector3().fromBufferAttribute(position,i+offset)) as [Vector3,Vector3,Vector3];
    if(normal.getY(i)<.99)continue;
    const [a,b,c]=triangle;
    expect(Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y)).toBeLessThan(1e-6);
    const area=b.clone().sub(a).cross(c.clone().sub(a)).length()*.5;
    const level=Math.round(a.y*100);
    capArea.set(level,(capArea.get(level)??0)+area);
    caps.push(triangle);
  }
  // Inclusion-exclusion of the authored footprints gives 78.506 m² for
  // the main union, plus 0.594 m² for each 1.8 × 0.33 m step. Duplicate caps
  // would add their overlap to these totals even if the first ray hit passed.
  expect(capArea.get(72)).toBeCloseTo(79.1,4);
  expect(capArea.get(48)).toBeCloseTo(.594,4);
  expect(capArea.get(24)).toBeCloseTo(.594,4);
  const points:readonly (readonly [number,number,number])[]=[
    [0,0,FLOOR],[-3.891,2.491,FLOOR],[-3.891,3.917,FLOOR],[-7.17,5.17,FLOOR],
    [3.217,4.897,FLOOR],[3.217,5.227,.48],[3.217,5.557,.24],
  ];
  for(const [x,z,height] of points){
    const ray=new Ray(new Vector3(x,10,z),new Vector3(0,-1,0)),hit=new Vector3();
    const heights=caps.flatMap(([a,b,c])=>ray.intersectTriangle(a,b,c,false,hit)?[hit.y]:[]);
    expect(heights).toHaveLength(1);
    expect(heights[0]).toBeCloseTo(height,6);
  }
  geometry.dispose();
});
