import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHRINE_MATERIAL as M } from './shrineGeometry';

/** Distinct smaller sanctuaries along the pilgrimage route. Their shared
 * approach ends at z7.1, so route/terrain placement can use one footprint. */
export const WAYSIDE_STEPS = [
  {z0:4.15,z1:5.1,height:0.54},
  {z0:5.1,z1:6.1,height:0.36},
  {z0:6.1,z1:7.1,height:0.18},
] as const;

class Builder {
  private readonly parts:BufferGeometry[]=[];
  add(source:BufferGeometry,kind:number,matrix?:Matrix4):void {
    const geometry=source.index?source.toNonIndexed():source;
    if(geometry!==source)source.dispose();
    if(matrix)geometry.applyMatrix4(matrix);
    geometry.setAttribute('aKind',new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(kind),1));
    this.parts.push(geometry);
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number,kind:number,turn=0):void {
    this.add(new BoxGeometry(w,h,d),kind,new Matrix4().makeRotationY(turn).setPosition(x,y,z));
  }
  post(x:number,z:number,bottom:number,h:number,r:number,kind:number,rt=r):void {
    this.add(new CylinderGeometry(rt,r,h,10,1),kind,new Matrix4().makeTranslation(x,bottom+h/2,z));
  }
  beam(a:Vector3,b:Vector3,w:number,kind:number):void {
    const q=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),b.clone().sub(a).normalize());
    this.add(new BoxGeometry(w,a.distanceTo(b),w),kind,new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),q,new Vector3(1,1,1)));
  }
  face(points:readonly Vector3[],kind:number):void {
    const vertices:number[]=[],uv:number[]=[];
    for(const index of points.length===3?[0,1,2]:[0,1,2,0,2,3]){
      const p=points[index];vertices.push(p.x,p.y,p.z);uv.push(p.x,p.z);
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();this.add(g,kind);
  }
  finish():BufferGeometry {
    const geometry=mergeGeometries(this.parts,false);
    for(const part of this.parts)part.dispose();
    // Box transforms round their exact ground plane by a few float32 ulps.
    const position=geometry.getAttribute('position');
    for(let i=0;i<position.count;i++)if(Math.abs(position.getY(i))<1e-6)position.setY(i,0);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
  }
}

function sweptRoof(b:Builder,width:number,back:number,front:number,eave:number,rise:number,kind:number,under:number=M.timber):void {
  const height=(x:number):number=>eave+rise*(1-Math.pow(Math.abs(x)/width,0.74))+0.18*Math.pow(Math.abs(x)/width,5);
  for(let i=0;i<16;i++){
    const x0=-width+2*width*i/16,x1=-width+2*width*(i+1)/16;
    const a=new Vector3(x0,height(x0),back),c=new Vector3(x1,height(x1),back),d=new Vector3(x1,height(x1),front),e=new Vector3(x0,height(x0),front);
    const al=a.clone().add(new Vector3(0,-0.14,0)),cl=c.clone().add(new Vector3(0,-0.14,0)),dl=d.clone().add(new Vector3(0,-0.14,0)),el=e.clone().add(new Vector3(0,-0.14,0));
    b.face([a,e,d,c],kind);b.face([al,cl,dl,el],under);b.face([a,c,cl,al],under);b.face([e,el,dl,d],under);
    if(i===0)b.face([a,al,el,e],under);
    if(i===15)b.face([c,d,dl,cl],under);
  }
  b.box(0,eave+rise+0.05,(back+front)/2,0.23,0.22,front-back+0.35,kind);
}

function hipRoof(b:Builder,x:number,z:number,width:number,depth:number,low:number,high:number,kind:number):void {
  const corners=[new Vector3(x-width,low,z-depth),new Vector3(x+width,low,z-depth),new Vector3(x+width,low,z+depth),new Vector3(x-width,low,z+depth)];
  const top=corners.map(p=>new Vector3(x+(p.x-x)*0.08,high,z+(p.z-z)*0.08));
  for(let i=0;i<4;i++){
    const next=(i+1)%4;
    b.face([corners[i],corners[next],top[next],top[i]],kind);
    b.face([corners[i],corners[i].clone().add(new Vector3(0,-0.13,0)),corners[next].clone().add(new Vector3(0,-0.13,0)),corners[next]],kind);
  }
  b.box(x,low-0.1,z,width*2,0.12,depth*2,kind);
  b.box(x,high,z,width*0.16,0.06,depth*0.16,kind);
}

function approach(b:Builder,width:number):void {
  b.box(0,0.36,3.55,width,0.72,1.2,M.stone);
  for(const step of WAYSIDE_STEPS)b.box(0,step.height/2,(step.z0+step.z1)/2,width,step.height,step.z1-step.z0,M.stone);
}

function lantern(b:Builder,x:number,z:number,height=2.3):void {
  b.box(x,0.12,z,0.9,0.24,0.9,M.stone);
  b.post(x,z,0.24,height-1.1,0.16,M.stone,0.12);
  b.box(x,height-0.81,z,0.7,0.15,0.7,M.stone);
  for(const dx of [-0.24,0.24])for(const dz of [-0.24,0.24])b.box(x+dx,height-0.46,z+dz,0.11,0.6,0.11,M.stone);
  b.box(x,height-0.46,z,0.12,0.22,0.12,M.gold);
  hipRoof(b,x,z,0.57,0.57,height-0.12,height+0.28,M.stone);
  b.post(x,z,height+0.3,0.2,0.09,M.stone,0.045);
}

function paperRope(b:Builder,width:number,y:number,z:number):void {
  for(let i=0;i<12;i++){
    const x0=-width+2*width*i/12,x1=-width+2*width*(i+1)/12;
    const sag=(x:number):number=>y-0.15*(1-(x/width)**2);
    b.beam(new Vector3(x0,sag(x0),z),new Vector3(x1,sag(x1),z),0.055,M.rope);
  }
  for(const x of [-width*0.65,0,width*0.65])for(let j=0;j<3;j++){
    const xx=x+(j%2)*0.065,yy=y-0.12-j*0.13;
    b.face([new Vector3(xx-0.06,yy,z+0.03),new Vector3(xx+0.1,yy-0.04,z+0.03),new Vector3(xx+0.03,yy-0.19,z+0.05),new Vector3(xx-0.11,yy-0.15,z+0.05)],M.paper);
  }
}

function timberShrine(b:Builder):void {
  b.box(0,0.28,-0.05,4.9,0.56,6.3,M.stone);
  b.box(0,0.64,-0.05,4.65,0.16,6.1,M.timber);
  b.box(0,2.02,-2.6,4.15,2.6,0.17,M.timber);
  for(const x of [-2.0,2.0])b.box(x,2.02,-0.35,0.18,2.6,4.7,M.timber);
  b.box(0,2.0,2.03,3.7,2.5,0.15,M.recess);
  for(const x of [-1.9,1.9])b.post(x,2.2,0.7,2.8,0.14,M.timber);
  for(let i=0;i<12;i++)b.box(-1.65+i*0.3,2.02,2.15,0.075,2.5,0.1,M.timber);
  b.box(0,3.5,2.2,4.35,0.25,0.28,M.timber);
  for(const z of [-2.6,2.3]){
    b.beam(new Vector3(-2.0,3.5,z),new Vector3(0,4.65,z),0.16,M.timber);
    b.beam(new Vector3(0,4.65,z),new Vector3(2.0,3.5,z),0.16,M.timber);
    b.box(0,4.04,z,0.15,1.2,0.15,M.timber);
  }
  sweptRoof(b,3.05,-3.35,3.3,3.38,1.45,M.roof);
  for(let i=0;i<12;i++)for(const side of [-1,1])b.box(side*2.8,3.36,-3.0+i*0.55,0.45,0.12,0.1,M.timber);
  paperRope(b,1.65,3.17,2.4);
  b.box(0,1.16,2.55,1.3,0.6,0.56,M.timber);
  b.box(0,3.57,2.4,0.62,0.3,0.12,M.gold);
  approach(b,2.9);lantern(b,-3.9,7.9);
}

function stoneShrine(b:Builder):void {
  b.box(0,0.36,0,5.5,0.72,6.0,M.stone);
  // An open niche, built from separate masonry jambs rather than a painted box.
  b.box(0,1.95,-1.2,3.65,2.45,0.48,M.stone);
  for(const x of [-1.75,1.75])b.box(x,1.95,0.25,0.5,2.45,3.4,M.stone);
  b.box(0,3.13,0.25,3.75,0.32,3.6,M.stone);
  b.box(0,1.71,-0.87,2.5,1.8,0.06,M.recess);
  b.post(0,-0.37,0.74,0.9,0.38,M.stone,0.28);
  b.box(0,1.74,-0.37,0.88,0.22,0.75,M.stone);
  sweptRoof(b,2.65,-2.3,2.55,3.2,0.9,M.stone,M.stone);
  b.box(-1.8,3.53,1.1,0.65,0.06,0.95,M.moss,0.2);
  b.box(1.9,3.48,-0.8,0.7,0.07,0.8,M.moss,-0.12);
  approach(b,3.25);
  // A short, austere stone gate; its central walking passage has no low bar.
  for(const x of [-2.5,2.5]){
    b.box(x,0.16,10.3,0.85,0.32,0.8,M.stone);
    b.post(x,10.3,0.28,2.92,0.24,M.stone,0.19);
  }
  b.box(0,2.68,10.3,5.65,0.23,0.29,M.stone);
  b.box(0,3.22,10.3,6.15,0.33,0.58,M.stone);
  b.box(-2.15,3.4,10.3,1.0,0.07,0.6,M.moss,0.04);
  lantern(b,3.8,7.7,1.65);
}

function vermilionPavilion(b:Builder):void {
  b.box(0,0.28,-0.1,7.55,0.56,6.5,M.stone);
  b.box(0,0.64,-0.1,7.35,0.16,6.25,M.timber);
  b.box(0,2.1,-2.8,6.6,2.75,0.22,M.vermilion);
  // Open front with paired columns and a recessed centre sanctuary.
  for(const x of [-3.25,3.25])for(const z of [-2.8,2.65]){
    b.post(x,z,0.72,2.7,0.19,M.vermilion,0.17);
    b.box(x,3.34,z,0.64,0.16,0.55,M.timber);
    b.box(x,3.54,z,0.84,0.15,0.6,M.vermilion);
  }
  b.box(0,2.0,-0.5,3.2,2.5,0.25,M.recess);
  for(const x of [-1.6,1.6])b.box(x,2.0,0,0.16,2.55,1.1,M.vermilion);
  for(let i=0;i<11;i++)b.box(-1.45+i*0.29,2.0,0.62,0.075,2.35,0.1,M.vermilion);
  b.box(0,3.47,2.65,6.95,0.3,0.32,M.vermilion);
  for(const z of [-2.8,2.65]){
    b.beam(new Vector3(-3.25,3.65,z),new Vector3(0,5.36,z),0.2,M.vermilion);
    b.beam(new Vector3(0,5.36,z),new Vector3(3.25,3.65,z),0.2,M.vermilion);
    b.box(0,4.5,z,0.19,1.7,0.2,M.vermilion);
  }
  sweptRoof(b,4.15,-3.7,3.65,3.65,1.95,M.roof);
  // A lower entrance canopy gives this shrine a broad two-eave silhouette.
  sweptRoof(b,2.65,2.25,4.1,2.9,0.7,M.roof);
  for(const x of [-2.28,2.28])b.post(x,3.7,0.72,2.15,0.13,M.vermilion);
  for(const side of [-1,1])for(let i=0;i<14;i++)b.box(side*3.9,3.6,-3.4+i*0.52,0.45,0.14,0.12,M.vermilion);
  paperRope(b,2.08,2.7,3.83);
  b.box(0,1.09,2.6,1.5,0.58,0.68,M.timber);
  b.box(0,3.93,2.83,0.84,0.4,0.12,M.gold);
  approach(b,3.7);lantern(b,-4.5,8.5);lantern(b,4.5,8.5);
}

export function buildWaysideShrineGeometry(variant:number,seed=0):BufferGeometry {
  const which=((Math.trunc(variant)%3)+3)%3,b=new Builder();
  if(which===0)timberShrine(b);else if(which===1)stoneShrine(b);else vermilionPavilion(b);
  // Seeded wear belongs on plinth corners, never across a tread or doorway.
  const phase=(seed>>>0)%97;
  for(let i=0;i<5;i++){
    const side=i%2?-1:1,x=side*(which===2?3.5:which===1?2.52:2.22),z=-2.4+i*0.82;
    b.box(x,which===1?0.745:0.585,z,0.22+0.09*Math.sin(i+phase)**2,0.035,0.38+0.1*Math.cos(i+phase)**2,M.moss,i*0.19);
  }
  const geometry=b.finish();
  geometry.userData.waysideVariant=which;geometry.userData.steps=WAYSIDE_STEPS;
  return geometry;
}
