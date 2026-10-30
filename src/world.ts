import { Color, Frustum, Matrix4, Scene, Vector3, Vector4, type IUniform, type WebGLRenderer } from 'three';
import { BuildQueue } from './core/buildQueue';
import type { FrameClock } from './core/clock';
import type { Globals } from './core/globals';
import type { Tier } from './core/quality';
import { smoothstep } from './core/math';
import { FieldMap } from './life/fieldMap';
import { Clouds, createCloudUniforms } from './life/clouds';
import { Flowers } from './life/flowers';
import { Grass } from './life/grass';
import { Petals } from './life/petals';
import { Homestead } from './life/props';
import { pickSurface, type Pick } from './view/picking';
import type { ParamPath, ParamStore } from './params';
import { TerrainBake } from './planet/bake';
import { LOD_DEFAULT, type LodConfig } from './planet/chunks';
import type { FieldParams } from './planet/fields';
import { tangentToward, travel } from './planet/geo';
import { growthState, type GrowthState } from './planet/growth';
import { GrowthBand } from './planet/rest';
import { Surface } from './planet/surface';
import { createGroundSample, createTerrainUniforms, generateLayout, gradientFrame, Terrain, type Layout } from './planet/terrain';
import { createLookUniforms } from './render/look';
import { Palette, ROW, sunAt } from './render/palette';
import { Sky } from './render/sky';
import { warpForZoom } from './render/warp';
import { CameraRig } from './view/camera';
import { findVista, type Vista } from './view/vista';

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

export type CameraPreset = 'homestead' | 'lakes' | 'meadow' | 'vista';

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
  private readonly ground = createGroundSample();
  private readonly north = new Vector3();
  private readonly east = new Vector3();
  private readonly tmp = new Vector3();
  private readonly windAxis = new Vector3();
  private readonly washTmp = new Color();
  private posed = false;
  private readonly heightBound = (): number => this.terrain.maxHeight;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly globals: Globals,
    private readonly store: ParamStore,
    tier: Tier,
  ) {
    this.tier = tier;
    this.bake = new TerrainBake(tier.name === 'high' ? 512 : 384);
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
      uOutline: { value: new Vector4(1.25, 0, 0, 0) },
    };
    this.sky = new Sky();
    this.field = new FieldMap(this.shared, tier.name === 'high' ? 256 : 192);
    Object.assign(this.shared, this.field.uniforms);
    this.surface = new Surface(this.shared, tier.terrainGrid);
    this.grass = new Grass(this.shared, tier.name === 'high' ? 760 : 260);
    this.flowers = new Flowers(this.shared, tier.name === 'high' ? 420 : 180);
    this.homestead = new Homestead(this.shared, store.values.world.seed);
    this.clouds = new Clouds(this.shared, this.cloudUniforms, tier.name === 'high' ? 1024 : 512);
    this.petals = new Petals(this.shared);
    this.scene.add(this.sky.mesh, this.surface.mesh, this.homestead.group, this.grass.mesh, ...this.flowers.meshes, this.petals.mesh, this.clouds.mesh);
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

  /** Stand by the first water at the edge of the nearest wetland, looking across its lakes. */
  defaultPose(): void {
    const R = this.growth.radius;
    const spot = this.wetlandEdge();
    const into = this.wetnessGradient(spot);
    // from the margin: walk in to the first water (or, standing in it, back out to land)
    const p = new Vector3();
    const t = this.terrain;
    let d = 0;
    if (t.height0(spot) >= 0) while (d < 150 && t.height0(travel(spot, into, d / R, p)) >= 0) d += 1.5;
    else while (d > -150 && t.height0(travel(spot, into, d / R, p)) < 0) d -= 1.5;
    d -= 8;
    // and stand on firm ground, not a spit of water
    for (let k = 0; k < 30 && t.height0(travel(spot, into, d / R, p)) < 0.15; k++) d -= 1.5;
    const target = travel(spot, into, d / R, new Vector3());
    this.rig.lookAlong(target, tangentToward(target, travel(spot, into, 0.3, p), new Vector3()));
    this.posed = true;
  }

  /**
   * Named views: across the pond at the cottage, across the lakes, over the
   * meadow, and the vista (the reference framing). Shots and tests cut to
   * them; `immediate = false` moves the camera there smoothly.
   */
  cameraPreset(name: CameraPreset, immediate = true): void {
    const L = this.terrain.layout;
    const R = this.growth.radius;
    if (name === 'homestead') {
      // stand across the pond, looking back at the cottage and its landing
      const bearing = L.homeBearing.clone().applyAxisAngle(L.cottage, Math.PI + 0.35);
      const target = L.cottage.clone().multiplyScalar(Math.cos(14 / R)).addScaledVector(bearing, -Math.sin(14 / R)).normalize();
      this.rig.lookAlong(target, bearing.addScaledVector(target, -bearing.dot(target)).normalize());
      this.rig.setZoom(0.8, true);
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

  /** The stand and heading that frame the meadow like the reference still (view/vista.ts). */
  findVista(): Vista {
    const R = this.growth.radius;
    const rv = this.store.values.view.visualRadius;
    const framing = (z: number): { altitude: number; tilt: number; fov: number; k: number } => {
      const f = this.rig.framing(z);
      return { altitude: f.altitude, tilt: f.tilt, fov: f.fov, k: warpForZoom(z, R, rv) };
    };
    // stand where the meadow is in flower: well behind the bloom front (meadow.glsl bloomAt)
    const front = this.look.uBloom.value.x - 40 / R;
    const cottage = this.terrain.layout.cottage;
    const bloomed = (dir: Vector3): boolean => Math.acos(Math.min(1, dir.dot(cottage))) < front;
    return findVista(this.terrain, framing, this.rig.camera.aspect, this.clouds.bounds(), bloomed, `${this.terrain.layout.seed}/${R}/${rv}/${this.fieldKey}/${front.toFixed(3)}`);
  }

  /** A point near the cottage where the wetland is half land, half water. */
  private wetlandEdge(): Vector3 {
    const L = this.terrain.layout;
    const R = this.growth.radius;
    const f = this.terrain.fields;
    const east = new Vector3().crossVectors(L.homeBearing, L.cottage);
    const t = new Vector3();
    const p = new Vector3();
    const spot = travel(L.cottage, L.homeBearing, 0.3, new Vector3());
    let best = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      t.copy(L.homeBearing).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
      for (let d = 36; d < 0.6 * Math.PI * R; d += 8) {
        const w = f.wetness(travel(L.cottage, t, d / R, p));
        const score = w * (1 - w) - (0.6 * d) / (Math.PI * R);
        if (score > best) {
          best = score;
          spot.copy(p);
        }
      }
    }
    return spot;
  }

  /** Unit tangent at p pointing into the wetland. */
  private wetnessGradient(p: Vector3): Vector3 {
    const f = this.terrain.fields;
    const e = 3 / this.growth.radius;
    const a = new Vector3();
    const b = new Vector3();
    gradientFrame(p, a, b);
    const w0 = f.wetness(p);
    const wa = f.wetness(p.clone().addScaledVector(a, e).normalize()) - w0;
    const wb = f.wetness(p.clone().addScaledVector(b, e).normalize()) - w0;
    const g = a.multiplyScalar(wa).addScaledVector(b, wb);
    return g.lengthSq() > 1e-12 ? g.normalize() : tangentToward(p, this.terrain.layout.homeBearing, g);
  }

  onParams(changed: ReadonlySet<ParamPath>): void {
    if (changed.has('world.seed')) {
      this.terrain.setLayout(generateLayout(this.store.values.world.seed));
      this.scene.remove(this.homestead.group);
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
  }

  update(clock: FrameClock, aspect: number, viewportHeight: number): void {
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
    const across = this.east.crossVectors(L.cottage, L.homeBearing);
    const sy = Math.max(this.sunDir.dot(L.cottage), 0.12);
    this.terrainUniforms.uCottageSun.value.set(this.sunDir.dot(across) / sy, this.sunDir.dot(L.homeBearing) / sy, 0, 0);
    (this.shared.uOutline.value as Vector4).x = p.style.outlineWidth;
    this.clouds.update(this.renderer, L.seed, R, clock.time, p.clouds, this.windAxis, this.sunDir, rig.camera);

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
      },
      this.lod,
    );
    // Near field: grass blades and flowers replace the paint around the focus.
    const lowness = smoothstep(90, 30, rig.altitude);
    const grassNear = p.grass.nearRadius * this.tier.grassRadiusScale * lowness;
    const flowerNear = 30 * this.tier.flowerRadiusScale * lowness;
    this.field.radiusMeters = Math.max(grassNear, flowerNear, 8) + 6;
    if (grassNear > 0.5 || flowerNear > 0.5) this.field.render(this.renderer, rig.up, rig.forward, R);
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
    const flowerScale = this.tier.name === 'high' ? 1 : 0.6;
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
      },
      1,
    );
    this.surface.uniforms.uNearField.value.set(rig.up.x, rig.up.y, rig.up.z, Math.max(flowerNear, 0.001));
    this.petals.update(grassNear);
    if (this.growingBloom >= 0) {
      const disc = this.userBlooms[this.growingBloom];
      disc.w = Math.min(disc.w + (clock.realDt * 1.6) / R, 0.6);
    }
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

  pick(ndcX: number, ndcY: number): Pick | null {
    return pickSurface(this.rig.camera, ndcX, ndcY, this.warp, this.terrain);
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
