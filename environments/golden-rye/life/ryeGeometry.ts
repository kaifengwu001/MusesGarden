import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** One legible cereal stalk: curved jointed stem, drooping alternate grain
 * kernels, and long awns. Material parts: stem0 / kernels1 / awns2 / leaf3. */
export function ryeStalkGeometry():BufferGeometry {
  const positions:number[]=[],normals:number[]=[],parts:number[]=[],along:number[]=[];
  const face=(a:Vector3,b:Vector3,c:Vector3,part:number):void=>{
    const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for(const p of [a,b,c]){positions.push(p.x,p.y,p.z);normals.push(normal.x,normal.y,normal.z);parts.push(part);along.push(Math.max(0,Math.min(1,p.y/1.45)));}
  };
  const ribbon=(a:Vector3,b:Vector3,width:number,side:Vector3,part:number):void=>{
    const q0=a.clone().addScaledVector(side,-width),q1=a.clone().addScaledVector(side,width);
    const q2=b.clone().addScaledVector(side,width*.62),q3=b.clone().addScaledVector(side,-width*.62);
    face(q0,q1,q2,part);face(q0,q2,q3,part);
  };
  const stem=(t:number):Vector3=>new Vector3(0.18*t*t,1.45*t-0.08*t*t,0.075*t*t);
  for(let i=0;i<4;i++){
    const p=stem(i/4),q=stem((i+1)/4),width=.0105*(1-i*.17);
    ribbon(p,q,width,new Vector3(1,0,0),0);
    ribbon(p,q,width,new Vector3(0,0,1),0);
  }
  const tip=stem(1);
  const ear=(t:number):Vector3=>tip.clone().add(new Vector3(.35*t,.12*t-.36*t*t,.055*t));
  for(let i=0;i<4;i++)ribbon(ear(i/4),ear((i+1)/4),.009,new Vector3(0,0,1),0);
  for(let i=0;i<10;i++){
    const t=.045+i*.086,sign=i%2===0?-1:1;
    const root=ear(t);
    const axis=new Vector3(.05,.09,sign*.052).normalize();
    const size=.098+Math.sin(t*Math.PI)*.035;
    const point=root.clone().addScaledVector(axis,size);
    const across=new Vector3(-axis.y,axis.x,0).normalize();
    const mid=root.clone().addScaledVector(axis,size*.48);
    const left=mid.clone().addScaledVector(across,.021),right=mid.clone().addScaledVector(across,-.021);
    // Two pointed faces make the swollen, narrow kernel, not a flower blade.
    face(root,left,point,1);face(root,point,right,1);
    const awnEnd=point.clone().add(new Vector3(.13+.08*t,.19+.10*t,sign*(.10+.04*t)));
    const awnSide=new Vector3(.003,0,sign*.002);
    face(point.clone().sub(awnSide),point.clone().add(awnSide),awnEnd,2);
  }
  for(const [height,side] of [[.37,-1],[.65,1]]){
    const root=stem(height),mid=root.clone().add(new Vector3(side*.12,.20,.025));
    const end=root.clone().add(new Vector3(side*.31,.12,.08));
    const rim=mid.clone().add(new Vector3(0,0,.017));
    face(root,mid,rim,3);face(mid,end,rim,3);
  }
  const raw=new BufferGeometry();
  raw.setAttribute('position',new Float32BufferAttribute(positions,3));
  raw.setAttribute('normal',new Float32BufferAttribute(normals,3));
  raw.setAttribute('aPart',new Float32BufferAttribute(parts,1));
  raw.setAttribute('aAlong',new Float32BufferAttribute(along,1));
  raw.setAttribute('aRyeRoot',new Float32BufferAttribute(new Float32Array(positions.length/3*2),2));
  const result=mergeVertices(raw,1e-7);raw.dispose();
  result.computeBoundingSphere();
  result.userData.kernelCount=10;
  result.userData.awnCount=10;
  return result;
}

/** Three distant cereal silhouettes replace dozens of sub-pixel kernel
 * faces. Each keeps a stem, bowed ear, awn and leaf; only 18 triangles. */
export function ryeDistantGeometry():BufferGeometry {
  const positions:number[]=[],normals:number[]=[],parts:number[]=[],along:number[]=[],roots:number[]=[];
  let rootX=0,rootZ=0;
  const face=(a:Vector3,b:Vector3,c:Vector3,part:number):void=>{
    const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for(const p of [a,b,c]){positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);parts.push(part);along.push(Math.max(0,Math.min(1,p.y/1.45)));roots.push(rootX,rootZ);}
  };
  for(const [x,z,h,turn] of [[-.44,.25,1.30,.3],[.38,.2,1.48,2.2],[0,-.39,1.18,4.4]]){
    rootX=x;rootZ=z;
    const across=new Vector3(Math.cos(turn),0,Math.sin(turn));
    const root=new Vector3(x,0,z),tip=new Vector3(x+.17,h,z+.04);
    const left=root.clone().addScaledVector(across,-.018),right=root.clone().addScaledVector(across,.018);
    face(left,right,tip.clone().addScaledVector(across,.011),0);face(left,tip.clone().addScaledVector(across,.011),tip.clone().addScaledVector(across,-.011),0);
    const end=tip.clone().add(new Vector3(.36,-.17,.05));
    const middle=tip.clone().lerp(end,.48).add(new Vector3(0,.06,0));
    face(tip,middle.clone().addScaledVector(across,.045),end,1);face(tip,end,middle.clone().addScaledVector(across,-.045),1);
    face(end.clone().addScaledVector(across,-.004),end.clone().addScaledVector(across,.004),end.clone().add(new Vector3(.16,.18,.09)),2);
    const leafRoot=root.clone().lerp(tip,.45);
    face(leafRoot,leafRoot.clone().addScaledVector(across,.24).add(new Vector3(0,.16,0)),leafRoot.clone().addScaledVector(across,.13).add(new Vector3(0,.22,.025)),3);
  }
  const raw=new BufferGeometry();
  raw.setAttribute('position',new Float32BufferAttribute(positions,3));raw.setAttribute('normal',new Float32BufferAttribute(normals,3));raw.setAttribute('aPart',new Float32BufferAttribute(parts,1));raw.setAttribute('aAlong',new Float32BufferAttribute(along,1));
  raw.setAttribute('aRyeRoot',new Float32BufferAttribute(roots,2));
  const result=mergeVertices(raw,1e-7);raw.dispose();result.computeBoundingSphere();return result;
}
