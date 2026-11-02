import type { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { gnoise } from '../../../src/planet/noise';

export const RICE_RADIUS=128;
export const RICE_STEP=1.2;
export interface RiceFieldSample {
  smoothHeight:number;
  surfaceHeight:number;
  band:number;
  plot:number;
  wet:boolean;
  forest:boolean;
  region:number;
}

/** Smooth parcel coordinate over the entire sphere, independent of mesh faces.
 * Its isolines make curved cross-cuts, without any large polygon provinces. */
export function riceParcelCoordinate(direction:Vector3,seed:number):number{
  const {x,y,z}=direction,s=hash32(seed^0x42c83a);
  return 8.5+4.2*gnoise(x*2.6+1.7,y*2.6-3.2,z*2.6+4.1,s)
    +gnoise(x*5.2-2.1,y*5.2+1.3,z*5.2,s+1);
}

/** Adjacent levels stagger their dividers instead of continuing a seam
 * through many terraces. The height contours themselves stay continuous. */
export function riceParcelPhase(seed:number,band:number):number{
  return (unit(hash32(seed^0x6a3f29))+band*0.618033988749895)%1;
}

export function riceSmoothHeight(direction:Vector3,seed:number):number{
  const {x,y,z}=direction;
  const s=hash32(seed^0x71a9f3);
  // Broad rolling provinces plus quieter bends in the contours. The field
  // lives in direction space, so opposite cube faces sample the same hills.
  const broad=gnoise(x*2.25+7.3,y*2.25-2.1,z*2.25+1.7,s);
  const middle=gnoise(x*5.1-3.2,y*5.1+5.8,z*5.1+2.5,s+1);
  const fine=gnoise(x*10.5+1.1,y*10.5,z*10.5-3.3,s+2);
  return Math.max(2.4,Math.min(27.5,13.6+broad*16+middle*4.1+fine*.55));
}

export function ricePlotState(seed:number,region:number,band:number):Pick<RiceFieldSample,'plot'|'wet'|'forest'>{
  const plot=hash32(seed^hash32(region*7919)^hash32(band*104729));
  const forest=band>=5&&unit(hash32(seed^hash32(region*3181+Math.floor(band/3)*4973+0x4f17)))<.18;
  return {plot,forest,wet:!forest&&unit(plot)<.43};
}

export function sampleRiceField(direction:Vector3,seed:number):RiceFieldSample{
  const smoothHeight=riceSmoothHeight(direction,seed);
  const band=Math.floor(smoothHeight/RICE_STEP);
  const region=Math.floor(riceParcelCoordinate(direction,seed)+riceParcelPhase(seed,band));
  const state=ricePlotState(seed,region,band);
  return {smoothHeight,surfaceHeight:band*RICE_STEP,band,region,...state};
}
