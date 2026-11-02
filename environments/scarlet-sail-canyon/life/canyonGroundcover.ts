import { Vector3 } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import type { CanyonRockSite } from './canyonDistribution';
import { createGroundSample, type Terrain } from '../planet/terrain';

export interface GroundcoverSite { direction: Vector3; scale: number; turn: number; colony: number; }
export interface MossTreeSite { site: GroundcoverSite; scale: number; phase: number; }

/** Uneven groves leave moss clearings. Reuse actual moss sites so trees and
 * their parent mats can share the same terrain support check at every radius. */
export function selectMossTreeSites(seed:number,sites:readonly GroundcoverSite[]):MossTreeSite[] {
  let state=hash32(seed^0x7a31be42);
  const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
  const colonies=new Map<number,GroundcoverSite[]>();
  for(const site of sites){
    const members=colonies.get(site.colony)??[];
    members.push(site);colonies.set(site.colony,members);
  }
  const trees:MossTreeSite[]=[];
  for(const members of colonies.values()){
    const centre=members[Math.floor(rand()*members.length)].direction;
    const reach=0.14+rand()*0.07,count=12+Math.floor(rand()*11);
    const candidates=members.filter(site=>site.direction.dot(centre)>Math.cos(reach))
      .map(site=>({site,order:rand()})).sort((a,b)=>a.order-b.order);
    let planted=0;
    for(const {site} of candidates){
      if(trees.some(tree=>tree.site.direction.dot(site.direction)>Math.cos(0.05)))continue;
      trees.push({site,scale:0.65+Math.pow(rand(),1.5)*0.75,phase:rand()*Math.PI*2});
      if(++planted===count||trees.length===320)break;
    }
    if(trees.length===320)break;
  }
  // Retain the first groves as an exact prefix, then grow wider branching
  // stands into two lobes of each colony. This stream cannot move old trees.
  for(const [colony,members] of colonies){
    let extraState=hash32(seed^hash32(colony)^0x2c9e17b5);
    const extra=():number=>unit(extraState=hash32((extraState+0x9e3779b9)>>>0));
    const first=members[Math.floor(extra()*members.length)].direction;
    const distant=members.filter(site=>site.direction.dot(first)<Math.cos(0.2));
    const second=distant.length?distant[Math.floor(extra()*distant.length)].direction:first;
    const reach=0.22+extra()*0.08;
    const candidates=members.filter(site=>Math.max(site.direction.dot(first),site.direction.dot(second))>Math.cos(reach))
      .map(site=>({site,order:extra()})).sort((a,b)=>a.order-b.order);
    let added=0;
    for(const {site} of candidates){
      if(trees.some(tree=>tree.site.direction.dot(site.direction)>Math.cos(0.05)))continue;
      trees.push({site,scale:0.65+Math.pow(extra(),1.5)*0.75,phase:extra()*Math.PI*2});
      if(++added===28||trees.length===880)break;
    }
    if(trees.length===880)break;
  }
  return trees;
}

/** Leave low moss visible between taller pockets. Nearby members share a
 * dominant plant community without repeating an identical mixed bouquet. */
export function mossPlantCommunity(seed:number,direction:Vector3):number {
  const key=hash32(seed^hash32(Math.round(direction.x*8191))^hash32(Math.round(direction.y*12289))^hash32(Math.round(direction.z*16381)));
  if(unit(key)>0.28)return -1;
  const region=hash32(seed^hash32(Math.round(direction.x*5))^hash32(Math.round(direction.y*5))^hash32(Math.round(direction.z*5)));
  return region%2;
}

/** One rigid support plane, with residual checks at its edge and interior.
 * A riser cannot pass merely because its four corners happen to be level. */
export function groundcoverSupport(terrain: Terrain, dir: Vector3, x: Vector3, z: Vector3, reach: number): readonly [number,number] | null {
  const probe=new Vector3(),sample=createGroundSample();
  const height=(u:number,v:number):number=>terrain.sample(probe.copy(dir).addScaledVector(x,u/terrain.radius).addScaledVector(z,v/terrain.radius).normalize(),sample).height;
  const centre=height(0,0);
  const sx=(height(reach,0)-height(-reach,0))/(2*reach);
  const sz=(height(0,reach)-height(0,-reach))/(2*reach);
  if(Math.hypot(sx,sz)>0.28)return null;
  for(const u of [-1,-0.5,0,0.5,1])for(const v of [-1,0,1]){
    if(Math.abs(height(u*reach,v*reach)-centre-(sx*u+sz*v)*reach)>0.055)return null;
  }
  return [sx,sz];
}

/** Large living islands occupy the spaces between geology colonies. Terrain
 * support is checked at the current physical radius by CanyonScenery. */
export function generateGroundcoverSites(seed: number, rocks: readonly CanyonRockSite[]): GroundcoverSite[] {
  let state = hash32(seed ^ 0x61ab84e3);
  const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
  const sphere = (): Vector3 => {
    const y = rand() * 2 - 1, a = rand() * Math.PI * 2;
    return new Vector3(Math.cos(a) * Math.sqrt(1-y*y), y, Math.sin(a) * Math.sqrt(1-y*y));
  };
  const candidates = Array.from({length: 160}, () => {
    const direction = sphere();
    const crowding = rocks.reduce((sum, rock) => sum + Math.max(0, rock.direction.dot(direction) - Math.cos(0.28)), 0);
    return {direction, crowding};
  }).sort((a,b) => a.crowding-b.crowding);
  const centers: Vector3[] = [];
  for (const candidate of candidates) {
    if (centers.every(center => center.dot(candidate.direction) < Math.cos(0.46))) centers.push(candidate.direction);
    if (centers.length === 20) break;
  }
  const sites: GroundcoverSite[] = [];
  for (const [colony, center] of centers.entries()) {
    const axis = new Vector3().crossVectors(center, Math.abs(center.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
    const cross = new Vector3().crossVectors(center, axis).normalize();
    const turn = rand()*Math.PI*2, reach = 0.32+rand()*0.16;
    const along = axis.clone().multiplyScalar(Math.cos(turn)).addScaledVector(cross,Math.sin(turn));
    const across = new Vector3().crossVectors(center,along).normalize();
    const narrowness = 0.42+rand()*0.4;
    // Unequal lobed boundaries, dense cores and feathered satellites. These
    // are broad colonies, not additional rocks or a uniform planet scatter.
    const count = 620+Math.floor(rand()*260);
    for (let i=0; i<count; i++) {
      const a=rand()*Math.PI*2, r=Math.sqrt(rand());
      const edge=1+0.18*Math.sin(a*3+colony)+0.12*Math.sin(a*5+turn);
      const u=Math.cos(a)*r*reach*edge;
      const v=Math.sin(a)*r*reach*edge*narrowness+u*u/reach*0.3;
      const direction=center.clone().addScaledVector(along,u).addScaledVector(across,v).normalize();
      if (rocks.some(rock=>rock.direction.dot(direction)>Math.cos(0.065))) continue;
      sites.push({direction,scale:(2.6+rand()*1.8)*(1-0.28*r),turn:rand()*Math.PI*2,colony});
    }
  }
  return sites;
}
