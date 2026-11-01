import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { CanyonGeometry, addSeedLantern } from './canyonGeometry';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// Keep the supported walking/deck footprint stable for Muse's resident routes.
// The building itself is a timber frame, woven reed walls and a overlapping ivory-mint leaf roof.
export const FLOOR=0.72;
export const COTTAGE={halfX:4.12,halfZ:2.45,wall:3.45,thickness:0.36,overhang:0.45,pitch:0.16} as const;
const OUTER={x:COTTAGE.halfX+COTTAGE.thickness/2,z:COTTAGE.halfZ+COTTAGE.thickness/2} as const;
export const ROOF={ex:4.85,ez:3.6,eave:3.7,rise:1.2,ridge:0,slope:3.6,top:4.9} as const;
export const TERRACE={x0:-OUTER.x-0.1,x1:OUTER.x-0.2,z0:OUTER.z-0.3,z1:OUTER.z+2.1} as const;
/** The lookout stands above the basin margin; its deck still supports resident routines. */
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
    beam(new Vector3(x,FLOOR-0.04,back),new Vector3(x,3.72,back),0.13);
    beam(new Vector3(x,FLOOR-0.04,front),new Vector3(x,3.68,front),0.12);
  }
  for(const z of [back,front]){
    const y=3.65;
    beam(new Vector3(-OUTER.x-0.12,y,z),new Vector3(OUTER.x+0.12,y,z),0.13);
    beam(new Vector3(-OUTER.x,FLOOR+0.05,z),new Vector3(OUTER.x,FLOOR+0.05,z),0.09);
  }
  for(const x of [-OUTER.x,0,OUTER.x]){
    beam(new Vector3(x,3.7,-3.6),new Vector3(x,4.9,0),0.085);
    beam(new Vector3(x,4.9,0),new Vector3(x,3.7,3.6),0.085);
  }
  beam(new Vector3(-4.85,4.9,0),new Vector3(4.85,4.9,0),0.09);
  // Woven panels with a front door and a small warm window.
  b.box(0,2.02,back,OUTER.x*2,2.6,0.07,5);
  for(const x of [-OUTER.x,OUTER.x])b.box(x,2.02,0,0.07,2.6,OUTER.z*2,5);
  const panel=(x0:number,x1:number,y0:number,y1:number):void=>b.box((x0+x1)/2,(y0+y1)/2,front,x1-x0,y1-y0,0.07,5);
  panel(-OUTER.x,-3.0,FLOOR,3.31);
  panel(-3.0,-1.78,FLOOR,1.6);panel(-3.0,-1.78,2.7,3.31);
  panel(-1.78,0.3,FLOOR,3.31);panel(0.3,1.4,2.86,3.31);panel(1.4,OUTER.x,FLOOR,3.31);
  b.box(0.85,FLOOR+1.05,front+0.02,1.08,2.1,0.07,0);
  b.box(-2.39,2.15,front+0.025,1.12,1.0,0.025,7);
  for(const x of [-3.02,-1.76,0.28,1.42])beam(new Vector3(x,FLOOR,front+0.08),new Vector3(x,3.32,front+0.08),0.045);
  beam(new Vector3(-3.02,1.6,front+0.08),new Vector3(-1.76,1.6,front+0.08),0.045);
  beam(new Vector3(-3.02,2.7,front+0.08),new Vector3(-1.76,2.7,front+0.08),0.045);
  beam(new Vector3(-2.39,1.6,front+0.08),new Vector3(-2.39,2.7,front+0.08),0.035);
  // Each roof leaf has its own silhouette, fold, veins and overlapping ridge attachment.
  for (const side of [-1, 1]) for (let leaf = 0; leaf < 11; leaf++) {
    const centre = -4.45 + leaf * 0.89;
    const point = (u: number, t: number): Vector3 => {
      const width = (0.42 + 0.25 * Math.sin(t * Math.PI)) * (1 - 0.72 * Math.pow(t, 12));
      return new Vector3(centre + u * width, 4.95 - 1.22 * t + 0.06 * (1 - Math.abs(u)) * Math.sin(t * Math.PI), side * (t * 3.76 - 0.1));
    };
    for (let row = 0; row < 12; row++) for (const [a, c] of [[-1, 0], [0, 1]]) {
      const t0 = row / 12, t1 = (row + 1) / 12;
      const p0 = point(a,t0),p1 = point(c,t0),p2 = point(c,t1),p3 = point(a,t1);
      b.triangle(p0,p1,p2,4,[[(a+1)/2,t0],[(c+1)/2,t0],[(c+1)/2,t1]]);
      b.triangle(p0,p2,p3,4,[[(a+1)/2,t0],[(c+1)/2,t1],[(a+1)/2,t1]]);
    }
  }
  // The gable ends show reed weave between the upper timber braces.
  for (const x of [-OUTER.x, OUTER.x]) {
    b.triangle(new Vector3(x,3.31,-OUTER.z),new Vector3(x,3.31,OUTER.z),new Vector3(x,4.82,0),5,[[0,0],[5.2,0],[2.6,1.5]]);
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
  addSeedLantern(b,new Vector3(lanternX,2.78,front+0.22),0.28);
  beam(new Vector3(lanternX,2.95,front+0.22),new Vector3(lanternX,3.3,front+0.22),0.018);
  return b.build();
}

const axisX=new Vector3(),axisZ=new Vector3();
export class Homestead {
  readonly group=new Object3D();
  private readonly mesh:Mesh;
  private readonly material:ShaderMaterial;
  constructor(shared:Record<string,IUniform>,seed:number){
    this.material=new ShaderMaterial({name:'Woven reed hut with a leaf roof',vertexShader,fragmentShader,uniforms:{...shared,uLanternDusk:shared.uLanternDusk??{value:0.6}},side:DoubleSide});
    this.mesh=new Mesh(shelterGeometry(seed),this.material);
    this.mesh.name='Timber hut, woven reed walls and overlapping leaf roof';
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
