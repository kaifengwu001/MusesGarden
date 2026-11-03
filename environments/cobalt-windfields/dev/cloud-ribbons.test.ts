import { expect, test } from 'vitest';
import { cloudRibbonGeometry, WindCloudRibbons } from '../life/windCloudRibbons';
import { defaultParams, schema } from '../params';

// the slider's lowest and its default, at R 128; the shell grows as √R
const HEIGHTS=[schema.clouds.cirrusHeight.min,defaultParams().clouds.cirrusHeight];

test('cirrus lies on a spherical shell, spans the globe and has tapered finite ends',()=>{
  const geometry=cloudRibbonGeometry(412),repeat=cloudRibbonGeometry(412),other=cloudRibbonGeometry(413);
  try {
    const p=geometry.getAttribute('position');
    expect(p.array).toEqual(repeat.getAttribute('position').array);
    expect(p.array).not.toEqual(other.getAttribute('position').array);
    for(let i=0;i<p.count;i++)expect(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))).toBeCloseTo(1,6);
    geometry.computeBoundingBox();
    const b=geometry.boundingBox!;
    for(const axis of ['x','y','z'] as const) {expect(b.min[axis]).toBeLessThan(-.8);expect(b.max[axis]).toBeGreaterThan(.8);}
    const uv=geometry.getAttribute('uv');
    for(let end=0;end<p.count;end++) {
      if((uv.getX(end)===0||uv.getX(end)===1)&&uv.getY(end)<1) {
        const gap=Math.hypot(p.getX(end)-p.getX(end+1),p.getY(end)-p.getY(end+1),p.getZ(end)-p.getZ(end+1));
        expect(gap).toBeLessThan(1e-6);
      }
    }
    expect(geometry.index!.count/3).toBeLessThan(4000);
  } finally {geometry.dispose();repeat.dispose();other.dispose();}
});

test('triangle interiors follow the shell instead of cutting through the planet',()=>{
  for(const seed of [412,413,5]) {
    const geometry=cloudRibbonGeometry(seed);
    try {
      const p=geometry.getAttribute('position'),index=geometry.index!;
      let lowest=Infinity;
      for(let i=0;i<index.count;i+=3) {
        const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
        // Vertices on a sphere alone are insufficient: the rendered face is
        // planar. Probe each edge midpoint and its interior independently.
        for(const weights of [[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]]) {
          lowest=Math.min(lowest,Math.hypot(
            p.getX(a)*weights[0]+p.getX(b)*weights[1]+p.getX(c)*weights[2],
            p.getY(a)*weights[0]+p.getY(b)*weights[1]+p.getY(c)*weights[2],
            p.getZ(a)*weights[0]+p.getZ(b)*weights[1]+p.getZ(c)*weights[2]));
        }
      }
      expect(lowest).toBeGreaterThan(.995);
      for(const planetRadius of [40,128,400]) for(const height of HEIGHTS) {
        const lift=height*Math.sqrt(planetRadius/128);
        expect(lowest*(planetRadius+lift)-planetRadius).toBeGreaterThan(lift/2);
      }
    } finally {geometry.dispose();}
  }
});

test('orbit reveals physical cirrus while ground views stay clear through growth',()=>{
  const ribbons=new WindCloudRibbons({});
  try {
    for(const radius of [40,128,400]) {
      const lift=defaultParams().clouds.cirrusHeight*Math.sqrt(radius/128);
      ribbons.update(412,lift,12,4);expect(ribbons.mesh.visible).toBe(false);
      const geometry=ribbons.mesh.geometry;
      ribbons.update(412,lift,24,radius*4.2);
      expect(ribbons.mesh.visible).toBe(true);
      expect(ribbons.mesh.geometry).toBe(geometry);
      expect(ribbons.mesh.material.depthTest).toBe(true);
      expect(ribbons.mesh.material.depthWrite).toBe(false);
    }
  } finally {ribbons.dispose();}
});
