import { describe, expect, test } from 'vitest';
import { Vector3, type BufferGeometry } from 'three';
import { coralGeometry, seedSailGeometry } from '../life/windGeometry';

function topology(geometry: BufferGeometry): { openEdges: number; components: number; degenerate: number } {
  const position = geometry.getAttribute('position');
  const vertices = new Map<string, number>();
  const adjacency: Set<number>[] = [];
  const edges = new Map<string, number>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let degenerate = 0;
  const id = (index: number): number => {
    const key = [position.getX(index),position.getY(index),position.getZ(index)].map(v=>Math.round(v*1e6)).join(',');
    let value = vertices.get(key);
    if (value === undefined) { value=vertices.size;vertices.set(key,value);adjacency.push(new Set()); }
    return value;
  };
  for (let i=0;i<position.count;i+=3) {
    a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-22) degenerate++;
    const triangle=[id(i),id(i+1),id(i+2)];
    for (let j=0;j<3;j++) {
      const from=triangle[j],to=triangle[(j+1)%3];
      const edge=from<to?`${from}:${to}`:`${to}:${from}`;
      edges.set(edge,(edges.get(edge)??0)+1);
      adjacency[from].add(to);adjacency[to].add(from);
    }
  }
  const visited = new Set<number>();
  let components = 0;
  for (let start=0;start<adjacency.length;start++) {
    if (visited.has(start)) continue;
    components++;
    const pending=[start];visited.add(start);
    while (pending.length) {
      for (const next of adjacency[pending.pop()!]) if (!visited.has(next)) {visited.add(next);pending.push(next);}
    }
  }
  return {openEdges:[...edges.values()].filter(count=>count!==2).length,components,degenerate};
}

/** Front-projected coverage protects the open spaces between branches. */
function projectedCoverage(geometry: BufferGeometry): number {
  geometry.computeBoundingBox();
  const bounds=geometry.boundingBox!,p=geometry.getAttribute('position');
  const size=64,pixels=new Set<number>();
  const xy=(i:number):readonly [number,number]=>[(p.getX(i)-bounds.min.x)/(bounds.max.x-bounds.min.x)*size,(p.getY(i)-bounds.min.y)/(bounds.max.y-bounds.min.y)*size];
  for (let i=0;i<p.count;i+=3) {
    const [a,b,c]=[xy(i),xy(i+1),xy(i+2)];
    const side=(point:readonly [number,number],from:readonly [number,number],to:readonly [number,number]):number=>(point[0]-from[0])*(to[1]-from[1])-(point[1]-from[1])*(to[0]-from[0]);
    const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(size-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(size-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
      const q:readonly [number,number]=[x+.5,y+.5];
      const d=[side(q,a,b),side(q,b,c),side(q,c,a)];
      if (d.every(v=>v>=0)||d.every(v=>v<=0))pixels.add(x+y*size);
    }
  }
  return pixels.size/(size*size);
}

/** Sum the visible sheet area from horizontal camera directions. This catches
 * every leaf sharing one nearly edge-on plane without depending on a view. */
function sheetAreaByAzimuth(geometry: BufferGeometry, kind: number): number[] {
  const p=geometry.getAttribute('position'),k=geometry.getAttribute('aKind');
  const areas=Array.from({length:12},()=>0),a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(let i=0;i<p.count;i+=3) {
    if(k.getX(i)!==kind)continue;
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    const area=b.sub(a).cross(c.sub(a)).multiplyScalar(.5);
    for(let angle=0;angle<areas.length;angle++) {
      const t=angle*Math.PI*2/areas.length;
      areas[angle]+=Math.abs(area.x*Math.cos(t)+area.z*Math.sin(t));
    }
  }
  return areas;
}

describe('native windfield plants',()=>{
  test.each([0,1,2])('coral %i has one closed joined surface, blunt ends and restrained depth',variant=>{
    const geometry=coralGeometry(variant),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
    expect(topology(geometry)).toEqual({openEdges:0,components:1,degenerate:0});
    expect(p.count/3).toBeLessThanOrEqual(3500);
    const size=geometry.boundingBox!.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(.10);
    expect(size.z).toBeLessThan(size.x*.22);
    expect(Math.abs(geometry.boundingBox!.min.y)).toBeLessThan(.005);
    expect(projectedCoverage(geometry)).toBeLessThan(.43);
    for(let i=0;i<n.count;i++)expect(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))).toBeCloseTo(1,4);
    expect([...geometry.getAttribute('aKind').array].every(kind=>kind===3)).toBe(true);
    geometry.dispose();
  });

  test('the three coral habits retain different spread-to-height proportions',()=>{
    const geometries=[0,1,2].map(coralGeometry);
    const ratios=geometries.map(g=>{const size=g.boundingBox!.getSize(new Vector3());return size.x/size.y;});
    expect(ratios[0]).toBeGreaterThan(1.2);
    expect(ratios[0]).toBeLessThan(1.5);
    expect(ratios[1]).toBeLessThan(.9);
    expect(ratios[2]).toBeGreaterThan(1.8);
    geometries.forEach(g=>g.dispose());
  });

  test.each([0,1,2])('sail %i has finite thin blades and stays within its placement envelope',variant=>{
    const geometry=seedSailGeometry(variant);
    geometry.computeBoundingBox();
    const bounds=geometry.boundingBox!,size=bounds.getSize(new Vector3());
    expect(size.y).toBeGreaterThan(3.8);
    expect(size.y).toBeLessThan(4.4);
    expect(size.x).toBeLessThan(2.1);
    expect(geometry.getAttribute('position').count/3).toBeLessThan(1000);
    for(const attribute of Object.values(geometry.attributes))expect([...attribute.array].every(Number.isFinite)).toBe(true);
    expect(topology(geometry).degenerate).toBe(0);
    const projected=sheetAreaByAzimuth(geometry,1);
    expect(Math.min(...projected)/Math.max(...projected)).toBeGreaterThan(.28);
    const kinds=new Set(geometry.getAttribute('aKind').array);
    expect(kinds).toEqual(new Set([0,1]));
    geometry.dispose();
  });
});
