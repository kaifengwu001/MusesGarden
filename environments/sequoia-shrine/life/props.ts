import { DoubleSide, Mesh, Object3D, ShaderMaterial, Vector3, type IUniform } from 'three';
import { buildShrineGeometry } from './shrineGeometry';
import vertexShader from './props.vert.glsl?raw';
import fragmentShader from './props.frag.glsl?raw';

const axisX=new Vector3(),axisZ=new Vector3();
// Compatibility names used by the shared Muse routine. They describe the
// shrine's compact porch and central steps; they do not add a pond or pier.
export const FLOOR=0.92;
export const COTTAGE={halfX:3.55,halfZ:3.12,wall:3.1,thickness:0.2,overhang:1.0,pitch:Math.PI/4} as const;
export const ROOF={ex:5,ez:4.6,eave:4.72,rise:2.23,ridge:0,top:6.95,slope:5.5} as const;
export const TERRACE={x0:-3.8,x1:3.8,z0:3.0,z1:4.15} as const;
export const PIER={x0:-3.8,x1:-2.4,z0:3.0,z1:4.15} as const;
export const STEPS={x0:-2.325,x1:2.325,count:4,rise:0.18,tread:0.7375} as const;
export const BENCH={x:-2.8,z:3.6,half:0.5,depth:0.17,seat:0.44} as const;
export const CHAIR={x:2.8,z:3.65,turn:0.5} as const;
export const FACE=3.12;
export const SIDE=3.55;
export const ARCH={x:-3.8,spring:0,half:0,depth:0} as const;
export const CHIMNEY={x:0,z:-2.5,half:0} as const;
/** The shrine remains small beside the sequoias, with a clear stone approach. */
export class Homestead {
  readonly group=new Object3D();
  private readonly mesh:Mesh;
  private readonly material:ShaderMaterial;
  constructor(shared:Record<string,IUniform>,seed:number){
    this.material=new ShaderMaterial({name:'sequoia-shrine-timber-and-stone',vertexShader,fragmentShader,uniforms:{...shared},side:DoubleSide});
    this.mesh=new Mesh(buildShrineGeometry(seed),this.material);
    this.mesh.frustumCulled=false;
    this.group.name='Vermilion forest shrine, stone torii and lanterns';
    this.group.add(this.mesh);this.group.matrixAutoUpdate=false;
  }
  /** Origin is already on the full ground surface. No additional HOME_LEVEL. */
  place(origin:Vector3,up:Vector3,toward:Vector3):void{
    const x=axisX.crossVectors(up,toward).normalize();
    const z=axisZ.crossVectors(x,up).normalize();
    this.group.matrix.makeBasis(x,up,z).setPosition(origin);
    this.group.matrixWorldNeedsUpdate=true;this.group.updateMatrixWorld(true);
  }
  dispose():void{this.mesh.geometry.dispose();this.material.dispose();this.group.clear();}
}
