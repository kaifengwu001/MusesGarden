import { Matrix4, Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import type { Layout } from '../planet/terrain';

export interface FarmSite {
  direction: Vector3;
  across: Vector3;
  along: Vector3;
  scale: number;
  kind: 'mill'|'cottage';
  variant: number;
  gate: number;
  minDot:number;
}
export const FARM_LIMIT=20;
export const PLOT_HALF_X=5.8;
export const PLOT_HALF_Z=6.4;

export function fieldCoordinates(d:Vector3,layout:Layout):[number,number]{
  const right=new Vector3().crossVectors(layout.cottage,layout.homeBearing);
  return [Math.atan2(d.dot(right),d.dot(layout.cottage))*128,Math.asin(Math.max(-1,Math.min(1,d.dot(layout.homeBearing))))*128];
}
function directionAt(x:number,z:number,layout:Layout):Vector3{
  const right=new Vector3().crossVectors(layout.cottage,layout.homeBearing);
  return layout.cottage.clone().multiplyScalar(Math.cos(z/128)*Math.cos(x/128))
    .addScaledVector(right,Math.cos(z/128)*Math.sin(x/128)).addScaledVector(layout.homeBearing,Math.sin(z/128)).normalize();
}
export function fieldPhase(x:number,z:number):number{return (x+z*0.18+3*Math.sin(z/27)+24)/9;}

/** Ridge lines follow the local derivative of the cultivated ribbon, on either hemisphere. */
export function farmFrame(direction:Vector3,layout:Layout):{across:Vector3;along:Vector3}{
  const [x,z]=fieldCoordinates(direction,layout),slope=-0.18-Math.cos(z/27)/9;
  const along=directionAt(x+slope*0.05,z+0.05,layout).sub(directionAt(x-slope*0.05,z-0.05,layout)).normalize();
  const across=new Vector3().crossVectors(direction,along).normalize();
  along.crossVectors(across,direction).normalize();return {across,along};
}
export function farmMatrix(site:FarmSite):Matrix4{return new Matrix4().makeBasis(site.across,site.direction,site.along);}

/** Same small garden at every farm. Its short gate path meets a real row gap. */
export function farmSites(layout:Layout,radius:number):FarmSite[]{
  const home=layout.cottage,right=new Vector3().crossVectors(home,layout.homeBearing);
  const source:{direction:Vector3;scale:number;kind:'mill'|'cottage';variant:number}[]=[];
  for(const [x,z,scale] of [[0,0,1],[-38,-38,0.7],[43,-51,0.58]])source.push({direction:home.clone().addScaledVector(right,x/radius).addScaledVector(layout.homeBearing,z/radius).normalize(),scale,kind:'mill',variant:0});
  for(let i=0;i<9;i++){
    const y=1-2*(i+0.5)/9,a=i*2.399963+unit(hash32(layout.seed))*Math.PI*2;
    const d=home.clone().multiplyScalar(y).addScaledVector(right,Math.cos(a)*Math.sqrt(1-y*y)).addScaledVector(layout.homeBearing,Math.sin(a)*Math.sqrt(1-y*y)).normalize();
    if(d.dot(home)>Math.cos(0.6))continue;
    source.push({direction:d,scale:0.7+unit(hash32(i+layout.seed))*0.35,kind:'mill',variant:0});
  }
  // Two visible neighbouring farms, then four on distinct sides of the globe.
  for(const [i,[x,z]] of [[-25,18],[30,25],[-142,66],[135,-56],[276,36],[-272,-85]].entries()){
    source.push({direction:directionAt(x,z,layout),scale:0.88+(i%3)*0.07,kind:'cottage',variant:i%3});
  }
  return source.map(s=>{
    const frame=farmFrame(s.direction,layout);
    const phaseAt=(x:number):number=>{const d=s.direction.clone().addScaledVector(frame.across,x*s.scale/radius).addScaledVector(frame.along,8*s.scale/radius).normalize();return fieldPhase(...fieldCoordinates(d,layout));};
    // Solve in local metres for the nearest planted-row gap (fract .97).
    const p=phaseAt(0),target=Math.round(p-0.97)+0.97;
    let gate=0;
    for(let i=0;i<3;i++){const f=phaseAt(gate);gate+=(target-f)/((phaseAt(gate+0.05)-f)/0.05);}
    return {...s,...frame,gate,minDot:Math.cos(Math.max(12,Math.hypot(gate,8)+1)*s.scale/radius)};
  });
}

export function inFarmPlot(d:Vector3,site:FarmSite,radius:number):boolean{
  // Cheap angular rejection before the oriented rectangle.
  if(d.dot(site.direction)<site.minDot)return false;
  const factor=radius/site.scale/d.dot(site.direction);
  const x=d.dot(site.across)*factor,z=d.dot(site.along)*factor;
  const t=Math.max(0,Math.min(1,(z-3.95)/4.05));
  const pathX=0.9+(site.gate-0.9)*t*t*(3-2*t);
  const halfWidth=0.45+(0.25*radius/128/site.scale-0.45)*t;
  const slope=(site.gate-0.9)*6*t*(1-t)/4.05;
  const distancePath=Math.hypot((x-pathX)/Math.sqrt(1+slope*slope),z-Math.max(3.95,Math.min(8,z)));
  return (Math.abs(x)<PLOT_HALF_X+0.2&&Math.abs(z)<PLOT_HALF_Z+0.2)
    ||distancePath<halfWidth+0.22;
}
