import { Vector3, Vector4, type Texture } from 'three';
import { hash32, mix, unit } from '../../../src/core/hash';
import { Fields, type FieldParams } from './fields';
import { sunAt } from '../render/palette';
import { localSun } from '../../../src/render/sun';
import { tangentToward, travel } from '../../../src/planet/geo';

import { FOREST_SITES, ROUTE_SEGMENTS, forestNetwork, routeClear, routeCourtAt, routePadAt, routePathAt } from './routes';

// Dry forest relief and connected shrine paths, mirrored in terrain.glsl.
// The raw meadow bake remains an engine service; only this world changes how
// its heights become woodland terrain. No water or inherited pond excavation.

export const R_REF = 128;
/** The hour the cottage is turned to face (the one light for now, params light.timeOfDay). */
const LAYOUT_SUN_HOURS = 11.5;
/** Distances (m) from the cottage centre: clearing flattened, the pond's near edge in front, and how far left of the middle the pond lies. */
export const COTTAGE_FLAT = 7.5;
export const COTTAGE_TO_POND = 4.3;
export const POND_SHIFT = 7;
/** The cottage clearing stands this high above the water (m): its landing is a terrace over the pond. */
export const HOME_LEVEL = 2.8;
/** The house's footprint (half sizes, m), and its terrace with the steps and its pier (props.ts COTTAGE, TERRACE, STEPS, PIER: x0, x1, z0, z1): cleared of plants. */
export const HOUSE_FOOTPRINT = { halfX: 4.45, halfZ: 2.75 } as const;
export const TERRACE_AREA = [-4.5, 4.2, -0.2, 4.8] as const;
export const STEPS_AREA = [1.9, 3.9, 4.6, 5.85] as const;
export const PIER_AREA = [-8.3, -3.3, 1.75, 5.7] as const;
/** The channel cut under the pier's arch (props.ts ARCH), so the water runs in under its vault: centre x, z and half sizes (m). */
export const CULVERT = { x: -7.2, z: 4.6, halfX: 0.5, halfZ: 1.3 } as const;
/** Dry plateau around the homestead (m): full inside, none outside. */
export const PLATEAU = { inner: 14, outer: 64 } as const;
/** Bank lip: height (m) and the distance (m) over which it rises from the waterline. */
export const BANK = { height: 0.2, width: 0.3, minSlope: 0.04 } as const;

export interface HomePond {
  readonly radius0: number;
  /** Outline: amplitudes and phases of harmonics 1–3, angle 0 toward the cottage. */
  readonly shape: readonly [number, number, number, number, number, number];
  /** One islet in pond-normalised coordinates: x, y, radius. */
  readonly islet: readonly [number, number, number];
}

export interface Layout {
  readonly seed: number;
  readonly noiseSeed: number;
  readonly cottage: Vector3;
  /** Unit tangent at the cottage pointing to its pond (and toward the nearest wetland). */
  readonly homeBearing: Vector3;
  /** Axis the hills, islands and colonies run along. */
  readonly grain: Vector3;
  readonly pond: HomePond;
}

function sequence(seed: number): () => number {
  let state = hash32((seed ^ 0x5bd1e995) >>> 0);
  return () => unit((state = hash32((state + 0x9e3779b9) >>> 0)));
}

function randomDirection(rand: () => number, out = new Vector3()): Vector3 {
  const z = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return out.set(s * Math.cos(t), s * Math.sin(t), z);
}

/**
 * The world's layout from its seed. The cottage goes on dry ground near the
 * edge of a wetland (so lakes are in view), facing the wettest way within
 * 70° of the sun with the sun to the left of ahead (the late-morning sun
 * that place sees, render/sun.ts; the painting's light), so
 * its front and its pond are in the light, seen from across the water.
 */
export function generateLayout(seed: number): Layout {
  const rand = sequence(seed);
  const noiseSeed = hash32(mix(seed, 0x7e44a1));
  const grain = randomDirection(rand);
  const probe = new Fields(noiseSeed, grain);
  let cottage = randomDirection(rand);
  let best = Infinity;
  for (let k = 0; k < 24; k++) {
    const c = randomDirection(rand);
    const score = Math.abs(probe.wetNoise(c) + 0.12);
    if (score < best) {
      best = score;
      cottage = c;
    }
  }
  const north = tangentToward(cottage, new Vector3(0.31, 0.83, 0.47), new Vector3());
  const east = new Vector3().crossVectors(north, cottage);
  const t = new Vector3();
  const p = new Vector3();
  const sun = sunAt(LAYOUT_SUN_HOURS);
  const towardSun = tangentToward(cottage, localSun(cottage, sun.elevation, sun.azimuth, new Vector3()), new Vector3());
  let bearing = towardSun.clone();
  let wettest = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
    // the sun ahead and to the left (as in the painting: the front lit, the right end in shade)
    if (t.dot(towardSun) < Math.cos((70 * Math.PI) / 180) || p.crossVectors(cottage, t).dot(towardSun) > -Math.sin((15 * Math.PI) / 180)) continue;
    const w = probe.wetNoise(travel(cottage, t, 0.35, p));
    if (w > wettest) {
      wettest = w;
      bearing = t.clone();
    }
  }
  const shape: [number, number, number, number, number, number] = [
    0.06 + 0.08 * rand(),
    0.04 + 0.07 * rand(),
    0.02 + 0.04 * rand(),
    rand() * Math.PI * 2,
    rand() * Math.PI * 2,
    rand() * Math.PI * 2,
  ];
  const ia = Math.PI * (0.6 + 0.8 * rand());
  const ir = 0.3 + 0.25 * rand();
  // (the pond twice the size it was through iteration 9; its islet the same size in meters)
  const pond: HomePond = { radius0: 17 + 5 * rand(), shape, islet: [Math.cos(ia) * ir, Math.sin(ia) * ir, 0.05 + 0.035 * rand()] };
  return { seed, noiseSeed, cottage, homeBearing: bearing, grain, pond };
}

// ---- R-dependent state and evaluation ------------------------------------

export interface GroundSample { height:number; water:number; depth:number; clearing:number; wet:number; }
export function createGroundSample():GroundSample {return {height:0,water:1000,depth:0,clearing:0,wet:0};}
const tmpA=new Vector3(),tmpB=new Vector3(),UP=new Vector3(0,1,0),X=new Vector3(1,0,0);
/** The same tangent frame is used by the CPU and GPU gradient probes. */
export function gradientFrame(dir:Vector3,a:Vector3,b:Vector3):void {
  a.crossVectors(dir,Math.abs(dir.y)<0.95?UP:X).normalize();b.crossVectors(dir,a);
}

export class Terrain {
  radius=R_REF;
  fields:Fields;
  // Compatibility fields for the engine's old meadow camera API. No pond is excavated.
  pondRadius=1;pondCentre=30;pondReach=64;pondShapeReach=28;
  readonly cottageLevel=HOME_LEVEL;
  gradStep=0.75;
  constructor(public layout:Layout){this.fields=new Fields(layout.noiseSeed,layout.grain);}
  setLayout(layout:Layout):void {this.layout=layout;this.fields=new Fields(layout.noiseSeed,layout.grain);}
  update(radius:number,p:FieldParams,bakeTexelMeters:number):void {
    this.radius=radius;this.fields.update(radius,p);this.gradStep=Math.max(0.6,bakeTexelMeters);
  }
  homeAreas(sweepX:number,sweepZ:number,out:Array<{dir:Vector3;reach:number}>):void {
    const L=this.layout;
    out[0].dir.copy(L.cottage);out[0].reach=Math.max(24,8+7*Math.hypot(sweepX,sweepZ));
    out[1].dir.copy(L.cottage).addScaledVector(L.homeBearing,32/this.radius).normalize();out[1].reach=32;
  }
  cottageLocal(dir:Vector3,out:{x:number;z:number}):{x:number;z:number}{
    const L=this.layout;tmpA.subVectors(dir,L.cottage);tmpB.crossVectors(L.cottage,L.homeBearing);
    out.x=tmpA.dot(tmpB)*this.radius;out.z=tmpA.dot(L.homeBearing)*this.radius;return out;
  }
  homePond(_dir:Vector3):number{return 1000;}
  /** Stable pads at every shrine and at the separate forest residence. */
  homestead(dir:Vector3,natural:number):number {
    const h=1.8+Math.max(0,natural+1)*0.42;
    return h+(HOME_LEVEL-h)*routePadAt(dir,this.layout,this.radius);
  }
  pathAt(dir:Vector3):number{return routePathAt(dir,this.layout,this.radius);}
  placementClear(dir:Vector3,margin=0):boolean{return routeClear(dir,this.layout,this.radius,margin);}
  get residenceGround():number{return HOME_LEVEL+BANK.height;}
  height0(dir:Vector3):number{return this.homestead(dir,this.fields.natural(dir));}
  sample(dir:Vector3,out:GroundSample):GroundSample {
    out.height=this.height0(dir)+BANK.height;out.water=1000;out.depth=0;out.wet=0;
    out.clearing=this.clearingAt(dir,0);return out;
  }
  height(dir:Vector3):number{return this.sample(dir,scratch).height;}
  get cottageGround():number{return this.cottageLevel+BANK.height;}
  get maxHeight():number{return Math.max(HOME_LEVEL,1.8+Math.max(0,this.fields.lift+4*this.fields.reliefStd+1)*0.42)+BANK.height+0.5;}
  clearingAt(dir:Vector3,_dc:number):number {
    return Math.max(routeCourtAt(dir,this.layout,this.radius),this.pathAt(dir));
  }
  writeUniforms(u:TerrainUniforms):void {
    const L=this.layout,network=forestNetwork(L,this.radius);
    const sites=[...network.shrines,network.residence];
    for(let i=0;i<FOREST_SITES;i++){
      const site=sites[i],home=site.variant===5,s=site.scale;
      u.uForestSites.value[i].set(site.dir.x,site.dir.y,site.dir.z,s);
      u.uForestFronts.value[i].set(site.forward.x,site.forward.y,site.forward.z,home?1:0);
    }
    for(let i=0;i<ROUTE_SEGMENTS;i++){
      u.uRouteA.value[i].copy(network.spurs[i].a);u.uRouteB.value[i].copy(network.spurs[i].b);
    }
    u.uTerrainSeed.value=L.noiseSeed;u.uBank.value.set(BANK.height,BANK.width,this.gradStep,BANK.minSlope);
    u.uCottage.value.set(L.cottage.x,L.cottage.y,L.cottage.z,this.cottageLevel);
    u.uCottageB.value.set(L.homeBearing.x,L.homeBearing.y,L.homeBearing.z,0);
    u.uHomePond.value.set(this.pondRadius,this.pondCentre,this.pondReach,POND_SHIFT);
    const [a1,a2,a3,p1,p2,p3]=L.pond.shape;
    u.uHomeShape.value.set(a1,a2,a3,this.pondShapeReach);u.uHomePhase.value.set(p1,p2,p3,0);
    u.uHomeIslet.value.set(L.pond.islet[0],L.pond.islet[1],L.pond.islet[2],0);
    const f=this.fields;u.uClumps.value.set(f.clumpPair.level,f.clumpPair.t,f.clumpThreshold,f.patchiness);
  }
}
const scratch=createGroundSample();

export interface TerrainUniforms {
  uForestSites:{value:Vector4[]};
  uForestFronts:{value:Vector4[]};
  uRouteA:{value:Vector3[]};
  uRouteB:{value:Vector3[]};
  uTerrainSeed: { value: number };
  /** Natural height (m), lushness, wetness, colour variant (bake.ts). */
  uTerrainBake: { value: Texture | null };
  /** Flowers per m²: pink, star, yellow, blue (bake.ts). */
  uFloraBake: { value: Texture | null };
  /** Bank height (m), bank width (m), gradient step (m), minimum slope. */
  uBank: { value: Vector4 };
  uCottage: { value: Vector4 };
  /** Toward the pond (xyz). */
  uCottageB: { value: Vector4 };
  /** Homestead pond: radius (m), centre along the bearing (m), reach (m). */
  uHomePond: { value: Vector4 };
  uHomeShape: { value: Vector4 };
  uHomePhase: { value: Vector4 };
  uHomeIslet: { value: Vector4 };
  /** Shadow sweep per meter of height in cottage-local x, z (sun direction / its elevation). */
  uCottageSun: { value: Vector4 };
  /** Flower clumps (Fields.clumps): octave level, blend, threshold, patchiness. */
  uClumps: { value: Vector4 };
}

export function createTerrainUniforms(): TerrainUniforms {
  return {
    uForestSites:{value:Array.from({length:FOREST_SITES},()=>new Vector4())},
    uForestFronts:{value:Array.from({length:FOREST_SITES},()=>new Vector4())},
    uRouteA:{value:Array.from({length:ROUTE_SEGMENTS},()=>new Vector3())},
    uRouteB:{value:Array.from({length:ROUTE_SEGMENTS},()=>new Vector3())},
    uTerrainSeed: { value: 0 },
    uTerrainBake: { value: null },
    uFloraBake: { value: null },
    uBank: { value: new Vector4(BANK.height, BANK.width, 0.75, BANK.minSlope) },
    uCottage: { value: new Vector4(0, 1, 0, HOME_LEVEL) },
    uCottageB: { value: new Vector4(1, 0, 0, 0) },
    uHomePond: { value: new Vector4(9, 14, 28, 0) },
    uHomeShape: { value: new Vector4() },
    uHomePhase: { value: new Vector4() },
    uHomeIslet: { value: new Vector4() },
    uCottageSun: { value: new Vector4(0, 0, 0, 0) },
    uClumps: { value: new Vector4(0, 0, 0, 0) },
  };
}
