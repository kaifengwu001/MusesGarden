import { Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform } from 'three';
import type { Terrain } from '../planet/terrain';
import { latitudeLongitude } from './fieldGrid';
import { TULIP_COLOURS,tulipGeometry } from './tulipGeometry';
import vertex from './tulipScenery.vert.glsl?raw';
import fragment from './tulipScenery.frag.glsl?raw';

export const DENSE_GRID=224;
export const DENSE_SPACING=0.34;

/** A persistent lattice of close-up plants, addressed by global latitude-ring
 * and column IDs. Moving the window changes only uniforms; shared plants keep
 * exactly the same roots, colours and wind phases. No per-frame scatter rebuild. */
export class DenseTulips {
  readonly mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;
  readonly grid={value:new Vector4()};
  private readonly focus=new Vector3();
  constructor(shared:Record<string,IUniform>,time:IUniform,bloom:IUniform,wind:IUniform){
    const source=tulipGeometry(),geometry=new InstancedBufferGeometry();geometry.copy(source as InstancedBufferGeometry);source.dispose();
    const cells=new Float32Array(DENSE_GRID*DENSE_GRID*2);
    for(let y=0;y<DENSE_GRID;y++)for(let x=0;x<DENSE_GRID;x++){const i=(y*DENSE_GRID+x)*2;cells[i]=x-DENSE_GRID/2;cells[i+1]=y;}
    geometry.setAttribute('aCell',new InstancedBufferAttribute(cells,2));geometry.instanceCount=DENSE_GRID*DENSE_GRID;
    const material=new ShaderMaterial({name:'Close-packed tulip fields',defines:{DENSE_FIELD:1},vertexShader:vertex,fragmentShader:fragment,side:DoubleSide,uniforms:{...shared,uTulipTime:time,uTulipBloom:bloom,uTulipWind:wind,uDenseGrid:this.grid,uDenseColours:{value:TULIP_COLOURS.map(c=>new Color(c))}}});
    this.mesh=new Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.name='Dense tulips wherever you wander';
  }
  update(terrain:Terrain,focus:Vector3,forward:Vector3,altitude:number):void{
    this.mesh.visible=altitude<50;
    if(!this.mesh.visible)return;
    this.focus.copy(focus).addScaledVector(forward,14/terrain.radius).normalize();
    const [x,z]=latitudeLongitude(this.focus,terrain.layout);
    const row=Math.floor(z/128*terrain.radius/DENSE_SPACING)-DENSE_GRID/2;
    const fade=1-Math.max(0,Math.min(1,(altitude-18)/32));
    this.grid.value.set(row,x/128,DENSE_SPACING,fade);
  }
  dispose():void{this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
