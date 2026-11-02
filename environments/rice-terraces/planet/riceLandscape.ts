import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { unit } from '../../../src/core/hash';
import { RICE_RADIUS, RICE_STEP, riceParcelCoordinate, riceParcelPhase, ricePlotState, riceSmoothHeight } from './riceFields';
import type { CottageSite } from './cottageSite';
import { cottageGradeWeight, cottageGroundRadius } from './cottageGround';

interface Vertex { q:Vector3; h:number; p:number; }
interface Builder { positions:number[]; normals:number[]; colors:number[]; site?:CottageSite; }
export interface RiceLandscapeStats { triangles:number; plots:number; terraceLevels:number; waterTriangles:number; landTriangles:number; bankTriangles:number; resolution:number; }
export interface RiceLandscape { group:Group; stats:RiceLandscapeStats; dispose():void; }
const BANK_HEIGHT=.12;
const BAND_BANK=.045;
const PARCEL_BANK=.012;
const GREENS=['#536a31','#708542','#8ca34b','#3f572c','#9aaa50','#5e7835'].map(value=>new Color(value));
const WATER=new Color('#e9e7ee');
const FOREST=new Color('#526239');
const BANK=new Color('#bdc59a');
const EARTH=new Color('#69764b');

function builder(site?:CottageSite):Builder{return {positions:[],normals:[],colors:[],site};}

/** Half-space clipping retains the original affine cube-face direction.
 * It is normalized only when emitted, so adjacent triangles agree exactly
 * at contour/plot intersections and all six cube seams share their vertices. */
function clip(input:readonly Vertex[],value:(vertex:Vertex)=>number):Vertex[]{
  if(input.length<3)return [];
  const result:Vertex[]=[];
  for(let i=0;i<input.length;i++){
    const a=input[i],b=input[(i+1)%input.length],av=value(a),bv=value(b);
    if(av>=-1e-12)result.push(a);
    if((av>1e-12&&bv<-1e-12)||(av<-1e-12&&bv>1e-12)){
      const t=av/(av-bv);
      result.push({q:a.q.clone().lerp(b.q,t),h:a.h+(b.h-a.h)*t,p:a.p+(b.p-a.p)*t});
    }
  }
  return result;
}

function intersection(input:readonly Vertex[],value:(vertex:Vertex)=>number):readonly [Vector3,Vector3]|null{
  const hits:Vector3[]=[];
  for(let i=0;i<input.length;i++){
    const a=input[i],b=input[(i+1)%input.length],av=value(a),bv=value(b);
    if(Math.abs(av)<1e-10)hits.push(a.q);
    if(av*bv<0)hits.push(a.q.clone().lerp(b.q,av/(av-bv)));
  }
  const unique=hits.filter((v,i)=>hits.findIndex(other=>other.distanceToSquared(v)<1e-18)===i);
  return unique.length>=2?[unique[0],unique[1]]:null;
}

function emitTriangle(out:Builder,points:readonly Vector3[],color:Color,radial:boolean):void{
  const nearby=out.site&&points.some(point=>point.dot(out.site!.direction)>point.length()*.985);
  if(nearby)points=points.map(point=>{
    const direction=point.clone().normalize();
    return direction.multiplyScalar(cottageGroundRadius(direction,point.length(),out.site!));
  });
  const [a,b,c]=points;
  const face=new Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a));
  if(face.lengthSq()<1e-14)return;
  const vertices=radial&&face.dot(a)<0?[a,c,b]:points;
  if(radial&&face.dot(a)<0)face.negate();
  face.normalize();
  for(const p of vertices){
    const n=radial?p.clone().normalize():face;
    if(radial&&nearby)n.lerp(out.site!.direction,cottageGradeWeight(n,out.site!)).normalize();
    out.positions.push(p.x,p.y,p.z);out.normals.push(n.x,n.y,n.z);out.colors.push(color.r,color.g,color.b);
  }
}

function emitPolygon(out:Builder,polygon:readonly Vertex[],height:number,color:Color):void{
  if(polygon.length<3)return;
  const points=polygon.map(v=>v.q.clone().normalize().multiplyScalar(RICE_RADIUS+height));
  for(let i=1;i<points.length-1;i++)emitTriangle(out,[points[0],points[i],points[i+1]],color,true);
}

function emitWall(out:Builder,line:readonly [Vector3,Vector3],low:number,high:number,color:Color):void{
  const a=line[0].clone().normalize(),b=line[1].clone().normalize();
  const a0=a.clone().multiplyScalar(RICE_RADIUS+low),a1=a.multiplyScalar(RICE_RADIUS+high);
  const b0=b.clone().multiplyScalar(RICE_RADIUS+low),b1=b.multiplyScalar(RICE_RADIUS+high);
  emitTriangle(out,[a0,b1,b0],color,false);emitTriangle(out,[a0,a1,b1],color,false);
}

function geometry(out:Builder):BufferGeometry{
  const result=new BufferGeometry();
  result.setAttribute('position',new Float32BufferAttribute(out.positions,3));
  result.setAttribute('normal',new Float32BufferAttribute(out.normals,3));
  result.setAttribute('color',new Float32BufferAttribute(out.colors,3));
  result.computeBoundingSphere();
  return result;
}

/** A sphere of true contour-cut treads, earthen risers and raised narrow banks.
 * Each triangle is sliced at every crossed field level; quantizing only its
 * vertices would create the coarse diagonal teeth this avoids. */
export function createRiceLandscape(seed:number,resolution=96,site?:CottageSite):RiceLandscape{
  const land=builder(site),water=builder(site),banks=builder(site);
  const plots=new Set<number>(),levels=new Set<number>();
  const capStrip=(polygon:Vertex[],value:(v:Vertex)=>number,height:number):Vertex[]=>{
    const strip=clip(polygon,v=>-value(v));
    emitPolygon(banks,strip,height+BANK_HEIGHT,BANK);
    const line=intersection(polygon,value);
    if(line)emitWall(banks,line,height,height+BANK_HEIGHT,EARTH);
    return clip(polygon,value);
  };
  const triangle=(a:Vertex,b:Vertex,c:Vertex):void=>{
    const vertices=[a,b,c];
    const min=Math.floor(Math.min(a.h,b.h,c.h)/RICE_STEP),max=Math.floor(Math.max(a.h,b.h,c.h)/RICE_STEP);
    for(let band=min;band<=max;band++){
      const lo=band*RICE_STEP,hi=lo+RICE_STEP;
      const polygon=clip(clip(vertices,v=>v.h-lo),v=>hi-v.h);
      if(polygon.length<3)continue;
      levels.add(band);
      const phase=riceParcelPhase(seed,band);
      const first=Math.floor(Math.min(...polygon.map(v=>v.p))+phase);
      const last=Math.floor(Math.max(...polygon.map(v=>v.p))+phase);
      // Short curved dividers belong to this level only. Carry the scalar
      // through every clip; re-sampling noise at generated vertices would
      // make neighbours disagree and could open gaps at contour junctions.
      for(let region=first;region<=last;region++){
        let parcel=clip(clip(polygon,v=>v.p+phase-region),v=>region+1-v.p-phase);
        if(parcel.length<3)continue;
        const state=ricePlotState(seed,region,band);
        plots.add(state.plot);
        // Raised perimeter banks are actual narrow strips, partitioned from
        // the paddy floor; there is no broad coplanar bank overlay.
        parcel=capStrip(parcel,v=>v.h-(lo+BAND_BANK),lo);
        parcel=capStrip(parcel,v=>(hi-BAND_BANK)-v.h,lo);
        parcel=capStrip(parcel,v=>v.p+phase-region-PARCEL_BANK,lo);
        parcel=capStrip(parcel,v=>region+1-PARCEL_BANK-v.p-phase,lo);
        const color=state.forest?FOREST:state.wet?WATER:GREENS[Math.floor(unit(state.plot)*GREENS.length)%GREENS.length];
        emitPolygon(state.wet?water:land,parcel,lo,color);
      }
    }
    // A single wall owns each contour inside this triangle. The upper and
    // lower cap banks end at this wall, never at a sloped interpolated wedge.
    for(let band=min+1;band<=max;band++){
      const line=intersection(vertices,v=>v.h-band*RICE_STEP);
      if(line)emitWall(banks,line,(band-1)*RICE_STEP+BANK_HEIGHT,band*RICE_STEP+BANK_HEIGHT,EARTH);
    }
  };
  const faceDirection=(face:number,u:number,v:number):Vector3=>{
    const directions=[new Vector3(1,v,-u),new Vector3(-1,v,u),new Vector3(u,1,-v),new Vector3(u,-1,v),new Vector3(u,v,1),new Vector3(-u,v,-1)];
    return directions[face].normalize();
  };
  for(let face=0;face<6;face++){
    const vertices:Vertex[]=Array.from({length:(resolution+1)*(resolution+1)},(_,i)=>{
      const x=i%(resolution+1),y=Math.floor(i/(resolution+1));
      const q=faceDirection(face,x/resolution*2-1,y/resolution*2-1);
      return {q,h:riceSmoothHeight(q,seed),p:riceParcelCoordinate(q,seed)};
    });
    for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
      const a=vertices[y*(resolution+1)+x],b=vertices[y*(resolution+1)+x+1];
      const c=vertices[(y+1)*(resolution+1)+x],d=vertices[(y+1)*(resolution+1)+x+1];
      triangle(a,b,d);triangle(a,d,c);
    }
  }
  const group=new Group();group.name='Contour-cut rice paddies, water and earth banks';
  const dryMaterial=new MeshStandardMaterial({vertexColors:true,roughness:.94,metalness:0});
  const waterMaterial=new MeshStandardMaterial({vertexColors:true,roughness:.3,metalness:.02});
  const bankMaterial=new MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:DoubleSide});
  const dryMesh=new Mesh(geometry(land),dryMaterial),waterMesh=new Mesh(geometry(water),waterMaterial),bankMesh=new Mesh(geometry(banks),bankMaterial);
  dryMesh.name='Green rice plots and dry woodland islands';waterMesh.name='Pale flooded rice paddies';bankMesh.name='Raised pale banks and earthen terrace risers';
  for(const mesh of [dryMesh,waterMesh,bankMesh]){mesh.receiveShadow=true;mesh.castShadow=mesh!==waterMesh;group.add(mesh);}
  const count=(b:Builder):number=>b.positions.length/9;
  const stats: RiceLandscapeStats={triangles:count(land)+count(water)+count(banks),plots:plots.size,terraceLevels:levels.size,waterTriangles:count(water),landTriangles:count(land),bankTriangles:count(banks),resolution};
  group.userData.stats=stats;
  return {group,stats,dispose(){for(const mesh of [dryMesh,waterMesh,bankMesh])mesh.geometry.dispose();dryMaterial.dispose();waterMaterial.dispose();bankMaterial.dispose();group.clear();}};
}
