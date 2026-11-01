import { Vector3, Vector4, type InstancedBufferGeometry, type Mesh } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { makeGeologyPrototypes } from '../life/windGeology';
import { clearsWindfieldRoutes, createWindfieldAnchors, WindfieldScenery } from '../life/windfieldScenery';
import { createGroundSample, generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';
import { ResidentLife } from '../life/residentLife';
import { WILDLIFE_HABITATS, wildlifeMotion } from '../life/windWildlife';
import { WILDLIFE_SPECIES } from '../life/wildlifeGeometry';

const prototypes = makeGeologyPrototypes();
const PARAMS: FieldParams = { roll:2.1,hummocks:0.12,wetlands:0,waterLevel:0,grain:0.75,density:0,patchiness:0.78,patchSize:13,weights:[0.4,0.24,0.22,0.14] };
afterAll(() => prototypes.forEach(prototype => { prototype.geometry.dispose();prototype.outline.dispose(); }));

describe('Cobalt fractured geology', () => {
  it('keeps bedrock and finite sand mantles closed, nondegenerate and supported', () => {
    for(const prototype of prototypes) {
      const positions=prototype.geometry.getAttribute('position');
      const normals=prototype.geometry.getAttribute('normal');
      const kinds=prototype.geometry.getAttribute('aKind');
      const edges=new Map<string,number>();
      const a=new Vector3(),b=new Vector3(),c=new Vector3();
      let volume=0,worstNormalError=0,validMaterials=true;
      const key=(i:number):string=>`${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`;
      for(let i=0;i<positions.count;i+=3) {
        a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);
        volume+=a.dot(b.clone().cross(c))/6;
        for(let corner=0;corner<3;corner++) {
          const index=i+corner;
          validMaterials=validMaterials&&(kinds.getX(index)===2||kinds.getX(index)===13);
          worstNormalError=Math.max(worstNormalError,Math.abs(Math.hypot(normals.getX(index),normals.getY(index),normals.getZ(index))-1));
          const pair=[key(index),key(i+(corner+1)%3)].sort().join('|');
          edges.set(pair,(edges.get(pair)??0)+1);
        }
      }
      expect(validMaterials).toBe(true);
      expect(worstNormalError).toBeLessThan(1e-5);
      expect([...edges.values()].every(count=>count===2),prototype.name).toBe(true);
      const size=prototype.geometry.boundingBox!.getSize(new Vector3());
      expect(size.z,prototype.name).toBeGreaterThan(0.9);
      expect(volume/(size.x*size.y*size.z),prototype.name).toBeGreaterThan(0.1);
      expect(prototype.supportSites.length).toBeGreaterThan(0);
      expect(prototype.geometry.getAttribute('aGround').count).toBe(positions.count);
      expect(prototype.outline.getAttribute('aGround').count).toBe(prototype.outline.getAttribute('position').count);
    }

  });

  it('builds deterministic clustered geology and roots every plant at an accepted rock', () => {
    const first=createWindfieldAnchors(generateLayout(412),prototypes);
    const again=createWindfieldAnchors(generateLayout(412),prototypes);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(JSON.stringify(createWindfieldAnchors(generateLayout(413),prototypes))).not.toBe(JSON.stringify(first));
    const hosts=new Map(first.rocks.flatMap((anchors,type)=>anchors.map(anchor=>[anchor.id!,{anchor,type}] as const)));
    for(const category of first.rocks) expect(category.length).toBeGreaterThan(0);
    const local=first.rocks.flatMap((anchors,type)=>anchors.filter(anchor=>anchor.local).map(anchor=>({anchor,type})));
    expect(local.filter(item=>item.type<5).length).toBeGreaterThan(25);
    for(const {anchor,type} of local) expect(clearsWindfieldRoutes(anchor.local![0],anchor.local![1],prototypes[type].footprint*anchor.scale),anchor.id).toBe(true);
    for(const plant of [...first.sails.flat(),...first.coral.flat()]) {
      const host=hosts.get(plant.rockId!);
      expect(host,plant.rockId).toBeDefined();
      const from=host!.anchor.local??host!.anchor.offset!;
      const to=plant.local??plant.offset!;
      expect(Math.hypot(to[0]-from[0],to[1]-from[1])).toBeLessThan((prototypes[host!.type].footprint+3.2)*host!.anchor.scale);
      expect(plant.threshold).toBe(host!.anchor.threshold);
    }
    expect(first.sails.every(variant=>variant.length>0)).toBe(true);
    expect(first.coral.every(variant=>variant.length>0)).toBe(true);
  });

  it('keeps residents and native animal routes clear without burying rubble into thin caps', () => {
    const plan=createWindfieldAnchors(generateLayout(412),prototypes);
    const local=plan.rocks.flatMap((anchors,type)=>anchors.filter(anchor=>anchor.local).map(anchor=>({anchor,type})));
    for(const {anchor,type} of local) {
      const exposed=prototypes[type].height*anchor.scale-(anchor.burial??0.09*anchor.scale);
      expect(exposed,anchor.id).toBeGreaterThan(0.18);
    }
    let closestResident=Infinity,closestAnimal=Infinity;
    for(const seed of [412,5]) for(const radius of [40,128,400]) {
      const terrain=new Terrain(generateLayout(seed));
      terrain.update(radius,PARAMS,2*radius/512);
      const layout=createWindfieldAnchors(terrain.layout,prototypes);
      const occupied=layout.rocks.flatMap((anchors,type)=>anchors.filter(anchor=>anchor.local).map(anchor=>({x:anchor.local![0],z:anchor.local![1],extent:prototypes[type].footprint*anchor.scale})));
      const lives=[0,1,2].map(index=>new ResidentLife(index));
      const camera=terrain.layout.cottage.clone().multiplyScalar(radius+20);
      for(let time=0;time<160;time+=1) for(const life of lives) {
        const pose=life.at(time,terrain,camera);
        const position=terrain.cottageLocal(pose.dir,{x:0,z:0});
        for(const rock of occupied) closestResident=Math.min(closestResident,Math.hypot(position.x-rock.x,position.z-rock.z)-rock.extent);
      }
      for(const species of WILDLIFE_SPECIES) for(let index=0;index<WILDLIFE_HABITATS[species].count;index++) for(let time=0;time<30;time+=0.5) {
        const pose=wildlifeMotion(species,index,time,seed);
        for(const rock of occupied) closestAnimal=Math.min(closestAnimal,Math.hypot(pose.x-rock.x,pose.z-rock.z)-rock.extent);
      }
    }
    expect(closestResident).toBeGreaterThan(0.75);
    expect(closestAnimal).toBeGreaterThan(0.7);
  },20_000);

  it('keeps world transforms finite through growth and omits tiny plants in orbit', () => {
    const terrain=new Terrain(generateLayout(412));
    terrain.update(128,PARAMS,0.5);
    const scenery=new WindfieldScenery({uWindVec:{value:new Vector4(1,0,0,0.6)}},terrain);
    for(const radius of [40,128,400]) {
      terrain.update(radius,PARAMS,2*radius/512);
      scenery.update(10,terrain,terrain.layout.cottage,4);
      let worstNormalError=0,worstTangentError=0,finiteHeights=true,staticRocks=true;
      const sample=createGroundSample(),up=new Vector3(),acrossVector=new Vector3(),forward=new Vector3(),support=new Vector3();
      for(const object of scenery.group.children) {
        const mesh=object as Mesh<InstancedBufferGeometry>;
        const anchor=mesh.geometry.getAttribute('aAnchor');
        const across=mesh.geometry.getAttribute('aAcross');
        const placement=mesh.geometry.getAttribute('aPlacement');
        const foot=mesh.geometry.getAttribute('aFootDepth');
        for(let i=0;i<mesh.geometry.instanceCount;i++) {
          worstNormalError=Math.max(worstNormalError,Math.abs(Math.hypot(anchor.getX(i),anchor.getY(i),anchor.getZ(i))-1));
          finiteHeights=finiteHeights&&Number.isFinite(anchor.getW(i));
          worstTangentError=Math.max(worstTangentError,Math.abs(anchor.getX(i)*across.getX(i)+anchor.getY(i)*across.getY(i)+anchor.getZ(i)*across.getZ(i)));
          if(mesh.name!=='Windborne seeds') staticRocks=staticRocks&&placement.getW(i)===0;
        }
        const prototype=prototypes.find(candidate=>candidate.name===mesh.name);
        if(prototype) for(let i=0;i<Math.min(mesh.geometry.instanceCount,8);i++) {
          up.set(anchor.getX(i),anchor.getY(i),anchor.getZ(i)).normalize();
          acrossVector.set(across.getX(i),across.getY(i),across.getZ(i)).normalize();
          forward.crossVectors(acrossVector,up).normalize();
          const scale=placement.getX(i);
          expect(Number.isFinite(foot.getX(i))&&foot.getX(i)>=0).toBe(true);
          for(const site of prototype.supportSites) {
            const x=site.x*scale,z=site.z*scale,d=Math.hypot(x,z),angle=Math.asin(Math.min(d/radius,0.9));
            support.copy(up).multiplyScalar(Math.cos(angle));
            if(d>1e-6) support.addScaledVector(acrossVector,x/d*Math.sin(angle)).addScaledVector(forward,z/d*Math.sin(angle));
            terrain.sample(support.normalize(),sample);
            expect(anchor.getW(i)+site.y*scale-foot.getX(i)-sample.height,`${mesh.name} foot`).toBeLessThan(-0.17);
          }
        }
      }
      expect(worstNormalError).toBeLessThan(1e-5);
      expect(worstTangentError).toBeLessThan(1e-5);
      expect(finiteHeights).toBe(true);
      expect(staticRocks).toBe(true);
    }
    scenery.update(10,terrain,terrain.layout.cottage,terrain.radius*4.2);
    for(const object of scenery.group.children.filter(child=>child.name.startsWith('Sheltered coral'))) {
      expect((object as Mesh<InstancedBufferGeometry>).geometry.instanceCount).toBe(0);
    }
    const outlines=scenery.group.children.filter(child=>child.name.endsWith(' ink edges'));
    expect(outlines).toHaveLength(prototypes.length);
    for(const object of outlines) {
      const line=object as Mesh<InstancedBufferGeometry>;
      const surface=scenery.group.children.find(child=>child.name===line.name.replace(' ink edges','')) as Mesh<InstancedBufferGeometry>;
      expect(line.geometry.getAttribute('aAnchor')).toBe(surface.geometry.getAttribute('aAnchor'));
      expect(line.geometry.getAttribute('aFootDepth')).toBe(surface.geometry.getAttribute('aFootDepth'));
      expect(line.geometry.instanceCount).toBe(surface.geometry.instanceCount);
    }
    scenery.dispose();
  },20_000);
});
