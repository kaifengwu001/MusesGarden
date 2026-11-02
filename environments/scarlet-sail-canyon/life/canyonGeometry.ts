import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Ray, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';

/** Small non-indexed mesh builder. Hard faces remain hard; foliage is genuinely thin geometry. */
export class CanyonGeometry {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private kinds: number[] = [];
  private plantBases: number[] = [];
  private supportSlopes: number[] = [];

  get vertexCount():number{return this.positions.length/3;}

  triangle(a: Vector3, b: Vector3, c: Vector3, kind: number, uv: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1]], smoothNormals?: readonly Vector3[], plantBase:number|readonly number[]=0,supportSlope:readonly [number,number]=[0,0]): void {
    const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const [i, p] of [a, b, c].entries()) {
      this.positions.push(p.x, p.y, p.z);
      const normal=smoothNormals?.[i]??n;
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(uv[i][0], uv[i][1]);
      this.kinds.push(kind);
      this.plantBases.push(typeof plantBase==='number'?plantBase:plantBase[i]);
      this.supportSlopes.push(...supportSlope);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, kind: number, width = 1, height = 1): void {
    this.triangle(a, b, c, kind, [[0, 0], [width, 0], [width, height]]);
    this.triangle(a, c, d, kind, [[0, 0], [width, height], [0, height]]);
  }

  box(x: number, y: number, z: number, width: number, height: number, depth: number, kind: number): void {
    const x0 = x - width / 2, x1 = x + width / 2;
    const y0 = y - height / 2, y1 = y + height / 2;
    const z0 = z - depth / 2, z1 = z + depth / 2;
    const p = (a: number, b: number, c: number): Vector3 => new Vector3(a, b, c);
    this.quad(p(x0,y0,z1),p(x1,y0,z1),p(x1,y1,z1),p(x0,y1,z1),kind,width,height);
    this.quad(p(x1,y0,z0),p(x0,y0,z0),p(x0,y1,z0),p(x1,y1,z0),kind,width,height);
    this.quad(p(x0,y0,z0),p(x0,y0,z1),p(x0,y1,z1),p(x0,y1,z0),kind,depth,height);
    this.quad(p(x1,y0,z1),p(x1,y0,z0),p(x1,y1,z0),p(x1,y1,z1),kind,depth,height);
    this.quad(p(x0,y1,z1),p(x1,y1,z1),p(x1,y1,z0),p(x0,y1,z0),kind,width,depth);
    this.quad(p(x0,y0,z0),p(x1,y0,z0),p(x1,y0,z1),p(x0,y0,z1),kind,width,depth);
  }

  tube(points: Vector3[], radii: number[], kind: number, sides = 7, smooth = false): void {
    const rings = points.map((p, i) => {
      const tangent = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const across = new Vector3().crossVectors(tangent, Math.abs(tangent.z) < 0.9 ? new Vector3(0,0,1) : new Vector3(1,0,0)).normalize();
      const other = new Vector3().crossVectors(tangent, across).normalize();
      return Array.from({length:sides}, (_, k) => p.clone().addScaledVector(across, Math.cos(k/sides*Math.PI*2)*radii[i]).addScaledVector(other, Math.sin(k/sides*Math.PI*2)*radii[i]));
    });
    let length = 0;
    for (let i=0;i+1<rings.length;i++) {
      const segment = points[i].distanceTo(points[i+1]);
      for (let k=0;k<sides;k++) {
        const next=(k+1)%sides;
        const normals=smooth?[rings[i][k].clone().sub(points[i]).normalize(),rings[i][next].clone().sub(points[i]).normalize(),rings[i+1][next].clone().sub(points[i+1]).normalize(),rings[i+1][k].clone().sub(points[i+1]).normalize()]:undefined;
        this.triangle(rings[i][k],rings[i][next],rings[i+1][next],kind,[[k/sides,length],[(k+1)/sides,length],[(k+1)/sides,length+segment]],normals?.slice(0,3));
        this.triangle(rings[i][k],rings[i+1][next],rings[i+1][k],kind,[[k/sides,length],[(k+1)/sides,length+segment],[k/sides,length+segment]],normals?[normals[0],normals[2],normals[3]]:undefined);
      }
      length+=segment;
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(this.positions,3));
    geometry.setAttribute('normal',new Float32BufferAttribute(this.normals,3));
    geometry.setAttribute('uv',new Float32BufferAttribute(this.uvs,2));
    geometry.setAttribute('aKind',new Float32BufferAttribute(this.kinds,1));
    geometry.setAttribute('aPlantBase',new Float32BufferAttribute(this.plantBases,1));
    geometry.setAttribute('aSupportSlope',new Float32BufferAttribute(this.supportSlopes,2));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** One thin living blade: folds flow outward from the stem into an uneven, lobed rim. */
export function addFanLeaf(b: CanyonGeometry, origin: Vector3, length: number, turn: number, kind = 1, spread = 1.64, tilt = 0.12, columns = 64, rows = 6, variation = 0): void {
  const point=(u:number,v:number):Vector3=>{
    const a=(u*2-1)*spread;
    const edge=1+0.09*Math.sin(a*1.1+variation*0.7)+0.028*Math.cos(a*7.0+variation)+0.012*Math.sin(a*14.0+variation);
    const r=v*length*edge;
    const x=Math.sin(a)*r;
    const y=(0.22+0.72*Math.cos(a))*r-0.17*length*v*v*v+0.008*length*Math.sin(a*15.0)*Math.pow(v,4);
    const z=0.25*r+0.14*length*Math.sin(a*1.4)*v*v+0.015*length*Math.sin(a*17.0)*Math.pow(v,1.7);
    const py=y*Math.cos(tilt)-z*Math.sin(tilt);
    const pz=y*Math.sin(tilt)+z*Math.cos(tilt);
    return origin.clone().add(new Vector3(x*Math.cos(turn)+pz*Math.sin(turn),py,pz*Math.cos(turn)-x*Math.sin(turn)));
  };
  const normal=(u:number,v:number):Vector3=>{
    const radial=Math.max(0.015,v);
    return new Vector3().crossVectors(point(u+0.001,radial).sub(point(u-0.001,radial)),point(u,radial+0.001).sub(point(u,radial-0.001))).normalize();
  };
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const u0=x/columns,u1=(x+1)/columns,v0=y/rows,v1=(y+1)/rows;
    const a=point(u0,v0),c=point(u1,v1);
    if(y>0)b.triangle(a,point(u1,v0),c,kind,[[u0,v0],[u1,v0],[u1,v1]],[normal(u0,v0),normal(u1,v0),normal(u1,v1)]);
    b.triangle(a,c,point(u0,v1),kind,[[u0,v0],[u1,v1],[u0,v1]],[normal(u0,v0),normal(u1,v1),normal(u0,v1)]);
  }
}

function curve(a:Vector3,b:Vector3,c:Vector3,d:Vector3,segments:number):Vector3[]{
  return Array.from({length:segments+1},(_,i)=>{
    const t=i/segments,q=1-t;
    return a.clone().multiplyScalar(q*q*q).addScaledVector(b,3*q*q*t).addScaledVector(c,3*q*t*t).addScaledVector(d,t*t*t);
  });
}

/** Three growth habits: swept mature crown, branching twin fans and a low young grove. */
export function fanTreeGeometry(variant=0): BufferGeometry {
  const b=new CanyonGeometry();
  const habit=((variant%3)+3)%3;
  const crown=habit===2?new Vector3(0.78,2.7,0.2):habit===1?new Vector3(0.55,3.2,0.25):new Vector3(1.65,5.05,0.38);
  const stem=curve(new Vector3(),new Vector3(-0.45,crown.y*0.35,-0.15),new Vector3(crown.x*1.15,crown.y*0.72,0.18),crown,12);
  b.tube(stem,stem.map((_,i)=>(habit===2?0.16:0.25)*Math.pow(1-i/14,1.25)+0.035),0,7,true);
  const fan=(root:Vector3,length:number,turn:number,spread:number,tilt:number,phase:number,columns=48):void=>{
    addFanLeaf(b,root,length,turn,1,spread,tilt,columns,5,phase);
  };
  if(habit===1){
    const left=new Vector3(-1.45,4.7,-0.1),right=new Vector3(2.2,5.35,0.52);
    for(const [end,length,turn,phase] of [[left,3.3,-0.38,1.2],[right,2.85,0.2,2.8]] as const){
      const branch=curve(stem[8],crown.clone().add(new Vector3(0,0.65,0)),end.clone().add(new Vector3(0,-0.65,-0.1)),end,6);
      b.tube(branch,branch.map((_,i)=>0.13*(1-i/7)+0.02),0,5,true);
      fan(end,length,turn,1.58,0.2,phase,40);
    }
  }else{
    fan(crown,habit===2?2.45:4.35,habit===2?0.22:-0.09,habit===2?1.45:1.68,habit===2?0.32:0.1,habit===2?2.3:0.2,habit===2?40:60);
    const bud=habit===2?new Vector3(-0.9,1.35,0.4):new Vector3(-0.62,2.9,-0.25);
    const branch=curve(stem[4],new Vector3(0.18,bud.y*0.75,0.05),bud.clone().add(new Vector3(-0.1,-0.45,0.1)),bud,6);
    b.tube(branch,branch.map((_,i)=>0.09*(1-i/7)+0.014),0,5,true);
    fan(bud,habit===2?1.28:1.25,-0.58,1.49,0.2,1.6,22);
    for(const side of [-1,1]){
      const rib=curve(stem[10],crown.clone().add(new Vector3(side*0.22,-0.06,0)),crown.clone().add(new Vector3(side*0.5,0.35,0.15)),crown.clone().add(new Vector3(side*0.9,0.65,0.24)),3);
      b.tube(rib,rib.map((_,i)=>0.04*(1-i/4)+0.006),0,4,true);
    }
  }
  return b.build();
}

interface ChalkMass { x:number; z:number; width:number; depth:number; height:number; phase:number; segments:number; centralPad?:number; }
/** An eroded perimeter extruded through offset fracture rings; no rectangular box faces. */
function addChalkMass(b:CanyonGeometry,m:ChalkMass):void{
  const ring=(level:number):Vector3[]=>Array.from({length:m.segments},(_,i)=>{
    const a=i/m.segments*Math.PI*2;
    const scallop=1+0.085*Math.sin(a*3+m.phase)+0.05*Math.sin(a*7.0+0.7*m.phase);
    const chipped=level===3&&i%7===3;
    const ledge=level===0?1.08:level===1?1.02:level===2?0.96:chipped?0.86:0.91;
    const shift=0.045*Math.sin(a*5+m.phase+level*0.9);
    const x=m.x+Math.cos(a)*m.width*0.5*(scallop*ledge+shift);
    const z=m.z+Math.sin(a)*m.depth*0.5*(scallop*ledge-shift);
    const top=m.height*(1+0.07*Math.sin(a*2.0+m.phase)+0.035*Math.cos(a*5+m.phase));
    const y=level===0?-0.35:level===1?top*(0.24+0.07*Math.sin(a*4+m.phase)):level===2?top*(0.73+0.11*Math.sin(a*3+0.4*m.phase)):top*(chipped?0.965:1);
    return new Vector3(x,y,z);
  });
  const rings=[ring(0),ring(1),ring(2),ring(3)];
  for(let level=0;level<3;level++)for(let i=0;i<m.segments;i++){
    const j=(i+1)%m.segments;
    // Alternating joint diagonals avoid one repeating ladder of triangles.
    b.quad(rings[level][j],rings[level][i],rings[level+1][i],rings[level+1][j],2,m.width/m.segments*3,m.height/3);
  }
  const cap=m.centralPad??m.height;
  const centre=new Vector3(m.x,cap,m.z);
  if(m.centralPad!==undefined){
    const inner=Array.from({length:m.segments},(_,i)=>new Vector3(m.x+Math.cos(i/m.segments*Math.PI*2)*1.52,cap,m.z+Math.sin(i/m.segments*Math.PI*2)*1.52));
    for(let i=0;i<m.segments;i++){
      const j=(i+1)%m.segments;
      b.quad(rings[3][j],rings[3][i],inner[i],inner[j],2,1,1);
      b.triangle(inner[j],inner[i],centre,2);
    }
  }else for(let i=0;i<m.segments;i++)b.triangle(rings[3][(i+1)%m.segments],rings[3][i],centre,2);
}

/** A broken, broad chalk fragment with small chips connected to its foot. */
export function chalkGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  addChalkMass(b,{x:0,z:0,width:2.4,depth:1.65,height:0.87,phase:0.9,segments:11});
  addChalkMass(b,{x:0.72,z:0.56,width:0.8,depth:0.52,height:0.24,phase:2.1,segments:6});
  return b.build();
}

/** A cupped lanceolate leaflet, attached at its narrow base and rising toward its soft tip. */
function addLanceolate(b:CanyonGeometry,root:Vector3,tip:Vector3,width:number,kind:number):void{
  const axis=tip.clone().sub(root),along=axis.clone().normalize();
  const across=new Vector3(0,1,0).addScaledVector(along,-along.y).normalize();
  const normal=new Vector3().crossVectors(along,across).normalize();
  const outline=[[0,0],[0.2,-0.65],[0.48,-1],[0.8,-0.58],[1,0],[0.8,0.52],[0.48,0.94],[0.2,0.6]];
  const ring=outline.map(([t,w])=>root.clone().addScaledVector(axis,t).addScaledVector(across,w*width).addScaledVector(normal,0.007*Math.sin(t*Math.PI)));
  const centre=root.clone().addScaledVector(axis,0.48).addScaledVector(normal,0.012);
  for(let i=0;i<ring.length;i++){
    const j=(i+1)%ring.length;
    b.triangle(centre,ring[i],ring[j],kind,[[0.5,0.48],[0.5+outline[i][1]*0.5,outline[i][0]],[0.5+outline[j][1]*0.5,outline[j][0]]],[normal,normal,normal]);
  }
}

/** Ivory feather fronds have fine upswept alternating leaflets, never level white tiers. */
function makeCombFern(fronds:number,pairs:number):BufferGeometry{
  const b=new CanyonGeometry();
  for(let frond=0;frond<fronds;frond++){
    const angle=frond*2.3999632297+0.3;
    const forward=new Vector3(Math.cos(angle),0,Math.sin(angle));
    const across=new Vector3(-Math.sin(angle),0,Math.cos(angle));
    const root=forward.clone().multiplyScalar(frond*0.04);
    const height=frond===0?1.36:frond===1?1.12:0.96;
    const spread=0.2+frond*0.11;
    const rib=(t:number):Vector3=>root.clone().addScaledVector(forward,spread*t*t+0.045*t).setY(height*(t-0.06*t*t*t));
    const spine=Array.from({length:5},(_,i)=>rib(i/4));
    b.tube(spine,spine.map((_,i)=>0.009*(1-i/5)+0.0025),3.1,3,true);
    for(let pair=0;pair<pairs;pair++)for(const side of [-1,1]){
      const t=0.1+pair/(pairs-1)*0.8+(side>0?0.018:0);
      const origin=rib(t);
      const length=(0.12+0.09*Math.sin(t*Math.PI))*(1-t*0.28);
      const tip=origin.clone().addScaledVector(across,side*length*0.8).addScaledVector(forward,0.018+0.012*Math.sin(pair*0.8)).add(new Vector3(0,length*(0.58+0.08*Math.sin(pair*1.2)),0));
      addLanceolate(b,origin,tip,0.027*(0.65+0.35*Math.sin(t*Math.PI)),3.1);
    }
  }
  return b.build();
}

export function fernGeometry():BufferGeometry{return makeCombFern(3,11);}

/** Fine forked coral stems carry many small lobed ends, with an asymmetric low spread. */
function makeCoral(branches:number):BufferGeometry{
  const b=new CanyonGeometry();
  const controls=[[-0.012,0],[-0.021,0.055],[-0.059,0.075],[-0.067,0.106],[-0.05,0.124],[-0.03,0.108],[-0.025,0.135],[-0.051,0.16],[-0.047,0.184],[-0.027,0.193],[-0.023,0.21],[0.002,0.238],[0.027,0.218],[0.03,0.187],[0.055,0.175],[0.063,0.15],[0.046,0.132],[0.025,0.137],[0.027,0.102],[0.061,0.091],[0.063,0.067],[0.04,0.05],[0.016,0.048],[0.012,0]];
  const outline=new CatmullRomCurve3(controls.map(([x,y])=>new Vector3(x,y,0)),true,'centripetal').getPoints(28).slice(0,-1).map(point=>new Vector2(point.x,Math.max(0,point.y)));
  const triangles=ShapeUtils.triangulateShape(outline,[]);
  const leaflet=(root:Vector3,turn:number,size:number):void=>{
    const point=(p:Vector2):Vector3=>{
      const depth=0.016*Math.sin(p.y*12)+0.03*p.x*p.y;
      return root.clone().add(new Vector3((p.x*Math.cos(turn)+depth*Math.sin(turn))*size,p.y*size,(depth*Math.cos(turn)-p.x*Math.sin(turn))*size));
    };
    const normal=new Vector3(Math.sin(turn),0.03,Math.cos(turn)).normalize();
    for(const ids of triangles){
      const p=ids.map(id=>outline[id]);
      b.triangle(point(p[0]),point(p[1]),point(p[2]),3.3,p.map(v=>[v.x/0.15+0.5,v.y/0.25] as const),[normal,normal,normal]);
    }
  };
  for(let branch=0;branch<branches;branch++){
    const turn=branch*2.3999632297;
    const outward=new Vector3(Math.cos(turn),0,Math.sin(turn));
    const across=new Vector3(-Math.sin(turn),0,Math.cos(turn));
    const root=outward.clone().multiplyScalar(0.055);
    const height=0.23+(branch%4)*0.035;
    const stem=[root,outward.clone().multiplyScalar(0.11).setY(height*0.52),outward.clone().multiplyScalar(0.23+(branch%2)*0.08).setY(height)];
    b.tube(stem,[0.014,0.01,0.004],3.3,3,true);
    const fork=stem[1].clone().addScaledVector(across,(branch%2?1:-1)*0.13).addScaledVector(outward,0.07).setY(height*0.77);
    b.tube([stem[1],fork],[0.008,0.003],3.3,3,true);
    leaflet(stem[2],turn+0.5,0.8+(branch%3)*0.1);
    leaflet(fork,turn-0.75,0.63+(branch%2)*0.08);
  }
  return b.build();
}

export function coralGeometry():BufferGeometry{return makeCoral(6);}

/** A shallow living mat, with a broken lobed rim, an uneven ridge and real
 * thickness. Short tapered fibres break its silhouette; there are no leaf
 * cards or rounded cushion primitives. UVs stay planar for fine fibre grain.
 */
export function mossGeometry(variant=0):BufferGeometry{
  const b=new CanyonGeometry();
  const habit=((variant%3)+3)%3,segments=16;
  const outer=Array.from({length:segments},(_,i)=>{
    const a=i/segments*Math.PI*2;
    const lobe=habit===2?0.76+0.25*Math.cos(a*3+0.65)+0.07*Math.sin(a*7):1+0.12*Math.sin(a*3+habit)+0.085*Math.cos(a*7+0.4);
    const x=(habit===0?0.87:habit===1?0.64:0.76)*Math.cos(a)*lobe;
    const z=(habit===0?0.41:habit===1?0.57:0.61)*Math.sin(a)*lobe;
    return new Vector3(x,0.013+0.005*(0.5+0.5*Math.sin(a*5+habit)),z);
  });
  const inner=outer.map((p,i)=>new Vector3(p.x*(0.50+0.07*Math.sin(i*1.3)),0.145+0.035*(0.5+0.5*Math.sin(i*1.7+habit)),p.z*(0.55+0.06*Math.cos(i*1.9))));
  const vertices=[...outer,...inner,new Vector3(-0.035,0.127+habit*0.005,0.018)];
  const faces:number[][]=[];
  for(let i=0;i<segments;i++){
    const j=(i+1)%segments;
    faces.push([i,segments+j,j],[i,segments+i,segments+j],[segments+i,segments*2,segments+j]);
  }
  const normals=vertices.map(()=>new Vector3());
  for(const ids of faces){
    const [a,c,d]=ids.map(i=>vertices[i]);
    const n=c.clone().sub(a).cross(d.clone().sub(a));
    for(const i of ids)normals[i].add(n);
  }
  for(const n of normals)n.normalize();
  const uv=(p:Vector3):readonly [number,number]=>[p.x/2.2+0.5,p.z/1.6+0.5];
  const face=(a:Vector3,c:Vector3,d:Vector3,smooth?:readonly Vector3[]):void=>b.triangle(a,c,d,9,[uv(a),uv(c),uv(d)],smooth);
  for(const ids of faces)face(vertices[ids[0]],vertices[ids[1]],vertices[ids[2]],ids.map(i=>normals[i]));
  for(let i=0;i<segments;i++){
    const j=(i+1)%segments,a=outer[i],c=outer[j],bottomA=a.clone().setY(-0.035),bottomC=c.clone().setY(-0.035);
    // Only this buried skirt is vertical. The visible body feathers down
    // through a wide sloping fringe to a millimetre-thin, irregular rim.
    face(a,c,bottomC,[normals[i],normals[j],normals[j]]);
    face(a,bottomC,bottomA,[normals[i],normals[j],normals[i]]);
  }
  for(let i=0;i<24;i++){
    const edge=i%segments,j=(edge+1)%segments,t=0.18+0.18*(i%3);
    const base=outer[edge].clone().multiplyScalar(1-t-0.17).addScaledVector(outer[j],0.17).addScaledVector(inner[j],t);
    const angle=i*2.3999632297+habit,across=new Vector3(Math.cos(angle),0,Math.sin(angle));
    const left=base.clone().addScaledVector(across,-0.005),right=base.clone().addScaledVector(across,0.005);
    const tip=base.clone().add(new Vector3(0.007*Math.sin(i),0.018+0.014*(i%3)/2,0.007*Math.cos(i)));
    face(left,tip,right);
  }
  const geometry=b.build();
  geometry.userData.rigidShoots=[{start:0,count:b.vertexCount}];
  return geometry;
}

/** Branching olive growth, with individually cupped leaves instead of a spherical leaf shell.
 * The mat's longest runners creep sideways; the shrub grows a few unequal upright shoots.
 * Lower-detail shelf copies retain the same silhouette and footprint as close specimens.
 */
function makeSage(leaves:number,upright=false):BufferGeometry{
  const b=new CanyonGeometry();
  const components:{start:number;count:number}[]=[];
  const shoots=leaves<40?4:6;
  const counts=Array.from({length:shoots},(_,i)=>Math.floor(leaves/shoots)+(i<leaves%shoots?1:0));
  for(let shoot=0;shoot<shoots;shoot++){
    const start=b.vertexCount;
    const angle=shoot*2.3999632297+0.3;
    const forward=new Vector3(Math.cos(angle),0,Math.sin(angle));
    const side=new Vector3(-Math.sin(angle),0,Math.cos(angle));
    const reach=upright?0.28+0.09*(shoot%3):0.55+0.14*(shoot%3);
    const height=upright?0.42+0.12*((shoot*2)%4):0.11+0.065*((shoot*2)%3);
    const point=(t:number):Vector3=>forward.clone().multiplyScalar(reach*(t*0.86+0.14*t*t)).addScaledVector(side,0.1*Math.sin(t*Math.PI)*(shoot%2?1:-1)).setY(0.01+height*(upright?t:t*(1.24-0.24*t)));
    const twig=Array.from({length:4},(_,i)=>point(i/3));
    b.tube(twig,[0.015,0.012,0.007,0.0025],8,3,true);
    for(let leaf=0;leaf<counts[shoot];leaf++){
      const t=0.10+(leaf+0.5)/counts[shoot]*0.88;
      const root=point(t);
      const sign=leaf%2?1:-1;
      const along=forward.clone().multiplyScalar(0.34).addScaledVector(side,sign*(0.68+0.08*Math.sin(leaf))).setY(upright?0.4:0.18+0.15*Math.sin(leaf*1.7+shoot)).normalize();
      const across=new Vector3().crossVectors(new Vector3(0,1,0),along).normalize();
      const normal=new Vector3().crossVectors(along,across).normalize();
      const length=(upright?0.22:0.25)*(0.82+0.18*Math.sin(t*Math.PI))*(leaves<40?1.08:1);
      const width=(upright?0.085:0.103)*(0.85+0.15*Math.sin(leaf*2.1+shoot));
      const centre=root.clone().addScaledVector(along,length*0.51).addScaledVector(normal,0.025);
      const outline=[[0,0],[0.22,-0.74],[0.5,-1],[0.82,-0.66],[1,0],[0.78,0.74],[0.45,0.95],[0.16,0.6]];
      const ring=outline.map(([v,u])=>root.clone().addScaledVector(along,length*v).addScaledVector(across,width*u).addScaledVector(normal,0.005*Math.sin(v*Math.PI)+0.008*Math.sin(v*7+shoot)*Math.abs(u)));
      for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length;
        b.triangle(centre,ring[i],ring[j],8,[[0.5,0.51],[0.5+outline[i][1]*0.5,outline[i][0]],[0.5+outline[j][1]*0.5,outline[j][0]]],[normal,normal.clone().addScaledVector(across,outline[i][1]*0.25).normalize(),normal.clone().addScaledVector(across,outline[j][1]*0.25).normalize()]);
      }
    }
    components.push({start,count:b.vertexCount-start});
  }
  const geometry=b.build();
  geometry.userData.rigidShoots=components;
  return geometry;
}

export const CHALK_SHELF_CENTRE_HEIGHT = 3.22;
export const CHALK_SHELF_FOOTPRINT = { halfX:6.28, halfZ:3.44, plantingRadius:1.5, maxHeight:5.64 } as const;

export const CHALK_SHELF_VARIANTS = 4;
export type ChalkShelfPlanting = {
  x:number;z:number;scale:number;turn:number;
  /** Footprint changes independently of the living mat's thickness. */
  spread?:readonly [number,number];
}&({species:'moss';variant:number}|{species:'sage'|'coral'|'ivory';variant?:never});

// These are different ecological compositions, not the same corner stamps
// with a changed yaw. Large mats are single connected meshes, so their joins
// cannot produce coplanar overlaps. Empty chalk is an intentional fourth habit.
const SHELF_PLANTINGS:readonly (readonly ChalkShelfPlanting[])[] = [
  [
    {species:'moss',x:0,z:0,scale:1,spread:[1.75,1.85],turn:0.3,variant:1},
    {species:'moss',x:-3.4,z:-1.7,scale:0.35,turn:Math.PI/6,variant:2},
    {species:'moss',x:3.95,z:0.45,scale:0.46,turn:2.5,variant:2},
    {species:'sage',x:-3.4,z:-1.55,scale:0.55,turn:0.4},
    {species:'sage',x:-2.3,z:0.6,scale:1.0,turn:1.0},
    {species:'coral',x:-3.1,z:2.4,scale:0.75,turn:2.7},
    {species:'ivory',x:-2.0,z:0.7,scale:0.8,turn:0.8},
  ],
  [
    {species:'moss',x:0,z:0.2,scale:1,spread:[1.8,0.55],turn:-0.2,variant:2},
    {species:'moss',x:-3.5,z:0.4,scale:0.5,spread:[1.5,0.5],turn:Math.PI/3,variant:0},
    {species:'moss',x:-3.85,z:0.3,scale:0.24,turn:Math.PI,variant:1},
    {species:'sage',x:-3.9,z:0.7,scale:1.1,turn:2.2},
    {species:'coral',x:-3.15,z:0.9,scale:0.35,turn:0.3},
    {species:'coral',x:-2.6,z:1.15,scale:0.5,turn:1.4},
  ],
  [
    {species:'moss',x:0.65,z:-0.45,scale:0.7,turn:0.6,variant:1},
    {species:'moss',x:-0.7,z:0.75,scale:0.26,turn:2.1,variant:2},
    {species:'moss',x:-1.15,z:0.22,scale:0.38,turn:1.3,variant:0},
    {species:'moss',x:1.1,z:0.75,scale:0.18,turn:0.1,variant:1},
    {species:'moss',x:3.9,z:-1.45,scale:0.45,turn:Math.PI*5/6,variant:2},
    {species:'sage',x:3.4,z:-1.65,scale:1.0,turn:1.4},
    {species:'sage',x:3.95,z:0.45,scale:0.6,turn:-0.4},
    {species:'ivory',x:2.5,z:-0.15,scale:0.9,turn:2.1},
  ],
  [
    {species:'moss',x:-0.75,z:-0.5,scale:0.22,turn:0.7,variant:0},
    {species:'sage',x:3.5,z:-1.7,scale:0.35,turn:1.0},
  ],
];

/** Stable authored layouts are also exposed to independent contact audits. */
export function chalkShelfPlantings(variant=0):readonly ChalkShelfPlanting[]{
  return SHELF_PLANTINGS[((variant%CHALK_SHELF_VARIANTS)+CHALK_SHELF_VARIANTS)%CHALK_SHELF_VARIANTS];
}
export const CHALK_SHELF_PLANTINGS = chalkShelfPlantings();

/** Bake plants against the final rock triangles, so a later cliff change cannot float their roots. */
function addShelfPlants(b:CanyonGeometry,variant:number):void{
  const rock=b.build(),positions=rock.getAttribute('position');
  const ray=new Ray(new Vector3(),new Vector3(0,-1,0));
  const a=new Vector3(),c=new Vector3(),d=new Vector3(),hit=new Vector3();
  const supportCache=new Map<string,number>();
  const topAt=(x:number,z:number):number=>{
    const key=`${x.toFixed(6)},${z.toFixed(6)}`;
    const cached=supportCache.get(key);
    if(cached!==undefined)return cached;
    ray.origin.set(x,20,z);
    let height=-Infinity;
    for(let i=0;i<positions.count;i+=3){
      a.fromBufferAttribute(positions,i);c.fromBufferAttribute(positions,i+1);d.fromBufferAttribute(positions,i+2);
      if(ray.intersectTriangle(a,c,d,false,hit))height=Math.max(height,hit.y);
    }
    supportCache.set(key,height);
    return height;
  };
  const templates={sage:makeSage(32),coral:makeCoral(2),ivory:makeCombFern(1,12)};
  const mossTemplates=[mossGeometry(),mossGeometry(1),mossGeometry(2)];
  for(const planting of chalkShelfPlantings(variant)){
    const {x,z,scale,turn,species}=planting;
    const height=topAt(x,z);
    if(!Number.isFinite(height))continue;
    const geometry=species==='moss'?mossTemplates[planting.variant]:templates[species];
    const [spreadX,spreadZ]=planting.spread??[1,1];
    const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv'),kind=geometry.getAttribute('aKind');
    const emit=(start:number,count:number,rotation:Quaternion):void=>{
      const point=(i:number):Vector3=>new Vector3(p.getX(i)*scale*spreadX,(p.getY(i)-0.01)*scale,p.getZ(i)*scale*spreadZ).applyQuaternion(rotation).add(new Vector3(x,height,z));
      const normal=(i:number):Vector3=>new Vector3(n.getX(i)/spreadX,n.getY(i),n.getZ(i)/spreadZ).normalize().applyQuaternion(rotation);
      const up=new Vector3(0,1,0).applyQuaternion(rotation);
      for(let i=start;i<start+count;i+=3){
        const points=[point(i),point(i+1),point(i+2)];
        // Moss hugs one continuous fitted plane. Scaling the shelf changes
        // that plane's tilt while its body/fibre thickness stays fixed. This
        // never samples a different cliff height for neighbouring vertices.
        const support=species==='moss'?points.map(v=>height-(up.x*(v.x-x)+up.z*(v.z-z))/up.y):height;
        b.triangle(points[0],points[1],points[2],kind.getX(i),[[uv.getX(i),uv.getY(i)],[uv.getX(i+1),uv.getY(i+1)],[uv.getX(i+2),uv.getY(i+2)]],[normal(i),normal(i+1),normal(i+2)],support,species==='moss'?[-up.x/up.y,-up.z/up.y]:[0,0]);
      }
    };
    if(species!=='sage'&&species!=='moss'){
      emit(0,p.count,new Quaternion().setFromAxisAngle(new Vector3(0,1,0),turn));
      continue;
    }
    // A shoot is a rigid biological component: neighbouring leaf vertices
    // must never inherit different cliff levels. Fit a modest local cap tilt,
    // then turn whole shoots along a ledge or omit them across a sharp drop.
    const dx=(topAt(x+0.08,z)-topAt(x-0.08,z))/0.16;
    const dz=(topAt(x,z+0.08)-topAt(x,z-0.08))/0.16;
    const capNormal=Number.isFinite(dx+dz)&&Math.hypot(dx,dz)<0.6?new Vector3(-dx,1,-dz).normalize():new Vector3(0,1,0);
    const tilt=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),capNormal);
    const components=geometry.userData.rigidShoots as {start:number;count:number}[];
    for(const component of components){
      for(const offset of [0,Math.PI/3,-Math.PI/3,Math.PI*2/3]){
        const rotation=tilt.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),turn+offset));
        let supported=true;
        for(let i=component.start;i<component.start+component.count;i++){
          const foot=new Vector3(p.getX(i)*scale*spreadX,0,p.getZ(i)*scale*spreadZ).applyQuaternion(rotation);
          const ground=topAt(x+foot.x,z+foot.z);
          if(!Number.isFinite(ground)||Math.abs(ground-height-foot.y)>(species==='moss'?0.035:0.16)){supported=false;break;}
          if(species==='moss'&&p.getY(i)>0.12){
            const point=new Vector3(p.getX(i)*scale*spreadX,(p.getY(i)-0.01)*scale,p.getZ(i)*scale*spreadZ).applyQuaternion(rotation);
            const up=new Vector3(0,1,0).applyQuaternion(rotation);
            const plane=height-(up.x*point.x+up.z*point.z)/up.y,cap=topAt(x+point.x,z+point.z);
            // A tiny colony has the same material anatomy as a broad mat;
            // its raised core must stay above the rock at either relief limit.
            if([0.27,2.05].some(stretch=>plane*stretch+height+point.y-plane-cap*stretch<=0.002)){supported=false;break;}
          }
        }
        if(supported){emit(component.start,component.count,rotation);break;}
      }
    }
  }
  for(const geometry of Object.values(templates))geometry.dispose();
  for(const geometry of mossTemplates)geometry.dispose();
  rock.dispose();
}

/** One connected chalk mass with an irregular rim, high rear ribs and lower erosion ledges. */
export function chalkShelfGeometry(variant=0): BufferGeometry {
  const b=new CanyonGeometry();
  const habit=((variant%CHALK_SHELF_VARIANTS)+CHALK_SHELF_VARIANTS)%CHALK_SHELF_VARIANTS;
  const masses:readonly (readonly ChalkMass[])[]=[
    [
      {x:0,z:0,width:10.2,depth:5.5,height:3.05,phase:0.6,segments:28,centralPad:CHALK_SHELF_CENTRE_HEIGHT},
      {x:-3.4,z:-1.5,width:3.4,depth:2.5,height:4.18,phase:1.9,segments:10},
      {x:3.4,z:-1.65,width:2.8,depth:2.3,height:4.76,phase:4.2,segments:10},
      {x:-3.1,z:2.0,width:3.3,depth:1.75,height:1.35,phase:0.3,segments:7},
      {x:2.15,z:2.08,width:3.7,depth:1.65,height:1.66,phase:2.9,segments:7},
    ],
    [
      {x:0,z:0,width:9.6,depth:5.2,height:2.85,phase:1.4,segments:25,centralPad:CHALK_SHELF_CENTRE_HEIGHT},
      {x:-3.4,z:-1.5,width:2.7,depth:2.3,height:3.75,phase:2.5,segments:9},
      {x:3.4,z:-1.65,width:3.3,depth:2.4,height:4.45,phase:3.6,segments:11},
      {x:-3.1,z:2.0,width:2.6,depth:1.4,height:1.05,phase:1.7,segments:6},
      {x:2.15,z:1.95,width:4.1,depth:1.65,height:2.05,phase:4.1,segments:8},
    ],
    [
      {x:0,z:0,width:9.9,depth:5.3,height:3.0,phase:4.2,segments:27,centralPad:CHALK_SHELF_CENTRE_HEIGHT},
      {x:-3.4,z:-1.5,width:3.2,depth:2.7,height:4.55,phase:2.9,segments:11},
      {x:3.4,z:-1.65,width:2.5,depth:2.1,height:4.98,phase:4.8,segments:9},
      {x:-3.4,z:1.9,width:2.9,depth:1.65,height:1.85,phase:2.2,segments:8},
      {x:2.0,z:2.05,width:4.1,depth:1.6,height:1.1,phase:0.8,segments:7},
    ],
    [
      {x:0,z:0,width:8.7,depth:4.8,height:2.7,phase:2.7,segments:23,centralPad:CHALK_SHELF_CENTRE_HEIGHT},
      {x:-3.4,z:-1.5,width:3.7,depth:2.4,height:3.9,phase:4.5,segments:11},
      {x:3.4,z:-1.65,width:2.0,depth:2.2,height:3.5,phase:1.2,segments:8},
      {x:-3.1,z:2.0,width:2.4,depth:1.5,height:1.1,phase:3.1,segments:6},
      {x:2.15,z:2.08,width:3.0,depth:1.5,height:2.2,phase:1.7,segments:9},
    ],
  ];
  for(const mass of masses[habit])addChalkMass(b,mass);
  addShelfPlants(b,habit);
  return b.build();
}

/** Spreading moss-like runners and twiggy shrubs share their small olive leaf anatomy. */
export function lichenGeometry(variant=0):BufferGeometry{return makeSage(64,variant===1);}

/** Raised moss plus small rooted understory. Keeping them in one assembly
 * gives foliage precisely the same emergence, ground plane and support as
 * the living mat rather than independently scattering plants over bare soil. */
export function plantedMossGeometry(variant=0):BufferGeometry{
  const b=new CanyonGeometry(),moss=mossGeometry(1);
  const ray=new Ray(new Vector3(),new Vector3(0,-1,0));
  const a=new Vector3(),c=new Vector3(),d=new Vector3(),hit=new Vector3();
  const mossPositions=moss.getAttribute('position');
  const topAt=(x:number,z:number):number=>{
    ray.origin.set(x,2,z);
    let height=-Infinity;
    for(let i=0;i<mossPositions.count;i+=3){
      a.fromBufferAttribute(mossPositions,i);c.fromBufferAttribute(mossPositions,i+1);d.fromBufferAttribute(mossPositions,i+2);
      if(ray.intersectTriangle(a,c,d,false,hit))height=Math.max(height,hit.y);
    }
    return height;
  };
  const emit=(source:BufferGeometry,x:number,y:number,z:number,scale:number,turn:number):void=>{
    const p=source.getAttribute('position'),n=source.getAttribute('normal'),uv=source.getAttribute('uv'),kind=source.getAttribute('aKind');
    const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),turn);
    const point=(i:number):Vector3=>new Vector3(p.getX(i),p.getY(i),p.getZ(i)).multiplyScalar(scale).applyQuaternion(rotation).add(new Vector3(x,y,z));
    const normal=(i:number):Vector3=>new Vector3(n.getX(i),n.getY(i),n.getZ(i)).applyQuaternion(rotation);
    for(let i=0;i<p.count;i+=3)b.triangle(point(i),point(i+1),point(i+2),kind.getX(i),[[uv.getX(i),uv.getY(i)],[uv.getX(i+1),uv.getY(i+1)],[uv.getX(i+2),uv.getY(i+2)]],[normal(i),normal(i+1),normal(i+2)]);
  };
  emit(moss,0,0,0,1,0);
  const roots:{x:number;y:number;z:number;kind:number}[]=[];
  const plant=(source:BufferGeometry,x:number,z:number,scale:number,turn:number):void=>{
    const y=topAt(x,z)-0.018;
    roots.push({x,y,z,kind:source.getAttribute('aKind').getX(0)});
    emit(source,x,y,z,scale,turn);source.dispose();
  };
  if(variant===0){
    plant(makeCoral(2),-0.18,0.05,0.72,0.7);
    plant(makeSage(12,true),0.2,-0.12,0.43,2.2);
  }else{
    plant(makeCombFern(1,8),0.14,0.03,0.51,1.4);
    plant(makeSage(16,true),-0.21,-0.08,0.46,0.4);
  }
  moss.dispose();
  const result=b.build();
  result.userData.plantRoots=roots;
  return result;
}
