import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../../src/core/math';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { CHALK_SHELF_CENTRE_HEIGHT, CHALK_SHELF_VARIANTS, chalkGeometry, chalkShelfGeometry, fanTreeGeometry, fernGeometry, coralGeometry, lichenGeometry, mossGeometry, plantedMossGeometry } from './canyonGeometry';
import { generateGroundcoverSites, groundcoverSupport, mossPlantCommunity, selectMossTreeSites } from './canyonGroundcover';
import { makeCanyonInk, type CanyonInk } from './canyonInk';
import { generateCanyonRockSites } from './canyonDistribution';
import vertexShader from './canyonScenery.vert.glsl?raw';
import fragmentShader from './canyonScenery.frag.glsl?raw';

interface Anchor { direction: Vector3; local?: readonly [number, number]; scale: number; turn: number; phase: number; tint: number; threshold: number; height?: number; heightScale?: number; embed?: number; groundcover?: boolean; supportScale?: number; }
interface Batch { ink: CanyonInk; mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>; anchors: Anchor[]; anchorData: InstancedBufferAttribute; acrossData: InstancedBufferAttribute; placementData: InstancedBufferAttribute; heightData: InstancedBufferAttribute; groundSlopeData: InstancedBufferAttribute; }
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
    const groundSlopeData=new InstancedBufferAttribute(new Float32Array(anchors.length*2),2);
    geometry.setAttribute('aGroundSlope',groundSlopeData);
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
    this.batches.push({ink,mesh,anchors,anchorData,acrossData,placementData,heightData,groundSlopeData});
  }

  private buildAnchors(terrain:Terrain):void{
    for(const b of this.batches){this.group.remove(b.mesh);b.ink.dispose();b.mesh.geometry.dispose();}
    this.batches.length=0;
    this.seed=terrain.layout.seed;
    let state=hash32(this.seed^0x51ca12);
    const rand=():number=>unit(state=hash32((state+0x9e3779b9)>>>0));
    const trees:Anchor[]=[],rocks:Anchor[]=[],ferns:Anchor[]=[],corals:Anchor[]=[],shelves:Anchor[]=[],lichen:Anchor[]=[],shrubs:Anchor[]=[],groundcover:Anchor[]=[];
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
      // A pocket has its own stable random stream. Its patch anatomy need not
      // consume the geology stream or change when another bed gains a leaf.
      let floraState=hash32(this.seed^hash32(Math.round(x*173))^hash32(Math.round(z*347)));
      const r=():number=>unit(floraState=hash32((floraState+0x9e3779b9)>>>0));
      const turn=r()*TAU;
      const abundance=r();
      // Small outliers and occasional broad colonies create quiet stretches
      // between dominant beds. A bed is not a fixed number of equal bushes.
      const extent=size*(abundance<0.18?0.48:abundance>0.76?2.15:0.8+r()*0.6);
      const lobes=abundance<0.18?1:abundance>0.76?3:2;
      const community=r(); // olive seam / shrub thicket / coral colony
      const place=(list:Anchor[],px:number,pz:number,scale:number,angle:number):void=>{
        // Leave foliage room as well as checking the root. This retains the
        // resident paths when a large colony reaches toward the corridor.
        if(safe(px,pz,Math.min(0.85,scale*0.55)))list.push({direction:new Vector3(),local:[px,pz],scale,turn:angle,heightScale:1,phase:r()*TAU,tint:r(),threshold:0});
      };
      const c=Math.cos(turn),sn=Math.sin(turn);
      for(let lobe=0;lobe<lobes;lobe++){
        const along=(lobe-(lobes-1)*0.35)*extent*(0.8+r()*0.4);
        const bend=Math.sin(lobe*1.8+community*4)*extent*0.42;
        const cx=x+c*along-sn*bend,cz=z+sn*along+c*bend;
        const reach=extent*(lobe===0?0.72:0.36+r()*0.22);
        const count=abundance<0.18?1:2+Math.floor(r()*3);
        for(let k=0;k<count;k++){
          const angle=r()*TAU,radial=Math.sqrt(r());
          const u=Math.cos(angle)*reach*radial,v=Math.sin(angle)*reach*radial*(0.35+community*0.4);
          const px=cx+c*u-sn*v,pz=cz+sn*u+c*v;
          place(lichen,px,pz,(0.48+r()*0.70)*Math.min(1.65,extent),turn+(r()-0.5)*1.7);
          if(community>0.35&&community<0.72&&r()>0.34)place(shrubs,px-sn*0.3,pz+c*0.3,(0.55+r()*0.85)*Math.min(1.5,extent),r()*TAU);
          if(community>=0.72&&r()>0.12)place(corals,px+c*0.2,pz+sn*0.2,(0.48+r()*0.9)*Math.min(1.4,extent),r()*TAU);
        }
        // Ivory is an occasional accent at a sheltered end, not one white
        // spike mechanically repeated in every red-and-green arrangement.
        if(lobe===0&&community<0.22&&r()>0.48)place(ferns,cx-sn*reach*0.55,cz+c*reach*0.55,0.55+r()*0.7,turn+0.4);
      }
      if(abundance>0.6){
        const along=extent*(1.8+r()),across=(r()-0.5)*extent;
        place(lichen,x+c*along-sn*across,z+sn*along+c*across,0.35+r()*0.28,r()*TAU);
      }
      for(let chip=0;chip<1+Math.floor(r()*4);chip++){
        const angle=r()*TAU,reach=(0.6+r()*1.3)*extent;
        const px=x+Math.cos(angle)*reach,pz=z+Math.sin(angle)*reach;
        if(safe(px,pz))rocks.push({direction:new Vector3(),local:[px,pz],scale:0.08+r()*0.18,turn:r()*TAU,heightScale:0.45+r()*0.4,phase:0,tint:r(),threshold:0});
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
    for(const [baseX,baseZ,baseScale,baseTurn,h0] of ledges){
      if(baseX>5&&baseX<38&&baseZ<-10)continue;
      const site=hash32(this.seed^hash32(Math.round(baseX*43+baseZ*97)));
      const sample=(salt:number):number=>unit(hash32(site^salt));
      // Leave the inhabited inner boundary in place; stagger the outer wall
      // into unequal promontories and recesses instead of parallel rows.
      const outer=Math.abs(baseX)>28;
      const x=baseX+(sample(71)-0.5)*(outer?5:1.4);
      const z=baseZ+(sample(139)-0.5)*(outer?6:2.2);
      const s=baseScale*(outer?0.64+sample(283)*0.62:0.85+sample(283)*0.24);
      const t=baseTurn+(sample(367)-0.5)*0.55;
      const h=h0*(x>8?0.42:0.88)*(0.7+sample(433)*0.62);
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
    for(const [x,z,s,h] of [[1,-7.4,1.25,1.55],[-8,-8.5,1.3,1.4]]){
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
    // Unequal colonies follow broad regions with open basins between them.
    // Transform canonical directions into the same home basis as local cliffs.
    const rockSites=generateCanyonRockSites(this.seed);
    for(const site of rockSites){
      const dir=home.clone().multiplyScalar(site.direction.y).addScaledVector(across,site.direction.x).addScaledVector(forward,site.direction.z).normalize();
      const gate=rand()*0.55;
      const anchor:Anchor={direction:dir,scale:(0.65+rand()*1.25)*site.sizeHint,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate};
      const shelfScale=(1.05+rand()*1.9)*site.sizeHint;
      const shelfHeight=0.35+Math.pow(rand(),0.8)*1.9;
      if(rand()<0.68+site.richness*0.2){
        shelves.push({...anchor,scale:shelfScale,heightScale:shelfHeight});
        anchor.height=(CHALK_SHELF_CENTRE_HEIGHT*shelfHeight-GROUND_EMBED)*shelfScale;
      }
      if(rand()<0.25+site.richness*0.64)trees.push(anchor);
      if(rand()<site.richness)lichen.push({...anchor,scale:anchor.height===undefined?0.55+rand()*1.2:(0.38+rand()*0.55)*shelfScale,height:anchor.height});
      if(rand()<site.richness*0.32)shrubs.push({...anchor,scale:0.45+rand()*1.1,height:anchor.height});
      const tangent=new Vector3().crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
      const bitangent=new Vector3().crossVectors(tangent,dir).normalize();
      const fragments=Math.floor(rand()*4);
      for(let k=0;k<fragments;k++){
        const angle=rand()*TAU,reach=0.014+rand()*0.045;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*reach).addScaledVector(bitangent,Math.sin(angle)*reach).normalize();
        rocks.push({direction:nearby,scale:(0.35+Math.pow(rand(),1.6)*3.8)*site.sizeHint,heightScale:0.24+rand()*1.1,turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
      }
      if(rand()<site.richness*0.5){
        const angle=rand()*TAU;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*0.023).addScaledVector(bitangent,Math.sin(angle)*0.023).normalize();
        const plant={direction:nearby,scale:0.45+rand()*1.0,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate};
        if(site.richness>0.7&&rand()>0.6)ferns.push(plant);else corals.push(plant);
        lichen.push({...plant,scale:0.6+rand()*1.2,direction:nearby.clone().addScaledVector(tangent,0.008).normalize()});
      }
    }
    // Broad ground colonies have their own random stream and do not change
    // the existing rock/tree recipe. Their low raised bodies retain physical
    // thickness; gentle terrain support is checked again after every bake.
    const mossSites=generateGroundcoverSites(this.seed,rockSites);
    for(const site of mossSites){
      const dir=home.clone().multiplyScalar(site.direction.y).addScaledVector(across,site.direction.x).addScaledVector(forward,site.direction.z).normalize();
      groundcover.push({direction:dir,scale:site.scale,turn:site.turn,phase:0,tint:unit(hash32(site.colony+this.seed)),threshold:0,groundcover:true});
    }
    // Append after the established trees: their three canopy assignments and
    // random stream stay intact. Soil-rooted trunks emerge through the moss;
    // the parent mat's complete footprint controls where a grove can survive.
    for(const tree of selectMossTreeSites(this.seed,mossSites)){
      const {site}=tree;
      const dir=home.clone().multiplyScalar(site.direction.y).addScaledVector(across,site.direction.x).addScaledVector(forward,site.direction.z).normalize();
      trees.push({direction:dir,scale:tree.scale,turn:site.turn,phase:tree.phase,tint:unit(hash32(site.colony+this.seed)),threshold:0,heightScale:1,groundcover:true,supportScale:site.scale});
    }
    // Broken seams at the exposed feet and gaps of actual chalk assemblies.
    // Keep the central support and resident clearances untouched.
    let seamState=hash32(this.seed^0x27d31a);
    const seamRandom=():number=>unit(seamState=hash32((seamState+0x9e3779b9)>>>0));
    for(const shelf of shelves){
      for(let i=0;i<6;i++){
        const side=i<3?-1:1;
        const u=side*(4.9+seamRandom()*1.1)*shelf.scale;
        const v=(0.4+seamRandom()*2.6)*shelf.scale;
        const dx=Math.cos(shelf.turn)*u-Math.sin(shelf.turn)*v;
        const dz=Math.sin(shelf.turn)*u+Math.cos(shelf.turn)*v;
        let anchor:Anchor;
        if(shelf.local){
          const px=shelf.local[0]+dx,pz=shelf.local[1]+dz;
          if(!safe(px,pz,1.4))continue;
          anchor=local(px,pz,0.65+seamRandom()*0.6,shelf.turn);
        }else{
          const axis=new Vector3().crossVectors(shelf.direction,Math.abs(shelf.direction.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
          const cross=new Vector3().crossVectors(axis,shelf.direction).normalize();
          anchor={...shelf,direction:shelf.direction.clone().addScaledVector(axis,dx/128).addScaledVector(cross,dz/128).normalize(),scale:0.75+seamRandom()*0.7,height:undefined,heightScale:1};
        }
        groundcover.push({...anchor,groundcover:true});
        if(i===1||i===4){
          const accent={...anchor,scale:0.65+seamRandom()*0.45,groundcover:true};
          if(seamRandom()<0.28)ferns.push(accent);else corals.push(accent);
        }
      }
    }
    this.batch(fanTreeGeometry(0),trees.filter((_,i)=>i%3===0),'Mature scarlet fan trees');
    // The terrain-conforming skirt owns the buried foot. Burying the complete
    // fragment by 0.08 m made its shallow satellite chip compete with terrain.
    this.batch(chalkGeometry(),rocks.map(anchor=>({...anchor,embed:0.02})),'Fractured chalk slabs');
    this.batch(fernGeometry(),ferns,'Ivory comb-ferns');
    // Stable site assignments vary planted coverage without rotating the rock
    // support out from under its trees. Neighbouring shelves can be lush/bare.
    const shelfGroups=Array.from({length:CHALK_SHELF_VARIANTS},()=>[] as Anchor[]);
    for(const shelf of shelves){
      const [x,z]=shelf.local??[shelf.direction.x*1000+shelf.direction.y*317,shelf.direction.z*1000];
      const choice=hash32(this.seed^hash32(Math.round(x*137))^hash32(Math.round(z*239)))%CHALK_SHELF_VARIANTS;
      shelfGroups[choice].push(shelf);
    }
    this.batch(chalkShelfGeometry(0),shelfGroups[0],'Connected chalk escarpments');
    this.batch(lichenGeometry(),lichen,'Creeping olive leaf carpets');
    this.batch(coralGeometry(),corals,'Scarlet lobed understory');
    this.batch(fanTreeGeometry(1),trees.filter((_,i)=>i%3===1),'Twin-crown scarlet fan trees');
    this.batch(fanTreeGeometry(2),trees.filter((_,i)=>i%3===2),'Young scarlet fan groves');
    this.batch(lichenGeometry(1),shrubs,'Twiggy olive shrubs');
    for(let variant=1;variant<CHALK_SHELF_VARIANTS;variant++)this.batch(chalkShelfGeometry(variant),shelfGroups[variant],`Connected chalk escarpments ${variant+1}`);
    const mossGroups:Anchor[][]=[[],[],[]];
    for(const anchor of groundcover){
      const direction=anchor.local?new Vector3(anchor.local[0]/128,1,anchor.local[1]/128).normalize():anchor.direction;
      mossGroups[mossPlantCommunity(this.seed,direction)+1].push(anchor);
    }
    this.batch(mossGeometry(1),mossGroups[0],'Broad living ground colonies and chalk seams');
    this.batch(plantedMossGeometry(0),mossGroups[1],'Coral and olive gardens rooted in moss');
    this.batch(plantedMossGeometry(1),mossGroups[2],'Ivory and olive gardens rooted in moss');
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
        // Grow complete opaque geometry out of the ground. A shelf and its
        // supported plants share this same site factor, so their scale and
        // vertical attachment offsets emerge together without screen-door ghosts.
        const scale=a.scale*presence;
        const support=(a.height??0)*presence;
        // Sample at the exact float32 anchor direction reconstructed by the
        // vertex shader, rather than at a nearby unquantized double direction.
        const anchorX=Math.fround(dir.x),anchorY=Math.fround(dir.y),anchorZ=Math.fround(dir.z);
        dir.set(anchorX,anchorY,anchorZ).normalize();
        terrain.sample(dir,this.ground);
        // Tangent orientation is deterministic; local fans face the home's approach.
        if(a.local)x.copy(right).addScaledVector(dir,-right.dot(dir)).normalize();
        else x.crossVectors(dir,Math.abs(dir.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
        z.crossVectors(x,dir).normalize();
        turned.copy(x).multiplyScalar(Math.cos(a.turn)).addScaledVector(z,Math.sin(a.turn));
        if(a.groundcover){
          const groundZ=new Vector3().crossVectors(turned,dir).normalize();
          const slope=groundcoverSupport(terrain,dir,turned,groundZ,(a.supportScale??a.scale)*presence*1.1);
          if(!slope)continue;
          // Moss follows the plane; trees use it for support but grow upright.
          batch.groundSlopeData.setXY(count,a.supportScale===undefined?slope[0]:0,a.supportScale===undefined?slope[1]:0);
        }else batch.groundSlopeData.setXY(count,0,0);
        batch.anchorData.setXYZW(count,anchorX,anchorY,anchorZ,this.ground.height-(a.embed??GROUND_EMBED)*scale+support);
        batch.acrossData.setXYZ(count,turned.x,turned.y,turned.z);
        batch.placementData.setXYZW(count,scale,a.phase,a.tint,1);
        batch.heightData.setX(count,a.heightScale??1);
        count++;
      }
      batch.mesh.geometry.instanceCount=count;
      batch.anchorData.needsUpdate=true;
      batch.acrossData.needsUpdate=true;
      batch.placementData.needsUpdate=true;
      batch.heightData.needsUpdate=true;
      batch.groundSlopeData.needsUpdate=true;
    }
  }

  dispose():void{
    for(const b of this.batches){b.ink.dispose();b.mesh.geometry.dispose();}
    this.material.dispose();
    this.group.clear();
  }
}
