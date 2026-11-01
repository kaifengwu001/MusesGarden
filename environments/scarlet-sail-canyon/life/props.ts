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

/** A single cloth lean-to fixed to the canyon wall, over the existing walking surfaces. */
export function shelterGeometry(seed:number):ReturnType<CanyonGeometry['build']>{
  const b=new CanyonGeometry();
  const beam=(a:Vector3,c:Vector3,width:number,kind=0):void=>b.tube([a,c],[width,width*0.86],kind,6);
  // One height/material cell per point in the UNION of the old support
  // rectangles. Neither neighbouring slabs nor board overlays draw a second
  // coplanar top. The navigation constants and all physical top heights stay.
  interface Support {x0:number;x1:number;z0:number;z1:number;top:number}
  const supports:Support[]=[
    {x0:-OUTER.x,x1:OUTER.x,z0:-OUTER.z,z1:OUTER.z,top:FLOOR},
    {...TERRACE,top:FLOOR},
    {...PIER,top:FLOOR},
    ...Array.from({length:STEPS.count},(_,k)=>({x0:STEPS.x0,x1:STEPS.x1,z0:TERRACE.z1+k*STEPS.tread,z1:TERRACE.z1+(k+1)*STEPS.tread,top:FLOOR-k*STEPS.rise})),
  ];
  const levelAt=(x:number,z:number):number|null=>{
    let height:number|null=null;
    for(const s of supports)if(x>s.x0-1e-9&&x<s.x1+1e-9&&z>s.z0-1e-9&&z<s.z1+1e-9)height=height===null?s.top:Math.max(height,s.top);
    return height;
  };
  const xs=[...new Set(supports.flatMap(s=>[s.x0,s.x1]))].sort((a,c)=>a-c);
  const zs=[...new Set(supports.flatMap(s=>[s.z0,s.z1]))].sort((a,c)=>a-c);
  const outwardAt=(x:number,z:number,top:number):Vector3=>{
    const out=new Vector3();
    for(const dx of [-1,1])for(const dz of [-1,1]){
      const h=levelAt(x+dx*0.0001,z+dz*0.0001);
      if(h===null||h<top-1e-6)out.add(new Vector3(dx,0,dz));
    }
    return out.normalize();
  };
  const edge=(a:Vector3,c:Vector3,below:number|null):void=>{
    if(below!==null){
      // A real riser between two different support heights, never an internal
      // wall below two equal-height neighbours.
      b.quad(a,c,c.clone().setY(below),a.clone().setY(below),2,a.distanceTo(c),a.y-below);
      return;
    }
    const lower=(p:Vector3,foot:boolean):Vector3=>{
      const variation=Math.sin(p.x*2.41+p.z*1.73);
      const out=outwardAt(p.x,p.z,p.y);
      return p.clone().addScaledVector(out,foot?0.13+0.045*variation:0.055+0.025*variation).setY(foot?-0.28+0.035*variation:p.y*(0.38+0.09*variation));
    };
    const ma=lower(a,false),mc=lower(c,false),fa=lower(a,true),fc=lower(c,true);
    b.quad(a,c,mc,ma,2,a.distanceTo(c),a.y*0.6);
    b.quad(ma,mc,fc,fa,2,a.distanceTo(c),a.y*0.4+0.28);
  };
  for(let ix=0;ix+1<xs.length;ix++)for(let iz=0;iz+1<zs.length;iz++){
    const x0=xs[ix],x1=xs[ix+1],z0=zs[iz],z1=zs[iz+1];
    const x=(x0+x1)/2,z=(z0+z1)/2,top=levelAt(x,z);
    if(top===null)continue;
    const kind=Math.abs(x)<OUTER.x&&Math.abs(z)<OUTER.z?9:2;
    const a=new Vector3(x0,top,z0),c=new Vector3(x1,top,z0),d=new Vector3(x1,top,z1),e=new Vector3(x0,top,z1);
    b.quad(e,d,c,a,kind,x1-x0,z1-z0);
    for(const [p,q,nx,nz] of [[a,c,x,z0-0.0001],[c,d,x1+0.0001,z],[d,e,x,z1+0.0001],[e,a,x0-0.0001,z]] as const){
      const below=levelAt(nx,nz);
      if(below===null||below<top-1e-6)edge(p,q,below);
    }
  }
  // A few low angular chips join the exposed foot to the surrounding chalk.
  // They remain outside all deck/step support rectangles and route lanes.
  for(const [x,z,w,d,h] of [[PIER.x0-0.28,PIER.z0+0.5,0.32,0.65,0.13],[PIER.x0-0.25,PIER.z1-0.7,0.30,0.46,0.17],[PIER.x0+0.7,PIER.z1+0.27,0.66,0.30,0.12],[PIER.x0+2.1,PIER.z1+0.29,0.44,0.32,0.09],[OUTER.x+0.30,0.8,0.30,0.72,0.14]]){
    const a=new Vector3(x-w*0.5,-0.03,z-d*0.4),c=new Vector3(x+w*0.5,-0.03,z+d*0.5);
    const ridge=new Vector3(x-w*0.08,h,z+d*0.02);
    const p=new Vector3(c.x,-0.03,a.z),q=new Vector3(a.x,-0.03,c.z);
    b.triangle(a,p,ridge,2);b.triangle(p,c,ridge,2);b.triangle(c,q,ridge,2);b.triangle(q,a,ridge,2);
  }
  // Salvaged offcuts hold the upper face of the ledge: uneven dark wood
  // breaks the long bright plinth, while fractured chalk remains at its foot.
  const fascia=(from:Vector3,to:Vector3):void=>{
    const length=from.distanceTo(to),count=Math.max(1,Math.ceil(length/1.3));
    for(let k=0;k<count;k++){
      const a=from.clone().lerp(to,k/count+0.008/count),c=from.clone().lerp(to,(k+1)/count-0.008/count);
      const low=0.23+0.07*Math.sin(k*2.3+length);
      const high=FLOOR-0.045-0.017*(k%2);
      b.quad(a.clone().setY(low),a.clone().setY(high),c.clone().setY(high-0.012),c.clone().setY(low+0.035*Math.sin(k+1)),0,high-low,length/count);
    }
  };
  fascia(new Vector3(TERRACE.x0,0,TERRACE.z1+0.12),new Vector3(STEPS.x0-0.04,0,TERRACE.z1+0.12));
  fascia(new Vector3(STEPS.x1+0.04,0,TERRACE.z1+0.12),new Vector3(TERRACE.x1,0,TERRACE.z1+0.12));
  fascia(new Vector3(PIER.x0,0,PIER.z1+0.12),new Vector3(PIER.x1,0,PIER.z1+0.12));
  fascia(new Vector3(OUTER.x+0.13,0,-OUTER.z+0.3),new Vector3(OUTER.x+0.13,0,OUTER.z));
  fascia(new Vector3(TERRACE.x1+0.12,0,OUTER.z),new Vector3(TERRACE.x1+0.12,0,TERRACE.z1-0.15));
  // The floor's weathered plank material is on the union surface itself.
  // No boxes or material decals sit on top of its exact support plane.

  // High rear corners fasten directly against the rock's face near z=-3.1.
  // Four slim, slightly crooked uprights replace the six-post box frame.
  const rearL=new Vector3(-4.3,4.65,-3.2),rearR=new Vector3(4.2,4.45,-3.2);
  const frontL=new Vector3(-4.48,3.4,3.18),frontR=new Vector3(4.35,2.95,3.35);
  for(const [foot,head] of [
    [new Vector3(-4.25,-0.05,-3.05),rearL],
    [new Vector3(4.14,-0.05,-3.06),rearR],
    [new Vector3(-4.45,FLOOR-0.04,3.15),frontL],
    [new Vector3(4.36,-0.05,3.33),frontR],
  ]){
    b.tube([foot,foot.clone().lerp(head,0.48).add(new Vector3(0.025,0,0.035)),head.clone().add(new Vector3(0,0.22,0))],[0.087,0.078,0.062],0,6);
    // A few visible cord lashings at each upper attachment.
    for(let k=0;k<3;k++){
      const y=head.y-0.06+k*0.035;
      const ring=Array.from({length:13},(_,j)=>new Vector3(head.x+Math.cos(j/12*Math.PI*2)*0.085,y,head.z+Math.sin(j/12*Math.PI*2)*0.085));
      b.tube(ring,ring.map(()=>0.009),5,4);
    }
  }
  beam(rearL.clone().add(new Vector3(-0.23,0,0)),rearR.clone().add(new Vector3(0.25,0,0)),0.07);
  beam(frontL.clone().add(new Vector3(-0.22,-0.015,0)),frontR.clone().add(new Vector3(0.3,0.03,0)),0.052);
  // Short back braces reinforce the attachment; the front/right bay stays open.
  beam(new Vector3(-4.23,FLOOR+0.1,-3.04),new Vector3(-2.9,2.55,-2.99),0.052);
  beam(new Vector3(4.15,FLOOR+0.12,-3.04),new Vector3(3.2,2.35,-3.01),0.048);

  // A rough suspended canvas windscreen covers only part of the stone wall.
  // Separate drooping panels leave uneven hems and a useful open right bay.
  for(let k=0;k<7;k++){
    const x0=-3.95+k*0.86,x1=x0+0.88;
    const top=3.42-0.055*k+0.035*Math.sin(k*1.7);
    const low=FLOOR+0.12+0.10*Math.sin(k*2.1+0.4);
    const z=-2.91+0.045*Math.sin(k*1.6);
    const a=new Vector3(x0,top,z),c=new Vector3(x1,low,z+0.07);
    b.triangle(a,new Vector3(x1,top-0.035,z),c,5,[[0,0],[0.88,0],[0.88,top-low]]);
    b.triangle(a,c,new Vector3(x0,low+0.055,z+0.04),5,[[0,0],[0.88,top-low],[0,top-low-0.055]]);
    beam(new Vector3(x0+0.05,top,z),new Vector3(x0+0.05,top+0.32,z-0.03),0.009,5);
  }
  beam(new Vector3(-4.05,3.5,-2.96),new Vector3(2.25,3.1,-2.96),0.045);
  // Low salvaged boards reinforce the windscreen without making a box wall.
  for(let i=0;i<12;i++){
    const x=-3.72+i*0.47,h=0.56+0.13*Math.sin(i*1.8);
    b.box(x,FLOOR+h/2,-2.77,0.43,h,0.055,0);
  }
  // A narrow left windbreak has a ragged top and no closed side frame.
  b.quad(new Vector3(-4.12,FLOOR+0.12,-2.7),new Vector3(-4.12,FLOOR+0.18,-0.9),new Vector3(-4.1,2.45,-0.9),new Vector3(-4.1,3.12,-2.7),5,1.8,2.1);

  // One broad woven red sheet slopes down from the rock. Front sag and a
  // lower right corner give the hand-tensioned canopy its asymmetric silhouette.
  const point=(u:number,v:number):Vector3=>{
    const rear=4.65-0.2*u,front=3.4-0.45*u;
    return new Vector3(-4.48+u*8.83,rear+(front-rear)*v-0.43*Math.sin(Math.PI*u)*Math.sin(Math.PI*v*0.65)-0.10*Math.sin(Math.PI*v)+0.028*Math.sin(u*Math.PI*8)*v*v,-3.2+v*(6.38+u*0.17));
  };
  const columns=28,rows=16;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const u0=x/columns,u1=(x+1)/columns,v0=y/rows,v1=(y+1)/rows;
    const a=point(u0,v0),c=point(u1,v1);
    b.triangle(a,point(u1,v0),c,4,[[u0*8.83,v0*6.5],[u1*8.83,v0*6.5],[u1*8.83,v1*6.5]]);
    b.triangle(a,c,point(u0,v1),4,[[u0*8.83,v0*6.5],[u1*8.83,v1*6.5],[u0*8.83,v1*6.5]]);
  }
  for(const v of [0,1]){
    const points=Array.from({length:29},(_,i)=>point(i/28,v));
    b.tube(points,points.map(()=>0.012),5,4);
  }
  for(const u of [0,1]){
    const points=Array.from({length:17},(_,i)=>point(u,i/16));
    b.tube(points,points.map(()=>0.012),5,4);
  }

  // A rear work shelf, seed trays and a low chest occupy the non-walking bay.
  b.box(-0.5,FLOOR+0.82,-2.16,5.4,0.10,0.86,0);
  for(const x of [-2.9,1.85])for(const z of [-2.46,-1.86])b.box(x,FLOOR+0.39,z,0.075,0.78,0.075,0);
  for(let k=0;k<3;k++){
    const x=-2.1+k*0.9;
    b.box(x,FLOOR+0.94,-2.12,0.65,0.14,0.47,0);
    b.box(x,FLOOR+1.025,-2.12,0.55,0.025,0.36,6);
    for(let j=0;j<3;j++)beam(new Vector3(x-0.16+j*0.16,FLOOR+1.03,-2.12),new Vector3(x-0.13+j*0.16,FLOOR+1.25+(j%2)*0.07,-2.1),0.012,8);
  }
  b.box(-3.03,FLOOR+0.27,-0.55,1.12,0.54,0.69,0);
  b.box(-3.03,FLOOR+0.57,-0.55,1.16,0.065,0.72,0);
  for(const x of [-3.42,-2.65])b.box(x,FLOOR+0.31,-0.18,0.045,0.52,0.025,6);
  const basket=(x:number,z:number,r:number,height:number):void=>{
    const lower=Array.from({length:17},(_,i)=>new Vector3(x+Math.cos(i/16*Math.PI*2)*r*0.73,FLOOR+0.025,z+Math.sin(i/16*Math.PI*2)*r*0.73));
    const upper=lower.map((_,i)=>new Vector3(x+Math.cos(i/16*Math.PI*2)*r,FLOOR+height,z+Math.sin(i/16*Math.PI*2)*r));
    for(let i=0;i<16;i++){
      b.quad(lower[i],lower[i+1],upper[i+1],upper[i],5,0.12,height);
      b.triangle(new Vector3(x,FLOOR+0.035,z),lower[i+1],lower[i],6);
    }
    for(let k=0;k<4;k++){
      const t=k/3,ring=lower.map((p,i)=>p.clone().lerp(upper[i],t));
      b.tube(ring,ring.map(()=>0.012),0,4);
    }
    const handle=Array.from({length:13},(_,i)=>new Vector3(x+Math.cos(i/12*Math.PI)*r,FLOOR+height+Math.sin(i/12*Math.PI)*r*0.75,z));
    b.tube(handle,handle.map(()=>0.014),5,4);
  };
  basket(2.65,1.22,0.28,0.39);
  basket(3.21,0.99,0.22,0.31);
  basket(-2.16,-0.8,0.19,0.25);
  // A broom and short spade lean against the left rear pole, away from routes.
  beam(new Vector3(-3.62,FLOOR,-1.7),new Vector3(-3.88,FLOOR+1.65,-2.14),0.021);
  for(let i=0;i<8;i++)beam(new Vector3(-3.62+(i-3.5)*0.035,FLOOR+0.02,-1.69),new Vector3(-3.66,FLOOR+0.34,-1.77),0.012,5);
  beam(new Vector3(-3.21,FLOOR+0.05,-2.4),new Vector3(-3.42,FLOOR+1.4,-2.65),0.018);
  b.box(-3.2,FLOOR+0.13,-2.39,0.16,0.23,0.032,6);

  // Exact sitting surfaces preserve every existing host routine.
  b.box(BENCH.x,FLOOR+BENCH.seat-0.035,BENCH.z,BENCH.half*2,0.07,BENCH.depth*2,0);
  for(const dx of [-0.62,0.62])b.box(BENCH.x+dx,FLOOR+0.23,BENCH.z,0.1,0.42,0.32,0);
  b.box(BENCH.x,FLOOR+0.14,BENCH.z,1.24,0.05,0.04,0);
  const chair=(x:number,y:number,z:number,w:number,h:number,d:number):void=>{
    const cx=CHAIR.x+x*Math.cos(CHAIR.turn)+z*Math.sin(CHAIR.turn);
    const cz=CHAIR.z+z*Math.cos(CHAIR.turn)-x*Math.sin(CHAIR.turn);
    b.box(cx,y,cz,w,h,d,0);
  };
  chair(0,FLOOR+0.44,0,0.44,0.05,0.42);
  for(const x of [-0.18,0.18])for(const z of [-0.17,0.17])chair(x,FLOOR+0.21,z,0.05,0.42,0.05);
  for(const x of [-0.18,0.18])chair(x,FLOOR+0.72,-0.19,0.05,0.56,0.05);
  chair(0,FLOOR+0.86,-0.19,0.4,0.18,0.04);
  const rz=PIER.z0+0.1;
  for(let i=0;i<5;i++)b.box(PIER.x0+0.18+i*0.8,FLOOR+0.45,rz,0.055,0.9,0.055,0);
  beam(new Vector3(PIER.x0+0.18,FLOOR+0.86,rz),new Vector3(PIER.x0+3.38,FLOOR+0.86,rz),0.035);

  const lantern=(x:number,z:number,attachment:number):void=>{
    const y=attachment-0.57;
    beam(new Vector3(x,attachment,z),new Vector3(x,y+0.17,z),0.009,5);
    b.box(x,y,z,0.15,0.27,0.14,7);
    b.box(x,y+0.15,z,0.2,0.035,0.18,6);
    b.box(x,y-0.15,z,0.19,0.04,0.17,6);
    for(const dx of [-0.09,0.09])for(const dz of [-0.075,0.075])beam(new Vector3(x+dx,y-0.15,z+dz),new Vector3(x+dx,y+0.15,z+dz),0.009,6);
  };
  lantern(frontL.x-0.18,frontL.z+0.04,frontL.y-0.02);
  lantern(frontR.x+0.18,frontR.z+0.05,frontR.y-0.01+(seed%7)*0.003);
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
