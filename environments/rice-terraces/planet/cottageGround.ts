import type { Vector3 } from 'three';
import type { CottageSite } from './cottageSite';
import { COTTAGE_PAVING } from './cottagePaving';
import { RICE_RADIUS, sampleRiceField } from './riceFields';

/** Small earth-filled terrace beneath the home. It is part of the terrain
 * mesh, not an overlapping decorative mound or a tall stone platform. */
export function cottageGradeWeight(direction:Vector3,site:CottageSite):number{
  const facing=direction.dot(site.direction);if(facing<.985)return 0;
  const scale=site.floorRadius/facing;
  const x=direction.dot(site.right)*scale,z=direction.dot(site.forward)*scale;
  const distance=Math.min(...COTTAGE_PAVING.map(rect=>Math.hypot(
    Math.max(rect.x0-x,0,x-rect.x1),Math.max(rect.z0-z,0,z-rect.z1))));
  // Keep a narrow earth edge flush with the paving, then merge back into
  // the existing banks. The smooth falloff preserves the surrounding hills.
  const t=Math.max(0,Math.min(1,(distance-.45)/3.8));
  return 1-t*t*(3-2*t);
}

export function cottageGroundRadius(direction:Vector3,radius:number,site:CottageSite):number{
  const weight=cottageGradeWeight(direction,site);if(weight===0)return radius;
  const plane=(site.floorRadius-.04)/direction.dot(site.direction);
  return radius+(plane-radius)*weight;
}

export function sampleCottageGround(direction:Vector3,seed:number,site:CottageSite){
  const field=sampleRiceField(direction,seed);
  return {...field,surfaceHeight:cottageGroundRadius(direction,RICE_RADIUS+field.surfaceHeight,site)-RICE_RADIUS};
}

export function cottageGradedLocalGround(site:CottageSite,x:number,z:number,seed:number):number{
  let axial=site.floorRadius;
  const direction=site.direction.clone(),lateral=x*x+z*z;
  for(let i=0;i<5;i++){
    direction.copy(site.direction).multiplyScalar(axial).addScaledVector(site.right,x).addScaledVector(site.forward,z).normalize();
    const radius=RICE_RADIUS+sampleCottageGround(direction,seed,site).surfaceHeight;
    axial=Math.sqrt(Math.max(0,radius*radius-lateral));
  }
  return axial-site.floorRadius;
}
