import { Vector3, type BufferGeometry } from 'three';

interface Triangle {
  index: number;
  points: Vector3[];
  normal: Vector3;
  plane: number;
  min: Vector3;
  max: Vector3;
}
export interface CoplanarOverlap { first: number; second: number; area: number; low: number; high: number }

/** Positive-area overlaps only: shared tessellation edges are not conflicts. */
export function coplanarOverlaps(geometry: BufferGeometry): CoplanarOverlap[] {
  const position=geometry.getAttribute('position'),triangles:Triangle[]=[];
  for(let i=0;i<position.count;i+=3) {
    const points=[0,1,2].map(j=>new Vector3().fromBufferAttribute(position,i+j));
    const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    const min=points.reduce((v,p)=>v.min(p),new Vector3(Infinity,Infinity,Infinity));
    const max=points.reduce((v,p)=>v.max(p),new Vector3(-Infinity,-Infinity,-Infinity));
    triangles.push({index:i/3,points,normal,plane:normal.dot(points[0]),min,max});
  }
  type Point=readonly [number,number];
  const cross=(a:Point,b:Point,c:Point):number=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const twiceArea=(points:Point[]):number=>points.reduce((sum,p,i)=>sum+p[0]*points[(i+1)%points.length][1]-p[1]*points[(i+1)%points.length][0],0);
  const output:CoplanarOverlap[]=[];
  for(let i=0;i<triangles.length;i++) for(let j=i+1;j<triangles.length;j++) {
    const a=triangles[i],b=triangles[j];
    if(a.min.x>b.max.x+1e-6||b.min.x>a.max.x+1e-6||a.min.y>b.max.y+1e-6||b.min.y>a.max.y+1e-6||a.min.z>b.max.z+1e-6||b.min.z>a.max.z+1e-6)continue;
    if(Math.abs(a.normal.dot(b.normal))<1-1e-7)continue;
    if(b.points.some(p=>Math.abs(a.normal.dot(p)-a.plane)>2e-6))continue;
    const n=a.normal,drop=Math.abs(n.x)>Math.abs(n.y)&&Math.abs(n.x)>Math.abs(n.z)?0:Math.abs(n.y)>Math.abs(n.z)?1:2;
    const project=(p:Vector3):Point=>drop===0?[p.y,p.z]:drop===1?[p.x,p.z]:[p.x,p.y];
    let polygon=a.points.map(project);
    const clip=b.points.map(project);
    if(twiceArea(clip)<0)clip.reverse();
    for(let edge=0;edge<3&&polygon.length;edge++) {
      const start=clip[edge],end=clip[(edge+1)%3],next:Point[]=[];
      for(let k=0;k<polygon.length;k++) {
        const p=polygon[k],q=polygon[(k+1)%polygon.length],dp=cross(start,end,p),dq=cross(start,end,q);
        if(dp>=-1e-9)next.push(p);
        if((dp>1e-9&&dq< -1e-9)||(dp< -1e-9&&dq>1e-9)) {
          const t=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);
        }
      }
      polygon=next;
    }
    if(polygon.length<3)continue;
    const area=Math.abs(twiceArea(polygon))*.5/Math.abs(n.getComponent(drop));
    if(area>1e-6)output.push({first:a.index,second:b.index,area,low:Math.min(a.min.y,b.min.y),high:Math.max(a.max.y,b.max.y)});
  }
  return output;
}
