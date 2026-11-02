import { describe,expect,it } from 'vitest';
import { generateGroveSites,groveRouteClear,Grove } from '../life/grove';
import { groveFloorGeometry,sequoiaCanopyGeometry,sequoiaGeometry } from '../life/groveGeometry';
import { Vector3, type BufferGeometry, type Mesh, type InstancedBufferGeometry } from 'three';
import { generateLayout,Terrain } from '../planet/terrain';

const forestFields={roll:1.25,hummocks:0.12,wetlands:0,waterLevel:0,grain:0.6,density:0,patchiness:0.78,patchSize:13,weights:[0.4,0.24,0.22,0.14] as [number,number,number,number]};
const treeMeshes=(grove:Grove):Mesh<InstancedBufferGeometry>[]=>grove.group.children.filter(object=>object.userData.habit<3) as Mesh<InstancedBufferGeometry>[];
const treeSnapshot=(grove:Grove):string[]=>treeMeshes(grove).flatMap(mesh=>{
  const g=mesh.geometry,a=g.getAttribute('aAnchor'),x=g.getAttribute('aAcross'),p=g.getAttribute('aPlacement');
  return Array.from({length:g.instanceCount},(_,i)=>[mesh.userData.habit,a.getX(i),a.getY(i),a.getZ(i),a.getW(i),x.getX(i),x.getY(i),x.getZ(i),p.getX(i),p.getY(i),p.getZ(i)].join(','));
}).sort();

/** Rasterize the actual needle triangles, not their optimistic bounding discs. */
function crownMask(geometry:BufferGeometry):{has:(x:number,z:number)=>boolean;radius:number} {
  const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),step=0.2;
  let radius=0;
  for(let i=0;i<p.count;i++)if(kind.getX(i)===1)radius=Math.max(radius,Math.hypot(p.getX(i),p.getZ(i)));
  const extent=Math.ceil(radius/step)*step,size=Math.ceil(extent*2/step)+1,mask=new Uint8Array(size*size);
  for(let i=0;i<p.count;i+=3){
    if(kind.getX(i)!==1)continue;
    const ax=p.getX(i),az=p.getZ(i),bx=p.getX(i+1),bz=p.getZ(i+1),cx=p.getX(i+2),cz=p.getZ(i+2);
    const lowX=Math.max(0,Math.floor((Math.min(ax,bx,cx)+extent)/step)),highX=Math.min(size-1,Math.ceil((Math.max(ax,bx,cx)+extent)/step));
    const lowZ=Math.max(0,Math.floor((Math.min(az,bz,cz)+extent)/step)),highZ=Math.min(size-1,Math.ceil((Math.max(az,bz,cz)+extent)/step));
    for(let z=lowZ;z<=highZ;z++)for(let x=lowX;x<=highX;x++){
      const px=x*step-extent,pz=z*step-extent;
      const a=(bx-ax)*(pz-az)-(bz-az)*(px-ax),b=(cx-bx)*(pz-bz)-(cz-bz)*(px-bx),c=(ax-cx)*(pz-cz)-(az-cz)*(px-cx);
      if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0))mask[z*size+x]=1;
    }
  }
  geometry.dispose();
  return {radius,has:(x,z)=>{
    const ix=Math.round((x+extent)/step),iz=Math.round((z+extent)/step);
    return ix>=0&&ix<size&&iz>=0&&iz<size&&mask[iz*size+ix]===1;
  }};
}

describe('sequoia grove anatomy and placement',()=>{
  it('keeps shrine and processional lane clear while framing them with ancient trees',()=>{
    const sites=generateGroveSites(612);
    const local=sites.filter(site=>site.local);
    expect(local.filter(site=>site.habit===0).length).toBeGreaterThanOrEqual(8);
    for(const site of local){const [x,z]=site.local!;expect(groveRouteClear(x,z,site.habit===3?1.1:2.6)).toBe(true);}
    expect(groveRouteClear(0,0)).toBe(false);expect(groveRouteClear(2,25)).toBe(false);expect(groveRouteClear(12,16,2.6)).toBe(true);
    const global=sites.filter(site=>!site.local&&site.habit<3);
    expect(global.length).toBeGreaterThan(3000);expect(global.length).toBeLessThan(3600);
    for(const site of global)expect(site.direction.length()).toBeCloseTo(1,8);
  });

  it('regenerates the same unequal rooted stands without shared random state',()=>{
    const first=generateGroveSites(612);generateGroveSites(4);
    expect(generateGroveSites(612)).toEqual(first);
    expect(generateGroveSites(613)).not.toEqual(first);
  });

  it('keeps every placed tree exactly once while switching between near detail and orbital canopy',()=>{
    const terrain=new Terrain(generateLayout(412)),grove=new Grove({},terrain);
    const all=treeSnapshot(grove),focus=terrain.layout.cottage.clone();
    expect(new Set(all).size).toBe(all.length);
    grove.update(12,terrain,focus,0);expect(treeSnapshot(grove)).toEqual(all);
    const first=treeMeshes(grove).map(mesh=>mesh.geometry.instanceCount);
    expect(first.slice(0,3).reduce((a,b)=>a+b,0)).toBeGreaterThan(50);
    expect(first.slice(3).reduce((a,b)=>a+b,0)).toBeGreaterThan(1000);
    grove.update(12,terrain,focus.clone().negate(),500);expect(treeSnapshot(grove)).toEqual(all);
    expect(treeMeshes(grove).slice(0,3).every(mesh=>mesh.geometry.instanceCount===0)).toBe(true);
    grove.update(12,terrain,focus,0);expect(treeSnapshot(grove)).toEqual(all);
    expect(treeMeshes(grove).map(mesh=>mesh.geometry.instanceCount)).toEqual(first);
    grove.dispose();
  });

  it('retains tall rooted silhouettes in compact bounded canopy templates',()=>{
    for(let habit=0;habit<3;habit++){
      const full=sequoiaGeometry(habit),coarse=sequoiaCanopyGeometry(habit),p=coarse.getAttribute('position');
      expect(p.count/3).toBeLessThanOrEqual(260);
      expect(coarse.userData.height).toBe(full.userData.height);
      for(const name of ['position','normal','uv','aKind'])expect(Array.from(coarse.getAttribute(name).array).every(Number.isFinite)).toBe(true);
      const detailedMask=crownMask(full),coarseMask=crownMask(coarse);
      expect(coarseMask.radius/detailedMask.radius).toBeGreaterThan(0.95);
      expect(coarseMask.radius/detailedMask.radius).toBeLessThan(1.05);
    }
  });

  it('covers all six sides with actual mature needle crowns at every planet size',()=>{
    const terrain=new Terrain(generateLayout(412)),grove=new Grove({},terrain);
    const masks=[0,1,2].map(sequoiaGeometry).map(crownMask),dir=new Vector3(),up=new Vector3(),x=new Vector3(),z=new Vector3();
    for(const radius of [40,128,400]){
      terrain.update(radius,forestFields,radius/256);grove.update(12,terrain);
      const trees=treeMeshes(grove).flatMap(mesh=>{
        const g=mesh.geometry,a=g.getAttribute('aAnchor'),axes=g.getAttribute('aAcross'),p=g.getAttribute('aPlacement'),mask=masks[mesh.userData.habit as number];
        return Array.from({length:g.instanceCount},(_,i)=>{
          up.fromBufferAttribute(a,i).normalize();x.fromBufferAttribute(axes,i).normalize();z.crossVectors(x,up).normalize();
          const scale=p.getX(i);
          return {up:up.clone(),x:x.clone(),z:z.clone(),scale,mask,near:Math.cos(Math.asin(Math.min(0.88,mask.radius*scale/radius)))};
        });
      });
      expect(trees.length).toBeLessThan(25000);
      const faceCount=[0,0,0,0,0,0],faceCovered=[0,0,0,0,0,0];
      for(let i=0;i<4096;i++){
        const y=1-2*(i+0.5)/4096,a=i*2.399963229728653,s=Math.sqrt(1-y*y);
        dir.set(Math.cos(a)*s,y,Math.sin(a)*s);
        if(terrain.clearingAt(dir,0)>0.05)continue;
        const coords=[dir.x,dir.y,dir.z],axis=coords.reduce((best,value,index)=>Math.abs(value)>Math.abs(coords[best])?index:best,0),face=axis*2+(coords[axis]<0?1:0);
        faceCount[face]++;
        if(trees.some(tree=>tree.up.dot(dir)>tree.near&&tree.mask.has(radius*tree.x.dot(dir)/tree.scale,radius*tree.z.dot(dir)/tree.scale)))faceCovered[face]++;
      }
      const coverage=faceCovered.reduce((a,b)=>a+b,0)/faceCount.reduce((a,b)=>a+b,0);
      expect(coverage,`R${radius}: projected crown coverage`).toBeGreaterThan(0.88);
      for(let face=0;face<6;face++)expect(faceCovered[face]/faceCount[face],`R${radius}, face${face}: broad grass-only gap`).toBeGreaterThan(0.80);
    }
    grove.dispose();
  });

  it('builds finite tall trunks with broad root flares and distinct high-bough habits',()=>{
    const heights:number[]=[];
    for(let variant=0;variant<3;variant++){
      const g=sequoiaGeometry(variant),p=g.getAttribute('position'),k=g.getAttribute('aKind');
      expect(p.count/3).toBeLessThan(4000);
      for(const name of ['position','normal','uv','aKind'])expect(Array.from(g.getAttribute(name).array).every(Number.isFinite)).toBe(true);
      let trunkMax=-Infinity,flare=0,lowerCanopy=Infinity;
      for(let i=0;i<p.count;i++){
        if(k.getX(i)===0){trunkMax=Math.max(trunkMax,p.getY(i));if(p.getY(i)<0.7)flare=Math.max(flare,Math.hypot(p.getX(i),p.getZ(i)));}
        else lowerCanopy=Math.min(lowerCanopy,p.getY(i));
      }
      heights.push(trunkMax);expect(flare).toBeGreaterThan(variant===0?2.5:variant===1?1.5:0.6);
      expect(lowerCanopy).toBeGreaterThan(variant===0?12:variant===1?6:1);
      g.dispose();
    }
    expect(heights[0]).toBeGreaterThan(heights[1]*1.3);expect(heights[1]).toBeGreaterThan(heights[2]*1.6);
    const floor=groveFloorGeometry();expect(new Set(Array.from(floor.getAttribute('aKind').array))).toEqual(new Set([2,3,4]));floor.dispose();
  });

  it('keeps the actual placed trunk-root vertices off the hiking trail through growth',()=>{
    const terrain=new Terrain(generateLayout(412));
    const grove=new Grove({},terrain),up=new Vector3(),x=new Vector3(),z=new Vector3(),dir=new Vector3();
    for(const radius of [40,128,400]){
      terrain.update(radius,forestFields,radius/256);
      let worstPath=0;
      for(const coarse of [false,true]){
      grove.update(12,terrain,coarse?terrain.layout.cottage:undefined,coarse?500:0);
      for(const object of treeMeshes(grove)){
        const geometry=(object as Mesh<InstancedBufferGeometry>).geometry;
        const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind');
        const anchors=geometry.getAttribute('aAnchor'),axes=geometry.getAttribute('aAcross'),placement=geometry.getAttribute('aPlacement');
        const roots:Array<readonly [number,number]>=[];
        for(let v=0;v<p.count;v++)if(kind.getX(v)===0&&p.getY(v)<=0.55)roots.push([p.getX(v),p.getZ(v)]);
        for(let i=0;i<geometry.instanceCount;i++){
          up.fromBufferAttribute(anchors,i).normalize();x.fromBufferAttribute(axes,i).normalize();z.crossVectors(x,up).normalize();
          const scale=placement.getX(i);
          for(const [rootX,rootZ] of roots){
            const px=rootX*scale,pz=rootZ*scale,d=Math.hypot(px,pz),angle=Math.asin(d/radius);
            dir.copy(up).multiplyScalar(Math.cos(angle));
            if(d>0)dir.addScaledVector(x,px/d*Math.sin(angle)).addScaledVector(z,pz/d*Math.sin(angle));
            worstPath=Math.max(worstPath,terrain.pathAt(dir));
          }
        }
      }
      }
      expect(worstPath,`R${radius}: rooted wood overlaps the path`).toBeLessThan(0.1);
    }
    grove.dispose();
  });
});
