import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { CanyonGeometry } from './canyonGeometry';
import fragmentShader from './props.frag.glsl?raw';
import vertexShader from './props.vert.glsl?raw';

// Keep the supported walking/deck footprint stable for Muse's resident routes.
// The building itself is a timber frame, woven reed walls and a thin crimson awning.
export const FLOOR=0.72;
export const COTTAGE={halfX:4.12,halfZ:2.45,wall:3.45,thickness:0.36,overhang:0.45,pitch:0.16} as const;
const OUTER={x:COTTAGE.halfX+COTTAGE.thickness/2,z:COTTAGE.halfZ+COTTAGE.thickness/2} as const;
export const ROOF={ex:4.85,ez:3.4,eave:3.3,rise:1.95,ridge:0,slope:6.8,top:5.25} as const;
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
    // Small, non-coplanar facets replace metre-wide flat plinth faces.
    // Their upper edge is still the exact support boundary; only the buried
    // perimeter below it expands into a broken talus foot.
    const lower=(p:Vector3,ring:0|1|2):Vector3=>{
      const variation=Math.sin(p.x*2.41+p.z*1.73);
      const small=Math.sin(p.x*7.33-p.z*5.21);
      const out=outwardAt(p.x,p.z,p.y);
      const offset=ring===0?0.055+0.04*variation:ring===1?0.24+0.09*variation+0.045*small:0.50+0.17*variation+0.065*small;
      const y=ring===0?p.y*(0.71+0.08*small):ring===1?p.y*(0.23+0.07*variation):-0.25+0.055*variation;
      return p.clone().addScaledVector(out,offset).setY(y);
    };
    const pieces=Math.max(1,Math.ceil(a.distanceTo(c)/0.55));
    for(let i=0;i<pieces;i++){
      const p=a.clone().lerp(c,i/pieces),q=a.clone().lerp(c,(i+1)/pieces);
      const p0=lower(p,0),q0=lower(q,0),p1=lower(p,1),q1=lower(q,1),p2=lower(p,2),q2=lower(q,2);
      b.quad(p,q,q0,p0,2,p.distanceTo(q),p.y*0.3);
      b.quad(p0,q0,q1,p1,2,p.distanceTo(q),p.y*0.45);
      b.quad(p1,q1,q2,p2,2,p.distanceTo(q),p.y*0.25+0.25);
    }
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
  // The support is exposed fractured chalk rather than a board-wrapped
  // stage. Its single union surface still carries all existing walking routes.

  // High rear corners fasten directly against the rock's face near z=-3.1.
  // Four slim, slightly crooked uprights replace the six-post box frame.
  const rearL=new Vector3(-4.3,5.25,-3.2),rearR=new Vector3(4.2,4.65,-3.2);
  const frontL=new Vector3(-4.48,3.3,3.18),frontR=new Vector3(4.35,3.05,3.35);
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
  for(const corner of [rearL,rearR]){
    const wall=corner.clone().add(new Vector3(0,0.18,-0.85));
    beam(corner,wall,0.022,13);
    beam(wall.clone().add(new Vector3(-0.13,0,0)),wall.clone().add(new Vector3(0.13,0,0)),0.045);
  }
  // The front hem hangs between the posts; no straight rafter forces it flat.
  // Short back braces reinforce the attachment; the front/right bay stays open.
  beam(new Vector3(-4.23,FLOOR+0.1,-3.04),new Vector3(-2.9,2.55,-2.99),0.052);
  beam(new Vector3(4.15,FLOOR+0.12,-3.04),new Vector3(3.2,2.35,-3.01),0.048);

  // A continuous sewn windscreen has folds and a staggered hem. Adjacent
  // strips share their boundary exactly: the old 0.88 m panels at 0.86 m
  // spacing overlapped along their edges and could shimmer through each other.
  const curtainPoint=(u:number,v:number):Vector3=>{
    const x=-3.97+6.18*u;
    const top=4.04-0.61*u-0.12*Math.sin(Math.PI*u);
    const bottom=FLOOR+0.16+0.11*Math.sin(u*13.0)+0.07*Math.cos(u*26.0);
    return new Vector3(x,top+(bottom-top)*v,-2.87+0.055*Math.sin(u*Math.PI*14)+0.035*Math.sin(u*23.0+v*2.0)*v);
  };
  for(let x=0;x<42;x++)for(let y=0;y<5;y++){
    const u0=x/42,u1=(x+1)/42,v0=y/5,v1=(y+1)/5;
    b.triangle(curtainPoint(u0,v0),curtainPoint(u1,v0),curtainPoint(u1,v1),5,[[u0*6.18,v0*3],[u1*6.18,v0*3],[u1*6.18,v1*3]]);
    b.triangle(curtainPoint(u0,v0),curtainPoint(u1,v1),curtainPoint(u0,v1),5,[[u0*6.18,v0*3],[u1*6.18,v1*3],[u0*6.18,v1*3]]);
  }
  const curtainCord=Array.from({length:29},(_,i)=>curtainPoint(i/28,0).add(new Vector3(0,0.045,-0.025)));
  b.tube(curtainCord,curtainCord.map(()=>0.016),13,5);
  for(let k=0;k<8;k++){
    const top=curtainPoint((k+0.2)/8,0);
    beam(top.clone().add(new Vector3(0,0.01,0)),top.clone().add(new Vector3(0,0.22,-0.10)),0.012,13);
  }
  // Low salvaged boards reinforce the windscreen without making a box wall.
  for(let i=0;i<12;i++){
    const x=-3.72+i*0.47,h=0.56+0.13*Math.sin(i*1.8);
    b.box(x,FLOOR+h/2,-2.77,0.43,h,0.055,0);
  }
  // A narrow left windbreak has a ragged top and no closed side frame.
  b.quad(new Vector3(-4.12,FLOOR+0.12,-2.7),new Vector3(-4.12,FLOOR+0.18,-0.9),new Vector3(-4.1,2.45,-0.9),new Vector3(-4.1,3.12,-2.7),5,1.8,2.1);

  // One tensioned red sheet: uneven wall anchors and a deep catenary-like
  // front hem replace the old rectangular pavilion silhouette.
  const point=(u:number,v:number):Vector3=>{
    const rear=rearL.clone().lerp(rearR,u),front=frontL.clone().lerp(frontR,u);
    const p=rear.lerp(front,v);
    p.y-=0.57*Math.sin(Math.PI*u)*Math.sin(Math.PI*v*0.68)+0.12*Math.sin(Math.PI*v);
    p.y+=0.028*Math.sin(u*Math.PI*10)*v*v;
    p.z+=0.07*Math.sin(Math.PI*u)*v*v;
    return p;
  };
  const columns=32,rows=18;
  // Match the vertex shader's pinned-edge wind periods. Only the interior
  // moves; the stitched hem and four attachment points stay on their ropes.
  const clothU=Math.PI/0.324,clothV=Math.PI/0.462;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const u0=x/columns,u1=(x+1)/columns,v0=y/rows,v1=(y+1)/rows;
    const a=point(u0,v0),c=point(u1,v1);
    b.triangle(a,point(u1,v0),c,4,[[u0*clothU,v0*clothV],[u1*clothU,v0*clothV],[u1*clothU,v1*clothV]]);
    b.triangle(a,c,point(u0,v1),4,[[u0*clothU,v0*clothV],[u1*clothU,v1*clothV],[u0*clothU,v1*clothV]]);
  }
  for(const v of [0,1]){
    const points=Array.from({length:33},(_,i)=>point(i/32,v));
    b.tube(points,points.map(()=>0.018),13,5);
  }
  for(const u of [0,1]){
    const points=Array.from({length:19},(_,i)=>point(u,i/18));
    b.tube(points,points.map(()=>0.016),13,5);
  }
  // Two taut side guys visibly connect fabric, post and stone fixing. They
  // remain outside the front approach and have small wooden tension toggles.
  for(const [corner,peg] of [[frontL,new Vector3(-5.10,FLOOR+0.1,2.7)],[frontR,new Vector3(4.95,FLOOR+0.08,2.85)]] as const){
    const start=corner.clone().add(new Vector3(0,-0.05,0));
    beam(start,peg,0.015,13);
    const toggle=start.clone().lerp(peg,0.62);
    beam(toggle.clone().add(new Vector3(-0.10,-0.03,0)),toggle.clone().add(new Vector3(0.10,0.03,0)),0.029);
    beam(peg.clone().add(new Vector3(0,-0.12,0)),peg.clone().add(new Vector3(0,0.20,0)),0.045);
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
  // Open-necked clay vessels have a real rim and dark interior, rather
  // than a sphere with a painted opening. All walls meet along shared edges.
  const pot=(x:number,y:number,z:number,r:number,h:number,kind:number):void=>{
    const profile=[[0,0.60],[0.12,0.85],[0.58,1.0],[0.86,0.70],[1,0.69]] as const;
    const levels=profile.map(([height])=>new Vector3(x,y+h*height,z));
    b.tube(levels,profile.map(([,radius])=>r*radius),kind,14,true);
    const top=y+h,outer=r*0.69,inner=Math.max(0.025,outer-0.035);
    const centre=new Vector3(x,top-0.15,z);
    for(let i=0;i<14;i++){
      const a=i/14*Math.PI*2,c=(i+1)/14*Math.PI*2;
      const oa=new Vector3(x+Math.cos(a)*outer,top,z+Math.sin(a)*outer),oc=new Vector3(x+Math.cos(c)*outer,top,z+Math.sin(c)*outer);
      const ia=new Vector3(x+Math.cos(a)*inner,top,z+Math.sin(a)*inner),ic=new Vector3(x+Math.cos(c)*inner,top,z+Math.sin(c)*inner);
      b.quad(oa,oc,ic,ia,kind,0.10,0.035);
      b.quad(ia,ic,ic.clone().setY(top-0.15),ia.clone().setY(top-0.15),kind,0.10,0.15);
      b.triangle(centre,ia.clone().setY(top-0.15),ic.clone().setY(top-0.15),6);
    }
  };
  pot(-3.39,FLOOR+0.02,1.09,0.33,0.64,10);
  pot(-2.75,FLOOR+0.02,1.25,0.25,0.40,11);
  pot(1.19,FLOOR+0.875,-2.15,0.20,0.36,10);
  pot(1.77,FLOOR+0.875,-2.31,0.13,0.24,11);
  // A little field notebook, drying rack, labels and rolled charts make the
  // bench read as an inhabited workshop even from the normal shelter view.
  for(let i=0;i<3;i++){
    const width=0.60-i*0.055,depth=0.37-i*0.015;
    b.box(0.58,FLOOR+0.90+i*0.075,-2.10,width,0.066,depth,i===1?11:12);
    b.box(0.58,FLOOR+0.937+i*0.075,-2.10,width+0.045,0.012,depth+0.025,0);
  }
  for(let k=0;k<3;k++){
    const x=-1.84+k*0.9;
    beam(new Vector3(x,FLOOR+1.02,-2.25),new Vector3(x,FLOOR+1.37,-2.29),0.010);
    b.quad(new Vector3(x-0.07,FLOOR+1.26,-2.25),new Vector3(x+0.07,FLOOR+1.26,-2.25),new Vector3(x+0.07,FLOOR+1.36,-2.26),new Vector3(x-0.07,FLOOR+1.36,-2.26),12,0.14,0.1);
  }
  for(const [x,z,h] of [[2.86,-1.40,1.10],[3.10,-1.45,0.92]] as const){
    const points=[new Vector3(x,FLOOR+0.025,z),new Vector3(x-0.13,FLOOR+h,z-0.26)];
    b.tube(points,[0.095,0.095],12,10,true);
    const tie=points[0].clone().lerp(points[1],0.5);
    const ring=Array.from({length:13},(_,i)=>tie.clone().add(new Vector3(Math.cos(i/12*Math.PI*2)*0.103,0,Math.sin(i/12*Math.PI*2)*0.103)));
    b.tube(ring,ring.map(()=>0.012),13,4);
  }
  // Off-centre open storage below the bench; no duplicate coplanar faces
  // are laid on top of its timber surfaces for slats or straps.
  b.box(-1.45,FLOOR+0.23,-2.07,0.82,0.46,0.63,0);
  b.box(-0.30,FLOOR+0.18,-2.02,0.62,0.36,0.56,5);
  // Wall pegs and hanging hand tools occupy the gaps above the work surface.
  for(const [x,y] of [[-3.2,3.22],[-2.3,3.07],[0.2,2.93],[1.30,2.85]] as const){
    beam(new Vector3(x,y,-2.84),new Vector3(x,y,-2.62),0.025);
    const strap=[new Vector3(x,y,-2.65),new Vector3(x-0.03,y-0.21,-2.59),new Vector3(x+0.02,y-0.44,-2.60)];
    b.tube(strap,[0.012,0.012,0.012],13,4);
    beam(strap[2],strap[2].clone().add(new Vector3(0.02,-0.32,0.015)),0.025);
    b.quad(new Vector3(x-0.065,y-0.72,-2.56),new Vector3(x+0.09,y-0.72,-2.56),new Vector3(x+0.11,y-0.89,-2.56),new Vector3(x-0.02,y-0.97,-2.56),6,0.16,0.25);
  }
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
