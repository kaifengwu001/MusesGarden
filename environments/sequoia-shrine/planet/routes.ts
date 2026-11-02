import { Vector3 } from 'three';
import { smoothstep } from '../../../src/core/math';
import { tangentToward, travel } from '../../../src/planet/geo';
import type { Layout } from './terrain';

/** The sacred places share a footpath; the resident has a separate woodland home. */
export interface ForestSite {
  dir:Vector3;
  forward:Vector3;
  scale:number;
  variant:number;
}
export interface RouteSegment {a:Vector3;b:Vector3;}
export interface ForestNetwork {
  across:Vector3;
  shrines:ForestSite[];
  residence:ForestSite;
  spurs:RouteSegment[];
  junction:Vector3;
  approach:Vector3;
}

/** Canonical X / original shrine-up / original shrine-front directions. */
export const SHRINE_DIRECTIONS=[
  [0,1,0],[0.99,-0.08,0.11],[-0.98,-0.12,-0.16],[0,-0.58,0.815],[0.04,-0.70,-0.713],
] as const;
export const SHRINE_SCALES=[1,0.72,0.82,0.64,0.76] as const;
const SPUR_BENDS=[1.1,13,3,-2.6,3.4,-3.1,-4.5,9,-7,13,-11,8,-10,7] as const;
export const ROUTE_SEGMENTS=14;
export const FOREST_SITES=6;
const cache=new WeakMap<Layout,{radius:number;network:ForestNetwork}>();

function canonical(layout:Layout,across:Vector3,c:readonly [number,number,number]):Vector3 {
  return across.clone().multiplyScalar(c[0]).addScaledVector(layout.cottage,c[1]).addScaledVector(layout.homeBearing,c[2]).normalize();
}

function localDirection(layout:Layout,radius:number,x:number,z:number):Vector3 {
  const across=new Vector3().crossVectors(layout.cottage,layout.homeBearing).normalize();
  const distance=Math.hypot(x,z);
  const bearing=across.multiplyScalar(x/distance).addScaledVector(layout.homeBearing,z/distance);
  return travel(layout.cottage,bearing,distance/radius,new Vector3());
}

export function forestNetwork(layout:Layout,radius:number):ForestNetwork {
  const prior=cache.get(layout);
  if(prior?.radius===radius)return prior.network;
  const across=new Vector3().crossVectors(layout.cottage,layout.homeBearing).normalize();
  const shrines:ForestSite[]=[{dir:layout.cottage.clone(),forward:layout.homeBearing.clone(),scale:1,variant:0}];
  // The main approach reaches a real branch junction beyond its torii.
  const approach=localDirection(layout,radius,2.8,Math.min(27,radius*0.55));
  // Junction glades cross the front, west flank and rear of the sphere.
  // They are independent of shrine positions: a branch can pass a court
  // without continuing through its building to reach the next destination.
  const junction=canonical(layout,across,[0.26,0.18,0.948]);
  const west=canonical(layout,across,[-0.57,-0.28,0.77]);
  const rear=canonical(layout,across,[-0.15,-0.98,-0.13]);
  const westRear=canonical(layout,across,[-0.65,-0.45,-0.61]);
  const targets=[junction,junction,westRear,junction,rear];
  const courtJunctions:Vector3[]=[approach];
  const spurs:RouteSegment[]=[
    {a:travel(layout.cottage,layout.homeBearing,7/radius,new Vector3()),b:approach},
    {a:approach,b:junction},
  ];
  for(let i=1;i<SHRINE_DIRECTIONS.length;i++){
    const scale=SHRINE_SCALES[i],dir=canonical(layout,across,SHRINE_DIRECTIONS[i]);
    const forward=tangentToward(dir,targets[i],new Vector3());
    const courtJunction=travel(dir,forward,(18*scale+4)/radius,new Vector3());
    shrines.push({dir,forward,scale,variant:i});courtJunctions.push(courtJunction);
    spurs.push({a:travel(dir,forward,8*scale/radius,new Vector3()),b:courtJunction});
  }
  const homeDistance=Math.min(44,radius*0.95);
  const homeBearing=across.clone().multiplyScalar(-0.88).addScaledVector(layout.homeBearing,0.475).normalize();
  const homeDir=travel(layout.cottage,homeBearing,homeDistance/radius,new Vector3());
  const homeForward=tangentToward(homeDir,approach,new Vector3());
  const residence:ForestSite={dir:homeDir,forward:homeForward,scale:1,variant:5};
  spurs.push({a:travel(homeDir,homeForward,5/radius,new Vector3()),b:approach});
  spurs.push(
    {a:junction,b:courtJunctions[1]},
    {a:junction,b:courtJunctions[3]},
    {a:junction,b:west},
    {a:west,b:rear},
    {a:rear,b:courtJunctions[4]},
    {a:rear,b:westRear},
    {a:westRear,b:courtJunctions[2]},
  );
  const network={across,shrines,residence,spurs,junction,approach};
  cache.set(layout,{radius,network});return network;
}

export function shrineSites(layout:Layout,radius:number):ForestSite[]{return forestNetwork(layout,radius).shrines;}
export function residenceSite(layout:Layout,radius:number):ForestSite{return forestNetwork(layout,radius).residence;}

/** Each approach bends between its actual stair and trail junction. */
export function routeSpurCentre(layout:Layout,radius:number,index:number,t:number):Vector3 {
  const segment=forestNetwork(layout,radius).spurs[index];
  const n=new Vector3().crossVectors(segment.a,segment.b).normalize();
  const tangent=new Vector3().crossVectors(n,segment.a).normalize();
  const angle=Math.acos(Math.max(-1,Math.min(1,segment.a.dot(segment.b))));
  const bend=spurOffset(index,t,angle*radius)/radius;
  return segment.a.clone().multiplyScalar(Math.cos(angle*t)*Math.cos(bend))
    .addScaledVector(tangent,Math.sin(angle*t)*Math.cos(bend)).addScaledVector(n,Math.sin(bend)).normalize();
}

function spurBend(index:number,metres:number):number {
  return Math.sign(SPUR_BENDS[index])*Math.min(Math.abs(SPUR_BENDS[index]),metres*0.12);
}
function spurWiggle(index:number,metres:number):number {
  return Math.sign(SPUR_BENDS[index])*Math.min(0.6,metres*0.025);
}
function spurOffset(index:number,t:number,metres:number):number {
  return spurBend(index,metres)*(Math.sin(Math.PI*t)+0.35*Math.sin(2*Math.PI*t))
    +spurWiggle(index,metres)*Math.sin(5*Math.PI*t);
}
function spurSlope(index:number,t:number,metres:number):number {
  return spurBend(index,metres)*(Math.PI*Math.cos(Math.PI*t)+0.7*Math.PI*Math.cos(2*Math.PI*t))
    +spurWiggle(index,metres)*5*Math.PI*Math.cos(5*Math.PI*t);
}

/** Signed cross-track distance to a gently curved great-circle approach. */
export function arcDistance(dir:Vector3,a:Vector3,b:Vector3,radius:number,index=0):number {
  const nx=a.y*b.z-a.z*b.y,ny=a.z*b.x-a.x*b.z,nz=a.x*b.y-a.y*b.x;
  const length=Math.hypot(nx,ny,nz),ix=nx/length,iy=ny/length,iz=nz/length;
  const tx=iy*a.z-iz*a.y,ty=iz*a.x-ix*a.z,tz=ix*a.y-iy*a.x;
  const span=Math.acos(Math.max(-1,Math.min(1,a.dot(b))));
  const angle=Math.atan2(dir.x*tx+dir.y*ty+dir.z*tz,dir.dot(a));
  if(angle<0||angle>span)return Math.acos(Math.min(1,Math.max(a.dot(dir),b.dot(dir))))*radius;
  const t=angle/span;
  const cross=Math.asin(Math.max(-1,Math.min(1,dir.x*ix+dir.y*iy+dir.z*iz)))*radius;
  const slope=spurSlope(index,t,span*radius)/(span*radius);
  return Math.abs(cross-spurOffset(index,t,span*radius))/Math.sqrt(1+slope*slope);
}

export function routeDistance(dir:Vector3,layout:Layout,radius:number):number {
  const network=forestNetwork(layout,radius);let distance=Infinity;
  for(let i=0;i<network.spurs.length;i++){
    const spur=network.spurs[i];distance=Math.min(distance,arcDistance(dir,spur.a,spur.b,radius,i));
  }
  return distance;
}

export function routePathAt(dir:Vector3,layout:Layout,radius:number):number {
  const network=forestNetwork(layout,radius);
  const grain=(dir.dot(network.across)*0.13+dir.dot(layout.homeBearing)*0.17+dir.dot(layout.cottage)*0.11)*radius;
  const width=1.15+0.12*Math.sin(grain)+0.07*Math.sin(grain*2.13);
  let path=0;
  for(let i=0;i<network.spurs.length;i++){
    const spur=network.spurs[i];
    // Only the short ceremonial stair approach is broad; all other branches are hiking trails.
    const half=i===0?1.85:width;
    path=Math.max(path,1-smoothstep(half,half+0.5,arcDistance(dir,spur.a,spur.b,radius,i)));
  }
  return path;
}

function siteLocal(dir:Vector3,site:ForestSite,radius:number):[number,number]|null {
  if(dir.dot(site.dir)<0.5)return null;
  const x=site.dir.y*site.forward.z-site.dir.z*site.forward.y;
  const y=site.dir.z*site.forward.x-site.dir.x*site.forward.z;
  const z=site.dir.x*site.forward.y-site.dir.y*site.forward.x;
  return [(dir.x*x+dir.y*y+dir.z*z)*radius,dir.dot(site.forward)*radius];
}

/** Solid supports match the buildings; feathering is outside their footprints. */
export function routePadAt(dir:Vector3,layout:Layout,radius:number):number {
  const network=forestNetwork(layout,radius);let weight=0;
  for(const site of [...network.shrines,network.residence]){
    const c=siteLocal(dir,site,radius);if(!c)continue;
    const home=site.variant===5,s=site.scale;
    const hx=home?7.6:7.2*s,hz=home?8.6:11*s,cz=home?1:2*s;
    const flat=(1-smoothstep(hx,hx+4,Math.abs(c[0])))*(1-smoothstep(hz,hz+5,Math.abs(c[1]-cz)));
    weight=Math.max(weight,flat);
  }
  return weight;
}

/** Ceremonial courts and the home's small yard are deliberately plant-free. */
export function routeCourtAt(dir:Vector3,layout:Layout,radius:number):number {
  const network=forestNetwork(layout,radius);let weight=0;
  for(const site of [...network.shrines,network.residence]){
    const c=siteLocal(dir,site,radius);if(!c)continue;
    const home=site.variant===5,s=site.scale;
    const hx=home?6.6:6.4*s,hz=home?7.6:9*s,cz=home?1:2*s;
    weight=Math.max(weight,(1-smoothstep(hx,hx+1,Math.abs(c[0])))*(1-smoothstep(hz,hz+1.5,Math.abs(c[1]-cz))));
  }
  return weight;
}

export function routeClear(dir:Vector3,layout:Layout,radius:number,margin=0):boolean {
  if(routeDistance(dir,layout,radius)<2.35+margin)return false;
  const network=forestNetwork(layout,radius);
  for(const site of [...network.shrines,network.residence]){
    const c=siteLocal(dir,site,radius);if(!c)continue;
    const home=site.variant===5,s=site.scale;
    if(Math.abs(c[0])<(home?7.6:7.2*s)+margin&&Math.abs(c[1]-(home?1:2*s))<(home?8.6:11*s)+margin)return false;
  }
  return true;
}

