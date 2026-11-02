import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Domestic furniture coordinates, shared with Muse's actual walking routine. */
export const FLOOR=0.6;
export const FACE=2.2;
export const SIDE=3.2;
export const TERRACE={x0:-3.8,x1:3.8,z0:2.2,z1:5.1} as const;
export const STEPS={x0:-1.2,x1:1.2,count:3,rise:0.2,tread:0.5} as const;
export const BENCH={x:1.9,z:2.7,half:0.75,depth:0.22,seat:0.44} as const;
export const CHAIR={x:3.1,z:4.25,turn:-0.3} as const;
export const STOVE={x:-2.7,z:4.15,half:0.24} as const;
export const CABIN_MATERIAL={wood:0,trim:1,roof:2,stone:3,window:4,iron:5,leaf:6} as const;

class CabinBuilder {
  private readonly parts:BufferGeometry[]=[];
  add(source:BufferGeometry,kind:number,matrix?:Matrix4):void {
    const g=source.index?source.toNonIndexed():source;
    if(g!==source)source.dispose();
    if(matrix)g.applyMatrix4(matrix);
    const count=g.getAttribute('position').count;
    g.setAttribute('aKind',new Float32BufferAttribute(new Float32Array(count).fill(kind),1));
    this.parts.push(g);
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number,kind:number,turn=0):void {
    this.add(new BoxGeometry(w,h,d),kind,new Matrix4().makeRotationY(turn).setPosition(x,y,z));
  }
  sheet(points:readonly Vector3[],kind:number):void {
    const xyz:number[]=[],uv:number[]=[];
    for(const index of [0,1,2,0,2,3]){const p=points[index];xyz.push(p.x,p.y,p.z);uv.push(p.x,p.z);}
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(xyz,3));
    g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();this.add(g,kind);
  }
  finish():BufferGeometry {
    const g=mergeGeometries(this.parts,false);
    for(const part of this.parts)part.dispose();
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
}

/** A modest cedar dwelling: plain straight gables, porch and household things.
 * No altar, ceremonial gate, vermilion columns or shrine roof profile. */
export function buildCabinGeometry(seed=0):BufferGeometry {
  const b=new CabinBuilder(),m=CABIN_MATERIAL;
  // One continuous supported floor: rear house + front porch meet at z2.2.
  b.box(0,0.2,-0.2,6.7,0.4,5.0,m.stone);
  b.box(0,0.5,-0.15,6.6,0.2,4.7,m.wood);
  b.box(0,0.5,3.65,7.6,0.2,2.9,m.wood);
  for(const x of [-3.5,3.5])for(const z of [2.6,4.8])b.box(x,0.2,z,0.5,0.4,0.5,m.stone);
  for(let i=0;i<STEPS.count;i++){
    const height=FLOOR-(i+1)*STEPS.rise;
    // The last tread is a flush gravel landing, avoiding a false floating step.
    const h=Math.max(0.08,height);
    b.box(0,height-h/2,TERRACE.z1+(i+0.5)*STEPS.tread,STEPS.x1-STEPS.x0,h,STEPS.tread,m.stone);
  }
  // Warm horizontal cedar siding, small single door and two domestic windows.
  b.box(0,1.92,-2.2,6.4,2.64,0.18,m.wood);
  for(const x of [-SIDE,SIDE])b.box(x,1.92,0,0.18,2.64,4.4,m.wood);
  b.box(0,1.92,FACE,6.4,2.64,0.18,m.wood);
  b.box(0,1.68,2.31,1.27,2.16,0.08,m.trim);
  b.box(0,1.67,2.36,1.08,2.05,0.04,m.wood);
  b.box(0.4,1.53,2.41,0.07,0.07,0.05,m.iron);
  for(const x of [-1.85,1.85]){
    b.box(x,2.11,2.31,1.22,1.1,0.1,m.trim);
    b.box(x,2.11,2.37,1.04,0.9,0.04,m.window);
    b.box(x,2.11,2.4,0.06,0.95,0.06,m.trim);
    b.box(x,2.11,2.4,1.08,0.06,0.06,m.trim);
    b.box(x,1.52,2.43,1.37,0.12,0.3,m.trim);
  }
  for(const x of [-3.16,3.16])for(const z of [-2.15,2.15])b.box(x,1.91,z,0.22,2.64,0.22,m.trim);
  // Plain gable with a straight shingle roof; no upturned sacred eaves.
  const ridge=4.6,eave=3.23,roofX=3.75,back=-2.8,front=2.76;
  for(const side of [-1,1]){
    const x=side*roofX;
    b.sheet([new Vector3(0,ridge,back),new Vector3(0,ridge,front),new Vector3(x,eave,front),new Vector3(x,eave,back)],m.roof);
    b.box(x,eave-0.06,(back+front)/2,0.16,0.18,front-back,m.trim);
  }
  for(const z of [-2.23,2.23]){
    b.sheet([new Vector3(-3.2,3.21,z),new Vector3(0,4.4,z),new Vector3(3.2,3.21,z),new Vector3(0,3.21,z)],m.wood);
    b.box(0,3.45,z+0.02,0.12,1.45,0.16,m.trim);
  }
  b.box(0,4.61,-0.02,0.15,0.12,5.8,m.roof);
  // Lean-to shelter over the domestic porch; front posts keep the stair lane open.
  b.sheet([new Vector3(-3.95,3.31,2.45),new Vector3(3.95,3.31,2.45),new Vector3(3.95,2.87,5.4),new Vector3(-3.95,2.87,5.4)],m.roof);
  b.box(0,2.8,5.28,7.85,0.17,0.17,m.trim);
  for(const x of [-3.55,3.55])b.box(x,1.67,5.13,0.17,2.14,0.17,m.trim);
  // Usable bench: support height agrees with Muse's perch and hop poses.
  b.box(BENCH.x,FLOOR+BENCH.seat-0.06,BENCH.z,BENCH.half*2,0.12,BENCH.depth*2,m.wood);
  b.box(BENCH.x,FLOOR+0.8,BENCH.z-0.18,BENCH.half*2,0.46,0.08,m.wood);
  for(const dx of [-0.55,0.55])b.box(BENCH.x+dx,FLOOR+0.22,BENCH.z,0.12,0.44,0.32,m.trim);
  // Small unoccupied stool, stove pipe, split logs and a fern crate.
  b.box(CHAIR.x,FLOOR+0.42,CHAIR.z,0.44,0.1,0.44,m.wood,CHAIR.turn);
  for(const dx of [-0.16,0.16])for(const dz of [-0.16,0.16])b.box(CHAIR.x+dx,FLOOR+0.2,CHAIR.z+dz,0.07,0.4,0.07,m.trim);
  b.box(-2.0,4.05,-1.3,0.4,1.8,0.4,m.iron);
  b.box(-2.0,4.99,-1.3,0.57,0.12,0.57,m.iron);
  for(let i=0;i<8;i++){
    const row=i<5?0:1,x=-3.8+(i%5)*0.18,y=0.16+row*0.29,z=-0.9+(i%2)*0.15;
    const cylinder=new CylinderGeometry(0.14,0.15,1.4,7,1);
    b.add(cylinder,m.wood,new Matrix4().makeRotationX(Math.PI/2).setPosition(x,y,z));
  }
  b.box(-3.9,0.22,4.3,0.72,0.44,0.72,m.wood);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3+(seed%13)*0.05,x=-3.9+Math.sin(a)*0.27,z=4.3+Math.cos(a)*0.27;
    b.sheet([new Vector3(-3.9,0.45,4.3),new Vector3(x-0.08,0.68,z),new Vector3(x,1.0-(i%2)*0.12,z),new Vector3(x+0.08,0.68,z)],m.leaf);
  }
  return b.finish();
}
