import { Matrix4, Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import type { Layout } from '../planet/terrain';
import { TRACK, bedOf, fieldCoordinates, fieldPhase, fieldRegion, type FieldRegion } from './fieldGrid';

/**
 * A farm's lawn is a cell of the field grid: whole beds (stripes i0–i1)
 * between two short soil tracks across them, at field z zl and zh, in its
 * region's coordinates. The beds run on as tulips past both tracks.
 */
export interface FarmLot { i0:number; i1:number; zl:number; zh:number; region:FieldRegion; }

export interface FarmSite {
  direction: Vector3;
  across: Vector3;
  along: Vector3;
  scale: number;
  kind: 'mill'|'cottage';
  variant: number;
  /** Where the front walk meets the lawn's front track (local units along). */
  walk: number;
  lot: FarmLot;
  minDot:number;
}
export const FARM_LIMIT=20;
/** The fenced yard every building stands in (local units): fences at ±5.55, borders, apron. */
const YARD={halfX:5.8,back:-6.6,front:5.4} as const;
/** The front walk leaves the door here, at this offset across. */
const DOOR={x:0.9,z:3.95} as const;

function directionAt(x:number,z:number,layout:Layout):Vector3{
  const right=new Vector3().crossVectors(layout.cottage,layout.homeBearing);
  return layout.cottage.clone().multiplyScalar(Math.cos(z/128)*Math.cos(x/128))
    .addScaledVector(right,Math.cos(z/128)*Math.sin(x/128)).addScaledVector(layout.homeBearing,Math.sin(z/128)).normalize();
}

/** Ridge lines run along the local ribbon, where the field phase holds still, in the band or a cap. */
export function farmFrame(direction:Vector3,layout:Layout):{across:Vector3;along:Vector3}{
  const t1=new Vector3().crossVectors(direction,Math.abs(direction.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
  const t2=new Vector3().crossVectors(direction,t1),region=fieldRegion(direction,layout);
  const step=1e-4,at=(a:number,b:number):[number,number]=>fieldCoordinates(direction.clone().addScaledVector(t1,a).addScaledVector(t2,b).normalize(),layout,region);
  const phase=(a:number,b:number):number=>fieldPhase(...at(a,b));
  const g1=phase(step,0)-phase(-step,0),g2=phase(0,step)-phase(0,-step);
  const along=t1.clone().multiplyScalar(-g2).addScaledVector(t2,g1).normalize();
  // Same sense as before: toward rising z, the long way up the ribbon.
  const z1=at(along.dot(t1)*step,along.dot(t2)*step)[1],z0=at(-along.dot(t1)*step,-along.dot(t2)*step)[1];
  if(z1<z0)along.negate();
  const across=new Vector3().crossVectors(direction,along).normalize();
  along.crossVectors(across,direction).normalize();return {across,along};
}
export function farmMatrix(site:FarmSite):Matrix4{return new Matrix4().makeBasis(site.across,site.direction,site.along);}

/** A point given in a farm's local units (across, along). */
function localPoint(direction:Vector3,frame:{across:Vector3;along:Vector3},x:number,z:number,scale:number,radius:number):Vector3{
  return direction.clone().addScaledVector(frame.across,x*scale/radius).addScaledVector(frame.along,z*scale/radius).normalize();
}

/** The same small garden at every farm, in a lawn of whole beds whose front track its walk runs straight to. */
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
    keepOffFarMeridian(s,layout,radius);
    const frame=farmFrame(s.direction,layout),region=fieldRegion(s.direction,layout);
    const field=(x:number,z:number):[number,number]=>fieldCoordinates(localPoint(s.direction,frame,x,z,s.scale,radius),layout,region);
    // Every bed the yard touches, widened to whole double beds, from just
    // behind the yard to just in front of it.
    let i0=Infinity,i1=-Infinity,zl=Infinity,zh=-Infinity;
    for(let a=0;a<=12;a++)for(let b=0;b<=12;b++){
      const [x,z]=field(-YARD.halfX+a*YARD.halfX/6,YARD.back+b*(YARD.front-YARD.back)/12),i=Math.floor(fieldPhase(x,z));
      i0=Math.min(i0,i);i1=Math.max(i1,i);zl=Math.min(zl,z);zh=Math.max(zh,z);
    }
    i0=bedOf(i0);if(bedOf(i1+1)===i1)i1++;
    // The walk runs straight from the door, along the ribbon, to the middle of the front track.
    const target=zh+TRACK/2;
    let near:number=DOOR.z,far=DOOR.z+(target-field(DOOR.x,DOOR.z)[1])*radius/128/s.scale*1.5+2;
    for(let k=0;k<40;k++){const mid=(near+far)/2;if(field(DOOR.x,mid)[1]<target)near=mid;else far=mid;}
    const walk=(near+far)/2;
    // Angular reach of the whole lot, for cheap rejection: two stripes past the yard and its end tracks.
    const stripe=9*1.2*radius/128/s.scale,reach=Math.hypot(YARD.halfX+2*stripe,Math.max(walk,-YARD.back)+TRACK*1.2*radius/128/s.scale+1);
    return {...s,...frame,walk,lot:{i0,i1,zl,zh,region},minDot:Math.cos(reach*s.scale/radius)};
  });
}

/**
 * Longitude restarts on the meridian opposite the home, so a lawn there would
 * span every bed between. A farm close to it moves along its circle of
 * latitude to keep its lawn clear.
 */
function keepOffFarMeridian(s:{direction:Vector3;scale:number},layout:Layout,radius:number):void{
  if(fieldRegion(s.direction,layout)!==0)return;
  const right=new Vector3().crossVectors(layout.cottage,layout.homeBearing);
  const lon=Math.atan2(s.direction.dot(right),s.direction.dot(layout.cottage));
  const margin=(Math.hypot(YARD.halfX,YARD.back)*1.2*s.scale+2*9*1.2*radius/128)/radius/Math.max(0.5,Math.cos(Math.asin(s.direction.dot(layout.homeBearing))));
  const limit=Math.PI-margin;
  if(Math.abs(lon)<=limit)return;
  // Turning by +θ about the home's bearing lowers longitude by θ.
  s.direction.applyAxisAngle(layout.homeBearing,lon-Math.sign(lon)*limit).normalize();
}

/** What a direction is to a farm: on its lawn, on its walk or lawn tracks (soil), or neither. */
export function farmGround(d:Vector3,site:FarmSite,radius:number,layout:Layout):'lawn'|'soil'|null{
  // Cheap angular rejection before the lot.
  const facing=d.dot(site.direction);
  if(facing<site.minDot)return null;
  const factor=radius/site.scale/facing;
  const x=d.dot(site.across)*factor,z=d.dot(site.along)*factor;
  const walk=Math.abs(x-DOOR.x)<0.45&&z>DOOR.z-0.2&&z<site.walk;
  const apron=Math.abs(x-DOOR.x)<2.35+0.15&&Math.abs(z-4.2)<0.45+0.15;
  if(walk||apron)return 'soil';
  const L=site.lot,[fx,fz]=fieldCoordinates(d,layout,L.region),p=fieldPhase(fx,fz),i=Math.floor(p);
  if(i<L.i0||i>L.i1)return null;
  if(fz>=L.zl&&fz<=L.zh)return i===L.i1&&p-i>0.925?'soil':'lawn';
  if(fz>L.zh&&fz<=L.zh+TRACK||fz<L.zl&&fz>=L.zl-TRACK)return 'soil';
  return null;
}
