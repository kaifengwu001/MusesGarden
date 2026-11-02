import { BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { cottageSite, type CottageSite } from '../planet/cottageSite';
import { COTTAGE_PAVING, COTTAGE_PAVING_EDGE } from '../planet/cottagePaving';
import { cottageGradedLocalGround } from '../planet/cottageGround';
import { createHuiCottageGeometry } from './huiCottageGeometry';

interface StoneBuilder { positions:number[]; colors:number[]; }
const STONE=new Color('#89918a'),MORTAR=new Color('#69756c');

/** A single supported yard and retaining skirt. Its top is partitioned into
 * paver faces and mortar strips, never coincident full-floor overlays. */
function courtyardFoundation(site:CottageSite,seed:number):Mesh<BufferGeometry,MeshStandardMaterial>{
  const out:StoneBuilder={positions:[],colors:[]};
  function triangle(a:Vector3,b:Vector3,c:Vector3,color:Color):void{
    out.positions.push(...a.toArray(),...b.toArray(),...c.toArray());
    for(let i=0;i<3;i++)out.colors.push(color.r,color.g,color.b);
  }
  function cap(x0:number,x1:number,z0:number,z1:number,y:number,color:Color):void{
    const a=new Vector3(x0,y,z0),b=new Vector3(x0,y,z1),c=new Vector3(x1,y,z1),d=new Vector3(x1,y,z0);
    triangle(a,b,c,color);triangle(a,c,d,color);
  }
  function side(x0:number,z0:number,x1:number,z1:number,y:number,color:Color):void{
    const a=new Vector3(x0,y,z0),b=new Vector3(x1,y,z1);
    const c=new Vector3(x1,Math.min(y-.1,cottageGradedLocalGround(site,x1,z1,seed)-.08),z1);
    const d=new Vector3(x0,Math.min(y-.1,cottageGradedLocalGround(site,x0,z0,seed)-.08),z0);
    const clipHeight=(polygon:Vector3[],height:number,above:boolean):Vector3[]=>{
      const result:Vector3[]=[];
      for(let i=0;i<polygon.length;i++){
        const p=polygon[i],q=polygon[(i+1)%polygon.length];
        const pv=(p.y-height)*(above?1:-1),qv=(q.y-height)*(above?1:-1);
        if(pv>=0)result.push(p);
        if(pv*qv<0)result.push(p.clone().lerp(q,pv/(pv-qv)));
      }
      return result;
    };
    const bottom=Math.min(c.y,d.y),course=.32;
    for(let row=Math.floor(bottom/course);row<Math.ceil(y/course);row++){
      const lo=row*course,hi=Math.min(y,(row+1)*course),seam=Math.min(hi,lo+.018);
      const value=unit(hash32(seed^hash32(Math.round(x0*19+z0*31)+row*731)));
      for(const [low,high,tint] of [[lo,seam,.72],[seam,hi,.94+value*.09]]){
        if(high-low<1e-7)continue;
        const polygon=clipHeight(clipHeight([a,b,c,d],low,true),high,false);
        const stone=color.clone().multiplyScalar(tint);
        for(let i=1;i<polygon.length-1;i++)triangle(polygon[0],polygon[i],polygon[i+1],stone);
      }
    }
  }
  for(const {x0,x1,z0,z1} of COTTAGE_PAVING){
  const columns=Math.ceil(x1-x0),rows=Math.ceil(z1-z0);
  const width=(x1-x0)/columns,depth=(z1-z0)/rows,gap=.018;
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const x=x0+column*width,z=z0+row*depth;
    const tint=unit(hash32(seed^hash32(row*731+column*353)));
    const color=STONE.clone().multiplyScalar(.88+tint*.17);
    cap(x+gap,x+width-gap,z+gap,z+depth-gap,0,color);
    cap(x,x+gap,z,z+depth,0,MORTAR);cap(x+width-gap,x+width,z,z+depth,0,MORTAR);
    cap(x+gap,x+width-gap,z,z+gap,0,MORTAR);cap(x+gap,x+width-gap,z+depth-gap,z+depth,0,MORTAR);
  }
  }
  // Counter-clockwise perimeter makes outward faces. Sample every metre,
  // including each bank-height transition, to bury the foundation foot.
  const corners=COTTAGE_PAVING_EDGE.map(([x,z])=>new Vector3(x,0,z));
  for(let edge=0;edge<corners.length;edge++){
    const a=corners[edge],b=corners[(edge+1)%corners.length],count=Math.ceil(a.distanceTo(b)*2);
    for(let i=0;i<count;i++){
      const left=a.clone().lerp(b,i/count),right=a.clone().lerp(b,(i+1)/count);
      side(left.x,left.z,right.x,right.z,0,STONE.clone().multiplyScalar(.82));
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(out.positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(out.colors,3));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const material=new MeshStandardMaterial({vertexColors:true,roughness:1});
  const mesh=new Mesh(geometry,material);mesh.name='Compact courtyard paving and house foot';mesh.castShadow=true;mesh.receiveShadow=true;
  return mesh;
}

export function createHuiCottage(seed:number){
  const site=cottageSite(seed),building=createHuiCottageGeometry(),foundation=courtyardFoundation(site,seed),group=new Group();
  group.name='Muse’s Hui courtyard cottage';
  group.position.copy(site.direction).multiplyScalar(site.floorRadius);
  group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(site.right,site.direction,site.forward));
  group.add(foundation,building.group);
  const stats={...building.stats,foundationTriangles:foundation.geometry.getAttribute('position').count/3,
    pavingFootprint:COTTAGE_PAVING.reduce((sum,r)=>sum+(r.x1-r.x0)*(r.z1-r.z0),0),stairs:0,
    direction:site.direction.toArray(),floorRadius:site.floorRadius,groundRelief:site.maxGround-site.minGround,wetFraction:site.wetFraction,
    gateClearance:site.gateClearance,flankRise:site.flankRise,backRise:site.backRise};
  return {group,site,stats,dispose(){building.dispose();foundation.geometry.dispose();foundation.material.dispose();group.clear();}};
}
