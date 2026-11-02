import { Vector3 } from 'three';
import { describe,expect,it } from 'vitest';
import { tangentToward, travel } from '../../../src/planet/geo';
import { generateLayout, Terrain } from '../planet/terrain';
import { forestNetwork, residenceSite, routeClear, routePadAt, routePathAt, routeSpurCentre, shrineSites } from '../planet/routes';

/** Small symmetric covariance eigensolve; rotation-independent global spread. */
function smallestCovarianceEigenvalue(points:Vector3[]):number {
  const mean=points.reduce((sum,p)=>sum.add(p),new Vector3()).multiplyScalar(1/points.length);
  const matrix=Array.from({length:3},()=>[0,0,0]);
  for(const p of points){
    const c=p.clone().sub(mean).toArray();
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)matrix[i][j]+=c[i]*c[j]/points.length;
  }
  for(let iteration=0;iteration<20;iteration++){
    let a=0,b=1;
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(matrix[i][j])>Math.abs(matrix[a][b])){a=i;b=j;}
    if(Math.abs(matrix[a][b])<1e-14)break;
    const angle=0.5*Math.atan2(2*matrix[a][b],matrix[b][b]-matrix[a][a]),c=Math.cos(angle),s=Math.sin(angle);
    const aa=matrix[a][a],bb=matrix[b][b],ab=matrix[a][b];
    for(let k=0;k<3;k++)if(k!==a&&k!==b){
      const ka=matrix[k][a],kb=matrix[k][b];
      matrix[k][a]=matrix[a][k]=c*ka-s*kb;matrix[k][b]=matrix[b][k]=s*ka+c*kb;
    }
    matrix[a][a]=c*c*aa-2*c*s*ab+s*s*bb;
    matrix[b][b]=s*s*aa+2*c*s*ab+c*c*bb;matrix[a][b]=matrix[b][a]=0;
  }
  return Math.min(matrix[0][0],matrix[1][1],matrix[2][2]);
}

describe('connected sacred forest',()=>{
  it('spreads shrines across polar flanks and the far hemisphere rather than a belt',()=>{
    for(const seed of [1,412,771])for(const radius of [40,128,400]){
      const layout=generateLayout(seed),network=forestNetwork(layout,radius),sites=network.shrines.map(s=>s.dir);
      for(let a=0;a<sites.length;a++)for(let b=a+1;b<sites.length;b++){
        expect(Math.acos(sites[a].dot(sites[b]))*180/Math.PI).toBeGreaterThan(70);
      }
      expect(smallestCovarianceEigenvalue(sites)).toBeGreaterThan(0.2);
      expect(Math.max(...sites.map(s=>s.dot(network.across)))).toBeGreaterThan(0.9);
      expect(Math.min(...sites.map(s=>s.dot(network.across)))).toBeLessThan(-0.9);
      expect(sites.filter(s=>s.dot(layout.cottage)<-0.5)).toHaveLength(2);
    }
  });

  it('preserves the original shrine and separate resident location and orientation',()=>{
    for(const radius of [40,128,400]){
      const layout=generateLayout(412),network=forestNetwork(layout,radius);
      expect(network.shrines[0].dir.distanceTo(layout.cottage)).toBeLessThan(1e-12);
      expect(network.shrines[0].forward.distanceTo(layout.homeBearing)).toBeLessThan(1e-12);
      const bearing=network.across.clone().multiplyScalar(-0.88).addScaledVector(layout.homeBearing,0.475).normalize();
      const expected=travel(layout.cottage,bearing,Math.min(44,radius*0.95)/radius,new Vector3());
      expect(network.residence.dir.distanceTo(expected)).toBeLessThan(1e-12);
      expect(network.residence.forward.distanceTo(tangentToward(expected,network.approach,new Vector3()))).toBeLessThan(1e-12);
    }
  });

  it('connects all six destinations through branching glades without arbitrary trail ends',()=>{
    for(const radius of [40,128,400]){
      const layout=generateLayout(412),network=forestNetwork(layout,radius),nodes:Vector3[]=[],adjacency:number[][]=[];
      const nodeId=(p:Vector3):number=>{
        const found=nodes.findIndex(n=>n.distanceTo(p)<1e-9);if(found>=0)return found;
        nodes.push(p);adjacency.push([]);return nodes.length-1;
      };
      for(const edge of network.spurs){const a=nodeId(edge.a),b=nodeId(edge.b);adjacency[a].push(b);adjacency[b].push(a);}
      const visited=new Set<number>([0]),queue=[0];
      while(queue.length)for(const next of adjacency[queue.shift()!])if(!visited.has(next)){visited.add(next);queue.push(next);}
      expect(visited.size).toBe(nodes.length);
      expect(adjacency.filter(neighbors=>neighbors.length>=3).length).toBeGreaterThanOrEqual(3);
      const destinations=[0,2,3,4,5,6].map(i=>network.spurs[i].a);
      const ends=nodes.filter((_,i)=>adjacency[i].length===1);
      expect(ends).toHaveLength(destinations.length);
      for(const end of ends)expect(destinations.some(d=>d.distanceTo(end)<1e-9)).toBe(true);
    }
  });

  it('keeps every curved trail continuously painted and free of roots through growth',()=>{
    for(const seed of [1,412,771])for(const radius of [40,128,400]){
      const layout=generateLayout(seed),network=forestNetwork(layout,radius);
      for(let index=0;index<network.spurs.length;index++)for(let step=0;step<=64;step++){
        const dir=routeSpurCentre(layout,radius,index,step/64);
        expect(routePathAt(dir,layout,radius)).toBeCloseTo(1,7);
        expect(routeClear(dir,layout,radius,2.6)).toBe(false);
      }
    }
  });

  it('routes around shrine buildings and keeps Muse away from sacred courts',()=>{
    for(const radius of [40,128,400]){
      const layout=generateLayout(412),network=forestNetwork(layout,radius),home=residenceSite(layout,radius),shrines=shrineSites(layout,radius);
      for(const shrine of shrines){
        expect(routePathAt(shrine.dir,layout,radius)).toBe(0);
        expect(Math.acos(Math.max(-1,Math.min(1,home.dir.dot(shrine.dir))))*radius).toBeGreaterThan(30);
        const across=new Vector3().crossVectors(shrine.dir,shrine.forward);
        // Actual timber/plinth footprint, including front/back corners.
        for(const x of [-4.35,0,4.35])for(const z of [-4,0,4.15]){
          const distance=Math.hypot(x,z)*shrine.scale;
          const dir=distance>0?travel(shrine.dir,across.clone().multiplyScalar(x*shrine.scale/distance).addScaledVector(shrine.forward,z*shrine.scale/distance),distance/radius,new Vector3()):shrine.dir;
          expect(routePathAt(dir,layout,radius),`R${radius} shrine${shrine.variant} body${x},${z}`).toBe(0);
        }
        for(let edge=0;edge<network.spurs.length;edge++)for(let step=0;step<=128;step++){
          const dir=routeSpurCentre(layout,radius,edge,step/128);if(dir.dot(shrine.dir)<0.5)continue;
          const x=dir.dot(across)*radius,z=dir.dot(shrine.forward)*radius,s=shrine.scale;
          expect(Math.abs(x)<4.35*s&&z>-4*s&&z<4.15*s,`R${radius} trail${edge} crosses shrine${shrine.variant}`).toBe(false);
        }
      }
      expect(home.dir.dot(home.forward)).toBeCloseTo(0,12);
    }
  });

  it('supports every building and gate footprint on a flat pad through growth',()=>{
    for(const radius of [40,128,400]){
      const layout=generateLayout(412),terrain=new Terrain(layout);
      terrain.radius=radius;
      for(const site of [...shrineSites(layout,radius),residenceSite(layout,radius)]){
        const across=new Vector3().crossVectors(site.dir,site.forward),home=site.variant===5;
        const points=home?[[-4.3,-3],[4.3,-3],[-4.3,6.6],[4.3,6.6]]:[[-5,-4.6],[5,-4.6],[-4,12],[4,12]];
        for(const [x,z] of points){
          const scale=site.scale,distance=Math.hypot(x,z)*scale;
          const direction=across.clone().multiplyScalar(x*scale/distance).addScaledVector(site.forward,z*scale/distance);
          const dir=travel(site.dir,direction,distance/radius,new Vector3());
          expect(routePadAt(dir,layout,radius)).toBeCloseTo(1,10);
          expect(terrain.homestead(dir,22)+0.2).toBeCloseTo(3,10);
          expect(routeClear(dir,layout,radius,0)).toBe(false);
        }
      }
    }
  });
});
