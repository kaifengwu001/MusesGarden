import type { Ray} from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  FrontSide,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix3,
  Matrix4,
  MaxEquation,
  Mesh,
  OrthographicCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Frustum,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { gpuMemory } from '../core/gpuMemory';
import type { Terrain } from '../planet/terrain';
import { localSun } from '../render/sun';
import { warpPoint, type WarpFrame } from '../render/warp';
import { FIELD_FIT, JOINT, type MuseBody, type MuseFit } from './museBody';
import { dressMuse, fitOf } from './museDress';
import type { DressedKind, MuseMesh, SculptKind } from './museMesh';
import BodyWorker from './museBody.worker?worker&inline';
import fragmentShader from './muse.frag.glsl?raw';
import vertexShader from './muse.vert.glsl?raw';
import { MuseProps } from './museProps';
import { MuseRig, STEP } from './museRig';
import { MuseRoam, PACE, type Indoors, type Roaming, type Room } from './museRoam';
import shadowFragment from './museShadow.frag.glsl?raw';
import shadowVertex from './museShadow.vert.glsl?raw';

// Muse, who lives here: a cream plush about as tall as you, built from its
// reference (museBody.ts: one distance field, meshed off the main thread, or
// the source model's sculpt rigged on the same skeleton, museMesh.ts), skinned on
// thirteen joints and posed in closed form (museRig.ts), drawn as its skin
// and SHELLS shells of fur in one instanced draw (muse.vert.glsl,
// muse.frag.glsl), and casting its shadow into a map of its own about it
// (museShadowMap.glsl), fine enough that its edge stays clean as it moves.
//
// It roams the planet on a life of its own (museRoam.ts): out over the
// meadow and home again, perched on the bench, fishing off the pier or from
// a bank, watering the plants, napping in the grass, cooking at its hearth
// while you visit, always findable by time alone, so a frozen time still draws one
// Muse. Tap it and it answers; hold it and it leans into your hand. Lying in
// the grass it presses it down round it (uMusePress, read by the grass).

/**
 * Muse's height (m), the fur's length (m), and the most shells it is drawn
 * in: fewer as it gets smaller on screen, never more than a pixel apart (so
 * from the homestead view, Muse about 60 px tall, two or three).
 */
export const MUSE_HEIGHT = 1.65;
export const FUR_LENGTH = 0.06;
export const SHELLS = 20;
/** Farther than this from the camera (m) Muse is a pixel or two and is not drawn. */
const SEEN = 160;
/**
 * Its shadow's map: `size` texels square about where its shadow reaches the water table, its half-width enough for
 * its body's spheres' shadows (at least `min` m, in steps of `step` m, so the texels keep their size while it moves),
 * and the soft edge's reach (m).
 */
const SHADOW = { size: 512, min: 0.9, step: 0.25, soft: 0.02 } as const;

/**
 * What the garden's engine says Muse is doing, over its own life. `home` leaves it to its life by the hut, or, while
 * `busy` (working at home), sat on the bench with its head bowed; `out` stands it at a spot out on the planet (a unit
 * direction), stepping toward `toward` while `walk` is above 0, still with its head bowed while `busy`; `inside` stands
 * it in its hut (the cutaway: view/cutaway.ts) on the floor there (its feet's height over R, m), facing along
 * `heading`, `doing` one of three things (cooking at the hearth's stove's `pot`, planet space; greeting you; asleep
 * on its bed), your taps and holds answered as anywhere (museRoam.ts inside); `hidden` is beyond the planet or away at a friend's (away: not drawn, its life keeps
 * time). With no engine Muse lives its life.
 */
export type MuseDirection =
  | { readonly kind: 'home'; readonly busy: boolean }
  | { readonly kind: 'out'; readonly dir: Vector3; readonly toward: Vector3 | null; readonly walk: number; readonly busy: boolean }
  | { readonly kind: 'inside'; readonly doing: Indoors; readonly dir: Vector3; readonly height: number; readonly heading: Vector3; readonly pot: Vector3 | null }
  | { readonly kind: 'hidden' };

/** The gait out on the planet (cycles of two steps a second), at its life's pace. */
const OUT_GAIT = PACE / (2 * STEP.length);
/** Head bowed over its work (rad, + up). */
const BUSY_PITCH = -0.45;
/** Muse's body as spheres about its joints (the joint, how far up its own frame, the radius, all × its height): its press on the grass and where a tap finds it. */
const BODY: readonly [number, number, number][] = [
  [JOINT.pelvis, 0.06, 0.21],
  [JOINT.spine, 0.02, 0.26],
  [JOINT.chest, 0.04, 0.24],
  [JOINT.head, 0.09, 0.25],
  [JOINT.legL, -0.08, 0.08],
  [JOINT.legR, -0.08, 0.08],
];
export const PRESSES = BODY.length;

/** Muse's body: the field's own, a sculpt of it, or one of the muses in clothes (museMesh.ts DRESSED). */
export type MuseModel = 'field' | SculptKind | DressedKind;

/** The field's body, meshed once for the page however many Muses are drawn (each poses it on a skeleton of its own). */
let fieldJob: Promise<MuseBody> | null = null;
function fieldBody(): Promise<MuseBody> {
  fieldJob ??= new Promise<MuseBody>((resolve, reject) => {
    const worker = new BodyWorker();
    worker.onmessage = (event: MessageEvent<MuseBody>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (error) => reject(new Error(`the field's body could not be built: ${error.message}`));
  });
  return fieldJob;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const sun = new Vector3();
const centre = new Vector3();
const across = new Vector3();
const upMap = new Vector3();
const clearColour = new Color();
const bounds = new Sphere();
const frameTmp = new Matrix4();

/** A point (planet space, m) carried on down the sun at Muse to the water table (R), in place: as museShadow.vert.glsl. */
function down(p: Vector3, R: number): Vector3 {
  const cl = p.dot(sun);
  return p.addScaledVector(sun, -(cl - Math.sqrt(Math.max(cl * cl - p.lengthSq() + R * R, 0))));
}

/** Where Muse is: a unit direction on the planet, its feet's height over R (m), and the way it faces there (a unit tangent). */
export interface MuseWhere {
  dir: Vector3;
  height: number;
  heading: Vector3;
}

export class Muse {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly shadowMesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** Muse's body: the field's own (museBody.ts), or the imported sculpt bound to the same skeleton (museSculptLoader.ts). */
  private model: MuseModel = 'field';
  private fieldBody: MuseBody | null = null;
  private loading: Promise<void>;
  private rig = new MuseRig();
  private readonly uniforms = {
    uBones: { value: this.rig.skin },
    uBoneDQ: { value: this.rig.dual },
    uMusePos: { value: new Vector3() },
    uMuseFrame: { value: new Matrix3() },
    uMuseSize: { value: new Vector4(MUSE_HEIGHT, FUR_LENGTH, SHELLS, 0) },
    uMuseWind: { value: new Vector4() },
    uMuseFace: { value: new Vector4(1, 0, 0, 0) },
    uMuseMood: { value: new Vector4() },
    uMuseFluff: { value: new Vector4(0, 0, 0, 0.12) },
    uMuseGrade: { value: new Vector3(1, 1, 1) },
    uMuseRaise: { value: new Vector4(0, 0, 1, 1) },
  };
  /** Its life on the planet, laid out for the planet as it is (a new one when the planet changes). */
  private roam: MuseRoam | null = null;
  /** Where it is now (kept up even while it is not drawn), whether it is at home, and whether it is away off the planet (not drawn, no shadow, not tappable; its life keeps time). */
  readonly where: MuseWhere = { dir: new Vector3(0, 1, 0), height: 0, heading: new Vector3(1, 0, 0) };
  home = true;
  away = false;
  /** Its frame on the planet now: across to its left, up, forward (planet space), and the feet's place; scaled by its height (the rig is in its heights). */
  private readonly up = new Vector3();
  private readonly forward = new Vector3();
  private readonly left = new Vector3();
  readonly place = new Matrix4();
  /** Its body's spheres (planet space, m), for the grass and for taps. */
  readonly spheres = Array.from({ length: BODY.length }, () => new Vector4());
  /** The last life read; its things (what it holds, what floats about it). */
  living: Roaming | null = null;
  /** Whether its hut's walls stand whole round it (the cutaway shut: world.ts): in its room then, they hide it. */
  walled = true;
  /** How far its hut's front door stands open now (0 … 1, as its life swings it: museRoam.ts doorAt). */
  door = 0;
  /** When its life was last read (world s). */
  private time = 0;
  /** What the engine says it is doing (directed), and the life it is given for that when it isn't its own. */
  private direction: MuseDirection = { kind: 'home', busy: false };
  /** When it came into its hut (world s; NaN until its first moment there). */
  private insideSince = Number.NaN;
  private readonly directed: Roaming = {
    dir: new Vector3(0, 1, 0),
    height: 0,
    heading: new Vector3(1, 0, 0),
    action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0, moves: [] },
    lookAt: null,
    cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
    home: false,
  };
  readonly props: MuseProps;
  private loaded = false;
  private readonly press: { value: Vector4[] } | null;
  private readonly pressK: { value: number } | null;
  /** Its shadow's map, the pass that draws it, and what the ground and the plants read it by (world.ts's shared uniforms). */
  private readonly shadowTarget: WebGLRenderTarget;
  private readonly shadowScene: Scene;
  private readonly shadowCamera = new OrthographicCamera();
  private readonly shadowFrame: Matrix3;
  private readonly shadowScale = new Vector3(0, 0, 1);
  private readonly shadowSun: Vector4;
  private readonly shadowWindow: Vector4;
  private readonly shadowFeet: Vector3;
  private readonly sunAngles: Vector4;
  private readonly cloudLook: Vector4 | null;
  /** Muses beside this one (a friend's, visiting: src/visit/): their shadows drawn into this one's map, which widens to take them in. */
  private readonly guests: Muse[] = [];

  constructor(shared: Record<string, IUniform>) {
    // an empty body until the worker's arrives, so the program is built with the others before the first frame
    this.mesh = new Mesh(
      new InstancedBufferGeometry(),
      new ShaderMaterial({ name: 'muse', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: FrontSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    // its shadow: a map of its own about it, the frame and scale the pass draws it in shared with those who read it
    this.shadowFrame = (shared.uMuseShadowFrame as IUniform<Matrix3> | undefined)?.value ?? new Matrix3();
    this.shadowSun = (shared.uMuseShadowSun as IUniform<Vector4> | undefined)?.value ?? new Vector4();
    this.shadowWindow = (shared.uMuseShadowWindow as IUniform<Vector4> | undefined)?.value ?? new Vector4();
    this.shadowFeet = (shared.uMuseShadowFeet as IUniform<Vector3> | undefined)?.value ?? new Vector3();
    this.sunAngles = (shared.uSunAngles as IUniform<Vector4>).value;
    this.cloudLook = (shared.uCloudLook as IUniform<Vector4> | undefined)?.value ?? null;
    this.shadowMesh = new Mesh(
      new BufferGeometry(),
      new ShaderMaterial({
        name: 'muse shadow',
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        uniforms: { uCubeFace: { value: this.shadowFrame }, uFaceWindow: { value: this.shadowScale }, uRadius: shared.uRadius, uSunAngles: shared.uSunAngles, ...this.uniforms },
        side: DoubleSide,
        blending: CustomBlending,
        blendEquation: MaxEquation,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.shadowMesh.frustumCulled = false;
    this.shadowScene = new Scene().add(this.shadowMesh);
    this.shadowTarget = new WebGLRenderTarget(SHADOW.size, SHADOW.size, { format: RedFormat, type: UnsignedByteType, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
    gpuMemory.set('muse shadow', SHADOW.size * SHADOW.size);
    const shadowMap = shared.uMuseShadow as IUniform<Texture | null> | undefined;
    if (shadowMap) shadowMap.value = this.shadowTarget.texture;
    this.props = new MuseProps(shared);
    // (the grass's press, shared: world.ts makes it before the grass)
    this.press = (shared.uMusePress as { value: Vector4[] } | undefined) ?? null;
    this.pressK = (shared.uMusePressK as { value: number } | undefined) ?? null;
    this.loading = fieldBody().then(
      (body) => {
        this.fieldBody = body;
        if (this.model === 'field') this.take(body, FIELD_FIT, null, null);
      },
      (error: unknown) => console.error('Muse: the body could not be built', error),
    );
  }

  /** Resolved once the body asked for is meshed and in place (the harness waits on it before a capture). */
  get ready(): Promise<void> {
    return this.loading;
  }

  /**
   * Switch Muse's body: the field's own, or a source model sculpt on the same
   * skeleton (the first sculpt, made with its arms hanging, or its T-pose; its
   * own paint, the same fur and light), or a muse in clothes (its clothes and
   * face painted, its skeleton measured off it: museDress.ts). The sculpt is
   * loaded the first time any Muse asks for it; where it cannot be had, Muse
   * keeps the field's.
   */
  useModel(model: MuseModel): void {
    if (model === this.model) return;
    this.model = model;
    this.loading = this.loading.then(async () => {
      if (this.model !== model) return;
      if (model === 'field') {
        if (this.fieldBody) this.take(this.fieldBody, FIELD_FIT, null, null);
        return;
      }
      try {
        const { sculptFor } = await import('./museSculptLoader');
        const sculpt = await sculptFor(model);
        if (this.model === model) this.take(sculpt.body, fitOf(model, sculpt.body), sculpt.grade, sculpt.paint);
      } catch (error) {
        console.warn('Muse: the imported sculpt could not be loaded; keeping the field body', error);
      }
    });
  }

  /** Put a body in place: one geometry for the skin and its shells, the skin alone for the shadow; its skeleton's fit, its paint, and its clothes' (museDress.ts). */
  private take(body: MuseBody & Partial<MuseMesh>, fit: MuseFit, grade: Vector3 | null, paint: Texture | null): void {
    const index = new BufferAttribute(body.index, 1);
    const position = new BufferAttribute(body.position, 3);
    const skinIndex = new BufferAttribute(body.skinIndex, 4);
    const skinWeight = new BufferAttribute(body.skinWeight, 4);
    const g = new InstancedBufferGeometry();
    g.setIndex(index);
    g.setAttribute('position', position);
    g.setAttribute('normal', new BufferAttribute(body.normal, 3));
    g.setAttribute('skinIndex', skinIndex);
    g.setAttribute('skinWeight', skinWeight);
    g.setAttribute('aFur', new BufferAttribute(body.fur, 1));
    g.setAttribute('aOpen', new BufferAttribute(body.open, 1));
    if (body.colour) g.setAttribute('aColour', new BufferAttribute(body.colour, 3));
    if (body.raise && body.raiseNormal && body.raiseOpen) {
      g.setAttribute('aRaise', new BufferAttribute(body.raise, 3));
      g.setAttribute('aRaiseNormal', new BufferAttribute(body.raiseNormal, 3));
      g.setAttribute('aRaiseOpen', new BufferAttribute(body.raiseOpen, 1));
    }
    if (body.hang && body.hangNormal) {
      g.setAttribute('aHang', new BufferAttribute(body.hang, 3));
      g.setAttribute('aHangNormal', new BufferAttribute(body.hangNormal, 3));
    }
    if (body.comb) g.setAttribute('aComb', new BufferAttribute(body.comb, 3));
    g.instanceCount = 1;
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    // its skeleton as the body was made, and its own paint where it has one
    this.rig = new MuseRig(fit);
    this.uniforms.uBones.value = this.rig.skin;
    this.uniforms.uBoneDQ.value = this.rig.dual;
    this.uniforms.uMuseGrade.value.set(1, 1, 1);
    if (grade) this.uniforms.uMuseGrade.value.copy(grade);
    const material = this.mesh.material;
    for (const [define, on] of [
      ['MUSE_COLOURED', body.colour !== undefined],
      ['MUSE_RAISE', body.raise !== undefined],
      ['MUSE_HANG', body.hang !== undefined],
      ['MUSE_COMB', body.comb !== undefined],
    ] as const) {
      if (on === define in material.defines) continue;
      if (on) material.defines[define] = 1;
      else delete material.defines[define];
      material.needsUpdate = true;
    }
    dressMuse(g, material, body, paint);
    const s = new BufferGeometry();
    s.setIndex(index);
    s.setAttribute('position', position);
    s.setAttribute('skinIndex', skinIndex);
    s.setAttribute('skinWeight', skinWeight);
    this.shadowMesh.geometry.dispose();
    this.shadowMesh.geometry = s;
    this.loaded = true;
  }

  /**
   * Muse at a time: where its life has it on the planet, posed, set there.
   * The camera (planet space) is where it turns to face you and looks; the
   * wind (the shared look uniforms' axis and strength) lays its fur over.
   */
  update(time: number, terrain: Terrain, camera: Vector3, wind: Vector4, pixelAngle: number, show: boolean): void {
    if (!this.roam?.fits(terrain)) this.roam = new MuseRoam(terrain, MUSE_HEIGHT);
    const R = terrain.radius;
    const l = this.lifeAt(time, camera, this.roam);
    this.living = l;
    this.time = time;
    this.door = this.roam.doorAt(time);
    // (in its room behind the hut's walls: not drawn, no shadow out through them; seen again through the open door)
    const inside = this.walled ? this.roam.indoors(l.dir) : 0;
    this.where.dir.copy(l.dir);
    this.where.height = l.height;
    this.where.heading.copy(l.heading);
    this.home = l.home;
    // its frame: up where it stands, forward along its heading
    this.up.copy(l.dir);
    this.forward.copy(l.heading).addScaledVector(this.up, -l.heading.dot(this.up)).normalize();
    this.left.crossVectors(this.up, this.forward);
    const pos = this.uniforms.uMusePos.value.copy(this.up).multiplyScalar(R + l.height);
    const f = this.left;
    const u = this.up;
    const w = this.forward;
    this.uniforms.uMuseFrame.value.set(f.x, u.x, w.x, f.y, u.y, w.y, f.z, u.z, w.z);
    this.place.makeBasis(f, u, w).scale(tmp.set(MUSE_HEIGHT, MUSE_HEIGHT, MUSE_HEIGHT)).setPosition(pos);
    this.rig.pose(l.action);
    const rig = this.rig;
    this.uniforms.uMuseFace.value.set(rig.eyes, rig.smile, rig.squint, rig.squeeze);
    this.uniforms.uMuseMood.value.set(rig.blush, 0, 0, 0);
    this.uniforms.uMuseFluff.value.copy(rig.fluff);
    this.uniforms.uMuseRaise.value.set(rig.raised, rig.raisedRight, rig.hung, rig.hungRight);
    // its body's spheres, and its press on the grass while it lies there
    const joints = rig.joints();
    BODY.forEach(([j, dy, r], i) => {
      rig.frameOf(j, frameTmp);
      const e = frameTmp.elements;
      tmp2.set(joints[j * 3] + e[4] * dy, joints[j * 3 + 1] + e[5] * dy, joints[j * 3 + 2] + e[6] * dy).applyMatrix4(this.place);
      this.spheres[i].set(tmp2.x, tmp2.y, tmp2.z, r * MUSE_HEIGHT);
    });
    if (this.press && this.pressK) {
      this.spheres.forEach((s, i) => this.press?.value[i].copy(s));
      this.pressK.value = this.away ? 0 : rig.lying;
    }
    // the wind lays the fur over along its way here, in gusts
    const strength = wind.w;
    const along = tmp.set(wind.x, wind.y, wind.z).cross(this.up);
    if (along.lengthSq() > 1e-8) along.normalize();
    const push = FUR_LENGTH * 0.9 * strength * (0.75 + 0.25 * Math.sin(1.3 * time) * Math.sin(0.41 * time + 1));
    this.uniforms.uMuseWind.value.set(along.x * push, along.y * push, along.z * push, 0.3 * strength);
    const far = camera.distanceTo(pos);
    const seen = show && this.loaded && !this.away && far < SEEN && !(inside >= 1 && this.door <= 0);
    this.mesh.visible = seen;
    this.shadowMesh.visible = seen;
    this.placeShadow(R, seen && inside < 0.5);
    // as many shells as the fur's length on screen in pixels
    const shells = Math.max(2, Math.min(SHELLS, Math.ceil(FUR_LENGTH / Math.max(far, 0.1) / Math.max(pixelAngle, 1e-6))));
    this.uniforms.uMuseSize.value.z = shells;
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = shells + 1;
    this.props.update(time, l, rig, this.place, terrain, MUSE_HEIGHT, seen);
  }

  /**
   * Where its shadow falls, for its map: its body's spheres (and any drawn guest's) carried down the sun at Muse to the
   * water table, the map centred among them (its frame turned toward the sun's bearing) and wide enough for each
   * sphere's shadow, stretched along the sun as it gets low. Off (strength 0) while Muse isn't drawn.
   */
  private placeShadow(R: number, seen: boolean): void {
    const a = this.sunAngles;
    localSun(this.up, Math.atan2(a.x, a.y), Math.atan2(a.w, a.z), sun);
    this.shadowWindow.y = 0;
    if (!seen) return;
    const spheres = this.casting();
    centre.set(0, 0, 0);
    for (const s of spheres) centre.add(down(tmp.set(s.x, s.y, s.z), R));
    centre.normalize();
    across.copy(sun).addScaledVector(centre, -sun.dot(centre));
    if (across.lengthSq() < 1e-8) across.copy(this.forward);
    across.normalize();
    upMap.crossVectors(centre, across);
    const sinE = Math.max(sun.dot(this.up), 0.2);
    let half: number = SHADOW.min;
    for (const s of spheres) {
      const g = down(tmp.set(s.x, s.y, s.z), R);
      const out = g.dot(centre);
      half = Math.max(half, (R * Math.abs(g.dot(across))) / out + s.w / sinE + SHADOW.soft, (R * Math.abs(g.dot(upMap))) / out + s.w + SHADOW.soft);
    }
    half = Math.ceil(half / SHADOW.step) * SHADOW.step;
    this.shadowFrame.set(across.x, upMap.x, centre.x, across.y, upMap.y, centre.y, across.z, upMap.z, centre.z);
    this.shadowScale.set(0, 0, R / half);
    // (a point farther from its feet than the whole map's reach, past its height, can't be in its shadow)
    const reach = 2 * Math.SQRT2 * half + MUSE_HEIGHT;
    this.shadowSun.set(sun.x, sun.y, sun.z, reach * reach);
    this.shadowFeet.copy(this.uniforms.uMusePos.value);
    this.shadowWindow.set(R / half, this.cloudLook?.x ?? 0.7, SHADOW.soft / (2 * half * Math.SQRT2), 0);
  }

  /**
   * A guest beside this Muse (a friend's Muse visiting, made without the shadow's shared uniforms: world.ts
   * addVisitor): its shadow is drawn into this Muse's map, in this Muse's frame, and the map is placed to take it in
   * while it is drawn. Only this Muse's map reaches the ground, so a guest never takes it over.
   */
  shadowWith(guest: Muse): void {
    const uniforms = guest.shadowMesh.material.uniforms;
    uniforms.uCubeFace.value = this.shadowFrame;
    uniforms.uFaceWindow.value = this.shadowScale;
    this.shadowScene.add(guest.shadowMesh);
    this.guests.push(guest);
  }

  /** The spheres its shadow's map holds: its own, and any drawn guest's. (Update its guests first: world.ts does.) */
  private casting(): readonly Vector4[] {
    if (this.guests.length === 0) return this.spheres;
    return [...this.spheres, ...this.guests.filter((g) => g.shadowMesh.visible).flatMap((g) => g.spheres)];
  }

  /** Draw its shadow's map (after update, before the scene that reads it). */
  renderShadow(renderer: WebGLRenderer): void {
    if (this.shadowWindow.y <= 0) return;
    const previous = renderer.getRenderTarget();
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColour);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.shadowTarget);
    renderer.clear(true, false, false);
    renderer.render(this.shadowScene, this.shadowCamera);
    renderer.setClearColor(clearColour, clearAlpha);
    renderer.setRenderTarget(previous);
  }

  /** The engine's say over Muse's life (null-free: with no engine it stays home, living its life). */
  direct(direction: MuseDirection): void {
    if (direction.kind === 'inside' && (this.direction.kind !== 'inside' || this.direction.doing !== direction.doing)) this.insideSince = Number.NaN;
    this.direction = direction;
    this.away = direction.kind === 'hidden';
  }

  /** Its life at a time, unless the engine has it out on the planet or working at home. */
  private lifeAt(time: number, camera: Vector3, roam: MuseRoam): Roaming {
    const d = this.direction;
    if (d.kind === 'inside') {
      // in its hut: its life puts it there, cooking if there is a pot, answering you as anywhere
      if (Number.isNaN(this.insideSince)) this.insideSince = time;
      return roam.inside(time, camera, { doing: d.doing, dir: d.dir, height: d.height, heading: d.heading, pot: d.pot, since: this.insideSince });
    }
    const life = roam.at(time, camera);
    if (d.kind === 'hidden' || (d.kind === 'home' && !d.busy)) return life;
    const r = this.directed;
    const a = r.action;
    a.moves.length = 0;
    a.time = time;
    a.wave = -1;
    a.look = 1;
    a.lookYaw = (d.busy ? 0.3 : 1) * (0.32 * Math.sin(0.47 * time + 1) + 0.14 * Math.sin(1.27 * time));
    a.lookPitch = d.busy ? BUSY_PITCH : -0.04 + 0.06 * Math.sin(0.37 * time + 2);
    if (d.kind === 'home') {
      // working at home: on the bench, still, head bowed over its lap
      const seat = roam.benchSeat();
      r.dir.copy(seat.dir);
      r.height = seat.height;
      r.heading.copy(seat.heading);
      a.walk = 0;
      a.stride = 1;
      a.gait = 0;
      a.moves.push({ kind: 'perch', time, amount: 1, ease: 0 });
      r.home = true;
      return r;
    }
    // out on the planet: on the ground at its spot (or the deck, standing by its own Muse), facing the way it goes
    r.dir.copy(d.dir).normalize();
    r.height = roam.groundAt(r.dir);
    if (d.toward) r.heading.subVectors(d.toward, r.dir);
    r.heading.addScaledVector(r.dir, -r.heading.dot(r.dir));
    if (r.heading.lengthSq() < 1e-10) r.heading.set(r.dir.y, -r.dir.x, 0);
    if (r.heading.lengthSq() < 1e-10) r.heading.set(1, 0, 0);
    r.heading.normalize();
    a.walk = d.busy ? 0 : d.walk;
    a.stride = 1;
    a.gait = time * OUT_GAIT;
    r.home = false;
    return r;
  }

  /**
   * Draw the skin and fur only when Muse is in view: a sphere about its
   * middle, warped as it is drawn, wide enough for a raised arm and the fur
   * (its vertices are placed in the shader, so three.js cannot cull it). Its
   * shadow still falls.
   */
  cull(frustum: Frustum, warp: WarpFrame): void {
    if (!this.mesh.visible) return;
    bounds.center.copy(this.up).multiplyScalar(0.5 * MUSE_HEIGHT).add(this.uniforms.uMusePos.value);
    warpPoint(warp, bounds.center, bounds.center);
    bounds.radius = 0.8 * MUSE_HEIGHT;
    this.mesh.visible = frustum.intersectsSphere(bounds);
  }

  /** Whether Muse is drawn now: shown, not away, near enough, in view. A tap or a hold only finds it then. */
  get drawn(): boolean {
    return this.mesh.visible;
  }

  /**
   * Where a ray from the camera (view space: as drawn, warped) meets Muse's
   * body, if it does and Muse is drawn: and which of its sides it is on (+1
   * its own left), for which way its head tilts as you pet it.
   */
  pick(ray: Ray, warp: WarpFrame): { side: number } | null {
    if (!this.drawn) return null;
    let best = Infinity;
    let side = 1;
    for (const s of this.spheres) {
      warpPoint(warp, tmp.set(s.x, s.y, s.z), tmp);
      bounds.set(tmp, s.w * 1.1);
      const hit = ray.intersectSphere(bounds, tmp2);
      if (!hit) continue;
      const d = hit.distanceTo(ray.origin);
      if (d < best) {
        best = d;
        warpPoint(warp, tmp.copy(this.uniforms.uMusePos.value), tmp);
        side = tmp2.sub(tmp).dot(this.left) >= 0 ? 1 : -1;
      }
    }
    return best < Infinity ? { side } : null;
  }

  /** You knocked at its hut while it was about (museRoam.ts comeIn): it puts by what it was doing and comes in, to do `doing` there. */
  comeIn(doing: Indoors, room: Room): void {
    this.roam?.comeIn(this.time, doing, room);
  }

  /** You stepped out of its hut: it goes out onto its porch, and on with its days. */
  goOut(): void {
    this.roam?.goOut(this.time);
  }

  /** Your doings (world time, s): a tap, a hold on one side, letting go. */
  tap(time: number): void {
    this.roam?.tap(time);
  }

  hold(time: number, side: number): void {
    this.roam?.hold(time, side);
  }

  letGo(time: number): void {
    this.roam?.letGo(time);
  }

  /** Its life (dev: seeking it, reading its parts). */
  get life(): MuseRoam | null {
    return this.roam;
  }

  /** Its pose (for the props in its mittens). */
  get pose(): MuseRig {
    return this.rig;
  }
}
