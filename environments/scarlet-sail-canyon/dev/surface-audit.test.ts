import { describe, expect, it } from 'vitest';
import { Mesh, Vector2, Vector3, type BufferGeometry, type InstancedBufferGeometry } from 'three';
import { CanyonGeometry, chalkGeometry, chalkShelfGeometry, coralGeometry, fanTreeGeometry, fernGeometry, lichenGeometry, mossGeometry } from '../life/canyonGeometry';
import { shelterGeometry, FLOOR, COTTAGE, TERRACE, PIER, STEPS } from '../life/props';
import { CanyonScenery } from '../life/canyonScenery';
import { Terrain, generateLayout } from '../planet/terrain';

interface Triangle { id: number; kind: number; vertices: Vector3[]; normal: Vector3; offset: number; facing: number }
function triangles(geometry: BufferGeometry): Triangle[] {
  const p = geometry.getAttribute('position'), kind = geometry.getAttribute('aKind'), indices = geometry.getIndex();
  const result: Triangle[] = [];
  for (let i = 0; i < (indices?.count ?? p.count); i += 3) {
    const ids = [0,1,2].map(j => indices?.getX(i + j) ?? i + j);
    const vertices = ids.map(id => new Vector3().fromBufferAttribute(p, id));
    const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]));
    if (normal.lengthSq() < 1e-16) continue;
    normal.normalize();
    const dominant = Math.abs(normal.x) > Math.abs(normal.y) && Math.abs(normal.x) > Math.abs(normal.z) ? 'x' : Math.abs(normal.y) > Math.abs(normal.z) ? 'y' : 'z';
    const facing=normal[dominant]<0?-1:1;
    if (facing<0) normal.negate();
    result.push({ id:i/3, kind:kind.getX(ids[0]), vertices, normal, offset:normal.dot(vertices[0]), facing });
  }
  return result;
}
function projected(triangle: Triangle, n: Vector3): Vector2[] {
  const axis = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
  const points = triangle.vertices.map(p => axis === 'x' ? new Vector2(p.y,p.z) : axis === 'y' ? new Vector2(p.x,p.z) : new Vector2(p.x,p.y));
  if (points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])) < 0) points.reverse();
  return points;
}
function overlapArea(a: Vector2[], b: Vector2[]): number {
  let polygon = a;
  for (let edge = 0; edge < 3; edge++) {
    const first = b[edge], second = b[(edge+1)%3];
    const direction = second.clone().sub(first);
    const distance = (p:Vector2):number => direction.cross(p.clone().sub(first));
    const next:Vector2[] = [];
    for (let i=0;i<polygon.length;i++) {
      const p=polygon[i], q=polygon[(i+1)%polygon.length], dp=distance(p), dq=distance(q);
      if(dp>=0) next.push(p);
      if((dp>=0)!==(dq>=0)) next.push(p.clone().lerp(q,dp/(dp-dq)));
    }
    polygon=next;
  }
  let twice=0;
  for(let i=0;i<polygon.length;i++)twice+=polygon[i].cross(polygon[(i+1)%polygon.length]);
  return Math.abs(twice)/2;
}
function overlaps(geometry:BufferGeometry):unknown[] {
  const groups=new Map<string,Triangle[]>();
  for(const t of triangles(geometry)){
    const key=[t.normal.x,t.normal.y,t.normal.z,t.offset].map(x=>Math.round(x*10000)).join(':');
    const group=groups.get(key)??[];group.push(t);groups.set(key,group);
  }
  const found:unknown[]=[];
  for(const group of groups.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
    const a=group[i],b=group[j];
    // Closed-object contacts (post foot/floor, tray bottom/tabletop) have
    // opposite outward normals. Their hidden touching faces are intentional.
    if(a.facing!==b.facing)continue;
    if(a.vertices.some(p=>Math.abs(b.normal.dot(p)-b.offset)>1e-5))continue;
    const area=overlapArea(projected(a,a.normal),projected(b,a.normal));
    if(area>1e-7)found.push({first:a.id,second:b.id,kinds:[a.kind,b.kind],area,at:a.vertices.map(p=>p.toArray()), other:b.vertices.map(p=>p.toArray())});
  }
  return found;
}

describe('Scarlet surface overlap audit',()=>{
  it('detects partially overlapping top faces but permits a shared edge and opposite contact faces',()=>{
    const b=new CanyonGeometry();
    b.triangle(new Vector3(0,0,0),new Vector3(0,0,2),new Vector3(2,0,0),2);
    b.triangle(new Vector3(0.4,0,0),new Vector3(0.4,0,2),new Vector3(2.4,0,0),9);
    const overlapping=b.build();expect(overlaps(overlapping)).toHaveLength(1);overlapping.dispose();
    const clean=new CanyonGeometry();
    clean.quad(new Vector3(0,0,0),new Vector3(0,0,1),new Vector3(1,0,1),new Vector3(1,0,0),2);
    clean.triangle(new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(0,0,1),0);
    const contacts=clean.build();expect(overlaps(contacts)).toHaveLength(0);contacts.dispose();
  });
  for(const [name,make] of [['fan',fanTreeGeometry],['twin fan',()=>fanTreeGeometry(1)],['young fan',()=>fanTreeGeometry(2)],['shrub',()=>lichenGeometry(1)],['chalk',chalkGeometry],['shelf',chalkShelfGeometry],['shelf 2',()=>chalkShelfGeometry(1)],['shelf 3',()=>chalkShelfGeometry(2)],['shelf 4',()=>chalkShelfGeometry(3)],['ivory',fernGeometry],['coral',coralGeometry],['sage',lichenGeometry],['moss',mossGeometry],['broad moss',()=>mossGeometry(1)],['forked moss',()=>mossGeometry(2)],['shelter',()=>shelterGeometry(412)]] as const){
    it(`${name} has no overlapping same-facing coplanar triangles`,()=>{
      const geometry=make();
      const found=overlaps(geometry);
      if(found.length)console.info(name,JSON.stringify(found.slice(0,12)));
      geometry.dispose();
      expect(found.length,JSON.stringify(found)).toBe(0);
    });
  }
});

// Instance audit works in the local spherical chart used by placement: x/z
// are tangent coordinates and y is height above the sphere. This reveals
// equal-height caps even when two different sphere tessellations hide their
// coincidence behind slightly different Cartesian chords.
const fieldParams = { roll:3.6,hummocks:0.16,wetlands:0,waterLevel:0,grain:0.45,density:0.7,patchiness:0.95,patchSize:13,weights:[0.15,0.8,0.05,0] as [number,number,number,number] };
function terrainAt(radius:number,seed=412):Terrain {
  const terrain=new Terrain(generateLayout(seed)); terrain.update(radius,fieldParams,0.5);return terrain;
}
interface Cap { owner:string; points:Vector3[]; box:[number,number,number,number]; normal:Vector3; offset:number }
function placedCaps(terrain:Terrain,scenery:CanyonScenery):Cap[]{
  const caps:Cap[]=[];
  const home=terrain.layout.cottage,forward=terrain.layout.homeBearing,right=new Vector3().crossVectors(home,forward).normalize(),R=terrain.radius;
  for(const child of scenery.group.children){
    if(!(child instanceof Mesh))continue;
    const geometry=child.geometry as InstancedBufferGeometry;
    const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),index=geometry.getIndex();
    if(!Array.from(kind.array).some(k=>k===2))continue;
    const anchors=geometry.getAttribute('aAnchor'),across=geometry.getAttribute('aAcross'),placement=geometry.getAttribute('aPlacement'),heights=geometry.getAttribute('aHeightScale');
    for(let inst=0;inst<geometry.instanceCount;inst++){
      const U=new Vector3().fromBufferAttribute(anchors,inst).normalize();
      if(Math.acos(Math.max(-1,Math.min(1,U.dot(home))))*R>75)continue;
      const X=new Vector3().fromBufferAttribute(across,inst).normalize(),Z=new Vector3().crossVectors(X,U).normalize();
      const scale=placement.getX(inst),heightScale=heights.getX(inst),anchorHeight=anchors.getW(inst);
      const transform=(id:number):Vector3=>{
        const x=p.getX(id)*scale,y=p.getY(id)*scale*heightScale,z=p.getZ(id)*scale;
        const d=Math.hypot(x,z),angle=Math.asin(Math.min(d/R,0.9));
        const dir=U.clone().multiplyScalar(Math.cos(angle));
        if(d>1e-5)dir.addScaledVector(X,x/d*Math.sin(angle)).addScaledVector(Z,z/d*Math.sin(angle));
        return new Vector3(dir.dot(right)*R,anchorHeight+y,dir.dot(forward)*R);
      };
      for(let i=0;i<(index?.count??p.count);i+=3){
        const ids=[0,1,2].map(j=>index?.getX(i+j)??i+j);
        if(kind.getX(ids[0])!==2||ids.some(id=>p.getY(id)<0))continue;
        const points=ids.map(transform);
        const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
        if(normal.y<0.4)continue;
        caps.push({owner:`${child.name}:${inst}`,points,normal,offset:normal.dot(points[0]),box:[Math.min(...points.map(v=>v.x)),Math.max(...points.map(v=>v.x)),Math.min(...points.map(v=>v.z)),Math.max(...points.map(v=>v.z))]});
      }
    }
  }
  return caps;
}

describe('Scarlet placed surface separation',()=>{
  it('keeps near-home chalk caps on different instances from sharing an exposed plane',()=>{
    const terrain=terrainAt(128),scenery=new CanyonScenery({},terrain),caps=placedCaps(terrain,scenery);
    const grid=new Map<string,number[]>();
    caps.forEach((cap,i)=>{for(let x=Math.floor(cap.box[0]/4);x<=Math.floor(cap.box[1]/4);x++)for(let z=Math.floor(cap.box[2]/4);z<=Math.floor(cap.box[3]/4);z++){const key=`${x}:${z}`,list=grid.get(key)??[];list.push(i);grid.set(key,list);}});
    const seen=new Set<string>(),conflicts:unknown[]=[];
    for(const list of grid.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      const ai=list[i],bi=list[j],key=`${Math.min(ai,bi)}:${Math.max(ai,bi)}`;
      if(seen.has(key))continue;seen.add(key);
      const a=caps[ai],b=caps[bi];
      if(a.owner===b.owner||a.box[1]<=b.box[0]||b.box[1]<=a.box[0]||a.box[3]<=b.box[2]||b.box[3]<=a.box[2]||a.normal.dot(b.normal)<0.99999)continue;
      const gap=Math.max(...a.points.map(p=>Math.abs(b.normal.dot(p)-b.offset)));
      if(gap>0.002)continue;
      const asTriangle=(cap:Cap):Triangle=>({id:0,kind:2,vertices:cap.points,normal:cap.normal,offset:cap.offset,facing:1});
      const area=overlapArea(projected(asTriangle(a),a.normal),projected(asTriangle(b),a.normal));
      if(area>0.001)conflicts.push({a:a.owner,b:b.owner,area,gap,at:a.points.map(p=>p.toArray())});
    }
    scenery.dispose();
    console.info('Placed cap audit',JSON.stringify({caps:caps.length,pairs:seen.size,conflicts}));
    expect(caps.length).toBeGreaterThan(1_000);
    expect(conflicts.length,JSON.stringify(conflicts)).toBe(0);
  });

  it('keeps exposed near-home chalk caps from lying on the terrain sheet',()=>{
    const terrain=terrainAt(128),scenery=new CanyonScenery({},terrain),caps=placedCaps(terrain,scenery);
    const home=terrain.layout.cottage,forward=terrain.layout.homeBearing,right=new Vector3().crossVectors(home,forward).normalize(),R=terrain.radius;
    const conflicts:unknown[]=[];
    for(const cap of caps){
      const area=cap.points[1].clone().sub(cap.points[0]).cross(cap.points[2].clone().sub(cap.points[0])).length()/2;
      if(area<0.01)continue;
      const centre=cap.points.reduce((sum,p)=>sum.add(p),new Vector3()).multiplyScalar(1/3);
      const gaps=[...cap.points,centre].map(p=>{
        const x=p.x/R,z=p.z/R;
        const dir=home.clone().multiplyScalar(Math.sqrt(Math.max(0,1-x*x-z*z))).addScaledVector(right,x).addScaledVector(forward,z).normalize();
        return p.y-terrain.height(dir);
      });
      // Intersection along a line is normal where a rock enters the ground.
      // A whole cap within the 2 cm height-bake tolerance is a competing sheet.
      if(gaps.every(gap=>Math.abs(gap)<0.02))conflicts.push({owner:cap.owner,area,gaps,at:centre.toArray()});
    }
    scenery.dispose();
    console.info('Cap/terrain audit',JSON.stringify({caps:caps.length,conflicts}));
    expect(conflicts.length,JSON.stringify(conflicts)).toBe(0);
  });

  it('keeps every shelter walking surface above real terrain across planet sizes and seeds',()=>{
    const halfX=COTTAGE.halfX+COTTAGE.thickness/2,halfZ=COTTAGE.halfZ+COTTAGE.thickness/2;
    const rectangles=[{x0:-halfX,x1:halfX,z0:-halfZ,z1:halfZ,top:FLOOR},{...TERRACE,top:FLOOR},{...PIER,top:FLOOR},...Array.from({length:STEPS.count},(_,k)=>({x0:STEPS.x0,x1:STEPS.x1,z0:TERRACE.z1+k*STEPS.tread,z1:TERRACE.z1+(k+1)*STEPS.tread,top:FLOOR-k*STEPS.rise}))];
    let minimum=Infinity,samples=0;
    for(const seed of [1,412,771])for(const R of [40,128,400]){
      const terrain=terrainAt(R,seed),home=terrain.layout.cottage,forward=terrain.layout.homeBearing,right=new Vector3().crossVectors(home,forward).normalize();
      for(const r of rectangles)for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){
        const x=r.x0+(r.x1-r.x0)*i/10,z=r.z0+(r.z1-r.z0)*j/10,d=Math.hypot(x,z),angle=Math.asin(Math.min(d/R,1));
        const dir=home.clone().multiplyScalar(Math.cos(angle));
        if(d>1e-6)dir.addScaledVector(right,x/d*Math.sin(angle)).addScaledVector(forward,z/d*Math.sin(angle));
        const top=Math.max(...rectangles.filter(other=>x>=other.x0-1e-6&&x<=other.x1+1e-6&&z>=other.z0-1e-6&&z<=other.z1+1e-6).map(other=>other.top));
        minimum=Math.min(minimum,terrain.cottageGround+top-terrain.height(dir));samples++;
      }
    }
    console.info('Shelter terrain clearance',JSON.stringify({minimum,samples}));
    expect(samples).toBeGreaterThan(6_000);
    expect(minimum).toBeGreaterThan(0.20);
  });
});
