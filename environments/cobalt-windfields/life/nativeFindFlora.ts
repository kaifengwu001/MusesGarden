import { BufferAttribute, InstancedBufferGeometry, Vector3, type BufferGeometry } from 'three';
import { PART, packShape, type CollectibleMesh, type Form, type Part } from './collectibleForms';
import { WindGeometry } from './windGeometry';

/** Saved-find IDs/topics stay unchanged. Their world representation is native
 * coral, ivory sail leaves or cobalt fragments, including pre-existing finds. */
export const NATIVE_FIND_SPECIES = ['coral roots','ivory seed sail','young coral roots','young seed sail'] as const;
const P=(x:number,y:number,z:number):Vector3=>new Vector3(x,y,z);

function roundedStem(b:WindGeometry,points:Vector3[],radii:number[],part:Part):void {
  b.tube(points,radii,part,6);
  const end=points[points.length-1],radius=radii[radii.length-1];
  const axis=end.clone().sub(points[points.length-2]).normalize();
  const x=axis.clone().cross(Math.abs(axis.z)<0.9?P(0,0,1):P(1,0,0)).normalize(),y=axis.clone().cross(x);
  const ring=(lift:number,width:number):Vector3[]=>Array.from({length:6},(_,i)=>end.clone().addScaledVector(axis,lift*radius).addScaledVector(x,Math.cos(i/6*Math.PI*2)*radius*width).addScaledVector(y,Math.sin(i/6*Math.PI*2)*radius*width));
  const base=ring(0,1),rim=ring(0.7,Math.sqrt(0.51)),tip=end.clone().addScaledVector(axis,radius);
  for(let i=0;i<6;i++){const j=(i+1)%6;b.quad(base[i],base[j],rim[j],rim[i],part);b.triangle(rim[i],rim[j],tip,part);}
}

function nativeGeometry(kind:'coral'|'sail'|'stone',variant=0):BufferGeometry {
  const b=new WindGeometry();
  if(kind==='sail') {
    roundedStem(b,[P(0,0,0),P(0.025,0.32,0.01),P(-0.04,0.67,0.035)],[0.022,0.016,0.008],PART.stem);
    const leaf=(root:Vector3,h:number,w:number):void=>{
      const tip=root.clone().add(P(-w*0.7,h,0.025));
      const left=root.clone().add(P(-w,h*0.47,0.05));
      const right=root.clone().add(P(w*0.52,h*0.57,0.025));
      const mid=root.clone().lerp(tip,0.49).add(P(0,0,0.035));
      const corners=[root,right,tip,left];
      for(let i=0;i<4;i++)b.triangle(corners[i],corners[(i+1)%4],mid,PART.leaf);
      roundedStem(b,[root,mid,tip],[0.006,0.004,0.001],PART.stem);
    };
    leaf(P(-0.04,0.58,0.035),0.42,0.23+variant*0.018);
    leaf(P(0.018,0.28,0.01),0.29,0.15);
  } else if(kind==='coral') {
    // A shallow young fan repeats the mature colony's rounded branching habit.
    const fan: readonly (readonly [number,number,number][])[] = [
      [[0,0,.040],[.02,.22,.036],[-.01,.47,.030],[.03,.72,.023],[.01,.88,.021]],
      [[.02,.22,.034],[-.16,.35,.030],[-.29,.54,.025],[-.35,.73,.021]],
      [[-.16,.35,.028],[-.35,.39,.024],[-.45,.57,.020]],
      [[-.01,.47,.029],[.17,.51,.027],[.30,.69,.023],[.34,.84,.020]],
      [[.17,.51,.025],[.37,.52,.023],[.46,.67,.020]],
      [[.03,.72,.024],[-.10,.79,.021],[-.13,.98,.020]],
    ];
    for(const path of fan) {
      const points=path.map(([x,y])=>P(x,y,.025*Math.sin(x*3.1+variant*.2)*y));
      roundedStem(b,points,path.map(node=>node[2]),PART.petal);
    }
  } else {
    const bottom=[P(-0.42,-0.025,-0.29),P(0.36,-0.025,-0.34),P(0.44,-0.025,0.25),P(-0.35,-0.025,0.34)];
    const top=[P(-0.32,0.72,-0.23),P(0.17,1,-0.2),P(0.29,0.81,0.18),P(-0.23,0.66,0.27)];
    for(let i=0;i<4;i++)b.quad(bottom[i],bottom[(i+1)%4],top[(i+1)%4],top[i],PART.stone);
    b.quad(top[0],top[1],top[2],top[3],PART.stone);
    b.quad(bottom[3],bottom[2],bottom[1],bottom[0],PART.stone);
  }
  const geometry=b.build();
  // These specimens can number in the hundreds. Share coplanar triangle
  // vertices while retaining hard material edges and their actual normals.
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),k=geometry.getAttribute('aKind');
  const roundedNormals=new Map<string,Vector3>();
  const pointKey=(i:number):string=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',')+`,`+k.getX(i);
  for(let i=0;i<p.count;i++)if(k.getX(i)===PART.stem||k.getX(i)===PART.petal) {
    const key=pointKey(i),normal=roundedNormals.get(key)??new Vector3();
    normal.add(P(n.getX(i),n.getY(i),n.getZ(i)));roundedNormals.set(key,normal);
  }
  for(const normal of roundedNormals.values())normal.normalize();
  const unique=new Map<string,number>(),positions:number[]=[],normals:number[]=[],kinds:number[]=[],indices:number[]=[];
  for(let i=0;i<p.count;i++) {
    const smooth=roundedNormals.get(pointKey(i));
    const point=[p.getX(i),p.getY(i),p.getZ(i)],normal=smooth?[smooth.x,smooth.y,smooth.z]:[n.getX(i),n.getY(i),n.getZ(i)];
    const key=[...point.map(v=>Math.round(v*1e6)),...normal.map(v=>Math.round(v*1e5)),k.getX(i)].join(',');
    let index=unique.get(key);
    if(index===undefined) {index=unique.size;unique.set(key,index);positions.push(...point);normals.push(...normal);kinds.push(k.getX(i));}
    indices.push(index);
  }
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('normal',new BufferAttribute(new Float32Array(normals),3));
  geometry.setAttribute('aKind',new BufferAttribute(new Float32Array(kinds),1));
  geometry.deleteAttribute('uv');geometry.setIndex(indices);
  geometry.name=`Cobalt native find ${kind}`;return geometry;
}

export function nativeBedGeometry(species:number):InstancedBufferGeometry {
  const source=nativeGeometry(species%2?'sail':'coral',species);
  const geometry=new InstancedBufferGeometry();
  const position=source.getAttribute('position').clone();
  const part=source.getAttribute('aKind').clone();
  const height=species%2?0.52:0.34;
  const t=new Float32Array(position.count);
  for(let i=0;i<position.count;i++) {
    t[i]=Math.max(0,position.getY(i));
    position.setXYZ(i,position.getX(i)*height,position.getY(i)*height,position.getZ(i)*height);
  }
  geometry.setAttribute('position',position);geometry.setAttribute('normal',source.getAttribute('normal').clone());
  geometry.setAttribute('aPart',part);geometry.setAttribute('aT',new BufferAttribute(t,1));
  geometry.setIndex(source.getIndex()!.clone());
  geometry.name=`Cobalt find-bed ${NATIVE_FIND_SPECIES[species]}`;
  source.dispose();return geometry;
}
export const NATIVE_BED_MESH=[0,1,2,3].map(species=>()=>nativeBedGeometry(species));

export function buildNativeFindMesh(forms:readonly Form[]):CollectibleMesh {
  const geometries=forms.map(form=>nativeGeometry(form.family==='stone'?'stone':(form.kin&1)?'sail':'coral',(form.self>>>4)%3));
  const count=geometries.reduce((sum,g)=>sum+g.getAttribute('position').count,0);
  const position=new Float32Array(count*3),normal=new Int8Array(count*4),shape=new Uint16Array(count*2);
  const indexCount=geometries.reduce((sum,g)=>sum+g.getIndex()!.count,0);
  const index=count>65535?new Uint32Array(indexCount):new Uint16Array(indexCount);
  let offset=0,indexOffset=0;
  geometries.forEach((geometry,find)=>{
    const form=forms[find],p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),parts=geometry.getAttribute('aKind');
    const cy=Math.cos(form.yaw),sy=Math.sin(form.yaw),cl=Math.cos(form.lean),sl=Math.sin(form.lean);
    const rotate=(x:number,y:number,z:number):[number,number,number]=>{
      const h=y*cl-z*sl,d=y*sl+z*cl;return[x*cy+d*sy,h,d*cy-x*sy];
    };
    for(let i=0;i<p.count;i++) {
      const at=offset+i,part=parts.getX(i) as Part;
      position.set(rotate(p.getX(i)*form.height,p.getY(i)*form.height,p.getZ(i)*form.height),at*3);
      const facing=rotate(n.getX(i),n.getY(i),n.getZ(i));
      normal.set([...facing.map(v=>Math.round(v*127)),0],at*4);
      shape[at*2]=packShape(part,Math.max(0,p.getY(i)));shape[at*2+1]=find;
    }
    for(const vertex of geometry.getIndex()!.array)index[indexOffset++]=offset+vertex;
    offset+=p.count;geometry.dispose();
  });
  return {position,normal,shape,index};
}
