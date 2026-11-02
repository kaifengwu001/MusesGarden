import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { COTTAGE_FOOTPRINT, COTTAGE_PERIMETER, cottageContains, cottageLocalDirection, cottageLocalGround, cottageSite } from '../planet/cottageSite';
import { RICE_RADIUS, RICE_STEP, sampleRiceField } from '../planet/riceFields';

describe('Ti Tian cottage support and clearing',()=>{
  it('finds dry concave pockets with a near-grade gate and an upright local frame',()=>{
    for(const seed of [1,412,771,2026]){
      const site=cottageSite(seed);
      expect(site.direction.length()).toBeCloseTo(1,10);
      expect(site.right.length()).toBeCloseTo(1,10);
      expect(site.forward.length()).toBeCloseTo(1,10);
      expect(site.right.clone().cross(site.direction).dot(site.forward)).toBeGreaterThan(.999999);
      expect(Math.abs(site.direction.dot(site.right))).toBeLessThan(1e-10);
      expect(site.wetFraction).toBe(0);
      expect(site.maxGround-site.minGround).toBeLessThan(2.5);
      expect(site.floorRadius).toBeGreaterThan(site.maxGround+.12);
      expect(site.floorRadius-site.maxGround).toBeLessThan(.2);
      expect(site.gateClearance).toBeLessThan(.45);
      expect(site.flankRise).toBeGreaterThan(.5);
      expect(site.minFlankRise).toBeGreaterThan(.4);
      expect(site.backRise).toBeGreaterThan(0);
      for(const rect of COTTAGE_FOOTPRINT)for(let i=0;i<=6;i++)for(let j=0;j<=6;j++){
        const x=rect.x0+(rect.x1-rect.x0)*i/6,z=rect.z0+(rect.z1-rect.z0)*j/6;
        const y=cottageLocalGround(site,x,z,seed);
        expect(y).toBeLessThan(-.12);
        expect(y).toBeGreaterThan(-2.8);
        // Reconstruct the vertical column independently and check its
        // radial terrain contact, not merely the sampled helper's metadata.
        const point=site.direction.clone().multiplyScalar(site.floorRadius+y)
          .addScaledVector(site.right,x).addScaledVector(site.forward,z);
        const atPoint=sampleRiceField(point.clone().normalize(),seed);
        expect(atPoint.wet).toBe(false);
        const radialError=Math.abs(point.length()-RICE_RADIUS-atPoint.surfaceHeight);
        if(radialError<1e-6){
          expect(point.length()).toBeCloseTo(RICE_RADIUS+atPoint.surfaceHeight,6);
        }else{
          // A rigid vertical column can meet a radial terrace riser, with
          // no self-consistent horizontal tread at all. Require the exact
          // contour and the actual wall's bounded vertical interval.
          const edge=Math.round(atPoint.smoothHeight/RICE_STEP);
          expect(Math.abs(atPoint.smoothHeight/RICE_STEP-edge)).toBeLessThan(1e-8);
          expect(point.length()).toBeGreaterThanOrEqual(RICE_RADIUS+(edge-1)*RICE_STEP-1e-7);
          expect(point.length()).toBeLessThanOrEqual(RICE_RADIUS+edge*RICE_STEP+1e-7);
        }
        const above=point.clone().addScaledVector(site.direction,1e-5);
        const below=point.clone().addScaledVector(site.direction,-1e-5);
        expect(above.length()-RICE_RADIUS-sampleRiceField(above.clone().normalize(),seed).surfaceHeight).toBeGreaterThanOrEqual(-1e-8);
        expect(below.length()-RICE_RADIUS-sampleRiceField(below.clone().normalize(),seed).surfaceHeight).toBeLessThanOrEqual(1e-8);
      }
      for(const x of [1.1,2,2.9])expect(-cottageLocalGround(site,x,6.68,seed)).toBeLessThan(.45);
    }
  });

  it('reserves only the compact building and yard, without an exterior paving ring or stairs',()=>{
    const site=cottageSite(412);
    for(const [x,z] of [...COTTAGE_PERIMETER,[0,0],[2,6.68]]){
      expect(cottageContains(site,cottageLocalDirection(site,x,z))).toBe(true);
    }
    for(const [x,z] of [[-7,0],[6,0],[0,-6],[6,12],[2,8],[-6,-4],[5,-4]]){
      expect(cottageContains(site,cottageLocalDirection(site,x,z))).toBe(false);
    }
    const nearWall=cottageLocalDirection(site,6.2,3);
    expect(cottageContains(site,nearWall)).toBe(false);
    expect(cottageContains(site,nearWall,1.5)).toBe(true);
    expect(cottageContains(site,site.direction.clone().negate(),20)).toBe(false);
  });

  it('repeats independently of another seed and caller mutation',()=>{
    const first=cottageSite(412),independent=cottageSite(771);
    expect(cottageSite(412)).toEqual(first);
    expect(independent.direction.distanceTo(first.direction)).toBeGreaterThan(.05);
    first.direction.copy(new Vector3(0,1,0));first.right.set(0,0,0);
    const repeat=cottageSite(412);
    expect(repeat.direction.y).not.toBe(1);
    expect(repeat.right.length()).toBeCloseTo(1,10);
  });
});
