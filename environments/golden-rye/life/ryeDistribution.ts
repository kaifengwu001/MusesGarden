import { Vector3 } from 'three';
import { hash32,unit } from '../../../src/core/hash';

export interface RyeSite { direction:Vector3; size:number; turn:number; phase:number; tone:number; }
export const RYE_NEAR_GRID=780;
export const RYE_NEAR_LIMIT=17000;

/** The cottage's own footprint never takes an ear. Bunds, roads and yards are
 * kept clear by the baked fields in the shader (crop.glsl), not here. */
export function ryeLaneClear(x:number,z:number):boolean {
  return !(Math.abs(x)<4.95&&Math.abs(z)<3.28);
}

/** Equal-area spherified cube: no latitudinal pile-up and no polar holes. */
export function ryeCellDirection(face:number,u:number,v:number,out=new Vector3()):Vector3 {
  const p=face===0?[1,u,v]:face===1?[-1,u,v]:face===2?[u,1,v]:face===3?[u,-1,v]:face===4?[u,v,1]:[u,v,-1];
  const [x,y,z]=p;
  return out.set(x*Math.sqrt(1-y*y*.5-z*z*.5+y*y*z*z/3),y*Math.sqrt(1-z*z*.5-x*x*.5+z*z*x*x/3),z*Math.sqrt(1-x*x*.5-y*y*.5+x*x*y*y/3)).normalize();
}

function cell(seed:number,face:number,i:number,j:number,grid:number):RyeSite {
  const h=hash32(seed^hash32(face*19531+i*73856093+j*19349663));
  const r=(salt:number):number=>unit(hash32(h^salt));
  // Every stratum has crop. Small jitter softens rows without creating holes.
  const u=((i+.5+(r(11)-.5)*.62)/grid)*2-1;
  const v=((j+.5+(r(29)-.5)*.62)/grid)*2-1;
  return {direction:ryeCellDirection(face,u,v),size:.85+r(73)*.42,turn:r(137)*Math.PI*2,phase:r(283)*Math.PI*2,tone:r(431)};
}

/** Stable fine cells surrounding any walking focus. Tile rejection avoids
 * generating the millions of detailed stalks outside this small cap. */
export function createNearRyeSites(seed:number,focus:Vector3,radius:number):RyeSite[] {
  const tile=28,grid=Math.max(tile,Math.round(RYE_NEAR_GRID*radius/128/tile)*tile),tiles=grid/tile;
  const angle=Math.min(.58,18.5/radius),minimum=Math.cos(angle);
  const tileMinimum=Math.cos(Math.min(Math.PI,angle+tile/grid*2.4));
  const sites:RyeSite[]=[],centre=new Vector3();
  for(let face=0;face<6;face++)for(let tx=0;tx<tiles;tx++)for(let ty=0;ty<tiles;ty++){
    ryeCellDirection(face,((tx+.5)/tiles)*2-1,((ty+.5)/tiles)*2-1,centre);
    if(centre.dot(focus)<tileMinimum)continue;
    for(let i=tx*tile;i<(tx+1)*tile;i++)for(let j=ty*tile;j<(ty+1)*tile;j++){
      const point=cell(seed^0x375a1,face,i,j,grid);
      if(point.direction.dot(focus)>=minimum)sites.push(point);
    }
  }
  // Physical cell spacing is retained as R changes. Returning to a previous
  // radius regenerates byte-identical cells; normal walking never moves roots.
  // This guard is a finite allocation bound, not a biome density mask.
  if(sites.length>RYE_NEAR_LIMIT)sites.sort((a,b)=>a.phase-b.phase).length=RYE_NEAR_LIMIT;
  return sites;
}
