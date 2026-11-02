import { DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { Terrain } from '../planet/terrain';
import { shrineSites } from '../planet/routes';
import { buildWaysideShrineGeometry } from './waysideShrineGeometry';
import vertexShader from './props.vert.glsl?raw';
import fragmentShader from './props.frag.glsl?raw';

/** Sacred destinations share the route layout, not Muse's residential frame. */
export class WaysideShrines {
  readonly group=new Group();
  private readonly material:ShaderMaterial;
  private readonly meshes:Mesh[]=[];
  private seed=NaN;
  private radius=NaN;
  constructor(shared:Record<string,IUniform>){
    this.material=new ShaderMaterial({name:'Wayside shrine timber, stone and moss',vertexShader,fragmentShader,uniforms:{...shared},side:DoubleSide});
    this.group.name='Shrines along the woodland circuit';
  }
  update(terrain:Terrain):void {
    if(this.seed===terrain.layout.seed&&this.radius===terrain.radius)return;
    const sites=shrineSites(terrain.layout,terrain.radius).slice(1);
    if(this.seed!==terrain.layout.seed){
      for(const mesh of this.meshes){mesh.geometry.dispose();mesh.removeFromParent();}
      this.meshes.length=0;
      for(const [i,site] of sites.entries()){
        const mesh=new Mesh(buildWaysideShrineGeometry(site.variant,terrain.layout.seed+i*31),this.material);
        mesh.name=['Timber wayside sanctuary','Mossy stone sanctuary','Vermilion pavilion'][site.variant%3];
        mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;
        this.meshes.push(mesh);this.group.add(mesh);
      }
    }
    this.seed=terrain.layout.seed;this.radius=terrain.radius;
    const x=new Vector3(),z=new Vector3(),origin=new Vector3(),scale=new Vector3();
    for(const [i,site] of sites.entries()){
      x.crossVectors(site.dir,site.forward).normalize();z.crossVectors(x,site.dir).normalize();
      origin.copy(site.dir).multiplyScalar(terrain.radius+terrain.cottageGround);
      this.meshes[i].matrix.makeBasis(x,site.dir,z).scale(scale.setScalar(site.scale)).setPosition(origin);
      this.meshes[i].matrixWorldNeedsUpdate=true;
    }
  }
  dispose():void {
    for(const mesh of this.meshes)mesh.geometry.dispose();
    this.meshes.length=0;this.material.dispose();this.group.clear();
  }
}
