import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { RICE_RADIUS, RICE_STEP, sampleRiceField } from './riceFields';

export interface CottageSite {
  direction:Vector3;
  right:Vector3;
  forward:Vector3;
  floorRadius:number;
  /** Absolute radial-axis coordinates, not local heights above the floor. */
  minGround:number;
  maxGround:number;
  wetFraction:number;
  /** Raw terrain diagnostics in the house's local vertical axis. */
  gateClearance:number;
  flankRise:number;
  minFlankRise:number;
  backRise:number;
  frontRise:number;
}

const PREFERRED=new Vector3(.32,.76,.56).normalize();
const UP=new Vector3(0,1,0);
const GOLDEN_ANGLE=Math.PI*(3-Math.sqrt(5));
const cache=new Map<number,CottageSite>();

/** Tightly follows the main hall, side wing and enclosed courtyard. No
 * surrounding paved platform or projecting staircase belongs to this home. */
export const COTTAGE_FOOTPRINT=[
  {x0:-4.58,x1:4.58,z0:-5.10,z1:-.04},
  {x0:-6.55,x1:5.36,z0:-.04,z1:6.68},
] as const;
export const COTTAGE_PERIMETER=[[-4.58,-5.10],[4.58,-5.10],[4.58,-.04],[5.36,-.04],
  [5.36,6.68],[-6.55,6.68],[-6.55,-.04],[-4.58,-.04]] as const;

function copySite(site:CottageSite):CottageSite{
  return {...site,direction:site.direction.clone(),right:site.right.clone(),forward:site.forward.clone()};
}

/** Gnomonic reference-radius projection, also used by the clearance mask.
 * It deliberately covers a slightly larger ground footprint than the rigid
 * house at its greater floor radius. */
export function cottageLocalDirection(site:CottageSite,x:number,z:number):Vector3{
  return site.direction.clone().multiplyScalar(RICE_RADIUS)
    .addScaledVector(site.right,x).addScaledVector(site.forward,z).normalize();
}

/** Ground at the actual local vertical column of a rigid foundation vertex.
 * Verify candidate spherical treads rather than iterating a discontinuous
 * height field: an iteration can alternate forever across a terrace edge.
 * When the column hits a riser instead, solve the topmost solid/air crossing. */
export function cottageLocalGround(site:CottageSite,x:number,z:number,seed:number):number{
  const lateralSquared=x*x+z*z;
  const direction=new Vector3();
  const at=(axial:number)=>sampleRiceField(direction.copy(site.direction).multiplyScalar(axial)
      .addScaledVector(site.right,x).addScaledVector(site.forward,z).normalize(),seed);
  const candidates:{axial:number;outside:boolean}[]=[];
  // These are the unchanged terrain's complete bounded levels, only 21
  // possibilities. Highest first also handles more than one valid contact.
  for(let band=Math.floor(27.5/RICE_STEP);band>=Math.floor(2.4/RICE_STEP);band--){
    const radius=RICE_RADIUS+band*RICE_STEP;
    const axial=Math.sqrt(Math.max(0,radius*radius-lateralSquared));
    const field=at(axial);
    if(field.band===band)return axial-site.floorRadius;
    candidates.push({axial,outside:band>field.band});
  }
  // No horizontal tread is self-consistent at a side-wall hit. A lower
  // candidate lies inside the solid while the next higher one is outside.
  for(let i=0;i<candidates.length-1;i++){
    const upper=candidates[i],lower=candidates[i+1];
    if(!upper.outside||lower.outside)continue;
    let lo=lower.axial,hi=upper.axial;
    for(let iteration=0;iteration<52;iteration++){
      const mid=(lo+hi)*.5,field=at(mid);
      if(Math.sqrt(mid*mid+lateralSquared)>RICE_RADIUS+field.surfaceHeight)hi=mid;
      else lo=mid;
    }
    return (lo+hi)*.5-site.floorRadius;
  }
  // The bounded radial solid always has a crossing for the cottage's small
  // footprint. This protects a future out-of-domain caller without NaNs.
  return candidates[candidates.length-1].axial-site.floorRadius;
}

/** Reserve the house and courtyard, with optional planting
 * clearance. Opposite-hemisphere points cannot belong to the footprint. */
export function cottageContains(site:CottageSite,direction:Vector3,margin=0):boolean{
  const front=direction.dot(site.direction);
  if(front<=0)return false;
  const scale=RICE_RADIUS/front;
  const x=direction.dot(site.right)*scale,z=direction.dot(site.forward)*scale;
  const padding=margin+1e-8;
  return COTTAGE_FOOTPRINT.some(rect=>x>=rect.x0-padding&&x<=rect.x1+padding&&z>=rect.z0-padding&&z<=rect.z1+padding);
}

function frame(direction:Vector3,seed:number,turn:number):CottageSite{
  const right=new Vector3().crossVectors(Math.abs(direction.y)<.95?UP:new Vector3(0,0,1),direction).normalize();
  const forward=new Vector3().crossVectors(right,direction).normalize();
  const site:CottageSite={direction:direction.clone(),right,forward,
    floorRadius:RICE_RADIUS+sampleRiceField(direction,seed).surfaceHeight,
    minGround:0,maxGround:0,wetFraction:0,gateClearance:0,flankRise:0,minFlankRise:0,backRise:0,frontRise:0};
  // Search headings around the whole local horizon. Always facing downhill
  // would put the gate at the lowest edge and require a stair or pedestal.
  forward.applyAxisAngle(direction,turn);
  right.crossVectors(direction,forward).normalize();
  return site;
}

function groundSample(site:CottageSite,x:number,z:number,seed:number,iterations:number){
  let axial=site.floorRadius;
  const direction=new Vector3(),lateral=x*x+z*z;
  let field=sampleRiceField(site.direction,seed);
  for(let i=0;i<iterations;i++){
    direction.copy(site.direction).multiplyScalar(axial).addScaledVector(site.right,x).addScaledVector(site.forward,z).normalize();
    field=sampleRiceField(direction,seed);
    axial=Math.sqrt((RICE_RADIUS+field.surfaceHeight)**2-lateral);
  }
  return {ground:axial,wet:field.wet,smooth:Math.sqrt((RICE_RADIUS+field.smoothHeight)**2-lateral)};
}

function survey(site:CottageSite,seed:number,spacing:number):number{
  let min=Infinity,max=-Infinity,wet=0,count=0;
  const iterations=spacing<1?5:1;
  const probe=(x:number,z:number):void=>{
    const sample=groundSample(site,x,z,seed,iterations);
    min=Math.min(min,sample.ground);max=Math.max(max,sample.ground);wet+=Number(sample.wet);count++;
  };
  for(const rect of COTTAGE_FOOTPRINT){
    const nx=Math.ceil((rect.x1-rect.x0)/spacing),nz=Math.ceil((rect.z1-rect.z0)/spacing);
    for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++)
      probe(rect.x0+(rect.x1-rect.x0)*x/nx,rect.z0+(rect.z1-rect.z0)*z/nz);
  }
  for(const x of [1.1,2,2.9])probe(x,6.68);
  site.minGround=min;site.maxGround=max;site.wetFraction=wet/count;
  // Set the house at the surrounding rim, barely above the .12 m bank caps.
  // The integrated terrain fills the hollow to this grade; no exposed
  // platform or stair belongs to this placement contract.
  site.floorRadius=max+.16;
  const gateGround=Math.min(...[1.1,2,2.9].map(x=>groundSample(site,x,6.68,seed,5).ground));
  site.gateClearance=site.floorRadius-gateGround;
  const center=groundSample(site,0,0,seed,1).smooth;
  const left=groundSample(site,-11,0,seed,1).smooth,right=groundSample(site,11,0,seed,1).smooth;
  site.flankRise=(left+right)*.5-center;site.minFlankRise=Math.min(left,right)-center;
  site.backRise=groundSample(site,0,-11,seed,1).smooth-center;
  site.frontRise=groundSample(site,0,11,seed,1).smooth-center;
  const relief=max-min;
  return site.wetFraction*1000+Math.max(0,site.gateClearance-.42)*100
    +Math.max(0,relief-2.4)*30+relief*2+(1-site.direction.dot(PREFERRED))*10
    -Math.min(2,Math.max(0,site.flankRise))*4-Math.min(1.5,Math.max(0,site.minFlankRise))*4
    -Math.min(1.5,Math.max(0,site.backRise))*2
    +Math.max(0,.3-site.minFlankRise)*6+Math.max(0,.3-site.backRise)*3
    +Math.max(0,site.frontRise-1.4)*2;
}

/** Search a dry terrace hollow with higher flanks/back and a near-grade gate.
 * Coarse candidates include the visible hemisphere and a global fallback;
 * small position/heading refinements avoid missing an adjoining dry ledge.
 * The final decision uses a dense survey of the actual compact footprint.
 * Unusual seeds retain the least-cost site with truthful diagnostics. */
export function cottageSite(seed:number):CottageSite{
  const cached=cache.get(seed);if(cached)return copySite(cached);
  const phase=unit(hash32(seed^0x62ca13))*Math.PI*2;
  const candidates:{site:CottageSite;score:number;turn:number}[]=[];
  const preferredRight=new Vector3().crossVectors(UP,PREFERRED).normalize();
  const preferredForward=new Vector3().crossVectors(preferredRight,PREFERRED).normalize();
  for(let i=0;i<1280;i++){
    let direction:Vector3;
    if(i<1024){
      const reach=Math.sqrt((i+.5)/1024)*.75,a=i*GOLDEN_ANGLE+phase;
      direction=PREFERRED.clone().multiplyScalar(Math.cos(reach))
        .addScaledVector(preferredRight,Math.cos(a)*Math.sin(reach))
        .addScaledVector(preferredForward,Math.sin(a)*Math.sin(reach)).normalize();
    }else{
      const y=1-2*(i-1024+.5)/256,a=i*GOLDEN_ANGLE+phase;
      direction=new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
    }
    if(sampleRiceField(direction,seed).wet)continue;
    for(let heading=0;heading<8;heading++){
      const turn=heading*Math.PI/4;
      const site=frame(direction,seed,turn),score=survey(site,seed,3.6);
      candidates.push({site,score,turn});
    }
  }
  // The world has dry land by construction. Still retain a deterministic
  // fallback so a future field edit cannot create an undefined site.
  if(!candidates.length)candidates.push({site:frame(PREFERRED,seed,0),score:Infinity,turn:0});
  candidates.sort((a,b)=>a.score-b.score);
  for(const candidate of candidates.slice(0,12))for(let i=0;i<12;i++){
    const reach=Math.sqrt((i+.5)/12)*3/RICE_RADIUS,a=i*GOLDEN_ANGLE+phase;
    const direction=candidate.site.direction.clone().multiplyScalar(Math.cos(reach))
      .addScaledVector(candidate.site.right,Math.cos(a)*Math.sin(reach))
      .addScaledVector(candidate.site.forward,Math.sin(a)*Math.sin(reach)).normalize();
    for(const offset of [-.12,0,.12]){
      const turn=candidate.turn+offset,site=frame(direction,seed,turn),score=survey(site,seed,3.6);
      candidates.push({site,score,turn});
    }
  }
  candidates.sort((a,b)=>a.score-b.score);
  let best=candidates[0].site,bestScore=Infinity;
  for(const {site} of candidates.slice(0,56)){
    const score=survey(site,seed,.55);
    if(score<bestScore){best=site;bestScore=score;}
  }
  if(cache.size>=12)cache.delete(cache.keys().next().value!);
  cache.set(seed,copySite(best));
  return copySite(best);
}
