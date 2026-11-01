import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { smoothstep } from '../../../src/core/math';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { CHALK_SHELF_CENTRE_HEIGHT, chalkGeometry, chalkShelfGeometry, fanTreeGeometry, fernGeometry, lichenGeometry } from './canyonGeometry';
import vertexShader from './canyonScenery.vert.glsl?raw';
import fragmentShader from './canyonScenery.frag.glsl?raw';

interface Anchor { direction: Vector3; local?: readonly [number, number]; scale: number; turn: number; phase: number; tint: number; threshold: number; height?: number; heightScale?: number; }
interface Batch { mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>; anchors: Anchor[]; anchorData: InstancedBufferAttribute; acrossData: InstancedBufferAttribute; placementData: InstancedBufferAttribute; heightData: InstancedBufferAttribute; }
const TAU=Math.PI*2;
const GROUND_EMBED=0.08;

/** Persistent world-local flora and geology. No height-dependent flower fade: landmarks survive orbit. */
export class CanyonScenery {
  readonly group=new Group();
  readonly ready=true;
  private readonly material: ShaderMaterial;
  private readonly batches: Batch[]=[];
  private readonly time={value:0};
  private seed=Number.NaN;
  private radius=Number.NaN;
  private dirty=true;
  private readonly ground=createGroundSample();

  constructor(shared: Record<string,IUniform>,terrain:Terrain){
    this.material=new ShaderMaterial({name:'scarlet-canyon-scenery',vertexShader,fragmentShader,uniforms:{...shared,uSceneryTime:this.time},side:DoubleSide});
    this.group.name='Scarlet fan groves, chalk shelves and comb-ferns';
    this.buildAnchors(terrain);
    this.update(0,terrain);
  }

  /** Call after field/terrain parameter changes that leave radius and seed unchanged. */
  invalidate():void {this.dirty=true;}

  private batch(base:BufferGeometry,anchors:Anchor[],name:string):void{
    const geometry=new InstancedBufferGeometry();
    for(const name of Object.keys(base.attributes))geometry.setAttribute(name,base.getAttribute(name));
    geometry.setIndex(base.index);
    const anchorData=new InstancedBufferAttribute(new Float32Array(anchors.length*4),4);
    const acrossData=new InstancedBufferAttribute(new Float32Array(anchors.length*3),3);
    const placementData=new InstancedBufferAttribute(new Float32Array(anchors.length*4),4);
    const heightData=new InstancedBufferAttribute(new Float32Array(anchors.length),1);
    geometry.setAttribute('aAnchor',anchorData);
    geometry.setAttribute('aAcross',acrossData);
    geometry.setAttribute('aPlacement',placementData);
    geometry.setAttribute('aHeightScale',heightData);
    geometry.instanceCount=0;
    const mesh=new Mesh(geometry,this.material);
    mesh.name=name;
    // Bounds in the shader follow radius, local relief and the camera warp.
    mesh.frustumCulled=false;
    this.group.add(mesh);
    this.batches.push({mesh,anchors,anchorData,acrossData,placementData,heightData});
  }

  private buildAnchors(terrain:Terrain):void{
    for(const b of this.batches){this.group.remove(b.mesh);b.mesh.geometry.dispose();}
    this.batches.length=0;
    this.seed=terrain.layout.seed;
    let state=hash32(this.seed^0x51ca12);
    const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
    const trees:Anchor[]=[],rocks:Anchor[]=[],ferns:Anchor[]=[],shelves:Anchor[]=[],lichen:Anchor[]=[];
    const local=(x:number,z:number,scale:number,turn:number,heightScale=1):Anchor=>({direction:new Vector3(),local:[x,z],scale,turn,heightScale,phase:rand()*TAU,tint:rand(),threshold:0});
    // Three Sails sit behind and left of the shelter. The resident foreground remains clear.
    for(const [x,z,s,t] of [[-15,-6,1.3,-0.1],[-11,-10,1.58,0.42],[-19,-11,1.12,-0.55],[-25,1,0.78,0.2],[20,-8,0.72,-0.5],[-28,16,0.65,0.5],[27,15,0.73,-0.8],[-16,29,0.6,0.2],[18,31,0.6,-0.3]]){
      trees.push(local(x,z,s,t));
      lichen.push(local(x,z,2.1+rand()*0.9,rand()*TAU));
      for(let i=0;i<8;i++){
        const a=rand()*TAU,r=1.3+rand()*2.1;
        ferns.push(local(x+Math.cos(a)*r,z+Math.sin(a)*r,0.75+rand()*0.8,rand()*TAU));
      }
    }
    // Overlapping low fracture beds lead into the taller rear escarpment.
    for(const [x,z,s,h] of [[-11,-8,3.4,0.62],[-16,-8,4.3,0.65],[-21,-10,4.3,0.77],[-27,-11,4.6,0.8],[18,-10,3.5,0.7],[23,-12,3.9,0.92],[-18,5,3.0,0.52],[18,6,3.0,0.55],[-19,12,3.2,0.6],[20,16,3.4,0.62],[-22,23,3.0,0.5],[23,26,3.2,0.65],[-28,13,3.2,0.7]]){
      const turn=(rand()-0.5)*0.8;
      rocks.push(local(x,z,s,turn,h));
      for(let k=0;k<3;k++){
        const offset=(k-1)*s*0.68;
        const front=0.7+rand()*0.65;
        const cx=x+offset*Math.cos(turn)+front*Math.sin(turn);
        const cz=z-offset*Math.sin(turn)+front*Math.cos(turn);
        const chip=local(cx,cz,s*(0.3+rand()*0.22),turn+(rand()-0.5)*0.35,0.3+rand()*0.35);
        if(cz<6||Math.abs(cx)>14.5||cz>22)rocks.push(chip);
      }
    }
    for(const [x,z,s,t] of [[-20,-19,2.0,-0.25],[-20,-12,1.05,0.1],[-11,-15,0.8,-0.2],[-32,-6,1.7,0.65],[24,-17,1.9,-0.6],[32,18,1.6,0.7],[-30,30,1.5,-0.3]]){
      shelves.push(local(x,z,s,t));
      for(let i=0;i<3;i++)lichen.push(local(x-3+i*2.5,z+3,1.8,rand()*TAU));
    }
    const home=terrain.layout.cottage;
    const forward=terrain.layout.homeBearing;
    const across=new Vector3().crossVectors(home,forward).normalize();
    // Stable unit-direction anchors; growth changes neither their identity nor the mesh dimensions.
    for(let i=0;i<128;i++){
      const y=1-2*(i+0.5)/128;
      const a=i*2.399963229728653+this.seed*0.001;
      const r=Math.sqrt(1-y*y);
      const dir=home.clone().multiplyScalar(y).addScaledVector(across,Math.cos(a)*r).addScaledVector(forward,Math.sin(a)*r).normalize();
      if(dir.dot(home)>Math.cos(0.36))continue;
      const gate=rand();
      const anchor:Anchor={direction:dir,scale:0.8+rand()*0.55,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate};
      const shelfScale=1.0+rand()*0.8;
      if(i%3===0){
        shelves.push({...anchor,scale:shelfScale,turn:anchor.turn});
        // The shelf itself is embedded below the sampled ground. Place roots
        // against its actual central face, then embed the plant independently.
        anchor.height=(CHALK_SHELF_CENTRE_HEIGHT-GROUND_EMBED)*shelfScale;
      }
      trees.push(anchor);
      const lichenScale=2.1+rand()*1.3;
      lichen.push({...anchor,scale:anchor.height===undefined?lichenScale:1.1*shelfScale,height:anchor.height});
      const tangent=new Vector3().crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
      const bitangent=new Vector3().crossVectors(tangent,dir).normalize();
      for(let k=0;k<2;k++){
        const angle=rand()*TAU;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*0.018).addScaledVector(bitangent,Math.sin(angle)*0.018).normalize();
        rocks.push({direction:nearby,scale:1.2+rand()*2.6,heightScale:0.45+rand()*0.8,turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
      }
      for(let k=0;k<4;k++){
        const angle=rand()*TAU;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*0.013).addScaledVector(bitangent,Math.sin(angle)*0.013).normalize();
        ferns.push({direction:nearby,scale:0.8+rand()*0.65,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate});
      }
    }
    this.batch(fanTreeGeometry(),trees,'Persistent scarlet fan trees');
    this.batch(chalkGeometry(),rocks,'Fractured chalk slabs');
    this.batch(fernGeometry(),ferns,'Ivory comb-ferns');
    this.batch(chalkShelfGeometry(),shelves,'Connected chalk escarpments');
    this.batch(lichenGeometry(),lichen,'Sage lichen mats');
    this.dirty=true;
  }

  update(time:number,terrain:Terrain):void{
    this.time.value=time;
    if(terrain.layout.seed!==this.seed)this.buildAnchors(terrain);
    if(!this.dirty&&terrain.radius===this.radius)return;
    this.radius=terrain.radius;
    this.dirty=false;
    const R=terrain.radius;
    const home=terrain.layout.cottage;
    const forward=terrain.layout.homeBearing;
    const right=new Vector3().crossVectors(home,forward).normalize();
    const dir=new Vector3(),x=new Vector3(),z=new Vector3(),turned=new Vector3();
    const active=Math.min(1,0.32+R/128*0.48);
    for(const batch of this.batches){
      let count=0;
      for(const a of batch.anchors){
        let presence = a.threshold === 0 ? 1 : smoothstep(a.threshold - 0.07, a.threshold + 0.07, active);
        if (presence === 0) continue;
        if(a.local){
          const [lx,lz]=a.local;
          const d=Math.hypot(lx,lz),angle=Math.asin(Math.min(0.95,d/R));
          dir.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right,lx/d*Math.sin(angle)).addScaledVector(forward,lz/d*Math.sin(angle)).normalize();
        }else{
          dir.copy(a.direction);
          // Physical home clearance survives a small planet: the foreground
          // resident lanes extend to 20 m and the widest slab adds another 5 m.
          const homeDistance = Math.acos(Math.max(-1, Math.min(1, dir.dot(home)))) * R;
          presence *= smoothstep(32, 38, homeDistance);
          if (presence === 0) continue;
        }
        terrain.sample(dir,this.ground);
        // Tangent orientation is deterministic; local fans face the home's approach.
        if(a.local)x.copy(right).addScaledVector(dir,-right.dot(dir)).normalize();
        else x.crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
        z.crossVectors(x,dir).normalize();
        turned.copy(x).multiplyScalar(Math.cos(a.turn)).addScaledVector(z,Math.sin(a.turn));
        batch.anchorData.setXYZW(count,dir.x,dir.y,dir.z,this.ground.height-GROUND_EMBED*a.scale+(a.height??0));
        batch.acrossData.setXYZ(count,turned.x,turned.y,turned.z);
        batch.placementData.setXYZW(count,a.scale,a.phase,a.tint,presence);
        batch.heightData.setX(count,a.heightScale??1);
        count++;
      }
      batch.mesh.geometry.instanceCount=count;
      batch.anchorData.needsUpdate=true;
      batch.acrossData.needsUpdate=true;
      batch.placementData.needsUpdate=true;
      batch.heightData.needsUpdate=true;
    }
  }

  dispose():void{
    for(const b of this.batches)b.mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
