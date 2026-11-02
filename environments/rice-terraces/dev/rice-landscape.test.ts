import { afterAll, describe, expect, it } from 'vitest';
import { Raycaster, Vector3, type Mesh, type BufferGeometry } from 'three';
import { createRiceLandscape } from '../planet/riceLandscape';
import { RICE_RADIUS, RICE_STEP, sampleRiceField } from '../planet/riceFields';

function directions(count:number):Vector3[]{
  return Array.from({length:count},(_,i)=>{
    const y=1-2*(i+.5)/count,a=i*2.3999632297;
    return new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
  });
}

describe('Ti Tian spherical terraces',()=>{
  it('keeps independent flooded, planted and wooded plots, with deterministic bounded levels',()=>{
    const points=directions(1024);
    const fields=points.map(direction=>sampleRiceField(direction,412));
    const water=fields.filter(field=>field.wet).length,wood=fields.filter(field=>field.forest).length;
    expect(water).toBeGreaterThan(points.length*.15);
    expect(water).toBeLessThan(points.length*.65);
    expect(wood).toBeGreaterThan(points.length*.025);
    expect(wood).toBeLessThan(points.length*.35);
    expect(fields.every(field=>!field.forest||!field.wet)).toBe(true);
    for(const field of fields){
      expect(field.surfaceHeight).toBe(field.band*RICE_STEP);
      expect(field.smoothHeight).toBeGreaterThanOrEqual(2.4);
      expect(field.smoothHeight).toBeLessThanOrEqual(27.5);
      expect(field.smoothHeight-field.surfaceHeight).toBeLessThan(RICE_STEP+1e-10);
    }
    points.map(direction=>sampleRiceField(direction,771));
    expect(points.map(direction=>sampleRiceField(direction,412))).toEqual(fields);
    expect(points.map(direction=>sampleRiceField(direction,771))).not.toEqual(fields);
  });

  const landscape=createRiceLandscape(412,12);
  afterAll(()=>landscape.dispose());

  it('constructs real horizontal treads and separate narrow bank/riser geometry',()=>{
    const meshes=landscape.group.children as Mesh<BufferGeometry>[];
    expect(meshes).toHaveLength(3);
    expect(landscape.stats.plots).toBeGreaterThan(100);
    expect(landscape.stats.terraceLevels).toBeGreaterThan(10);
    expect(landscape.stats.triangles).toBeLessThan(1_200_000);
    expect(landscape.stats.waterTriangles).toBeGreaterThan(100);
    expect(landscape.stats.landTriangles).toBeGreaterThan(100);
    expect(landscape.stats.bankTriangles).toBeGreaterThan(100);
    const p=new Vector3(),n=new Vector3(),a=new Vector3(),b=new Vector3(),c=new Vector3();
    for(const mesh of meshes){
      const positions=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.boundingSphere!.radius).toBeLessThan(160);
      for(let i=0;i<positions.count;i+=3){
        a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);
        if(mesh===meshes[2])continue;
        expect(Math.max(a.length(),b.length(),c.length())-Math.min(a.length(),b.length(),c.length())).toBeLessThan(0.00004);
        const band=(a.length()-RICE_RADIUS)/RICE_STEP;
        expect(Math.abs(band-Math.round(band))).toBeLessThan(0.00003);
        p.copy(a).normalize();n.fromBufferAttribute(normals,i);
        expect(p.dot(n)).toBeGreaterThan(.9999);
        expect(new Vector3().crossVectors(b.sub(a),c.sub(a)).dot(p)).toBeGreaterThanOrEqual(-1e-8);
      }
    }
  });

  it('covers radial samples and all cube-face seams without open holes',()=>{
    landscape.group.updateMatrixWorld(true);
    const seamPoints=[-1,-.5,0,.5,1].flatMap(t=>[
      new Vector3(1,1,t),new Vector3(1,-1,t),new Vector3(-1,1,t),new Vector3(-1,-1,t),
      new Vector3(t,1,1),new Vector3(t,-1,1),new Vector3(t,1,-1),new Vector3(t,-1,-1),
      new Vector3(1,t,1),new Vector3(-1,t,1),new Vector3(1,t,-1),new Vector3(-1,t,-1),
    ]).map(v=>v.normalize());
    const ray=new Raycaster();
    for(const direction of [...directions(40),...seamPoints]){
      ray.set(direction.clone().multiplyScalar(180),direction.clone().negate());
      const hits=ray.intersectObjects(landscape.group.children,false);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].point.length()).toBeGreaterThan(RICE_RADIUS+1);
      expect(hits[0].point.length()).toBeLessThan(RICE_RADIUS+28);
    }
  });
});
