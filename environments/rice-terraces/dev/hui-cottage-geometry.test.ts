import { describe,expect,it } from 'vitest';
import { Box3,Raycaster,Vector3,type Mesh,type BufferGeometry,type MeshStandardMaterial } from 'three';
import { createHuiCottageGeometry } from '../life/huiCottageGeometry';

describe('Hui cottage geometry',()=>{
  it('has a bounded domestic footprint and merged physical roofs and joinery',()=>{
    const cottage=createHuiCottageGeometry();
    try{
      const bounds=new Box3().setFromObject(cottage.group);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-6.6);expect(bounds.max.x).toBeLessThanOrEqual(5.6);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-5.4);expect(bounds.max.z).toBeLessThanOrEqual(7.2);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.001);expect(bounds.max.y).toBeLessThan(8);
      expect(cottage.stats.triangles).toBeLessThan(35000);expect(cottage.stats.drawCalls).toBeLessThanOrEqual(7);
      expect(cottage.stats.roofTiles).toBeGreaterThan(800);expect(cottage.stats.windows).toBeGreaterThanOrEqual(6);
      for(const child of cottage.group.children){
        const mesh=child as Mesh<BufferGeometry>;
        expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        expect(Array.from(mesh.geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
      }
    }finally{cottage.dispose();}
  });

  it('leaves the courtyard gate open and the main doorway recessed behind the plaster facade',()=>{
    const cottage=createHuiCottageGeometry();
    try{
      cottage.group.updateMatrixWorld(true);
      const ray=new Raycaster(new Vector3(2,1,8),new Vector3(0,0,-1),0,3);
      expect(ray.intersectObjects(cottage.group.children,false)).toHaveLength(0);
      ray.set(new Vector3(.35,1,1.5),new Vector3(0,0,-1));ray.far=2;
      const plaster=cottage.group.children.find(child=>child.name==='Hui cottage plaster')!;
      expect(ray.intersectObject(plaster,false)).toHaveLength(0);
      const timber=cottage.group.children.find(child=>child.name==='Hui cottage timber')!;
      const hits=ray.intersectObject(timber,false);
      expect(hits.length).toBeGreaterThan(0);expect(hits[0].point.z).toBeLessThan(-.05);
    }finally{cottage.dispose();}
  });

  it('releases every owned material and geometry',()=>{
    const cottage=createHuiCottageGeometry();let disposed=0;
    const count=cottage.group.children.length;
    for(const child of cottage.group.children){const mesh=child as Mesh<BufferGeometry,MeshStandardMaterial>;mesh.geometry.addEventListener('dispose',()=>disposed++);mesh.material.addEventListener('dispose',()=>disposed++);}
    cottage.dispose();expect(cottage.group.children).toHaveLength(0);expect(disposed).toBe(count*2);
  });
});
