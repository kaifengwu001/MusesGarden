import { Color, Frustum, Matrix4, PerspectiveCamera, Ray, Scene, Vector3, Vector4, type IUniform, type WebGLRenderer } from 'three';
import { BuildQueue } from '../../src/core/buildQueue';
import type { FrameClock } from '../../src/core/clock';
import type { Globals } from '../../src/core/globals';
import { POOL_PAGES, type Tier } from '../../src/core/quality';
import { smoothstep } from '../../src/core/math';
import { FieldMap } from './life/fieldMap';
import { Birds } from './life/birds';
import { Butterflies } from './life/butterflies';
import { CIRRUS_BANDS, CloudRibbons } from './life/cloudRibbons';
import { Clouds, createCloudUniforms } from './life/clouds';
import { Flowers } from './life/flowers';
import { Grass } from './life/grass';
import { Petals } from '../../src/life/petals';
import { Muse, MUSE_HEIGHT, PRESSES } from './life/muse';
import { Residents } from './life/residents';
import { CanyonScenery } from './life/canyonScenery';
import { CanyonFauna } from './life/canyonFauna';
import { Homestead } from './life/props';
import { pickSurface, type Pick } from './view/picking';
import type { ParamPath, ParamStore } from './params';
import { TerrainBake } from './planet/bake';
import { LOD_DEFAULT, type LodConfig } from '../../src/planet/chunks';
import type { FieldParams } from './planet/fields';
import { tangentToward, travel } from '../../src/planet/geo';
import { growthState, type GrowthState } from '../../src/planet/growth';
import { GrowthBand } from '../../src/planet/rest';
import { Surface } from './planet/surface';
import { createGroundSample, createTerrainUniforms, generateLayout, Terrain, type Layout } from './planet/terrain';
import { createLookUniforms } from '../../src/render/look';
import { Palette, ROW, sunAt } from './render/palette';
import { Sky } from './render/sky';
import { localSun } from '../../src/render/sun';
import { warpForZoom, type WarpFrame } from '../../src/render/warp';
import { CameraRig } from '../../src/view/camera';
import { type Vista } from './view/vista';

const DEBUG_VIEWS = { off: 0, chunks: 1, morph: 2, normals: 3 } as const;
const NOON_SUN = new Palette().get(ROW.LIGHT, 0);
const NOON_SKY = new Palette().get(ROW.LIGHT, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
/** Parameters the meadow fields (and so the bake and the flower sorting) depend on. */
const FIELD_PATHS: ReadonlySet<string> = new Set([
  'terrain.roll',
  'terrain.hummocks',
  'terrain.wetlands',
  'terrain.waterLevel',
  'terrain.grain',
  'flowers.density',
  'flowers.patchiness',
  'flowers.patchSize',
  'flowers.pink',
  'flowers.star',
  'flowers.yellow',
  'flowers.blue',
]);

export type CameraPreset = 'homestead' | 'lakes' | 'meadow' | 'vista' | 'muse';

/**
 * The homestead view, after the painting: the camera's height (m) and
 * distance (m) from the point it looks at (cottage-local x, y, z, m), its
 * bearing from the front toward the right end (rad).
 */
const HOMESTEAD_VIEW = { height: 12, distance: 62, azimuth: 0.12, at: [12, 4, -12] } as const;
/** Muse's view: the camera's height over the ground Muse stands on (m), its distance (m), its bearing round from in front of Muse (rad, + to its left; at home, from straight out in front of the terrace), and the height it looks at (× Muse's). */
const MUSE_VIEW = { height: 1.23 * MUSE_HEIGHT, distance: 4 * MUSE_HEIGHT, azimuth: 0.3, at: 0.55 } as const;

/**
 * The scene and every system in it. Each frame: growth → fade band → fields
 * (re-baked only when they change) → camera → light, wind and look uniforms
 * → warp → LOD → near field → sky → build queue. main.ts owns the renderer
 * and the loop; this owns the world.
 */
export class World {
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly palette = new Palette();
  readonly look = createLookUniforms();
  readonly terrainUniforms = createTerrainUniforms();
  readonly cloudUniforms = createCloudUniforms();
  readonly band = new GrowthBand();
  readonly queue = new BuildQueue();
  readonly growth: GrowthState = { g: 0, area: 0, radius: 128 };
  readonly sky: Sky;
  readonly surface: Surface;
  readonly bake: TerrainBake;
  readonly field: FieldMap;
  readonly grass: Grass;
  readonly flowers: Flowers;
  homestead: Homestead;
  readonly clouds: Clouds;
  readonly cirrus: CloudRibbons;
  readonly birds: Birds;
  readonly butterflies: Butterflies;
  readonly muse: Muse;
  /** Muses visiting on a ticket (src/visit/): drawn, kept up to date and culled as the host is. */
  readonly visitors: Muse[] = [];
  readonly residents: Residents;
  readonly scenery: CanyonScenery;
  readonly fauna: CanyonFauna;
  followingResident: string | null = null;
  private heldResident: string | null = null;
  private heldVisitor: Muse | null = null;
  readonly petals: Petals;
  /** Press-and-hold bloom discs (rest space): direction, angular radius. */
  readonly userBlooms: Vector4[] = Array.from({ length: 8 }, () => new Vector4(0, 1, 0, 0));
  private growingBloom = -1;
  private nextBloom = 0;
  private nextRipple = 0;
  private nextGust = 0;
  private tier: Tier;
  terrain: Terrain;
  /** Uniform objects every world material shares. */
  readonly shared: Record<string, IUniform>;
  readonly warp = { focus: new Vector3(), up: new Vector3(0, 1, 0), k: 0 };
  readonly sunDir = new Vector3(0, 1, 0);
  lod: LodConfig = LOD_DEFAULT;

  /** The meadow-field parameters, and a key naming them (rebuilt only when they change). */
  private fieldParams!: FieldParams;
  private fieldKey = '';
  /** What the fields were last refreshed for, whether that bake was the full one, and frames since. */
  private fieldsR = Number.NaN;
  private fieldsKey = '';
  private fieldsLayout: Layout | null = null;
  private fieldsFull = false;
  private fieldsStill = 0;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  /** Where the camera is headed: its camera, frustum, focus direction and warp (the near field is built on the way). */
  private readonly aimCamera = new PerspectiveCamera();
  private readonly aimFrustum = new Frustum();
  private readonly aimUp = new Vector3();
  private readonly aimWarp = { focus: new Vector3(), up: new Vector3(0, 1, 0), k: 0 };
  private readonly ground = createGroundSample();
  private readonly east = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  /** Where the homestead shapes or shades the ground (Terrain.homeAreas): the terrain there is drawn with its code. */
  private readonly homeAreas = [
    { dir: new Vector3(), reach: 0 },
    { dir: new Vector3(), reach: 0 },
  ];
  private readonly windAxis = new Vector3();
  private readonly washTmp = new Color();
  private posed = false;
  /** The world's clock, as of the last update (a named view of Muse reads the time it is now, frozen or not). */
  private clock: FrameClock | null = null;
  /** Whether the last update drew the near field (grass or flowers around the focus). */
  nearFieldDrawn = false;
  private readonly heightBound = (): number => this.terrain.maxHeight;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly globals: Globals,
    private readonly store: ParamStore,
    tier: Tier,
  ) {
    this.tier = tier;
    this.bake = new TerrainBake(tier.maps.bake);
    this.terrain = new Terrain(generateLayout(store.values.world.seed));
    this.refreshFieldParams();
    this.look.uPalette.value = this.palette.texture;
    this.terrainUniforms.uTerrainBake.value = this.bake.terrainTexture(false);
    this.terrainUniforms.uFloraBake.value = this.bake.floraTexture(false);
    this.shared = {
      ...globals,
      ...this.look,
      ...this.terrainUniforms,
      ...this.cloudUniforms,
      uGustRot: { value: new Vector4(1, 0, 1, 0) },
      uGustFreq: { value: new Vector4(8, 24, 0, 0) },
      uGustRings: { value: Array.from({ length: 4 }, () => new Vector4(0, 1, 0, -1)) },
      uUserBloom: { value: this.userBlooms },
      // Muse's body where it lies in the grass, pressing it down round it (muse.ts; grass.vert.glsl, flower.vert.glsl)
      uMusePress: { value: Array.from({ length: PRESSES }, () => new Vector4()) },
      uMusePressK: { value: 0 },
    };
    this.sky = new Sky();
    this.field = new FieldMap(this.shared, tier.maps.field);
    Object.assign(this.shared, this.field.uniforms);
    this.surface = new Surface(this.shared, tier.terrainGrid);
    this.grass = new Grass(this.shared, POOL_PAGES.grass);
    this.flowers = new Flowers(this.shared, POOL_PAGES.flowers);
    this.homestead = new Homestead(this.shared, store.values.world.seed);
    this.clouds = new Clouds(this.shared, this.cloudUniforms, tier.maps.cloudShadow, tier.maps.cloudLayer, tier.maps.cloudWindow);
    this.cirrus = new CloudRibbons(this.shared);
    this.petals = new Petals(this.shared);
    this.birds = new Birds(this.shared);
    this.butterflies = new Butterflies(this.shared);
    this.muse = new Muse(this.shared);
    this.muse.useModel(store.values.muse.model);
    this.residents = new Residents(this.shared);
    this.scenery = new CanyonScenery(this.shared, this.terrain);
    this.fauna = new CanyonFauna(this.shared, this.terrain);
    this.scene.add(this.scenery.group, this.fauna.group);
    for (const shadow of this.fauna.shadowMeshes) this.clouds.addShadowCaster(shadow);
    for (const resident of this.residents.members) {
      this.scene.add(resident.muse.mesh, resident.muse.props.group);
      this.clouds.addShadowCaster(resident.muse.shadowMesh);
    }
    this.clouds.addShadowCaster(this.birds.shadowMesh);
    this.clouds.addShadowCaster(this.muse.shadowMesh);
    // (the float's rings on the water are the meadow's own ripples)
    this.muse.props.onRipple = (dir, time) => this.ripple(dir, time);
    this.scene.add(this.sky.mesh, this.surface.mesh, this.homestead.group, this.muse.mesh, this.muse.props.group, this.grass.mesh, ...this.flowers.meshes, this.petals.mesh, this.birds.mesh, this.butterflies.mesh, this.clouds.mesh, this.cirrus.mesh);
    this.applyTier(tier);
  }

  /** A visiting Muse joins the scene: its body, its props and its shadow. */
  addVisitor(muse: Muse): void {
    this.visitors.push(muse);
    this.scene.add(muse.mesh, muse.props.group);
    this.clouds.addShadowCaster(muse.shadowMesh);
  }

  applyTier(tier: Tier): void {
    this.tier = tier;
    this.lod = { ...LOD_DEFAULT, grid: tier.terrainGrid };
  }

  /** True when the camera has not been placed from the URL yet. */
  get needsDefaultPose(): boolean {
    return !this.posed;
  }

  markPosed(): void {
    this.posed = true;
  }

  /** Begin over the settlement, with the Three Sails in view. */
  defaultPose(): void {
    const world = this.store.values.world;
    growthState(world.growth, world.areaMin, world.areaMax, this.growth);
    this.refreshFields(false);
    this.cameraPreset('homestead');
  }

  /** Named settlement, canyon and globe views used by navigation and visual checks. */
  cameraPreset(name: CameraPreset, immediate = true): void {
    this.followingResident = null;
    const L = this.terrain.layout;
    const R = this.growth.radius;
    if (name === 'homestead') {
      // Keep the rock-backed shelter low on the left and the canyon opening
      // to its right, close to the reference's ground-level composition.
      const V = HOMESTEAD_VIEW;

      const across = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
      const target = travel(travel(L.cottage, across, V.at[0] / R, new Vector3()), L.homeBearing, V.at[2] / R, new Vector3());
      const toCamera = L.homeBearing.clone().applyAxisAngle(L.cottage, V.azimuth);
      const focus = travel(target, tangentToward(target, toCamera.add(target), new Vector3()), V.distance / R, new Vector3());
      const zoom = this.rig.zoomForAltitude(Math.max(1, this.terrain.cottageGround + V.height - this.terrain.height(focus)));
      this.rig.lookAlong(focus, tangentToward(focus, target, new Vector3()));
      this.rig.setZoom(zoom, true);
      // The nearby landscape is flattened by the camera warp, so aim using
      // the physical height difference rather than adding sphere curvature.
      const { tilt } = this.rig.framing(zoom);
      const drop = V.height - V.at[1];
      this.rig.lookUp(Math.atan2(V.distance, drop) - tilt);
    } else if (name === 'muse') {
      this.frameMuse();
    } else if (name === 'vista') {
      const vista = this.findVista();
      this.rig.lookAlong(vista.focus, vista.forward, immediate);
      this.rig.setZoom(vista.zoom, immediate);
    } else if (name === 'lakes') {
      // the nearest wetland margin (where land and water interlace), from a little above
      this.defaultPose();
      this.rig.setZoom(0.74, true);
    } else {
      const across = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
      const target = travel(L.cottage, across, 0.16, new Vector3());
      this.rig.lookAlong(target, tangentToward(target, travel(L.cottage, L.homeBearing, 0.4, new Vector3()), new Vector3()));
      this.rig.setZoom(0.6, true);
    }
    this.posed = true;
  }

  /** A repeatable overlook toward the home and its fan grove. */
  findVista(): Vista {
    const L = this.terrain.layout;
    const R = this.growth.radius;
    const across = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
    const target = travel(L.cottage, across, -8 / R, new Vector3());
    const focus = travel(travel(L.cottage, across, 18 / R, new Vector3()), L.homeBearing, 32 / R, new Vector3());
    return { focus, forward: tangentToward(focus, target, new Vector3()), zoom: this.rig.zoomForAltitude(10), score: 0 };
  }

  onParams(changed: ReadonlySet<ParamPath>): void {
    if (changed.has('muse.model')) this.muse.useModel(this.store.values.muse.model);
    if (changed.has('world.seed')) {
      this.followingResident = null;
      this.terrain.setLayout(generateLayout(this.store.values.world.seed));
      this.scene.remove(this.homestead.group);
      this.homestead.dispose();
      this.homestead = new Homestead(this.shared, this.store.values.world.seed);
      this.scene.add(this.homestead.group);
    }
    for (const path of changed) {
      if (FIELD_PATHS.has(path)) {
        this.refreshFieldParams();
        break;
      }
    }
  }

  private refreshFields(full: boolean): void {
    const L = this.terrain.layout;
    const R = this.growth.radius;
    this.fieldsR = R;
    this.fieldsKey = this.fieldKey;
    this.fieldsLayout = L;
    this.fieldsFull = full;
    this.terrain.update(R, this.fieldParams, this.bake.texelMeters(R, full));
    this.scenery?.invalidate();
    this.fauna?.invalidate();
    this.terrain.writeUniforms(this.terrainUniforms);
    this.bake.bake(this.renderer, this.terrain.fields, `${L.seed}/${R}/${this.fieldKey}`, full);
    this.terrainUniforms.uTerrainBake.value = this.bake.terrainTexture(full);
    this.terrainUniforms.uFloraBake.value = this.bake.floraTexture(full);
  }

  private refreshFieldParams(): void {
    const p = this.store.values;
    this.fieldParams = {
      roll: p.terrain.roll,
      hummocks: p.terrain.hummocks,
      wetlands: p.terrain.wetlands,
      waterLevel: p.terrain.waterLevel,
      grain: p.terrain.grain,
      density: p.flowers.density,
      patchiness: p.flowers.patchiness,
      patchSize: p.flowers.patchSize,
      weights: [p.flowers.pink, p.flowers.star, p.flowers.yellow, p.flowers.blue],
    };
    this.fieldKey = JSON.stringify(this.fieldParams);
    this.scenery?.invalidate();
    this.fauna?.invalidate();
  }

  update(clock: FrameClock, aspect: number, viewportHeight: number): void {
    this.clock = clock;
    const p = this.store.values;
    growthState(p.world.growth, p.world.areaMin, p.world.areaMax, this.growth);
    const R = this.growth.radius;
    this.band.update(R, clock.realDt);

    // The fields depend on R, the layout and a few params: refresh and re-bake
    // only on change, quickly while changing, fully once still for a moment.
    const L = this.terrain.layout;
    if (R !== this.fieldsR || this.fieldKey !== this.fieldsKey || L !== this.fieldsLayout) {
      this.refreshFields(false);
      this.fieldsStill = 0;
    } else if (!this.fieldsFull && ++this.fieldsStill >= 6) this.refreshFields(true);

    this.scenery.update(clock.time, this.terrain);
    this.fauna.update(clock.time, this.terrain, this.rig.camera.position);
    this.residents.update(clock.time, this.terrain, this.rig.camera.position, this.look.uWindVec.value, this.look.uPixelAngle.value, p.muse.show);
    if (this.followingResident) this.frameResident(this.followingResident, false);

    // Camera rides the surface; the ground under the focus keeps it above the grass.
    this.rig.update(clock.realDt, R, aspect, (dir) => this.terrain.sample(dir, this.ground).height);
    const rig = this.rig;

    // Warp: the meadow around the focus curves like a world of visualRadius.
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
    this.grass.setColours(this.palette);

    // The homestead sits on its clearing, facing its pond; its shadow sweeps away from the sun.
    this.homestead.place(this.tmp.copy(L.cottage).multiplyScalar(R + this.terrain.cottageGround), L.cottage, L.homeBearing);
    // (down the sun the cottage sees, as its walls are lit: render/sun.ts)
    const across = this.east.crossVectors(L.cottage, L.homeBearing);
    const sun = sunAt(p.light.timeOfDay);
    const cs = localSun(L.cottage, sun.elevation, sun.azimuth, this.tmp2);
    const sy = Math.max(cs.dot(L.cottage), 0.12);
    this.terrainUniforms.uCottageSun.value.set(cs.dot(across) / sy, cs.dot(L.homeBearing) / sy, 0, 0);
    // Near field: grass blades and flowers replace the paint around the focus. Its field map is
    // drawn before the clouds' passes, its meadow pass reading the last frame's cloud shadows:
    // drawn after them, the main pass (whose blades read the map as they are placed) waited on both.
    const grassAt = (altitude: number): number => p.grass.nearRadius * this.tier.grassRadiusScale * smoothstep(90, 30, altitude);
    const flowersAt = (altitude: number): number => 30 * this.tier.flowerRadiusScale * smoothstep(90, 30, altitude);
    const grassNear = grassAt(rig.altitude);
    const flowerNear = flowersAt(rig.altitude);
    this.field.radiusMeters = Math.max(grassNear, flowerNear, 8) + 6;
    this.nearFieldDrawn = grassNear > 0.5 || flowerNear > 0.5;
    if (this.nearFieldDrawn) this.field.render(this.renderer, rig.up, rig.forward, R);
    this.birds.update(clock.time, this.terrain);
    this.butterflies.update(clock.time, this.terrain, rig.up, rig.altitude, this.look.uBloom.value.x);
    this.muse.update(clock.time, this.terrain, rig.camera.position, this.look.uWindVec.value, this.look.uPixelAngle.value, p.muse.show);
    for (const visitor of this.visitors) visitor.update(clock.time, this.terrain, rig.camera.position, this.look.uWindVec.value, this.look.uPixelAngle.value, p.muse.show);
    this.clouds.update(this.renderer, L.seed, R, clock.time, p.clouds, this.windAxis, this.sunDir, rig.camera, this.warp, rig.up, this.groundInSight());
    // Violet Dunes' high cirrus: density sets how many streaks (0.5 would be Violet's 28); height is at R 128 and
    // grows as the clouds do (√R)
    const bands = Math.round(p.clouds.cirrusDensity * 2 * CIRRUS_BANDS);
    this.cirrus.mesh.visible = p.clouds.cirrus && bands > 0;
    if (this.cirrus.mesh.visible) {
      this.cirrus.update(L.seed, bands, R, p.clouds.cirrusHeight * Math.sqrt(R / 128), p.clouds.cirrusOpacity, clock.time, this.windAxis, rig.camera.position, p.clouds.speed);
      this.cirrus.setColour(p.clouds.cirrusHue, p.clouds.cirrusTint, p.clouds.cirrusBrightness);
    }

    const cam = rig.camera;
    this.frustum.setFromProjectionMatrix(this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.muse.cull(this.frustum, this.warp);
    for (const visitor of this.visitors) visitor.cull(this.frustum, this.warp);
    this.residents.cull(this.frustum, this.warp);
    const sweep = this.terrainUniforms.uCottageSun.value;
    this.terrain.homeAreas(sweep.x, sweep.y, this.homeAreas);
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
        home: this.homeAreas,
      },
      this.lod,
    );
    // Where the camera is headed (the end of a glide, the zoom asked for, a named view), when it is
    // somewhere else: what it will see there is built on the way (scatter.ts)
    let aimGrass = 0;
    let aimFlowers = 0;
    if (!rig.isSettled()) {
      const altitude = rig.aim(R, (dir) => this.terrain.sample(dir, this.ground).height, this.aimCamera, this.aimUp);
      const away = Math.acos(Math.min(1, this.aimUp.dot(rig.up))) * R;
      if (away > 4 || Math.abs(Math.log(altitude / rig.altitude)) > 0.15) {
        aimGrass = grassAt(altitude);
        aimFlowers = flowersAt(altitude);
        const aim = this.aimCamera;
        this.aimFrustum.setFromProjectionMatrix(this.projView.multiplyMatrices(aim.projectionMatrix, aim.matrixWorldInverse));
        this.aimWarp.up.copy(this.aimUp);
        this.aimWarp.focus.copy(this.aimUp).multiplyScalar(aim.position.length() - altitude);
        this.aimWarp.k = warpForZoom(rig.zoomAim, R, p.view.visualRadius);
      }
    }
    const aimed = (near: number): { focus: Vector3; near: number; frustum: Frustum; warp: WarpFrame } | undefined =>
      near > 0.5 ? { focus: this.aimUp, near, frustum: this.aimFrustum, warp: this.aimWarp } : undefined;
    this.grass.update(
      {
        seed: p.world.seed,
        radius: R,
        radiusHi: this.band.radiusHi,
        density: p.grass.density * this.tier.grassDensityScale,
        focus: rig.up,
        near: grassNear,
        fade: this.tier.grassFade,
        frustum: this.frustum,
        warp: this.warp,
        queue: this.queue,
        ahead: aimed(aimGrass),
      },
      p.grass.height,
    );
    const flowerScale = this.tier.flowerDensityScale;
    this.flowers.classifier.set(L, R, this.fieldParams, this.fieldKey, p.flowers.density * flowerScale, flowerScale, {
      sizeVariation: p.flowers.sizeVariation,
      colourVariation: p.flowers.colourVariation,
    });
    this.flowers.update(
      {
        seed: p.world.seed,
        radius: R,
        radiusHi: this.band.radiusHi,
        density: p.flowers.density * flowerScale,
        focus: rig.up,
        near: flowerNear,
        frustum: this.frustum,
        warp: this.warp,
        queue: this.queue,
        ahead: aimed(aimFlowers),
      },
      1,
    );
    this.surface.uniforms.uNearField.value.set(rig.up.x, rig.up.y, rig.up.z, Math.max(flowerNear, 0.001));
    this.surface.uniforms.uFlowersBuilt.value = this.flowers.layer.builtMap;
    this.surface.uniforms.uFlowerCells.value = this.flowers.layer.builtCells;
    this.petals.update(grassNear);
    if (this.growingBloom >= 0) {
      const disc = this.userBlooms[this.growingBloom];
      disc.w = Math.min(disc.w + (clock.realDt * 1.6) / R, 0.6);
    }
    this.sky.update(cam, this.palette, rig.up, this.sunDir, rig.tilt);
    this.look.uPixelAngle.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
  }

  /**
   * How far from the focus (rad) the camera can see ground: to the true
   * horizon from orbit; under the tiny-planet warp, as far as the bent meadow
   * lets the highest ground show (as the terrain's own culling judges it).
   */
  private groundInSight(): number {
    const R = this.growth.radius;
    const k = this.warp.k;
    const margin = 0.08;
    if (Math.abs(k) * R < 0.01) return Math.acos(Math.min(1, R / this.rig.camera.position.length())) + margin;
    const bend = 1 / R + 2 * k;
    if (bend <= 1e-6) return Math.PI;
    const radiusEff = 1 / bend;
    const reach = Math.sqrt(2 * radiusEff * (this.rig.altitude + 0.5)) + Math.sqrt(2 * radiusEff * this.terrain.maxHeight);
    return Math.min(Math.PI, reach / R + margin);
  }

  private updateLight(hours: number): void {
    this.palette.update(hours);
    // the scene is lit by the sun the focus sees; every place sees its own (render/sun.ts)
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
    // haze thickens as you come down into the meadow, so the far meadow pales like a painted distance
    L.uFog.value.set(p.style.fogDensity * 0.0028 * (1 + 10 * this.rig.tilt), 0.06 + 0.34 * p.style.fogDensity, this.rig.altitude * 0.95, 0.8);
    L.uFogUp.value.copy(this.rig.up);
    L.uBloom.value.set(p.world.bloom * (Math.PI + 0.45) - 0.25, 0.07, 0, 0);
    // Wind: a rotation field fixed to the world, aimed by the direction param at the cottage.
    const c = this.terrain.layout.cottage;
    const north = tangentToward(c, Math.abs(c.y) > 0.98 ? WORLD_X : WORLD_UP, this.tmp);
    const w = north.applyAxisAngle(c, (-p.wind.direction * Math.PI) / 180);
    const axis = this.windAxis.crossVectors(c, w).normalize();
    L.uWindVec.value.set(axis.x, axis.y, axis.z, p.wind.strength);
    L.uGust.value.set(clock.time, 0, p.wind.gustiness, p.wind.strength);
    // gust bands and the quicker ripples advect with the flow: rotate about the wind axis
    const R = this.growth.radius;
    const gusts = (-clock.time * (2.5 + 6 * p.wind.strength)) / R;
    const ripples = (-clock.time * (3.5 + 9 * p.wind.strength)) / R;
    (this.shared.uGustRot.value as Vector4).set(Math.cos(gusts), Math.sin(gusts), Math.cos(ripples), Math.sin(ripples));
    (this.shared.uGustFreq.value as Vector4).set(R / 16, R / 5.5, 0, 0);
    L.uMeadowLook.value.set(p.wind.sheen, 1, p.flowers.colourVariation, 0);
    // middle colours of the four species (floraColour() at variant 0.5, in sun)
    const wash = L.uFloraWash.value;
    this.palette.get(ROW.PINK, 0, wash[0]);
    this.palette.get(ROW.STAR, 0, wash[1]).lerp(this.palette.get(ROW.STAR, 4, this.washTmp), 0.35);
    this.palette.get(ROW.SCATTER, 0, wash[2]);
    this.palette.get(ROW.SCATTER, 2, wash[3]).lerp(this.palette.get(ROW.SCATTER, 8, this.washTmp), 0.2);
    L.uWaterLook.value.set(0, p.water.depthTint, p.water.glints, clock.time);
    // the mirror marches the banks up to the meadow's highest ground, grass included
    L.uWaterSky.value.set(p.water.reflection, p.water.lilyPads, p.grass.height * 0.8, this.terrain.maxHeight + p.grass.height);
    L.uDebug.value = DEBUG_VIEWS[p.ui.debug];
  }

  /**
   * Triangles that can actually reach the rasteriser: what three.js submits,
   * minus the instances the vertex shaders collapse (pages outside the
   * frustum, blades beyond the thinning).
   */
  effectiveTriangles(submitted: number): number {
    const grassTris = 3;
    const g = this.grass;
    let wasted = g.layer.instanceCount * grassTris - g.layer.visibleInstances * grassTris;
    const f = this.flowers.layer;
    const all = Math.max(f.instanceCount, 1);
    this.flowers.meshes.forEach((mesh, s) => {
      const tris = (mesh.geometry.index?.count ?? 0) / 3;
      const drawn = f.instanceCounts[s];
      wasted += (drawn - (f.visibleInstances * drawn) / all) * tris;
    });
    return Math.max(0, submitted - (this.grass.mesh.visible ? wasted : 0));
  }

  /**
   * Frame Muse (the M key): in front of it and a little to its left, wherever
   * it is now (at home, from out in front of the terrace, a little toward the
   * steps), looking at its middle; a view other than MUSE_VIEW's for checks.
   */
  frameMuse(view: Partial<typeof MUSE_VIEW> & { fixed?: boolean } = {}): void {
    const L = this.terrain.layout;
    const R = this.terrain.radius;
    this.muse.update(this.clock?.time ?? 0, this.terrain, this.rig.camera.position, this.look.uWindVec.value, this.look.uPixelAngle.value, true);
    const V = { ...MUSE_VIEW, ...view };
    const where = this.muse.where;
    const target = where.dir.clone();
    // (fixed: from the same side whichever way it faces, as for following it)
    const front = this.muse.home || view.fixed ? tangentToward(target, L.homeBearing.clone().add(target), new Vector3()) : where.heading.clone();
    const toCamera = front.applyAxisAngle(target, V.azimuth);
    const focus = travel(target, toCamera, V.distance / R, new Vector3());
    this.rig.lookAlong(focus, tangentToward(focus, target, new Vector3()));
    // (the camera's height is over the ground Muse stands on, whatever the ground under the camera: the meadow, the bank or the pond)
    const curve = (V.distance * V.distance) / (2 * R);
    const zoom = this.rig.zoomForAltitude(Math.max(0.6, where.height + V.height + curve - this.terrain.height(focus)));
    this.rig.setZoom(zoom, true);
    const { tilt } = this.rig.framing(zoom);
    this.rig.lookUp(Math.atan2(V.distance, V.height - V.at * MUSE_HEIGHT + curve) - tilt);
    this.posed = true;
  }

  pick(ndcX: number, ndcY: number): Pick | null {
    return pickSurface(this.rig.camera, ndcX, ndcY, this.warp, this.terrain);
  }

  /** Meet a resident at ground level. Following ends as soon as the visitor navigates. */
  meetResident(id: string): void {
    this.followingResident = id;
    this.frameResident(id, true);
  }

  private frameResident(id: string, immediate: boolean): void {
    const resident = this.residents.members.find(r => r.id === id);
    if (!resident) return;
    const where = resident.muse.where;
    if (where.dir.lengthSq() < 0.9) return;
    const R = this.terrain.radius;
    const target = where.dir;
    const bearing = tangentToward(target, this.terrain.layout.homeBearing.clone().add(target), new Vector3()).applyAxisAngle(target, 0.3);
    const distance = 7;
    const focus = travel(target, bearing, distance / R, new Vector3());
    const above = Math.max(1, where.height + 2.3 + distance * distance / (2 * R) - this.terrain.height(focus));
    const zoom = this.rig.zoomForAltitude(above);
    this.rig.lookAlong(focus, tangentToward(focus, target, new Vector3()), immediate);
    this.rig.setZoom(zoom, immediate);
    const { tilt } = this.rig.framing(zoom);
    this.rig.lookUp(Math.atan2(distance, 2.3 - 0.55 * MUSE_HEIGHT + distance * distance / (2 * R)) - tilt);
    this.posed = true;
  }

  /** A close naturalist's view of a living animal in its own habitat. */
  observeCreature(species: string): void {
    this.followingResident = null;
    const where = this.fauna.focus(species);
    if (!where) return;
    const R = this.terrain.radius;
    const bearing = where.heading.clone().applyAxisAngle(where.dir, species === 'fern-sifter' ? 0.65 : 0.45);
    const focus = travel(where.dir, bearing, where.distance / R, new Vector3());
    const curve = where.distance * where.distance / (2 * R);
    const eyeAbove = species === 'chalkstep' ? 0.55 : species === 'fern-sifter' ? 0.6 : 0.4;
    const zoom = this.rig.zoomForAltitude(Math.max(0.65, where.height + eyeAbove + curve - this.terrain.height(focus)));
    this.rig.lookAlong(focus, tangentToward(focus, where.dir, new Vector3()));
    this.rig.setZoom(zoom, true);
    this.rig.lookUp(Math.atan2(where.distance, eyeAbove + curve) - this.rig.framing(zoom).tilt);
    this.posed = true;
  }

  /** Pick the nearest visible Muse, including the canyon's residents. */
  pickMuse(ndcX: number, ndcY: number): { side: number; resident?: string; visitor?: Muse } | null {
    const cam = this.rig.camera;
    const ray = new Ray(cam.position.clone(), new Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize());
    const local = this.residents.pick(ray, this.warp);
    let host: { side: number; distance: number; visitor?: Muse } | null = this.muse.pick(ray, this.warp);
    // (a visiting Muse, tapped, says hello as the host does: the nearest the ray meets)
    for (const visitor of this.visitors) {
      const hit = visitor.pick(ray, this.warp);
      if (hit && (!host || hit.distance < host.distance)) host = { ...hit, visitor };
    }
    if (local && (!host || local.distance < host.distance)) return { side: local.side, resident: local.resident.id };
    return host && (host.visitor ? { side: host.side, visitor: host.visitor } : { side: host.side });
  }

  tapMuse(time: number, hit: { resident?: string; visitor?: Muse }): void {
    if (hit.resident) this.residents.tap(hit.resident, time);
    else (hit.visitor ?? this.muse).tap(time);
  }

  holdMuse(time: number, hit: { side: number; resident?: string; visitor?: Muse }): void {
    this.heldResident = hit.resident ?? null;
    this.heldVisitor = hit.visitor ?? null;
    if (hit.resident) this.residents.hold(hit.resident, time, hit.side);
    else (hit.visitor ?? this.muse).hold(time, hit.side);
  }

  releaseMuse(time: number): void {
    if (this.heldResident) this.residents.letGo(this.heldResident, time);
    else (this.heldVisitor ?? this.muse).letGo(time);
    this.heldResident = null;
    this.heldVisitor = null;
  }

  /** A gust ring bursting out from a point on the meadow. */
  gust(dir: Vector3, time: number): void {
    const rings = this.shared.uGustRings.value as Vector4[];
    rings[this.nextGust++ % rings.length].set(dir.x, dir.y, dir.z, time);
  }

  /** A ripple ring on the water. */
  ripple(dir: Vector3, time: number): void {
    const ripples = this.look.uRipples.value;
    ripples[this.nextRipple++ % ripples.length].set(dir.x, dir.y, dir.z, time);
  }

  /** Start growing a bloom disc at a point (press and hold). */
  bloomStart(dir: Vector3): void {
    this.residents.bloom(this.clock?.time ?? 0);
    this.growingBloom = this.nextBloom++ % this.userBlooms.length;
    this.userBlooms[this.growingBloom].set(dir.x, dir.y, dir.z, 0.4 / this.growth.radius);
  }

  bloomEnd(): void {
    this.growingBloom = -1;
  }

  /** Close fade bands, finish queued work and snap the camera: the next frame is a pure function of state. */
  settle(): void {
    this.band.settle();
    this.queue.drain();
    this.rig.settle();
    growthState(this.store.values.world.growth, this.store.values.world.areaMin, this.store.values.world.areaMax, this.growth);
    this.refreshFields(true);
  }
}
