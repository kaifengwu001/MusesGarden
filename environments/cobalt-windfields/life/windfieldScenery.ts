import { DoubleSide, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, LineSegments, Mesh, ShaderMaterial, Vector3, type Vector4, type BufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { createGroundSample, type Layout, type Terrain } from '../planet/terrain';
import { coralGeometry, driftingSeedGeometry, seedSailGeometry } from './windGeometry';
import { makeGeologyPrototypes, type GeologyPrototype } from './windGeology';
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
  id?: string; rockId?: string; seed?: boolean; burial?: number;
}
export interface WindfieldAnchors {
  rocks: WindfieldAnchor[][];
  sails: WindfieldAnchor[][];
  coral: WindfieldAnchor[][];
  seeds: WindfieldAnchor[];
}
interface Resolved { dir: Vector3; across: Vector3; height: number; footDepth: number; present: boolean; }
interface Batch {
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  outline?: LineSegments<InstancedBufferGeometry, ShaderMaterial>;
  anchors: WindfieldAnchor[]; resolved: Resolved[];
  anchorData: InstancedBufferAttribute; acrossData: InstancedBufferAttribute;
  placementData: InstancedBufferAttribute;
  footData: InstancedBufferAttribute;
  supportSites: readonly Vector3[];
  role: 'rock' | 'sail' | 'coral' | 'seed';
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
  const sails: WindfieldAnchor[][] = Array.from({ length: 3 }, () => []);
  const coral: WindfieldAnchor[][] = Array.from({ length: 3 }, () => []);
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
  const offsetFrom = (host: WindfieldAnchor, dx: number, dz: number, scale: number): WindfieldAnchor => {
    const x = (dx * Math.cos(host.turn) - dz * Math.sin(host.turn)) * host.scale;
    const z = (dx * Math.sin(host.turn) + dz * Math.cos(host.turn)) * host.scale;
    const anchor: WindfieldAnchor = { direction:host.direction.clone(), scale, turn:0.12+(rand()-0.5)*0.25, phase:rand()*TAU, tint:rand(), threshold:host.threshold, rockId:host.id };
    if (host.local) anchor.local = [host.local[0]+x,host.local[1]+z];
    else anchor.offset = [(host.offset?.[0] ?? 0)+x,(host.offset?.[1] ?? 0)+z];
    return anchor;
  };
  const plant = (groups: WindfieldAnchor[][],variant: number,anchor: WindfieldAnchor,clearance: number): boolean => {
    if(anchor.local&&!clearsWindfieldRoutes(anchor.local[0],anchor.local[1],clearance)) return false;
    // Keep roots distinct even where two accepted rocks share a lee edge.
    // Leaves may overlap in projection; stems never start at the same point.
    const spacing=groups===sails?0.34:0.16;
    if(groups.some(group=>group.some(other=>anchorDistance(anchor,other)<spacing*(anchor.scale+other.scale)))) return false;
    groups[variant].push(anchor);
    return true;
  };
  const ecology = (host: WindfieldAnchor, type: number, lushness: number, hero = false): void => {
    const proto = prototypes[type];
    const first=Math.floor(rand()*proto.leeSites.length);
    // Colonies follow two unequal stretches of a real front edge, leaving gaps.
    for(let seam=0;seam<(hero?2:1);seam++) {
      const site=proto.leeSites[(first+seam)%proto.leeSites.length];
      const count=2+Math.floor(rand()*lushness);
      const span=hero?3.3:2.1;
      for(let i=0;i<count;i++) {
        const dx=site[0]+(i/(count-1)-0.5)*span+(rand()-0.5)*0.28;
        const dz=site[1]+0.38+rand()*0.7;
        const age=rand();
        const anchor=offsetFrom(host,dx,dz,(0.46+Math.pow(age,0.65)*0.91)*(hero?1.1:1));
        anchor.turn=host.turn+(rand()-0.5)*1.35;
        plant(coral,Math.floor(rand()*3),anchor,Math.max(0.32,0.43*anchor.scale));
      }
    }
    if(hero||rand()<0.42) {
      const site=proto.leeSites[(first+1)%proto.leeSites.length];
      // One wind-shaped adult and occasional young plants share a pocket.
      // Age, heading and offset vary independently instead of stamping a row
      // of equally tall, front-facing two-leaf trees along every rock.
      const amount=hero?(rand()<0.6?3:2):(rand()<0.35?2:1);
      const adultScale=hero?1.12+rand()*0.68:0.80+rand()*0.65;
      const bearing=host.turn+(rand()-0.5)*2.6;
      const adultVariant=Math.floor(rand()*3);
      for(let i=0;i<amount;i++) {
        const young=i>0;
        const scale=young?adultScale*(0.28+rand()*0.26):adultScale;
        const side=i===2?-1:1;
        const dx=site[0]+(young?side*(1.1+rand()*1.7):(rand()-0.5)*0.7);
        const dz=site[1]+0.68+rand()*(young?1.25:0.55);
        const anchor=offsetFrom(host,dx,dz,scale);
        anchor.turn=bearing+(young?(side*0.9+(rand()-0.5)*1.1):0);
        const variant=young?(adultVariant+i)%3:adultVariant;
        plant(sails,variant,anchor,0.42+0.32*scale);
      }
    }
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
    const host=rock(type,local(x,z,scale,turn));
    if(host&&z> -26) ecology(host,type,5,z>25||x< -20&&z>5);
  }

  // Uneven connected ledge runs share a bedding direction but vary their
  // lengths, interruptions, height families and rubble skirts.
  const belts: readonly (readonly [number,number,number,number])[] = [
    [-29,-2,5,0.22],[-29,20,4,0.18],[-24,40,4,0.3],
    [31,29,4,0.21],[31,3,4,0.29],[-3,-31,5,0.23],[-35,-29,4,0.18],
  ];
  for(const [cx,cz,count,turn] of belts) {
    let along=-count*2.7;
    for(let i=0;i<count;i++) {
      along+=4.1+rand()*3.7;
      const x=cx+along*Math.cos(turn),z=cz+along*Math.sin(turn)+(rand()-0.5)*3;
      const type=[0,2,4,1][Math.floor(rand()*4)];
      const host=rock(type,local(x,z,0.7+rand()*0.4,turn+(rand()-0.5)*0.3));
      if(!host) continue;
      if(rand()<0.58) ecology(host,type,4,z>27);
      const site=prototypes[type].leeSites[Math.floor(rand()*3)];
      const rubbleCount=2+Math.floor(rand()*4);
      for(let k=0;k<rubbleCount;k++) {
        const child=offsetFrom(host,site[0]+(rand()-0.5)*6,site[1]+1.1+rand()*1.4,0.6+rand()*0.55);
        child.turn=turn+(rand()-0.5)*1.3;
        rock(k===0?4:7,child);
      }
    }
  }
  // Fallen stones have finite visible tops and sides. Their spacing follows
  // the foot of the bed; there is no near-total burial into triangular tips.
  for(const [cx,cz,spread] of [[-14,30,6],[-18,40,5],[-8,23,3],[22,29,5],[22,41,5],[-27,11,6],[18,11,3]]) {
    for(let i=0;i<5;i++) rock(7,local(cx+(rand()-0.5)*spread,cz+(rand()-0.5)*2.5,0.65+rand()*0.65,rand()*1.1));
  }

  const home=layout.cottage,forward=layout.homeBearing;
  const right=new Vector3().crossVectors(home,forward).normalize();
  const centres: Vector3[]=[];
  for(let attempt=0;centres.length<132&&attempt<2000;attempt++) {
    const y=1-2*rand(),angle=rand()*TAU,r=Math.sqrt(1-y*y);
    const centre=home.clone().multiplyScalar(y).addScaledVector(right,Math.cos(angle)*r).addScaledVector(forward,Math.sin(angle)*r).normalize();
    if(centre.dot(home)>Math.cos(0.42)) continue;
    // Broad sparse provinces, with some nearly empty sandy longitudes.
    const province=Math.sin(angle*2.3+y*4)+0.65*Math.cos(angle*5-y*3);
    if(province< -0.65&&rand()<0.8) continue;
    if(centres.some(other=>other.dot(centre)>Math.cos(0.1))) continue;
    centres.push(centre);
    const gate=rand(),heading=0.18+(rand()-0.5)*0.32;
    const global=(x:number,z:number,scale:number):WindfieldAnchor=>({ direction:centre,offset:[x,z],scale,turn:heading+(rand()-0.5)*0.11,phase:rand()*TAU,tint:rand(),threshold:gate });
    const rows=3+Math.floor(rand()*4);
    const lush=rand()>0.45;
    for(let i=0;i<rows;i++) {
      const type=[0,1,2,0,4][Math.floor(rand()*5)];
      const x=(i-(rows-1)/2)*(5.2+rand()*2.5),z=(rand()-0.5)*4;
      const host=rock(type,global(x,z,0.8+rand()*0.7));
      if(!host) continue;
      if(lush&&i%3===1) ecology(host,type,3);
      if(i%2===0) rock(3,global(x+(rand()-0.5)*4,z+5+rand()*3,0.55+rand()*0.55));
    }
    if(rand()<0.35) rock(5,global(-3,-3,0.8+rand()*0.45));
    if(rand()<0.12) rock(6,global(3,-4,0.65+rand()*0.4));
    for(let i=0;i<5;i++) rock(7,global((rand()-0.5)*25,4+rand()*6,0.65+rand()*0.65));
  }
  for(let i=0;i<14;i++) {
    const anchor=local(-8,-12+(i%4)*1.3,0.55+rand()*0.55);
    anchor.seed=true;
    seeds.push(anchor);
  }
  return {rocks,sails,coral,seeds};
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
    geometry.setAttribute('aAnchor', anchorData);
    geometry.setAttribute('aAcross', acrossData);
    geometry.setAttribute('aPlacement', placementData);
    geometry.setAttribute('aFootDepth',footData);
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
    this.batches.push({ mesh, outline, anchors, resolved, anchorData, acrossData, placementData, footData, supportSites, role });
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
        if(cameraDirection) {
          const dot=cameraDirection.dot(resolved.dir);
          if(dot< -0.12) continue;
          if(batch.role==='coral'&&(altitude>50||dot<Math.cos(Math.min(Math.PI,95/R)))) continue;
          if(batch.role==='sail'&&dot<Math.cos(Math.min(Math.PI,220/R))) continue;
          if(batch.role==='seed'&&altitude>65) continue;
        }
        const p=resolved.dir;
        batch.anchorData.setXYZW(count,p.x,p.y,p.z,resolved.height);
        batch.acrossData.setXYZ(count,resolved.across.x,resolved.across.y,resolved.across.z);
        batch.placementData.setXYZW(count,a.scale*presence,a.phase,a.tint,a.seed?1:0);
        batch.footData.setX(count,resolved.footDepth);
        count++;
      }
      batch.mesh.geometry.instanceCount=count;
      if(batch.outline) batch.outline.geometry.instanceCount=count;
      batch.anchorData.needsUpdate=true;batch.acrossData.needsUpdate=true;batch.placementData.needsUpdate=true;batch.footData.needsUpdate=true;
    }
  }

  dispose(): void {
    for(const b of this.batches) { b.mesh.geometry.dispose();b.outline?.geometry.dispose(); }
    this.material.dispose();this.outlineMaterial.dispose();this.group.clear();
  }
}
