import { Vector4, type InstancedBufferGeometry, type Mesh } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { makeGeologyPrototypes } from '../life/windGeology';
import { createWindfieldAnchors, WindfieldScenery, type WindfieldAnchor } from '../life/windfieldScenery';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const prototypes = makeGeologyPrototypes();
const params: FieldParams = { roll:2.1,hummocks:.12,wetlands:0,waterLevel:0,grain:.75,density:0,patchiness:.78,patchSize:13,weights:[.4,.24,.22,.14] };
afterAll(() => prototypes.forEach(prototype => { prototype.geometry.dispose();prototype.outline.dispose(); }));

interface FormationMeasurement { count: number; span: number; aspect: number; }

function measureFormation(anchors: WindfieldAnchor[]): FormationMeasurement {
  const points=anchors.map(anchor=>anchor.offset!);
  const cx=points.reduce((sum,p)=>sum+p[0],0)/points.length;
  const cz=points.reduce((sum,p)=>sum+p[1],0)/points.length;
  let xx=0,zz=0,xz=0,span=0;
  for(let i=0;i<points.length;i++) {
    const [x,z]=points[i];
    xx+=(x-cx)**2;zz+=(z-cz)**2;xz+=(x-cx)*(z-cz);
    for(let j=0;j<i;j++)span=Math.max(span,Math.hypot(x-points[j][0],z-points[j][1]));
  }
  const trace=xx+zz,discriminant=Math.sqrt((xx-zz)**2+4*xz*xz);
  return {count:points.length,span,aspect:Math.sqrt((trace+discriminant)/Math.max(1e-8,trace-discriminant))};
}

function globalFormations(rocks: WindfieldAnchor[][]): WindfieldAnchor[][] {
  const groups=new Map<string,WindfieldAnchor[]>();
  for(const anchor of rocks.flat()) {
    if(anchor.local)continue;
    // Formation membership only identifies a group; its shape and extent are
    // measured from the placed rocks, independent of generation recipe labels.
    const key=anchor.formationId??anchor.direction.toArray().join(',');
    const members=groups.get(key)??[];
    members.push(anchor);groups.set(key,members);
  }
  return [...groups.values()];
}

function coralCoverage(scenery: WindfieldScenery): Map<string,number> {
  const coverage=new Map<string,number>();
  for(const object of scenery.group.children) {
    if(!object.name.startsWith('Sheltered coral')&&object.name!=='Distant coral fields')continue;
    const geometry=(object as Mesh<InstancedBufferGeometry>).geometry;
    const anchor=geometry.getAttribute('aAnchor'),placement=geometry.getAttribute('aPlacement'),lod=geometry.getAttribute('aCoralLod');
    for(let i=0;i<geometry.instanceCount;i++) {
      const key=[anchor.getX(i),anchor.getY(i),anchor.getZ(i),anchor.getW(i),placement.getX(i),placement.getY(i),placement.getZ(i)].join(',');
      const value=lod.getX(i),detail=Math.abs(value)-1;
      const weight=Math.abs(value)>.5?(value>0?detail:1-detail):1;
      coverage.set(key,(coverage.get(key)??0)+weight);
    }
  }
  return coverage;
}

describe('Cobalt distribution diversity and distant coverage', () => {
  it.each([412,5,413])('places visibly different rock group sizes, extents and shapes for seed %i', seed => {
    const plan=createWindfieldAnchors(generateLayout(seed),prototypes);
    const formations=globalFormations(plan.rocks);
    const measurements=formations.map(measureFormation);
    const populated=measurements.filter(group=>group.count>=6);
    const small=measurements.filter(group=>group.count<=3);
    const large=measurements.filter(group=>group.count>=18);
    const compact=populated.filter(group=>group.aspect<2);
    const elongated=populated.filter(group=>group.aspect>4);
    const spans=measurements.filter(group=>group.count>1).map(group=>group.span).sort((a,b)=>a-b);
    const bearings=formations.flat().map(anchor=>anchor.turn);
    // Axial dispersion treats a rock facing left/right as the same alignment.
    const axialOrder=Math.hypot(bearings.reduce((sum,angle)=>sum+Math.cos(2*angle),0),bearings.reduce((sum,angle)=>sum+Math.sin(2*angle),0))/bearings.length;
    const headingBins=new Set(bearings.map(angle=>Math.floor(((angle%Math.PI+Math.PI)%Math.PI)/Math.PI*8)));
    const diagnostic=JSON.stringify({seed,groups:measurements.length,small:small.length,large:large.length,compact:compact.length,elongated:elongated.length,count:[Math.min(...measurements.map(group=>group.count)),Math.max(...measurements.map(group=>group.count))],span:[spans[0],spans.at(-1)],spanRatio:spans[Math.floor(spans.length*.9)]/spans[Math.floor(spans.length*.1)],axialOrder,headingBins:headingBins.size});
    expect(small.length,diagnostic).toBeGreaterThanOrEqual(5);
    expect(large.length,diagnostic).toBeGreaterThanOrEqual(5);
    expect(compact.length,diagnostic).toBeGreaterThanOrEqual(5);
    expect(elongated.length,diagnostic).toBeGreaterThanOrEqual(3);
    expect(spans[Math.floor(spans.length*.9)]/spans[Math.floor(spans.length*.1)],diagnostic).toBeGreaterThan(4);
    expect(axialOrder,diagnostic).toBeLessThan(.6);
    expect(headingBins.size,diagnostic).toBeGreaterThanOrEqual(6);
  });

  it('preserves accepted coral coverage through LOD changes and bounds orbit geometry at every planet size', () => {
    const terrain=new Terrain(generateLayout(412));
    terrain.update(128,params,.5);
    const scenery=new WindfieldScenery({uWindVec:{value:new Vector4(1,0,0,.6)}},terrain);
    try {
      for(const radius of [40,128,400]) {
        terrain.update(radius,params,2*radius/512);
        let expectedRoots: string[]|undefined;
        for(const altitude of [4,24,52,80,radius*4.2]) {
          scenery.update(10,terrain,terrain.layout.cottage,altitude);
          const coverage=coralCoverage(scenery),roots=[...coverage.keys()].sort();
          if(!expectedRoots)expectedRoots=roots;
          expect(roots,`radius ${radius}, altitude ${altitude}`).toEqual(expectedRoots);
          expect(roots.length,`radius ${radius}`).toBeGreaterThan(100);
          let worstCoverageError=0;
          for(const value of coverage.values())worstCoverageError=Math.max(worstCoverageError,Math.abs(value-1));
          expect(worstCoverageError,`radius ${radius}, altitude ${altitude}`).toBeLessThan(1e-6);
        }
        const far=scenery.group.children.find(object=>object.name==='Distant coral fields') as Mesh<InstancedBufferGeometry>;
        const triangles=(far.geometry.index?.count??far.geometry.getAttribute('position').count)/3;
        expect(far.geometry.instanceCount).toBe(expectedRoots!.length);
        expect(triangles*far.geometry.instanceCount).toBeLessThan(600_000);
      }
    } finally { scenery.dispose(); }
  },20_000);
});
