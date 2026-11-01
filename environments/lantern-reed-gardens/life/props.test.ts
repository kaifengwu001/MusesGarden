import { describe, expect, it } from 'vitest';
import { Vector3, type Mesh, type BufferGeometry } from 'three';
import { BENCH, CHAIR, FLOOR, Homestead, PIER, STEPS, TERRACE } from './props';

type Point2 = readonly [number, number];
type Triangle2 = readonly [Point2, Point2, Point2];
interface Face {
  points: readonly [Vector3, Vector3, Vector3];
  kind: number;
}

function faces(geometry: BufferGeometry): Face[] {
  const position=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind');
  const index=geometry.getIndex(),count=index?.count??position.count;
  return Array.from({length:count/3},(_,i)=>{
    const vertex=(j:number):number=>index?index.getX(i*3+j):i*3+j;
    const point=(j:number):Vector3=>new Vector3().fromBufferAttribute(position,vertex(j));
    return {
      points:[point(0),point(1),point(2)],
      kind:kind.getX(vertex(0)),
    };
  });
}

function projectFace(face: Face,axis: number): Triangle2 {
  const point=(p:Vector3):Point2=>axis===0?[p.y,p.z]:axis===1?[p.x,p.z]:[p.x,p.y];
  return [point(face.points[0]),point(face.points[1]),point(face.points[2])];
}

const cross2=(a:Point2,b:Point2,p:Point2):number=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function area(polygon: readonly Point2[]): number {
  return Math.abs(polygon.reduce((sum,p,i)=>{
    const next=polygon[(i+1)%polygon.length];
    return sum+p[0]*next[1]-p[1]*next[0];
  },0))*0.5;
}

/** Convex polygon clipping measures area, so touching edges aren't failures. */
function intersectionArea(a: Triangle2,b: Triangle2): number {
  for (const axis of [0,1]) {
    if (Math.max(...a.map(p=>p[axis]))<=Math.min(...b.map(p=>p[axis])) || Math.max(...b.map(p=>p[axis]))<=Math.min(...a.map(p=>p[axis]))) return 0;
  }
  const winding=Math.sign(cross2(b[0],b[1],b[2]));
  let result: Point2[]=[...a];
  for (let i=0;i<3;i++) {
    const edge=b[i],next=b[(i+1)%3],input=result;
    result=[];
    if (!input.length) return 0;
    for (let j=0;j<input.length;j++) {
      const p=input[j],q=input[(j+1)%input.length];
      const dp=cross2(edge,next,p)*winding,dq=cross2(edge,next,q)*winding;
      if (dp>=0) result.push(p);
      if ((dp>=0)!==(dq>=0)) {
        const t=dp/(dp-dq);
        result.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);
      }
    }
  }
  return area(result);
}

function horizontalFaces(all: readonly Face[],kind:number,height:number): Triangle2[] {
  return all.filter(face=>face.kind===kind&&face.points.every(p=>Math.abs(p.y-height)<1e-6))
    .map(face=>projectFace(face,1));
}

function contains(triangle: Triangle2,point: Point2): boolean {
  const signs=triangle.map((p,i)=>cross2(p,triangle[(i+1)%3],point));
  return signs.every(s=>s>=-1e-7)||signs.every(s=>s<=1e-7);
}

describe('Lantern cottage surfaces',()=>{
  for (const seed of [5,166,9999]) it(`keeps valid masonry and resident supports at seed ${seed}`,()=>{
    const home=new Homestead({},seed);
    try {
      const all=faces((home.group.children[0] as Mesh<BufferGeometry>).geometry);
      const seen=new Set<string>();
      const invalid: number[]=[],duplicates: number[]=[];
      const masonryPlanes=new Map<string,{normal:Vector3;distance:number;triangle:Triangle2}[]>();
      for (const [i,face] of all.entries()) {
        const [a,b,c]=face.points;
        const normal=b.clone().sub(a).cross(c.clone().sub(a));
        if (!face.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)) || normal.lengthSq()<1e-16) invalid.push(i);
        const key=face.points.map(p=>[p.x,p.y,p.z].map(n=>n.toFixed(6)).join(',')).sort().join('|');
        if (seen.has(key)) duplicates.push(i);
        seen.add(key);
        if (face.kind!==2) continue;
        normal.normalize();
        const components=[normal.x,normal.y,normal.z];
        const axis=components.reduce((best,n,j)=>Math.abs(n)>Math.abs(components[best])?j:best,0);
        if (components[axis]<0) normal.negate();
        const distance=normal.dot(a);
        const planeKey=[normal.x,normal.y,normal.z,distance].map(n=>n.toFixed(4)).join(',');
        const projected=projectFace(face,axis);
        const group=masonryPlanes.get(planeKey)??[];
        group.push({normal,distance,triangle:projected});
        masonryPlanes.set(planeKey,group);
      }
      expect(invalid,'non-finite or zero-area triangles').toEqual([]);
      expect(duplicates,'coincident triangles, regardless of material or winding').toEqual([]);

      let overlappingPairs=0;
      for (const group of masonryPlanes.values()) for(let i=0;i<group.length;i++) for(let j=i+1;j<group.length;j++) {
        const a=group[i],b=group[j];
        if (a.normal.dot(b.normal)>1-1e-8&&Math.abs(a.distance-b.distance)<1e-5&&intersectionArea(a.triangle,b.triangle)>1e-7) overlappingPairs++;
      }
      expect(overlappingPairs,'coplanar stone faces sharing visible area').toBe(0);

      const floor=horizontalFaces(all,2,FLOOR);
      expect(floor.length).toBeGreaterThan(100);
      // Former overlap seams and actual resident lanes must remain supported.
      // A narrow stone joint may sit under the exact point; a 6 cm sole spans it.
      for (const point of [[-3.9,2.45],[-3.9,3.4],[-4.35,3.4],[-6.6,PIER.z1-0.25],[(STEPS.x0+STEPS.x1)/2,TERRACE.z1-0.5]] as Point2[]) {
        const samples=[point,...[0,Math.PI/2,Math.PI,Math.PI*1.5].map(a=>[point[0]+Math.cos(a)*0.06,point[1]+Math.sin(a)*0.06] as Point2)];
        expect(samples.some(sample=>floor.some(triangle=>contains(triangle,sample))),`floor support at ${point.join(',')}`).toBe(true);
      }
      expect(Math.min(...floor.flat().map(p=>p[0]))).toBeCloseTo(PIER.x0+0.016,5);
      expect(Math.max(...floor.flat().map(p=>p[1]))).toBeCloseTo(PIER.z1-0.014,5);
      for (let step=0;step<STEPS.count;step++) {
        const tops=horizontalFaces(all,2,FLOOR-step*STEPS.rise);
        const expectedZ=TERRACE.z1+(step+0.5)*STEPS.tread;
        expect(tops.some(triangle=>contains(triangle,[(STEPS.x0+STEPS.x1)/2-0.15,expectedZ])),'step tread keeps its original height').toBe(true);
      }
      expect(horizontalFaces(all,0,FLOOR+BENCH.seat).some(t=>contains(t,[BENCH.x,BENCH.z])),'bench seat').toBe(true);
      expect(horizontalFaces(all,0,FLOOR+0.465).some(t=>contains(t,[CHAIR.x,CHAIR.z])),'chair seat').toBe(true);
    } finally { home.dispose(); }
  });
});
