import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Terrain, generateLayout } from '../planet/terrain';
import { chalkShelfGeometry } from './canyonGeometry';
import { canyonGroundedHeight } from './canyonGround';

describe('Canyon cliff feet', () => {
  it('extends exposed base corners into the real ground at different planet sizes without moving caps', () => {
    const geometry = chalkShelfGeometry();
    const positions = geometry.getAttribute('position'), kinds = geometry.getAttribute('aKind');
    const terrain = new Terrain(generateLayout(412));
    const home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const right = new Vector3().crossVectors(home, forward).normalize();
    let largestOriginalGap = 0;
    for (const radius of [40,128,400]) {
      terrain.update(radius,{roll:3.6,hummocks:0.16,wetlands:0,waterLevel:0,grain:0.45,density:0.08,patchiness:0.78,patchSize:13,weights:[0.4,0.24,0.22,0.14]},0.5);
      for (const [x,z,scale,turn,heightScale] of [[23,-1,1.7,-0.35,0.65*0.42],[24,14,1.5,-0.2,0.65*0.42],[-31,-16,2.5,0.24,1.6*0.88]]) {
        const distance = Math.hypot(x,z), angle = Math.asin(Math.min(0.95,distance/radius));
        const up = home.clone().multiplyScalar(Math.cos(angle)).addScaledVector(right,x/distance*Math.sin(angle)).addScaledVector(forward,z/distance*Math.sin(angle)).normalize();
        const across = right.clone().addScaledVector(up,-right.dot(up)).normalize();
        const depth = new Vector3().crossVectors(across,up).normalize();
        across.multiplyScalar(Math.cos(turn)).addScaledVector(depth,Math.sin(turn));
        depth.crossVectors(across,up).normalize();
        const anchorHeight = terrain.height(up)-0.08*scale;
        for (let i=0;i<positions.count;i++) {
          const kind = kinds.getX(i), localY = positions.getY(i);
          if (kind!==2) continue;
          const px=positions.getX(i)*scale, py=localY*heightScale*scale, pz=positions.getZ(i)*scale;
          const length=Math.hypot(px,pz), bend=Math.asin(Math.min(length/radius,0.9));
          const dir=up.clone().multiplyScalar(Math.cos(bend));
          if(length>1e-5)dir.addScaledVector(across,px/length*Math.sin(bend)).addScaledVector(depth,pz/length*Math.sin(bend));
          const ground=terrain.height(dir), original=anchorHeight+py;
          const attached=canyonGroundedHeight(original,ground,kind,localY);
          if(localY<=-0.1){
            largestOriginalGap=Math.max(largestOriginalGap,original-ground);
            expect(attached-ground).toBeLessThanOrEqual(-0.17999);
            expect(attached).toBeLessThanOrEqual(original);
          } else expect(attached).toBe(original);
        }
      }
    }
    expect(largestOriginalGap).toBeGreaterThan(4);
    geometry.dispose();
  });

  it('never moves foliage or floating aerial anatomy as a rock skirt', () => {
    for(const kind of [0,1,3,3.1,3.3,8])expect(canyonGroundedHeight(12,0.5,kind,-0.35)).toBe(12);
  });
});
