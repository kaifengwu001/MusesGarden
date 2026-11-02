import { describe, expect, it } from 'vitest';
import { Ray, Vector3, type BufferGeometry } from 'three';
import { ParamStore } from '../params';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';
import { residentDirection } from './residentLife';
import { BRIDGE, COTTAGE, FACE, FLOOR, ROOF, SIDE, STEPS, TERRACE, bridgeDeckHeight, createHouseGeometry, roofTileHeightAt, walkableHeightAt } from './props';

const a=new Vector3(),b=new Vector3(),c=new Vector3(),point=new Vector3();
function verticalHits(geometry:BufferGeometry,x:number,z:number):number[]{
  const hits:number[]=[];
  const p=geometry.getAttribute('position');
  const ray=new Ray(new Vector3(x,15,z),new Vector3(0,-1,0));
  for(let i=0;i<p.count;i+=3){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    if(b.clone().sub(a).cross(c.clone().sub(a)).y<=0)continue;
    if(ray.intersectTriangle(a,b,c,false,point))hits.push(point.y);
  }
  return hits;
}

/** Inspect every face on a ray, including hidden duplicate planes. */
function rayHits(geometry:BufferGeometry,origin:Vector3,direction:Vector3):Vector3[]{
  const hits:Vector3[]=[],p=geometry.getAttribute('position'),ray=new Ray(origin,direction);
  for(let i=0;i<p.count;i+=3){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    if(ray.intersectTriangle(a,b,c,false,point))hits.push(point.clone());
  }
  return hits;
}

describe('Ukiyo-e home and timber bridge',()=>{
  it('has one walking top per veranda point, with no coincident board caps',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false});
    const wood=geometry.get('wood')!;
    for(let i=0;i<31;i++)for(let j=0;j<13;j++){
      const x=TERRACE.x0+(TERRACE.x1-TERRACE.x0)*(i+0.317)/31;
      const z=TERRACE.z0+(TERRACE.z1-TERRACE.z0)*(j+0.293)/13;
      const hits=verticalHits(wood,x,z).filter(y=>Math.abs(y-FLOOR)<1e-5);
      expect(hits.length,`floor owners at ${x},${z}`).toBe(1);
    }
    geometry.forEach(g=>g.dispose());
  });

  it('matches stair support to actual geometry on every tread',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false});
    for(let i=0;i<STEPS.count;i++){
      const z=TERRACE.z1+(i+0.5)*STEPS.tread;
      const expected=walkableHeightAt(0.137,z)!;
      const top=Math.max(...verticalHits(geometry.get('stone')!,0.137,z));
      expect(top).toBeCloseTo(expected,6);
      expect(expected).toBeCloseTo(FLOOR-(i+1)*STEPS.rise,6);
    }
    geometry.forEach(g=>g.dispose());
  });

  it('places every complete stair tread above analytical terrain instead of sharing the snow surface',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false}),stone=geometry.get('stone')!;
    const samples: Array<{x:number;z:number;y:number}>=[];
    for(let step=0;step<STEPS.count;step++)for(let ix=0;ix<17;ix++)for(let iz=0;iz<7;iz++) {
      const x=STEPS.x0+(STEPS.x1-STEPS.x0)*(ix+0.317)/17;
      const z=TERRACE.z1+(step+(iz+0.193)/7)*STEPS.tread;
      const expected=walkableHeightAt(x,z)!;
      const tops=verticalHits(stone,x,z);
      expect(tops,`one stone top at ${x},${z}`).toHaveLength(1);
      expect(tops[0]).toBeCloseTo(expected,6);
      samples.push({x,z,y:tops[0]});
    }
    const p=new ParamStore().values;
    const fields:FieldParams={roll:p.terrain.roll,hummocks:p.terrain.hummocks,wetlands:p.terrain.wetlands,waterLevel:p.terrain.waterLevel,grain:p.terrain.grain,density:0,patchiness:p.flowers.patchiness,patchSize:p.flowers.patchSize,weights:[0,0,0,0]};
    for(const radius of [40,128,400])for(const seed of [166,412,990]) {
      const terrain=new Terrain(generateLayout(seed));terrain.update(radius,fields,radius/256);
      for(const {x,z,y} of samples) {
        const ground=terrain.height(residentDirection(terrain,x,z));
        const clearance=terrain.cottageGround+y-ground;
        expect(clearance,`R${radius} seed${seed} stair ${x},${z}`).toBeGreaterThan(0.17);
      }
    }
    // Three visible treads and the veranda make four equal physical risers.
    expect(FLOOR-STEPS.count*STEPS.rise).toBeCloseTo(STEPS.rise,8);
    geometry.forEach(g=>g.dispose());
  });

  it('gives shoji lattice crossings and side plates one exposed face each',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false}),wood=geometry.get('wood')!;
    for(const [x0,x1] of [[-3.7,-1.5],[1.4,3.7]]) for(let i=1;i<4;i++) for(let j=1;j<5;j++){
      const x=x0+(x1-x0)*i/4+0.0031,y=1.28+(3.11-1.28)*j/5+0.0067;
      const faces=rayHits(wood,new Vector3(x,y,10),new Vector3(0,0,-1)).filter(p=>Math.abs(p.z-(FACE+0.025))<1e-5);
      expect(faces,`front lattice at ${x},${y}`).toHaveLength(1);
    }
    for(const side of [-1,1]) {
      for(const z of [-0.48,0.48]) for(const y of [1.79,2.18,2.57]) {
        const faces=rayHits(wood,new Vector3(side*10,y+0.0071,z+0.0033),new Vector3(-side,0,0)).filter(p=>Math.abs(p.x-side*(SIDE+0.045))<1e-5);
        expect(faces,`side lattice ${side},${y},${z}`).toHaveLength(1);
      }
      const plate=rayHits(wood,new Vector3(side*10,3.407,0.017),new Vector3(-side,0,0)).filter(p=>Math.abs(p.x-side*(SIDE+0.09))<1e-5);
      expect(plate,`side plate ${side}`).toHaveLength(1);
    }
    geometry.forEach(g=>g.dispose());
  });

  it('recesses side shoji into real wall openings',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false});
    for(const side of [-1,1]) for(const z of [-0.73,-0.27,0.27,0.73]) {
      const origin=new Vector3(side*10,2.319,z),direction=new Vector3(-side,0,0);
      expect(rayHits(geometry.get('wall')!,origin,direction).filter(p=>Math.abs(p.x-side*SIDE)<1e-5)).toHaveLength(0);
      expect(rayHits(geometry.get('shoji')!,origin,direction).filter(p=>Math.abs(p.x-side*(SIDE-0.035))<1e-5)).toHaveLength(1);
    }
    geometry.forEach(g=>g.dispose());
  });

  it('builds a low arch matching its walking support all along the bridge',()=>{
    const geometry=createHouseGeometry({furniture:false});
    const wood=geometry.get('wood')!;
    for(let i=0;i<65;i++){
      const x=BRIDGE.x0+(BRIDGE.x1-BRIDGE.x0)*(i+0.13)/66;
      const hits=verticalHits(wood,x,10.137).filter(y=>y<1);
      expect(hits.length).toBe(1);
      expect(Math.abs(hits[0]-bridgeDeckHeight(x))).toBeLessThan(0.001);
      expect(walkableHeightAt(x,10.137)).toBe(bridgeDeckHeight(x));
    }
    expect(bridgeDeckHeight(8)).toBeCloseTo(0.1,8);
    expect(bridgeDeckHeight(12)).toBeCloseTo(0.65,8);
    expect(bridgeDeckHeight(16)).toBeCloseTo(0.1,8);
    geometry.forEach(g=>g.dispose());
  });

  it('joins curved bridge rails without coplanar overlap wedges',()=>{
    const geometry=createHouseGeometry({furniture:false}),wood=geometry.get('wood')!;
    for(let i=1;i<32;i++) {
      if(i%8===0)continue; // Structural posts intentionally enclose these joints.
      const joint=BRIDGE.x0+(BRIDGE.x1-BRIDGE.x0)*i/32;
      const step=(BRIDGE.x1-BRIDGE.x0)/32;
      const slope=(bridgeDeckHeight(joint+step)-bridgeDeckHeight(joint-step))/(2*step);
      // Sample below the neutral axis, where separate angled end sections
      // cross. Their side-face overlap is offset from the nominal joint x.
      const origin=new Vector3(joint+slope*0.045,bridgeDeckHeight(joint)+0.40-0.045,6);
      const faces=rayHits(wood,origin,new Vector3(0,0,1)).filter(p=>Math.abs(p.z-(BRIDGE.z0-0.045))<1e-5);
      expect(faces,`rail joint ${joint}`).toHaveLength(1);
    }
    geometry.forEach(g=>g.dispose());
  });

  it('has full-width gables, independent snow and no giant inherited terrace',()=>{
    const geometry=createHouseGeometry({bridge:false});
    const roof=geometry.get('roof')!.getAttribute('position');
    for(const x of [-ROOF.ex,ROOF.ex]){
      let found=false;
      for(let i=0;i<roof.count;i++) if(Math.abs(roof.getX(i)-x)<1e-4&&Math.abs(roof.getZ(i))<1e-4&&Math.abs(roof.getY(i)-ROOF.top)<1e-4) found=true;
      expect(found).toBe(true);
    }
    expect(TERRACE.z1-TERRACE.z0).toBeLessThan(1.7);
    expect(COTTAGE.halfX*2).toBeGreaterThan(8);
    expect(geometry.get('snow')!.getAttribute('position').count).toBeGreaterThan(1000);
    expect(walkableHeightAt(-6.6,5)).toBeNull();
    let triangles=0;
    for(const g of geometry.values()){
      const p=g.getAttribute('position');triangles+=p.count/3;
      for(let i=0;i<p.array.length;i++)expect(Number.isFinite(p.array[i])).toBe(true);
    }
    expect(triangles).toBeLessThan(30000);
    geometry.forEach(g=>g.dispose());
  });

  it('rests continuous ridge snow on tiles while exposing the lower tile courses',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false});
    const snow=geometry.get('snow')!;
    const p=snow.getAttribute('position');
    let contacts=0;
    for(let i=0;i<p.count;i++){
      const z=Math.abs(p.getZ(i)),y=p.getY(i);
      if(z<0.42||z>ROOF.ez+1e-5||y<ROOF.eave-1e-5)continue;
      const roofY=ROOF.eave+ROOF.rise*(1-z/ROOF.ez);
      const clearance=y-roofY;
      expect(clearance).toBeGreaterThan(-1e-5);
      expect(clearance).toBeLessThan(0.21);
      if(Math.abs(y-roofTileHeightAt(p.getX(i),p.getZ(i)))<1e-5)contacts++;
    }
    expect(contacts).toBeGreaterThan(100);
    for(let i=0;i<15;i++){
      const x=-4.6+9.2*(i+0.137)/15;
      expect(verticalHits(snow,x,ROOF.ez*0.90).filter(y=>y>3.5)).toHaveLength(0);
      expect(verticalHits(snow,x,ROOF.ez*0.40).filter(y=>y>3.5)).toHaveLength(1);
    }
    geometry.forEach(g=>g.dispose());
  });

  it('has one connected snow cover across the ridge with no duplicate seam walls',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false}),snow=geometry.get('snow')!;
    const p=snow.getAttribute('position');
    for(let i=0;i<p.count;i+=3){
      const ridge=[i,i+1,i+2].every(j=>Math.abs(p.getZ(j))<1e-6&&p.getY(j)>ROOF.top);
      expect(ridge,'a ridge edge must not contain two coincident vertical skirt faces').toBe(false);
    }
    for(let i=0;i<15;i++)for(const z of [-0.137,-0.031,0.031,0.137]){
      const x=-4.6+9.2*(i+0.137)/15;
      const hits=rayHits(snow,new Vector3(x,15,z),new Vector3(0,-1,0)).filter(p=>p.y>ROOF.top);
      expect(hits,`single ridge cover ${x},${z}`).toHaveLength(1);
      expect(hits[0].y).toBeGreaterThan(5.72); // Clears the actual raised ridge tiles.
    }
    geometry.forEach(g=>g.dispose());
  });

  it('gives the roof snow a real cool underside and supports the unequal stair drifts',()=>{
    const geometry=createHouseGeometry({bridge:false,furniture:false}),snow=geometry.get('snow')!;
    const p=snow.getAttribute('position'),n=snow.getAttribute('normal');
    let lowerArea=0,stairContacts=0;
    for(let i=0;i<p.count;i+=3){
      if([i,i+1,i+2].every(j=>p.getY(j)>ROOF.eave&&Math.abs(p.getZ(j))>1&&n.getY(j)<0.1)){
        a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
        lowerArea+=b.sub(a).cross(c.sub(a)).length()*0.5;
      }
    }
    // A zero-area normal at the edge cannot produce the reference's visible lip.
    expect(lowerArea).toBeGreaterThan(0.25);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),y=p.getY(i);
      if(z<=TERRACE.z1||z>=TERRACE.z1+STEPS.count*STEPS.tread||y>1)continue;
      expect(Math.abs(x)).toBeGreaterThan(0.70);
      const tread=Math.floor((z-TERRACE.z1)/STEPS.tread);
      const support=FLOOR-(tread+1)*STEPS.rise-Math.max(0,Math.abs(x)-1)*0.075/0.065;
      expect(y-support).toBeGreaterThan(-1e-5);
      if(Math.abs(y-support)<1e-5)stairContacts++;
    }
    expect(stairContacts).toBeGreaterThan(60);
    geometry.forEach(g=>g.dispose());
  });
});
