import { BackSide, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type IUniform } from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { smoothstep } from '../../../src/core/math';
import { warpPoint, type WarpFrame } from '../../../src/render/warp';
import type { Terrain } from '../planet/terrain';
import { KITELET_PERCH_HEIGHT, WILDLIFE_DISPLAY_SCALE, WILDLIFE_FEET, WILDLIFE_SIZE, WILDLIFE_SPECIES, wildlifeGeometry, wildlifeHabitatGeometry, type WildlifeSpecies } from './wildlifeGeometry';
import vertexShader from './wildWildlife.vert.glsl?raw';
import fragmentShader from './wildWildlife.frag.glsl?raw';
import contactVertex from './wildlifeContact.vert.glsl?raw';
import contactFragment from './wildlifeContact.frag.glsl?raw';

export type { WildlifeSpecies } from './wildlifeGeometry';
const TAU = Math.PI * 2;
export const WILDLIFE_HABITATS = {
  sailback: { x: -1, z: 36, label: 'Sailback', habitat: 'Wind Ribs', count: 3 },
  kitelet: { x: 10.5, z: 35.5, label: 'Kitelet', habitat: 'Seed Flats', count: 5 },
  'sand-stitcher': { x: 8.8, z: 38.4, label: 'Sand Stitcher', habitat: 'Coral Lee Garden', count: 3 },
} as const;

/** Stable authored pockets reserved by the geology; independent of the camera. */
export function wildlifeHome(species: WildlifeSpecies, index: number): { x: number; z: number } {
  // One resident of each species lives by the shelter as well as the wind
  // corridor, so returning to an older close camera pose still finds wildlife.
  if (species === 'sailback' && index === 2) return { x: 1, z: 12 };
  if (species === 'kitelet' && index === 4) return { x: -2, z: 13 };
  if (species === 'sand-stitcher' && index === 2) return { x: -5, z: 7.6 };
  const home=WILDLIFE_HABITATS[species];
  const offsets=species==='sailback'?[[-0.6,0.45],[0.5,-0.45],[-0.2,0.25]]:species==='kitelet'?[[-1.1,-.72],[.94,.60],[-.12,1.0],[.88,-.94],[-.6,.2]]:[[-0.45,-0.45],[0.4,0.35],[-0.05,0.1]];
  const offset=offsets[index%offsets.length];
  return {x:home.x+offset[0],z:home.z+offset[1]};
}
export const wildlifePerchScale=(index:number):number=>[1,0.78,1.22,0.66,1.08][index%5];
const habitatBearing=(species:WildlifeSpecies,index:number):number=>species==='sand-stitcher'?[-0.25,0.45,-0.55][index%3]:index*1.71-0.45;

/** Fade only when a displayed silhouette is too small to read, not at an
 * arbitrary distance that removes animals from the reference landscape. */
export function wildlifePresence(species: WildlifeSpecies, distance: number, pixelAngle: number): number {
  const pixels=WILDLIFE_SIZE[species]*WILDLIFE_DISPLAY_SCALE[species]/Math.max(0.001,distance*Math.max(pixelAngle,0.00001));
  return smoothstep(2,9,pixels);
}

export interface WildlifePose {
  x: number; z: number; headingX: number; headingZ: number;
  lift: number; phase: number; gait: number; open: number; place: number;
  activity: string;
}
export interface WildlifeEncounter {
  id: WildlifeSpecies;
  name: string;
  habitat: string;
  activity: string;
  dir: Vector3;
  heading: Vector3;
  /** Height of the animal's root above the planet base (includes flight lift). */
  height: number;
  groundHeight: number;
  /** Camera distance/height and the target height above the animal root, metres. */
  distance: number;
  cameraHeight: number;
  aimHeight: number;
}

/** Stateless timelines: seeking, reseeding and growth never accumulate drift. */
export function wildlifeMotion(species: WildlifeSpecies, index: number, time: number, seed: number): WildlifePose {
  const habitat = wildlifeHome(species,index);
  const cycle=species==='sailback'?26:species==='kitelet'?22:20;
  const phase = unit(hash32(seed ^ (index * 7919 + WILDLIFE_SPECIES.indexOf(species) * 349 + 719))) * 4+index*cycle/WILDLIFE_HABITATS[species].count;
  const pose: WildlifePose = { x: habitat.x, z: habitat.z, headingX: 1, headingZ: 0, lift: 0, phase: time * 9 + phase, gait: 0, open: 1, place: 0, activity: '' };
  if (species === 'sailback') {
    const t = ((time + phase) % 26 + 26) % 26;
    let progress: number;
    if (t < 9) { progress = 0.35 * smoothstep(0, 9, t); pose.gait = Math.sin(t / 9 * Math.PI); pose.open = 0.28; pose.activity = 'Walking between the wind ribs'; }
    else if (t < 12) { progress = 0.35; pose.open = 0.28 + 0.72 * smoothstep(9, 11, t); pose.activity = 'Opening two ivory sails'; }
    else if (t < 15) { progress = 0.35 + 0.24 * smoothstep(12, 15, t); pose.lift = 0.045 * Math.sin((t - 12) / 3 * Math.PI); pose.open = 1; pose.activity = 'Skimming on the breeze'; }
    else { progress = 0.59 + 0.41 * smoothstep(15, 26, t); pose.gait = Math.sin((t - 15) / 11 * Math.PI); pose.open = 1 - 0.72 * smoothstep(15, 18, t); pose.activity = 'Folding its sails and walking home'; }
    const a = progress * TAU;
    pose.x += Math.sin(a) * 2.2; pose.z += Math.cos(a) * 0.9;
    pose.headingX = Math.cos(a) * 2.2; pose.headingZ = -Math.sin(a) * 0.9;
  } else if (species === 'kitelet') {
    const t = ((time + phase) % 22 + 22) % 22;
    const flight = smoothstep(1, 4, t) * (1 - smoothstep(16, 20, t));
    const a = smoothstep(1, 20, t) * TAU;
    pose.x += Math.sin(a) * 1.15 * flight; pose.z += Math.sin(a*2) * 0.7 * flight;
    pose.lift = KITELET_PERCH_HEIGHT*wildlifePerchScale(index) + 0.014*WILDLIFE_DISPLAY_SCALE.kitelet + flight * (1.1 + 0.35 * Math.sin(a * 2));
    pose.phase = time * 20 + phase; pose.gait = flight * (t > 7 && t < 11 ? 0.15 : 1);
    pose.headingX = Math.cos(a); pose.headingZ = Math.sin(a) * 0.6;
    pose.activity = flight < 0.05 ? 'Perched on a seed cup' : t > 7 && t < 11 ? 'Gliding between the seed sails' : 'Fluttering over the coral';
  } else {
    const t = ((time + phase) % 20 + 20) % 20;
    let along: number;
    if (t < 7) { along = smoothstep(0, 7, t); pose.gait = Math.sin(t / 7 * Math.PI); pose.activity = 'Carrying one dry stem'; }
    else if (t < 13) { along = 1; pose.activity = t < 10 ? 'Tucking a stem into the sand' : 'Inspecting the gathered dry stems'; }
    else { along = 1 - smoothstep(13, 20, t); pose.gait = Math.sin((t - 13) / 7 * Math.PI); pose.activity = 'Scurrying through the lee garden'; }
    // Leave the new stem with the fallen twigs while walking back. The next stem
    // is collected only at the other end of the loop, away from the litter.
    pose.place = smoothstep(7, 9, t) * (1 - smoothstep(18, 20, t));
    const bearing=habitatBearing(species,index);
    pose.x += along * 0.7*Math.cos(bearing); pose.z += along*0.7*Math.sin(bearing)+Math.sin(along * Math.PI) * 0.12;
    // Turn while paused at each end, not by snapping halfway through a step.
    const turn = smoothstep(10, 13, t) * (1 - smoothstep(18, 20, t)) * Math.PI;
    pose.headingX = Math.cos(turn+bearing); pose.headingZ = Math.sin(turn+bearing);
    pose.phase = time * 18 + phase;
  }
  return pose;
}

/** Exact inverse of cottageLocal, so authored habitats keep their metre offsets. */
export function wildlifeDirection(terrain: Terrain, x: number, z: number, out = new Vector3()): Vector3 {
  const home = terrain.layout.cottage, forward = terrain.layout.homeBearing;
  const right = new Vector3().crossVectors(home, forward).normalize();
  const d = Math.hypot(x, z), angle = Math.asin(Math.min(0.95, d / terrain.radius));
  return out.copy(home).multiplyScalar(Math.cos(angle)).addScaledVector(right, d ? x / d * Math.sin(angle) : 0).addScaledVector(forward, d ? z / d * Math.sin(angle) : 0).normalize();
}

interface Batch {
  species: WildlifeSpecies;
  habitat: boolean;
  members: number[];
  geometry: InstancedBufferGeometry;
  body: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  outline: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  anchor: InstancedBufferAttribute;
  across: InstancedBufferAttribute;
  motion: InstancedBufferAttribute;
  feet: InstancedBufferAttribute;
  slope: InstancedBufferAttribute;
  presence: InstancedBufferAttribute;
}

/** Three species and two physical habitat features, plus shared contacts. */
export class WindWildlife {
  readonly group = new Group();
  private readonly batches: Batch[] = [];
  private readonly encounters = new Map<WildlifeSpecies, WildlifeEncounter>();
  private disposed = false;
  private readonly up = new Vector3();
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  private readonly heading = new Vector3();
  private readonly across = new Vector3();
  private readonly probe = new Vector3();
  private readonly point = new Vector3();
  private readonly contacts: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly contactAnchor = new InstancedBufferAttribute(new Float32Array(6 * 4), 4);
  private readonly contactAcross = new InstancedBufferAttribute(new Float32Array(6 * 3), 3);
  private readonly contactShape = new InstancedBufferAttribute(new Float32Array(6 * 3), 3);

  constructor(shared: Record<string, IUniform>, terrain: Terrain) {
    this.group.name = 'Cobalt wildlife: Sailbacks, Kitelets and Sand Stitchers';
    // A little tessellation follows the rendered height field rather than a
    // flat card cutting into sloping sand. All six ground animals share it.
    const patch = new PlaneGeometry(2, 2, 6, 6), contacts = new InstancedBufferGeometry();
    contacts.setAttribute('position', patch.getAttribute('position'));
    contacts.setAttribute('uv', patch.getAttribute('uv')); contacts.setIndex(patch.index);
    contacts.setAttribute('aShadowAnchor', this.contactAnchor);
    contacts.setAttribute('aShadowAcross', this.contactAcross);
    contacts.setAttribute('aShadowShape', this.contactShape);
    contacts.instanceCount = 6;
    this.contacts = new Mesh(contacts, new ShaderMaterial({
      name: 'Cobalt wildlife matte contact shadows', vertexShader: contactVertex, fragmentShader: contactFragment,
      uniforms: shared, side: DoubleSide, transparent: true, depthWrite: false, depthTest: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    this.contacts.name = 'Wildlife ground contacts'; this.contacts.frustumCulled = false;
    this.group.add(this.contacts); patch.dispose();
    const plans: Array<{species:WildlifeSpecies;habitat:boolean;variant?:number}>=[...WILDLIFE_SPECIES.map(species=>({species,habitat:false})),...[0,1,2].map(variant=>({species:'kitelet' as const,habitat:true,variant})),{species:'sand-stitcher',habitat:true}];
    for (const {species,habitat,variant=0} of plans) {
      const speciesIndex=habitat?-1:WILDLIFE_SPECIES.indexOf(species);
      const base = habitat?wildlifeHabitatGeometry(species as 'kitelet'|'sand-stitcher',variant):wildlifeGeometry(species), geometry = new InstancedBufferGeometry();
      for (const name of Object.keys(base.attributes)) geometry.setAttribute(name, base.getAttribute(name));
      const members=Array.from({length:WILDLIFE_HABITATS[species].count},(_,i)=>i).filter(i=>!habitat||species!=='kitelet'||i%3===variant);
      const count = members.length;
      const attribute = (name: string, size: number): InstancedBufferAttribute => {
        const a = new InstancedBufferAttribute(new Float32Array(count * size), size); geometry.setAttribute(name, a); return a;
      };
      const anchor = attribute('aAnchor', 4), across = attribute('aAcross', 3), motion = attribute('aMotion', 4), feet = attribute('aFeet', 4), slope = attribute('aSlope', 2), presence = attribute('aPresence', 1);
      geometry.instanceCount = count;
      const material = (outline: boolean): ShaderMaterial => new ShaderMaterial({
        name: `${species} ${outline ? 'ink contour' : 'painted plates and membranes'}`,
        vertexShader, fragmentShader, uniforms: { ...shared, uWildSpecies: { value: speciesIndex }, uWildDisplayScale:{value:habitat?1:WILDLIFE_DISPLAY_SCALE[species]}, uWildOutline: { value: outline ? 1 : 0 } }, side: outline ? BackSide : DoubleSide,
      });
      const body = new Mesh(geometry, material(false)), outline = new Mesh(geometry, material(true));
      body.frustumCulled = outline.frustumCulled = false;
      const suffix=habitat&&variant>0?` ${variant}`:'';
      body.name = `${species} ${habitat?'habitats':'bodies'}${suffix}`; outline.name = `${species} ${habitat?'habitat contours':'contours'}${suffix}`;
      this.group.add(outline, body);
      this.batches.push({ species, habitat, members, geometry, body, outline, anchor, across, motion, feet, slope, presence });
      // Attributes are transferred to the instanced geometry, so the temporary
      // wrapper has never owned a GPU allocation or a separate attribute copy.
      base.dispose();
    }
    this.update(0, terrain);
  }

  /** All placement is recomputed from current terrain; no stale bake cache. */
  invalidate(): void { this.encounters.clear(); }

  update(time: number, terrain: Terrain, camera?: Vector3, pixelAngle = 0.001, warp?: WarpFrame): void {
    if (this.disposed) return;
    const R = terrain.radius;
    let contactCount = 0, contactsVisible = false;
    this.right.crossVectors(terrain.layout.cottage, terrain.layout.homeBearing).normalize();
    for (const batch of this.batches) {
      let anyVisible = false;
      const habitat = WILDLIFE_HABITATS[batch.species];
      for (let i = 0; i < batch.members.length; i++) {
        const member=batch.members[i];
        const pose = wildlifeMotion(batch.species, member, time, terrain.layout.seed);
        const scale=batch.habitat?(batch.species==='kitelet'?wildlifePerchScale(member):1):WILDLIFE_DISPLAY_SCALE[batch.species];
        if(batch.habitat) {
          const home=wildlifeHome(batch.species,member);
          const bearing=habitatBearing(batch.species,member),reach=batch.species==='sand-stitcher'?0.7:0;
          pose.x=home.x+reach*Math.cos(bearing);pose.z=home.z+reach*Math.sin(bearing);
          pose.lift=0;pose.headingX=Math.cos(bearing);pose.headingZ=Math.sin(bearing);pose.gait=0;pose.open=scale;
        }
        wildlifeDirection(terrain, pose.x, pose.z, this.up);
        const ground = terrain.height(this.up), height = ground + pose.lift;
        this.forward.copy(terrain.layout.homeBearing).addScaledVector(this.up, -terrain.layout.homeBearing.dot(this.up)).normalize();
        this.across.copy(this.right).addScaledVector(this.up, -this.right.dot(this.up)).normalize();
        this.heading.copy(this.across).multiplyScalar(pose.headingX).addScaledVector(this.forward, pose.headingZ).normalize();
        this.across.crossVectors(this.up, this.heading).normalize();
        this.point.copy(this.up).multiplyScalar(R + height);
        if(warp) warpPoint(warp,this.point,this.point);
        const distance = camera ? camera.distanceTo(this.point) : 0;
        const visible = wildlifePresence(batch.species,distance,pixelAngle);
        if (!batch.habitat && batch.species !== 'kitelet') {
          const sailback = batch.species === 'sailback';
          const spread = 1 + pose.lift * 2;
          // Compact footprint, neutral matte colour, and less density during
          // the Sailback's short skim. No light emission or additive blend.
          this.contactAnchor.setXYZW(contactCount, this.up.x, this.up.y, this.up.z, ground);
          this.contactAcross.setXYZ(contactCount, this.across.x, this.across.y, this.across.z);
          this.contactShape.setXYZ(contactCount, (sailback ? 0.09 : 0.052) * scale * spread, (sailback ? 0.205 : 0.076) * scale * spread, visible * 0.24 / (1 + pose.lift * 12));
          contactsVisible ||= visible > 0; contactCount++;
        }
        batch.presence.setX(i, visible); anyVisible ||= visible > 0;
        batch.anchor.setXYZW(i, this.up.x, this.up.y, this.up.z, height);
        batch.across.setXYZ(i, this.across.x, this.across.y, this.across.z);
        batch.motion.setXYZW(i, pose.phase, pose.gait, pose.open, pose.place);
        let slopeX = 0, slopeZ = 0;
        const sample = (x: number, z: number): number => terrain.height(this.probe.copy(this.up).addScaledVector(this.across, x / R).addScaledVector(this.heading, z / R).normalize()) - ground;
        if (visible > 0 && (batch.habitat || batch.species !== 'kitelet')) {
          const e = (batch.species === 'sailback' ? 0.06 : 0.025)*scale;
          slopeX = (sample(e, 0) - sample(-e, 0)) / (2 * e);
          slopeZ = (sample(0, e) - sample(0, -e)) / (2 * e);
          if(!batch.habitat) WILDLIFE_FEET[batch.species].forEach(([x, z], foot) => batch.feet.array[i * 4 + foot] = sample(x*scale, z*scale));
        }
        batch.slope.setXY(i, slopeX, slopeZ);
        if (i === 0 && !batch.habitat) {
          const framing = (batch.species === 'sailback' ? [1.3, 0.5, 0.12] : batch.species === 'kitelet' ? [0.8, 0.39, 0.005] : [0.57, 0.18, 0.035]).map(value=>value*scale);
          this.encounters.set(batch.species, { id: batch.species, name: habitat.label, habitat: habitat.habitat, activity: pose.activity, dir: this.up.clone(), heading: this.heading.clone(), height, groundHeight: ground, distance: framing[0], cameraHeight: framing[1], aimHeight: framing[2] });
        }
      }
      batch.body.visible = batch.outline.visible = anyVisible;
      for (const attribute of [batch.anchor, batch.across, batch.motion, batch.feet, batch.slope, batch.presence]) attribute.needsUpdate = true;
    }
    this.contacts.visible = contactsVisible;
    this.contacts.geometry.instanceCount = contactCount;
    for (const attribute of [this.contactAnchor, this.contactAcross, this.contactShape]) attribute.needsUpdate = true;
  }

  encounter(id: WildlifeSpecies): WildlifeEncounter | null {
    const e = this.encounters.get(id);
    return e ? { ...e, dir: e.dir.clone(), heading: e.heading.clone() } : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const batch of this.batches) { batch.geometry.dispose(); batch.body.material.dispose(); batch.outline.material.dispose(); }
    this.contacts.geometry.dispose(); this.contacts.material.dispose();
    this.group.clear(); this.group.removeFromParent(); this.encounters.clear();
  }
}
