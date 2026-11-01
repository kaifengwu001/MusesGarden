import { Frustum, Matrix4, Scene, Vector3, Vector4, type IUniform, type WebGLRenderer } from 'three';
import { BuildQueue } from '../core/buildQueue';
import type { FrameClock } from '../core/clock';
import type { Globals } from '../core/globals';
import type { Tier } from '../core/quality';
import type { ParamPath, ParamStore } from '../params';
import type { CameraPreset, PlanetWorld } from '../planetWorld';
import { TerrainBake } from '../planet/bake';
import { LOD_DEFAULT, type LodConfig } from '../planet/chunks';
import { tangentToward, travel } from '../planet/geo';
import { growthState, type GrowthState } from '../planet/growth';
import { GrowthBand } from '../planet/rest';
import { Surface } from '../planet/surface';
import { createLookUniforms } from '../render/look';
import { Palette, ROW, sunAt } from '../render/palette';
import { Sky } from '../render/sky';
import { localSun } from '../render/sun';
import { unwarpPoint, warpForZoom } from '../render/warp';
import { smoothstep } from '../core/math';
import { CameraRig } from '../view/camera';
import { pickSurface, type Pick } from '../view/picking';
import fragmentShader from './bake.frag.glsl?raw';
import { createTerraceFieldUniforms, gradientFrame, type TerraceFieldParams, type TerraceFieldUniforms } from './fields';
import { TERRACE_ROWS } from './palette';
import surfaceFragment from './surface.frag.glsl?raw';
import surfaceVertex from './surface.vert.glsl?raw';
import { Backdrop } from './backdrop';
import { TerraceBirds } from './birds';
import { Houses } from './houses';
import { Rice, RICE } from './rice';
import { Towers } from './towers';
import { Trees } from './trees';
import { createTerrainUniforms, createTerraceSample, generateTerraceLayout, seasonFront, TerraceTerrain } from './terrain';
import { createVillageUniforms, houseDistance, placeVillages, writeVillageUniforms, type Village } from './villages';
import { findTerraceVista } from './vista';
import { CubeReadback } from './bakeReader';
import { createCellSample } from './cells';
import { floorPieces, type FloorPiece } from './floors';
import { TerraceObjects } from './objects';
import { PaddyMap } from './paddyMap';
import { surveyCell, type CellSurvey } from './survey';

const NOON = new Palette(TERRACE_ROWS);
const NOON_SUN = NOON.get(ROW.LIGHT, 0);
const NOON_SKY = NOON.get(ROW.LIGHT, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const DEBUG_VIEWS = { off: 0, chunks: 1, morph: 2, normals: 3, land: 4, cells: 5 } as const;
/** Parameters the terraces' fields (and so the bake) depend on. */
const FIELD_PATHS: ReadonlySet<string> = new Set(['terraces.hills', 'terraces.forest']);
/**
 * The valley fog: its density in a bank at the default setting (1/m), the
 * banks' top and its softness (m), the clearing it leaves round the camera
 * (m), and its two layers' drift (m/s).
 */
const FOG = { density: 0.17, top: 2.8, soft: 1.1, clearing: 24, drift: [0.55, 1.1] } as const;
/** Heights of the named views (m): a bird's-eye view over the terraces, and standing on one. */
const VIEW_HEIGHT = { above: 70.2, standing: 4.3 } as const;
/**
 * The vista: the camera's height (m) and its tilt from straight down (rad). Low enough that the warp
 * lays the ground out flat to a far horizon (zoom 0.55–0.6), as the meadow's vista does: higher up the
 * small planet curves away and the sky shows, where the painting has none.
 */
const VISTA = { height: 24, tilt: (52 * Math.PI) / 180, widen: 28 } as const;
/** The rice's pool, in pages of 2048 blades (rice.ts). */
const RICE_PAGES = 400;

/**
 * The terraces: a second planet to visit, built on the meadow's foundations
 * (rest space, growth, the bake, CDLOD, the warp, the painted light).
 * Hills cut into terraced rice paddies, flooded, growing and ripe; forest on
 * the hills and the karst peaks left wild; fog meandering in the valleys.
 * Each frame: growth → fade band → fields (re-baked only when they change)
 * → camera → light, wind, fog and look uniforms → warp → LOD → sky.
 */
export class TerraceWorld implements PlanetWorld {
  readonly kind = 'terraces' as const;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly palette = new Palette(TERRACE_ROWS);
  readonly look = createLookUniforms();
  readonly terrainUniforms = createTerrainUniforms();
  readonly band = new GrowthBand();
  readonly queue = new BuildQueue();
  readonly growth: GrowthState = { g: 0, area: 0, radius: 128 };
  readonly sky: Sky;
  readonly surface: Surface;
  readonly bake: TerrainBake<TerraceFieldUniforms>;
  terrain: TerraceTerrain;
  readonly shared: Record<string, IUniform>;
  readonly warp = { focus: new Vector3(), up: new Vector3(0, 1, 0), k: 0 };
  readonly sunDir = new Vector3(0, 1, 0);
  lod: LodConfig = LOD_DEFAULT;
  nearFieldDrawn = false;
  get nearInstances(): { grass: number; flowers: number } {
    return { grass: this.rice.layer.visibleInstances, flowers: 0 };
  }
  /** How long the last vista search took (ms; 0 when cached). */
  vistaMs = 0;
  readonly houses: Houses;
  readonly towers: Towers;
  readonly backdrop: Backdrop;
  readonly trees: Trees;
  readonly rice: Rice;
  readonly objects: TerraceObjects;
  readonly paddyMap: PaddyMap;
  readonly birds: TerraceBirds;
  /** The villages on the planet at its size (placed again whenever the ground is baked in full). */
  villages: Village[] = [];
  private readonly villageUniforms = createVillageUniforms();
  private villagesFor = '';
  /** The valley fog, the paddies' water and the crop's look (fog.glsl, water.glsl, surface.frag.glsl). */
  private readonly atmosphere = {
    uValleyFog: { value: new Vector4(FOG.density, FOG.top, FOG.soft, FOG.clearing) },
    uFogDrift: { value: new Vector4(1, 0, 1, 0) },
    uFogCover: { value: new Vector4(0.56, 0.16, 0.8, 0) },
    uPaddyWater: { value: new Vector4(0.85, 80, 0, 0) },
    uRiceLook: { value: new Vector4(0.6, 0, 0, 0) },
    uRiceNear: { value: new Vector4(0, 1, 0, 0) },
  };
  private fieldParams: TerraceFieldParams = { hills: 13, forest: 0.1 };
  private readonly cameraPlanet = new Vector3();
  /** Whether the valley fog is drawn (dev: `only=` without fog hides it). */
  private onlyFog = true;
  private fieldKey = '';
  private fieldsR = Number.NaN;
  private fieldsKey = '';
  private fieldsFull = false;
  private fieldsStill = 0;
  private posed = false;
  /** The world's clock, as of the last update (a named view of the birds reads the time it is now). */
  private clock: FrameClock | null = null;
  private nextGust = 0;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly windAxis = new Vector3();
  private readonly tmp = new Vector3();
  private readonly heightBound = (): number => this.terrain.maxHeight;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly globals: Globals,
    private readonly store: ParamStore,
    tier: Tier,
  ) {
    this.bake = new TerrainBake(tier.maps.bake, { name: 'terraces bake', fragmentShader, uniforms: createTerraceFieldUniforms(), layout: true });
    this.terrain = new TerraceTerrain(generateTerraceLayout(store.values.world.seed));
    this.refreshFieldParams();
    this.look.uPalette.value = this.palette.texture;
    this.terrainUniforms.uTerraceBake.value = this.bake.terrainTexture(false);
    this.terrainUniforms.uTerraceLife.value = this.bake.floraTexture(false);
    this.terrainUniforms.uTerraceLayout.value = this.bake.layoutTexture(false);
    this.shared = {
      ...globals,
      ...this.look,
      ...this.terrainUniforms,
      ...this.atmosphere,
      ...this.villageUniforms,
      uGustRot: { value: new Vector4(1, 0, 1, 0) },
      uGustFreq: { value: new Vector4(8, 24, 0, 0) },
      uGustRings: { value: Array.from({ length: 4 }, () => new Vector4(0, 1, 0, -1)) },
    };
    this.sky = new Sky();
    this.backdrop = new Backdrop(store.values.world.seed);
    this.surface = new Surface(this.shared, tier.terrainGrid, { name: 'terraces ground', vertexShader: surfaceVertex, fragmentShader: surfaceFragment });
    this.houses = new Houses(this.shared);
    this.towers = new Towers(this.shared);
    this.trees = new Trees(this.shared);
    this.birds = new TerraceBirds(this.shared);
    this.paddyMap = new PaddyMap(this.shared);
    Object.assign(this.shared, this.paddyMap.uniforms);
    this.rice = new Rice(this.shared, RICE_PAGES);
    this.objects = new TerraceObjects(this.shared);
    this.scene.add(this.sky.mesh, this.backdrop.mesh, this.surface.mesh, this.objects.group, this.rice.mesh, this.houses.mesh, this.towers.group, this.trees.mesh, this.birds.mesh);
    // (dev: `only=` in the URL shows the planet's parts named, the rest hidden, to judge each alone:
    // terraces, rice, houses, towers, trees, birds, fog; the ground always)
    const only = new URLSearchParams(location.hash.slice(1)).get('only');
    if (only !== null) {
      const show = new Set(only.split(','));
      const parts = { terraces: this.objects.group, rice: this.rice.mesh, houses: this.houses.mesh, towers: this.towers.group, trees: this.trees.mesh, birds: this.birds.mesh };
      for (const [name, part] of Object.entries(parts)) part.visible = show.has(name);
      this.onlyFog = show.has('fog');
    }
    this.applyTier(tier);
  }

  applyTier(tier: Tier): void {
    // a finer grid near the camera than the meadow's: its rows gather onto the walls' edges, a bund is
    // a third of a meter across (MESH in terrain.ts holds the finest spacing this gives)
    this.lod = { ...LOD_DEFAULT, grid: tier.terrainGrid, leafSize: 2 };
  }

  get needsDefaultPose(): boolean {
    return !this.posed;
  }

  markPosed(): void {
    this.posed = true;
  }

  /** Over the terraces, looking down across a valley: a stand on a terraced hillside, facing downhill. */
  defaultPose(): void {
    this.prepare();
    const stand = this.findStand();
    this.rig.lookAlong(stand.focus, stand.forward);
    this.posed = true;
  }

  cameraPreset(name: CameraPreset, immediate = true): void {
    this.prepare();
    if (name === 'homestead' && this.villages.length > 0) {
      // a village, from out over the terraces below it, looking up at it
      const v = this.villages[0];
      const h = v.houses[0];
      const R = this.terrain.radius;
      const focus = travel(v.dir, h.front, (v.radius + 22) / R, new Vector3());
      this.rig.lookAlong(focus, tangentToward(focus, v.dir, new Vector3()), immediate);
      const zoom = this.rig.zoomForAltitude(26);
      this.rig.setZoom(zoom, immediate);
      this.rig.lookUp((60 * Math.PI) / 180 - this.rig.framing(zoom).tilt);
      this.posed = true;
      return;
    }
    if (name === 'lakes') {
      // a valley where a flock circles, from a terrace across it, a little above the birds' loop
      this.birds.update(this.clock?.time ?? 0, this.terrain);
      const loop = this.birds.loop(0);
      if (loop) {
        const R = this.terrain.radius;
        const a = new Vector3();
        const b = new Vector3();
        const t = new Vector3();
        const q = new Vector3();
        gradientFrame(loop.centre, a, b);
        const s = createTerraceSample();
        const focus = travel(loop.centre, a, (loop.radius + 46) / R, new Vector3());
        // the first bearing round the loop where the stand is open terraced ground and nothing stands taller than the birds between
        for (let k = 0; k < 12; k++) {
          t.copy(a).multiplyScalar(Math.cos((k * Math.PI) / 6)).addScaledVector(b, Math.sin((k * Math.PI) / 6));
          travel(loop.centre, t, (loop.radius + 46) / R, q);
          this.terrain.terraceAt(q, s);
          if (s.wild > 0.3) continue;
          let clear = true;
          for (let m = 0.15; m < 1 && clear; m += 0.1) clear = this.terrain.fields.natural(travel(loop.centre, t, (m * (loop.radius + 46)) / R, new Vector3())) < loop.floor + loop.height - 2;
          if (!clear) continue;
          focus.copy(q);
          break;
        }
        this.rig.lookAlong(focus, tangentToward(focus, loop.centre, new Vector3()), immediate);
        // from above the birds' loop, looking down across it: white birds against the fields and the forest
        const zoom = this.rig.zoomForAltitude(Math.max(12, loop.floor + loop.height + 44 - this.terrain.height(focus)));
        this.rig.setZoom(zoom, immediate);
        this.rig.lookUp(Math.atan2(loop.radius + 46, loop.height + 44) - this.rig.framing(zoom).tilt);
        this.posed = true;
        return;
      }
    }
    const stand = this.findStand();
    this.rig.lookAlong(stand.focus, stand.forward, immediate);
    if (name === 'vista') {
      // the painting's view (reference/terraces/vista-green.webp): high over the terraces, looking down
      // across them to the flooded fields and the forest, no sky (vista.ts searches the planet for it)
      const R = this.growth.radius;
      const rv = this.store.values.view.visualRadius;
      // (a wide view, to take in a hillside of terraces in a portrait frame as the painting does)
      const framing = (h: number): { fov: number; k: number } => {
        const z = this.rig.zoomForAltitude(h);
        return { fov: this.rig.framing(z).fov + VISTA.widen, k: warpForZoom(z, R, rv) };
      };
      const aspect = this.rig.camera.aspect;
      const t0 = performance.now();
      const v = findTerraceVista(this.terrain, framing, aspect, VISTA.height, VISTA.tilt, this.villages, `${this.fieldsKey}/${R}/${rv}/${aspect.toFixed(3)}/${this.terrain.seasonFront.toFixed(3)}`);
      this.vistaMs = performance.now() - t0;
      this.rig.lookAlong(v.focus, v.forward, immediate);
      const zoom = this.rig.zoomForAltitude(v.height);
      this.rig.setZoom(zoom, immediate);
      this.rig.lookUp(v.tilt - this.rig.framing(zoom).tilt);
      this.rig.widenFov(VISTA.widen, immediate);
      this.posed = true;
      return;
    } else if (name === 'muse' || name === 'meadow') this.rig.setZoom(this.rig.zoomForAltitude(VIEW_HEIGHT.standing), immediate);
    else this.rig.setZoom(this.rig.zoomForAltitude(VIEW_HEIGHT.above), immediate);
    this.posed = true;
  }

  /** Set up the ground for this world before the first frame does (a named view reads it, and the villages). */
  private prepare(): void {
    const world = this.store.values.world;
    growthState(world.growth, world.areaMin, world.areaMax, this.growth);
    if (this.growth.radius !== this.fieldsR || this.fieldKey !== this.fieldsKey || !this.fieldsFull) this.refreshFields(true);
  }

  /**
   * The best stand from a spiral of candidates over the planet: on a terraced
   * hillside, terraces below it, a valley in front and a peak or a hill
   * across it; facing downhill.
   */
  private findStand(): { focus: Vector3; forward: Vector3 } {
    const t = this.terrain;
    const R = t.radius;
    const s = createTerraceSample();
    const golden = Math.PI * (3 - Math.sqrt(5));
    const d = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const q = new Vector3();
    const fwd = new Vector3();
    let best = -Infinity;
    const focus = new Vector3(0, 1, 0);
    const forward = new Vector3(1, 0, 0);
    const n = 700;
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      d.set(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
      t.terraceAt(d, s);
      if (s.wild > 0.05 || s.slope < 0.12 || s.slope > 0.55) continue;
      const h0 = s.natural;
      // downhill from the hills' own height
      gradientFrame(d, a, b);
      const e = 2 / R;
      const ha = t.fields.natural(q.copy(d).addScaledVector(a, e).normalize());
      const hb = t.fields.natural(q.copy(d).addScaledVector(b, e).normalize());
      fwd.copy(a).multiplyScalar(-(ha - h0)).addScaledVector(b, -(hb - h0));
      if (fwd.lengthSq() < 1e-12) continue;
      fwd.normalize();
      let terraced = 0;
      let low = h0;
      let across = 0;
      for (let k = 1; k <= 24; k++) {
        const dist = 8 * k;
        travel(d, fwd, dist / R, q);
        t.terraceAt(q, s);
        if (dist < 70 && s.wild < 0.3) terraced++;
        if (dist < 140) low = Math.min(low, s.natural);
        if (dist >= 90) across = Math.max(across, s.natural - h0);
      }
      const score = terraced / 8 + 0.03 * Math.min(h0 - low, 18) + 0.025 * Math.min(Math.max(across, 0), 40);
      if (score > best) {
        best = score;
        focus.copy(d);
        forward.copy(fwd);
      }
    }
    return { focus, forward };
  }

  onParams(changed: ReadonlySet<ParamPath>): void {
    if (changed.has('world.seed')) this.terrain = new TerraceTerrain(generateTerraceLayout(this.store.values.world.seed));
    for (const path of changed) {
      if (FIELD_PATHS.has(path)) {
        this.refreshFieldParams();
        break;
      }
    }
  }

  private refreshFieldParams(): void {
    const p = this.store.values.terraces;
    this.fieldParams = { hills: p.hills, forest: p.forest };
    this.fieldKey = `${this.terrain.layout.seed}/${JSON.stringify(this.fieldParams)}`;
  }

  private refreshFields(full: boolean): void {
    const R = this.growth.radius;
    this.fieldsR = R;
    this.fieldsKey = this.fieldKey;
    this.fieldsFull = full;
    this.terrain.update(R, this.fieldParams, this.store.values.world.bloom);
    this.towers.set(this.terrain);
    // (near a cell's edge its cell is read from more than a texel of the life bake in: it is at half resolution)
    this.terrain.writeUniforms(this.terrainUniforms, this.bake.texelMeters(R, full));
    this.bake.bake(this.renderer, this.terrain.fields, `${R}/${this.fieldKey}`, full);
    this.terrainUniforms.uTerraceBake.value = this.bake.terrainTexture(full);
    this.terrainUniforms.uTerraceLife.value = this.bake.floraTexture(full);
    this.terrainUniforms.uTerraceLayout.value = this.bake.layoutTexture(full);
    // the villages, once the ground holds still (they read the ground: a few ms)
    const key = `${R}/${this.fieldKey}`;
    if (full && key !== this.villagesFor) {
      this.villagesFor = key;
      this.villages = placeVillages(this.terrain);
      writeVillageUniforms(this.villages, this.villageUniforms);
      this.houses.set(this.villages, R);
    }
  }

  update(clock: FrameClock, aspect: number, viewportHeight: number): void {
    this.clock = clock;
    const p = this.store.values;
    growthState(p.world.growth, p.world.areaMin, p.world.areaMax, this.growth);
    const R = this.growth.radius;
    this.band.update(R, clock.realDt);
    if (this.terrain.layout.seed !== p.world.seed) this.terrain = new TerraceTerrain(generateTerraceLayout(p.world.seed));
    if (`${this.terrain.layout.seed}/${JSON.stringify(this.fieldParams)}` !== this.fieldKey) this.refreshFieldParams();
    if (R !== this.fieldsR || this.fieldKey !== this.fieldsKey) {
      this.refreshFields(false);
      this.fieldsStill = 0;
    } else if (!this.fieldsFull && ++this.fieldsStill >= 6) this.refreshFields(true);
    this.trees.update(this.terrain.layout.noiseSeed, R);
    // the season is not baked: the bloom slider moves it live
    this.terrain.seasonFront = seasonFront(p.world.bloom);
    this.terrainUniforms.uPaddy.value.y = this.terrain.seasonFront;

    this.rig.update(clock.realDt, R, aspect, (dir) => this.terrain.height(dir));
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
    this.towers.update(unwarpPoint(this.warp, rig.camera.position, this.cameraPlanet));
    this.houses.update(this.cameraPlanet);

    this.updateLight(p.light.timeOfDay);
    this.updateLook(clock);
    this.birds.update(clock.time, this.terrain);

    const cam = rig.camera;
    this.frustum.setFromProjectionMatrix(this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.surface.update(
      {
        camera: cam.position,
        radius: R,
        heightAbove: this.terrain.maxHeight,
        heightBelow: 3,
        frustum: this.frustum,
        warp: this.warp,
        horizonCull: Math.abs(this.warp.k) * R < 0.01,
        warpHorizon:
          Math.abs(this.warp.k) * R >= 0.01
            ? {
                focusDir: rig.up,
                radiusEff: 1 / (1 / R + 2 * this.warp.k),
                eyeHeight: rig.altitude + 0.5,
                heightAt: this.heightBound,
              }
            : null,
        home: null,
      },
      this.lod,
    );
    // the terraces as built, round the focus, once the ground is baked in full (until then the paint)
    if (this.fieldsFull) {
      const key = `${this.fieldsR}/${this.fieldsKey}`;
      this.objects.update(this.terrain, this.bakesRead(), this.villages, rig.up, `${key}/${this.villages.length}`, this.queue);
      this.terrainUniforms.uObjects.value.set(this.objects.centre.x, this.objects.centre.y, this.objects.centre.z, this.objects.reach);
      // the rice reads the built paddies round the focus from their map
      this.paddyMap.render(this.renderer, this.objects.group, rig.up, rig.forward, R, `${key}/${this.objects.group.children.length}/${this.terrain.seasonFront.toFixed(3)}`);
    } else this.terrainUniforms.uObjects.value.w = 0;
    // the rice near the focus, fewer as the camera rises, none from a bird's height
    const riceNear = RICE.near * smoothstep(60, 22, rig.altitude);
    this.nearFieldDrawn = riceNear > 0.5;
    this.rice.update(
      this.renderer,
      { seed: p.world.seed, radius: R, radiusHi: this.band.radiusHi, focus: rig.up, frustum: this.frustum, warp: this.warp, queue: this.queue, near: riceNear },
      riceNear,
      p.wind.sheen * 1.2,
    );
    this.atmosphere.uRiceNear.value.set(rig.up.x, rig.up.y, rig.up.z, riceNear);
    this.sky.update(cam, this.palette, rig.up, this.sunDir, rig.tilt);
    this.backdrop.update(cam, this.palette, clock.time, 1 - smoothstep(0.15, 0.6, rig.tilt));
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
    // a softer distance than the meadow's: the valley fog does the rest
    // (a near peak keeps the ink's dark teal, as in the painting, with the white birds against it)
    L.uFog.value.set(p.style.fogDensity * 0.0011 * (1 + 5 * this.rig.tilt), 0.06 + 0.3 * p.style.fogDensity, this.rig.altitude * 0.95, 0.7);
    L.uFogUp.value.copy(this.rig.up);
    // the wind: a rotation field fixed to the planet, aimed by the direction param along the grain
    const ref = this.terrain.layout.grain;
    const north = tangentToward(ref, Math.abs(ref.y) > 0.98 ? WORLD_X : WORLD_UP, this.tmp);
    const w = north.applyAxisAngle(ref, (-p.wind.direction * Math.PI) / 180);
    const axis = this.windAxis.crossVectors(ref, w).normalize();
    L.uWindVec.value.set(axis.x, axis.y, axis.z, p.wind.strength);
    L.uGust.value.set(clock.time, 0, p.wind.gustiness, p.wind.strength);
    const R = this.growth.radius;
    const gusts = (-clock.time * (2.5 + 6 * p.wind.strength)) / R;
    const ripples = (-clock.time * (3.5 + 9 * p.wind.strength)) / R;
    (this.shared.uGustRot.value as Vector4).set(Math.cos(gusts), Math.sin(gusts), Math.cos(ripples), Math.sin(ripples));
    (this.shared.uGustFreq.value as Vector4).set(R / 16, R / 5.5, 0, 0);
    L.uDebug.value = DEBUG_VIEWS[p.ui.debug];
    // the fog drifts in its two layers along the wind, slowly
    const a = (-clock.time * FOG.drift[0] * (0.4 + p.wind.strength)) / R;
    const b = (-clock.time * FOG.drift[1] * (0.4 + p.wind.strength)) / R;
    const A = this.atmosphere;
    A.uFogDrift.value.set(Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b));
    A.uValleyFog.value.x = this.onlyFog ? (FOG.density * p.terraces.fog) / 0.55 : 0;
    A.uPaddyWater.value.set(p.water.reflection, this.terrain.maxHeight, 0, clock.time);
    A.uRiceLook.value.set(p.wind.sheen * 1.2, 0, 0, 0);
  }

  effectiveTriangles(submitted: number): number {
    return submitted;
  }

  pick(ndcX: number, ndcY: number): Pick | null {
    return pickSurface(this.rig.camera, ndcX, ndcY, this.warp, this.terrain);
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

  private readback: { key: string; terrain: CubeReadback; layout: CubeReadback } | null = null;

  /** The bakes read back to the CPU (the terraces' survey), once per full bake. */
  private bakesRead(): { terrain: CubeReadback; layout: CubeReadback } {
    const key = `${this.fieldsR}/${this.fieldsKey}/${this.fieldsFull}`;
    if (this.readback?.key !== key) {
      const t = this.bake.targets(this.fieldsFull);
      if (!t.layout) throw new Error('the terraces bake has no layout');
      this.readback = { key, terrain: CubeReadback.read(this.renderer, t.terrain), layout: CubeReadback.read(this.renderer, t.layout) };
    }
    return this.readback;
  }

  /** Dev: the terraces surveyed in the cells round a direction (within `reach` m). */
  surveyNear(dir: Vector3, reach: number, mode: 'terraces' | 'flats' = 'terraces'): CellSurvey[] {
    this.prepare();
    const rb = this.bakesRead();
    const t = this.terrain;
    const R = t.radius;
    const size = R / t.cells.frequency;
    const seen = new Set<string>();
    const out: CellSurvey[] = [];
    const a = new Vector3();
    const b = new Vector3();
    gradientFrame(dir, a, b);
    const q = new Vector3();
    for (let x = -reach; x <= reach; x += 8) {
      for (let y = -reach; y <= reach; y += 8) {
        q.copy(dir).multiplyScalar(R).addScaledVector(a, x).addScaledVector(b, y).normalize();
        const c = t.cells.at(q, createCellSample());
        const id = `${c.x},${c.y},${c.z}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const at = createCellSample();
        const inCell = (d: Vector3): number => {
          t.cells.at(d, at);
          return at.x === c.x && at.y === c.y && at.z === c.z ? at.edge : -at.edge;
        };
        out.push(surveyCell(c, R, size, rb.terrain, rb.layout, t.plots, t.seasonFront, mode, (d) => houseDistance(this.villages, d, R), inCell));
      }
    }
    return out;
  }

  /** Dev: a surveyed cell's floor pieces. */
  floors(s: CellSurvey, piece: (p: FloorPiece) => void, plain: (i: number, j: number, paddy: number) => void): void {
    floorPieces(s, piece, plain);
  }

  settle(): void {
    this.band.settle();
    this.queue.drain();
    this.rig.settle();
    growthState(this.store.values.world.growth, this.store.values.world.areaMin, this.store.values.world.areaMax, this.growth);
    this.refreshFields(true);
  }
}
