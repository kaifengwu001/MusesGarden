import { DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4, type BufferGeometry, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { geometryBytes, gpuMemory } from '../../../src/core/gpuMemory';
import { createGroundSample, type Terrain } from '../planet/terrain';
import { chalkGeometry, reedColonyGeometry, fernGeometry, lampPetalGeometry, mesaGeometry, pebblePatchGeometry } from './canyonGeometry';
import vertexShader from './canyonScenery.vert.glsl?raw';
import fragmentShader from './canyonScenery.frag.glsl?raw';

interface Anchor {
  direction: Vector3;
  local?: readonly [number, number];
  scale: number;
  turn: number;
  phase: number;
  tint: number;
  threshold: number;
  height?: number;
  groundHeight?: number;
  water?: number;
  variant?: number;
  light?: number;
}
type Habitat = 'reeds' | 'stone' | 'herbs' | 'pebbles' | 'mesas' | 'pollinators';
interface Batch {
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  anchors: Anchor[];
  habitat: Habitat;
  anchorData: InstancedBufferAttribute;
  acrossData: InstancedBufferAttribute;
  placementData: InstancedBufferAttribute;
}
interface WaterFooting {
  x: number;
  z: number;
  rx: number;
  rz: number;
  cos: number;
  sin: number;
  round: boolean;
}
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0), EAST = new Vector3(1, 0, 0);

/** Seeded reed colonies, the Evening Causeway and a few local dusk pollinators. */
export class CanyonScenery {
  readonly group = new Group();
  readonly ready = true;
  private readonly material: ShaderMaterial;
  private readonly batches: Batch[] = [];
  private readonly waterFootings: WaterFooting[] = [];
  private readonly time = { value: 0 };
  private readonly lights: IUniform<Vector4[]>;
  private readonly lightCount: IUniform<number>;
  private seed = Number.NaN;
  private radius = Number.NaN;
  private dirty = true;
  private growthFrame = 0;
  private pendingGround = false;
  private readonly right = new Vector3();
  private readonly dir = new Vector3();
  private readonly x = new Vector3();
  private readonly z = new Vector3();
  private readonly turned = new Vector3();
  private readonly ground = createGroundSample();

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    this.lights = (shared.uLanternLights as IUniform<Vector4[]> | undefined) ?? { value: Array.from({ length: 16 }, () => new Vector4()) };
    this.lightCount = (shared.uLanternLightCount as IUniform<number> | undefined) ?? { value: 0 };
    this.material = new ShaderMaterial({
      name: 'Lantern reeds and mineral gardens', vertexShader, fragmentShader,
      uniforms: { ...shared, uSceneryTime: this.time, uLanternDusk: shared.uLanternDusk ?? { value: 0.6 } }, side: DoubleSide,
    });
    this.group.name = 'Lantern reed colonies, mineral causeway and Lamp Petals';
    this.buildAnchors(terrain);
    this.update(0, terrain);
  }

  invalidate(): void { this.dirty = true; }

  /** Safe interiors of the authored shelves, for wildlife resting above the pools. */
  shelfHeightAt(homeX: number, homeZ: number): number | null {
    let support: number | null = null;
    for (const batch of this.batches) {
      if (batch.habitat !== 'stone') continue;
      for (const a of batch.anchors) {
        if (!a.local || a.groundHeight === undefined) continue;
        const dx = homeX - a.local[0], dz = homeZ - a.local[1];
        const x = (dx * Math.cos(a.turn) + dz * Math.sin(a.turn)) / a.scale;
        const z = (-dx * Math.sin(a.turn) + dz * Math.cos(a.turn)) / a.scale;
        if (x*x / 1.1 + z*z / 0.18 > 1) continue;
        const height = Math.max(a.groundHeight - 0.06*a.scale, a.height ?? -Infinity) + 0.31*a.scale;
        support = Math.max(support ?? -Infinity, height);
      }
    }
    return support;
  }

  /** Does a swimmer's complete footprint avoid the authored shelves and reed islands? */
  waterClearAt(homeX: number, homeZ: number, radius: number): boolean {
    for (const f of this.waterFootings) {
      // Match the local-anchor hemisphere clamp used by update() on a small globe.
      const factor=Math.min(1,0.95*this.radius/Math.max(Math.hypot(f.x,f.z),0.001));
      const dx = homeX-f.x*factor, dz = homeZ-f.z*factor;
      if (f.round) {
        if (dx*dx+dz*dz <= (f.rx+radius)*(f.rx+radius)) return false;
      } else {
        const x = Math.max(Math.abs(dx*f.cos+dz*f.sin)-f.rx, 0);
        const z = Math.max(Math.abs(-dx*f.sin+dz*f.cos)-f.rz, 0);
        if (x*x+z*z <= radius*radius) return false;
      }
    }
    return true;
  }

  private batch(base: BufferGeometry, anchors: Anchor[], name: string, habitat: Habitat): void {
    if (habitat === 'reeds' || habitat === 'stone') {
      for (const a of anchors) {
        if (!a.local) continue;
        this.waterFootings.push({ x: a.local[0], z: a.local[1], rx: a.scale*(habitat === 'reeds' ? 1.34 : 1.95), rz: a.scale*1.12, cos: Math.cos(a.turn), sin: Math.sin(a.turn), round: habitat === 'reeds' });
      }
    }
    const geometry = new InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) geometry.setAttribute(name, base.getAttribute(name));
    geometry.setIndex(base.index);
    const anchorData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    const acrossData = new InstancedBufferAttribute(new Float32Array(anchors.length * 3), 3);
    const placementData = new InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4);
    geometry.setAttribute('aAnchor', anchorData);
    geometry.setAttribute('aAcross', acrossData);
    geometry.setAttribute('aPlacement', placementData);
    geometry.instanceCount = 0;
    const mesh = new Mesh(geometry, this.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.batches.push({ mesh, anchors, habitat, anchorData, acrossData, placementData });
  }

  private buildAnchors(terrain: Terrain): void {
    this.lightCount.value = 0;
    for (const b of this.batches) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); }
    this.batches.length = 0;
    this.waterFootings.length = 0;
    this.seed = terrain.layout.seed;
    let state = hash32(this.seed ^ 0x1a72e4);
    const rand = (): number => unit(state = hash32((state + 0x9e3779b9) >>> 0));
    const reeds: Anchor[][] = [[],[],[],[]], rocks: Anchor[] = [], herbs: Anchor[] = [], pebbles: Anchor[] = [], mesas: Anchor[] = [], flyers: Anchor[] = [];
    const local = (x: number, z: number, scale: number, turn = rand() * TAU): Anchor => ({ direction: new Vector3(), local: [x, z], scale, turn, phase: rand() * TAU, tint: rand(), threshold: 0 });
    let lamp = 0;
    const colony = (cx: number, cz: number, radius: number, density: number, tall = false): void => {
      for (let i=0;i<density;i++) {
        const angle=rand()*TAU, distance=Math.sqrt(rand())*radius;
        const x=cx+Math.cos(angle)*distance,z=cz+Math.sin(angle)*distance;
        // The three residents retain their unobstructed paths around the shelter.
        if(x>-12&&x<12&&z>4&&z<22)continue;
        const variant=i===0&&tall?2:i%4===0?3:i%3===0?1:0;
        const reed=local(x,z,(0.58+rand()*0.58)*(variant===2?1.12:1));
        reed.variant=variant;
        reed.height=0.13;
        if(i===0&&lamp<16)reed.light=lamp++;
        reeds[variant].push(reed);
      }
      for(let i=0;i<Math.ceil(density*1.4);i++) {
        const angle=rand()*TAU,distance=Math.sqrt(rand())*(radius+0.9);
        const x=cx+Math.cos(angle)*distance,z=cz+Math.sin(angle)*distance;
        if(x>-12&&x<12&&z>4&&z<22)continue;
        const fern=local(x,z,0.5+rand()*0.65);fern.height=0.13;herbs.push(fern);
        const gravel=local(x,z,0.65+rand()*0.6);gravel.height=0.12;pebbles.push(gravel);
      }
    };
    // Tight thickets occupy the banks and island fingers; the water lanes between
    // them stay open. Unequal colony sizes avoid a perimeter of repeated copies.
    for(const [x,z,r,n,tall] of [
      [-14,-1,3.0,12,1],[-10,-9,2.7,9,1],[7,-7,2.3,9,0],[14,0,2.5,11,1],
      [15,16,2.7,10,0],[10,26,3.0,12,0],[-9,27,2.3,11,0],[-14,31,2.4,8,1],
      [-21,42,2.8,13,1],[-29,47,2.4,9,0],[-44,40,3.1,14,1],[-47,29,2.7,12,1],
      [-43,16,2.5,12,0],[-36,7,3.0,14,1],[-26,3,2.6,12,0],[-18,7,2.1,8,0],
      [-55,10,3.2,11,1],[-52,-3,3.5,13,0],[-31,-13,3.5,12,0],[22,30,3.5,12,0],
    ])colony(x,z,r,n,!!tall);
    // Low near-water reeds have their own small silhouette, not scaled giant trees.
    for(const [x,z] of [[-39,33],[-30,35],[-24,31],[-20,18],[-31,16],[-8,32]]) {
      for(let k=0;k<5;k++) {
        const reed=local(x+(rand()-.5)*2.1,z+(rand()-.5)*1.7,0.66+rand()*0.5);
        reed.variant=3;reed.height=0.05;reeds[3].push(reed);
      }
    }
    // Interlocking broken shelves, not a necklace of small stepping stones.
    for(const [x,z,scale,turn] of [
      [-11,25,2.4,.1],[-17,25.5,2.1,-.12],[-23,26.4,1.7,.2],[-29,27.2,2.0,-.3],[-35,29,2.3,.15],
      [-42,35,3.4,.25],[-44,30,2.5,-.4],[-42,14,3.1,.3],[-35,8,3.6,-.3],[-26,4,2.8,.1],
      [-17,9,2.7,.3],[-15,33,2.6,-.12],[-26,36,1.8,.1],[-21,43,3.0,-.2],[-30,48,2.4,.1],
      [12,25,3.4,.24],[17,15,2.6,-.2],[-11,-7,2.5,.2],[11,-8,2.6,.3],
    ]) { const slab=local(x,z,scale,turn);slab.height=0.02;rocks.push(slab); }
    // Long geological silhouettes rise above the little planet's curved horizon.
    for(const [x,z,scale,turn] of [[-45,-28,1.2,.4],[-19,-40,1.35,1.8],[10,-37,.92,.7],[36,-26,1.3,2.4],[49,-5,.9,1.1],[-65,-8,.95,2.0],[-70,-40,1.1,0]]) {
      const mesa=local(x,z,scale,turn);mesa.height=-0.3;mesas.push(mesa);
    }
    // A few close pollinators have the readable 1.2–1.5 m wingspan of the artwork.
    for(const [i,x,z,scale] of [[0,-30,36,3.0],[1,-17,20,2.7],[2,-9,-2,2.5],[3,10,4,2.6],[4,-40,19,2.8],[5,-19,8,2.7],[6,-25,3,2.4]]) {
      const fly=local(x,z,scale);fly.phase=i*0.85;flyers.push(fly);
    }

    const home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const across = new Vector3().crossVectors(home, forward).normalize();
    // Distant ecosystems retain stable identities as the globe grows. Each seed
    // chooses a clump centre and several nearby colonies, leaving broad quiet gaps.
    for(let i=0;i<150;i++) {
      const y=1-2*(i+0.5)/150,a=i*2.399963229728653+this.seed*0.001,r=Math.sqrt(1-y*y);
      const dir=home.clone().multiplyScalar(y).addScaledVector(across,Math.cos(a)*r).addScaledVector(forward,Math.sin(a)*r).normalize();
      if(dir.dot(home)>Math.cos(0.57))continue;
      const gate=rand(), tangent=new Vector3().crossVectors(dir,Math.abs(dir.y)<0.9?UP:EAST).normalize();
      const bitangent=new Vector3().crossVectors(tangent,dir).normalize();
      for(let j=0;j<3;j++) {
        const angle=rand()*TAU,offset=rand()*0.026;
        const nearby=dir.clone().addScaledVector(tangent,Math.cos(angle)*offset).addScaledVector(bitangent,Math.sin(angle)*offset).normalize();
        const variant=(i+j)%4;
        reeds[variant].push({direction:nearby,scale:0.47+rand()*0.45,turn:rand()*TAU,phase:rand()*TAU,tint:rand(),threshold:gate,variant});
        herbs.push({direction:nearby,scale:1+rand(),turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
        if(j===0) {
          rocks.push({direction:nearby,scale:1.2+rand()*1.8,turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
          pebbles.push({direction:nearby,scale:1+rand(),turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
          if(i%9===0)mesas.push({direction:nearby,scale:.4+rand()*.4,turn:rand()*TAU,phase:0,tint:rand(),threshold:gate});
        }
      }
    }
    for(let i=0;i<4;i++)this.batch(reedColonyGeometry(i),reeds[i],`Lantern reed colony ${i+1}`,'reeds');
    this.batch(chalkGeometry(),rocks,'Fractured ivory mineral shelves','stone');
    this.batch(fernGeometry(),herbs,'Garnet bank ferns','herbs');
    this.batch(pebblePatchGeometry(),pebbles,'Individual lilac shore gravel','pebbles');
    this.batch(mesaGeometry(),mesas,'Blue-lilac mesas and ledge canopies','mesas');
    this.batch(lampPetalGeometry(),flyers,'Seven four-winged Lamp Petals','pollinators');
    gpuMemory.set('lantern scenery', this.batches.reduce((bytes, batch) => bytes+geometryBytes(batch.mesh.geometry), 0));
    this.dirty = true;
  }

  update(time: number, terrain: Terrain): void {
    this.time.value = time;
    if (terrain.layout.seed !== this.seed) this.buildAnchors(terrain);
    const growing = terrain.radius !== this.radius;
    // Distant anchors have fixed directions. During growth, their terrain
    // changes slowly; stagger those samples instead of spending a whole frame
    // re-evaluating every colony. Lit hero reeds, shelves, mesas and pollinators
    // stay exact; other local plants refresh in eight groups. The first still frame refreshes
    // everything exactly (including the dev harness's deterministic settle).
    const refreshAll = this.dirty || (!growing && this.pendingGround);
    const rebuild = refreshAll || growing;
    this.pendingGround = growing;
    this.radius = terrain.radius;
    this.dirty = false;
    const bucket = this.growthFrame++ % 8;
    const R = terrain.radius, home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
    const { right, dir, x, z, turned } = this;
    right.crossVectors(home, forward).normalize();
    let globalIndex = 0;
    let localIndex = 0;
    const active = Math.min(1, 0.35 + R / 128 * 0.5);
    for (const batch of this.batches) {
      const flying = batch.habitat === 'pollinators';
      if (!rebuild && !flying) continue;
      let count = 0;
      for (const a of batch.anchors) {
        const refreshGlobal = !a.local && globalIndex++ % 8 === bucket;
        const refreshLocal = a.local && (a.light !== undefined || flying || batch.habitat === 'stone' || batch.habitat === 'mesas' || localIndex++ % 8 === bucket);
        if (a.threshold >= active) continue;
        const emergence = a.local ? 1 : smoothstep(a.threshold, a.threshold + 0.08, active);
        if (a.local) {
          let [lx, lz] = a.local;
          if (flying) {
            const cycle = time * 0.22 + a.phase;
            const flutter = Math.max(0, Math.sin(cycle * 0.47));
            lx += Math.sin(cycle) * 1.8 * flutter;
            lz += Math.cos(cycle * 0.71) * 1.2 * flutter;
          }
          const d = Math.hypot(lx, lz), angle = Math.asin(Math.min(0.95, d / R));
          if(d<1e-6)dir.copy(home);
          else dir.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right, lx / d * Math.sin(angle)).addScaledVector(forward, lz / d * Math.sin(angle)).normalize();
        } else dir.copy(a.direction);
        if (refreshLocal || refreshAll || refreshGlobal || a.groundHeight === undefined) {
          terrain.sample(dir, this.ground);
          a.groundHeight = this.ground.height;
          a.water = this.ground.water;
        }
        // Global colonies favour shallow banks; leave the broad mirror pools open.
        if (!a.local && a.water! < -0.45 && batch.habitat !== 'stone') continue;
        if (!a.local && batch.habitat === 'stone' && a.water! < -0.5) continue;
        if (a.local) x.copy(right).addScaledVector(dir, -right.dot(dir)).normalize();
        else x.crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : EAST).normalize();
        z.crossVectors(x, dir).normalize();
        const turn = a.turn + (flying ? Math.sin(time * 0.22 + a.phase) * 0.7 : 0);
        turned.copy(x).multiplyScalar(Math.cos(turn)).addScaledVector(z, Math.sin(turn));
        let height = a.groundHeight - 0.06 * a.scale;
        if (a.height !== undefined) height = Math.max(height, a.height);
        if (flying) height += 2.4 + 0.55 * Math.sin(time * 0.32 + a.phase);
        batch.anchorData.setXYZW(count, dir.x, dir.y, dir.z, height);
        batch.acrossData.setXYZ(count, turned.x, turned.y, turned.z);
        batch.placementData.setXYZW(count, a.scale * emergence, a.phase, a.tint, 0);
        if(a.light!==undefined) {
          const variant=a.variant??0;
          const stemScale=variant===2?1.35:variant===3?.48:1;
          const huskScale=variant===2?1.17:variant===3?.72:1;
          const turn=variant*.63,reach=(.4+variant*.14)*a.scale;
          const lightAcross=new Vector3().crossVectors(turned,dir).normalize();
          const lightDir=dir.clone().multiplyScalar(Math.cos(reach/R))
            .addScaledVector(turned,Math.cos(turn)*Math.sin(reach/R))
            .addScaledVector(lightAcross,Math.sin(turn)*Math.sin(reach/R)).normalize();
          const lightHeight=height+(5.7*stemScale+.73*huskScale*.7)*a.scale;
          this.lights.value[a.light].set(lightDir.x*(R+lightHeight),lightDir.y*(R+lightHeight),lightDir.z*(R+lightHeight),1.8);
          this.lightCount.value=Math.max(this.lightCount.value,a.light+1);
        }
        count++;
      }
      batch.mesh.geometry.instanceCount = count;
      batch.anchorData.needsUpdate = true;
      batch.acrossData.needsUpdate = true;
      batch.placementData.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.batches) b.mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.waterFootings.length = 0;
    gpuMemory.delete('lantern scenery');
  }
}
