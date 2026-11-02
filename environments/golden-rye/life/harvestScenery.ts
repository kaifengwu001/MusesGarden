import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { cypressGeometry, farmGeometry, harvestSheafGeometry } from './harvestGeometry';
import vertexShader from './harvestScenery.vert.glsl?raw';
import fragmentShader from './harvestScenery.frag.glsl?raw';

interface Site { direction:Vector3; local?:readonly [number,number]; scale:number; heightScale:number; turn:number; phase:number; tint:number; }
interface Batch { mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>; sites:Site[]; anchor:InstancedBufferAttribute; across:InstancedBufferAttribute; placement:InstancedBufferAttribute; footprint:number; }

/** Cypress groves punctuate the continuous rye, while farms/sheaves stay sparse. */
export class HarvestScenery {
  readonly group=new Group();
  private readonly material:ShaderMaterial;
  private readonly time={value:0};
  private readonly batches:Batch[]=[];
  private seed=Number.NaN;
  private radius=Number.NaN;
  private dirty=true;

  constructor(shared:Record<string,IUniform>,terrain:Terrain){
    this.material=new ShaderMaterial({name:'golden-rye-rural-landmarks',vertexShader,fragmentShader,uniforms:{...shared,uHarvestTime:this.time},side:DoubleSide});
    this.group.name='Harvest cypresses, distant farms and bound rye sheaves';
    this.build(terrain);this.update(0,terrain);
  }

  invalidate():void {this.dirty=true;}

  private add(source:BufferGeometry,sites:Site[],name:string,footprint=0):void{
    const indexed=mergeVertices(source,1e-7),g=new InstancedBufferGeometry();
    for(const key of Object.keys(indexed.attributes))g.setAttribute(key,indexed.getAttribute(key));
    g.setIndex(indexed.index);source.dispose();indexed.dispose();
    const anchor=new InstancedBufferAttribute(new Float32Array(sites.length*4),4);
    const across=new InstancedBufferAttribute(new Float32Array(sites.length*3),3);
    const placement=new InstancedBufferAttribute(new Float32Array(sites.length*4),4);
    g.setAttribute('aAnchor',anchor);g.setAttribute('aAcross',across);g.setAttribute('aPlacement',placement);g.instanceCount=0;
    const mesh=new Mesh(g,this.material);mesh.name=name;mesh.frustumCulled=false;
    this.group.add(mesh);this.batches.push({mesh,sites,anchor,across,placement,footprint});
  }

  private build(terrain:Terrain):void {
    for(const b of this.batches){b.mesh.removeFromParent();b.mesh.geometry.dispose();}this.batches.length=0;
    this.seed=terrain.layout.seed;
    let state=hash32(this.seed^0x61ba22f1);
    const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
    const trees:Site[]=[],farms:Site[]=[],sheaves:Site[]=[];
    const site=(direction:Vector3,scale:number,turn:number,heightScale=1):Site=>({direction,scale,turn,heightScale,phase:rand()*Math.PI*2,tint:rand()});
    const local=(x:number,z:number,scale:number,turn:number,heightScale=1):Site=>({...site(new Vector3(),scale,turn,heightScale),local:[x,z]});
    for(const [x,z,scale] of [[-22,-24,.9],[-25,-25,1.1],[-27,-23,.65],[25,-32,.82],[27,-33,.61],[-35,8,.83],[-38,9,.63],[35,24,.85],[38,25,.6],[-22,37,.75],[-24,38,.5]])trees.push(local(x,z,scale,rand()*Math.PI*2,.83+rand()*.36));
    farms.push(local(-38,-33,.66,.25),local(40,-38,.55,-.45));
    for(const [x,z,scale] of [[10,15,.88],[-13,22,1],[20,28,.82],[-19,34,.9],[32,8,.8],[36,31,.75]])sheaves.push(local(x,z,scale,rand()*Math.PI*2));
    const home=terrain.layout.cottage,forward=terrain.layout.homeBearing,right=new Vector3().crossVectors(home,forward).normalize();
    for(let cluster=0;cluster<26;cluster++){
      const y=rand()*2-1,angle=rand()*Math.PI*2,s=Math.sqrt(1-y*y);
      const dir=home.clone().multiplyScalar(y).addScaledVector(right,Math.cos(angle)*s).addScaledVector(forward,Math.sin(angle)*s).normalize();
      const x=new Vector3().crossVectors(dir,Math.abs(dir.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
      const z=new Vector3().crossVectors(x,dir).normalize();
      const turn=rand()*Math.PI*2,count=2+Math.floor(rand()*3);
      for(let member=0;member<count;member++){
        const u=(member-(count-1)*.5)*(.026+rand()*.013),v=Math.sin(member*1.7+turn)*.019;
        const d=dir.clone().addScaledVector(x,u).addScaledVector(z,v).normalize();
        trees.push(site(d,.5+rand()*.65,turn+(rand()-.5)*.45,.75+rand()*.55));
      }
      if(cluster%4===0)farms.push(site(dir.clone().addScaledVector(z,.075).normalize(),.48+rand()*.30,turn));
      if(cluster%2===0)sheaves.push(site(dir.clone().addScaledVector(x,.08).normalize(),.85+rand()*.45,turn));
    }
    // More cypresses are a separate deterministic layer: preserve the existing
    // farms, sheaves and original grove identities while filling empty sides
    // of the planet with uneven, curved groups rather than a regular lattice.
    let treeState=hash32(this.seed^0x3e9ac172);
    const treeRand=():number=>unit(treeState=hash32((treeState+0x9e3779b9)>>>0));
    const treeSite=(direction:Vector3,scale:number,turn:number,heightScale:number):Site=>({direction,scale,turn,heightScale,phase:treeRand()*Math.PI*2,tint:treeRand()});
    const centres:Vector3[]=[];
    const sphere=():Vector3=>{const y=treeRand()*2-1,a=treeRand()*Math.PI*2,r=Math.sqrt(1-y*y);return new Vector3(Math.cos(a)*r,y,Math.sin(a)*r);};
    for(let grove=0;grove<64;grove++){
      let centre=sphere(),best=-1;
      // Farthest-candidate coverage prevents large accidental empty caps.
      // Unequal populations, bending and jitter keep its visual rhythm loose.
      for(let candidate=0;candidate<32;candidate++){
        const d=sphere();
        const gap=centres.length?Math.min(...centres.map(c=>1-c.dot(d))):treeRand();
        if(gap>best){centre=d;best=gap;}
      }
      centres.push(centre);
      const x=new Vector3().crossVectors(centre,Math.abs(centre.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
      const z=new Vector3().crossVectors(x,centre).normalize();
      const turn=treeRand()*Math.PI*2,count=3+Math.floor(treeRand()*5),bend=(treeRand()-.5)*.055;
      const along=x.clone().multiplyScalar(Math.cos(turn)).addScaledVector(z,Math.sin(turn));
      const across=new Vector3().crossVectors(along,centre).normalize();
      for(let member=0;member<count;member++){
        const u=(member-(count-1)*.5)*(.028+treeRand()*.011);
        const v=bend*Math.sin(member*.9)+(.5-treeRand())*.019;
        const direction=centre.clone().addScaledVector(along,u).addScaledVector(across,v).normalize();
        if(trees.some(t=>!t.local&&t.direction.dot(direction)>Math.cos(.021)))continue;
        trees.push(treeSite(direction,.54+treeRand()*.65,turn+(treeRand()-.5)*.85,.76+treeRand()*.52));
      }
    }
    for(const [x,z,scale] of [[-18,15,.65],[-21,17,.88],[-24,14,.58],[-19,30,.78],[-23,32,.6],[-25,29,.87],[21,15,.69],[24,17,.84],[27,14,.55],[27,34,.88],[30,36,.63],[32,32,.76]]){
      trees.push({...treeSite(new Vector3(),scale,treeRand()*Math.PI*2,.86+treeRand()*.28),local:[x,z]});
    }
    this.add(cypressGeometry(),trees,'Unequal dark cypress groves');
    this.add(farmGeometry(),farms,'Distant ochre farms and terracotta roofs',3.3);
    this.add(harvestSheafGeometry(),sheaves,'Bound rye sheaves');
    this.dirty=true;
  }

  update(time:number,terrain:Terrain):void {
    this.time.value=time;
    if(this.seed!==terrain.layout.seed)this.build(terrain);
    if(!this.dirty&&this.radius===terrain.radius)return;
    this.radius=terrain.radius;this.dirty=false;
    const R=terrain.radius,home=terrain.layout.cottage,forward=terrain.layout.homeBearing,right=new Vector3().crossVectors(home,forward).normalize();
    const dir=new Vector3(),axis=new Vector3(),cross=new Vector3(),turned=new Vector3(),probe=new Vector3(),ground=createGroundSample();
    for(const batch of this.batches){
      let count=0;
      for(const site of batch.sites){
        let presence=1;
        if(site.local){const [x,z]=site.local,d=Math.hypot(x,z),angle=Math.asin(Math.min(.95,d/R));dir.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right,x/d*Math.sin(angle)).addScaledVector(forward,z/d*Math.sin(angle)).normalize();}
        else{dir.copy(site.direction);presence=smoothstep(Math.min(55,R*.72),Math.min(66,R*.9),Math.acos(Math.max(-1,Math.min(1,home.dot(dir))))*R);}
        if(presence<=0)continue;
        const scale=site.scale*presence;
        const ax=Math.fround(dir.x),ay=Math.fround(dir.y),az=Math.fround(dir.z);dir.set(ax,ay,az).normalize();
        terrain.sample(dir,ground);let height=ground.height;
        if(site.local)axis.copy(right).addScaledVector(dir,-right.dot(dir)).normalize();else axis.crossVectors(dir,Math.abs(dir.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
        cross.crossVectors(axis,dir).normalize();turned.copy(axis).multiplyScalar(Math.cos(site.turn)).addScaledVector(cross,Math.sin(site.turn));
        if(batch.footprint){let low=height,high=height;for(const u of [-1,1])for(const v of [-1,1]){probe.copy(dir).addScaledVector(axis,u*batch.footprint*scale/R).addScaledVector(cross,v*batch.footprint*.7*scale/R).normalize();terrain.sample(probe,ground);low=Math.min(low,ground.height);high=Math.max(high,ground.height);}if(high-low>1.1*scale)continue;height=high;}
        batch.anchor.setXYZW(count,ax,ay,az,height-.08*scale);
        batch.across.setXYZ(count,turned.x,turned.y,turned.z);
        batch.placement.setXYZW(count,scale,site.heightScale,site.phase,site.tint);count++;
      }
      batch.mesh.geometry.instanceCount=count;batch.anchor.needsUpdate=true;batch.across.needsUpdate=true;batch.placement.needsUpdate=true;
    }
  }

  dispose():void {for(const b of this.batches)b.mesh.geometry.dispose();this.batches.length=0;this.material.dispose();this.group.clear();}
}
