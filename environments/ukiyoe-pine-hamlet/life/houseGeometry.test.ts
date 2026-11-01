import { describe, expect, it } from 'vitest';
import { Ray, Vector3, type BufferGeometry } from 'three';
import { BRIDGE, COTTAGE, FLOOR, ROOF, STEPS, TERRACE, bridgeDeckHeight, createHouseGeometry, walkableHeightAt } from './props';

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
      if(z<0.25||z>ROOF.ez+1e-5||y<ROOF.eave-1e-5)continue;
      const roofY=ROOF.eave+ROOF.rise*(1-z/ROOF.ez);
      const clearance=y-roofY;
      expect(clearance).toBeGreaterThan(-1e-5);
      expect(clearance).toBeLessThan(0.21);
      if(Math.abs(clearance)<1e-5)contacts++;
    }
    expect(contacts).toBeGreaterThan(100);
    for(let i=0;i<15;i++){
      const x=-4.6+9.2*(i+0.137)/15;
      expect(verticalHits(snow,x,ROOF.ez*0.90).filter(y=>y>3.5)).toHaveLength(0);
      expect(verticalHits(snow,x,ROOF.ez*0.40).filter(y=>y>3.5)).toHaveLength(1);
    }
    geometry.forEach(g=>g.dispose());
  });
});
