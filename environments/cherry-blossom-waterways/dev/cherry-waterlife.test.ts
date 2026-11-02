import { Matrix4, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CherryWaterlife, remoteDuckSites } from '../life/cherryWaterlife';
import { schema } from '../params';
import type { FieldParams } from '../planet/fields';
import { createGroundSample, generateLayout, Terrain } from '../planet/terrain';

const params:FieldParams={
  roll:schema.terrain.roll.def,hummocks:schema.terrain.hummocks.def,
  wetlands:schema.terrain.wetlands.def,waterLevel:schema.terrain.waterLevel.def,
  grain:schema.terrain.grain.def,density:schema.flowers.density.def,
  patchiness:schema.flowers.patchiness.def,patchSize:schema.flowers.patchSize.def,
  weights:[schema.flowers.pink.def,schema.flowers.star.def,schema.flowers.yellow.def,schema.flowers.blue.def],
};

function terrainAt(radius:number,seed=412):Terrain {
  const terrain=new Terrain(generateLayout(seed));
  terrain.update(radius,params,2*radius/512);
  return terrain;
}

function pose(waterlife:CherryWaterlife):unknown[] {
  return [waterlife.group.children.map(o=>[o.name,o.visible,...o.matrix.elements]),
    waterlife.remoteDuckMesh.count,Array.from(waterlife.remoteDuckMesh.instanceMatrix.array.slice(0,waterlife.remoteDuckMesh.count*16))];
}

describe('cherry pond boats and ducks',()=>{
  it('keeps all six inhabitants afloat at default size and every visible footprint wet through growth and motion',()=>{
    const waterlife=new CherryWaterlife({});
    const sample=createGroundSample();
    let triangles=0;
    for(const mesh of waterlife.group.children as Mesh[]) {
      triangles+=(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3;
      mesh.geometry.computeBoundingBox();
    }
    expect(triangles).toBeLessThan(20_000);
    for(const radius of [40,128,400]) {
      const terrain=terrainAt(radius);
      for(const time of [0,12,18,120]) {
        waterlife.update(terrain,time);
        // Retain the original home support checks; instanced remote ducks are
        // checked individually below using their actual instance matrices.
        const visible=waterlife.group.children.filter(o=>o.visible&&o!==waterlife.remoteDuckMesh) as Mesh[];
        if(radius===128) {
          expect(visible.filter(o=>o.userData.cherryWaterlife==='rowboat'),`R128 time${time} boats`).toHaveLength(3);
          expect(visible.filter(o=>o.userData.cherryWaterlife==='duck'),`R128 time${time} ducks`).toHaveLength(3);
        }
        for(const mesh of visible) {
          expect(mesh.matrix.elements.every(Number.isFinite)).toBe(true);
          const up=new Vector3().setFromMatrixPosition(mesh.matrix).normalize();
          const right=new Vector3().setFromMatrixColumn(mesh.matrix,0);
          const forward=new Vector3().setFromMatrixColumn(mesh.matrix,2);
          terrain.sample(up,sample);
          expect(sample.depth,`R${radius} time${time} ${mesh.name} centre`).toBeGreaterThan(0.4);
          const bounds=mesh.geometry.boundingBox!;
          // Probe the full visible hull/duck plus wake envelope using the
          // actual source geometry bounds and the vertex shader's sphere bend.
          for(const x of [bounds.min.x,bounds.max.x]) for(const z of [bounds.min.z,bounds.max.z]) {
            const distance=Math.hypot(x,z);
            const angle=Math.asin(distance/radius);
            const dir=up.clone().multiplyScalar(Math.cos(angle))
              .addScaledVector(right,x/distance*Math.sin(angle))
              .addScaledVector(forward,z/distance*Math.sin(angle)).normalize();
            terrain.sample(dir,sample);
            expect(sample.depth,`R${radius} time${time} ${mesh.name} wet footprint`).toBeGreaterThan(0.15);
          }
        }
      }
    }
  });

  it('returns to exactly the same water poses without integrating time or mutable randomness',()=>{
    const terrain=terrainAt(128),waterlife=new CherryWaterlife({});
    waterlife.update(terrain,12);
    const original=pose(waterlife);
    waterlife.update(terrain,18);
    expect(pose(waterlife)).not.toEqual(original);
    waterlife.update(terrain,120);
    waterlife.update(terrain,12);
    expect(pose(waterlife)).toEqual(original);
    const second=new CherryWaterlife({});
    second.update(terrain,12);
    expect(pose(second)).toEqual(original);
  });

  it('places unequal small flocks in remote waterways across hemispheres with stable seeded identities',()=>{
    const identity=(seed:number):unknown[]=>{
      const result=remoteDuckSites(terrainAt(128,seed));
      return result.sites.map(s=>[s.id,s.flock,s.dir.toArray(),s.phase,s.speed]);
    };
    expect(identity(412)).toEqual(identity(412));
    expect(identity(771)).not.toEqual(identity(412));
    for(const seed of [412,771,2026])for(const radius of [40,128,400]) {
      const terrain=terrainAt(radius,seed),result=remoteDuckSites(terrain);
      expect(result.flocks.length,`seed${seed} R${radius} remote flocks`).toBeGreaterThanOrEqual(radius===40?8:12);
      expect(result.flocks.length).toBeLessThanOrEqual(18);
      expect(result.sites.length).toBeLessThanOrEqual(54);
      expect(result.flocks.every(f=>f.population===2||f.population===3)).toBe(true);
      expect(new Set(result.flocks.map(f=>f.population)).size).toBe(2);
      for(const axis of ['x','y','z'] as const) {
        expect(result.flocks.some(f=>f.dir[axis]>0.15),`seed${seed} R${radius} positive ${axis}`).toBe(true);
        expect(result.flocks.some(f=>f.dir[axis]<-0.15),`seed${seed} R${radius} negative ${axis}`).toBe(true);
      }
      for(let i=0;i<result.flocks.length;i++)for(let j=i+1;j<result.flocks.length;j++) {
        expect(result.flocks[i].dir.distanceTo(result.flocks[j].dir)*radius).toBeGreaterThan(8.8);
      }
      // Some members are genuinely on the far side, rather than all added to
      // the authored pond or its immediate neighbouring shore.
      expect(result.sites.some(s=>s.dir.dot(terrain.layout.cottage)<-0.3)).toBe(true);
    }
  });

  it('keeps each remote duck and wake over water through motion with one added draw and a bounded submitted cost',()=>{
    const life=new CherryWaterlife({}),sample=createGroundSample(),matrix=new Matrix4();
    const duck=life.remoteDuckMesh;
    duck.geometry.computeBoundingBox();
    const bounds=duck.geometry.boundingBox!;
    const duckTriangles=(duck.geometry.index?.count??duck.geometry.getAttribute('position').count)/3;
    const localTriangles=(life.group.children.filter(o=>o!==duck) as Mesh[])
      .reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3,0);
    expect(life.group.children.length).toBe(7);
    for(const seed of [412,771,2026])for(const radius of [40,128,400]) {
      const terrain=terrainAt(radius,seed);
      for(const time of [0,12,18,120]) {
        life.update(terrain,time);
        expect(duck.count).toBe(life.duckSites.length);
        expect(localTriangles+duckTriangles*duck.count).toBeLessThan(100_000);
        const positions:Vector3[]=[];
        for(let i=0;i<duck.count;i++) {
          duck.getMatrixAt(i,matrix);
          const position=new Vector3().setFromMatrixPosition(matrix);
          const up=position.clone().normalize(),right=new Vector3().setFromMatrixColumn(matrix,0).normalize(),forward=new Vector3().setFromMatrixColumn(matrix,2).normalize();
          positions.push(position);
          terrain.sample(up,sample);
          expect(sample.depth,`seed${seed} R${radius} t${time} duck${i} centre`).toBeGreaterThan(0.33);
          for(const x of [bounds.min.x,0,bounds.max.x])for(const z of [bounds.min.z,0,bounds.max.z]) {
            const distance=Math.hypot(x,z);
            if(distance===0)continue;
            const angle=Math.asin(distance/radius);
            const dir=up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(right,x/distance*Math.sin(angle)).addScaledVector(forward,z/distance*Math.sin(angle)).normalize();
            terrain.sample(dir,sample);
            expect(sample.depth,`seed${seed} R${radius} t${time} duck${i} complete wet footprint`).toBeGreaterThan(0.15);
          }
        }
        for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++) {
          expect(positions[i].distanceTo(positions[j]),`R${radius} t${time} separate duck bodies`).toBeGreaterThan(1.2);
        }
      }
    }
  });
});
