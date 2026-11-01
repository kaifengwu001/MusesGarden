import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three';
import { WindGeometry } from './windGeometry';

export interface GeologyPrototype {
  name: string;
  geometry: BufferGeometry;
  /** Authored boundaries and bedding creases; never triangulation diagonals. */
  outline: BufferGeometry;
  footprint: number;
  height: number;
  leeSites: readonly (readonly [number, number])[];
  supportSites: readonly Vector3[];
}

type Plan = readonly (readonly [number, number])[];
type Surface = (x: number, z: number) => number;
const P = (x: number, y: number, z: number): Vector3 => new Vector3(x,y,z);

/** Explicit geological faces. Flat polygon caps are triangulated without a raised centre. */
class RockBuilder {
  private readonly body = new WindGeometry();
  private readonly ground: number[] = [];
  private readonly lines: number[] = [];
  private readonly lineGround: number[] = [];
  private readonly smoothNormals: Array<Vector3 | undefined> = [];
  readonly supportSites: Vector3[] = [];

  triangle(a: Vector3,b: Vector3,c: Vector3,kind = 2,ground: readonly number[] = [0,0,0]): void {
    this.body.triangle(a,b,c,kind,[[a.x,a.y],[b.x,b.y],[c.x,c.y]]);
    this.ground.push(...ground);
    this.smoothNormals.push(undefined,undefined,undefined);
  }
  line(a: Vector3,b: Vector3,ga = 0,gb = 0): void {
    this.lines.push(a.x,a.y,a.z,b.x,b.y,b.z);
    this.lineGround.push(ga,gb);
  }
  /** A genuine planar exposed bed, optionally notched in plan, with supported sides. */
  bed(source: Plan, top: Surface, bottom: Surface, grounded = true, kind = 2, ink = true): void {
    const plan = [...source];
    const area=plan.reduce((sum,p,i)=>sum+p[0]*plan[(i+1)%plan.length][1]-p[1]*plan[(i+1)%plan.length][0],0);
    if(area<0) plan.reverse();
    // Bedding has a consistent dip, while exposed sides lean with the strata.
    // This affine shear retains planar faces without square vertical risers.
    const at=(x:number,y:number,z:number):Vector3=>P(x+y*0.22,y,z-y*0.16);
    const high=plan.map(([x,z])=>at(x,top(x,z),z));
    // A stacked bed penetrates its support slightly. Its hidden underside
    // must not duplicate the exposed cap of the bed directly below it.
    const low=plan.map(([x,z])=>at(x,bottom(x,z)-(grounded?0:0.035),z));
    const cap=ShapeUtils.triangulateShape(plan.map(([x,z])=>new Vector2(x,z)),[]);
    const g=grounded?1:0;
    for(const [a,b,c] of cap) {
      this.triangle(high[a],high[c],high[b],kind);
      this.triangle(low[a],low[b],low[c],kind,[g,g,g]);
    }
    for(let i=0;i<plan.length;i++) {
      const j=(i+1)%plan.length;
      this.triangle(low[i],high[i],high[j],kind,[g,0,0]);
      this.triangle(low[i],high[j],low[j],kind,[g,0,g]);
      if(ink) {
        this.line(high[i],high[j]);
        // Only structural corners receive a vertical joint. No face diagonals.
        if(i%3!==1) this.line(low[i],high[i],g,0);
      }
    }
    if(grounded) this.supportSites.push(...low);
  }
  /** A broken chunk defined by its side profile, not a radial crown/shoulder stack. */
  chunk(profile: Plan, depth: number, x = 0,z = 0, lean = 0.12): void {
    const points=[...profile];
    const area=points.reduce((sum,p,i)=>sum+p[0]*points[(i+1)%points.length][1]-p[1]*points[(i+1)%points.length][0],0);
    if(area<0) points.reverse();
    // Uneven fracture depths make the broad exposed face a set of subtly
    // different mineral planes. The perimeter still defines the rock: no
    // raised triangulation centre, tiled bevels or displaced floating veneer.
    const relief=(px:number,y:number,phase:number):number=>Math.min(1,Math.max(0,y/1.5))*(
      Math.sin(px*1.17+y*.73+phase)*.16+Math.sin(px*.57-y*1.41+phase*1.7)*.095);
    const front=points.map(([px,y])=>P(px+x+y*lean,y,z+depth*0.5+px*0.055-y*0.11+relief(px,y,.7)));
    const back=points.map(([px,y])=>P(px+x+y*(lean-0.06),y,z-depth*0.5+y*0.09+relief(px,y,2.3)*.75));
    const ground=points.map(([,y])=>y<0?1:0);
    const cap=ShapeUtils.triangulateShape(points.map(([px,y])=>new Vector2(px,y)),[]);
    for(const [a,b,c] of cap) {
      this.triangle(front[a],front[b],front[c],2,[ground[a],ground[b],ground[c]]);
      this.triangle(back[c],back[b],back[a],2,[ground[c],ground[b],ground[a]]);
    }
    for(let i=0;i<points.length;i++) {
      const j=(i+1)%points.length;
      this.triangle(front[i],back[i],back[j],2,[ground[i],ground[i],ground[j]]);
      this.triangle(front[i],back[j],front[j],2,[ground[i],ground[j],ground[j]]);
      this.line(front[i],front[j],ground[i],ground[j]);
      if(points[i][1]>0.2) this.line(front[i],back[i]);
      if(points[i][1]>0.2&&points[j][1]>0.2) this.line(back[i],back[j]);
    }
    for(let i=0;i<points.length;i++) if(ground[i]) this.supportSites.push(front[i],back[i]);
  }
  /** A stone cut by geological planes, with selected missing corners and broad blunt faces. */
  block(width:number,height:number,depth:number,cuts:readonly (readonly [number,number,number,number])[],x=0,z=0,floor=-1):void {
    const x0=-width/2,x1=width/2,z0=-depth/2,z1=depth/2;
    let faces:Vector3[][]=[
      [P(x0,floor,z1),P(x1,floor,z1),P(x1,height,z1),P(x0,height,z1)],
      [P(x1,floor,z0),P(x0,floor,z0),P(x0,height,z0),P(x1,height,z0)],
      [P(x0,floor,z0),P(x0,floor,z1),P(x0,height,z1),P(x0,height,z0)],
      [P(x1,floor,z1),P(x1,floor,z0),P(x1,height,z0),P(x1,height,z1)],
      [P(x0,height,z1),P(x1,height,z1),P(x1,height,z0),P(x0,height,z0)],
      [P(x0,floor,z0),P(x1,floor,z0),P(x1,floor,z1),P(x0,floor,z1)],
    ];
    const key=(p:Vector3):string=>`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
    const rounded=(p:Vector3):Vector3=>P(Math.round(p.x*1e6)/1e6,Math.round(p.y*1e6)/1e6,Math.round(p.z*1e6)/1e6);
    for(const [nx,ny,nz,limit] of cuts) {
      const n=P(nx,ny,nz),rim=new Map<string,Vector3>(),next:Vector3[][]=[];
      for(const face of faces) {
        const clipped:Vector3[]=[];
        for(let i=0;i<face.length;i++) {
          const a=face[i],b=face[(i+1)%face.length],da=n.dot(a)-limit,db=n.dot(b)-limit;
          if(da<=1e-7) clipped.push(a);
          if((da< -1e-7&&db>1e-7)||(da>1e-7&&db< -1e-7)) {
            const point=rounded(a.clone().lerp(b,da/(da-db)));
            clipped.push(point);rim.set(key(point),point);
          }
        }
        const unique=clipped.filter((v,i)=>i===0||key(v)!==key(clipped[i-1]));
        if(unique.length>2&&key(unique[0])===key(unique[unique.length-1]))unique.pop();
        if(unique.length>2)next.push(unique);
      }
      if(rim.size>2) {
        const cap=[...rim.values()],centre=cap.reduce((sum,p)=>sum.add(p),new Vector3()).multiplyScalar(1/cap.length);
        const u=new Vector3().crossVectors(n,Math.abs(n.y)<0.8?P(0,1,0):P(1,0,0)).normalize();
        const v=new Vector3().crossVectors(n,u).normalize();
        cap.sort((a,b)=>Math.atan2(a.clone().sub(centre).dot(v),a.clone().sub(centre).dot(u))-Math.atan2(b.clone().sub(centre).dot(v),b.clone().sub(centre).dot(u)));
        next.push(cap);
      }
      faces=next;
    }
    const used=new Set<string>(),supports=new Map<string,Vector3>();
    for(const face of faces) {
      const points=face.map(p=>P(p.x+x,p.y,p.z+z));
      const ground=face.map(p=>Math.abs(p.y-floor)<1e-5?1:0);
      for(let i=1;i+1<points.length;i++)this.triangle(points[0],points[i],points[i+1],2,[ground[0],ground[i],ground[i+1]]);
      for(let i=0;i<points.length;i++) {
        const j=(i+1)%points.length,id=[key(points[i]),key(points[j])].sort().join('|');
        if(!used.has(id)){this.line(points[i],points[j],ground[i],ground[j]);used.add(id);}
        if(ground[i])supports.set(key(points[i]),points[i]);
      }
    }
    this.supportSites.push(...supports.values());
  }
  /** A closed sand deposit: visible rim meets the bed, hidden underside embeds into it. */
  sand(plan: Plan,support: Surface,thickness=0.11):void {
    const distance=(x:number,z:number):number=>{
      let closest=Infinity;
      for(let i=0;i<plan.length;i++) {
        const a=plan[i],b=plan[(i+1)%plan.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
        closest=Math.min(closest,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
      }
      return closest;
    };
    const cover=(x:number,z:number):number=>{
      const t=Math.min(1,distance(x,z)/0.38);
      return t*t*(3-2*t);
    };
    const height=(x:number,z:number):number=>support(x,z)+thickness*cover(x,z);
    const at=(x:number,y:number,z:number):Vector3=>P(x+y*0.22,y,z-y*0.16);
    const normal=(x:number,z:number):Vector3=>{
      const e=0.004,dx=(height(x+e,z)-height(x-e,z))/(e*2),dz=(height(x,z+e)-height(x,z-e))/(e*2);
      return P(-dx,1+dx*0.22-dz*0.16,-dz).normalize();
    };
    const draw=(a:Vector2,b:Vector2,c:Vector2,depth:number):void=>{
      if(depth>0) {
        const ab=a.clone().add(b).multiplyScalar(0.5),bc=b.clone().add(c).multiplyScalar(0.5),ca=c.clone().add(a).multiplyScalar(0.5);
        draw(a,ab,ca,depth-1);draw(ab,b,bc,depth-1);draw(ca,bc,c,depth-1);draw(ab,bc,ca,depth-1);return;
      }
      const source=[a,c,b];
      const upper=source.map(q=>at(q.x,height(q.x,q.y),q.y)),lower=source.map(q=>at(q.x,support(q.x,q.y)-.035*cover(q.x,q.y),q.y));
      if(upper.every((q,i)=>q.distanceToSquared(lower[i])<1e-14))return;
      this.triangle(upper[0],upper[1],upper[2],13);
      const offset=this.smoothNormals.length-3;
      source.forEach((q,i)=>this.smoothNormals[offset+i]=normal(q.x,q.y));
      this.triangle(lower[2],lower[1],lower[0],13);
    };
    const points=plan.map(([x,z])=>new Vector2(x,z));
    const area=points.reduce((sum,a,i)=>sum+a.x*points[(i+1)%points.length].y-a.y*points[(i+1)%points.length].x,0);
    if(area<0)points.reverse();
    for(const [a,b,c] of ShapeUtils.triangulateShape(points,[]))draw(points[a],points[b],points[c],2);
  }
  build(): {geometry: BufferGeometry; outline: BufferGeometry} {
    const geometry=this.body.build();
    geometry.setAttribute('aGround',new Float32BufferAttribute(this.ground,1));
    const normals=geometry.getAttribute('normal');
    this.smoothNormals.forEach((normal,index)=>{if(normal)normals.setXYZ(index,normal.x,normal.y,normal.z);});
    // Edge vertices sit outside their adjacent mineral planes. A geometric
    // offset preserves occlusion; camera-directed pulls can expose a rear
    // edge through the front of another intersecting slab.
    const positions=geometry.getAttribute('position');
    const key=(x:number,y:number,z:number):string=>`${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
    const vertexNormals=new Map<string,Vector3>();
    for(let i=0;i<positions.count;i++) {
      const k=key(positions.getX(i),positions.getY(i),positions.getZ(i));
      const normal=vertexNormals.get(k)??new Vector3();
      normal.add(new Vector3(normals.getX(i),normals.getY(i),normals.getZ(i)));
      vertexNormals.set(k,normal);
    }
    const lineNormals:number[]=[];
    for(let i=0;i<this.lines.length;i+=3) {
      const normal=vertexNormals.get(key(this.lines[i],this.lines[i+1],this.lines[i+2]))?.clone().normalize()??P(0,1,0);
      lineNormals.push(normal.x,normal.y,normal.z);
    }
    const outline=new BufferGeometry();
    outline.setAttribute('position',new Float32BufferAttribute(this.lines,3));
    outline.setAttribute('normal',new Float32BufferAttribute(lineNormals,3));
    outline.setAttribute('aGround',new Float32BufferAttribute(this.lineGround,1));
    return {geometry,outline};
  }
}

const level=(height: number,slope = 0.08):Surface=>(x,z)=>height+x*slope-z*0.035;
const BASE: Surface=()=>-1.7;

/** Four different construction families: exposed beds, stratified walls, side-profile chunks and cliff columns. */
export function makeGeologyPrototypes(): GeologyPrototype[] {
  const result: GeologyPrototype[]=[];
  const add=(name: string,sites: readonly (readonly [number,number])[],author:(b:RockBuilder)=>void):void=>{
    const b=new RockBuilder();author(b);
    const {geometry,outline}=b.build();
    geometry.computeBoundingBox();
    const box=geometry.boundingBox!;
    const footprint=Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z)));
    result.push({name,geometry,outline,footprint,height:box.max.y,leeSites:sites,supportSites:b.supportSites});
  };

  add('Notched exposed bed',[[-3,2.2],[0.3,2.4],[3.8,2.3]],b=>{
    const left=level(0.95,0.055),middle=(x:number,z:number):number=>1.06-x*0.06-z*0.06,right=(x:number,z:number):number=>0.85+x*0.08+z*0.03;
    // Two open crooked joints split the exposed top into three different planes.
    b.bed([[-6,-1.7],[-3.2,-2.5],[-1.4,-2.4],[-1.65,-1.3],[-1.1,-0.15],[-1.45,1.2],[-0.9,2.5],[-4,1.9],[-5.9,0.6]],left,BASE);
    b.bed([[-1.3,-2.4],[1.8,-2.2],[1.6,-0.85],[2.2,0.4],[1.65,1.65],[-0.78,2.48],[-1.33,1.2],[-0.98,-0.15],[-1.53,-1.3]],middle,BASE);
    b.bed([[1.92,-2.18],[4.6,-2],[5.7,-0.9],[5.2,1.6],[2.4,2.3],[1.79,1.67],[2.34,0.4],[1.74,-0.85]],right,BASE);
    b.sand([[-5.15,-1.45],[-3.5,-1.95],[-2.1,-1.7],[-2.2,-0.65],[-3.9,-0.55],[-4.8,-0.8]],left,0.13);
    b.sand([[-0.85,-1.65],[0.55,-1.85],[1.35,-1.55],[1.2,-0.8],[0.1,-0.35],[-0.8,-0.6]],middle,0.08);
  });
  add('Broken terraced reef',[[-4,2.9],[-0.4,3.3],[4.3,2.6]],b=>{
    const lower=level(0.82,0.09),middle=level(1.85,0.09),upper=level(2.9,0.09);
    b.bed([[-6.7,-2],[-4.4,-3],[1,-3.3],[5.9,-1.8],[6.2,0.8],[3.6,2],[0.3,3.4],[-3,2.8],[-6.5,1]],lower,BASE);
    b.bed([[-5.9,-2.1],[-3.1,-3.2],[1.4,-2.8],[4.5,-1.4],[3.7,0.6],[0.1,1.6],[-3,0.9],[-5.5,1.2]],middle,lower,false);
    b.bed([[-2.6,-2.8],[1.3,-3],[3.8,-1.65],[2.8,-0.4],[0.1,0.35],[-2.7,-0.1]],upper,middle,false);
    b.sand([[-5.2,1.2],[-2.6,1.05],[0.4,1.8],[2.7,1.1],[3.5,1.5],[0,2.7],[-3.6,2.1]],lower,0.14);
    b.sand([[-2.3,-0.05],[0,0.5],[2.5,-0.1],[2.8,0.35],[0.1,1.1],[-2.6,0.55]],middle,0.09);
  });
  add('Interrupted long ledge',[[-4.5,1.8],[-0.8,1.5],[3.8,1.5]],b=>{
    const top=level(1.1,0.055);
    b.bed([[-6.4,-1.2],[-3.8,-1.7],[-0.7,-1.45],[-0.9,1.25],[-3.5,1.9],[-6.1,1]],top,BASE);
    b.bed([[-0.55,-1.5],[2.1,-2],[5.7,-0.75],[5.3,0.9],[2.9,1.55],[-0.7,1.15]],top,BASE);
    b.bed([[-4.2,-1.3],[-1.4,-1.3],[-1.3,-0.1],[-3.8,0.2]],level(1.55,0.055),top,false);
    b.sand([[0.1,-1.15],[2.2,-1.55],[4.6,-0.8],[3.2,-0.3],[0,-0.45]],top,0.09);
  });
  add('Blunt jointed outcrop',[[-1.7,2.35],[0.7,1.6],[2,1.4]],b=>{
    b.block(4.6,2.8,3.3,[[0.26,1,0.16,2.45],[1,0.18,0,2.05],[-1,0.31,0.12,2.05],[0.12,0.22,1,1.7],[1,0.32,1,2.8],[-1,0.08,1,2.65],[0.7,0.62,-0.4,2.32]]);
    b.block(2.5,1.38,1.9,[[-0.22,1,0.16,1.25],[1,0.1,1,1.7],[-1,0.32,0,1.2],[0,0.15,-1,0.95]],-1.9,1.45,-0.8);
  });
  add('Detached split blocks',[[-1.5,1.3],[0.8,1.8],[2.4,1]],b=>{
    b.block(3.7,1.95,2.6,[[-0.12,1,0.24,1.72],[1,0.3,0,1.65],[-1,0.16,-0.2,1.85],[0.2,0.24,1,1.3],[1,0.25,1,2.12],[-1,0.1,1,2.25],[0.4,0.5,-0.7,1.7]]);
    b.block(1.9,1.12,1.7,[[0.27,1,-0.12,1.04],[1,0.18,1,1.35],[-1,0.12,0,0.95],[0,0.25,-1,0.8]],1.55,0.65,-0.65);
  });
  add('Inclined fractured wall',[[-4.7,2.7],[0.2,2.5],[4.6,2.5]],b=>{
    // Three different long fracture profiles form inclined sheets, each with
    // broken shoulders and missing bites. There is no rectangular block grid.
    b.chunk([[-7.3,-3],[-6.7,0.9],[-4.9,1.75],[-3.7,1.5],[-1.8,3.15],[0.5,3.8],[1.4,3.55],[4.7,6.05],[6.1,6.65],[6.7,6.25],[5.45,-3]],2.7,0,-1.3,0.18);
    b.chunk([[-6.5,-2.8],[-6.15,0.45],[-4.4,1.2],[-2.5,1.85],[-1.45,1.65],[0.8,3.15],[2.7,3.45],[4.75,4.65],[5.1,4.2],[3.85,-2.8]],1.65,-0.55,0.9,0.21);
    const lower=(x:number,z:number):number=>0.95+x*0.15-z*0.06;
    b.bed([[-7.2,-0.7],[-4.5,-1.2],[-1.8,-0.7],[0.4,-0.95],[3.2,0.1],[5.1,0.7],[4.3,2.2],[1.7,2.7],[-0.5,2.3],[-3.3,3],[-6.5,1.7]],lower,()=>-3.1);
    b.sand([[-5.8,1.15],[-3.1,2.05],[-0.4,1.6],[1.2,1.95],[2.5,1.7],[2.8,2.15],[1.6,2.35],[-0.5,1.98],[-3.3,2.6],[-5.6,1.6]],lower,0.13);
  });
  add('Broken cliff buttress',[[-3.6,3.2],[0.6,3.6],[3.3,2.8]],b=>{
    // Weathered side profiles taper and lean at different rates. A broad
    // chipped crown and long sloping shoulders replace the skyline of towers.
    b.chunk([[-5.4,-3.2],[-5.1,1.3],[-4.2,3.65],[-3.8,5.4],[-2.5,7.7],[-0.9,9.15],[0.35,9.0],[0.9,7.4],[2.4,5.8],[2.8,2.8],[2.35,-3.2]],4.0,0,-1.0,0.20);
    b.chunk([[-3.15,-2.5],[-3.55,0.75],[-2.9,3.1],[-1.2,4.5],[-0.2,6.35],[1.1,6.75],[1.65,5.8],[2.5,3.45],[2.85,0.7],[2.4,-2.5]],2.55,2.1,0.15,0.08);
    b.chunk([[-2.3,-2.2],[-2.7,0.3],[-2.05,2.25],[-0.85,3.0],[0.25,2.75],[1.8,1.2],[1.45,-2.2]],2.6,-3.05,1.6,0.27);
    const foot=(x:number,z:number):number=>1.1+x*0.10-z*0.12;
    b.bed([[-6.2,-0.3],[-3.6,-0.5],[-1,0.1],[0.5,0.55],[2.8,0.3],[4.8,1.1],[4.3,2.3],[1.8,3.1],[0.4,3.6],[-2.4,3.1],[-4.5,3]],foot,BASE);
    b.sand([[-3,1.75],[0,2.05],[3.8,1.55],[3.6,2.05],[0.3,2.9],[-3,2.6]],foot,0.13);
  });
  add('Blunt fallen stone',[[-0.5,0.55],[0.2,0.65],[0.6,0.3]],b=>{
    b.block(1.65,0.61,1.12,[[0.13,1,0.19,0.51],[1,0.15,1,1.05],[-1,0.22,-0.2,0.82],[-0.2,0.25,1,0.6],[0.45,0.35,-1,0.77]],0,0,-0.45);
  });
  add('Broad windward fin',[[-4,2.5],[0,3.3],[4.7,2.7]],b=>{
    b.chunk([[-8.1,6.75],[-7.35,7.0],[-5.7,6.2],[-3.9,5.8],[-2.6,5.0],[0.2,4.55],[3.2,3.2],[7.4,1.25],[7.0,-3],[-2.9,-3],[-4.9,1.5],[-6.6,3.5]],3.2,0,-0.6,0.08);
    b.chunk([[-5.8,3.85],[-4.6,4.4],[-2.3,3.7],[-0.7,3.45],[1.0,2.5],[4.5,1.8],[6.3,0.7],[5.8,-2.7],[-3.1,-2.7],[-4.1,0.8]],1.9,0.2,1.1,0.18);
    const shelf=(x:number,z:number):number=>3.15-x*0.30-z*0.04;
    b.bed([[-4.7,1.25],[-2.7,1.15],[-0.4,1.45],[1.8,1.25],[4.9,1.6],[4.6,2.4],[2.7,2.65],[0.5,2.4],[-1.8,2.7],[-4.3,2.15]],shelf,(x,z)=>shelf(x,z)-0.42,false);
    b.sand([[-4.0,1.6],[-2.5,1.45],[-0.5,1.7],[1.8,1.55],[4.3,1.85],[3.9,2.2],[1.9,2.3],[-0.5,2.1],[-2.2,2.4],[-3.8,2.0]],shelf,0.16);
  });
  return result;
}
