import { DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, LineSegments, Mesh, ShaderMaterial, Vector3, type Vector4, type BufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Layout, type Terrain } from '../planet/terrain';
import { coralGeometry, driftingSeedGeometry, seedSailGeometry } from './windGeometry';
import { makeGeologyPrototypes, type GeologyPrototype } from './windGeology';
import { createWindfieldEcology, type CoralColony } from './windfieldEcology';
import { distantCoralGeometry } from './windfieldCoralLod';
import { WindfieldRootClearance } from './windfieldRootClearance';
import vertexShader from './windfieldScenery.vert.glsl?raw';
import fragmentShader from './windfieldScenery.frag.glsl?raw';
import outlineVertex from './windRockOutline.vert.glsl?raw';
import outlineFragment from './windRockOutline.frag.glsl?raw';

export interface WindfieldAnchor {
  direction: Vector3;
  local?: readonly [number, number];
  /** Physical offsets in the tangent frame of a persistent global formation. */
  offset?: readonly [number, number];
  scale: number; turn: number; phase: number; tint: number; threshold: number;
  id?: string; rockId?: string; formationId?: string; seed?: boolean; burial?: number;
}
export interface WindfieldAnchors {
  rocks: WindfieldAnchor[][];
  sails: WindfieldAnchor[][];
  coral: WindfieldAnchor[][];
  seeds: WindfieldAnchor[];
  colonies: CoralColony[];
}
interface Resolved { dir: Vector3; across: Vector3; height: number; footDepth: number; present: boolean; }
interface Batch {
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  outline?: LineSegments<InstancedBufferGeometry, ShaderMaterial>;
  anchors: WindfieldAnchor[]; resolved: Resolved[];
  anchorData: InstancedBufferAttribute; acrossData: InstancedBufferAttribute;
  placementData: InstancedBufferAttribute;
  footData: InstancedBufferAttribute;
  coralLodData: InstancedBufferAttribute;
  supportSites: readonly Vector3[];
  role: 'rock' | 'sail' | 'coral' | 'coral-far' | 'seed';
}
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);

function rectangleDistance(x: number, z: number, cx: number, cz: number, hx: number, hz: number): number {
  return Math.hypot(Math.max(0, Math.abs(x - cx) - hx), Math.max(0, Math.abs(z - cz) - hz));
}

// ResidentLife walks scaled ellipses around these three homes. Reserve each
// entire occupied region (including every smaller loop and fallback centre),
// rather than clearing the whole rectangle between them.
const RESIDENT_REGIONS = [[-7.2,12],[0,17],[7.2,12]] as const;
function residentRegionDistance(x: number,z: number): number {
  return Math.min(...RESIDENT_REGIONS.map(([cx,cz])=>{
    const normalized=Math.hypot((x-cx)/2.25,(z-cz)/1.8);
    // Scaling by the smaller ellipse axis is a conservative distance bound.
    return Math.max(0,normalized-1)*1.8;
  }));
}

/** Rock clearance for actual resident regions, wildlife, and the reference camera. */
export function clearsWindfieldRoutes(x: number, z: number, footprint: number): boolean {
  if (rectangleDistance(x,z,0,0,8.2,7) < footprint + 0.35) return false;
  if (residentRegionDistance(x,z) < footprint + 0.9) return false;
  if (Math.hypot(x-7,z-48) < footprint + 2) return false;
  // Native animals occupy foreground routes, with rock and flora at their borders.
  if (rectangleDistance(x,z,-1,36,2.6,1.2) < footprint + 0.75) return false;
  if (rectangleDistance(x,z,10.5,35.5,2,1.1) < footprint + 0.55) return false;
  if (rectangleDistance(x,z,9.15,38.4,1.35,1) < footprint + 0.35) return false;
  if (z > 20 && z < 58) {
    const path = 6.5 + Math.sin((z - 20) * 0.095) * 1.2;
    if (Math.abs(x - path) < footprint + 1.8) return false;
  }
  return true;
}

/**
 * Seeded formations have shared bedding, uneven eroded skirts and empty sand
 * between them. Plants are placed from the lee edges of actual accepted rocks.
 */
export function createWindfieldAnchors(layout: Layout, prototypes: readonly GeologyPrototype[]): WindfieldAnchors {
  let state = hash32(layout.seed ^ 0xc0ba147);
  const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
  const rocks: WindfieldAnchor[][] = prototypes.map(() => []);
  const seeds: WindfieldAnchor[] = [];
  const local = (x: number, z: number, scale: number, turn = 0): WindfieldAnchor => ({ direction: new Vector3(), local:[x,z], scale, turn, phase:rand()*TAU, tint:rand(), threshold:0 });
  const anchorDistance = (a: WindfieldAnchor,b: WindfieldAnchor): number => {
    if(a.local&&b.local) return Math.hypot(a.local[0]-b.local[0],a.local[1]-b.local[1]);
    if(!a.local&&!b.local&&a.direction.distanceToSquared(b.direction)<1e-12) {
      return Math.hypot((a.offset?.[0]??0)-(b.offset?.[0]??0),(a.offset?.[1]??0)-(b.offset?.[1]??0));
    }
    return Infinity;
  };
  let serial = 0;
  const rock = (type: number, anchor: WindfieldAnchor): WindfieldAnchor | undefined => {
    if (anchor.local && !clearsWindfieldRoutes(anchor.local[0], anchor.local[1], prototypes[type].footprint * anchor.scale)) return;
    // Connected beds can intersect, but a second copy of the same transformed
    // surface has no physical meaning and would compete for the same depth.
    if(rocks[type].some(other=>anchorDistance(anchor,other)<0.06&&Math.abs(anchor.scale-other.scale)<0.015&&Math.abs(Math.sin((anchor.turn-other.turn)/2))<0.006)) return;
    anchor.id = `rock-${serial++}`;
    rocks[type].push(anchor);
    return anchor;
  };
  // The opening composition is a valley between unequal bedrock masses, not a
  // ring of fins. Foreground animals keep open sand pockets between these beds.
  const landmarks: readonly (readonly [number,number,number,number,number])[] = [
    [6,-27,24,1.28,0.08], [5,-27,8,1.32,0.14], [1,-26,33,1.35,0.20],
    [0,0,43.6,0.72,-0.32], [2,-8.3,41,0.65,-0.26], [4,-5.7,40,0.5,0.27],
    [0,-7.3,33,0.55,-0.24], [3,13.1,44.4,0.64,-0.25], [4,16.1,41.7,0.84,0.12],
    [1,-13,46,1.14,0.20], [0,-15,37,1.02,0.28], [2,-14,26,1.0,0.18],
    [3,-22,40,1.1,-0.18], [4,-7,29,0.82,0.35], [2,-7,23,0.55,0.12],
    [0,-1,25,0.48,0.22], [4,-1,20.8,0.52,-0.14],
    [1,25,43,1.22,0.17], [0,25,31,1.12,0.26], [4,17,28,0.72,-0.25],
    [2,26,19,0.95,0.21], [3,19,11,1.05,0.35], [0,27,7,0.9,0.3],
    [8,25,-9,1.28,-0.12], [6,9,-18,0.93,0.04], [4,-11,-12,0.9,0.2],
    [5,-31,-17,1.18,0.24], [6,-45,-36,1.12,0.05],
    [1,-28,-42,1.6,0.24], [5,-17,-35,1.22,0.28], [2,-8,-43,1.5,0.18], [1,19,-43,1.6,0.28],
    [5,0,-48,1.65,0.15], [3,-12,-24,1.8,-0.15], [1,11,-29,1.7,0.27],
    [6,-52,-67,1.45,0.22], [3,-27,-76,2.4,0.12], [2,-8,-72,2.4,0.21],
    [6,22,-73,1.3,0.1], [1,43,-58,2.0,0.24],
  ];
  for(const [type,x,z,scale,turn] of landmarks) {
    const anchor=local(x,z,scale,turn);
    anchor.formationId=`home-landmark-${Math.floor(x/16)}-${Math.floor(z/18)}`;
    rock(type,anchor);
  }

  // A formation is a wandering deposit, an uneven two-dimensional scatter,
  // or a few isolated remnants. Shared geology does not imply repeated rows.
  const formation=(place:(x:number,z:number,scale:number,turn:number)=>WindfieldAnchor,
    count:number,extent:number,aspect:number,heading:number,habit:number,id:string):void=>{
    let walkX=-extent*.5,walkZ=(rand()-.5)*extent*.15;
    const lobes=Array.from({length:2+Math.floor(rand()*3)},()=>({x:(rand()-.5)*extent,z:(rand()-.5)*extent/aspect}));
    for(let i=0;i<count;i++) {
      let x:number,z:number;
      if(habit===0) {
        walkX+=extent/count*(.65+rand()*.85);
        walkZ+=(rand()-.42)*extent/count*.8;
        x=walkX;z=walkZ+Math.sin(i*.58+heading)*extent*.09;
      } else {
        const lobe=lobes[Math.floor(rand()*lobes.length)];
        const angle=rand()*TAU,r=Math.sqrt(rand());
        x=lobe.x+Math.cos(angle)*r*extent*.30;
        z=lobe.z+Math.sin(angle)*r*extent*.30/aspect;
      }
      const rotatedX=x*Math.cos(heading)-z*Math.sin(heading);
      const rotatedZ=x*Math.sin(heading)+z*Math.cos(heading);
      const selection=rand();
      let type=selection<.28?7:selection<.48?4:selection<.64?2:selection<.77?0:selection<.90?3:1;
      if(selection>.54&&rand()<.48)type=9+Math.floor(rand()*4);
      // Few tall signatures, many low fragments; a large cluster is not a
      // scaled copy of a small one with the same number of peaks.
      if(i===0&&count>14&&rand()<.60)type=[5,6,8][Math.floor(rand()*3)];
      const scale=type===7?.38+Math.pow(rand(),1.5)*1.25:.48+Math.pow(rand(),1.6)*1.50;
      const turn=heading+(rand()-.5)*(habit===0?.72:2.8);
      const a=place(rotatedX,rotatedZ,scale,turn);a.formationId=id;rock(type,a);
    }
  };
  // Keep the valley and its authored landmarks, but break the flanking skirts
  // into unequal banks, loose fragments and broad, connected rocky pockets.
  const localPockets:readonly(readonly[number,number,number,number,number,number])[]=[
    [-28,30,18,25,1.2,.2],[-25,7,8,17,3.7,1.25],[-33,-18,24,32,1.3,-.6],
    [28,27,21,29,1.0,2.2],[31,4,6,14,2.8,.6],[24,-28,27,36,1.4,-.8],
    [-11,-38,14,25,4.0,.3],[12,-55,10,20,1.1,1.9],
  ];
  localPockets.forEach(([cx,cz,count,extent,aspect,heading],i)=>
    formation((x,z,scale,turn)=>local(cx+x,cz+z,scale,turn),count,extent,aspect,heading,aspect>2?0:1,`home-pocket-${i}`));
  for(const [cx,cz,spread] of [[-14,30,6],[-18,40,5],[-8,23,3],[22,29,5],[22,41,5],[18,11,3]]) {
    const count=2+Math.floor(rand()*7);
    for(let i=0;i<count;i++) {
      const a=local(cx+(rand()-.5)*spread,cz+(rand()-.5)*spread*.6,.4+rand()*.9,rand()*TAU);
      a.formationId=`loose-${cx}-${cz}`;rock(7,a);
    }
  }

  const home=layout.cottage,forward=layout.homeBearing;
  const right=new Vector3().crossVectors(home,forward).normalize();
  const sphere=():Vector3=>{
    const y=1-2*rand(),angle=rand()*TAU,r=Math.sqrt(1-y*y);
    return home.clone().multiplyScalar(y).addScaledVector(right,Math.cos(angle)*r).addScaledVector(forward,Math.sin(angle)*r).normalize();
  };
  const provinces:Vector3[]=[];
  for(let attempt=0;provinces.length<22&&attempt<1800;attempt++) {
    const centre=sphere();
    if(centre.dot(home)>.91||provinces.some(other=>other.dot(centre)>.95))continue;
    provinces.push(centre);
  }
  const centres:Vector3[]=[];
  let serialFormation=0;
  const populate=(centre:Vector3,heading:number,count:number,extent:number,aspect:number,habit:number):void=>{
    if(centre.dot(home)>Math.cos(.45))return;
    // Loose outer formations may nearly touch a dense province, but identical
    // anchor domains would create competing copies of the same surfaces.
    if(centres.some(other=>other.dot(centre)>Math.cos(.035)))return;
    centres.push(centre);
    const gate=rand(),id=`formation-${serialFormation++}`;
    const place=(x:number,z:number,scale:number,turn:number):WindfieldAnchor=>({direction:centre,offset:[x,z],scale,turn,phase:rand()*TAU,tint:rand(),threshold:gate,formationId:id});
    formation(place,count,extent,aspect,heading,habit,id);
  };
  for(const province of provinces) {
    const axis=new Vector3().crossVectors(province,Math.abs(province.y)<.9?UP:SIDE).normalize();
    const second=new Vector3().crossVectors(axis,province).normalize();
    const reach=.17+rand()*.38,heading=rand()*TAU;
    const families=5+Math.floor(rand()*7);
    for(let i=0;i<families;i++) {
      const radius=Math.pow(rand(),.7)*reach,angle=rand()*TAU;
      const centre=province.clone().multiplyScalar(Math.cos(radius)).addScaledVector(axis,Math.sin(radius)*Math.cos(angle)).addScaledVector(second,Math.sin(radius)*Math.sin(angle)).normalize();
      const occupancy=rand(),count=occupancy<.22?2+Math.floor(rand()*3):occupancy>.72?18+Math.floor(rand()*15):6+Math.floor(rand()*9);
      const habit=rand()<.33?0:1;
      const extent=count<5?4+rand()*7:count>17?24+rand()*22:12+rand()*19;
      const aspect=habit===0?2.5+rand()*3.0:.8+rand()*1.1;
      populate(centre,heading+(rand()-.5)*1.25,count,extent,aspect,habit);
    }
  }
  // Remnants outside the main provinces make the transition to empty sand
  // uneven instead of repeating the same gap around every large group.
  for(let i=0;i<48;i++)populate(sphere(),rand()*TAU,1+Math.floor(rand()*5),3+rand()*9,1+rand()*2,rand()<.4?0:1);
  // A stratified sphere-wide survey fills the widest bare gaps, while keeping
  // small sand clearings between deposits and the authored settlement intact.
  for(let i=0;i<100;i++) {
    const y=1-2*(i+.5)/100,angle=i*2.399963229728653+layout.seed*.17,r=Math.sqrt(1-y*y);
    const centre=home.clone().multiplyScalar(y).addScaledVector(right,Math.cos(angle)*r).addScaledVector(forward,Math.sin(angle)*r).normalize();
    if(centres.some(other=>other.dot(centre)>Math.cos(.14)))continue;
    populate(centre,rand()*TAU,6+Math.floor(rand()*10),13+rand()*14,.9+rand()*1.8,rand()<.3?0:1);
  }

  for(let i=0;i<14;i++) {
    const anchor=local(-8,-12+(i%4)*1.3,0.55+rand()*0.55);
    anchor.seed=true;
    seeds.push(anchor);
  }
  const ecology=createWindfieldEcology(layout,rocks,prototypes);
  return {rocks,seeds,...ecology};
}

/** Rock-dominated terrain dressing; animated animals live in WindWildlife. */
export class WindfieldScenery {
  readonly group = new Group();
  readonly ready = true;
  private readonly material: ShaderMaterial;
  private readonly outlineMaterial: ShaderMaterial;
  private readonly wind: IUniform<Vector4>;
  private readonly batches: Batch[] = [];
  private readonly time = { value: 0 };
  private seed = Number.NaN;
  private radius = Number.NaN;
  private dirty = true;
  private readonly ground = createGroundSample();
  private readonly dir = new Vector3();
  private readonly x = new Vector3();
  private readonly z = new Vector3();
  private readonly turned = new Vector3();
  private readonly right = new Vector3();
  private readonly supportDirection = new Vector3();
  private readonly supportForward = new Vector3();
  private readonly previousView = new Vector3();
  private previousAltitude = Number.NaN;
  private rootClearance?: WindfieldRootClearance;
  private plantClearance=new WeakMap<WindfieldAnchor,boolean>();

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    this.wind = shared.uWindVec as IUniform<Vector4>;
    this.material = new ShaderMaterial({ name: 'Cobalt bedrock and sheltered flora', vertexShader, fragmentShader, uniforms: { ...shared, uSceneryTime: this.time }, side: DoubleSide });
    this.outlineMaterial=new ShaderMaterial({name:'Cobalt geological ink edges',vertexShader:outlineVertex,fragmentShader:outlineFragment,uniforms:shared,depthTest:true,depthWrite:false,toneMapped:false});
    this.group.name = 'Fractured cobalt landforms and sheltered ivory sails';
    this.buildAnchors(terrain);
    this.update(0, terrain);
  }

  invalidate(): void { this.dirty = true; }

  private batch(base: BufferGeometry, anchors: WindfieldAnchor[], name: string, role: Batch['role'], outlineBase?: BufferGeometry, supportSites: readonly Vector3[] = []): void {
    const geometry = new InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) geometry.setAttribute(name, base.getAttribute(name));
    geometry.setIndex(base.index);
    if(!geometry.getAttribute('aGround')) geometry.setAttribute('aGround',new Float32BufferAttribute(new Float32Array(base.getAttribute('position').count),1));
    const anchorData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    const acrossData = new InstancedBufferAttribute(new Float32Array(anchors.length * 3), 3);
    const placementData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    const footData = new InstancedBufferAttribute(new Float32Array(anchors.length),1);
    const coralLodData = new InstancedBufferAttribute(new Float32Array(anchors.length),1);
    geometry.setAttribute('aAnchor', anchorData);
    geometry.setAttribute('aAcross', acrossData);
    geometry.setAttribute('aPlacement', placementData);
    geometry.setAttribute('aFootDepth',footData);
    geometry.setAttribute('aCoralLod',coralLodData);
    geometry.instanceCount = 0;
    const mesh = new Mesh(geometry, this.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    let outline: LineSegments<InstancedBufferGeometry, ShaderMaterial> | undefined;
    if(outlineBase) {
      const edgeGeometry=new InstancedBufferGeometry();
      edgeGeometry.setAttribute('position',outlineBase.getAttribute('position'));
      edgeGeometry.setAttribute('normal',outlineBase.getAttribute('normal'));
      edgeGeometry.setAttribute('aGround',outlineBase.getAttribute('aGround'));
      edgeGeometry.setAttribute('aFootDepth',footData);
      edgeGeometry.setAttribute('aAnchor',anchorData);
      edgeGeometry.setAttribute('aAcross',acrossData);
      edgeGeometry.setAttribute('aPlacement',placementData);
      edgeGeometry.instanceCount=0;
      outline=new LineSegments(edgeGeometry,this.outlineMaterial);
      outline.name=`${name} ink edges`;
      outline.frustumCulled=false;
      outline.renderOrder=1;
      this.group.add(outline);
    }
    const resolved=anchors.map(()=>({dir:new Vector3(),across:new Vector3(),height:0,footDepth:0,present:false}));
    this.batches.push({ mesh, outline, anchors, resolved, anchorData, acrossData, placementData, footData, coralLodData, supportSites, role });
  }

  private buildAnchors(terrain: Terrain): void {
    for(const batch of this.batches) {
      this.group.remove(batch.mesh);batch.mesh.geometry.dispose();
      if(batch.outline) { this.group.remove(batch.outline);batch.outline.geometry.dispose(); }
    }
    this.batches.length=0;
    this.seed=terrain.layout.seed;
    const prototypes=makeGeologyPrototypes();
    const plan=createWindfieldAnchors(terrain.layout,prototypes);
    prototypes.forEach((prototype,index)=>this.batch(prototype.geometry,plan.rocks[index],prototype.name,'rock',prototype.outline,prototype.supportSites));
    for(let variant=0;variant<3;variant++) {
      this.batch(seedSailGeometry(variant),plan.sails[variant],`Ivory seed sails ${variant+1}`,'sail');
      this.batch(coralGeometry(variant),plan.coral[variant],`Sheltered coral ${variant+1}`,'coral');
    }
    this.batch(distantCoralGeometry(),plan.coral.flat(),'Distant coral fields','coral-far');
    this.batch(driftingSeedGeometry(),plan.seeds,'Windborne seeds','seed');
    this.dirty=true;
  }

  update(time: number, terrain: Terrain, cameraDirection?: Vector3, altitude = 0): void {
    this.time.value=time;
    if(terrain.layout.seed!==this.seed) this.buildAnchors(terrain);
    const rebuild=this.dirty||terrain.radius!==this.radius;
    const viewChanged=!!cameraDirection&&(this.previousView.distanceToSquared(cameraDirection)>1e-7||Math.abs(this.previousAltitude-altitude)>0.1);
    if(cameraDirection) this.previousView.copy(cameraDirection);
    this.previousAltitude=altitude;
    this.radius=terrain.radius;this.dirty=false;
    const R=terrain.radius,home=terrain.layout.cottage,forward=terrain.layout.homeBearing;
    const right=this.right.crossVectors(home,forward).normalize();
    const {dir,x,z,turned}=this;
    if(rebuild) {
      this.rootClearance=new WindfieldRootClearance(R);
      this.plantClearance=new WeakMap();
    }
    const active=Math.min(1,0.38+R/128*0.5);
    for(const batch of this.batches) {
      if(!rebuild&&!viewChanged&&batch.role!=='seed') continue;
      let count=0;
      for(let index=0;index<batch.anchors.length;index++) {
        const a=batch.anchors[index],resolved=batch.resolved[index];
        const expansion=a.threshold===0?1:Math.min(1,Math.max(0,(active-a.threshold)/0.07));
        const localPresence=a.local?Math.min(1,Math.max(0,(R*0.95-Math.hypot(...a.local))/6)):1;
        const presence=expansion*localPresence;
        if(presence<=0) continue;
        if(rebuild||batch.role==='seed') {
          let turn=a.turn,floating=0;
          if(a.local) {
            let [lx,lz]=a.local;
            if(a.seed) {
              lx+=((time*this.wind.value.w+a.phase*5)%26)-13;
              lz+=Math.sin(time*0.31+a.phase)*0.4;
              floating=1.3+(a.phase*2)%3.5+Math.sin(time*0.5+a.phase)*0.15;
              turn=time*0.35+a.phase;
            }
            const distance=Math.hypot(lx,lz),angle=Math.asin(Math.min(0.95,distance/R));
            dir.copy(home).multiplyScalar(Math.cos(angle));
            if(distance>1e-6) dir.addScaledVector(right,lx/distance*Math.sin(angle)).addScaledVector(forward,lz/distance*Math.sin(angle));
            dir.normalize();
            x.copy(right).addScaledVector(dir,-right.dot(dir)).normalize();
          } else {
            const [lx,lz]=a.offset??[0,0];
            x.crossVectors(a.direction,Math.abs(a.direction.y)<0.9?UP:SIDE).normalize();
            z.crossVectors(x,a.direction).normalize();
            const distance=Math.hypot(lx,lz),angle=distance/R;
            dir.copy(a.direction).multiplyScalar(Math.cos(angle));
            if(distance>1e-6) dir.addScaledVector(x,lx/distance*Math.sin(angle)).addScaledVector(z,lz/distance*Math.sin(angle));
            dir.normalize();
            x.addScaledVector(dir,-x.dot(dir)).normalize();
          }
          resolved.present=!!a.local||dir.dot(home)<=Math.cos(Math.min(Math.PI,62/R));
          terrain.sample(dir,this.ground);
          z.crossVectors(x,dir).normalize();
          turned.copy(x).multiplyScalar(Math.cos(turn)).addScaledVector(z,Math.sin(turn));
          resolved.dir.copy(dir);resolved.across.copy(turned);
          resolved.height=this.ground.height+(a.seed?floating:-(a.burial??0.09*a.scale));
          resolved.footDepth=0;
          if(batch.supportSites.length) {
            // Extend only the structural feet to the lowest actual support.
            // The exposed cap and sand mantle retain their authored heights.
            const scale=a.scale*presence;
            this.supportForward.crossVectors(turned,dir).normalize();
            for(const site of batch.supportSites) {
              const sx=site.x*scale,sz=site.z*scale,d=Math.hypot(sx,sz),angle=Math.asin(Math.min(d/R,0.9));
              this.supportDirection.copy(dir).multiplyScalar(Math.cos(angle));
              if(d>1e-6) this.supportDirection.addScaledVector(turned,sx/d*Math.sin(angle)).addScaledVector(this.supportForward,sz/d*Math.sin(angle));
              terrain.sample(this.supportDirection.normalize(),this.ground);
              resolved.footDepth=Math.max(resolved.footDepth,resolved.height+site.y*scale-this.ground.height+0.18);
            }
          }
        }
        if(!resolved.present) continue;
        // Rock batches precede plants. Register every active rock before
        // view culling, so overlapping neighbouring formations cannot grow
        // vegetation through one another as the sphere changes size.
        if(rebuild&&batch.role==='rock')this.rootClearance!.add(batch.mesh.geometry,resolved.dir,resolved.across,resolved.height,a.scale*presence,resolved.footDepth);
        if(rebuild&&(batch.role==='sail'||batch.role==='coral'||batch.role==='coral-far')) {
          let clear=this.plantClearance.get(a);
          if(clear===undefined) {
            const groundHeight=resolved.height+(a.burial??.09*a.scale);
            clear=!this.rootClearance!.blocked(resolved.dir,groundHeight);
            this.plantClearance.set(a,clear);
          }
          resolved.present=clear;
          if(!clear)continue;
        }
        let coralLod=0;
        if(cameraDirection) {
          const dot=cameraDirection.dot(resolved.dir);
          if(dot< -0.12) continue;
          if(batch.role==='coral'||batch.role==='coral-far') {
            const distance=Math.sqrt(Math.max(0,R*R+(R+altitude)*(R+altitude)-2*R*(R+altitude)*dot));
            // The distant representation preserves every accepted root. It
            // replaces detailed branches rather than dropping whole fields.
            const t=Math.min(1,Math.max(0,(distance-18-8*a.scale)/20));
            const detail=1-t*t*(3-2*t);
            if(batch.role==='coral'?detail<=0:detail>=1)continue;
            coralLod=(batch.role==='coral'?1:-1)*(1+detail);
          }
          // Sails remain visible across the globe; back-facing instances are
          // already culled above and depth testing hides the far hemisphere.
          if(batch.role==='seed'&&altitude>65) continue;
        }
        if(!cameraDirection&&batch.role==='coral-far')continue;
        const p=resolved.dir;
        batch.anchorData.setXYZW(count,p.x,p.y,p.z,resolved.height);
        batch.acrossData.setXYZ(count,resolved.across.x,resolved.across.y,resolved.across.z);
        batch.placementData.setXYZW(count,a.scale*presence,a.phase,a.tint,a.seed?1:0);
        batch.footData.setX(count,resolved.footDepth);
        batch.coralLodData.setX(count,coralLod);
        count++;
      }
      batch.mesh.geometry.instanceCount=count;
      if(batch.outline) batch.outline.geometry.instanceCount=count;
      batch.anchorData.needsUpdate=true;batch.acrossData.needsUpdate=true;batch.placementData.needsUpdate=true;batch.footData.needsUpdate=true;batch.coralLodData.needsUpdate=true;
    }
  }

  dispose(): void {
    for(const b of this.batches) { b.mesh.geometry.dispose();b.outline?.geometry.dispose(); }
    this.material.dispose();this.outlineMaterial.dispose();this.group.clear();
    this.rootClearance=undefined;this.plantClearance=new WeakMap();
  }
}
