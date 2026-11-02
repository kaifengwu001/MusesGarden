import { Frustum, Matrix4, Scene, Vector3, Vector4, type IUniform, type WebGLRenderer } from 'three';
import { BuildQueue } from '../core/buildQueue';
import type { FrameClock } from '../core/clock';
import type { Globals } from '../core/globals';
import { hash32, mix as hashMix } from '../core/hash';
import { clamp, smoothstep } from '../core/math';
import type { Tier } from '../core/quality';
import type { ParamPath, ParamStore } from '../params';
import type { CameraPreset, PlanetWorld } from '../planetWorld';
import { ChunkSelection } from '../planet/chunks';
import { tangentToward } from '../planet/geo';
import { growthState, type GrowthState } from '../planet/growth';
import { GrowthBand } from '../planet/rest';
import type { GroundSample } from '../planet/terrain';
import { createLookUniforms } from '../render/look';
import { Palette, ROW, sunAt } from '../render/palette';
import { Sky } from '../render/sky';
import { localSun } from '../render/sun';
import { warpForZoom } from '../render/warp';
import { CameraRig } from '../view/camera';
import { pickSurface, type Pick } from '../view/picking';
import { TerraceBuild } from './build/builder';
import { FIELD, PlanetField } from './build/field';
import { PaddyMap } from './paddyMap';
import { TERRACE_ROWS } from './palette';
import { Rice, RICE } from './rice';
import { Trees } from './trees';

const NOON = new Palette(TERRACE_ROWS);
const NOON_SUN = NOON.get(ROW.LIGHT, 0);
const NOON_SKY = NOON.get(ROW.LIGHT, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const DEBUG_VIEWS = { off: 0, chunks: 1, morph: 2, normals: 3, land: 4, cells: 5 } as const;
/** Heights of the named views (m): a bird's-eye view over the terraces, and standing on one. */
const VIEW_HEIGHT = { above: 70.2, standing: 4.3 } as const;
/** The vista: the camera's height (m), its tilt from straight down (rad), how much wider its view (degrees). */
const VISTA = { height: 24, tilt: (52 * Math.PI) / 180, widen: 28 } as const;
/** The rice's pool, in pages of 2048 blades (rice.ts). */
const RICE_PAGES = 400;

/** The season's front (paddy.glsl uPaddy.y) at a bloom: paddies whose place in the season is under it are on their way. */
export function seasonFront(bloom: number): number {
  // (about half the paddies flooded or just planted at the season's default, as Kai's paddy painting has them)
  return 0.55 * clamp(bloom, 0, 1);
}

/**
 * The terraces: a second planet to visit, its ground all mathematics (build/field.ts: the paddy lab's
 * hills, Perlin noise at several scales, on the sphere) and its terraces the paddy lab's construction on
 * them (build/construct.ts), built once in a worker: banks along the levels' outlines, cuts cascading down
 * the fall line, the woods where it is too steep (with their trees), plain plots where it is too flat.
 * Nothing on it is read off a mesh or a baked texture. Each frame: camera → light, wind and look uniforms
 * → warp → the build (once) → rice → sky.
 */
export class TerraceWorld implements PlanetWorld {
  readonly kind = 'terraces' as const;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly palette = new Palette(TERRACE_ROWS);
  readonly look = createLookUniforms();
  readonly band = new GrowthBand();
  readonly queue = new BuildQueue();
  readonly growth: GrowthState = { g: 0, area: 0, radius: FIELD.radius };
  readonly sky: Sky;
  /** (no chunked ground on this planet: its ground is the build's) */
  readonly surface = { selection: new ChunkSelection(1) };
  readonly shared: Record<string, IUniform>;
  readonly warp = { focus: new Vector3(), up: new Vector3(0, 1, 0), k: 0 };
  readonly sunDir = new Vector3(0, 1, 0);
  nearFieldDrawn = false;
  get nearInstances(): { grass: number; flowers: number } {
    return { grass: this.rice.layer.visibleInstances, flowers: 0 };
  }
  field: PlanetField;
  readonly trees: Trees;
  readonly rice: Rice;
  readonly objects: TerraceBuild;
  readonly paddyMap: PaddyMap;
  /** The world's own: its noise's seed, the season's front, the paddies' water and the crop's look (paddy.glsl, water.glsl, terrace.frag.glsl). */
  private readonly own = {
    uTerrainSeed: { value: 0 },
    uPaddy: { value: new Vector4(0, 0.55, 0, 0) },
    uPaddyWater: { value: new Vector4(0.85, 0, 0, 0) },
    uRiceLook: { value: new Vector4(0.6, 0, 0, 0) },
    uRiceNear: { value: new Vector4(0, 1, 0, 0) },
  };
  private posed = false;
  private noiseSeed = -1;
  private nextGust = 0;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly windAxis = new Vector3();
  private readonly tmp = new Vector3();
  private readonly g3 = new Float64Array(3);

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly globals: Globals,
    private readonly store: ParamStore,
    tier: Tier,
  ) {
    this.field = this.makeField();
    this.look.uPalette.value = this.palette.texture;
    this.shared = {
      ...globals,
      ...this.look,
      ...this.own,
      uGustRot: { value: new Vector4(1, 0, 1, 0) },
      uGustFreq: { value: new Vector4(8, 24, 0, 0) },
      uGustRings: { value: Array.from({ length: 4 }, () => new Vector4(0, 1, 0, -1)) },
    };
    this.sky = new Sky();
    this.trees = new Trees(this.shared);
    this.paddyMap = new PaddyMap(this.shared);
    Object.assign(this.shared, this.paddyMap.uniforms);
    this.rice = new Rice(this.shared, RICE_PAGES);
    this.objects = new TerraceBuild(this.shared);
    this.scene.add(this.sky.mesh, this.objects.group, this.rice.mesh, this.trees.mesh);
    // (dev: `only=` in the URL shows the planet's parts named, the rest hidden, to judge each alone: terraces, rice, trees)
    const only = new URLSearchParams(location.hash.slice(1)).get('only');
    if (only !== null) {
      const show = new Set(only.split(','));
      const parts = { terraces: this.objects.group, rice: this.rice.mesh, trees: this.trees.mesh };
      for (const [name, part] of Object.entries(parts)) part.visible = show.has(name);
    }
    this.applyTier(tier);
  }

  /** The planet's mathematics for the world's seed. */
  private makeField(): PlanetField {
    this.noiseSeed = hash32(hashMix(this.store.values.world.seed, 0x51ce7a));
    this.own.uTerrainSeed.value = this.noiseSeed;
    return new PlanetField({ ...FIELD, seed: this.noiseSeed });
  }

  applyTier(_tier: Tier): void {
    void _tier;
  }

  get needsDefaultPose(): boolean {
    return !this.posed;
  }

  markPosed(): void {
    this.posed = true;
  }

  /** Over the terraces, looking down across a valley: a stand on a terraced hillside, facing downhill. */
  defaultPose(): void {
    const stand = this.findStand();
    this.rig.lookAlong(stand.focus, stand.forward);
    this.posed = true;
  }

  cameraPreset(name: CameraPreset, immediate = true): void {
    const stand = this.findStand();
    this.rig.lookAlong(stand.focus, stand.forward, immediate);
    if (name === 'vista') {
      // high over the terraces, looking down across them and out over the next hills: a wide portrait view
      const zoom = this.rig.zoomForAltitude(VISTA.height);
      this.rig.setZoom(zoom, immediate);
      this.rig.lookUp(VISTA.tilt - this.rig.framing(zoom).tilt);
      this.rig.widenFov(VISTA.widen, immediate);
    } else if (name === 'muse' || name === 'meadow') this.rig.setZoom(this.rig.zoomForAltitude(VIEW_HEIGHT.standing), immediate);
    else this.rig.setZoom(this.rig.zoomForAltitude(VIEW_HEIGHT.above), immediate);
    this.posed = true;
  }

  /**
   * The best stand from a spiral of candidates over the planet: on a terraced hillside (its smoothed slope
   * between the flats' and the woods'), the ground falling away in front of it; facing downhill.
   */
  private findStand(): { focus: Vector3; forward: Vector3 } {
    const f = this.field;
    const R = f.R;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const g = this.g3;
    let best = -Infinity;
    const focus = new Vector3(0, 1, 0);
    const forward = new Vector3(1, 0, 0);
    const d = new Vector3();
    const fwd = new Vector3();
    const q = new Vector3();
    const n = 600;
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
      const s = f.slope(d.x, d.y, d.z);
      if (s < f.p.flat + 0.04 || s > f.p.steep - 0.04) continue;
      const h0 = f.height(d.x, d.y, d.z, g);
      fwd.set(-g[0], -g[1], -g[2]);
      if (fwd.lengthSq() < 1e-12) continue;
      fwd.normalize();
      // (terraces below it and the ground falling away ahead, the hills rising again beyond)
      let terraced = 0;
      let low = h0;
      let across = 0;
      for (let k = 1; k <= 16; k++) {
        const dist = 8 * k;
        q.copy(d).addScaledVector(fwd, dist / R).normalize();
        const sk = f.slope(q.x, q.y, q.z);
        const hk = f.height(q.x, q.y, q.z);
        if (dist < 60 && sk > f.p.flat && sk < f.p.steep) terraced++;
        if (dist < 100) low = Math.min(low, hk);
        else across = Math.max(across, hk - h0);
      }
      const score = terraced / 7 + 0.03 * Math.min(h0 - low, 18) + 0.02 * Math.min(Math.max(across, 0), 30);
      if (score > best) {
        best = score;
        focus.copy(d);
        forward.copy(fwd);
      }
    }
    return { focus, forward };
  }

  onParams(changed: ReadonlySet<ParamPath>): void {
    if (changed.has('world.seed')) this.field = this.makeField();
  }

  /** The planet's size: in this world it never changes (Kai: the diameter stays, so the terraces are built once). */
  private pinGrowth(g: number, areaMin: number, areaMax: number): void {
    growthState(g, areaMin, areaMax, this.growth);
    this.growth.radius = FIELD.radius;
    this.growth.area = 4 * Math.PI * FIELD.radius * FIELD.radius;
  }

  update(clock: FrameClock, aspect: number, viewportHeight: number): void {
    const p = this.store.values;
    this.pinGrowth(p.world.growth, p.world.areaMin, p.world.areaMax);
    const R = this.growth.radius;
    this.band.update(R, clock.realDt);
    this.own.uPaddy.value.y = seasonFront(p.world.bloom);

    const f = this.field;
    this.rig.update(clock.realDt, R, aspect, (dir) => f.height(dir.x, dir.y, dir.z));
    const rig = this.rig;
    this.warp.focus.copy(rig.focus);
    this.warp.up.copy(rig.up);
    this.warp.k = warpForZoom(rig.zoom, R, p.view.visualRadius);
    const g = this.globals;
    g.uTime.value = clock.time;
    g.uRadius.value = R;
    g.uRadiusLag.value = Math.exp(this.band.lnRLag);
    this.band.write(g.uGrowthBand.value);
    g.uWarpFocus.value.copy(this.warp.focus);
    g.uWarpUp.value.copy(this.warp.up);
    g.uWarpK.value = this.warp.k;

    this.updateLight(p.light.timeOfDay);
    this.updateLook(clock);

    const cam = rig.camera;
    this.frustum.setFromProjectionMatrix(this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    // the terraces, the whole planet's, built once for this seed (in a worker: until they are, the sky alone)
    this.objects.update(this.noiseSeed);
    if (this.objects.trees && this.objects.trees !== this.trees.placed) this.trees.place(this.objects.trees);
    // the rice reads the built paddies round the focus from their map
    this.paddyMap.render(this.renderer, this.objects.group, rig.up, rig.forward, R, `${this.objects.version}/${this.own.uPaddy.value.y.toFixed(3)}`);
    // the rice near the focus, fewer as the camera rises, none from a bird's height
    const riceNear = RICE.near * smoothstep(60, 22, rig.altitude);
    this.nearFieldDrawn = riceNear > 0.5;
    this.rice.update(this.renderer, { seed: p.world.seed, radius: R, radiusHi: this.band.radiusHi, focus: rig.up, frustum: this.frustum, warp: this.warp, queue: this.queue, near: riceNear }, riceNear, p.wind.sheen * 1.2);
    this.own.uRiceNear.value.set(rig.up.x, rig.up.y, rig.up.z, riceNear);
    this.sky.update(cam, this.palette, rig.up, this.sunDir, rig.tilt);
    this.look.uPixelAngle.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
  }

  private updateLight(hours: number): void {
    this.palette.update(hours);
    const sun = sunAt(hours);
    localSun(this.rig.up, sun.elevation, sun.azimuth, this.sunDir);
    this.look.uSunDir.value.copy(this.sunDir);
    this.look.uSunAngles.value.set(Math.sin(sun.elevation), Math.cos(sun.elevation), Math.cos(sun.azimuth), Math.sin(sun.azimuth));
    const sunC = this.palette.get(ROW.LIGHT, 0, this.look.uSunTint.value);
    sunC.r /= NOON_SUN.r;
    sunC.g /= NOON_SUN.g;
    sunC.b /= NOON_SUN.b;
    const skyC = this.palette.get(ROW.LIGHT, 1, this.look.uShadeTint.value);
    skyC.r /= NOON_SKY.r;
    skyC.g /= NOON_SKY.g;
    skyC.b /= NOON_SKY.b;
  }

  private updateLook(clock: FrameClock): void {
    const p = this.store.values;
    const L = this.look;
    L.uToon.value.set(p.style.toonBands, p.style.bandSoftness, 0.7, 0);
    L.uFog.value.set(p.style.fogDensity * 0.0011 * (1 + 5 * this.rig.tilt), 0.06 + 0.3 * p.style.fogDensity, this.rig.altitude * 0.95, 0.7);
    L.uFogUp.value.copy(this.rig.up);
    // the wind: a rotation field fixed to the planet, aimed by the direction param
    const north = tangentToward(WORLD_UP, WORLD_X, this.tmp);
    const w = north.applyAxisAngle(WORLD_UP, (-p.wind.direction * Math.PI) / 180);
    const axis = this.windAxis.crossVectors(WORLD_UP, w).normalize();
    L.uWindVec.value.set(axis.x, axis.y, axis.z, p.wind.strength);
    L.uGust.value.set(clock.time, 0, p.wind.gustiness, p.wind.strength);
    const R = this.growth.radius;
    const gusts = (-clock.time * (2.5 + 6 * p.wind.strength)) / R;
    const ripples = (-clock.time * (3.5 + 9 * p.wind.strength)) / R;
    (this.shared.uGustRot.value as Vector4).set(Math.cos(gusts), Math.sin(gusts), Math.cos(ripples), Math.sin(ripples));
    (this.shared.uGustFreq.value as Vector4).set(R / 16, R / 5.5, 0, 0);
    L.uDebug.value = DEBUG_VIEWS[p.ui.debug];
    this.own.uPaddyWater.value.set(p.water.reflection, 0, 0, clock.time);
    this.own.uRiceLook.value.set(p.wind.sheen * 1.2, 0, 0, 0);
  }

  effectiveTriangles(submitted: number): number {
    return submitted;
  }

  private readonly pickGround = {
    radius: FIELD.radius,
    sample: (dir: Vector3, out: GroundSample): GroundSample => {
      out.height = this.field.height(dir.x, dir.y, dir.z);
      out.water = 1;
      out.depth = 0;
      return out;
    },
  };

  pick(ndcX: number, ndcY: number): Pick | null {
    return pickSurface(this.rig.camera, ndcX, ndcY, this.warp, this.pickGround);
  }

  /** A gust ring bursting out from a point. */
  gust(dir: Vector3, time: number): void {
    const rings = this.shared.uGustRings.value as Vector4[];
    rings[this.nextGust++ % rings.length].set(dir.x, dir.y, dir.z, time);
  }

  /** A ripple on a paddy's water (rings come later; for now the wind's ring stirs it). */
  ripple(dir: Vector3, time: number): void {
    this.gust(dir, time);
  }

  whenBuilt(): Promise<void> {
    return this.objects.whenBuilt();
  }

  settle(): void {
    this.band.settle();
    this.queue.drain();
    this.rig.settle();
    this.pinGrowth(this.store.values.world.growth, this.store.values.world.areaMin, this.store.values.world.areaMax);
  }
}
