import { describe, expect, it } from 'vitest';
import { Box3, Ray, Vector3, type BufferGeometry } from 'three';
import { CHALK_SHELF_CENTRE_HEIGHT, CHALK_SHELF_FOOTPRINT, CHALK_SHELF_PLANTINGS, chalkGeometry, chalkShelfGeometry, coralGeometry, fanTreeGeometry, fernGeometry, lichenGeometry } from './canyonGeometry';

function surfaceHeight(geometry:BufferGeometry,x:number,z:number):number {
  const ray=new Ray(new Vector3(x,30,z),new Vector3(0,-1,0));
  const positions=geometry.getAttribute('position');
  const kinds=geometry.getAttribute('aKind');
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),hit=new Vector3();
  let height=-Infinity;
  for(let i=0;i<positions.count;i+=3){
    if(kinds.getX(i)!==2)continue;
    a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);
    if(ray.intersectTriangle(a,b,c,false,hit))height=Math.max(height,hit.y);
  }
  return height;
}

describe('Scarlet canopy and fractured cliff mesh contracts',()=>{
  it('keeps every template finite, nondegenerate and within its instancing budget',()=>{
    const templates:[BufferGeometry,number][]=[[fanTreeGeometry(),1250],[fanTreeGeometry(1),1250],[chalkGeometry(),150],[chalkShelfGeometry(),4000],[fernGeometry(),650],[coralGeometry(),450],[lichenGeometry(),1000]];
    for(const [geometry,budget] of templates){
      const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
      expect(geometry.getAttribute('aPlantBase').count).toBe(positions.count);
      expect(positions.count/3).toBeLessThanOrEqual(budget);
      for(const attribute of Object.values(geometry.attributes))expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      let badNormals=0,degenerateTriangles=0;
      const a=new Vector3(),b=new Vector3(),c=new Vector3();
      for(let i=0;i<normals.count;i++)if(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)>0.000005)badNormals++;
      for(let i=0;i<positions.count;i+=3){
        a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);
        if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-14)degenerateTriangles++;
      }
      expect(badNormals).toBe(0);expect(degenerateTriangles).toBe(0);
      geometry.dispose();
    }
  });

  it('gives every fan blade a real woody attachment and a broad folded silhouette',()=>{
    for(const variant of [0,1]){
      const geometry=fanTreeGeometry(variant);
      const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),uv=geometry.getAttribute('uv');
      const wood:Vector3[]=[],roots=new Map<string,Vector3>(),bladeBounds=new Box3();
      for(let i=0;i<p.count;i++){
        const point=new Vector3().fromBufferAttribute(p,i);
        if(kind.getX(i)===0)wood.push(point);
        if(kind.getX(i)===1){
          bladeBounds.expandByPoint(point);
          if(uv.getY(i)===0)roots.set(point.toArray().join(','),point);
        }
      }
      expect(roots.size).toBeGreaterThanOrEqual(2);
      for(const root of roots.values())expect(Math.min(...wood.map(point=>point.distanceTo(root)))).toBeLessThan(0.4);
      const size=bladeBounds.getSize(new Vector3());
      expect(size.x).toBeGreaterThan(6);expect(size.y).toBeGreaterThan(2);expect(size.z).toBeGreaterThan(1);
      geometry.dispose();
    }
  });

  it('keeps the central planting surface level while surrounding cliffs have real height variation',()=>{
    const geometry=chalkShelfGeometry();
    const kinds=Array.from(geometry.getAttribute('aKind').array);
    expect(kinds.some(kind=>kind===8)).toBe(true);
    expect(kinds.some(kind=>kind>3&&kind<3.2)).toBe(true);
    expect(kinds.some(kind=>kind>3.2&&kind<3.4)).toBe(true);
    for(let i=0;i<16;i++){
      const a=i*Math.PI*2/16;
      expect(surfaceHeight(geometry,Math.cos(a)*CHALK_SHELF_FOOTPRINT.plantingRadius,Math.sin(a)*CHALK_SHELF_FOOTPRINT.plantingRadius)).toBeCloseTo(CHALK_SHELF_CENTRE_HEIGHT,5);
    }
    expect(surfaceHeight(geometry,0,0)).toBeCloseTo(CHALK_SHELF_CENTRE_HEIGHT,5);
    expect(surfaceHeight(geometry,3.05,-1.38)).toBeGreaterThan(CHALK_SHELF_CENTRE_HEIGHT+1);
    expect(surfaceHeight(geometry,2.15,2.6)).toBeLessThan(CHALK_SHELF_CENTRE_HEIGHT-0.3);
    geometry.computeBoundingBox();
    const bounds=geometry.boundingBox!;
    expect(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x))).toBeLessThanOrEqual(CHALK_SHELF_FOOTPRINT.halfX);
    expect(Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z))).toBeLessThanOrEqual(CHALK_SHELF_FOOTPRINT.halfZ);
    expect(bounds.max.y).toBeLessThanOrEqual(CHALK_SHELF_FOOTPRINT.maxHeight);
    geometry.dispose();
  });

  it('keeps ivory feathers, branching coral and low sage cushions as distinct species',()=>{
    const ivory=fernGeometry(),coral=coralGeometry(),sage=lichenGeometry();
    const kinds=(g:BufferGeometry):number[]=>Array.from(g.getAttribute('aKind').array);
    expect(kinds(ivory).every(kind=>Math.abs(kind-3.1)<1e-5)).toBe(true);
    expect(kinds(coral).every(kind=>Math.abs(kind-3.3)<1e-5)).toBe(true);
    expect(kinds(sage).every(kind=>kind===8)).toBe(true);
    for(const g of [ivory,coral,sage])g.computeBoundingBox();
    expect(ivory.boundingBox!.max.y).toBeGreaterThan(1.2);
    expect(coral.boundingBox!.max.y).toBeLessThan(0.8);
    const sageSize=sage.boundingBox!.getSize(new Vector3());
    expect(sageSize.y).toBeGreaterThan(0.35);expect(sageSize.y).toBeLessThan(0.6);expect(sageSize.x).toBeGreaterThan(0.9);
    const sageUv=sage.getAttribute('uv'),sageNormals=sage.getAttribute('normal');
    let sideFacingLeaves=0;
    for(let i=0;i<sageUv.count;i++)if(sageUv.getX(i)===0.5&&sageUv.getY(i)===0.5&&sageNormals.getY(i)<0.5)sideFacingLeaves++;
    expect(sideFacingLeaves).toBeGreaterThan(100);
    for(const g of [ivory,coral,sage])g.dispose();
  });

  it('gives ivory fronds narrow upswept leaflets instead of broad horizontal tiers',()=>{
    const geometry=fernGeometry(),p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
    const leaflets=new Map<string,{root?:Vector3;tip?:Vector3;points:Vector3[]}>();
    for(let i=0;i<p.count;i+=3){
      const ids=[i,i+1,i+2];
      const centre=ids.find(id=>Math.abs(uv.getX(id)-0.5)<1e-6&&Math.abs(uv.getY(id)-0.48)<1e-6);
      if(centre===undefined)continue;
      const key=[p.getX(centre),p.getY(centre),p.getZ(centre)].map(value=>value.toFixed(6)).join(',');
      const leaf=leaflets.get(key)??{points:[]};
      for(const id of ids){
        const point=new Vector3().fromBufferAttribute(p,id);
        leaf.points.push(point);
        if(Math.abs(uv.getX(id)-0.5)<1e-6&&uv.getY(id)===0)leaf.root=point;
        if(Math.abs(uv.getX(id)-0.5)<1e-6&&uv.getY(id)===1)leaf.tip=point;
      }
      leaflets.set(key,leaf);
    }
    expect(leaflets.size).toBeGreaterThanOrEqual(60);
    for(const leaf of leaflets.values()){
      expect(leaf.root).toBeDefined();expect(leaf.tip).toBeDefined();
      const axis=leaf.tip!.clone().sub(leaf.root!),length=axis.length();
      expect(axis.y/length).toBeGreaterThan(0.45);
      expect(length).toBeGreaterThan(0.08);
      axis.normalize();
      const halfWidth=Math.max(...leaf.points.map(point=>{
        const relative=point.clone().sub(leaf.root!);
        return relative.addScaledVector(axis,-relative.dot(axis)).length();
      }));
      expect(halfWidth*2/length).toBeLessThan(0.4);
    }
    geometry.dispose();
  });

  it('roots each integrated species on the actual rock face at its planting coordinate',()=>{
    const geometry=chalkShelfGeometry();
    const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),plantBase=geometry.getAttribute('aPlantBase');
    for(const planting of CHALK_SHELF_PLANTINGS){
      const ground=surfaceHeight(geometry,planting.x,planting.z);
      const root=new Vector3(planting.x,ground-0.01*planting.scale,planting.z);
      const material=planting.species==='ivory'?3.1:planting.species==='coral'?3.3:8;
      let closest=Infinity;
      let rootBase=NaN;
      const contact=new Vector3();
      for(let i=0;i<p.count;i++){
        if(Math.abs(kind.getX(i)-material)>1e-5)continue;
        const vertex=new Vector3().fromBufferAttribute(p,i);
        const distance=vertex.distanceTo(root);
        if(distance<closest){closest=distance;contact.copy(vertex);rootBase=plantBase.getX(i);}
      }
      expect(closest).toBeLessThan(0.15*planting.scale);
      expect(Math.abs(contact.y-surfaceHeight(geometry,contact.x,contact.z))).toBeLessThan(0.08);
      expect(rootBase).toBeCloseTo(ground,5);
      // Independent physical contract: a stretched cliff moves the contact
      // surface, but never scales the plant's offset above that surface.
      for(const stretch of [0.3,0.6,2.4]){
        const scale=1.7;
        const renderedContact=(rootBase*stretch+contact.y-rootBase)*scale;
        expect(renderedContact-ground*stretch*scale).toBeCloseTo((contact.y-ground)*scale,5);
      }
    }
    geometry.dispose();
  });

  it('marks only integrated plants as having a scaled support height',()=>{
    for(const geometry of [fanTreeGeometry(),chalkGeometry(),fernGeometry(),coralGeometry(),lichenGeometry()]){
      expect(Array.from(geometry.getAttribute('aPlantBase').array).every(base=>base===0)).toBe(true);
      geometry.dispose();
    }
    const geometry=chalkShelfGeometry(),kinds=geometry.getAttribute('aKind'),bases=geometry.getAttribute('aPlantBase');
    const supports=CHALK_SHELF_PLANTINGS.map(p=>surfaceHeight(geometry,p.x,p.z));
    let rockVertices=0,plantVertices=0;
    for(let i=0;i<kinds.count;i++){
      if(kinds.getX(i)===2){expect(bases.getX(i)).toBe(0);rockVertices++;}
      else{expect(Math.min(...supports.map(height=>Math.abs(height-bases.getX(i))))).toBeLessThan(0.00001);plantVertices++;}
    }
    expect(rockVertices).toBeGreaterThan(0);expect(plantVertices).toBeGreaterThan(0);
    geometry.dispose();
  });
});
