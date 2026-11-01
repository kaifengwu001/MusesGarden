import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { CanyonGeometry } from './canyonGeometry';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// Keep the supported walking/deck footprint stable for Muse's resident routes.
// The building itself is a timber frame, woven reed walls and a thin crimson awning.
export const FLOOR=0.72;
export const COTTAGE={halfX:4.12,halfZ:2.45,wall:3.45,thickness:0.36,overhang:0.45,pitch:0.16} as const;
const OUTER={x:COTTAGE.halfX+COTTAGE.thickness/2,z:COTTAGE.halfZ+COTTAGE.thickness/2} as const;
export const ROOF={ex:4.85,ez:3.4,eave:3.6,rise:1,ridge:0,slope:6.8,top:4.6} as const;
export const TERRACE={x0:-OUTER.x-0.1,x1:OUTER.x-0.2,z0:OUTER.z-0.3,z1:OUTER.z+2.1} as const;
/** The former pier is now a dry chalk lookout; its deck still supports resident routines. */
export const PIER={x0:-OUTER.x-3.9,x1:-OUTER.x+0.9,z0:OUTER.z-0.8,z1:OUTER.z+3.0} as const;
export const STEPS={x0:OUTER.x-2.3,x1:OUTER.x-0.5,count:3,rise:FLOOR/3,tread:0.33} as const;
export const ARCH={x:PIER.x0+1,spring:-0.78,half:0.55,depth:1.6} as const;
export const BENCH={x:-OUTER.x+(2.52+4.6)/2-0.12,z:OUTER.z+0.22,half:0.74,depth:0.19,seat:0.485} as const;
export const FACE=OUTER.z;
export const SIDE=OUTER.x;
export const CHAIR={x:-OUTER.x-0.55,z:OUTER.z+0.45,turn:0.5} as const;
/** Retained for callers that describe the old footprint; no chimney is rendered. */
export const CHIMNEY={x:0.1,z:-0.6,half:0.29} as const;

function shelterGeometry(seed:number):ReturnType<CanyonGeometry['build']>{
  const b=new CanyonGeometry();
  const beam=(a:Vector3,c:Vector3,width:number):void=>b.tube([a,c],[width,width*0.94],0,6);
  const slab=(x0:number,x1:number,z0:number,z1:number,top:number):void=>b.box((x0+x1)/2,(top-0.3)/2,(z0+z1)/2,x1-x0,top+0.3,z1-z0,2);
  slab(-OUTER.x,OUTER.x,-OUTER.z,OUTER.z,FLOOR);
  slab(TERRACE.x0,TERRACE.x1,TERRACE.z0,TERRACE.z1,FLOOR);
  slab(PIER.x0,PIER.x1,PIER.z0,PIER.z1,FLOOR);
  for(let k=0;k<STEPS.count;k++)slab(STEPS.x0,STEPS.x1,TERRACE.z1+k*STEPS.tread,TERRACE.z1+(k+1)*STEPS.tread,FLOOR-k*STEPS.rise);
  // Sparse timber boards on the dry lookout distinguish it from the chalk foundation.
  for(let i=0;i<9;i++)b.box(PIER.x0+0.25+i*(PIER.x1-PIER.x0-0.5)/8,FLOOR-0.025,(PIER.z0+PIER.z1)/2,0.38,0.05,PIER.z1-PIER.z0-0.14,0);
  const front=OUTER.z,back=-OUTER.z;
  // Frame posts remain inside the non-walkable wall footprint, keeping terrace routes clear.
  for(const x of [-OUTER.x,0,OUTER.x]){
    beam(new Vector3(x,FLOOR-0.04,back),new Vector3(x,4.85,back),0.13);
    beam(new Vector3(x,FLOOR-0.04,front),new Vector3(x,x===0?3.6:4.05,front),0.12);
  }
  for(const z of [back,front]){
    const y=z===back?4.77:3.57;
    beam(new Vector3(-OUTER.x-0.12,y,z),new Vector3(OUTER.x+0.12,y,z),0.13);
    beam(new Vector3(-OUTER.x,FLOOR+0.05,z),new Vector3(OUTER.x,FLOOR+0.05,z),0.09);
  }
  for(const x of [-OUTER.x,OUTER.x])beam(new Vector3(x,4.8,-3.0),new Vector3(x,3.96,3.8),0.07);
  // An open pavilion: a low rear windscreen and half-height side screens
  // reveal the timber frame. The sheltered front and right-hand bay stay open.
  b.box(0,FLOOR+0.9,back,OUTER.x*2,1.8,0.06,5);
  b.box(-OUTER.x,FLOOR+0.85,-0.85,0.06,1.7,3.45,5);
  b.box(OUTER.x,FLOOR+0.6,back+0.65,0.06,1.2,1.25,5);
  // Uneven reed panel edges, a few exposed cross braces, and real open bays.
  beam(new Vector3(-OUTER.x,FLOOR+0.1,back),new Vector3(-2.7,3.0,back),0.075);
  beam(new Vector3(OUTER.x,FLOOR+0.1,back),new Vector3(2.8,3.1,back),0.075);
  beam(new Vector3(-OUTER.x,FLOOR+0.1,0.6),new Vector3(-OUTER.x,3.5,back),0.065);
  for(let i=0;i<8;i++)b.box(0,FLOOR+0.025,back+0.33+i*0.6,8.2,0.05,0.57,0);
  // Low equipment chest and a work table make the open home feel inhabited.
  b.box(-2.8,FLOOR+0.35,back+0.55,1.4,0.7,0.72,0);
  b.box(-2.8,FLOOR+0.73,back+0.55,1.46,0.07,0.76,0);
  b.box(2.6,FLOOR+0.9,-0.65,1.6,0.09,0.8,0);
  for(const x of [1.96,3.24])for(const z of [-0.94,-0.36])b.box(x,FLOOR+0.44,z,0.075,0.88,0.075,0);
  b.box(2.45,FLOOR+1.0,-0.65,0.45,0.12,0.28,5);
  // A broad tensioned sail droops between its attachments. Its thin scalloped
  // edge and a separate porch fly read as fabric, without a rigid tiled roof.
  const point=(u:number,v:number):Vector3=>new Vector3(
    (u-0.5)*9.7,
    4.85-v*0.95-0.6*Math.sin(Math.PI*u)*Math.sin(Math.PI*v*0.65)+0.045*Math.sin(u*Math.PI*6)*v*v,
    -3+v*6.8
  );
  const cloth=(pointAt:(u:number,v:number)=>Vector3,columns:number,rows:number):void=>{
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const u0=x/columns,u1=(x+1)/columns,v0=y/rows,v1=(y+1)/rows;
      const a=pointAt(u0,v0),c=pointAt(u1,v1);
      b.triangle(a,pointAt(u1,v0),c,4,[[u0*9.7,v0*6.8],[u1*9.7,v0*6.8],[u1*9.7,v1*6.8]]);
      b.triangle(a,c,pointAt(u0,v1),4,[[u0*9.7,v0*6.8],[u1*9.7,v1*6.8],[u0*9.7,v1*6.8]]);
    }
  };
  cloth(point,24,16);
  const porch=(u:number,v:number):Vector3=>new Vector3(-0.35+(u-0.5)*7.1,3.73-0.5*v-0.24*Math.sin(Math.PI*u)*Math.sin(Math.PI*v),2.0+v*3.0);
  cloth(porch,18,8);
  // Slim sewn hems follow the sag, with ropes only at corner attachments.
  for(const v of [0,1]){
    const points=Array.from({length:25},(_,i)=>point(i/24,v));
    b.tube(points,points.map(()=>0.016),0,4);
  }
  for(const u of [0,1]){
    const points=Array.from({length:17},(_,i)=>point(u,i/16));
    b.tube(points,points.map(()=>0.015),0,4);
  }
  for(const u of [0,1]){
    const side=u===0?-OUTER.x:OUTER.x;
    beam(new Vector3(side,3.0,front),porch(u,1),0.035);
    beam(new Vector3(side,4.05,front),porch(u,1),0.012);
  }
  // The resident's bench and chair retain the exact sitting surfaces used by MuseRoam.
  b.box(BENCH.x,FLOOR+BENCH.seat-0.035,BENCH.z,BENCH.half*2,0.07,BENCH.depth*2,0);
  for(const dx of [-0.62,0.62])b.box(BENCH.x+dx,FLOOR+0.23,BENCH.z,0.1,0.42,0.32,0);
  b.box(BENCH.x,FLOOR+0.14,BENCH.z,1.24,0.05,0.04,0);
  const chair=(x:number,y:number,z:number,w:number,h:number,d:number):void=>{
    // The slight original chair turn is preserved in its location/footprint; broad seat is unambiguous.
    const cx=CHAIR.x+x*Math.cos(CHAIR.turn)+z*Math.sin(CHAIR.turn);
    const cz=CHAIR.z+z*Math.cos(CHAIR.turn)-x*Math.sin(CHAIR.turn);
    b.box(cx,y,cz,w,h,d,0);
  };
  chair(0,FLOOR+0.44,0,0.44,0.05,0.42);
  for(const x of [-0.18,0.18])for(const z of [-0.17,0.17])chair(x,FLOOR+0.21,z,0.05,0.42,0.05);
  for(const x of [-0.18,0.18])chair(x,FLOOR+0.72,-0.19,0.05,0.56,0.05);
  chair(0,FLOOR+0.86,-0.19,0.4,0.18,0.04);
  // A low open timber guard at the back of the lookout, outside the accessible route.
  const rz=PIER.z0+0.1;
  for(let i=0;i<5;i++)b.box(PIER.x0+0.18+i*0.8,FLOOR+0.45,rz,0.055,0.9,0.055,0);
  beam(new Vector3(PIER.x0+0.18,FLOOR+0.86,rz),new Vector3(PIER.x0+3.38,FLOOR+0.86,rz),0.035);
  // One small lantern, with restrained warm color rather than bloom.
  const lanternX=1.7+(seed%7)*0.012;
  b.box(lanternX,2.8,front+0.22,0.17,0.27,0.14,7);
  beam(new Vector3(lanternX,2.95,front+0.22),new Vector3(lanternX,3.3,front+0.22),0.018);
  return b.build();
}

const axisX=new Vector3(),axisZ=new Vector3();
export class Homestead {
  readonly group=new Object3D();
  private readonly mesh:Mesh;
  private readonly material:ShaderMaterial;
  constructor(shared:Record<string,IUniform>,seed:number){
    this.material=new ShaderMaterial({name:'Crimson awning shelter',vertexShader,fragmentShader,uniforms:{...shared},side:DoubleSide});
    this.mesh=new Mesh(shelterGeometry(seed),this.material);
    this.mesh.name='Timber shelter, woven awning and dry chalk lookout';
    this.mesh.frustumCulled=false;
    this.group.add(this.mesh);
    this.group.matrixAutoUpdate=false;
  }
  place(origin:Vector3,up:Vector3,toward:Vector3):void{
    const x=axisX.crossVectors(up,toward).normalize();
    const z=axisZ.crossVectors(x,up).normalize();
    this.group.matrix.makeBasis(x,up,z).setPosition(origin);
    this.group.matrixWorldNeedsUpdate=true;
    this.group.updateMatrixWorld(true);
  }
  dispose():void{this.mesh.geometry.dispose();this.material.dispose();}
}
