import { Vector3, type Vector4 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNativeFindMesh, nativeBedGeometry } from '../life/nativeFindFlora';
import { formOf, unpackShape, type Family } from '../life/collectibleForms';
import { FindBeds } from '../life/findBeds';
import { FindForms, type FormLook } from '../life/findForms';
import { generateLayout, Terrain } from '../planet/terrain';
import type { FieldParams } from '../planet/fields';

const params:FieldParams={roll:2.1,hummocks:0.12,wetlands:0,waterLevel:0,grain:0.75,density:0,patchiness:0.78,patchSize:13,weights:[0.4,0.24,0.22,0.14]};
afterEach(()=>vi.unstubAllGlobals());

describe('native saved-find flora',()=>{
  it('maps all four companion channels to rooted coral or ivory membranes',()=>{
    for(let species=0;species<4;species++) {
      const geometry=nativeBedGeometry(species),parts=geometry.getAttribute('aPart'),position=geometry.getAttribute('position');
      const kinds=new Set(Array.from(parts.array));
      expect([...kinds].sort()).toEqual(species%2?[0,1]:[2]);
      const ys=Array.from({length:position.count},(_,i)=>position.getY(i));
      // Round stem footprints overlap the surface by a few millimetres.
      expect(Math.min(...ys)).toBeGreaterThan(-0.015);expect(Math.min(...ys)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(Math.max(...ys)-(species%2?0.52:0.34))).toBeLessThan(0.015);
      expect(position.count).toBeLessThan(300);
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      geometry.dispose();
    }
  });

  it('renders every legacy specimen family as native flora or a cobalt fragment',()=>{
    const base=formOf({id:'existing-find',dir:[0,1,0],kin:'saved topic',open:true},{shore:1000,wet:0,lush:0.5});
    for(const family of ['bloom','spire','fern','reed','stone'] as Family[])for(const kin of [0,1]) {
      const mesh=buildNativeFindMesh([{...base,family,kin}]);
      const parts=new Set(Array.from(mesh.shape).filter((_,i)=>i%2===0).map(code=>unpackShape(code).part));
      expect([...parts].sort()).toEqual(family==='stone'?[5]:kin?[0,1]:[2]);
      expect(mesh.position.length/3).toBeLessThan(300);
      expect(mesh.index.length%3).toBe(0);
    }
  });

  it('preserves saved IDs, planting and selection through growth, reseeding and cached legacy ground',()=>{
    const storage=new Map<string,string>([['muses-garden:specimen-ground','{"412:kept-find":[0,1,1]}']]);
    vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
    const beds=new FindBeds({}),forms=new FindForms({},beds);
    const terrain=new Terrain(generateLayout(412));
    const dir=new Vector3(0.3,0.8,0.5).normalize();
    let previousParts:number[]=[];
    for(const [seed,radius] of [[412,128],[412,400],[5,128]]) {
      terrain.setLayout(generateLayout(seed));terrain.update(radius,params,2*radius/512);
      const looks:FormLook[]=[{bed:{find:'kept-find',basket:'saved-basket',dir,ground:terrain.height(dir)},species:1,variant:0.3,topic:'saved topic'}];
      beds.set(looks,radius,new Set());forms.set(looks,terrain,new Set());
      beds.highlight('kept-find');forms.open('kept-find');beds.update(6);forms.update(6,true);
      expect(beds.slot('kept-find')).toBe(0);expect(forms.specimens.visible).toBe(true);
      expect((forms.specimens.material.uniforms.uFindLook.value as Vector4).y).toBe(0);
      const local=forms.specimens.geometry.getAttribute('aLocal');
      const parts=Array.from({length:local.count},(_,i)=>Math.floor(local.getW(i)/4096));
      expect(parts.every(part=>[0,1,2,5].includes(part))).toBe(true);
      if(seed===412&&previousParts.length)expect(parts).toEqual(previousParts);
      previousParts=parts;
      beds.unplant(['kept-find']);expect(beds.uniforms.uBeds.value[0].x).toBeGreaterThan(1e8);
      beds.plant(['kept-find']);expect(beds.uniforms.uBeds.value[0].x).toBeLessThan(100);
    }
    expect(storage.get('muses-garden:specimen-ground')).toBe('{"412:kept-find":[0,1,1]}');
    expect(storage.has('muses-garden.cobalt-windfields:specimen-ground.v1')).toBe(true);
    for(const mesh of [...beds.meshes,...forms.objects]) {
      mesh.geometry.dispose();
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();
    }
  });
});
