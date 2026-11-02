import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { buildCabinGeometry } from './cabinGeometry';
import vertexShader from './props.vert.glsl?raw';
import fragmentShader from './cabin.frag.glsl?raw';

const across=new Vector3(),forward=new Vector3();
export class Cabin {
  readonly group=new Object3D();
  private readonly mesh:Mesh;
  private readonly material:ShaderMaterial;
  constructor(shared:Record<string,IUniform>,seed:number){
    this.material=new ShaderMaterial({name:'Muse cedar cabin',vertexShader,fragmentShader,uniforms:{...shared},side:DoubleSide});
    this.mesh=new Mesh(buildCabinGeometry(seed),this.material);this.mesh.frustumCulled=false;
    this.group.name='Muse forest home: cedar cabin, porch and household things';
    this.group.add(this.mesh);this.group.matrixAutoUpdate=false;
  }
  place(origin:Vector3,up:Vector3,toward:Vector3):void {
    across.crossVectors(up,toward).normalize();forward.crossVectors(across,up).normalize();
    this.group.matrix.makeBasis(across,up,forward).setPosition(origin);
    this.group.matrixWorldNeedsUpdate=true;this.group.updateMatrixWorld(true);
  }
  dispose():void {this.mesh.geometry.dispose();this.material.dispose();this.group.clear();}
}
