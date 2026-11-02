import { hash32, unit } from '../../../src/core/hash';
import type { Layout } from '../planet/terrain';
import type { GeologyPrototype } from './windGeology';
import { clearsWindfieldRoutes, type WindfieldAnchor } from './windfieldScenery';

export interface CoralColony {
  id: string;
  /** Centre and extent of the accepted members, for diagnostics and distant views. */
  anchor: WindfieldAnchor;
  members: number;
  radius: number;
  habit: 'mat' | 'ribbon' | 'pocket';
}
export interface WindfieldEcology {
  sails: WindfieldAnchor[][];
  coral: WindfieldAnchor[][];
  colonies: CoralColony[];
}
interface Host { anchor: WindfieldAnchor; type: number; x: number; z: number; cosine:number; sine:number; inverseScale:number; extent:number; }
interface Domain { key: string; hosts: Host[]; local: boolean; }
interface Root { x: number; z: number; scale: number; }
const TAU=Math.PI*2;
const coordinate=(anchor: WindfieldAnchor): readonly [number,number]=>anchor.local??anchor.offset??[0,0];

/** Unequal, lobed coral fields are independent of the number of rocks in a row. */
export function createWindfieldEcology(layout: Layout, rocks: WindfieldAnchor[][], prototypes: readonly GeologyPrototype[]): WindfieldEcology {
  let state=hash32(layout.seed^0xc0a17f31);
  const random=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
  const sails:WindfieldAnchor[][]=[[],[],[]],coral:WindfieldAnchor[][]=[[],[],[]],colonies:CoralColony[]=[];
  const domains=new Map<string,Domain>();
  for(let type=0;type<rocks.length;type++)for(const anchor of rocks[type]) {
    const key=anchor.local?'local':anchor.direction.toArray().map(value=>value.toFixed(7)).join(',');
    let domain=domains.get(key);
    if(!domain) {domain={key,hosts:[],local:!!anchor.local};domains.set(key,domain);}
    const [x,z]=coordinate(anchor);domain.hosts.push({anchor,type,x,z,cosine:Math.cos(anchor.turn),sine:Math.sin(anchor.turn),inverseScale:1/anchor.scale,extent:prototypes[type].footprint*anchor.scale});
  }
  const bounds=prototypes.map(prototype=>{
    prototype.geometry.computeBoundingBox();const b=prototype.geometry.boundingBox!;
    return {x0:b.min.x,x1:b.max.x,z0:b.min.z,z1:b.max.z};
  });
  const stoneCellSize=8,stoneCells=new Map<string,Map<string,Host[]>>();
  for(const domain of domains.values()) {
    const grid=new Map<string,Host[]>();stoneCells.set(domain.key,grid);
    for(const host of domain.hosts) {
      const e=host.extent;
      for(let z=Math.floor((host.z-e)/stoneCellSize);z<=Math.floor((host.z+e)/stoneCellSize);z++)
        for(let x=Math.floor((host.x-e)/stoneCellSize);x<=Math.floor((host.x+e)/stoneCellSize);x++) {
          const key=`${x},${z}`,bucket=grid.get(key)??[];bucket.push(host);grid.set(key,bucket);
        }
    }
  }
  // Root spacing is checked in a physical lattice, including neighbouring
  // colonies, so a dense field does not multiply identical roots or planes.
  const cells=new Map<string,Root[]>(),cellSize=1.2;
  const place=(domain:Domain,groups:WindfieldAnchor[][],variant:number,anchor:WindfieldAnchor):boolean=>{
    const [x,z]=coordinate(anchor),sail=groups===sails;
    if(domain.local&&!clearsWindfieldRoutes(x,z,sail?.42+.32*anchor.scale:Math.max(.28,.40*anchor.scale)))return false;
    const prefix=`${domain.key}/${sail?'s':'c'}/`,gx=Math.floor(x/cellSize),gz=Math.floor(z/cellSize),spacing=sail?.34:.16;
    const reach=sail?2:1;
    for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++)for(const root of cells.get(`${prefix}${gx+dx},${gz+dz}`)??[]) {
      if(Math.hypot(x-root.x,z-root.z)<spacing*(anchor.scale+root.scale))return false;
    }
    const key=`${prefix}${gx},${gz}`,bucket=cells.get(key)??[];
    bucket.push({x,z,scale:anchor.scale});cells.set(key,bucket);groups[variant].push(anchor);return true;
  };
  const anchorAt=(host:Host,x:number,z:number,scale:number,turn:number):WindfieldAnchor=>{
    const a=host.anchor;
    const plant:WindfieldAnchor={direction:a.direction.clone(),scale,turn,phase:random()*TAU,tint:random(),threshold:a.threshold,rockId:a.id};
    if(a.local)plant.local=[x,z];else plant.offset=[x,z];
    return plant;
  };
  const lee=(host:Host,index:number):readonly[number,number]=>{
    const a=host.anchor,sites=prototypes[host.type].leeSites,[x,z]=sites[index%sites.length];
    return [host.x+(x*Math.cos(a.turn)-z*Math.sin(a.turn))*a.scale,host.z+(x*Math.sin(a.turn)+z*Math.cos(a.turn))*a.scale];
  };
  const inStone=(domain:Domain,x:number,z:number):boolean=>{
    const hosts=stoneCells.get(domain.key)!.get(`${Math.floor(x/stoneCellSize)},${Math.floor(z/stoneCellSize)}`)??[];
    for(const host of hosts) {
      const dx=(x-host.x)*host.inverseScale,dz=(z-host.z)*host.inverseScale;
      const lx=dx*host.cosine+dz*host.sine,lz=-dx*host.sine+dz*host.cosine,b=bounds[host.type];
      // Leave real soil around crowns. No terrain-rooted plant is placed
      // through a rock's projected body merely because its anchor is nearby.
      if(lx>b.x0+.12&&lx<b.x1-.12&&lz>b.z0+.12&&lz<b.z1-.12)return true;
    }
    return false;
  };
  const nearestHost=(domain:Domain,x:number,z:number):Host=>{
    const grid=stoneCells.get(domain.key)!,gx=Math.floor(x/stoneCellSize),gz=Math.floor(z/stoneCellSize);
    const candidates=new Set<Host>();
    for(let r=0;r<3&&!candidates.size;r++)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++) {
      for(const host of grid.get(`${gx+dx},${gz+dz}`)??[])candidates.add(host);
    }
    let best=domain.hosts[0],bestGap=Infinity;
    for(const host of candidates.size?candidates:domain.hosts) {
      const gap=Math.hypot(x-host.x,z-host.z)-host.extent*.45;
      if(gap<bestGap){best=host;bestGap=gap;}
    }
    return best;
  };
  let colonySerial=0,localCount=0,globalCount=0;
  const domainMembers=new Map<string,number>();
  const remoteQuota=Math.floor(14000/Math.max(1,domains.size-1));
  const growColony=(domain:Domain,cx:number,cz:number,rx:number,rz:number,heading:number,target:number,habit:CoralColony['habit']):void=>{
    // Reserve a share for every remote formation so early provinces cannot
    // consume the entire coral budget and leave the reverse side bare.
    const budget=domain.local?1800-localCount:Math.min(14000-globalCount,remoteQuota-(domainMembers.get(domain.key)??0));
    target=Math.min(target,budget,domain.local&&habit==='mat'?Math.max(0,1500-localCount):budget);if(target<1)return;
    const lobes=habit==='pocket'?1:6+Math.floor(random()*4),phase=random()*TAU;
    const pockets=Array.from({length:lobes},(_,i)=>{
      const along=lobes===1?0:(i/(lobes-1)-.5)*1.3;
      return {x:along*rx,z:Math.sin(i*1.9+phase)*rz*.45,rx:rx*(.35+random()*.3),rz:rz*(.45+random()*.32)};
    });
    const accepted:WindfieldAnchor[]=[];
    for(let attempt=0;accepted.length<target&&attempt<target*14;attempt++) {
      const lobe=pockets[Math.floor(random()*pockets.length)],angle=random()*TAU,r=Math.sqrt(random());
      const lx=lobe.x+Math.cos(angle)*r*lobe.rx,lz=lobe.z+Math.sin(angle)*r*lobe.rz;
      // A broken, scalloped margin and a few holes make neither a filled oval
      // nor a uniformly spaced stipple stamp. The field has a dense interior.
      const edge=.78+.16*Math.sin(angle*3.0+phase)+.10*Math.sin(angle*7.0-phase);
      if(r>edge||Math.sin(lx*.7+phase)*Math.cos(lz*.9-phase)>.78)continue;
      const x=cx+lx*Math.cos(heading)-lz*Math.sin(heading),z=cz+lx*Math.sin(heading)+lz*Math.cos(heading);
      if(inStone(domain,x,z))continue;
      const host=nearestHost(domain,x,z);
      if(Math.hypot(x-host.x,z-host.z)>(prototypes[host.type].footprint+12)*host.anchor.scale+6)continue;
      const age=random(),scale=.38+Math.pow(age,.8)*1.04;
      const anchor=anchorAt(host,x,z,scale,heading+(random()-.5)*2.2+(random()<.22?Math.PI/2:0));
      if(!place(domain,coral,Math.floor(random()*3),anchor))continue;
      accepted.push(anchor);
    }
    if(!accepted.length)return;
    const mean=accepted.reduce((sum,a)=>{const [x,z]=coordinate(a);sum.x+=x;sum.z+=z;return sum;},{x:0,z:0});mean.x/=accepted.length;mean.z/=accepted.length;
    const host=nearestHost(domain,mean.x,mean.z),anchor=anchorAt(host,mean.x,mean.z,1,heading);
    const radius=Math.max(...accepted.map(a=>{const [x,z]=coordinate(a);return Math.hypot(x-mean.x,z-mean.z)+a.scale;}));
    colonies.push({id:`coral-field-${colonySerial++}`,anchor,members:accepted.length,radius,habit});
    if(domain.local)localCount+=accepted.length;else globalCount+=accepted.length;
    domainMembers.set(domain.key,(domainMembers.get(domain.key)??0)+accepted.length);
  };
  for(const domain of domains.values()) {
    if(!domain.hosts.length)continue;
    if(domain.local) {
      // Long irregular fields connect several formations. They deliberately
      // leave the village, animal pockets and winding sand path open.
      for(const [x,z,rx,rz,heading,target] of [
        [-13,40,16,8,.22,220],[-25,22,12,7,-.40,195],
        [23,33,18,9,.62,220],[-15,-13,15,7,-.62,145],[24,1,10,5,1.1,120],
        [-28,-35,12,6,.4,95],[21,-48,14,6,-.3,110],
      ])growColony(domain,x,z,rx,rz,heading,target*2,'mat');
      // A few smaller crowns and sparse ribbons retain differences between
      // lush fields, isolated pockets and empty rock faces.
      for(let i=0;i<26;i++) {
        const host=domain.hosts[Math.floor(random()*domain.hosts.length)],site=lee(host,Math.floor(random()*3));
        growColony(domain,site[0],site[1]+.9,2+random()*4,.8+random()*2,host.anchor.turn,8+Math.floor(random()*16),i%3===0?'ribbon':'pocket');
      }
    } else {
      const fertility=random();
      const largest=domain.hosts.reduce((a,b)=>a.anchor.scale*prototypes[a.type].footprint>b.anchor.scale*prototypes[b.type].footprint?a:b);
      const extent=Math.max(...domain.hosts.map(host=>Math.hypot(host.x-largest.x,host.z-largest.z)+prototypes[host.type].footprint*host.anchor.scale*.35));
      const count=domain.hosts.length;
      const clusters=count>10?4+(random()<.4?1:0):2;
      for(let c=0;c<clusters;c++) {
        const host=c===0?largest:domain.hosts[Math.floor(random()*count)],site=lee(host,Math.floor(random()*3));
        const habit:CoralColony['habit']=fertility>.73?'mat':random()<.45?'ribbon':'pocket';
        const rx=habit==='pocket'?3+random()*4:Math.min(20,5+extent*.55)*( .75+random()*.4);
        const rz=habit==='ribbon'?1+random()*1.7:2+random()*3.5;
        const remaining=remoteQuota-(domainMembers.get(domain.key)??0);
        const target=Math.min(180,Math.ceil(remaining/(clusters-c)),Math.round((10+count*4.8)*(habit==='mat'?1.4:.9)));
        growColony(domain,site[0],site[1]+.7,rx,rz,host.anchor.turn+(random()-.5)*1.1,target,habit);
      }
    }
    // Sails occupy selected sheltered pockets, not every coral field. Mixed
    // cohorts share a habitat but do not share root points or blade headings.
    for(const host of domain.hosts) {
      if(host.type===7||random()>(domain.local?.96:.92))continue;
      const site=lee(host,Math.floor(random()*prototypes[host.type].leeSites.length));
      const adultScale=1.30+random()*1.10,adultVariant=Math.floor(random()*3),heading=host.anchor.turn+(random()-.5)*2.8;
      const amount=6+Math.floor(random()*4);
      for(let i=0;i<amount;i++) {
        const young=i>1,scale=young?adultScale*(.23+random()*.30):adultScale*(i===1?.78:1);
        const side=i%2===0?-1:1;
        const x=site[0]+(i>0?side*(.8+random()*2.2):(random()-.5)*.7)*host.anchor.scale;
        const z=site[1]+(.6+random()*(young?2.0:1.4))*host.anchor.scale;
        if(Math.hypot(x-host.x,z-host.z)>=(prototypes[host.type].footprint+3.2)*host.anchor.scale)continue;
        if(inStone(domain,x,z))continue;
        const a=anchorAt(host,x,z,scale,heading+(young?side*(.7+random()*.9):0));
        place(domain,sails,(adultVariant+i)%3,a);
      }
    }
  }
  return {sails,coral,colonies};
}
