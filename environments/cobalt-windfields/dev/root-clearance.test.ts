import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Ray, Sphere, Vector3, Vector4, type InstancedBufferGeometry, type Mesh } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { WindfieldRootClearance } from '../life/windfieldRootClearance';
import { makeGeologyPrototypes } from '../life/windGeology';
import { createWindfieldAnchors, WindfieldScenery } from '../life/windfieldScenery';
import { createGroundSample, generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const up=new Vector3(0,1,0),across=new Vector3(1,0,0);
const params: FieldParams={roll:2.1,hummocks:.12,wetlands:0,waterLevel:0,grain:.75,density:0,patchiness:.78,patchSize:13,weights:[.4,.24,.22,.14]};
const prototypes=makeGeologyPrototypes();
afterAll(()=>prototypes.forEach(p=>{p.geometry.dispose();p.outline.dispose();}));

/** Independent vector implementation of the shader transform for ray checks. */
function worldTriangles(geometry: BufferGeometry, radius: number, direction: Vector3, axis: Vector3, height: number, scale: number, foot: number): Vector3[] {
  const u=direction.clone().normalize(),x=axis.clone().normalize(),z=new Vector3().crossVectors(x,u).normalize();
  const positions=geometry.getAttribute('position'),ground=geometry.getAttribute('aGround'),index=geometry.index;
  return Array.from({length:index?.count??positions.count},(_,i)=>{
    const vertex=index?.getX(i)??i;
    const p=new Vector3().fromBufferAttribute(positions,vertex).multiplyScalar(scale);
    p.y-=(ground?.getX(vertex)??0)*foot;
    const d=Math.hypot(p.x,p.z),theta=Math.asin(Math.min(d/radius,.9));
    const normal=u.clone().multiplyScalar(Math.cos(theta));
    if(d>1e-5)normal.addScaledVector(x,p.x/d*Math.sin(theta)).addScaledVector(z,p.z/d*Math.sin(theta));
    return normal.multiplyScalar(radius+height+p.y);
  });
}

describe('Cobalt roots across neighbouring rock formations',()=>{
  it('keeps true gaps inside a shared bounding footprint and accepts terrain above the roof',()=>{
    const left=new BoxGeometry(2,3,2).translate(-4,1.5,0).toNonIndexed();
    const right=new BoxGeometry(2,3,2).translate(4,1.5,0).toNonIndexed();
    const shape=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([...left.getAttribute('position').array,...right.getAttribute('position').array],3));
    try {
      const clearance=new WindfieldRootClearance(128);
      clearance.add(shape,up,across,0,1,0);
      const underLeft=new Vector3(-4/128,Math.sqrt(1-(4/128)**2),0);
      expect(clearance.blocked(underLeft,0)).toBe(true);
      expect(clearance.blocked(up,0)).toBe(false);
      expect(clearance.blocked(underLeft,4)).toBe(false);
      expect(clearance.blocked(up.clone().negate(),0)).toBe(false);
    } finally {left.dispose();right.dispose();shape.dispose();}
  });

  it('uses curved, scaled indexed geometry and the support-foot attribute',()=>{
    const shelf=new BoxGeometry(1,1,1).translate(30,.5,0);
    const support=new BoxGeometry(1,.5,1).translate(0,.75,0);
    support.setAttribute('aGround',new Float32BufferAttribute(new Float32Array(support.getAttribute('position').count).fill(1),1));
    try {
      const clearance=new WindfieldRootClearance(80);
      clearance.add(shelf,up,across,1,2,0);
      const beneath=new Vector3(.75,Math.sqrt(1-.75**2),0);
      expect(clearance.blocked(beneath,0)).toBe(true);
      expect(clearance.blocked(beneath,4)).toBe(false);
      const extended=new WindfieldRootClearance(80);
      extended.add(support,up,across,0,1,2);
      expect(extended.blocked(up,0)).toBe(false);
    } finally {shelf.dispose();support.dispose();}
  });

  it('checks the last added formation without a rock-count cutoff',()=>{
    const shape=new BoxGeometry(1,1,1).translate(0,.5,0);
    try {
      const clearance=new WindfieldRootClearance(128);
      for(let i=0;i<1200;i++)clearance.add(shape,up,across,-10,1,0);
      expect(clearance.blocked(up,0)).toBe(false);
      clearance.add(shape,up,across,0,1,0);
      expect(clearance.blocked(up,0)).toBe(true);
    } finally {shape.dispose();}
  });

  it('detects the seed-412 coral root covered by a different formation at radius 128',()=>{
    const terrain=new Terrain(generateLayout(412));terrain.update(128,params,.5);
    const plan=createWindfieldAnchors(terrain.layout,prototypes);
    const foreign=plan.rocks.flatMap((anchors,type)=>anchors.map(anchor=>({anchor,type}))).find(r=>r.anchor.id==='rock-376')!;
    const a=foreign.anchor,[lx,lz]=a.offset!,distance=Math.hypot(lx,lz);
    const x=new Vector3().crossVectors(a.direction,Math.abs(a.direction.y)<.9?up:across).normalize(),z=new Vector3().crossVectors(x,a.direction).normalize();
    const direction=a.direction.clone().multiplyScalar(Math.cos(distance/128)).addScaledVector(x,lx/distance*Math.sin(distance/128)).addScaledVector(z,lz/distance*Math.sin(distance/128)).normalize();
    x.addScaledVector(direction,-x.dot(direction)).normalize();z.crossVectors(x,direction).normalize();
    const axis=x.clone().multiplyScalar(Math.cos(a.turn)).addScaledVector(z,Math.sin(a.turn));
    const sample=createGroundSample();terrain.sample(direction,sample);
    const clearance=new WindfieldRootClearance(128);
    clearance.add(prototypes[foreign.type].geometry,direction,axis,sample.height-.09*a.scale,a.scale,0);
    const root=new Vector3(.4759051458236518,.6470796884322865,.5956527251653801);
    terrain.sample(root,sample);
    expect(clearance.blocked(root,sample.height)).toBe(true);
  });

  it('leaves no accepted coral or sail roots under rendered rocks through growth',()=>{
    const terrain=new Terrain(generateLayout(412));terrain.update(128,params,.5);
    const scenery=new WindfieldScenery({uWindVec:{value:new Vector4(1,0,0,.6)}},terrain);
    const names=new Set(prototypes.map(p=>p.name)),sample=createGroundSample(),ray=new Ray(),hit=new Vector3();
    try {
      for(const radius of [40,128,400]) {
        terrain.update(radius,params,radius/256);scenery.update(10,terrain);
        const rocks: {vertices:Vector3[];sphere:Sphere}[]=[];
        const roots:Vector3[]=[];
        for(const object of scenery.group.children) {
          const mesh=object as Mesh<InstancedBufferGeometry>,geometry=mesh.geometry;
          if(!names.has(mesh.name)&&!mesh.name.startsWith('Sheltered coral')&&!mesh.name.startsWith('Ivory seed sails'))continue;
          const anchors=geometry.getAttribute('aAnchor'),axes=geometry.getAttribute('aAcross'),placements=geometry.getAttribute('aPlacement'),feet=geometry.getAttribute('aFootDepth');
          for(let i=0;i<geometry.instanceCount;i++) {
            const direction=new Vector3(anchors.getX(i),anchors.getY(i),anchors.getZ(i));
            if(!names.has(mesh.name)){roots.push(direction.normalize());continue;}
            const axis=new Vector3().fromBufferAttribute(axes,i);
            const vertices=worldTriangles(geometry,radius,direction,axis,anchors.getW(i),placements.getX(i),feet.getX(i));
            rocks.push({vertices,sphere:new Box3().setFromPoints(vertices).getBoundingSphere(new Sphere())});
          }
        }
        let blocked=0;
        for(const root of roots) {
          terrain.sample(root,sample);ray.origin.copy(root).multiplyScalar(radius+sample.height+.03);ray.direction.copy(root);
          for(const rock of rocks) {
            if(!ray.intersectsSphere(rock.sphere))continue;
            let collision=false;
            for(let i=0;i<rock.vertices.length;i+=3)if(ray.intersectTriangle(rock.vertices[i],rock.vertices[i+1],rock.vertices[i+2],false,hit)){collision=true;break;}
            if(collision){blocked++;break;}
          }
        }
        expect(roots.length,`radius ${radius}`).toBeGreaterThan(200);
        expect(blocked,`radius ${radius}`).toBe(0);
      }
    } finally {scenery.dispose();}
  },20_000);
});
