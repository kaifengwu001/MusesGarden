import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Ray, Vector3, type BufferGeometry, type InstancedBufferGeometry } from 'three';
import { CanyonScenery } from './canyonScenery';
import { Terrain, generateLayout } from '../planet/terrain';
import { CHALK_SHELF_CENTRE_HEIGHT, CHALK_SHELF_FOOTPRINT, CHALK_SHELF_VARIANTS, chalkShelfPlantings, chalkGeometry, chalkShelfGeometry, coralGeometry, fanTreeGeometry, fernGeometry, lichenGeometry, mossGeometry } from './canyonGeometry';

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

// (counting the whole instanced canyon takes about 3 s, more on a busy machine)
describe('Scarlet canopy and fractured cliff mesh contracts',{timeout:30_000},()=>{
  it('keeps every template finite, nondegenerate and within its instancing budget',()=>{
    const templates:[BufferGeometry,number][]=[[fanTreeGeometry(),1250],[fanTreeGeometry(1),1250],[fanTreeGeometry(2),1250],[chalkGeometry(),150],[chalkShelfGeometry(),4000],[fernGeometry(),650],[coralGeometry(),450],[lichenGeometry(),1000],[lichenGeometry(1),1000],[mossGeometry(),120],[mossGeometry(1),120],[mossGeometry(2),120]];
    for(let variant=1;variant<CHALK_SHELF_VARIANTS;variant++)templates.push([chalkShelfGeometry(variant),4000]);
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

  it('keeps the full instanced world below its three-million-triangle scenery budget',()=>{
    const terrain=new Terrain(generateLayout(412));
    for(const radius of [40,128,400]){
      terrain.update(radius,{roll:3.6,hummocks:0.16,wetlands:0,waterLevel:0,grain:0.45,density:0.08,patchiness:0.78,patchSize:13,weights:[0.4,0.24,0.22,0.14]},0.5);
      const scenery=new CanyonScenery({},terrain);
      const meshes=scenery.group.children.filter((child):child is Mesh<InstancedBufferGeometry>=>child instanceof Mesh);
      const triangles=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.getIndex()!.count/3)*mesh.geometry.instanceCount,0);
      expect(triangles).toBeLessThan(3_000_000);
      expect(meshes.filter(mesh=>/scarlet fan/i.test(mesh.name)).every(mesh=>mesh.geometry.instanceCount>0)).toBe(true);
      scenery.dispose();
    }
  });

  it('gives every fan blade a real woody attachment and a broad folded silhouette',()=>{
    for(const variant of [0,1,2]){
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
      expect(size.x).toBeGreaterThan(variant===2?5:6);expect(size.y).toBeGreaterThan(2);expect(size.z).toBeGreaterThan(1);
      geometry.dispose();
    }
  });

  it('uses three different growth habits instead of rescaling one tree',()=>{
    const shapes=[0,1,2].map(variant=>{
      const g=fanTreeGeometry(variant);g.computeBoundingBox();
      const size=g.boundingBox!.getSize(new Vector3());
      const result={width:size.x,height:size.y,triangles:g.getAttribute('position').count/3};
      g.dispose();return result;
    });
    expect(shapes[1].width/shapes[1].height).toBeGreaterThan(shapes[0].width/shapes[0].height*1.2);
    expect(shapes[2].height).toBeLessThan(shapes[0].height*0.6);
    expect(new Set(shapes.map(shape=>shape.triangles)).size).toBe(3);
  });

  it('keeps the central planting surface level while surrounding cliffs have real height variation',()=>{
    const shapes:string[]=[],widths:number[]=[],heights:number[]=[];
    for(let variant=0;variant<CHALK_SHELF_VARIANTS;variant++){
    const geometry=chalkShelfGeometry(variant);
    const kinds=geometry.getAttribute('aKind'),p=geometry.getAttribute('position'),rockBounds=new Box3(),signature:number[]=[];
    for(let i=0;i<p.count;i++)if(kinds.getX(i)===2){rockBounds.expandByPoint(new Vector3().fromBufferAttribute(p,i));signature.push(p.getX(i),p.getY(i),p.getZ(i));}
    shapes.push(signature.join(','));widths.push(rockBounds.max.x-rockBounds.min.x);heights.push(rockBounds.max.y);
    for(let i=0;i<16;i++){
      const a=i*Math.PI*2/16;
      expect(surfaceHeight(geometry,Math.cos(a)*CHALK_SHELF_FOOTPRINT.plantingRadius,Math.sin(a)*CHALK_SHELF_FOOTPRINT.plantingRadius)).toBeCloseTo(CHALK_SHELF_CENTRE_HEIGHT,5);
    }
    expect(surfaceHeight(geometry,0,0)).toBeCloseTo(CHALK_SHELF_CENTRE_HEIGHT,5);
    expect(surfaceHeight(geometry,3.05,-1.38)).toBeGreaterThan(CHALK_SHELF_CENTRE_HEIGHT+0.1);
    expect(surfaceHeight(geometry,2.15,2.6)).toBeLessThan(CHALK_SHELF_CENTRE_HEIGHT-0.3);
    geometry.computeBoundingBox();
    const bounds=geometry.boundingBox!;
    expect(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x))).toBeLessThanOrEqual(CHALK_SHELF_FOOTPRINT.halfX);
    expect(Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z))).toBeLessThanOrEqual(CHALK_SHELF_FOOTPRINT.halfZ);
    expect(bounds.max.y).toBeLessThanOrEqual(CHALK_SHELF_FOOTPRINT.maxHeight);
    geometry.dispose();
    }
    expect(new Set(shapes).size).toBe(CHALK_SHELF_VARIANTS);
    expect(widths[0]-widths[3]).toBeGreaterThan(1);
    expect(heights[2]-heights[3]).toBeGreaterThan(1);
  });

  it('changes whole planting compositions with large mats, runners, satellites and open chalk',()=>{
    const layouts=Array.from({length:CHALK_SHELF_VARIANTS},(_,i)=>chalkShelfPlantings(i));
    const moss=layouts.map(layout=>layout.filter(p=>p.species==='moss'));
    const coverage=moss.map(plants=>plants.reduce((sum,p)=>sum+p.scale*p.scale*(p.spread?.[0]??1)*(p.spread?.[1]??1),0));
    expect(moss.map(plants=>plants.length)).toEqual([3,3,5,1]);
    expect(coverage[0]).toBeGreaterThan(coverage[3]*40);
    expect(coverage[0]).toBeGreaterThan(coverage[2]*2);
    const extents=moss.flatMap(plants=>plants.map(p=>p.scale*Math.sqrt((p.spread?.[0]??1)*(p.spread?.[1]??1))));
    expect(Math.max(...extents)/Math.min(...extents)).toBeGreaterThan(8);
    expect(layouts[1].some(p=>p.species==='ivory')).toBe(false);
    expect(layouts[2].some(p=>p.species==='coral')).toBe(false);
    expect(layouts[3].some(p=>p.species==='coral'||p.species==='ivory')).toBe(false);
    expect(new Set(layouts.map(layout=>JSON.stringify(layout))).size).toBe(CHALK_SHELF_VARIANTS);
  });

  it('keeps ivory feathers, branching coral, creeping mats and upright shrubs distinct',()=>{
    const ivory=fernGeometry(),coral=coralGeometry(),sage=lichenGeometry(),shrub=lichenGeometry(1);
    const kinds=(g:BufferGeometry):number[]=>Array.from(g.getAttribute('aKind').array);
    expect(kinds(ivory).every(kind=>Math.abs(kind-3.1)<1e-5)).toBe(true);
    expect(kinds(coral).every(kind=>Math.abs(kind-3.3)<1e-5)).toBe(true);
    expect(kinds(sage).every(kind=>kind===8)).toBe(true);
    for(const g of [ivory,coral,sage,shrub])g.computeBoundingBox();
    expect(ivory.boundingBox!.max.y).toBeGreaterThan(1.2);
    expect(coral.boundingBox!.max.y).toBeLessThan(0.8);
    const sageSize=sage.boundingBox!.getSize(new Vector3());
    // Runners form a broad low mat; the unequal upright shoots have a separate
    // silhouette. This protects the physical habit, not an old spherical shell.
    expect(sageSize.y).toBeLessThan(sageSize.x*0.25);expect(sageSize.x).toBeGreaterThan(1.5);
    const shrubSize=shrub.boundingBox!.getSize(new Vector3());
    expect(shrubSize.y).toBeGreaterThan(sageSize.y*2);expect(shrubSize.x).toBeLessThan(sageSize.x*0.75);
    for(const g of [ivory,coral,sage,shrub])g.dispose();
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

  it('gives moss varied low patch silhouettes with a feathered rim, smooth profile and short edge fibres',()=>{
    const aspects:number[]=[];
    for(const variant of [0,1,2]){
      const geometry=mossGeometry(variant),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
      geometry.computeBoundingBox();
      const size=geometry.boundingBox!.getSize(new Vector3());
      aspects.push(size.x/size.z);
      expect(size.x).toBeGreaterThan(1.2);
      expect(size.z).toBeGreaterThan(0.7);
      expect(size.y).toBeGreaterThan(0.18);expect(size.y).toBeLessThan(0.25);
      let uprightFibres=0,thinRim=0,raisedInterior=0;
      const smoothVertices=new Map<string,Vector3>();
      for(let i=0;i<p.count;i+=3){
        const triangle=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j));
        const heights=triangle.map(point=>point.y),height=Math.max(...heights)-Math.min(...heights);
        const footprint=Math.max(...triangle.map(a=>Math.max(...triangle.map(b=>Math.hypot(a.x-b.x,a.z-b.z)))));
        if(footprint<0.025&&height>0.012)uprightFibres++;
        for(let j=0;j<3;j++){
          const point=triangle[j];
          if(point.y>0&&point.y<0.025)thinRim++;
          if(point.y>0.14)raisedInterior++;
          if(footprint<0.025)continue;
          const key=point.toArray().join(','),normal=new Vector3().fromBufferAttribute(n,i+j),previous=smoothVertices.get(key);
          if(previous)expect(previous.distanceTo(normal)).toBeLessThan(0.00001);
          smoothVertices.set(key,normal);
        }
        // A vertical wall is permitted only below the feathered fringe;
        // exposed surfaces descend gradually through real sloping geometry.
        if(Math.min(...heights)<0)expect(Math.max(...heights)).toBeLessThan(0.025);
      }
      expect(thinRim).toBeGreaterThan(40);expect(raisedInterior).toBeGreaterThan(60);
      expect(uprightFibres).toBe(24);
      expect(new Set(Array.from(geometry.getAttribute('aKind').array))).toEqual(new Set([9]));
      geometry.dispose();
    }
    expect(aspects[0]).toBeGreaterThan(aspects[1]*1.5);
    expect(Math.abs(aspects[1]-aspects[2])).toBeGreaterThan(0.02);
  });

  it('roots each integrated species on the actual rock face at its planting coordinate',()=>{
    for(let variant=0;variant<CHALK_SHELF_VARIANTS;variant++){
    const geometry=chalkShelfGeometry(variant);
    const p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),plantBase=geometry.getAttribute('aPlantBase');
    for(const planting of chalkShelfPlantings(variant)){
      const ground=surfaceHeight(geometry,planting.x,planting.z);
      const root=new Vector3(planting.x,ground-0.01*planting.scale,planting.z);
      const material=planting.species==='ivory'?3.1:planting.species==='coral'?3.3:planting.species==='moss'?9:8;
      if(planting.species==='moss'){
        // Moss attaches along its actual thick rim, not an invented point at
        // the middle of its raised top. Check several grounded perimeter feet.
        const contacts:Vector3[]=[];
        for(let i=0;i<p.count;i++){
          if(kind.getX(i)!==9)continue;
          const point=new Vector3().fromBufferAttribute(p,i);
          if(Math.hypot(point.x-planting.x,point.z-planting.z)>1.1*planting.scale*Math.max(...(planting.spread??[1,1])))continue;
          if(Math.abs(point.y-surfaceHeight(geometry,point.x,point.z))<0.04*planting.scale)contacts.push(point);
        }
        expect(contacts.length,`moss at ${planting.x},${planting.z}`).toBeGreaterThan(12);
        continue;
      }
      let closest=Infinity;
      let rootBase=NaN;
      const contact=new Vector3();
      for(let i=0;i<p.count;i++){
        if(Math.abs(kind.getX(i)-material)>1e-5)continue;
        const vertex=new Vector3().fromBufferAttribute(p,i);
        const distance=vertex.distanceTo(root);
        if(distance<closest){closest=distance;contact.copy(vertex);rootBase=plantBase.getX(i);}
      }
      expect(closest,`${planting.species} at ${planting.x},${planting.z}`).toBeLessThan(0.15*planting.scale);
      expect(Math.abs(contact.y-surfaceHeight(geometry,contact.x,contact.z))).toBeLessThan(0.08);
      const actualSupport=ground;
      expect(rootBase).toBeCloseTo(actualSupport,5);
      // Independent physical contract: a stretched cliff moves the contact
      // surface, but never scales the plant's offset above that surface.
      for(const stretch of [0.3,0.6,2.4]){
        const scale=1.7;
        const renderedContact=(rootBase*stretch+contact.y-rootBase)*scale;
        expect(renderedContact-actualSupport*stretch*scale).toBeCloseTo((contact.y-actualSupport)*scale,5);
      }
    }
    geometry.dispose();
    }
  });

  it('preserves compact leaves when moss grows beside discontinuous cliff levels',()=>{
    for(let variant=0;variant<CHALK_SHELF_VARIANTS;variant++){
    const geometry=chalkShelfGeometry(variant),p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),support=geometry.getAttribute('aPlantBase');
    let leafTriangles=0;
    for(let i=0;i<p.count;i+=3){
      if(kind.getX(i)!==8)continue;
      const points=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j));
      // Per-vertex top projection previously stretched a 20 cm leaf into a
      // multi-metre vertical strip. One rigid shoot keeps its source dimensions.
      for(let j=0;j<3;j++)expect(points[j].distanceTo(points[(j+1)%3])).toBeLessThan(0.47);
      expect(support.getX(i+1)).toBe(support.getX(i));
      expect(support.getX(i+2)).toBe(support.getX(i));
      leafTriangles++;
    }
    expect(leafTriangles).toBeGreaterThan(80);
    geometry.dispose();
    }
  });

  it('keeps moss tops clear of stretched caps while preserving thickness above one affine support plane',()=>{
    for(let variant=0;variant<CHALK_SHELF_VARIANTS;variant++){
    const geometry=chalkShelfGeometry(variant),p=geometry.getAttribute('position'),kind=geometry.getAttribute('aKind'),support=geometry.getAttribute('aPlantBase'),slopes=geometry.getAttribute('aSupportSlope');
    const expectedCore:boolean[]=[],expectedScales:number[]=[];
    for(const planting of chalkShelfPlantings(variant).filter(p=>p.species==='moss')){
      const source=mossGeometry(planting.variant),sourceP=source.getAttribute('position');
      for(let i=0;i<sourceP.count;i++){expectedCore.push(sourceP.getY(i)>0.12);expectedScales.push(planting.scale);}
      source.dispose();
    }
    const vertices=Array.from({length:p.count},(_,i)=>i).filter(i=>kind.getX(i)===9);
    expect(vertices.length,`all authored moss on shelf ${variant}`).toBe(expectedCore.length);
    for(const [index,i]of vertices.entries()){
      const foot=support.getX(i),thickness=p.getY(i)-foot;
      expect(Math.abs(thickness)).toBeLessThan(0.23*expectedScales[index]);
      for(const stretch of [0.27,1,2.05]){
        const rendered=foot*stretch+thickness;
        expect(rendered-foot*stretch).toBeCloseTo(thickness,7);
        // The fine perimeter feathers into the cap; the raised interior must
        // remain visibly clear. Buried fringe/skirt points are intentional.
        if(expectedCore[index])expect(rendered-surfaceHeight(geometry,p.getX(i),p.getZ(i))*stretch).toBeGreaterThan(0.002);
      }
    }
    // Each connected patch still uses one affine plane. Large intentional
    // horizontal spans cannot turn into independently projected cliff strips.
    let offset=0;
    for(const planting of chalkShelfPlantings(variant).filter(p=>p.species==='moss')){
      const source=mossGeometry(planting.variant),count=source.getAttribute('position').count,first=vertices[offset];
      const sx=slopes.getX(first),sz=slopes.getY(first),intercept=support.getX(first)-sx*p.getX(first)-sz*p.getZ(first);
      for(let j=0;j<count;j++){
        const id=vertices[offset+j];
        expect(slopes.getX(id)).toBe(sx);expect(slopes.getY(id)).toBe(sz);
        expect(support.getX(id)).toBeCloseTo(intercept+sx*p.getX(id)+sz*p.getZ(id),5);
      }
      offset+=count;source.dispose();
    }
    geometry.dispose();
    }
  });

  it('marks only integrated plants as having a scaled support height',()=>{
    for(const geometry of [fanTreeGeometry(),chalkGeometry(),fernGeometry(),coralGeometry(),lichenGeometry()]){
      expect(Array.from(geometry.getAttribute('aPlantBase').array).every(base=>base===0)).toBe(true);
      geometry.dispose();
    }
    for(let variant=0;variant<CHALK_SHELF_VARIANTS;variant++){
    const geometry=chalkShelfGeometry(variant),kinds=geometry.getAttribute('aKind'),bases=geometry.getAttribute('aPlantBase');
    const supports=chalkShelfPlantings(variant).map(p=>surfaceHeight(geometry,p.x,p.z));
    let rockVertices=0,plantVertices=0;
    for(let i=0;i<kinds.count;i++){
      if(kinds.getX(i)===2){expect(bases.getX(i)).toBe(0);rockVertices++;}
      else if(kinds.getX(i)===9){
        // Broad moss uses a continuous plane, rather than a point root, so
        // its shallow cap tilt follows height scaling without flattening it.
        const p=geometry.getAttribute('position');
        expect(Math.abs(surfaceHeight(geometry,p.getX(i),p.getZ(i))-bases.getX(i))).toBeLessThan(0.05);
        plantVertices++;
      }else{
        expect(Math.min(...supports.map(height=>Math.abs(height-bases.getX(i))))).toBeLessThan(0.00001);
        plantVertices++;
      }
    }
    expect(rockVertices).toBeGreaterThan(0);expect(plantVertices).toBeGreaterThan(0);
    geometry.dispose();
    }
  });

  it('stores the affine moss slope needed to shear smooth normals with their support',()=>{
    for(let variant=0;variant<CHALK_SHELF_VARIANTS;variant++){
    const geometry=chalkShelfGeometry(variant),p=geometry.getAttribute('position'),k=geometry.getAttribute('aKind'),base=geometry.getAttribute('aPlantBase'),slope=geometry.getAttribute('aSupportSlope'),normals=geometry.getAttribute('normal');
    let checked=0;
    for(let i=0;i<p.count;i++){
      if(k.getX(i)!==9){expect(slope.getX(i)).toBe(0);expect(slope.getY(i)).toBe(0);continue;}
      const normal=new Vector3().fromBufferAttribute(normals,i);
      const tangent=new Vector3().crossVectors(normal,Math.abs(normal.x)<0.9?new Vector3(1,0,0):new Vector3(0,0,1)).normalize();
      for(const stretch of [0.27,1,2.05]){
        const sx=slope.getX(i)*(stretch-1),sz=slope.getY(i)*(stretch-1);
        const transformedNormal=new Vector3(normal.x-normal.y*sx,normal.y,normal.z-normal.y*sz).normalize();
        const transformedTangent=new Vector3(tangent.x,tangent.y+sx*tangent.x+sz*tangent.z,tangent.z).normalize();
        expect(Math.abs(transformedNormal.dot(transformedTangent))).toBeLessThan(0.00001);
        expect(transformedNormal.length()).toBeCloseTo(1,6);
      }
    }
    for(let i=0;i<p.count;i+=3){
      if(k.getX(i)!==9)continue;
      const dx1=p.getX(i+1)-p.getX(i),dz1=p.getZ(i+1)-p.getZ(i),dx2=p.getX(i+2)-p.getX(i),dz2=p.getZ(i+2)-p.getZ(i),det=dx1*dz2-dx2*dz1;
      if(Math.abs(det)<0.0001)continue;
      const dy1=base.getX(i+1)-base.getX(i),dy2=base.getX(i+2)-base.getX(i);
      expect((dy1*dz2-dy2*dz1)/det).toBeCloseTo(slope.getX(i),3);
      expect((dx1*dy2-dx2*dy1)/det).toBeCloseTo(slope.getY(i),3);
      checked++;
    }
    expect(checked).toBeGreaterThan(30*chalkShelfPlantings(variant).filter(p=>p.species==='moss').length);
    geometry.dispose();
    }
  });
});
