import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3, Vector4, type BufferGeometry, type IUniform } from 'three';
import { gpuMemory,geometryBytes } from '../../../src/core/gpuMemory';
import { smoothstep } from '../../../src/core/math';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { createRyeSites,createNearRyeSites,ryeLaneClear,RYE_SITE_LIMIT,RYE_NEAR_LIMIT,type RyeSite } from './ryeDistribution';
import { ryeStalkGeometry,ryeDistantGeometry } from './ryeGeometry';
import vertexShader from './rye.vert.glsl?raw';
import fragmentShader from './rye.frag.glsl?raw';

interface CropBatch {mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;anchor:InstancedBufferAttribute;across:InstancedBufferAttribute;plant:InstancedBufferAttribute;slope:InstancedBufferAttribute;}
let nextRyeId=0;

/** Complete spherical standing crop. Cheap three-ear tufts cover every
 * stratum; stable detailed cells follow any walking focus, not only home. */
export class RyeFields {
  readonly group=new Group();
  readonly mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;
  readonly farMesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;
  private readonly material:ShaderMaterial;
  private readonly time={value:0};
  private readonly detail={value:new Vector4(0,1,0,0)};
  private readonly near:CropBatch;
  private readonly far:CropBatch;
  private sites:RyeSite[]=[];
  private seed=Number.NaN;
  private radius=Number.NaN;
  private dirty=true;
  private nearCount=0;
  private readonly lastFocus=new Vector3(NaN,NaN,NaN);
  private readonly ledger=`golden-rye/crop-${nextRyeId++}`;

  constructor(private readonly shared:Record<string,IUniform>,terrain:Terrain){
    this.material=new ShaderMaterial({name:'Golden Rye: complete standing crop',uniforms:{...shared,uRyeTime:this.time,uRyeDetail:this.detail,uRyeDetailRange:{value:new Vector2(8,17)}},vertexShader,fragmentShader,side:DoubleSide});
    this.near=this.batch(ryeStalkGeometry(),RYE_NEAR_LIMIT,'Detailed bowed rye ears around the walking focus');
    this.far=this.batch(ryeDistantGeometry(),RYE_SITE_LIMIT,'Continuous all-sphere rye canopy');
    this.mesh=this.near.mesh;this.farMesh=this.far.mesh;
    this.sites=createRyeSites(terrain.layout.seed);this.seed=terrain.layout.seed;
    this.group.name='Standing rye over the whole planet';this.group.add(this.far.mesh,this.near.mesh);
    gpuMemory.set(this.ledger,geometryBytes(this.far.mesh.geometry)+geometryBytes(this.near.mesh.geometry));
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

  get instanceCount():number{return this.mesh.geometry.instanceCount+this.farMesh.geometry.instanceCount;}
  get triangles():number{return this.near.mesh.geometry.index!.count/3*this.mesh.geometry.instanceCount+this.far.mesh.geometry.index!.count/3*this.farMesh.geometry.instanceCount;}
  invalidate():void{this.dirty=true;}

  private fill(batch:CropBatch,sites:readonly RyeSite[],terrain:Terrain,distant:boolean):number{
    const R=terrain.radius,home=terrain.layout.cottage,forward=terrain.layout.homeBearing;
    const right=new Vector3().crossVectors(home,forward).normalize();
    const dir=new Vector3(),x=new Vector3(),z=new Vector3(),turned=new Vector3(),ground=createGroundSample(),probe=new Vector3(),groundZ=new Vector3(),local={x:0,z:0};
    const width=Math.max(.45,R/128);
    let count=0;
    for(const site of sites){
      dir.copy(home).multiplyScalar(site.direction.y).addScaledVector(right,site.direction.x).addScaledVector(forward,site.direction.z).normalize();
      const ax=Math.fround(dir.x),ay=Math.fround(dir.y),az=Math.fround(dir.z);
      dir.set(ax,ay,az).normalize();
      if(dir.dot(home)>.9){terrain.cottageLocal(dir,local);if(!ryeLaneClear(local.x,local.z))continue;}
      terrain.sample(dir,ground);
      // No biome, elevation, slope, wetness or circular clearing rejection:
      // the user requested standing rye on every ridge and flank as well.
      x.copy(right).addScaledVector(dir,-right.dot(dir));
      if(x.lengthSq()<1e-6)x.crossVectors(dir,new Vector3(0,0,1));
      x.normalize();z.crossVectors(x,dir).normalize();
      turned.copy(x).multiplyScalar(Math.cos(site.turn)).addScaledVector(z,Math.sin(site.turn));
      let sx=0,sz=0;
      if(distant){
        // The distant tuft has three off-centre roots. Fit a physical ground
        // plane instead of leaving wide tuft feet floating over sloping land.
        const reach=Math.max(.25,site.size*width*.7);
        groundZ.crossVectors(turned,dir).normalize();
        probe.copy(dir).addScaledVector(turned,reach/R).normalize();sx=(terrain.height(probe)-ground.height)/reach;
        probe.copy(dir).addScaledVector(groundZ,reach/R).normalize();sz=(terrain.height(probe)-ground.height)/reach;
      }
      batch.anchor.setXYZW(count,ax,ay,az,ground.height-.015);
      batch.across.setXYZ(count,turned.x,turned.y,turned.z);
      batch.plant.setXYZW(count,site.size,site.phase,site.tone,distant?-width:1);
      batch.slope.setXY(count,sx,sz);count++;
    }
    batch.mesh.geometry.instanceCount=count;
    batch.anchor.needsUpdate=true;batch.across.needsUpdate=true;batch.plant.needsUpdate=true;batch.slope.needsUpdate=true;
    return count;
  }

  update(time:number,terrain:Terrain):void{
    this.time.value=time;
    if(this.seed!==terrain.layout.seed){this.seed=terrain.layout.seed;this.sites=createRyeSites(this.seed);this.dirty=true;}
    const changed=this.dirty||terrain.radius!==this.radius;
    if(changed){
      this.fill(this.far,this.sites,terrain,true);this.radius=terrain.radius;this.dirty=false;
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
    this.detail.value.set(worldFocus.x,worldFocus.y,worldFocus.z,nearWeight);
    if(nearWeight>.001){
      if(changed||!Number.isFinite(this.lastFocus.x)||this.lastFocus.dot(focus)<Math.cos(1/terrain.radius)){
        this.nearCount=this.fill(this.near,createNearRyeSites(this.seed,focus,terrain.radius),terrain,false);this.lastFocus.copy(focus);
      }
      this.mesh.geometry.instanceCount=this.nearCount;
    }else this.mesh.geometry.instanceCount=0;
  }

  dispose():void{this.mesh.geometry.dispose();this.farMesh.geometry.dispose();this.material.dispose();this.group.clear();gpuMemory.delete(this.ledger);}
}
