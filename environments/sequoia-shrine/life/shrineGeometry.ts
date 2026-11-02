import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SHRINE_LAYOUT = {
  floor: 0.92, shrineHalfWidth: 3.8, shrineHalfDepth: 3.4,
  roofHalfWidth: 5.0, roofBack: -4.6, roofFront: 4.35, ridge: 6.95,
  toriiZ: 12, toriiHalfOpening: 3.25,
  steps: [{z0:4.15,z1:4.85,height:0.72},{z0:4.85,z1:5.6,height:0.54},{z0:5.6,z1:6.35,height:0.36},{z0:6.35,z1:7.1,height:0.18}],
} as const;

// Material identities are independent of meadow cottage palette rows.
export const SHRINE_MATERIAL = { timber:0, vermilion:1, roof:2, stone:3, moss:4, paper:5, rope:6, gold:7, recess:8 } as const;

class ShrineBuilder {
  private readonly parts:BufferGeometry[]=[];
  add(source:BufferGeometry,kind:number,transform?:Matrix4):void {
    const geometry=source.index?source.toNonIndexed():source;
    if(geometry!==source)source.dispose();
    if(transform)geometry.applyMatrix4(transform);
    const count=geometry.getAttribute('position').count;
    geometry.setAttribute('aKind',new Float32BufferAttribute(new Float32Array(count).fill(kind),1));
    this.parts.push(geometry);
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number,kind:number,turn=0):void {
    const matrix=new Matrix4().makeRotationY(turn).setPosition(x,y,z);
    this.add(new BoxGeometry(w,h,d),kind,matrix);
  }
  post(x:number,z:number,bottom:number,height:number,radius:number,kind:number,topRadius=radius):void {
    this.add(new CylinderGeometry(topRadius,radius,height,12,1),kind,new Matrix4().makeTranslation(x,bottom+height/2,z));
  }
  beam(a:Vector3,b:Vector3,width:number,depth:number,kind:number):void {
    const q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),b.clone().sub(a).normalize());
    const matrix=new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),q,new Vector3(1,1,1));
    this.add(new BoxGeometry(width,a.distanceTo(b),depth),kind,matrix);
  }
  sheet(points:readonly Vector3[],kind:number,reverse=false):void {
    const vertices:number[]=[],uv:number[]=[];
    for(const index of reverse?[0,2,1,0,3,2]:[0,1,2,0,2,3]){const p=points[index];vertices.push(p.x,p.y,p.z);uv.push(p.x,p.z);}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();this.add(geometry,kind);
  }
  finish():BufferGeometry {
    const result=mergeGeometries(this.parts,false);
    for(const part of this.parts)part.dispose();
    result.computeBoundingSphere();result.computeBoundingBox();
    return result;
  }
}

/** The roof rises gently again at the eave, rather than making a straight triangular slab. */
export function shrineRoofHeight(x:number,z:number):number {
  const t=Math.abs(x)/SHRINE_LAYOUT.roofHalfWidth;
  return SHRINE_LAYOUT.ridge-2.85*Math.pow(t,0.72)+0.62*Math.pow(t,5)+0.12*Math.pow(Math.abs(z)/4.6,4)*Math.pow(t,3);
}

export function buildShrineGeometry(seed=0):BufferGeometry {
  const b=new ShrineBuilder(),m=SHRINE_MATERIAL;
  // A compact raised sanctuary, without a broad lookout deck. Its stair
  // treads are non-overlapping intervals with one exposed surface per point.
  b.box(0,0.28,0,8.1,0.56,7.8,m.stone);
  b.box(0,0.76,0,7.85,0.32,7.6,m.timber);
  b.box(0,0.39,3.975,4.65,0.78,0.35,m.stone);
  b.box(0,0.85,3.975,4.65,0.14,0.35,m.timber);
  for(const step of SHRINE_LAYOUT.steps)b.box(0,step.height/2,(step.z0+step.z1)/2,4.65,step.height,step.z1-step.z0,m.stone);
  // Board walls and deep front recess: the altar remains closed and modest.
  b.box(0,2.28,-3.12,7.15,2.72,0.2,m.vermilion);
  for(const x of [-3.55,3.55])b.box(x,2.28,-0.05,0.2,2.72,6.15,m.vermilion);
  b.box(0,2.22,2.54,4.75,2.6,0.18,m.recess);
  for(const x of [-1.1,1.1]){
    b.box(x,2.24,2.66,2.02,2.55,0.12,m.timber);
    for(let i=0;i<8;i++)b.box(x-0.88+i*0.25,2.34,2.76,0.065,2.27,0.1,m.vermilion);
    b.box(x,1.58,2.81,1.94,0.08,0.12,m.vermilion);
  }
  for(const x of [-3.56,3.56])for(const z of [-3.13,3.1]){
    b.post(x,z,0.9,3.1,0.2,m.vermilion,0.18);
    b.box(x,3.73,z,0.65,0.14,0.55,m.vermilion);
    b.box(x,3.92,z,0.9,0.13,0.6,m.timber);
  }
  for(const z of [-3.25,3.2]){
    b.box(0,3.65,z,7.55,0.31,0.34,m.vermilion);
    b.box(0,4.03,z,8.1,0.23,0.38,m.timber);
    b.box(0,4.24,z,7.75,0.2,0.36,m.vermilion);
    // Front and rear gable trusses, with an open central kingpost.
    b.beam(new Vector3(-3.9,4.2,z),new Vector3(0,6.5,z),0.2,0.2,m.vermilion);
    b.beam(new Vector3(0,6.5,z),new Vector3(3.9,4.2,z),0.2,0.2,m.vermilion);
    b.box(0,5.25,z,0.19,2.35,0.2,m.vermilion);
    b.box(0,4.6,z,5.9,0.16,0.18,m.vermilion);
  }
  // A thick continuous swept roof with real edges and an understated ridge.
  const segments=20,z0=SHRINE_LAYOUT.roofBack,z1=SHRINE_LAYOUT.roofFront;
  for(let i=0;i<segments;i++){
    const x0=-5+i*0.5,x1=x0+0.5;
    const a=new Vector3(x0,shrineRoofHeight(x0,z0),z0),c=new Vector3(x1,shrineRoofHeight(x1,z0),z0);
    const d=new Vector3(x1,shrineRoofHeight(x1,z1),z1),e=new Vector3(x0,shrineRoofHeight(x0,z1),z1);
    b.sheet([a,e,d,c],m.roof);
    const low=[a,c,d,e].map(p=>p.clone().add(new Vector3(0,-0.16,0)));
    b.sheet(low,m.timber);
    b.sheet([a,c,low[1],low[0]],m.timber);
    b.sheet([d,e,low[3],low[2]],m.timber);
  }
  for(const x of [-5,5]){
    const y0=shrineRoofHeight(x,z0),y1=shrineRoofHeight(x,z1);
    b.sheet([new Vector3(x,y0,z0),new Vector3(x,y1,z1),new Vector3(x,y1-0.16,z1),new Vector3(x,y0-0.16,z0)],m.timber,x<0);
  }
  b.box(0,6.99,-0.1,0.32,0.26,9.4,m.roof);
  for(const z of [-4.76,4.64])b.box(0,7.03,z,0.58,0.38,0.22,m.timber);
  // Rafter ends sit below the eaves and remain visible from the approach.
  for(let i=0;i<17;i++)for(const side of [-1,1]){
    const z=-4.35+i*0.52;
    b.box(side*4.72,shrineRoofHeight(side*4.72,z)-0.25,z,0.58,0.16,0.14,m.vermilion);
  }
  // Gold fitting, bell rope, rice-straw shimenawa and five separate shide.
  b.box(0,3.55,3.52,0.92,0.53,0.13,m.gold);
  for(let i=0;i<20;i++){
    const x0=-2.7+i*0.27,x1=x0+0.27;
    const y=(x:number):number=>3.5-0.27*(1-(x/2.7)**2);
    b.beam(new Vector3(x0,y(x0),3.74),new Vector3(x1,y(x1),3.74),0.075,0.09,m.rope);
  }
  b.beam(new Vector3(0,3.2,3.83),new Vector3(0,1.58,3.83),0.045,0.045,m.rope);
  b.box(0,1.42,3.8,1.1,0.62,0.7,m.timber);
  for(const x of [-2.0,-1.05,0,1.05,2.0]){
    const top=3.37+0.04*Math.abs(x);
    for(let i=0;i<3;i++){
      const xx=x+(i%2?0.08:0),yy=top-i*0.15;
      b.sheet([new Vector3(xx-0.06,yy,3.86),new Vector3(xx+0.1,yy-0.06,3.86),new Vector3(xx+0.04,yy-0.22,3.89),new Vector3(xx-0.12,yy-0.16,3.89)],m.paper);
    }
  }
  // Grey-green stone torii: open passage, shallow lifted outer lintel ends.
  const tz=SHRINE_LAYOUT.toriiZ;
  for(const side of [-1,1]){
    b.post(side*3.5,tz,-0.08,0.38,0.49,m.stone);
    b.post(side*3.5,tz,0.22,5.25,0.32,m.stone,0.25);
    b.box(side*3.5,5.36,tz,0.8,0.22,0.75,m.stone);
  }
  b.box(0,4.45,tz,8.15,0.28,0.37,m.stone);
  b.box(0,5.45,tz,8.85,0.32,0.64,m.stone);
  for(let i=0;i<18;i++){
    const x0=-4.7+i*9.4/18,x1=x0+9.4/18;
    const y=(x:number):number=>5.78+0.3*(Math.abs(x)/4.7)**2;
    b.sheet([new Vector3(x0,y(x0),tz-0.47),new Vector3(x0,y(x0),tz+0.47),new Vector3(x1,y(x1),tz+0.47),new Vector3(x1,y(x1),tz-0.47)],m.stone);
    b.sheet([new Vector3(x0,y(x0),tz+0.47),new Vector3(x0,y(x0)-0.19,tz+0.47),new Vector3(x1,y(x1)-0.19,tz+0.47),new Vector3(x1,y(x1),tz+0.47)],m.stone);
  }
  // Two stone lanterns, square windows left open rather than painted dark.
  for(const [x,z] of [[-4.7,8.4],[4.7,8.4]]){
    b.box(x,0.12,z,1.25,0.24,1.25,m.stone);
    b.post(x,z,0.24,1.2,0.19,m.stone,0.16);
    b.box(x,1.5,z,0.88,0.16,0.88,m.stone);
    for(const dx of [-0.33,0.33])for(const dz of [-0.33,0.33])b.box(x+dx,1.95,z+dz,0.13,0.75,0.13,m.stone);
    b.box(x,1.89,z,0.14,0.29,0.14,m.gold);
    b.box(x,2.35,z,0.92,0.16,0.92,m.stone);
    const roofY=2.96;
    for(let side=0;side<4;side++){
      const a=side*Math.PI/2,an=(side+1)*Math.PI/2;
      const p=(angle:number,r:number,y:number):Vector3=>new Vector3(x+Math.cos(angle)*r,y,z+Math.sin(angle)*r);
      b.sheet([p(a+Math.PI/4,0.9,2.48),p(an+Math.PI/4,0.9,2.48),p(an+Math.PI/4,0.14,roofY),p(a+Math.PI/4,0.14,roofY)],m.stone);
    }
    b.post(x,z,roofY,0.22,0.12,m.stone,0.06);
  }
  // Modest moss caps occupy the outer plinth edges, never the walking stairs.
  const phase=(seed%71)*0.01;
  for(let i=0;i<7;i++){
    const x=(i%2?-1:1)*(3.1+0.13*(i%3)),z=-2.6+(i/6)*5.0;
    b.box(x,0.59,z,0.44+0.06*Math.sin(i+phase),0.055,0.48,m.moss,0.31*i);
  }
  const result=b.finish();
  result.userData.shrineLayout=SHRINE_LAYOUT;
  return result;
}
