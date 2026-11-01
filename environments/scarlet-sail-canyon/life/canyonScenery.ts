import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../../src/core/math';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { CHALK_SHELF_CENTRE_HEIGHT, chalkGeometry, chalkShelfGeometry, fanTreeGeometry, fernGeometry, coralGeometry, lichenGeometry } from './canyonGeometry';
import { makeCanyonInk, type CanyonInk } from './canyonInk';
import vertexShader from './canyonScenery.vert.glsl?raw';
import fragmentShader from './canyonScenery.frag.glsl?raw';

interface Anchor { direction: Vector3; local?: readonly [number, number]; scale: number; turn: number; phase: number; tint: number; threshold: number; height?: number; heightScale?: number; }
interface Batch { ink: CanyonInk; mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>; anchors: Anchor[]; anchorData: InstancedBufferAttribute; acrossData: InstancedBufferAttribute; placementData: InstancedBufferAttribute; heightData: InstancedBufferAttribute; }
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
    // Weld identical full vertices only at the render boundary. Source templates
    // remain non-indexed for mesh construction, support raycasts and source tests.
    const indexed=mergeVertices(base,1e-8);
    const geometry=new InstancedBufferGeometry();
    for(const name of Object.keys(indexed.attributes))geometry.setAttribute(name,indexed.getAttribute(name));
    geometry.setIndex(indexed.index);
    // Attributes now belong to the instanced geometry. Neither temporary was
    // uploaded; disposing their wrappers leaves the transferred buffers intact.
    indexed.dispose();
    base.dispose();
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
    const ink=makeCanyonInk(geometry,this.material.uniforms);
    this.group.add(mesh,ink.mesh);
    this.batches.push({ink,mesh,anchors,anchorData,acrossData,placementData,heightData});
  }

  private buildAnchors(terrain:Terrain):void{
    for(const b of this.batches){this.group.remove(b.mesh);b.ink.dispose();b.mesh.geometry.dispose();}
    this.batches.length=0;
    this.seed=terrain.layout.seed;
    let state=hash32(this.seed^0x51ca12);
    const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
    const trees:Anchor[]=[],rocks:Anchor[]=[],ferns:Anchor[]=[],corals:Anchor[]=[],shelves:Anchor[]=[],lichen:Anchor[]=[];
    const local=(x:number,z:number,scale:number,turn:number,heightScale=1):Anchor=>({direction:new Vector3(),local:[x,z],scale,turn,heightScale,phase:rand()*TAU,tint:rand(),threshold:0});
    const safe=(x:number,z:number,margin=0):boolean=> {
      if(x>-9-margin&&x<5.2+margin&&z>-6-margin&&z<8+margin)return false;
      if(Math.abs(x)<2+margin&&z>5&&z<13)return false;
      for(const [hx,hz] of [[-7.2,12],[0,17],[7.2,12]])if(((x-hx)/(3.2+margin))**2+((z-hz)/(2.8+margin))**2<1)return false;
      for(const [fx,fz] of [[-12.2,15.5],[11.8,20.5],[4.5,24.5],[-12.2,7],[-12.8,19.5],[12.8,22]])if(Math.hypot(x-fx,z-fz)<1.15+margin)return false;
      return true;
    };
    const pocket=(x:number,z:number,size=1):void=>{
      if(!safe(x,z))return;
      lichen.push(local(x,z,1.1*size,rand()*TAU));
      for(let k=0;k<8;k++){
        const a=rand()*TAU,r=(0.55+rand()*1.3)*size;
        const fx=x+Math.cos(a)*r,fz=z+Math.sin(a)*r;
        if(!safe(fx,fz))continue;
        if(k<4)lichen.push(local(fx,fz,(0.65+rand()*0.55)*size,rand()*TAU));
        else if(k<7)corals.push(local(fx,fz,(0.8+rand()*0.5)*size,rand()*TAU));
        else ferns.push(local(fx,fz,(0.65+rand()*0.35)*size,rand()*TAU));
      }
    };
    // One continuous canyon settlement: near ledges, middle terraces and high
    // shoulders overlap in the view. The central walking corridor stays open.
    const ledges=[
      [-20,-12,2.0,-0.15,1.05],[-31,-16,2.5,0.24,1.6],[-42,-20,2.7,-0.18,1.2],
      [-13,-14,1.5,0.08,0.9],[-3,-19,2.1,0.05,1.2],[11,-20,2.3,-0.15,1.25],[27,-16,2.5,-0.3,1.5],
      [-22,0,1.8,0.26,0.65],[-34,3,2.3,0.15,1.3],[-45,8,2.8,0.28,1.7],
      [23,-1,1.7,-0.35,0.65],[34,3,2.4,-0.18,1.3],[45,9,2.7,-0.25,1.6],
      [-22,13,1.6,0.16,0.6],[-34,19,2.2,0.15,1.1],[-46,27,2.7,0.05,1.5],
      [24,14,1.5,-0.2,0.65],[36,21,2.2,-0.22,1.1],[47,27,2.5,-0.3,1.45],
      [-23,30,1.4,0.15,0.65],[-39,36,2.4,0.25,1.2],[24,32,1.5,-0.3,0.65],[40,37,2.6,-0.2,1.3],
      [-32,-35,2.7,0.18,1.8],[-14,-36,2.6,-0.1,1.2],[5,-38,2.5,0.05,1.6],[27,-36,2.7,-0.2,1.5],
      [-53,-12,2.8,0.3,1.9],[53,-14,2.7,-0.3,1.6],[-56,33,3.0,0.4,1.4],[57,36,2.8,-0.1,1.7]
    ];
    for(const [x,z,s,t,h0] of ledges){
      if(x>5&&x<38&&z<-10)continue;
      const h=h0*(x>8?0.42:0.88);
      const shelf=local(x,z,s,t,h);
      shelves.push(shelf);
      // Tree and lichen share the actual central support of this cliff mesh.
      const rootHeight=(CHALK_SHELF_CENTRE_HEIGHT*h-GROUND_EMBED)*s;
      if(rand()>0.19 && !(x>8&&x<43&&z>12)){
        trees.push({...local(x,z,1.05+rand()*1.0,t+(rand()-0.5)*0.45),height:rootHeight});
        lichen.push({...local(x,z,s*0.9,t),height:rootHeight});
      }
      const bx=x+Math.sin(t)*s*2,bz=z+Math.cos(t)*s*2;
      pocket(bx,bz,1.0+rand()*0.4);
      for(let j=0;j<3;j++){
        const rx=bx+(j-1)*s*1.1,rz=bz+0.5+rand();
        if(safe(rx,rz,1.5))rocks.push(local(rx,rz,0.8+rand()*1.4,t+(rand()-0.5),0.35+rand()*0.5));
      }
    }
    // The home is a lean-to at the foot of its own chalk face. Its rear
    // edge is only a few decimetres from the rock; its front routes stay clear.
    for(const [x,z,s,h] of [[1,-7.4,1.25,1.55],[-8,-8.5,1.3,1.0]]){
      const cliff=local(x,z,s,0,h);
      shelves.push(cliff);
      lichen.push({...local(x,z,s*0.85,0),height:(CHALK_SHELF_CENTRE_HEIGHT*h-GROUND_EMBED)*s});
    }
    // Larger fans lean over the inhabited path; young fans and drip gardens
    // connect the high canopy to the ground instead of solitary tree stamps.
    for(const [x,z,s,t] of [[-14,-5,1.9,0.1],[-18,-10,2.2,0.35],[-27,-7,1.6,-0.2],[40,-4,1.0,-0.15],[-19,7,1.25,0.25],[40,18,1.0,-0.3],[-20,23,1.15,0.15],[21,26,1.1,-0.3],[-30,27,1.5,0.1],[30,28,1.5,-0.4]]){
      if(x>15&&z>18)continue;
      trees.push(local(x,z,s,t));pocket(x,z,1.25);
      const sx=x+(x<0?-3:3),sz=z+3;
      trees.push(local(sx,sz,0.45+rand()*0.35,t+0.5));pocket(sx,sz,0.8);
    }
    // Understory follows the edges of the routes, leaving room for all six
    // ground creatures and the three Muse neighbours.
    for(const [x,z] of [[-12.8,5],[-13.6,10],[-13.8,17],[-13.5,22],[13.7,10],[13.8,17],[14.4,22],[-8,-8],[7,-9],[-9,26],[9,27]])pocket(x,z,1.0);
    for(const [x,z] of [[-3.6,10],[3.6,10],[-4.4,17.8],[4.4,17.8],[-8.5,20.5],[8.5,20.5],[-6.5,24],[2,25],[-8,29],[9,28]])pocket(x,z,0.7+rand()*0.25);
    // The awning grows out of an inhabited planted crevice, rather than
    // standing on an empty clearing. The right side has no lookout deck.
    for(const [x,z] of [[6.3,-1],[7,2.5],[7.8,5.8],[-9.8,-3],[-10.5,0],[-10.4,4]])pocket(x,z,0.8+rand()*0.2);
    const home=terrain.layout.cottage;
    const forward=terrain.layout.homeBearing;
    const across=new Vector3().crossVectors(home,forward).normalize();
    // Staggered global terraces and groves continue the same silhouette around
    // the globe, rather than concentrating all geology at one landmark.
    const sites=384;
    for(let i=0;i<sites;i++){
      const y=1-2*(i+0.5)/sites;
      const a=i*2.399963229728653+this.seed*0.001;
      const r=Math.sqrt(1-y*y);
      const dir=home.clone().multiplyScalar(y).addScaledVector(across,Math.cos(a)*r).addScaledVector(forward,Math.sin(a)*r).normalize();
      const gate=rand()*0.55;
      const anchor:Anchor={direction:dir,scale:1.0+rand()*0.85,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate};
      const shelfScale=1.65+rand()*1.5;
      const shelfHeight=0.65+rand()*1.4;
      if(i%4!==0){
        shelves.push({...anchor,scale:shelfScale,heightScale:shelfHeight});
        anchor.height=(CHALK_SHELF_CENTRE_HEIGHT*shelfHeight-GROUND_EMBED)*shelfScale;
      }
      if(i%5!==0)trees.push(anchor);
      lichen.push({...anchor,scale:anchor.height===undefined?1.5:1.1*shelfScale,height:anchor.height});
      const tangent=new Vector3().crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
      const bitangent=new Vector3().crossVectors(tangent,dir).normalize();
      for(let k=0;k<2;k++){
        const angle=rand()*TAU;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*0.03).addScaledVector(bitangent,Math.sin(angle)*0.03).normalize();
        rocks.push({direction:nearby,scale:1.2+rand()*2.6,heightScale:0.4+rand()*0.65,turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
      }
      if(i%3===0){
        const angle=rand()*TAU;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*0.023).addScaledVector(bitangent,Math.sin(angle)*0.023).normalize();
        const plant={direction:nearby,scale:0.8+rand()*0.65,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate};
        if(i%2===0)ferns.push(plant);else corals.push(plant);
        lichen.push({...plant,scale:1.2+rand()*0.65,direction:nearby.clone().addScaledVector(tangent,0.008).normalize()});
      }
    }
    this.batch(fanTreeGeometry(),trees,'Persistent scarlet fan trees');
    this.batch(chalkGeometry(),rocks,'Fractured chalk slabs');
    this.batch(fernGeometry(),ferns,'Ivory comb-ferns');
    this.batch(chalkShelfGeometry(),shelves,'Connected chalk escarpments');
    this.batch(lichenGeometry(),lichen,'Sage leafy cushions');
    this.batch(coralGeometry(),corals,'Scarlet lobed understory');
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
    const active=Math.min(1,0.52+R/128*0.4);
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
          presence *= smoothstep(Math.min(55,R*0.7), Math.min(64,R*0.85), homeDistance);
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
    for(const b of this.batches){b.ink.dispose();b.mesh.geometry.dispose();}
    this.material.dispose();
    this.group.clear();
  }
}
