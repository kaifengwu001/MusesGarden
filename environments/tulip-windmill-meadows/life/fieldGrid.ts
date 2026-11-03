import { Vector3 } from 'three';
import { mix, unit } from '../../../src/core/hash';
import type { Layout } from '../planet/terrain';

// The cultivated grid: where every tulip bed, soil track and resting field
// lies. Mirrored by planet/tulipRows.glsl; change both together.

/** Longitude and latitude about the home's bearing, ×128 (metres at R 128 on the home's circle). */
export function latitudeLongitude(d:Vector3,layout:Layout):[number,number]{
  const right=new Vector3().crossVectors(layout.cottage,layout.homeBearing);
  return [Math.atan2(d.dot(right),d.dot(layout.cottage))*128,Math.asin(Math.max(-1,Math.min(1,d.dot(layout.homeBearing))))*128];
}

/**
 * The band ends at the cross track nearest ±35° latitude: beyond it, meridian
 * ribbons would narrow to a point at each pole, so each polar cap has its own
 * straight rows.
 */
export const CAP_NORTH=78;
export const CAP_SOUTH=-78-0.035*52;
/** Pattern offsets per cap, so neither repeats the home's beds. A cap's z lies beyond ±500, the band's within. */
const CAP_OFFSET=[[1210,1092],[-1650,-1196]] as const;
export type FieldRegion=-1|0|1;

export function fieldRegion(d:Vector3,layout:Layout):FieldRegion{
  const z=Math.asin(Math.max(-1,Math.min(1,d.dot(layout.homeBearing))))*128;
  return z>CAP_NORTH?1:z<CAP_SOUTH?-1:0;
}

/** The region a field z belongs to (see CAP_OFFSET). */
export function regionOfZ(z:number):FieldRegion{return z>500?1:z<-500?-1:0;}

/**
 * Field-pattern coordinates. In the band, longitude and latitude (×128). In a
 * polar cap, azimuthal-equidistant coordinates about its pole, so rows keep
 * their width. A region may be forced, so a farm's lawn keeps one frame
 * across a cap's edge.
 */
export function fieldCoordinates(d:Vector3,layout:Layout,region:FieldRegion=fieldRegion(d,layout)):[number,number]{
  const c=layout.cottage,b=layout.homeBearing;
  // d·(c×b), without allocating the right vector
  const u=d.x*(c.y*b.z-c.z*b.y)+d.y*(c.z*b.x-c.x*b.z)+d.z*(c.x*b.y-c.y*b.x),v=d.dot(c),w=d.dot(b);
  if(region===0)return [Math.atan2(u,v)*128,Math.asin(Math.max(-1,Math.min(1,w)))*128];
  const s=Math.hypot(u,v),f=s>1e-9?Math.atan2(s,region*w)/s*128:128;
  const offset=CAP_OFFSET[region>0?0:1];
  return [u*f+offset[0],v*f+offset[1]];
}

/** Across the beds: one unit per 9-unit stripe. */
export function fieldPhase(x:number,z:number):number{return (x+z*0.18+3*Math.sin(z/27)+24)/9;}
/** Along the beds: one unit per 52-unit block. */
export function fieldBlock(z:number):number{return (z+26)/52;}
/** A soil track's width (field units), as the cross tracks have always been. */
export const TRACK=0.035*52;

/** The beds around the home keep their original single-block, single-width layout. */
const HOME_BEDS=[-4,8] as const;
const GRID=0x74756c70;
/** Share of neighbouring stripe pairs sown as one double-width bed. */
const DOUBLE=0.3;
/** Chance a bed breaks at a block line between its every-fourth forced breaks. */
const BREAK=0.35;
/** Resting fields: clusters of six beds whose runs start together, and single runs. */
const FALLOW_GROUP=0.16;
const FALLOW_SINGLE=0.03;

const h=(a:number,b:number,c=0):number=>mix(mix(mix(GRID,a),b),c);
const home=(i:number):boolean=>i>=HOME_BEDS[0]&&i<=HOME_BEDS[1];
/** Does stripe pair (2j, 2j+1) form one double bed? */
export function doubleBed(j:number):boolean{return !home(2*j)&&!home(2*j+1)&&unit(h(1,j))<DOUBLE;}
/** The first stripe of the bed holding stripe i. */
export function bedOf(i:number):number{const j=Math.floor(i/2);return doubleBed(j)?2*j:i;}
/** Does bed `lead` end its run at block line n? */
export function breaksAt(lead:number,n:number):boolean{
  if(n===-1||n===2)return true; // the cap rings: a continuous track
  if(home(lead)&&(n===0||n===1))return true;
  if(((n+Math.floor(unit(h(2,lead))*4))%4+4)%4===0)return true; // no run is longer than four blocks
  return unit(h(3,lead,n))<BREAK;
}
/** The block line where the run holding block k of bed `lead` begins. */
export function runStart(lead:number,k:number):number{
  // A forced break falls on one of any four lines, so this search always ends.
  for(let n=k;n>k-3;n--)if(breaksAt(lead,n))return n;
  return k-3;
}

export interface FieldCell{
  /** Stripe index, and how far across it (0–1). */
  stripe:number;across:number;
  /** Block index, and how far along it (0–1). */
  block:number;along:number;
  /** Does this stripe end in a soil row gap? Not inside a double bed. */
  rowGap:boolean;
  /** Does the bed's run end at the top of this block, in a soil track? */
  runEnd:boolean;
  colour:number;
  fallow:boolean;
}

/** The bed, run and colour at field coordinates (x, z). */
export function fieldCell(x:number,z:number):FieldCell{
  const p=fieldPhase(x,z),u=fieldBlock(z),stripe=Math.floor(p),block=Math.floor(u);
  const lead=bedOf(stripe),start=runStart(lead,block);
  // The first stripe of a double bed runs straight on into its second.
  const rowGap=!(doubleBed(Math.floor(stripe/2))&&stripe-2*Math.floor(stripe/2)===0);
  const colour=home(lead)?((lead+start)%6+6)%6:Math.floor(unit(h(4,lead,start))*6);
  const fallow=!home(lead)&&(unit(h(5,Math.floor(lead/6),start))<FALLOW_GROUP||unit(h(6,lead,start))<FALLOW_SINGLE);
  return {stripe,across:p-stripe,block,along:u-block,rowGap,runEnd:breaksAt(lead,block+1),colour,fallow};
}
