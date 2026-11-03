import { Frustum, Matrix4, Quaternion, Scene, Vector2, Vector3, Vector4, type IUniform, type WebGLRenderer } from 'three';
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
import { pickSurface, type Pick } from '../view/picking';
import { TerraceBuild } from './build/builder';
import { FIELD, PlanetField } from './build/field';
import { tangentFrame } from './build/sphere';
import { TerraceRig } from './camera';
import { ModelSet, type Placement } from './models';
import { PaddyMap } from './paddyMap';
import { TERRACE_ROWS } from './palette';
import { Rice, RICE } from './rice';
import { Trees } from './trees';
import { NearTrees } from './treesNear';
import { mapPeaks, peakMap } from './fogPeaks';
import { TerraceMist } from './mist';
import { MuseHut, type HutSite } from './hut';

/** Kai's models, made light by scripts/terraces-models.mjs (a unit tall, two levels of detail each). */
const MODEL_URLS = (kind: 'mountain' | 'house'): string[] => [1, 2, 3, 4, 5].map((k) => new URL(`../assets/terraces/${kind}${k}.glb`, import.meta.url).href);

/** The build's models (per model: direction, base, height, which, turn, stretch) as placements, turned in the planet's tangent frame at each. */
function placements(a: Float32Array): Placement[] {
  const out: Placement[] = [];
  const F = new Float64Array(6);
  for (let i = 0; i < a.length; i += 8) {
    const up = new Vector3(a[i], a[i + 1], a[i + 2]);
    tangentFrame(up.x, up.y, up.z, F);
    const c = Math.cos(a[i + 6]);
    const s = Math.sin(a[i + 6]);
    const e1 = new Vector3(c * F[0] + s * F[3], c * F[1] + s * F[4], c * F[2] + s * F[5]).normalize();
    out.push({ model: a[i + 5], up, e1, base: a[i + 3], height: a[i + 4], stretch: a[i + 7] });
  }
  return out;
}

const NOON = new Palette(TERRACE_ROWS);
const NOON_SUN = NOON.get(ROW.LIGHT, 0);
const NOON_SKY = NOON.get(ROW.LIGHT, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const DEBUG_VIEWS = { off: 0, chunks: 1, morph: 2, normals: 3, land: 4, cells: 5 } as const;
/** Heights of the named views (m): a bird's-eye view over the terraces, and standing on one. */
const VIEW_HEIGHT = { above: 70.2, standing: 4.3 } as const;
/** The flats' view (the homestead preset): its height (m) and how far it looks up (rad). */
const FLATS_VIEW = { height: 30, tilt: 0.35 } as const;
/** The vista: the camera's height (m), its tilt from straight down (rad), how much wider its view (degrees). */
const VISTA = { height: 24, tilt: (52 * Math.PI) / 180, widen: 28 } as const;
/**
 * Kai's view over the terraces (2026-11-03, from his URL: the rig's frame and its zoom, 16 m up), on the planet of the
 * seed he chose it on: the vista, and where a straight zoom in from the opening arrives (the opening's frame, its
 * stands' too). Other seeds look for theirs (findStand).
 */
const KAI_VIEW = { seed: 412, frame: new Quaternion(-0.3076, -0.3408, -0.5001, -0.7343).normalize(), zoom: 0.6029 } as const;
/**
 * Muse's hut on Kai's planet (2026-11-03: Tracy's cottage where his mockup over his view put it, give or take): the
 * middle of its footing, the way along its hall (its gate out to the left of the view, toward the camera), its size
 * against Tracy's (as large as the mockup drew it: 0.48–0.64 by its edges and height there), its floor at the middle
 * of the ground's heights under it (the paddy it stands on mostly; the lower one before it under its skirt, steps down
 * to it from its gate), its path's way and the trees by it.
 */
const MUSE_HUT: HutSite = {
  centre: new Vector3(-0.70624, 0.3647, 0.60681).normalize(),
  xWay: new Vector3(0.70009, 0.48718, 0.52204).normalize(),
  scale: 0.6,
  level: 0.5,
  // (from its gate's steps out along its front, round its west wing and up to the village's street, behind it)
  path: [
    [0.4, 5.9],
    [-2.4, 5.8],
    [-4.9, 4.9],
    [-5.6, 2.4],
    [-5.9, -0.8],
    [-7.2, -3.8],
  ],
  // (behind it at both corners, and by its east side: none before it, where Kai's view looks at it)
  trees: [
    [-4.4, -4.4, 0.05],
    [4.4, -3.9, 0.31],
    [4.9, 1.6, 0.52],
  ],
};
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
  /** The paddy lab's grade: none (the lab draws straight to the canvas), so the colours measured from Kai's aerial reach the screen as measured: no tone curve, bloom, contrast or dimming; the paper grain stays. */
  readonly grade = { curve: false, bloom: false, contrast: 1, brightness: 1 } as const;
  readonly scene = new Scene();
  readonly rig = new TerraceRig(FIELD.radius);
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
  /** Muse's hut (on Kai's planet). */
  readonly hut: MuseHut;
  /** The trees near the camera, in full (treesNear.ts). */
  readonly nearTrees: NearTrees;
  /** Kai's karst towers on the hilltops and houses in the villages, where the build placed them. */
  readonly towers: ModelSet;
  readonly houses: ModelSet;
  private placedModels: Float32Array | null = null;
  /** The terraces' clouds: a layer of mist, its strokes winding between the hills (mist.ts), mirrored in the paddies' water. */
  readonly mist: TerraceMist;
  readonly rice: Rice;
  readonly objects: TerraceBuild;
  readonly paddyMap: PaddyMap;
  /** The world's own: its noise's seed, the season's front, the rice blades' near field, the height fog and its map of the spiky mountains (paddy.glsl, rice.vert.glsl, terrace.frag.glsl, fog.glsl, fogPeaks.ts). */
  private readonly own = {
    uTerrainSeed: { value: 0 },
    uPaddy: { value: new Vector4(0, 0.55, 0, 0) },
    uRiceNear: { value: new Vector4(0, 1, 0, 0) },
    uHeightFog: { value: new Vector4(0, 0.5, 7, 0) },
    uHeightFogPatches: { value: new Vector4(1, 50, 0, 0) },
    uHeightFogEye: { value: new Vector3(0, 1, 0) },
    uHeightFogTint: { value: new Vector2(0.22, 0.26) },
    uHeightFogPeaks: { value: peakMap() },
    uHeightFogPeak: { value: new Vector3(1, 82, 3) },
    uHeightFogNear: { value: new Vector3(0.95, 85, 29) },
    uTreeNear: { value: 0 },
  };
  private posed = false;
  /** The stand the opening view was given (looked for again once the towers stand, if one is by it and the camera has not moved). */
  private openingStand: Vector3 | null = null;
  /** The trees of the build the hut was last stood for. */
  private treesFrom: Float32Array | null = null;
  private noiseSeed = -1;
  private nextGust = 0;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly windAxis = new Vector3();
  private readonly eye = new Vector3();
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
    // (the mist first: its uniforms join the shared ones every material copies)
    this.mist = new TerraceMist(this.shared);
    this.sky = new Sky();
    this.trees = new Trees(this.shared);
    this.nearTrees = new NearTrees(this.shared);
    this.paddyMap = new PaddyMap(this.shared);
    Object.assign(this.shared, this.paddyMap.uniforms);
    this.hut = new MuseHut(this.shared);
    Object.assign(this.shared, this.hut.uniforms);
    this.rice = new Rice(this.shared, RICE_PAGES);
    this.objects = new TerraceBuild(this.shared);
    this.towers = new ModelSet('towers', MODEL_URLS('mountain'), this.shared, 96, 140);
    this.houses = new ModelSet('houses', MODEL_URLS('house'), this.shared, 96, 60);
    this.scene.add(this.sky.mesh, this.objects.group, this.rice.mesh, this.trees.mesh, this.nearTrees.mesh, this.towers.group, this.houses.group, this.hut.mesh, this.mist.group);
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
    // (a stand looked for before the towers stood is looked for again if one fills it; Kai's is his)
    this.openingStand = this.kaiView ? null : stand.focus.clone();
    this.posed = true;
  }

  /** Whether this is the planet Kai chose his view on (KAI_VIEW). */
  private get kaiView(): boolean {
    return this.store.values.world.seed === KAI_VIEW.seed;
  }

  cameraPreset(name: CameraPreset, immediate = true): void {
    if (name === 'homestead') {
      // the flats: the planet's widest flat ground, from a little above it, looking across its fields
      const flats = this.findFlats();
      this.rig.lookAlong(flats.focus, flats.forward, immediate);
      const zoom = this.rig.zoomForAltitude(FLATS_VIEW.height);
      this.rig.setZoom(zoom, immediate);
      // (as far up from the shared rig's tilt as it always looked: the terraces' own runs ahead of it there, camera.ts)
      this.rig.lookUp(FLATS_VIEW.tilt - this.rig.lift(zoom), immediate);
      this.posed = true;
      return;
    }
    if (name === 'vista' && !this.kaiView) {
      this.paintingVista(immediate);
      return;
    }
    const stand = this.findStand();
    this.rig.lookAlong(stand.focus, stand.forward, immediate);
    if (name === 'vista') {
      // Kai's view: his stand at his height, the zoom's own tilt and field of view
      this.rig.setZoom(KAI_VIEW.zoom, immediate);
      this.rig.lookUp(0, immediate);
      this.rig.widenFov(0, immediate);
    } else if (name === 'muse' || name === 'meadow') this.rig.setZoom(this.rig.zoomForAltitude(VIEW_HEIGHT.standing), immediate);
    else this.rig.setZoom(this.rig.zoomForAltitude(VIEW_HEIGHT.above), immediate);
    this.posed = true;
  }

  /**
   * The vista as the painting composes it (the squint test's, npm run squint:terraces; the Vista button's on other
   * seeds): high over the terraces from a stand found by search, looking down across them and out over the next
   * hills, a wide portrait view.
   */
  paintingVista(immediate = true): void {
    const stand = this.searchStand();
    this.rig.lookAlong(stand.focus, stand.forward, immediate);
    const zoom = this.rig.zoomForAltitude(VISTA.height);
    this.rig.setZoom(zoom, immediate);
    this.rig.lookUp(VISTA.tilt - this.rig.framing(zoom).tilt);
    this.rig.widenFov(VISTA.widen, immediate);
    this.posed = true;
  }

  /** The middle of the planet's widest flat ground (the most candidates round it flat), and a way across it. */
  private findFlats(): { focus: Vector3; forward: Vector3 } {
    const f = this.field;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const n = 3000;
    const flat = new Uint8Array(n);
    const dirs: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      const d = new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z);
      dirs.push(d);
      flat[i] = f.slope(d.x, d.y, d.z) < f.p.flat ? 1 : 0;
    }
    // (candidates about 4.5 m apart: the flat ones within 12 m of each flat one counted)
    let best = -1;
    let at = 0;
    const near = Math.cos(12 / f.R);
    for (let i = 0; i < n; i++) {
      if (!flat[i]) continue;
      let c = 0;
      for (let j = 0; j < n; j++) if (flat[j] && dirs[i].dot(dirs[j]) > near) c++;
      if (c > best) {
        best = c;
        at = i;
      }
    }
    const focus = dirs[at].clone();
    return { focus, forward: tangentToward(focus, Math.abs(focus.y) < 0.95 ? WORLD_UP : WORLD_X, new Vector3()) };
  }

  /**
   * Kai's stand on the planet he chose it on (KAI_VIEW); on others the stand searchStand finds.
   */
  private findStand(): { focus: Vector3; forward: Vector3 } {
    if (this.kaiView) return { focus: new Vector3(0, 1, 0).applyQuaternion(KAI_VIEW.frame), forward: new Vector3(0, 0, -1).applyQuaternion(KAI_VIEW.frame) };
    return this.searchStand();
  }

  /**
   * The best stand from a spiral of candidates over the planet: on a terraced hillside (its smoothed slope between
   * the flats' and the woods'), the ground falling away in front of it; facing downhill.
   */
  private searchStand(): { focus: Vector3; forward: Vector3 } {
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
      // (and, once the towers stand, none where one would fill the view: within its height and some of it)
      if (this.nearTower(d)) continue;
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

  /** Whether a direction lies within a tower's height and some of it (none before the towers are placed). */
  private nearTower(d: Vector3): boolean {
    const t = this.objects.peaks;
    if (!t) return false;
    const R = this.field.R;
    for (let i = 0; i < t.length; i += 8) if (d.x * t[i] + d.y * t[i + 1] + d.z * t[i + 2] > Math.cos((t[i + 4] * t[i + 7] + 10) / R)) return true;
    return false;
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
    this.rig.visualRadius = p.view.visualRadius;
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
    // Muse's hut once a build is in (on Kai's planet), and the trees kept off its footing
    if (this.objects.trees && this.objects.trees !== this.treesFrom) {
      this.treesFrom = this.objects.trees;
      const extra = this.hut.place(this.kaiView ? MUSE_HUT : null, this.objects.group, R, this.noiseSeed);
      for (const mesh of extra.meshes) this.objects.add(mesh);
      const kept = this.hut.clear(this.objects.trees, 5, 1, R);
      const trees = new Float32Array(kept.length + extra.trees.length);
      trees.set(kept);
      trees.set(extra.trees, kept.length);
      this.trees.place(trees);
    }
    if (this.objects.peaks && this.objects.peaks !== this.placedModels) {
      this.placedModels = this.objects.peaks;
      this.towers.set(placements(this.objects.peaks), R);
      mapPeaks(this.own.uHeightFogPeaks.value, this.objects.peaks, R);
      // (the opening view looked for before the towers stood: another stand, if one fills it and the camera is still there)
      const opening = this.openingStand;
      this.openingStand = null;
      if (opening && this.nearTower(opening) && rig.up.dot(opening) > Math.cos(1 / R)) {
        const stand = this.findStand();
        this.rig.lookAlong(stand.focus, stand.forward);
      }
      // (the village houses too: none within a house's reach of the hut's footing; its path runs clear of them)
      this.houses.set(placements(this.hut.clear(this.objects.houses ?? new Float32Array(0), 8, 6, R, false)), R);
    }
    // (near ones in full detail: the camera's place on the planet, unwarped)
    this.towers.update(this.eye.copy(rig.up).multiplyScalar(R + rig.altitude));
    this.houses.update(this.eye);
    // the trees near the camera drawn in full, by the panel's reach
    this.own.uTreeNear.value = p.terraces.treeNear;
    this.nearTrees.update(this.trees.placed, this.eye, p.terraces.treeNear, R);
    // the rice reads the built paddies round the focus from their map
    this.paddyMap.render(this.renderer, this.objects.group, rig.up, rig.forward, R, `${this.objects.version}/${this.own.uPaddy.value.y.toFixed(3)}`);
    // the rice near the focus, fewer as the camera rises, none from a bird's height
    const riceNear = RICE.near * smoothstep(60, 22, rig.altitude);
    this.nearFieldDrawn = riceNear > 0.5;
    this.rice.update(this.renderer, { seed: p.world.seed, radius: R, radiusHi: this.band.radiusHi, focus: rig.up, frustum: this.frustum, warp: this.warp, queue: this.queue, near: riceNear }, riceNear, p.wind.sheen * 1.2);
    this.own.uRiceNear.value.set(rig.up.x, rig.up.y, rig.up.z, riceNear);
    // the mist: its clouds drifting with the wind, by the panel's sliders (how many, their height and its range, their
    // density, their twist) and the wind's speed
    const t = p.terraces;
    this.mist.update(this.renderer, this.noiseSeed, this.field, R, clock.time, p.clouds.speed, this.windAxis, rig.altitude, t.cloudCount, t.cloudRange, t.cloudHeight, t.cloudDensity, t.cloudTwist);
    // the height fog (fog.glsl), by the panel's sliders: its density (the slider's square, so the low end is fine:
    // 0.2 a m at Kai's 2, 0.45 at its fullest), the height it fills the valleys to, how far over that it thins; how
    // patchy it is across the globe and how large its patches; its tint; how it thins away from the spiky mountains
    // and near the camera's place on the planet
    this.own.uHeightFog.value.set(0.05 * t.fogDensity * t.fogDensity, t.fogRange, Math.max(t.fogFalloff, 0.5), rig.altitude);
    this.own.uHeightFogPatches.value.set(t.fogPatchiness, t.fogPatchSize, 0, 0);
    this.own.uHeightFogEye.value.copy(rig.up);
    this.own.uHeightFogTint.value.set(t.fogTint, t.fogTintHue);
    this.own.uHeightFogPeak.value.set(t.fogPeakReduction, t.fogPeakRange, Math.max(t.fogPeakFalloff, 1));
    this.own.uHeightFogNear.value.set(t.fogNearReduction, t.fogNearRange, Math.max(t.fogNearFalloff, 1));
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
