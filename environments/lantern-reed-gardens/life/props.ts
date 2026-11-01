import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { CottageGeometry, point } from './cottageGeometry';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// Keep the supported walking/deck footprint stable for Muse's resident routes.
// The building itself is a timber frame, woven reed walls and a overlapping ivory-mint leaf roof.
export const FLOOR=0.72;
export const COTTAGE={halfX:4.12,halfZ:2.45,wall:3.45,thickness:0.36,overhang:0.45,pitch:0.16} as const;
const OUTER={x:COTTAGE.halfX+COTTAGE.thickness/2,z:COTTAGE.halfZ+COTTAGE.thickness/2} as const;
export const ROOF={ex:5.05,ez:3.6,eave:3.3,rise:2.35,ridge:-0.45,slope:5.5,top:5.65} as const;
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

type PavingRect = { x0: number; x1: number; z0: number; z1: number };

/** Keep one exposed stone surface where the house, terrace and lookout meet. */
function exposedPaving(rect: PavingRect, occupied: readonly PavingRect[]): PavingRect[] {
  let parts = [rect];
  for (const cover of occupied) parts = parts.flatMap((part) => {
    const x0=Math.max(part.x0,cover.x0),x1=Math.min(part.x1,cover.x1);
    const z0=Math.max(part.z0,cover.z0),z1=Math.min(part.z1,cover.z1);
    if (x0>=x1 || z0>=z1) return [part];
    return [
      {x0:part.x0,x1:x0,z0:part.z0,z1:part.z1},
      {x0:x1,x1:part.x1,z0:part.z0,z1:part.z1},
      {x0,x1,z0:part.z0,z1:z0},
      {x0,x1,z0:z1,z1:part.z1},
    ].filter((piece)=>piece.x1-piece.x0>0.001 && piece.z1-piece.z0>0.001);
  });
  return parts;
}

function shelterGeometry(seed: number): ReturnType<CottageGeometry['build']> {
  const b = new CottageGeometry();
  let random = seed >>> 0;
  const rand = (): number => { random = Math.imul(random, 1664525) + 1013904223 >>> 0; return random / 0xffffffff; };
  const beam = (a: Vector3, c: Vector3, width: number, kind = 0): void => {
    b.variation = rand();
    const middle = a.clone().lerp(c, 0.48).add(point((rand()-0.5)*0.035,0,(rand()-0.5)*0.035));
    b.tube([a,middle,c],[width,width*0.91,width*0.83],kind,7);
  };
  const occupiedPaving: PavingRect[] = [];
  const paving = (x0: number,x1: number,z0: number,z1: number,top: number,columns: number,rows: number): void => {
    // The mortar core is recessed. Full-depth chipped stones form every visible
    // edge, rather than a thin cap sitting on a broad featureless foundation box.
    for (const part of exposedPaving({x0:x0+0.14,x1:x1-0.14,z0:z0+0.1,z1:z1-0.1},occupiedPaving)) {
      b.box((part.x0+part.x1)/2,(top-0.35)/2,(part.z0+part.z1)/2,part.x1-part.x0,top+0.15,part.z1-part.z0,13);
    }
    const width=(x1-x0)/columns,depth=(z1-z0)/rows;
    for(let row=0;row<rows;row++) {
      const joints=Array.from({length:columns+1},(_,column)=>x0+column*width+(column===0||column===columns?0:(rand()-0.5)*width*0.34));
      for(let column=0;column<columns;column++) {
        const variation=rand();
        for (const part of exposedPaving({x0:joints[column],x1:joints[column+1],z0:z0+row*depth,z1:z0+(row+1)*depth},occupiedPaving)) {
          if (part.x1-part.x0<0.05 || part.z1-part.z0<0.05) continue;
          b.stone(part.x0+0.016,part.x1-0.016,part.z0+0.014,part.z1-0.014,-0.25,top,variation);
        }
      }
    }
    occupiedPaving.push({x0,x1,z0,z1});
  };
  paving(-OUTER.x,OUTER.x,-OUTER.z,OUTER.z,FLOOR,8,4);
  paving(TERRACE.x0,TERRACE.x1,TERRACE.z0,TERRACE.z1,FLOOR,8,2);
  paving(PIER.x0,PIER.x1,PIER.z0,PIER.z1,FLOOR,4,3);
  for(let k=0;k<STEPS.count;k++) paving(STEPS.x0,STEPS.x1,TERRACE.z1+k*STEPS.tread,TERRACE.z1+(k+1)*STEPS.tread,FLOOR-k*STEPS.rise,2,1);
  // The lookout is a continuation of the limestone terrace. Its level stone
  // surface keeps the fishing/sitting anchors, without the former dark crate-like decking.

  const front=OUTER.z,back=-OUTER.z, ridge=-0.45;
  const roofHeight=(t:number):number=>5.65-2.24*t+0.14*Math.sin(t*Math.PI)-0.22*Math.pow(Math.max(0,t-0.8)/0.2,1.3);
  const roofX=(side:number,t:number):number=>ridge+side*(side<0?4.42:5.32)*t;
  // A-frame and ridge are real, exposed timbers, bowed and tied rather than extruded trim.
  for(const z of [back,front]) {
    for(const x of [-OUTER.x,1.45,OUTER.x]) beam(point(x,FLOOR-0.04,z),point(x+(x<0?0.035:-0.045),3.5,z+0.018),0.175);
    beam(point(-4.48,3.42,z),point(4.48,3.48,z),0.185);
    beam(point(-4.65,3.35,z+0.1),point(ridge,5.55,z+0.1),0.18);
    beam(point(ridge,5.55,z+0.1),point(4.85,3.35,z+0.1),0.18);
    beam(point(ridge,3.43,z+0.06),point(ridge,5.55,z+0.06),0.085);
    beam(point(-2.8,3.45,z+0.04),point(ridge,4.72,z+0.04),0.075);
    beam(point(ridge,4.72,z+0.04),point(2.7,3.47,z+0.04),0.075);
    for(const x of [-OUTER.x,OUTER.x]) {
      const inward=x<0?0.75:-0.75;
      beam(point(x,2.65,z+0.05),point(x+inward,3.42,z+0.05),0.075);
      for(let wrap=0;wrap<4;wrap++) b.box(x,3.13+wrap*0.055,z+0.14,0.29,0.028,0.06,6);
    }
  }
  beam(point(ridge-0.06,5.64,-3.53),point(ridge+0.04,5.7,3.62),0.15);
  for(const x of [-OUTER.x,OUTER.x]) beam(point(x,3.45,-3.05),point(x,3.45,3.22),0.12);
  for(const z of [-2.25,-0.7,0.85,2.45]) for(const side of [-1,1]) {
    const path=Array.from({length:8},(_,i)=>point(roofX(side,i/7),roofHeight(i/7)-0.13,z));
    b.tube(path,path.map(()=>0.075),0,6);
  }
  // Warm overlapping split-reed laths close most of the front loft. The exposed
  // diagonal trusses stay in front, with a narrow ventilation gap under the ridge.
  for(let row=0;row<7;row++) {
    const y0=3.49+row*0.245,y1=y0+0.225;
    const width0=3.73*(5.28-y0)/(5.28-3.49),width1=3.73*(5.28-y1)/(5.28-3.49);
    b.variation=0.45+rand()*0.45;
    b.quad(point(ridge-width0,y0,front-0.055),point(ridge+width0*1.12,y0+0.012,front-0.055),point(ridge+width1*1.12,y1,front-0.04),point(ridge-width1,y1,front-0.04),12,width0*2.12,0.225);
    beam(point(ridge-width0,y0,front-0.025),point(ridge+width0*1.12,y0+0.012,front-0.025),0.018,6);
  }

  // Thin, irregular blue woven panels leave actual openings for the inset window and door.
  const panel=(x0:number,x1:number,y0:number,y1:number,z:number):void=>{
    b.variation=rand();
    const inset=0.025*(rand()-0.5),depth=z>0?-0.085:0.085;
    b.quad(point(x0,y0,z+depth),point(x1,y0+0.015,z+depth+inset),point(x1-0.018,y1,z+depth),point(x0+0.025,y1-0.018,z+depth-inset),4,x1-x0,y1-y0);
  };
  for(let i=0;i<6;i++) panel(-OUTER.x+i*1.43,-OUTER.x+(i+1)*1.43,FLOOR+0.08,3.4,back);
  for(const x of [-OUTER.x,OUTER.x]) for(let i=0;i<4;i++) {
    const z0=back+i*1.315,z1=z0+1.315;
    b.variation=rand();
    b.quad(point(x,FLOOR+0.04,z0),point(x,FLOOR+0.04,z1),point(x+(i%2?0.025:-0.02),3.4,z1),point(x,3.38,z0),4,1.315,2.65);
    beam(point(x,FLOOR,z0),point(x,3.4,z0),0.04);
  }
  const door0=0.2,door1=1.42,win0=2.02,win1=3.58,winBottom=1.59,winTop=2.94;
  panel(-OUTER.x,-2.75,FLOOR,3.39,front);panel(-2.75,-1.2,FLOOR,3.4,front);panel(-1.2,door0,FLOOR,3.38,front);
  panel(door0,door1,3.0,3.43,front);panel(door1,win0,FLOOR,3.4,front);
  panel(win0,win1,FLOOR,winBottom,front);panel(win0,win1,winTop,3.41,front);panel(win1,OUTER.x,FLOOR,3.4,front);
  // Low weathered planks and exposed battens divide the woven insets into a
  // timber structure. The supporting slab and every resident lane stay intact.
  for(const [x0,x1] of [[-OUTER.x,door0-0.06],[door1+0.06,OUTER.x]]) {
    const count=Math.ceil((x1-x0)/0.36),width=(x1-x0)/count;
    for(let i=0;i<count;i++) {
      b.variation=0.18+rand()*0.68;
      b.box(x0+(i+0.5)*width,FLOOR+0.32,front+0.025,width-0.016,0.61+(rand()-0.5)*0.035,0.10,12);
    }
    beam(point(x0,FLOOR+0.66,front+0.07),point(x1,FLOOR+0.66,front+0.07),0.045);
  }
  for(const x of [-2.75,-1.2]) {
    beam(point(x,FLOOR+0.05,front+0.075),point(x+0.02,3.41,front+0.075),0.075);
    for(const y of [FLOOR+0.68,3.26]) b.box(x,y,front+0.157,0.07,0.07,0.025,6);
  }
  for(const x of [-OUTER.x,OUTER.x]) {
    for(let row=0;row<3;row++) {
      b.variation=0.25+rand()*0.55;
      b.box(x,FLOOR+0.12+row*0.21,0,0.11,0.19,OUTER.z*2,0);
    }
    beam(point(x,FLOOR+0.66,back),point(x,FLOOR+0.66,front),0.045);
  }
  // Dark reveal, recessed uneven door planks, two metal hinges and a warm wood threshold.
  b.box((door0+door1)/2,1.88,front-0.14,1.29,2.33,0.14,5);
  for(let plank=0;plank<5;plank++) {
    b.variation=rand();
    b.box(door0+0.045+(plank+0.5)*0.222,1.85,front-0.065,0.214,2.17,0.075,12);
  }
  for(const x of [door0-0.025,door1+0.025]) beam(point(x,FLOOR,front+0.12),point(x,3.05,front+0.12),0.105);
  beam(point(door0-0.06,3.04,front+0.12),point(door1+0.1,3.04,front+0.12),0.12);
  for(const y of [1.15,2.45]) b.box(door0+0.2,y,front+0.015,0.24,0.085,0.035,5);
  beam(point(door1-0.22,1.75,front+0.07),point(door1-0.22,1.91,front+0.07),0.035,6);
  beam(point(door0+0.13,1.12,front-0.004),point(door1-0.14,2.53,front-0.004),0.045);
  // Four warm divided panes sit behind broad timber jambs, never pasted onto the facade.
  b.box((win0+win1)/2,(winBottom+winTop)/2,front-0.18,win1-win0+0.2,winTop-winBottom+0.2,0.1,5);
  for(let row=0;row<2;row++)for(let column=0;column<2;column++) {
    b.variation=0.2+rand()*0.6;
    b.box(win0+(column+0.5)*(win1-win0)/2,winBottom+(row+0.5)*(winTop-winBottom)/2,front-0.11,(win1-win0)/2-0.065,(winTop-winBottom)/2-0.065,0.02,7);
  }
  for(const x of [win0-0.06,(win0+win1)/2,win1+0.06]) beam(point(x,winBottom-0.07,front+0.1),point(x,winTop+0.07,front+0.1),x===(win0+win1)/2?0.045:0.1);
  for(const y of [winBottom-0.06,(winBottom+winTop)/2,winTop+0.06]) beam(point(win0-0.1,y,front+0.1),point(win1+0.1,y,front+0.1),y===(winBottom+winTop)/2?0.04:0.1);
  for(const x of [win0-0.045,win1+0.045]) b.box(x,(winBottom+winTop)/2,front-0.035,0.11,winTop-winBottom+0.12,0.26,0);
  b.box((win0+win1)/2,winBottom-0.12,front+0.14,1.86,0.12,0.34,0);

  // A shaded under-roof backs the gaps. Broad overlapping leaves curve across each slope.
  for(const side of [-1,1]) {
    for(let i=0;i<14;i++) {
      const t0=i/14,t1=(i+1)/14;
      b.quad(point(roofX(side,t0),roofHeight(t0)-0.1,-3.16),point(roofX(side,t1),roofHeight(t1)-0.1,-3.16),point(roofX(side,t1),roofHeight(t1)-0.1,3.16),point(roofX(side,t0),roofHeight(t0)-0.1,3.16),3,1,1);
    }
    for(const [course,start] of [0.59,0.29,0.018].entries()) for(let column=0;column<7;column++) {
      const z=-3.05+column*1.02+(rand()-0.5)*0.14;
      const length=0.43+rand()*0.08,width=0.68+rand()*0.16,lift=0.06+rand()*0.018;
      const crease=rand()*6.283,notch=0.25+rand()*0.5,lean=(rand()-0.5)*0.028;
      b.leaf((u,t)=>{
        const along=start+length*t;
        const nick=1-0.10*Math.exp(-Math.pow((t-notch)/0.045,2))*Math.max(0,u);
        const spread=width*(0.37+0.63*Math.pow(Math.sin(Math.PI*t),0.7))*(1-0.91*Math.pow(t,14))*nick;
        const curl=(0.018*Math.sin(t*18+crease)+lean*t*t)*u*u;
        // Each course covers the one below it; the slight cross-leaf tilt
        // tucks one side under its neighbour instead of crossing through it.
        return point(roofX(side,along)+0.045*Math.sin(t*Math.PI)*Math.sin(z),roofHeight(along)+lift+course*0.19*Math.min(1,t*4)+0.065*(1-u*u)*Math.sin(t*Math.PI)-0.025*Math.abs(u)-0.10*u+curl,z+u*spread+0.1*Math.sin(t*2.8+column));
      },rand());
    }
  }
  // A loose leaf awning drops over the left panel, held above the existing bench lane.
  for(let i=0;i<4;i++) {
    const x=-4.05+i*0.83;
    b.leaf((u,t)=>{
      const width=0.58*(0.75+0.25*Math.sin(t*Math.PI))*(1-0.75*Math.pow(t,12));
      return point(x+u*width,3.62-0.72*t+0.13*Math.sin(t*Math.PI)+0.055*(1-u*u),front-0.15+t*1.26);
    },0.35+i*0.1,14,0.04);
  }
  beam(point(-4.36,2.83,front+1.04),point(-4.34,3.68,front+0.08),0.04);
  beam(point(-1.42,2.86,front+1.01),point(-1.44,3.67,front+0.06),0.04);

  // Existing sitting surfaces and paths stay exactly where Muse's routines expect them.
  b.box(BENCH.x,FLOOR+BENCH.seat-0.035,BENCH.z,BENCH.half*2,0.07,BENCH.depth*2,0);
  for(const dx of [-0.62,0.62]) b.box(BENCH.x+dx,FLOOR+0.23,BENCH.z,0.1,0.42,0.32,0);
  b.box(BENCH.x,FLOOR+0.14,BENCH.z,1.24,0.05,0.04,0);
  const chair=(x:number,y:number,z:number,w:number,h:number,d:number):void=>{
    const cx=CHAIR.x+x*Math.cos(CHAIR.turn)+z*Math.sin(CHAIR.turn),cz=CHAIR.z+z*Math.cos(CHAIR.turn)-x*Math.sin(CHAIR.turn);
    b.box(cx,y,cz,w,h,d,0);
  };
  chair(0,FLOOR+0.44,0,0.44,0.05,0.42);
  for(const x of [-0.18,0.18])for(const z of [-0.17,0.17])chair(x,FLOOR+0.21,z,0.05,0.42,0.05);
  for(const x of [-0.18,0.18])chair(x,FLOOR+0.72,-0.19,0.05,0.56,0.05);
  chair(0,FLOOR+0.86,-0.19,0.4,0.18,0.04);
  for(let i=0;i<5;i++) b.box(PIER.x0+0.18+i*0.8,FLOOR+0.45,PIER.z0+0.1,0.055,0.9,0.055,0);
  beam(point(PIER.x0+0.18,FLOOR+0.86,PIER.z0+0.1),point(PIER.x0+3.38,FLOOR+0.86,PIER.z0+0.1),0.035);

  // A repaired teal crate and open, thin-rimmed pots occupy the wall margin, off the routes.
  b.box(-3.55,FLOOR+0.24,front+0.19,0.66,0.48,0.42,9);
  for(const x of [-3.86,-3.25]) b.box(x,FLOOR+0.25,front+0.42,0.075,0.5,0.05,0);
  for(const y of [FLOOR+0.08,FLOOR+0.41]) b.box(-3.55,y,front+0.43,0.72,0.065,0.05,0);
  const pot=(x:number,z:number,height:number,radius:number):void=>{
    const profile=[0.55,0.91,1,0.94,0.72,0.74];
    for(let row=0;row<profile.length-1;row++)for(let k=0;k<12;k++) {
      const a=k*Math.PI/6,c=(k+1)*Math.PI/6,y0=FLOOR+height*row/5,y1=FLOOR+height*(row+1)/5;
      b.quad(point(x+Math.cos(a)*radius*profile[row],y0,z+Math.sin(a)*radius*profile[row]),point(x+Math.cos(c)*radius*profile[row],y0,z+Math.sin(c)*radius*profile[row]),point(x+Math.cos(c)*radius*profile[row+1],y1,z+Math.sin(c)*radius*profile[row+1]),point(x+Math.cos(a)*radius*profile[row+1],y1,z+Math.sin(a)*radius*profile[row+1]),8,1/12,height/5);
    }
    b.tube(Array.from({length:17},(_,i)=>point(x+Math.cos(i*Math.PI/8)*radius*0.74,FLOOR+height,z+Math.sin(i*Math.PI/8)*radius*0.74)),Array(17).fill(0.025) as number[],8,5);
    b.box(x,FLOOR+height*0.75,z,radius*1.1,0.025,radius*1.1,5);
  };
  pot(3.9,front+0.12,0.48,0.23);pot(-2.92,front+0.12,0.37,0.18);
  // A few drying reeds and a little window herb are deliberate household
  // details, placed against the wall rather than across the walking terrace.
  for(let i=0;i<5;i++) {
    const a=i*2.4,root=point(3.9,FLOOR+0.42,front+0.12);
    const tip=root.clone().add(point(Math.cos(a)*0.12,0.49+(i%3)*0.13,Math.sin(a)*0.08));
    beam(root,tip,0.012,6);
    b.leaf((u,t)=>{
      const width=0.065*Math.sin(Math.PI*t);
      return tip.clone().add(point(Math.cos(a)*t*0.22+Math.sin(a)*u*width,t*0.08-t*t*0.18,Math.sin(a)*t*0.22-Math.cos(a)*u*width));
    },0.2+i*0.12,1,0.012);
  }
  for(let i=0;i<5;i++) beam(point(-2.92+(i-2)*0.024,FLOOR+0.26,front+0.12),point(-2.98+i*0.025,FLOOR+0.84+(i%2)*0.1,front+0.03),0.012,6);
  // A small hanging lantern has a folded paper case, separate dark ribs and a cord.
  const centre=point(1.64,2.96,front+0.25),top=centre.clone().add(point(0,0.35,0)),bottom=centre.clone().add(point(0,-0.3,0));
  for(let i=0;i<5;i++) {
    const a=i*Math.PI*2/5,c=(i+1)*Math.PI*2/5;
    const p=centre.clone().add(point(Math.cos(a)*0.14,0.04,Math.sin(a)*0.14)),q=centre.clone().add(point(Math.cos(c)*0.14,0.04,Math.sin(c)*0.14));
    b.triangle(bottom,q,p,7);b.triangle(p,q,top,7);
    b.tube([bottom,p,top],[0.008,0.009,0.007],0,4);
  }
  beam(top,point(1.64,3.5,front+0.25),0.015,6);
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
