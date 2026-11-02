import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, ShaderMaterial, SphereGeometry, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { travel } from '../../../src/planet/geo';
import { createGroundSample, POND_SHIFT, type Terrain } from '../planet/terrain';

const vertexShader = `
#include <meadow_common>
#include <meadow_warp>
uniform float uRadius;
attribute vec3 color;
varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWorld;
void main() {
  mat4 frame=modelMatrix;
  #ifdef USE_INSTANCING
    frame=modelMatrix*instanceMatrix;
  #endif
  vec3 X=normalize(frame[0].xyz), U=normalize(frame[1].xyz), Z=normalize(frame[2].xyz);
  float distance=length(position.xz);
  float angle=asin(min(distance/uRadius,0.99));
  vec3 tangent=distance>0.00001?(X*position.x+Z*position.z)/distance:X;
  vec3 axis=normalize(cross(U,tangent));
  vec3 up=U*cos(angle)+tangent*sin(angle);
  vec3 n=normalize(X*normal.x+U*normal.y+Z*normal.z);
  n=n*cos(angle)+cross(axis,n)*sin(angle)+axis*dot(axis,n)*(1.0-cos(angle));
  vPlanet=up*(length(frame[3].xyz)+position.y);
  vWorld=warpPosition(vPlanet);
  vNormal=n;
  vColour=color;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}`;

const fragmentShader = `
#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vWorld;
void main() {
  vec3 up=normalize(vPlanet);
  float light=0.78+0.24*toonLight(dot(normalize(vNormal),uSunDir));
  vec3 c=vColour*light*mix(vec3(0.91,0.96,1.02),uSunTint,0.30);
  gl_FragColor=vec4(applyAerial(c,length(cameraPosition-vWorld),up),1.0);
}`;

/** Small merged colour geometry; all parts share one material and one draw. */
class Shape {
  private positions:number[]=[];
  private normals:number[]=[];
  private colours:number[]=[];
  add(geometry:BufferGeometry,colour:string,matrix=new Matrix4()):void {
    const source=geometry.index?geometry.toNonIndexed():geometry;
    source.applyMatrix4(matrix);
    const p=source.getAttribute('position'),n=source.getAttribute('normal'),c=new Color(colour);
    for(let i=0;i<p.count;i++) {
      this.positions.push(p.getX(i),p.getY(i),p.getZ(i));
      this.normals.push(n.getX(i),n.getY(i),n.getZ(i));
      this.colours.push(c.r,c.g,c.b);
    }
    source.dispose();
    if(source!==geometry) geometry.dispose();
  }
  box(x:number,y:number,z:number,sx:number,sy:number,sz:number,colour:string,turn=0):void {
    this.add(new BoxGeometry(sx,sy,sz),colour,new Matrix4().makeRotationY(turn).setPosition(x,y,z));
  }
  oval(x:number,y:number,z:number,sx:number,sy:number,sz:number,colour:string):void {
    this.add(new SphereGeometry(1,12,8),colour,new Matrix4().makeScale(sx,sy,sz).setPosition(x,y,z));
  }
  finish():BufferGeometry {
    const g=new BufferGeometry();
    g.setAttribute('position',new Float32BufferAttribute(this.positions,3));
    g.setAttribute('normal',new Float32BufferAttribute(this.normals,3));
    g.setAttribute('color',new Float32BufferAttribute(this.colours,3));
    return g;
  }
}

function hull():BufferGeometry {
  const positions:number[]=[],normals:number[]=[];
  const v=(x:number,y:number,z:number):Vector3=>new Vector3(x,y,z);
  const tri=(a:Vector3,b:Vector3,c:Vector3):void=>{
    const n=new Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    for(const p of [a,b,c]) {positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);}
  };
  const quad=(a:Vector3,b:Vector3,c:Vector3,d:Vector3):void=>{tri(a,b,c);tri(a,c,d);};
  const N=16;
  for(let k=0;k<N;k++) {
    const za=-2.25+4.5*k/N,zb=-2.25+4.5*(k+1)/N;
    const width=(z:number):number=>0.07+0.68*Math.pow(Math.max(0,1-(z/2.25)**2),0.72);
    const wa=width(za),wb=width(zb),ya=0.30+0.20*(za/2.25)**4,yb=0.30+0.20*(zb/2.25)**4;
    for(const sign of [-1,1]) {
      // Outer side, inner side and top gunwale, sharing exact boundaries.
      const a=v(sign*wa,ya,za),b=v(sign*wb,yb,zb),c=v(sign*wb*0.68,-0.13,zb),d=v(sign*wa*0.68,-0.13,za);
      if(sign>0) quad(a,b,c,d);else quad(d,c,b,a);
      const ia=v(sign*Math.max(0.01,wa-0.10),ya-0.035,za),ib=v(sign*Math.max(0.01,wb-0.10),yb-0.035,zb);
      const ic=v(sign*wb*0.62,0.065,zb),id=v(sign*wa*0.62,0.065,za);
      if(sign>0) quad(id,ic,ib,ia);else quad(ia,ib,ic,id);
      if(sign>0) quad(ia,ib,b,a);else quad(a,b,ib,ia);
    }
    // Interior floor above the analytical water surface, with no water sheet
    // cutting through the open boat. Underbody stays below the waterline.
    quad(v(-wa*0.62,0.065,za),v(-wb*0.62,0.065,zb),v(wb*0.62,0.065,zb),v(wa*0.62,0.065,za));
  }
  const g=new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute(positions,3));
  g.setAttribute('normal',new Float32BufferAttribute(normals,3));
  return g;
}

function wake(shape:Shape,size:number):void {
  // Two thin broken curved ripples, elevated 2 cm above the spherical water.
  for(let ring=0;ring<2;ring++) for(const side of [-1,1]) {
    const p:number[]=[],n:number[]=[];
    for(let k=0;k<10;k++) {
      const point=(t:number,edge:number):[number,number,number]=>{
        const z=-size*(0.7+ring*0.28+t*0.8);
        const x=side*(size*(0.13+0.22*t+0.10*t*t)+edge*0.025);
        return [x,0.022,z];
      };
      const a=point(k/10,-1),b=point((k+1)/10,-1),c=point((k+1)/10,1),d=point(k/10,1);
      for(const q of side>0?[a,c,b,a,d,c]:[a,b,c,a,c,d]){p.push(...q);n.push(0,1,0);}
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('normal',new Float32BufferAttribute(n,3));
    shape.add(g,ring===0?'#D5EEE7':'#A6D9DD');
  }
}

function boatGeometry(index:number):BufferGeometry {
  const s=new Shape();
  s.add(hull(),['#B77844','#A7674B','#C68D56'][index]);
  for(const z of [-2.21,2.21]) s.box(0,0.26,z,0.15,0.40,0.09,'#95633E');
  for(const z of [-0.95,0.55]) s.box(0,0.27,z,1.16,0.09,0.28,'#E0B77B');
  s.box(0,0.11,-0.10,0.52,0.06,1.55,'#C59660');
  // One resting oar, with a distinct widened blade outside the gunwale.
  const oarTurn=0.62;
  s.box(0.18,0.37,-0.25,0.055,0.055,2.6,'#815239',oarTurn);
  s.box(-0.62,0.37,-1.37,0.18,0.045,0.62,'#B98B59',oarTurn);
  wake(s,2.1);
  return s.finish();
}

function duckGeometry():BufferGeometry {
  const s=new Shape();
  s.oval(0,0.20,0,0.27,0.23,0.43,'#FFF2D4');
  s.oval(-0.02,0.25,-0.08,0.24,0.17,0.30,'#EEE3C4');
  s.oval(0,0.40,0.28,0.13,0.24,0.14,'#FFF6DE');
  s.oval(0,0.58,0.38,0.17,0.17,0.18,'#FFF5DE');
  s.oval(0,0.55,0.58,0.105,0.045,0.16,'#E6A14F');
  for(const x of [-0.145,0.145]) s.oval(x,0.62,0.44,0.019,0.024,0.022,'#3F3937');
  s.add(new CylinderGeometry(0.02,0.12,0.28,7), '#F9EACA',new Matrix4().makeRotationX(-1.05).setPosition(0,0.29,-0.40));
  wake(s,0.77);
  return s.finish();
}

interface Floater { mesh:Mesh; index:number; boat:boolean; x:number; z:number; safe:boolean; }

export interface RemoteDuckSite {
  readonly id:number;
  readonly flock:number;
  readonly dir:Vector3;
  readonly along:Vector3;
  readonly across:Vector3;
  readonly phase:number;
  readonly speed:number;
}
export interface RemoteDuckFlock {
  readonly id:number;
  readonly dir:Vector3;
  readonly population:number;
}

const REMOTE_CAPACITY=54;

/** Unequal flocks on the native canals, excluding the authored home pond. */
export function remoteDuckSites(terrain:Terrain):{sites:RemoteDuckSite[];flocks:RemoteDuckFlock[]} {
  const R=terrain.radius,L=terrain.layout,sites:RemoteDuckSite[]=[],flocks:RemoteDuckFlock[]=[];
  let state=hash32(L.seed^0x85e4d21);
  const rand=():number=>unit(state=hash32(state+0x9e3779b9));
  const sample=createGroundSample(),probe=new Vector3(),axis=new Vector3(),side=new Vector3(),along=new Vector3();
  const east=new Vector3().crossVectors(L.cottage,L.homeBearing).normalize();
  const homePond=L.cottage.clone().multiplyScalar(Math.sqrt(Math.max(0.001,1-(POND_SHIFT**2+terrain.pondCentre**2)/(R*R))))
    .addScaledVector(east,-POND_SHIFT/R).addScaledVector(L.homeBearing,terrain.pondCentre/R).normalize();
  const clear=(dir:Vector3):boolean=>{
    terrain.sample(dir,sample);
    if(sample.depth<0.52)return false;
    side.crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
    along.crossVectors(dir,side);
    // The entire 360-degree moving body/wake fits inside this 1.95 m disc.
    // Check both rings: a small island cannot hide inside a perimeter test.
    for(const reach of [0.95,1.95])for(let j=0;j<12;j++) {
      const angle=j*Math.PI/6;
      axis.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(along,Math.sin(angle));
      terrain.sample(travel(dir,axis,reach/R,probe),sample);
      if(sample.depth<0.33)return false;
    }
    return true;
  };
  const target=14+Math.floor(rand()*5),minAngle=Math.max(0.24,9/R);
  // Two passes through octants put life on different hemispheres without a
  // lattice: each accepted point is still a seeded random place along water.
  for(let pass=0;pass<3&&flocks.length<target;pass++)for(let sector=0;sector<8&&flocks.length<target;sector++) {
    const octant=(sector+(L.seed&7)+pass*3)%8;
    for(let attempt=0;attempt<384;attempt++) {
      const y=rand(),az=rand()*Math.PI/2,r=Math.sqrt(1-y*y);
      const dir=new Vector3(r*Math.cos(az)*(octant&1?1:-1),y*(octant&2?1:-1),r*Math.sin(az)*(octant&4?1:-1));
      if(dir.distanceTo(homePond)*R<terrain.pondRadius+9)continue;
      if(flocks.some(f=>f.dir.dot(dir)>Math.cos(minAngle)))continue;
      if(terrain.fields.waterwayDistance(dir)>-0.025)continue;
      terrain.sample(dir,sample);
      if(sample.depth<0.8)continue;
      const a=new Vector3().crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
      const b=new Vector3().crossVectors(dir,a);
      // Follow the canal's contour, so flock members lie along the water.
      const da=terrain.fields.waterwayDistance(travel(dir,a,0.7/R,probe))-terrain.fields.waterwayDistance(travel(dir,a,-0.7/R,probe));
      const db=terrain.fields.waterwayDistance(travel(dir,b,0.7/R,probe))-terrain.fields.waterwayDistance(travel(dir,b,-0.7/R,probe));
      const tangent=a.clone().multiplyScalar(db).addScaledVector(b,-da);
      if(tangent.lengthSq()<1e-12)tangent.copy(a);
      tangent.normalize();
      const across=new Vector3().crossVectors(dir,tangent).normalize();
      const count=rand()<0.55?3:2,phase=rand()*Math.PI*2,speed=0.10+0.05*rand();
      const members:RemoteDuckSite[]=[];
      for(let j=0;j<count;j++) {
        const offset=(j-(count-1)/2)*(1.65+0.20*rand());
        const at=travel(dir,tangent,offset/R,new Vector3());
        travel(at,across,(rand()-0.5)*0.28/R,at);
        if(!clear(at))break;
        const heading=tangent.clone().addScaledVector(at,-tangent.dot(at)).normalize();
        members.push({id:sites.length+j,flock:flocks.length,dir:at,along:heading,across:new Vector3().crossVectors(at,heading).normalize(),phase:phase+j*0.23,speed});
      }
      if(members.length!==count)continue;
      flocks.push({id:flocks.length,dir:dir.clone(),population:count});sites.push(...members);break;
    }
  }
  return {sites,flocks};
}

/** Closed-form motion within the fully tested support disc. */
export function remoteDuckMatrix(site:RemoteDuckSite,radius:number,time:number,out=new Matrix4()):Matrix4 {
  const phase=time*site.speed+site.phase;
  const up=site.dir.clone().addScaledVector(site.along,Math.sin(phase)*0.22/radius)
    .addScaledVector(site.across,Math.cos(phase)*0.17/radius).normalize();
  const heading=site.along.clone().multiplyScalar(Math.cos(phase)*0.22).addScaledVector(site.across,-Math.sin(phase)*0.17);
  heading.addScaledVector(up,-heading.dot(up)).normalize();
  const right=new Vector3().crossVectors(up,heading).normalize();
  const bob=0.006*Math.sin(time*2.1+site.phase);
  return out.makeBasis(right,up,heading).setPosition(up.multiplyScalar(radius+bob));
}

/** Water life is terrain-anchored and evaluated directly at time, never integrated. */
export class CherryWaterlife {
  readonly group=new Group();
  readonly remoteDuckMesh:InstancedMesh;
  private remoteSites:RemoteDuckSite[]=[];
  private remoteFlocks:RemoteDuckFlock[]=[];
  get duckSites():readonly RemoteDuckSite[] {return this.remoteSites;}
  get duckFlocks():readonly RemoteDuckFlock[] {return this.remoteFlocks;}
  private readonly items:Floater[]=[];
  private key='';
  private readonly ground=createGroundSample();
  private readonly up=new Vector3();
  private readonly across=new Vector3();
  private readonly toward=new Vector3();
  private readonly right=new Vector3();
  private readonly dir=new Vector3();
  private readonly remoteMatrix=new Matrix4();
  constructor(shared:Record<string,IUniform>) {
    const material=new ShaderMaterial({name:'Painted cherry boats and ducks',vertexShader,fragmentShader,uniforms:shared});
    const duck=duckGeometry();
    for(let i=0;i<6;i++) {
      const boat=i<3;
      const mesh=new Mesh(boat?boatGeometry(i):duck,material);
      mesh.name=boat?'Wooden rowboat '+(i+1):'Cream pond duck '+(i-2);
      mesh.userData.cherryWaterlife=boat?'rowboat':'duck';
      mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;
      this.group.add(mesh);this.items.push({mesh,index:i,boat,x:0,z:0,safe:false});
    }
    this.remoteDuckMesh=new InstancedMesh(duck,material,REMOTE_CAPACITY);
    this.remoteDuckMesh.name='Remote canal duck flocks';
    this.remoteDuckMesh.userData.cherryWaterlife='remote-ducks';
    this.remoteDuckMesh.frustumCulled=false;
    this.remoteDuckMesh.count=0;
    this.group.add(this.remoteDuckMesh);
    this.group.name='Cherry pond boats and ducks';
  }
  private direction(terrain:Terrain,x:number,z:number,out:Vector3):Vector3 {
    const R=terrain.radius;
    return out.copy(terrain.layout.cottage).multiplyScalar(Math.sqrt(Math.max(0.001,1-(x*x+z*z)/(R*R))))
      .addScaledVector(this.across,x/R).addScaledVector(terrain.layout.homeBearing,z/R).normalize();
  }
  private safe(terrain:Terrain,x:number,z:number,reach:number):boolean {
    this.direction(terrain,x,z,this.dir);
    terrain.sample(this.dir,this.ground);
    return this.ground.depth>0.42 && terrain.homePond(this.dir)<-reach;
  }
  update(terrain:Terrain,time:number):void {
    const L=terrain.layout,R=terrain.radius;
    this.across.crossVectors(L.cottage,L.homeBearing).normalize();
    const key=L.seed+'/'+R+'/'+terrain.pondRadius+'/'+terrain.pondCentre+'/'+terrain.fields.level+'/'+terrain.fields.waterwayWidth;
    if(key!==this.key) {
      this.key=key;
      for(const item of this.items) {
        const i=item.index,angle=i<3?i*2.05+0.2:-1.57+(i-4)*0.11;
        const radius=terrain.pondRadius*(item.boat?0.39:0.56);
        item.safe=false;
        for(let k=0;k<16;k++) {
          const a=angle+k*0.27;
          const x=-POND_SHIFT+Math.cos(a)*radius,z=terrain.pondCentre+Math.sin(a)*radius;
          // Includes boat length, wakes and the complete motion envelope.
          if(!this.safe(terrain,x,z,item.boat?4.2:1.5))continue;
          if(this.items.some(other=>other!==item&&other.index<i&&other.safe&&Math.hypot(other.x-x,other.z-z)<(item.boat?5:1.15)))continue;
          item.x=x;item.z=z;item.safe=true;break;
        }
      }
      const remote=remoteDuckSites(terrain);
      this.remoteSites=remote.sites;this.remoteFlocks=remote.flocks;
      this.remoteDuckMesh.count=this.remoteSites.length;
      this.remoteDuckMesh.userData.flockCount=this.remoteFlocks.length;
      this.remoteDuckMesh.userData.duckCount=this.remoteSites.length;
      this.remoteDuckMesh.userData.flocks=this.remoteFlocks.map(f=>({id:f.id,dir:f.dir.toArray(),population:f.population}));
    }
    for(const item of this.items) {
      const phase=time*(item.boat?0.045:0.15)+item.index*1.7;
      const x=item.x+Math.sin(phase)*(item.boat?0.44:0.26);
      const z=item.z+Math.cos(phase)*(item.boat?0.32:0.20);
      item.mesh.visible=item.safe&&this.safe(terrain,x,z,item.boat?3.5:1.0);
      if(!item.mesh.visible)continue;
      this.up.copy(this.dir);
      const bearing=item.boat?0.6+item.index*1.7+Math.sin(phase)*0.12:Math.atan2(Math.cos(phase)*0.26,-Math.sin(phase)*0.20);
      this.toward.copy(L.homeBearing).multiplyScalar(Math.cos(bearing)).addScaledVector(this.across,Math.sin(bearing));
      this.toward.addScaledVector(this.up,-this.toward.dot(this.up)).normalize();
      this.right.crossVectors(this.up,this.toward).normalize();
      const bob=item.boat?0.012*Math.sin(time*0.9+item.index):0.006*Math.sin(time*2.1+item.index);
      item.mesh.matrix.makeBasis(this.right,this.up,this.toward).setPosition(this.dir.copy(this.up).multiplyScalar(R+bob));
      item.mesh.matrixWorldNeedsUpdate=true;
      item.mesh.userData.waterDepth=this.ground.depth;
    }
    this.remoteSites.forEach((site,i)=>this.remoteDuckMesh.setMatrixAt(i,remoteDuckMatrix(site,R,time,this.remoteMatrix)));
    this.remoteDuckMesh.instanceMatrix.needsUpdate=true;
  }
}
