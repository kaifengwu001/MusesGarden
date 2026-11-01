import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { WindGeometry } from './windGeometry';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// Keep the supported walking/deck footprint stable for Muse's resident routes.
// A sheltered cleft in cobalt bedrock, closed with timber and a suspended canvas porch.
export const FLOOR=0.72;
export const COTTAGE={halfX:4.12,halfZ:2.45,wall:3.45,thickness:0.36,overhang:0.45,pitch:0.16} as const;
const OUTER={x:COTTAGE.halfX+COTTAGE.thickness/2,z:COTTAGE.halfZ+COTTAGE.thickness/2} as const;
export const ROOF={ex:4.85,ez:3.4,eave:3.6,rise:1,ridge:0,slope:6.8,top:4.6} as const;
export const TERRACE={x0:-OUTER.x-0.1,x1:OUTER.x-0.2,z0:OUTER.z-0.3,z1:OUTER.z+2.1} as const;
/** The former pier is now a dry stone lookout; its deck still supports resident routines. */
export const PIER={x0:-OUTER.x-3.9,x1:-OUTER.x+0.9,z0:OUTER.z-0.8,z1:OUTER.z+3.0} as const;
export const STEPS={x0:OUTER.x-2.3,x1:OUTER.x-0.5,count:3,rise:FLOOR/3,tread:0.33} as const;
export const ARCH={x:PIER.x0+1,spring:-0.78,half:0.55,depth:1.6} as const;
export const BENCH={x:-OUTER.x+(2.52+4.6)/2-0.12,z:OUTER.z+0.22,half:0.74,depth:0.19,seat:0.485} as const;
export const FACE=OUTER.z;
export const SIDE=OUTER.x;
export const CHAIR={x:-OUTER.x-0.55,z:OUTER.z+0.45,turn:0.5} as const;
/** Retained for callers that describe the old footprint; no chimney is rendered. */
export const CHIMNEY={x:0.1,z:-0.6,half:0.29} as const;

interface SupportRectangle { x0:number; x1:number; z0:number; z1:number; top:number; }

/** One cap per point, with faces only at exposed edges and real height changes. */
export function shelterSupportGeometry():ReturnType<WindGeometry['build']>{
  const b=new WindGeometry();
  appendShelterSupport(b);
  return b.build();
}

function appendShelterSupport(b:WindGeometry):void{
  const rectangles:SupportRectangle[]=[
    {x0:-OUTER.x,x1:OUTER.x,z0:-OUTER.z,z1:OUTER.z,top:FLOOR},
    {...TERRACE,top:FLOOR}, {...PIER,top:FLOOR},
    ...Array.from({length:STEPS.count},(_,k)=>({x0:STEPS.x0,x1:STEPS.x1,z0:TERRACE.z1+k*STEPS.tread,z1:TERRACE.z1+(k+1)*STEPS.tread,top:FLOOR-k*STEPS.rise})),
  ];
  const xs=[...new Set(rectangles.flatMap(r=>[r.x0,r.x1]))].sort((a,c)=>a-c);
  const zs=[...new Set(rectangles.flatMap(r=>[r.z0,r.z1]))].sort((a,c)=>a-c);
  const height=(x:number,z:number):number=>rectangles.reduce((top,r)=>x>r.x0&&x<r.x1&&z>r.z0&&z<r.z1?Math.max(top,r.top):top,-.30);
  const levels=Array.from({length:zs.length-1},(_,j)=>Array.from({length:xs.length-1},(_,i)=>height((xs[i]+xs[i+1])*.5,(zs[j]+zs[j+1])*.5)));
  for(let j=0;j<zs.length-1;j++)for(let i=0;i<xs.length-1;i++){
    const top=levels[j][i];
    if(top<=-.30)continue;
    const corners=[new Vector3(xs[i],top,zs[j+1]),new Vector3(xs[i+1],top,zs[j+1]),new Vector3(xs[i+1],top,zs[j]),new Vector3(xs[i],top,zs[j])];
    b.triangle(corners[0],corners[1],corners[2],2,corners.slice(0,3).map(p=>[p.x,p.z] as const));
    b.triangle(corners[0],corners[2],corners[3],2,[corners[0],corners[2],corners[3]].map(p=>[p.x,p.z] as const));
    const neighbours=[levels[j+1]?.[i],levels[j]?.[i+1],levels[j-1]?.[i],levels[j]?.[i-1]];
    for(let edge=0;edge<4;edge++){
      const low=neighbours[edge]??-.30;
      if(low>=top-1e-8)continue;
      const a=corners[edge],c=corners[(edge+1)%4];
      b.quad(c,a,new Vector3(a.x,low,a.z),new Vector3(c.x,low,c.z),2,a.distanceTo(c),top-low);
    }
  }
}

export function shelterGeometry(seed:number):ReturnType<WindGeometry['build']>{
  const b=new WindGeometry();
  const beam=(a:Vector3,c:Vector3,width:number):void=>b.tube([a,c],[width,width*0.94],0,6);
  // Closed, chipped stone volumes. The uneven crest and exposed bedding edge
  // read as a natural slab even when the shelter is small in the landscape.
  const stone=(x:number,z:number,width:number,depth:number,low:number,top:number,id:number,slope=0):void=>{
    const cut=Math.min(width,depth)*0.14;
    const ring:readonly (readonly [number,number])[]=[
      [-width/2+cut,-depth/2],[-width/2,-depth/2+cut],
      [-width/2+0.04,depth/2-cut],[-width/2+cut,depth/2],
      [width/2-cut,depth/2],[width/2,depth/2-cut],
      [width/2-0.06,-depth/2+cut],[width/2-cut,-depth/2],
    ];
    const high=ring.map(([dx,dz],i)=>new Vector3(x+dx,top+slope*dz+Math.sin((id+1)*5.71+i*2.31+seed*0.013)*0.075,z+dz));
    // Embedded bases avoid a second cap on the walkable floor; varied buried
    // levels also prevent adjoining wall stones sharing an internal plane.
    const base=low-.018-(id+1)*.002;
    const bottom=ring.map(([dx,dz])=>new Vector3(x+dx*0.97,base,z+dz*0.97));
    const middle=new Vector3(x,top,z);
    const underneath=new Vector3(x,base,z);
    for(let i=0;i<ring.length;i++){
      const j=(i+1)%ring.length;
      b.triangle(middle,high[i],high[j],2,[[x,z],[high[i].x,high[i].z],[high[j].x,high[j].z]]);
      b.triangle(underneath,bottom[j],bottom[i],2);
      b.quad(high[j],high[i],bottom[i],bottom[j],2,high[i].distanceTo(high[j]),top-low);
      b.tube([high[i],high[j]],[0.009,0.009],6,4);
      if(i%2===0)b.tube([bottom[i],high[i]],[0.007,0.007],6,4);
    }
  };
  // A single union surface replaces overlapping floor/terrace/lookout boxes.
  // Their supported area and all three step heights remain unchanged.
  appendShelterSupport(b);
  // The lookout is one weathered rock ledge, continuous with the shelter footing.
  const front=OUTER.z,back=-OUTER.z;
  // Frame posts remain inside the non-walkable wall footprint, keeping terrace routes clear.
  for(const x of [-OUTER.x,0,OUTER.x]){
    beam(new Vector3(x,FLOOR-0.04,back),new Vector3(x,3.85,back),0.13);
    beam(new Vector3(x,FLOOR-0.04,front),new Vector3(x,3.68,front),0.12);
  }
  for(const z of [back,front]){
    const y=z===back?3.8:3.65;
    beam(new Vector3(-OUTER.x-0.12,y,z),new Vector3(OUTER.x+0.12,y,z),0.13);
    beam(new Vector3(-OUTER.x,FLOOR+0.05,z),new Vector3(OUTER.x,FLOOR+0.05,z),0.09);
  }
  for(const x of [-OUTER.x,0,OUTER.x])beam(new Vector3(x,3.84,-3.0),new Vector3(x,3.6,3.8),0.085);
  // The rear and flanks are exposed bedrock, not a regular masonry cabin.
  stone(-2.65,-1.96,3.3,1.3,FLOOR-0.05,3.93,0);
  stone(0.15,-2.0,3.05,1.2,FLOOR-0.05,4.07,1);
  stone(2.96,-1.95,2.68,1.3,FLOOR-0.05,3.98,2);
  stone(-3.94,0.05,0.72,5.12,FLOOR-0.05,3.83,3,-0.04);
  stone(3.88,0.1,0.84,5.02,FLOOR-0.05,3.94,4,-0.05);
  stone(-3.62,front-0.32,1.25,0.65,FLOOR,3.76,5);
  stone(3.56,front-0.35,1.47,0.7,FLOOR,3.88,6);
  // A dark recessed entrance with a timber door and an open slatted screen.
  // Everything stays behind FACE, so the sitting and walking routes are unchanged.
  b.box(-0.1,2.055,front-0.52,5.85,2.69,0.09,9);
  b.box(0.85,FLOOR+1.045,front-0.41,1.08,2.11,0.1,0);
  for(const x of [0.31,1.39])beam(new Vector3(x,FLOOR,front-0.31),new Vector3(x,2.93,front-0.31),0.055);
  beam(new Vector3(0.27,2.92,front-0.31),new Vector3(1.43,2.92,front-0.31),0.065);
  for(let i=0;i<11;i++)b.box(-2.82+i*0.175,1.87+(i%3)*0.025,front-0.3,0.10,2.22+(i%3)*0.05,0.08,0);
  for(const y of [1.3,2.25])beam(new Vector3(-2.92,y,front-0.23),new Vector3(-0.98,y,front-0.23),0.038);
  b.box(1.18,1.76,front-0.335,0.055,0.12,0.06,6);
  // Three massive bedding slabs bridge the cleft. Their different shoulders,
  // thicknesses and projecting ends replace the straight tiled roof silhouette.
  stone(-3.14,-0.16,3.42,6.12,3.55,4.34,7,-0.055);
  stone(-0.05,-0.37,3.6,6.06,3.62,4.48,8,-0.065);
  stone(3.14,-0.30,3.42,6.2,3.60,4.39,9,-0.045);
  const awning=(u:number,v:number):Vector3=>new Vector3(-3.7+u*(5.85-0.45*v),3.72-0.48*v+0.14*u-0.24*Math.sin(Math.PI*u)*(0.2+0.8*v),2.8+v*1.7);
  for(let y=0;y<6;y++)for(let x=0;x<16;x++){
    const u=x/16,v=y/6,un=(x+1)/16,vn=(y+1)/6;
    b.triangle(awning(u,v),awning(un,v),awning(un,vn),4,[[u*5.85,v*1.7],[un*5.85,v*1.7],[un*5.85,vn*1.7]]);
    b.triangle(awning(u,v),awning(un,vn),awning(u,vn),4,[[u*5.85,v*1.7],[un*5.85,vn*1.7],[u*5.85,vn*1.7]]);
  }
  // Rope hems describe the hanging cloth without adding poles to the deck lanes.
  const hem=Array.from({length:17},(_,i)=>awning(i/16,1));
  b.tube(hem,hem.map(()=>0.017),0,5);
  for(const u of [0,1]){
    const edge=Array.from({length:7},(_,i)=>awning(u,i/6));
    b.tube(edge,edge.map(()=>0.016),0,5);
    const corner=awning(u,1);
    beam(new Vector3(corner.x,FLOOR,corner.z),corner.clone().add(new Vector3(0,0.1,0)),0.055);
    beam(corner.clone().add(new Vector3(0,0.1,0)),awning(u,0),0.012);
  }
  // A permeable timber windbreak on the exposed flank, outside the walking deck.
  for(let i=0;i<14;i++)b.box(4.8,FLOOR+1.0,-2.8+i*0.38,0.075,2.0+(i%3)*0.09,0.17,0);
  beam(new Vector3(4.8,FLOOR+1.6,-2.9),new Vector3(4.8,FLOOR+1.6,2.4),0.045);
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
  for(const x of [-0.18,0.18])for(const z of [-0.17,0.17])chair(x,FLOOR+0.205,z,0.05,0.43,0.05);
  for(const x of [-0.18,0.18])chair(x,FLOOR+0.72,-0.19,0.05,0.56,0.05);
  chair(0,FLOOR+0.86,-0.19,0.4,0.18,0.04);
  // A low open timber guard at the back of the lookout, outside the accessible route.
  const rz=PIER.z0+0.1;
  for(let i=0;i<5;i++)b.box(PIER.x0+0.18+i*0.8,FLOOR+0.445,rz,0.055,0.91,0.055,0);
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
    this.material=new ShaderMaterial({name:'Cobalt stone shelter',vertexShader,fragmentShader,uniforms:{...shared},side:DoubleSide});
    this.mesh=new Mesh(shelterGeometry(seed),this.material);
    this.mesh.name='Timber shelter, woven awning and dry stone lookout';
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
