import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Ray, ShapeUtils, Vector2, Vector3 } from 'three';

/** Small non-indexed mesh builder. Hard faces remain hard; foliage is genuinely thin geometry. */
export class CanyonGeometry {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private kinds: number[] = [];
  private plantBases: number[] = [];

  triangle(a: Vector3, b: Vector3, c: Vector3, kind: number, uv: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1]], smoothNormals?: readonly Vector3[], plantBase=0): void {
    const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const [i, p] of [a, b, c].entries()) {
      this.positions.push(p.x, p.y, p.z);
      const normal=smoothNormals?.[i]??n;
      this.normals.push(normal.x, normal.y, normal.z);
      this.uvs.push(uv[i][0], uv[i][1]);
      this.kinds.push(kind);
      this.plantBases.push(plantBase);
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
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** One thin living blade: folds flow outward from the stem into an uneven, lobed rim. */
export function addFanLeaf(b: CanyonGeometry, origin: Vector3, length: number, turn: number, kind = 1, spread = 1.64, tilt = 0.12, columns = 64, rows = 6): void {
  const point=(u:number,v:number):Vector3=>{
    const a=(u*2-1)*spread;
    const edge=1+0.05*Math.sin(a*1.1)+0.014*Math.sin(a*3.7)+0.018*Math.cos(a*12.0);
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

/** Mature and young templates share the same biology, with different branch proportions. */
export function fanTreeGeometry(variant=0): BufferGeometry {
  const b=new CanyonGeometry();
  const young=variant===1;
  const crown=new Vector3(1.65,5.05,0.38);
  const stem=curve(new Vector3(),new Vector3(-0.45,1.75,-0.15),new Vector3(1.9,3.65,0.18),crown,14);
  b.tube(stem,stem.map((_,i)=>0.25*Math.pow(1-i/16,1.25)+0.045),0,8,true);
  addFanLeaf(b,crown,young?3.4:4.2,-0.09,1,1.64,0.12);
  // A living side branch grows from the trunk, rather than an unsupported disk.
  const bud=new Vector3(young?-1.15:-0.62,young?3.75:2.9,young?0.46:-0.25);
  const branch=curve(stem[5],new Vector3(0.18,2.25,0.05),new Vector3(-0.7,2.9,0.3),bud,7);
  b.tube(branch,branch.map((_,i)=>0.11*(1-i/8)+0.016),0,5,true);
  addFanLeaf(b,bud,young?1.72:1.13,-0.58,1,1.49,0.2,20,4);
  // Slender exposed woody ribs spread continuously into the lower crown.
  for(const side of [-1,1]){
    const rib=curve(stem[11],crown.clone().add(new Vector3(side*0.22,-0.06,0)),crown.clone().add(new Vector3(side*0.5,0.35,0.15)),crown.clone().add(new Vector3(side*0.9,0.65,0.24)),4);
    b.tube(rib,rib.map((_,i)=>0.045*(1-i/5)+0.006),0,4,true);
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

/** Small smooth-edged leaves overlap in irregular tufts, including a closed low leafy skirt. */
function makeSage(leaves:number):BufferGeometry{
  const b=new CanyonGeometry();
  const densityScale=Math.sqrt(leaves/64);
  for(let shoot=0;shoot<3;shoot++){
    const a=shoot*Math.PI*2/3;
    b.tube([new Vector3(),new Vector3(Math.cos(a)*0.2*densityScale,0.16*densityScale,Math.sin(a)*0.2*densityScale)],[0.013,0.005],8,4,true);
  }
  const R=0.52*densityScale,H=0.42*densityScale;
  const skirt=Math.max(4,Math.round(leaves*0.18)),crown=leaves-skirt;
  for(let leaf=0;leaf<leaves;leaf++){
    const low=leaf>=crown;
    const angle=low?(leaf-crown)*Math.PI*2/skirt:leaf*2.3999632297;
    const elevation=low?0.025:1-(leaf+0.5)/crown;
    const radial=Math.sqrt(1-elevation*elevation);
    const outline=0.95+0.06*Math.sin(angle*3+0.4);
    const centre=new Vector3(Math.cos(angle)*radial*R*outline,0.032+elevation*H+0.02*Math.sin(angle*3)*radial,Math.sin(angle)*radial*R*outline);
    const outward=new Vector3(Math.cos(angle)*radial/R,elevation/H,Math.sin(angle)*radial/R).normalize();
    const azimuth=new Vector3(-Math.sin(angle),0,Math.cos(angle));
    const meridian=new Vector3().crossVectors(outward,azimuth).normalize();
    const turn=low?0.06*Math.sin(leaf):0.8*Math.sin(leaf*2.3)+leaf*0.17;
    const along=azimuth.clone().multiplyScalar(Math.cos(turn)).addScaledVector(meridian,Math.sin(turn));
    const across=new Vector3().crossVectors(outward,along).normalize();
    const length=0.09+(leaf%4)*0.01;
    const width=0.067+(leaf%3)*0.009;
    const midpoint=centre.clone().addScaledVector(outward,0.012);
    const samples=14;
    const ring=Array.from({length:samples},(_,i)=>{
      const a=i*Math.PI*2/samples;
      const r=1+0.022*Math.sin(a*3+leaf);
      const p=centre.clone().addScaledVector(along,Math.cos(a)*length*r).addScaledVector(across,Math.sin(a)*width*r).addScaledVector(outward,0.002+0.004*Math.sin(a*3+leaf*0.8));
      p.y=Math.max(0.002,p.y);
      return p;
    });
    const normal=(i:number):Vector3=>outward.clone().addScaledVector(along,Math.cos(i*Math.PI*2/samples)*0.09).addScaledVector(across,Math.sin(i*Math.PI*2/samples)*0.10).normalize();
    const uv=(i:number):[number,number]=>[0.5+Math.sin(i*Math.PI*2/samples)*0.5,0.5+Math.cos(i*Math.PI*2/samples)*0.5];
    for(let i=0;i<samples;i++){
      const j=(i+1)%samples;
      b.triangle(midpoint,ring[i],ring[j],8,[[0.5,0.5],uv(i),uv(j)],[outward,normal(i),normal(j)]);
    }
  }
  return b.build();
}

export const CHALK_SHELF_CENTRE_HEIGHT = 3.22;
export const CHALK_SHELF_FOOTPRINT = { halfX:6.28, halfZ:3.44, plantingRadius:1.5, maxHeight:5.64 } as const;

const SAGE_LEDGE_SEAMS = [
  {x:-3.4,z:-1.55,scale:0.85,turn:0.2},
  {x:3.4,z:-1.65,scale:0.82,turn:1.4},
  {x:-3.9,z:0.7,scale:0.9,turn:2.2},
  {x:3.9,z:0.65,scale:0.9,turn:-0.4},
  {x:-3.0,z:2.5,scale:0.82,turn:0.9},
  {x:2.25,z:2.6,scale:0.88,turn:2.8},
] as const;

/** Overlapping small shrubs trace the ledges; accent fronds grow out of these seams. */
export const CHALK_SHELF_PLANTINGS = [
  ...SAGE_LEDGE_SEAMS.flatMap((seam,index)=>[-0.35,0,0.32].map((offset,i)=>({
    species:'sage' as const,
    x:seam.x+Math.cos(seam.turn)*offset,
    z:seam.z+Math.sin(seam.turn)*offset,
    scale:seam.scale*[0.9,1.12,0.86][i],
    turn:seam.turn+index*0.4+i*0.75,
  }))),
  {species:'coral',x:-3.15,z:0.9,scale:0.7,turn:0.3},
  {species:'coral',x:3.05,z:0.8,scale:0.68,turn:1.7},
  {species:'coral',x:-3.1,z:2.4,scale:0.75,turn:2.7},
  {species:'ivory',x:-2.0,z:0.7,scale:0.65,turn:0.8},
  {species:'ivory',x:2.5,z:-0.15,scale:0.62,turn:2.1},
] as const;

/** Bake plants against the final rock triangles, so a later cliff change cannot float their roots. */
function addShelfPlants(b:CanyonGeometry):void{
  const rock=b.build(),positions=rock.getAttribute('position');
  const ray=new Ray(new Vector3(),new Vector3(0,-1,0));
  const a=new Vector3(),c=new Vector3(),d=new Vector3(),hit=new Vector3();
  const topAt=(x:number,z:number):number=>{
    ray.origin.set(x,20,z);
    let height=-Infinity;
    for(let i=0;i<positions.count;i+=3){
      a.fromBufferAttribute(positions,i);c.fromBufferAttribute(positions,i+1);d.fromBufferAttribute(positions,i+2);
      if(ray.intersectTriangle(a,c,d,false,hit))height=Math.max(height,hit.y);
    }
    return height;
  };
  const templates={sage:makeSage(8),coral:makeCoral(2),ivory:makeCombFern(1,12)};
  for(const planting of CHALK_SHELF_PLANTINGS){
    const {x,z,scale,turn,species}=planting;
    const height=topAt(x,z);
    if(!Number.isFinite(height))continue;
    const geometry=templates[species];
    const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv'),kind=geometry.getAttribute('aKind');
    const point=(i:number):Vector3=>new Vector3(x+(p.getX(i)*Math.cos(turn)+p.getZ(i)*Math.sin(turn))*scale,height+(p.getY(i)-0.01)*scale,z+(p.getZ(i)*Math.cos(turn)-p.getX(i)*Math.sin(turn))*scale);
    const normal=(i:number):Vector3=>new Vector3(n.getX(i)*Math.cos(turn)+n.getZ(i)*Math.sin(turn),n.getY(i),n.getZ(i)*Math.cos(turn)-n.getX(i)*Math.sin(turn));
    for(let i=0;i<p.count;i+=3){
      b.triangle(point(i),point(i+1),point(i+2),kind.getX(i),[[uv.getX(i),uv.getY(i)],[uv.getX(i+1),uv.getY(i+1)],[uv.getX(i+2),uv.getY(i+2)]],[normal(i),normal(i+1),normal(i+2)],height);
    }
  }
  for(const geometry of Object.values(templates))geometry.dispose();
  rock.dispose();
}

/** One connected chalk mass with an irregular rim, high rear ribs and lower erosion ledges. */
export function chalkShelfGeometry(): BufferGeometry {
  const b=new CanyonGeometry();
  addChalkMass(b,{x:0,z:0,width:10.2,depth:5.5,height:3.05,phase:0.6,segments:28,centralPad:CHALK_SHELF_CENTRE_HEIGHT});
  addChalkMass(b,{x:-3.4,z:-1.5,width:3.4,depth:2.5,height:4.18,phase:1.9,segments:10});
  addChalkMass(b,{x:3.4,z:-1.65,width:2.8,depth:2.3,height:4.76,phase:4.2,segments:10});
  addChalkMass(b,{x:-3.1,z:2.0,width:3.3,depth:1.75,height:1.35,phase:0.3,segments:7});
  addChalkMass(b,{x:2.15,z:2.08,width:3.7,depth:1.65,height:1.66,phase:2.9,segments:7});
  addShelfPlants(b);
  return b.build();
}

/** Low dense sage cushions with tiny overlapping matte leaves. */
export function lichenGeometry():BufferGeometry{return makeSage(64);}
