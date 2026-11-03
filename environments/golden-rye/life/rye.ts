import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3, Vector4, type BufferGeometry, type IUniform } from 'three';
import { gpuMemory,geometryBytes } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { createNearRyeSites,ryeLaneClear,RYE_NEAR_LIMIT,type RyeSite } from './ryeDistribution';
import { ryeStalkGeometry } from './ryeGeometry';
import { RyeCanopy,CANOPY_SHELLS,CANOPY_FAR_SHELLS } from './ryeCanopy';
import vertexShader from './rye.vert.glsl?raw';
import fragmentShader from './rye.frag.glsl?raw';

interface CropBatch {mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;anchor:InstancedBufferAttribute;across:InstancedBufferAttribute;plant:InstancedBufferAttribute;slope:InstancedBufferAttribute;}
let nextRyeId=0;

/** The standing crop over the whole planet: a shell canopy gives every field
 * its mass (ryeCanopy.ts); stable detailed ears follow any walking focus. Both
 * read the baked fields (crop.glsl), so the ears stand only where the crop
 * does, as tall as it, in its field's colour. */
export class RyeFields {
  readonly group=new Group();
  readonly mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;
  readonly canopy:RyeCanopy;
  private readonly material:ShaderMaterial;
  private readonly time={value:0};
  private readonly detail={value:new Vector4(0,1,0,0)};
  private readonly near:CropBatch;
  private seed=Number.NaN;
  private radius=Number.NaN;
  private dirty=true;
  private nearCount=0;
  private shells:number;
  private readonly lastFocus=new Vector3(NaN,NaN,NaN);
  private readonly ledger=`golden-rye/crop-${nextRyeId++}`;

  constructor(private readonly shared:Record<string,IUniform>,terrain:Terrain,shells:number=CANOPY_SHELLS.high){
    this.material=new ShaderMaterial({name:'Golden Rye: detailed ears',uniforms:{...shared,uRyeTime:this.time,uRyeDetail:this.detail,uRyeDetailRange:{value:new Vector2(8,17)}},vertexShader,fragmentShader,side:DoubleSide});
    this.near=this.batch(ryeStalkGeometry(),RYE_NEAR_LIMIT,'Detailed bowed rye ears around the walking focus');
    this.mesh=this.near.mesh;
    this.shells=shells;
    this.canopy=new RyeCanopy({...shared,uRyeTime:this.time},shells);
    this.seed=terrain.layout.seed;
    this.group.name='Standing rye over the whole planet';this.group.add(this.canopy.mesh,this.near.mesh);
    gpuMemory.set(this.ledger,geometryBytes(this.near.mesh.geometry));
  }

  private batch(source:BufferGeometry,capacity:number,name:string):CropBatch{
    const geometry=new InstancedBufferGeometry();
    for(const [key,attribute] of Object.entries(source.attributes))geometry.setAttribute(key,attribute);
    geometry.setIndex(source.index);source.dispose();
    const anchor=new InstancedBufferAttribute(new Float32Array(capacity*4),4);
    const across=new InstancedBufferAttribute(new Float32Array(capacity*3),3);
    const plant=new InstancedBufferAttribute(new Float32Array(capacity*4),4);
    const slope=new InstancedBufferAttribute(new Float32Array(capacity*2),2);
    geometry.setAttribute('aRyeAnchor',anchor);geometry.setAttribute('aRyeAcross',across);geometry.setAttribute('aRyePlant',plant);geometry.setAttribute('aRyeSlope',slope);geometry.instanceCount=0;
    const mesh=new Mesh(geometry,this.material);mesh.name=name;mesh.frustumCulled=false;
    return {mesh,anchor,across,plant,slope};
  }

  get instanceCount():number{return this.mesh.geometry.instanceCount;}
  get triangles():number{return this.near.mesh.geometry.index!.count/3*this.mesh.geometry.instanceCount+this.canopy.triangles;}
  invalidate():void{this.dirty=true;}

  private fill(batch:CropBatch,sites:readonly RyeSite[],terrain:Terrain):number{
    const home=terrain.layout.cottage,forward=terrain.layout.homeBearing;
    const right=new Vector3().crossVectors(home,forward).normalize();
    const dir=new Vector3(),x=new Vector3(),z=new Vector3(),turned=new Vector3(),ground=createGroundSample(),local={x:0,z:0};
    let count=0;
    for(const site of sites){
      dir.copy(home).multiplyScalar(site.direction.y).addScaledVector(right,site.direction.x).addScaledVector(forward,site.direction.z).normalize();
      const ax=Math.fround(dir.x),ay=Math.fround(dir.y),az=Math.fround(dir.z);
      dir.set(ax,ay,az).normalize();
      if(dir.dot(home)>.9){terrain.cottageLocal(dir,local);if(!ryeLaneClear(local.x,local.z))continue;}
      terrain.sample(dir,ground);
      // Which field, bund or road an ear stands in is read from the baked
      // fields in the shader (crop.glsl), so the ears always agree with the canopy.
      x.copy(right).addScaledVector(dir,-right.dot(dir));
      if(x.lengthSq()<1e-6)x.crossVectors(dir,new Vector3(0,0,1));
      x.normalize();z.crossVectors(x,dir).normalize();
      turned.copy(x).multiplyScalar(Math.cos(site.turn)).addScaledVector(z,Math.sin(site.turn));
      batch.anchor.setXYZW(count,ax,ay,az,ground.height-.015);
      batch.across.setXYZ(count,turned.x,turned.y,turned.z);
      batch.plant.setXYZW(count,site.size,site.phase,site.tone,1);
      batch.slope.setXY(count,0,0);count++;
    }
    batch.mesh.geometry.instanceCount=count;
    batch.anchor.needsUpdate=true;batch.across.needsUpdate=true;batch.plant.needsUpdate=true;batch.slope.needsUpdate=true;
    return count;
  }

  update(time:number,terrain:Terrain):void{
    this.time.value=time;
    if(this.seed!==terrain.layout.seed){this.seed=terrain.layout.seed;this.dirty=true;}
    const changed=this.dirty||terrain.radius!==this.radius;
    if(changed){
      this.radius=terrain.radius;this.dirty=false;
      // A bake/growth/seed can change while orbit hides the detailed draw.
      // Returning to the same focus must not resurrect its old ground roots.
      this.lastFocus.set(NaN,NaN,NaN);
    }
    const home=terrain.layout.cottage,forward=terrain.layout.homeBearing,right=new Vector3().crossVectors(home,forward).normalize();
    const worldFocus=(this.shared.uWarpUp?.value as Vector3|undefined)??home;
    const focus=new Vector3(worldFocus.dot(right),worldFocus.dot(home),worldFocus.dot(forward)).normalize();
    const fog=this.shared.uFog?.value as Vector4|undefined;
    const altitude=fog?fog.z/.95:8;
    const nearWeight=1-smoothstep(30,58,altitude);
    // From high up a stalk is far under a pixel and the canopy only a pixel or
    // two tall: a few shells draw the same picture at a fraction of the cost.
    this.canopy.setShells(Math.round(this.shells+(CANOPY_FAR_SHELLS-this.shells)*smoothstep(60,260,altitude)));
    this.detail.value.set(worldFocus.x,worldFocus.y,worldFocus.z,nearWeight);
    if(nearWeight>.001){
      if(changed||!Number.isFinite(this.lastFocus.x)||this.lastFocus.dot(focus)<Math.cos(1/terrain.radius)){
        this.nearCount=this.fill(this.near,createNearRyeSites(this.seed,focus,terrain.radius),terrain);this.lastFocus.copy(focus);
      }
      this.mesh.geometry.instanceCount=this.nearCount;
    }else this.mesh.geometry.instanceCount=0;
  }

  /** Shells for a quality tier (near the ground; fewer from high up). */
  setShells(count:number):void{this.shells=count;this.canopy.setShells(count);}

  dispose():void{this.mesh.geometry.dispose();this.material.dispose();this.canopy.dispose();this.group.clear();gpuMemory.delete(this.ledger);}
}
