import { Frustum, Matrix4, Scene, Vector3, Vector4, type IUniform, type WebGLRenderer } from 'three';
import { BuildQueue } from './core/buildQueue';
import type { FrameClock } from './core/clock';
import type { Globals } from './core/globals';
import type { Tier } from './core/quality';
import { smoothstep } from './core/math';
import { FieldMap } from './life/fieldMap';
import { Flowers } from './life/flowers';
import { Grass } from './life/grass';
import type { ParamPath, ParamStore } from './params';
import { LOD_DEFAULT, type LodConfig } from './planet/chunks';
import { tangentToward } from './planet/geo';
import { growthState, type GrowthState } from './planet/growth';
import { GrowthBand } from './planet/rest';
import { Surface } from './planet/surface';
import { createTerrainUniforms, generateLayout, Terrain, type GroundSample } from './planet/terrain';
import { ChannelField } from './planet/water';
import { createLookUniforms } from './render/look';
import { Palette, ROW, sunAt } from './render/palette';
import { Sky } from './render/sky';
import { warpK } from './render/warp';
import { CameraRig } from './view/camera';

const DEBUG_VIEWS = { off: 0, chunks: 1, morph: 2, normals: 3 } as const;
const NOON_SUN = new Palette().get(ROW.LIGHT, 0);
const NOON_SKY = new Palette().get(ROW.LIGHT, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);

/**
 * The scene and every system in it. Each frame: growth → fade band → terrain
 * state → camera → light, wind and look uniforms → warp → LOD → sky → build
 * queue. main.ts owns the renderer and the loop; this owns the world.
 */
export class World {
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly palette = new Palette();
  readonly look = createLookUniforms();
  readonly terrainUniforms = createTerrainUniforms();
  readonly band = new GrowthBand();
  readonly queue = new BuildQueue();
  readonly growth: GrowthState = { g: 0, area: 0, radius: 128 };
  readonly sky = new Sky();
  readonly surface: Surface;
  readonly channels: ChannelField;
  readonly field: FieldMap;
  readonly grass: Grass;
  readonly flowers: Flowers;
  private tier: Tier;
  terrain: Terrain;
  /** Uniform objects every world material shares. */
  readonly shared: Record<string, IUniform>;
  readonly warp = { focus: new Vector3(), up: new Vector3(0, 1, 0), k: 0 };
  readonly sunDir = new Vector3(0, 1, 0);
  lod: LodConfig = LOD_DEFAULT;

  private layoutKey = '';
  private terrainKey = '';
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly ground: GroundSample = { height: 0, water: 0, mountain: 0, rock: 0, clearing: 0 };
  private readonly north = new Vector3();
  private readonly east = new Vector3();
  private readonly tmp = new Vector3();
  private readonly windAxis = new Vector3();
  private posed = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly globals: Globals,
    private readonly store: ParamStore,
    tier: Tier,
  ) {
    this.tier = tier;
    this.channels = new ChannelField(tier.name === 'high' ? 512 : 384);
    this.terrain = new Terrain(this.makeLayout());
    this.look.uPalette.value = this.palette.texture;
    this.shared = {
      ...globals,
      ...this.look,
      ...this.terrainUniforms,
      uChannelField: { value: this.channels.texture },
      uCloudShadows: { value: Array.from({ length: 8 }, () => new Vector4()) },
      uCloudShadowStrength: { value: 0 },
      uGustRot: { value: new Vector4(1, 0, 8, 0) },
      uGustRings: { value: Array.from({ length: 4 }, () => new Vector4(0, 1, 0, -1)) },
    };
    this.field = new FieldMap(this.shared, tier.name === 'high' ? 384 : 256);
    Object.assign(this.shared, this.field.uniforms);
    this.surface = new Surface(this.shared, tier.terrainGrid);
    this.grass = new Grass(this.shared, tier.name === 'high' ? 360 : 140);
    this.flowers = new Flowers(this.shared, tier.name === 'high' ? 96 : 48);
    this.scene.add(this.sky.mesh, this.surface.mesh, this.grass.mesh, ...this.flowers.meshes);
    this.applyTier(tier);
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

  /** Frame the homestead with the mountains beyond it. */
  defaultPose(): void {
    const L = this.terrain.layout;
    const target = this.tmp.copy(L.cottage).lerp(L.range.a.clone().add(L.range.b).normalize(), 0.22).normalize();
    const toward = tangentToward(target, L.range.a.clone().add(L.range.b).normalize(), new Vector3());
    this.rig.lookAlong(target, toward);
    this.posed = true;
  }

  onParams(changed: ReadonlySet<ParamPath>): void {
    if (changed.has('world.seed') || changed.has('terrain.channelCount') || changed.has('terrain.pondCount')) {
      this.terrain.layout = this.makeLayout();
      this.terrainKey = '';
    }
    if (changed.has('view.mode')) this.rig.setZoom(this.store.values.view.mode === 'wander' ? 1 : 0);
  }

  private makeLayout() {
    const p = this.store.values;
    this.layoutKey = `${p.world.seed}/${p.terrain.channelCount}/${p.terrain.pondCount}`;
    const layout = generateLayout(p.world.seed, p.terrain.channelCount, p.terrain.pondCount);
    this.channels.bake(this.renderer, layout);
    return layout;
  }

  update(clock: FrameClock, aspect: number, viewportHeight: number): void {
    const p = this.store.values;
    growthState(p.world.growth, p.world.areaMin, p.world.areaMax, this.growth);
    const R = this.growth.radius;
    this.band.update(R, clock.realDt);

    // Terrain state depends on R, the band and a few params: refresh only on change.
    const key = `${R.toFixed(6)}/${this.band.hi.toFixed(6)}/${p.terrain.meadowRoll}/${p.terrain.mountainHeight}/${p.water.channelWidth}/${this.layoutKey}`;
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      this.terrain.update(R, this.band.hi, { meadowRoll: p.terrain.meadowRoll, mountainHeight: p.terrain.mountainHeight, channelWidth: p.water.channelWidth });
      this.terrain.writeUniforms(this.terrainUniforms);
    }

    // Camera rides the surface; the ground under the focus keeps it above the grass.
    this.rig.update(clock.realDt, R, aspect, (dir) => this.terrain.sample(dir, this.ground).height);
    const rig = this.rig;

    // Warp: the meadow around the focus curves like a world of visualRadius.
    this.warp.focus.copy(rig.focus);
    this.warp.up.copy(rig.up);
    this.warp.k = warpK(rig.warpWeight, R, p.view.visualRadius);
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
    this.surface.update(
      {
        camera: cam.position,
        radius: R,
        heightAbove: this.terrain.mountainH + 4,
        heightBelow: 4,
        frustum: this.frustum,
        warp: this.warp,
        horizonCull: rig.warpWeight < 0.05,
      },
      this.lod,
    );
    // Near field: grass blades (and later flowers) replace the paint around the focus.
    const lowness = smoothstep(90, 30, rig.altitude);
    const grassNear = p.grass.nearRadius * this.tier.grassRadiusScale * lowness;
    const flowerNear = 30 * this.tier.flowerRadiusScale * lowness;
    this.field.radiusMeters = Math.max(grassNear, flowerNear, 8) + 6;
    this.field.render(this.renderer, rig.up, rig.forward, R);
    this.grass.update(
      {
        seed: p.world.seed,
        radius: R,
        radiusHi: this.band.radiusHi,
        density: p.grass.density * this.tier.grassDensityScale,
        focus: rig.up,
        near: grassNear,
        frustum: this.frustum,
        warp: this.warp,
        queue: this.queue,
      },
      p.grass.height,
    );
    this.flowers.update(
      {
        seed: p.world.seed,
        radius: R,
        radiusHi: this.band.radiusHi,
        density: p.flowers.density * (this.tier.name === 'high' ? 1 : 0.6),
        focus: rig.up,
        near: flowerNear,
        frustum: this.frustum,
        warp: this.warp,
        queue: this.queue,
      },
      1,
    );
    this.surface.uniforms.uNearField.value.set(rig.up.x, rig.up.y, rig.up.z, Math.max(flowerNear, 0.001));
    this.sky.update(cam, this.palette, rig.up, this.sunDir, rig.tilt);
    this.look.uPixelAngle.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
  }

  private updateLight(hours: number): void {
    this.palette.update(hours);
    // Local north at the focus (world +Y projected), east = north × up.
    const up = this.rig.up;
    tangentToward(up, Math.abs(up.y) > 0.98 ? WORLD_X : WORLD_UP, this.north);
    this.east.crossVectors(this.north, up).normalize();
    const sun = sunAt(hours);
    const ce = Math.cos(sun.elevation);
    this.sunDir
      .copy(up)
      .multiplyScalar(Math.sin(sun.elevation))
      .addScaledVector(this.north, Math.cos(sun.azimuth) * ce)
      .addScaledVector(this.east, Math.sin(sun.azimuth) * ce)
      .normalize();
    this.look.uSunDir.value.copy(this.sunDir);
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
    L.uFog.value.set(p.style.fogDensity * 0.0028, 0.06 + 0.34 * p.style.fogDensity, this.rig.altitude * 0.95, 0.8);
    L.uFogUp.value.copy(this.rig.up);
    L.uBloom.value.set(p.world.bloom * (Math.PI + 0.45) - 0.25, 0.07, 0, 0);
    // Wind: a rotation field fixed to the world, aimed by the direction param at the cottage.
    const c = this.terrain.layout.cottage;
    const north = tangentToward(c, Math.abs(c.y) > 0.98 ? WORLD_X : WORLD_UP, this.tmp);
    const w = north.applyAxisAngle(c, (-p.wind.direction * Math.PI) / 180);
    const axis = this.windAxis.crossVectors(c, w).normalize();
    L.uWindVec.value.set(axis.x, axis.y, axis.z, p.wind.strength);
    L.uGust.value.set(clock.time, 0, p.wind.gustiness, p.wind.strength);
    // gust bands advect with the flow: rotate about the wind axis at the wind speed
    const R = this.growth.radius;
    const angle = (-clock.time * (2.5 + 6 * p.wind.strength)) / R;
    (this.shared.uGustRot.value as Vector4).set(Math.cos(angle), Math.sin(angle), R / 16, 0);
    L.uSpecies.value.set(p.flowers.pink, p.flowers.star, p.flowers.yellow, p.flowers.blue);
    L.uWaterLook.value.set(p.water.shoreWidth, p.water.depthTint, 0.4 + 0.8 * p.wind.strength, clock.time);
    L.uSnow.value = p.terrain.snowline;
    L.uDebug.value = DEBUG_VIEWS[p.ui.debug];
  }

  /** Close fade bands, finish queued work and snap the camera: the next frame is a pure function of state. */
  settle(): void {
    this.band.settle();
    this.queue.drain();
    this.rig.settle();
    this.terrainKey = '';
  }
}
