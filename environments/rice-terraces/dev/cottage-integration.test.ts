import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3, type Box3, type Mesh } from 'three';
import { createHuiCottage } from '../life/huiCottage';
import { generateFarmLife } from '../life/farmLife';
import { cottageContains } from '../planet/cottageSite';
import { COTTAGE_PAVING } from '../planet/cottagePaving';
import { cottageGradedLocalGround, cottageGroundRadius } from '../planet/cottageGround';
import { createRiceLandscape } from '../planet/riceLandscape';

// (filling the terrain under the cottage is slow by design: about 5 s, more on a busy machine)
describe('Hui cottage terrain integration',{timeout:30_000},()=>{
  it('sets the compact paving flush above the filled terrain without a tall plinth',()=>{
    const home=createHuiCottage(412),terrain=createRiceLandscape(412,96,home.site);
    try{
      home.group.updateMatrixWorld(true);terrain.group.updateMatrixWorld(true);
      const ray=new Raycaster(),origin=home.group.position.clone();
      for(const rect of COTTAGE_PAVING)for(const x of [rect.x0+.02,(rect.x0+rect.x1)/2,rect.x1-.02])for(const z of [rect.z0+.02,(rect.z0+rect.z1)/2,rect.z1-.02]){
        const start=home.group.localToWorld(new Vector3(x,20,z));
        ray.set(start,home.site.direction.clone().negate());
        const hits=ray.intersectObjects(terrain.group.children,false);
        expect(hits.length).toBeGreaterThan(0);
        const ground=hits[0].point.clone().sub(origin).dot(home.site.direction);
        expect(ground).toBeLessThan(-.015);expect(ground).toBeGreaterThan(-.075);
      }
    }finally{home.dispose();terrain.dispose();}
  });

  it('reserves crown and tuft clearance for the house, courtyard and entrance',()=>{
    const home=createHuiCottage(412);
    try{
      const life=generateFarmLife(412,(direction,margin)=>cottageContains(home.site,direction,margin),home.site);
      expect(life.trees.length).toBeGreaterThan(100);expect(life.riceTufts.length).toBeGreaterThan(1000);
      expect(life.trees.every(tree=>!cottageContains(home.site,tree.direction,3))).toBe(true);
      expect(life.riceTufts.every(tuft=>!cottageContains(home.site,tuft.direction,.5))).toBe(true);
    }finally{home.dispose();}
  });

  it('removes the paved perimeter and staircase while leaving distant terrain alone',()=>{
    const home=createHuiCottage(412);
    try{
      const foundation=home.group.children[0] as Mesh;
      foundation.geometry.computeBoundingBox();
      const bounds=foundation.geometry.boundingBox as Box3;
      expect(bounds.min.x).toBeGreaterThan(-6.96);expect(bounds.max.x).toBeLessThan(5.77);
      expect(bounds.min.z).toBeGreaterThan(-5.51);expect(bounds.max.z).toBeLessThan(7.09);
      expect(home.stats.pavingFootprint).toBeLessThan(150);expect(home.stats.stairs).toBe(0);
      for(const [x,z] of [[2,7.08],[2,7.3],[-6.95,3],[4.98,-3]]){
        expect(cottageGradedLocalGround(home.site,x,z,412)).toBeCloseTo(-.04,6);
      }
      for(const direction of [home.site.direction.clone().negate(),home.site.right,home.site.forward]){
        expect(cottageGroundRadius(direction,141.2,home.site)).toBe(141.2);
      }
    }finally{home.dispose();}
  });
});
