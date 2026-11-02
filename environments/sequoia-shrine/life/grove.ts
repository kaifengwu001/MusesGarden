import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { forestNetwork, routeSpurCentre } from '../planet/routes';
import { groveFloorGeometry, sequoiaCanopyGeometry, sequoiaGeometry } from './groveGeometry';
import vertexShader from './grove.vert.glsl?raw';
import fragmentShader from './grove.frag.glsl?raw';

export interface GroveSite {
  direction:Vector3;
  local?:readonly [number,number];
  trail?:readonly [number,number];
  coverage?:boolean;
  habit:0|1|2|3;
  scale:number;
  turn:number;
  phase:number;
  tint:number;
}

/** Root exclusion is physical: the processional lane remains open while the
 * canopy is free to meet overhead. The court and shrine are never tree sites. */
export function groveRouteClear(x:number,z:number,margin=0):boolean {
  if(x>-7-margin&&x<7+margin&&z>-7-margin&&z<10+margin)return false;
  if(Math.abs(x)<3.7+margin&&z>5&&z<45)return false;
  return true;
}

/** Physical canopy size is retained during growth. Small worlds keep the
 * existing reduced tree scale; large worlds gain slightly older, wider trees. */
export function canopyGrowthScale(radius:number):number {
  return Math.pow(radius/128,radius<128?0.32:0.12);
}

/** Unequal wooded stands over a complete forest backbone, in canonical home space. */
export function generateGroveSites(seed:number,radius=128):GroveSite[] {
  let state=hash32(seed^0x65e9b4a1);
  const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
  const sites:GroveSite[]=[];
  const addLocal=(x:number,z:number,habit:0|1|2|3,scale:number):void=>{
    if(!groveRouteClear(x,z,habit===3?1.1:2.6))return;
    sites.push({direction:new Vector3(),local:[x,z],habit,scale,turn:rand()*Math.PI*2,phase:rand()*Math.PI*2,tint:rand()});
  };
  // Massive foreground columns, a quieter opening around the shrine, and
  // layered slender trunks beyond it. No tree is a ceremonial gate substitute.
  for(const [x,z,s] of [[-12,15,1.17],[13,21,1.09],[-18,-3,1.11],[20,-8,1.04],[-15,36,0.98],[16,43,1.08],[-26,27,1.12],[27,12,1.02],[-23,-22,0.96],[30,-28,1.1]])addLocal(x,z,0,s);
  for(const [x,z,s] of [[-12,-16,0.91],[11,-22,0.95],[-31,-10,0.9],[34,-4,0.88],[-34,44,0.97],[33,34,1],[-27,59,0.91],[24,62,0.98],[-7,-31,0.86],[6,-37,0.94],[-40,-32,0.94],[42,-27,0.9],[-42,12,1],[47,21,0.88]])addLocal(x,z,1,s);
  for(let i=0;i<42;i++){
    const x=(rand()<0.5?-1:1)*(8+rand()*43),z=-43+rand()*105;
    addLocal(x,z,2,0.62+rand()*0.52);
  }
  // Ground vegetation follows root pockets, with variable satellites rather
  // than a repeated ring around every tree or a uniform carpet over the path.
  const localTrees=sites.slice();
  for(const tree of localTrees){
    const [x,z]=tree.local!;
    const count=2+Math.floor(rand()*4),side=rand()*Math.PI*2;
    for(let i=0;i<count;i++){
      const a=side+(rand()-0.5)*2.1,reach=1.6+rand()*4;
      addLocal(x+Math.cos(a)*reach,z+Math.sin(a)*reach,3,0.65+rand()*0.85);
    }
  }
  for(let i=0;i<70;i++){
    const z=-28+rand()*80,x=(rand()<0.5?-1:1)*(5.5+rand()*9);
    addLocal(x,z,3,0.6+rand()*0.9);
  }
  const sphere=():Vector3=>{
    const y=rand()*2-1,a=rand()*Math.PI*2;
    return new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y));
  };
  const globalTrees:GroveSite[]=[];
  for(let stand=0;stand<54&&globalTrees.length<520;stand++){
    const center=sphere();
    const axis=new Vector3().crossVectors(center,Math.abs(center.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
    const cross=new Vector3().crossVectors(center,axis).normalize();
    const count=8+Math.floor(rand()*8),reach=0.23+rand()*0.16;
    for(let member=0;member<count&&globalTrees.length<520;member++){
      for(let attempt=0;attempt<10;attempt++){
        const a=rand()*Math.PI*2,r=reach*Math.sqrt(rand());
        const direction=center.clone().addScaledVector(axis,Math.cos(a)*r).addScaledVector(cross,Math.sin(a)*r*0.65).normalize();
        if(globalTrees.some(site=>site.direction.dot(direction)>Math.cos(0.057)))continue;
        const chance=rand(),habit=chance<0.34?0:chance<0.84?1:2;
        const site:GroveSite={direction,habit,scale:0.76+rand()*0.43,turn:rand()*Math.PI*2,phase:rand()*Math.PI*2,tint:rand()};
        sites.push(site);globalTrees.push(site);break;
      }
    }
  }
  for(const tree of globalTrees){
    const axis=new Vector3().crossVectors(tree.direction,Math.abs(tree.direction.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
    const cross=new Vector3().crossVectors(axis,tree.direction).normalize();
    const count=2+Math.floor(rand()*2);
    for(let i=0;i<count;i++){
      const a=rand()*Math.PI*2,r=(1.5+rand()*4.4)/128;
      sites.push({direction:tree.direction.clone().addScaledVector(axis,Math.cos(a)*r).addScaledVector(cross,Math.sin(a)*r).normalize(),habit:3,scale:0.65+rand()*0.75,turn:rand()*Math.PI*2,phase:rand()*Math.PI*2,tint:rand()});
    }
  }
  // Loose pockets beside the hiking trail, with glades between them. Offset,
  // habit and side vary so this reads as forest rather than a planted avenue.
  for(let i=0;i<68;i++){
    const theta=(i+rand()*0.85)/68*Math.PI*2,offset=(rand()<0.55?-1:1)*(8+rand()*15);
    const habit:0|1|2=rand()<0.2?0:rand()<0.65?1:2;
    const scale=0.76+rand()*0.28,phase=rand()*Math.PI*2;
    sites.push({direction:new Vector3(0,1,0),trail:[theta,offset],habit,scale,turn:rand()*Math.PI*2,phase,tint:rand()});
    for(let k=0;k<2;k++)sites.push({direction:new Vector3(0,1,0),trail:[theta+(rand()-0.5)*0.05,offset+(rand()-0.5)*4],habit:3,scale:0.7+rand()*0.45,turn:rand()*Math.PI*2,phase,tint:rand()});
  }
  // Equal-area coverage supplies a mature canopy on every side of the globe.
  // Small tangent jitter removes planting rows without recreating the large
  // random holes between stands. Understory still belongs to root colonies.
  const growth=canopyGrowthScale(radius);
  const count=Math.min(24000,Math.ceil(2800*Math.pow(radius/(128*growth),2)));
  const spacing=Math.sqrt(4*Math.PI/count),rotation=rand()*Math.PI*2;
  for(let i=0;i<count;i++){
    const y=1-2*(i+0.5)/count,angle=i*2.399963229728653+rotation;
    const direction=new Vector3(Math.cos(angle)*Math.sqrt(1-y*y),y,Math.sin(angle)*Math.sqrt(1-y*y));
    const axis=new Vector3().crossVectors(direction,Math.abs(y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
    const cross=new Vector3().crossVectors(direction,axis).normalize();
    const jitterAngle=rand()*Math.PI*2,jitter=(rand()-0.5)*spacing*0.28;
    direction.addScaledVector(axis,Math.cos(jitterAngle)*jitter).addScaledVector(cross,Math.sin(jitterAngle)*jitter).normalize();
    sites.push({direction,coverage:true,habit:rand()<0.3?0:1,scale:0.98+rand()*0.23,turn:rand()*Math.PI*2,phase:rand()*Math.PI*2,tint:rand()});
  }
  return sites;
}

interface Batch {
  mesh:Mesh<InstancedBufferGeometry,ShaderMaterial>;
  habit:number;
  coarse:boolean;
  anchor:InstancedBufferAttribute;
  across:InstancedBufferAttribute;
  placement:InstancedBufferAttribute;
}

interface PlacedSite {
  direction:Vector3;
  across:Vector3;
  ground:number;
  scale:number;
  phase:number;
  tint:number;
}

export class Grove {
  readonly group=new Group();
  private readonly batches:Batch[]=[];
  private readonly material:ShaderMaterial;
  private readonly time={value:0};
  private seed=Number.NaN;
  private radius=Number.NaN;
  private dirty=true;
  private sites:GroveSite[]=[];
  private readonly placed:PlacedSite[][]=[[],[],[],[]];
  private readonly focus=new Vector3();
  private altitude=Number.NaN;
  private visibleRootAngle=Math.PI;
  private cameraLod=false;

  constructor(shared:Record<string,IUniform>,terrain:Terrain){
    this.material=new ShaderMaterial({name:'Sequoia bark, needle boughs and fern floor',vertexShader,fragmentShader,uniforms:{...shared,uGroveTime:this.time},side:DoubleSide});
    this.group.name='Sequoia sacred grove';
    this.build(terrain.layout.seed,terrain.radius);
    this.update(0,terrain);
  }

  invalidate():void {this.dirty=true;}

  private batch(source:BufferGeometry,habit:number,coarse:boolean,name:string):void {
    const indexed=mergeVertices(source,1e-6),g=new InstancedBufferGeometry();
    for(const key of Object.keys(indexed.attributes))g.setAttribute(key,indexed.getAttribute(key));
    g.setIndex(indexed.index);source.dispose();indexed.dispose();
    const anchor=new InstancedBufferAttribute(new Float32Array(0),4);
    const across=new InstancedBufferAttribute(new Float32Array(0),3);
    const placement=new InstancedBufferAttribute(new Float32Array(0),4);
    g.setAttribute('aAnchor',anchor);g.setAttribute('aAcross',across);g.setAttribute('aPlacement',placement);g.instanceCount=0;
    const mesh=new Mesh(g,this.material);mesh.name=name;mesh.frustumCulled=false;
    mesh.userData.habit=habit;mesh.userData.detail=coarse?'canopy':'full';
    this.group.add(mesh);this.batches.push({mesh,habit,coarse,anchor,across,placement});
  }

  private build(seed:number,radius:number):void {
    for(const batch of this.batches){batch.mesh.removeFromParent();batch.mesh.geometry.dispose();}
    this.batches.length=0;this.seed=seed;
    this.sites=generateGroveSites(seed,radius);
    for(let habit=0;habit<3;habit++)this.batch(sequoiaGeometry(habit),habit,false,['Ancient fluted sequoias','Mature high-boughed sequoias','Young layered sequoias'][habit]);
    this.batch(groveFloorGeometry(),3,false,'Moss, wood ferns and root stones');
    for(let habit=0;habit<3;habit++)this.batch(sequoiaCanopyGeometry(habit),habit,true,['Distant ancient canopy','Distant mature canopy','Distant young canopy'][habit]);
    this.dirty=true;
  }

  update(time:number,terrain:Terrain,cameraDirection?:Vector3,cameraAltitude=0,maxVisibleRootAngle=Math.PI):void {
    this.time.value=time;
    if(this.seed!==terrain.layout.seed)this.build(terrain.layout.seed,terrain.radius);
    const moved=!!cameraDirection!==this.cameraLod||Math.abs(this.visibleRootAngle-maxVisibleRootAngle)>0.001||!!cameraDirection&&(this.focus.dot(cameraDirection)<0.999999||Math.abs(this.altitude-cameraAltitude)>0.5);
    if(!this.dirty&&this.radius===terrain.radius){if(moved)this.selectDetail(cameraDirection,cameraAltitude,maxVisibleRootAngle);return;}
    if(this.radius!==terrain.radius)this.sites=generateGroveSites(this.seed,terrain.radius);
    this.dirty=false;this.radius=terrain.radius;
    const R=terrain.radius,home=terrain.layout.cottage,forward=terrain.layout.homeBearing;
    const right=new Vector3().crossVectors(home,forward).normalize();
    const dir=new Vector3(),x=new Vector3(),z=new Vector3(),turned=new Vector3(),ground=createGroundSample();
    const growthScale=Math.min(1,Math.pow(R/128,0.32));
    const edges=forestNetwork(terrain.layout,R).spurs;
    const lengths=edges.map(edge=>Math.acos(Math.max(-1,Math.min(1,edge.a.dot(edge.b)))));
    const totalLength=lengths.reduce((total,length)=>total+length,0);
    for(const placed of this.placed)placed.length=0;
      for(const site of this.sites){
        if(site.trail){
          if(site.phase/(Math.PI*2)>Math.min(1,R/128))continue;
          const [theta,offset]=site.trail;
          let distance=theta/(Math.PI*2)*totalLength,edge=0;
          while(edge<lengths.length-1&&distance>lengths[edge])distance-=lengths[edge++];
          const t=Math.max(0.001,Math.min(0.999,distance/lengths[edge]));
          const centre=routeSpurCentre(terrain.layout,R,edge,t);
          const along=routeSpurCentre(terrain.layout,R,edge,t+0.0005);
          along.addScaledVector(centre,-along.dot(centre)).normalize();
          const across=new Vector3().crossVectors(centre,along).normalize();
          dir.copy(centre).multiplyScalar(Math.cos(offset/R)).addScaledVector(across,Math.sin(offset/R)).normalize();
        }else if(site.local){
          const [lx,lz]=site.local,d=Math.hypot(lx,lz),angle=Math.asin(Math.min(0.93,d/R));
          // At tiny radii the outer authored backdrop blends into the globe
          // stands instead of stacking many remote roots at one horizon.
          if(d>R*0.9)continue;
          dir.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right,lx/d*Math.sin(angle)).addScaledVector(forward,lz/d*Math.sin(angle)).normalize();
        }else{
          dir.copy(home).multiplyScalar(site.direction.y).addScaledVector(right,site.direction.x).addScaledVector(forward,site.direction.z).normalize();
          const homeDistance=Math.acos(Math.max(-1,Math.min(1,dir.dot(home))))*R;
          if(!site.coverage&&homeDistance<Math.min(45,R*1.15))continue;
          if(!site.coverage&&dir.dot(home)>0&&!groveRouteClear(dir.dot(right)*R,dir.dot(forward)*R,site.habit===3?1.1:2.6))continue;
        }
        const scale=site.scale*(site.habit===3?Math.min(1,Math.pow(R/128,0.2)):site.coverage?canopyGrowthScale(R):growthScale);
        // The same spherical route layout clears every shrine, the cabin and
        // every trail branch. Allow crowns overhead while keeping roots off paths.
        if(!terrain.placementClear(dir,(site.habit===3?1.2:site.habit===0?3.8:site.habit===1?2.8:1.5)*scale))continue;
        const ax=Math.fround(dir.x),ay=Math.fround(dir.y),az=Math.fround(dir.z);
        dir.set(ax,ay,az).normalize();terrain.sample(dir,ground);
        if(ground.height<-0.1)continue;
        // Ground trees only; crowns may overhang slopes. The broad buried
        // root skirts cover small substrate differences without floating feet.
        if(site.local)x.copy(right).addScaledVector(dir,-right.dot(dir)).normalize();
        else x.crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
        z.crossVectors(x,dir).normalize();turned.copy(x).multiplyScalar(Math.cos(site.turn)).addScaledVector(z,Math.sin(site.turn));
        this.placed[site.habit].push({direction:new Vector3(ax,ay,az),across:turned.clone(),ground:ground.height-(site.habit===3?0.04:0.15)*scale,scale,phase:site.phase,tint:site.tint});
      }
    this.selectDetail(cameraDirection,cameraAltitude,maxVisibleRootAngle);
  }

  private selectDetail(cameraDirection:Vector3|undefined,cameraAltitude:number,maxVisibleRootAngle:number):void {
    this.cameraLod=!!cameraDirection;this.altitude=cameraAltitude;
    this.visibleRootAngle=maxVisibleRootAngle;
    if(cameraDirection)this.focus.copy(cameraDirection);
    // Coarse crowns preserve the same rooted trees and their full height.
    // Only nearby woodland needs every fine spray and fluted root surface.
    const nearDot=Math.cos(80/this.radius),near=cameraAltitude<95,visibleDot=Math.cos(maxVisibleRootAngle);
    for(const batch of this.batches){
      const sites=this.placed[batch.habit];
      if(batch.anchor.count<sites.length){
        const capacity=2**Math.ceil(Math.log2(Math.max(1,sites.length)));
        // Release the old GPU attributes before replacing the growing instance
        // buffers; the retained template attributes upload again next draw.
        batch.mesh.geometry.dispose();
        batch.anchor=new InstancedBufferAttribute(new Float32Array(capacity*4),4);
        batch.across=new InstancedBufferAttribute(new Float32Array(capacity*3),3);
        batch.placement=new InstancedBufferAttribute(new Float32Array(capacity*4),4);
        batch.mesh.geometry.setAttribute('aAnchor',batch.anchor);batch.mesh.geometry.setAttribute('aAcross',batch.across);batch.mesh.geometry.setAttribute('aPlacement',batch.placement);
      }
      let count=0;
      for(const site of sites){
        if(cameraDirection&&site.direction.dot(cameraDirection)<visibleDot)continue;
        const detailed=batch.habit===3||!cameraDirection||near&&site.direction.dot(cameraDirection)>nearDot;
        if(batch.coarse===detailed)continue;
        batch.anchor.setXYZW(count,site.direction.x,site.direction.y,site.direction.z,site.ground);
        batch.across.setXYZ(count,site.across.x,site.across.y,site.across.z);
        batch.placement.setXYZW(count,site.scale,site.phase,site.tint,1);count++;
      }
      batch.mesh.geometry.instanceCount=count;
      batch.anchor.needsUpdate=true;batch.across.needsUpdate=true;batch.placement.needsUpdate=true;
    }
  }

  dispose():void {
    for(const batch of this.batches)batch.mesh.geometry.dispose();
    this.batches.length=0;this.material.dispose();this.group.clear();
  }
}
