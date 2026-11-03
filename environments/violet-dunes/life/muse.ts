import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, FrontSide, InstancedBufferGeometry, Matrix3, Mesh, ShaderMaterial, Sphere, Vector3, Vector4, type Frustum, type IUniform, type Texture } from 'three';
import { smoothstep } from '../../../src/core/math';
import type { Terrain } from '../planet/terrain';
import { warpPoint, type WarpFrame } from '../../../src/render/warp';
import { FIELD_FIT, type MuseBody, type MuseFit } from '../../../src/life/museBody';
import { dressMuse, fitOf, isDressed } from '../../../src/life/museDress';
import type { DressedKind, MuseMesh } from '../../../src/life/museMesh';
import { SCULPTS, type SculptKind } from './museMesh';
import BodyWorker from '../../../src/life/museBody.worker?worker&inline';
import fragmentShader from './muse.frag.glsl?raw';
import vertexShader from './muse.vert.glsl?raw';
import { MuseRig, STEP, WAVE_LENGTH, type MuseAction } from './museRig';
import shadowFragment from './museShadow.frag.glsl?raw';
import shadowVertex from './museShadow.vert.glsl?raw';

// Muse, who lives here: a cream plush a little over a meter tall, built
// from its reference (museBody.ts: one distance field, meshed off the main
// thread), skinned on thirteen joints and posed in closed form (museRig.ts),
// drawn as its skin and SHELLS shells of fur in one instanced draw
// (muse.vert.glsl, muse.frag.glsl), and casting its shadow into the clouds'
// map as the birds do.
//
// It keeps to the sand in front of the shelter's door (the shelter's local
// meters), on a day DAY long that is a function of time alone: it looks
// out over the dunes, turns and waddles along the front, looks out again,
// turns to you and waves, waddles back, and stands looking at you. Where it
// faces "you", and where its head turns, follow the camera as it is now, so
// a frozen time still draws one Muse.

/**
 * Muse's height (m), the fur's length (m), and the most shells it is drawn
 * in: fewer as it gets smaller on screen, never more than a pixel apart (so
 * from the homestead view, Muse about 40 px tall, two).
 */
export const MUSE_HEIGHT = 1.1;
export const FUR_LENGTH = 0.04;
export const SHELLS = 20;
/**
 * Its two stands on the sand in front of the shelter's door (the shelter's local m: x along the front, z out toward the
 * approach), and its pace (m/s). Muse is about 0.72 m deep and the plinth's apron in front of the wall only 0.6 m, so it
 * stands on the pad's sand just in front of the plinth (which ends at z = 2.4), where board 01 draws it.
 */
export const STANDS = { a: [-0.9, 2.95], b: [0.9, 2.95] } as const;
/** The floor Muse stands on, above the pad (m): the sand itself. */
export const MUSE_FLOOR = 0;
const PACE = 0.36;
/** The walk's share of its time spent speeding up and slowing down, at each end. */
const RAMP = 0.12;
/** Farther than this from the camera (m) Muse is a pixel or two and is not drawn. */
const SEEN = 160;
/** How far round from facing out over the meadow Muse turns to face you (rad). */
const FACE_YOU = 1.7;

type Stand = keyof typeof STANDS;
/** Muse's body: the field's own, a Tripo sculpt of it, or one of the muses in clothes (src/life/museMesh.ts DRESSED, rigged as src rigs them). */
export type MuseModel = 'field' | SculptKind | DressedKind;
/** A heading on the terrace (rad from facing out, +z, toward +x), or toward the camera. */
type Facing = number | 'you';
type Beat =
  | { kind: 'stand'; at: Stand; facing: Facing; time: number; wave?: number }
  | { kind: 'turn'; at: Stand; from: Facing; to: Facing; time: number }
  | { kind: 'walk'; from: Stand; to: Stand; time: number };

const ALONG = Math.PI / 2;
const WALK = Math.hypot(STANDS.b[0] - STANDS.a[0], STANDS.b[1] - STANDS.a[1]);
const WALK_TIME = WALK / (PACE * (1 - RAMP));
const DAY: readonly Beat[] = [
  { kind: 'stand', at: 'a', facing: 0, time: 4 },
  { kind: 'turn', at: 'a', from: 0, to: ALONG, time: 1.2 },
  { kind: 'walk', from: 'a', to: 'b', time: WALK_TIME },
  { kind: 'turn', at: 'b', from: ALONG, to: 0, time: 1.2 },
  { kind: 'stand', at: 'b', facing: 0, time: 3.5 },
  { kind: 'turn', at: 'b', from: 0, to: 'you', time: 1 },
  { kind: 'stand', at: 'b', facing: 'you', time: WAVE_LENGTH + 0.6, wave: 0.25 },
  { kind: 'turn', at: 'b', from: 'you', to: -ALONG, time: 1.2 },
  { kind: 'walk', from: 'b', to: 'a', time: WALK_TIME },
  { kind: 'turn', at: 'a', from: -ALONG, to: 'you', time: 1.2 },
  { kind: 'stand', at: 'a', facing: 'you', time: 5 },
  { kind: 'turn', at: 'a', from: 'you', to: 0, time: 1 },
];
/** Each beat's start (s), the day's length, and the gait's phase at each beat's start (cycles of two steps). */
const STARTS: number[] = [];
const GAITS: number[] = [];
const DAY_LENGTH = (() => {
  let t = 0;
  let gait = 0;
  for (const beat of DAY) {
    STARTS.push(t);
    GAITS.push(gait);
    t += beat.time;
    gait += beatGait(beat);
  }
  return t;
})();

/** How far the gait runs through a beat: a step per step's length walked; two steps to turn on the spot. */
function beatGait(beat: Beat): number {
  if (beat.kind === 'walk') return WALK / (2 * STEP.length * MUSE_HEIGHT);
  return beat.kind === 'turn' ? 1 : 0;
}

/** ∫₀ᵘ smoothstep(a, b, x) dx. */
function rampIntegral(u: number, a: number, b: number): number {
  if (u <= a) return 0;
  if (u >= b) return (b - a) / 2 + (u - b);
  const x = (u - a) / (b - a);
  return (b - a) * (x * x * x - (x * x * x * x) / 2);
}

/** The shorter way round from one heading to another (rad). */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const bounds = new Sphere();

export class Muse {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly shadowMesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** Muse's body: the field's own (museBody.ts), or the Tripo sculpt bound to the same skeleton (museTripo.ts, dev only). */
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
    uMuseGrade: { value: new Vector3(1, 1, 1) },
    uMuseRaise: { value: 0 },
  };
  private readonly action: MuseAction = { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 0 };
  /** The cottage's frame: across, up, toward the pond (planet space), and the ground of its clearing (m from the centre). */
  private readonly X = new Vector3();
  private readonly U = new Vector3();
  private readonly Z = new Vector3();
  /** Where Muse stands now (cottage-local m), its heading (rad), and its frame on the planet. */
  private readonly at = [0, 0];
  private heading = 0;
  private readonly up = new Vector3();
  private readonly forward = new Vector3();
  private readonly left = new Vector3();
  private loaded = false;

  constructor(shared: Record<string, IUniform>) {
    // an empty body until the worker's arrives, so the program is built with the others before the first frame
    this.mesh = new Mesh(
      new InstancedBufferGeometry(),
      new ShaderMaterial({ name: 'muse', vertexShader, fragmentShader, uniforms: { ...shared, ...this.uniforms }, side: FrontSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.shadowMesh = new Mesh(
      new BufferGeometry(),
      new ShaderMaterial({
        name: 'muse shadow',
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        uniforms: { uCubeFace: shared.uCubeFace, uFaceWindow: shared.uFaceWindow, uRadius: shared.uRadius, uSunAngles: shared.uSunAngles, ...this.uniforms },
        side: DoubleSide,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.shadowMesh.frustumCulled = false;
    this.loading = new Promise<void>((resolve) => {
      const worker = new BodyWorker();
      worker.onmessage = (event: MessageEvent<MuseBody>) => {
        this.fieldBody = event.data;
        if (this.model === 'field') this.take(event.data, FIELD_FIT, null, null);
        worker.terminate();
        resolve();
      };
      worker.onerror = (error) => {
        console.error('Muse: the body could not be built', error);
        resolve();
      };
    });
  }

  /** Resolved once the body asked for is meshed and in place (the harness waits on it before a capture). */
  get ready(): Promise<void> {
    return this.loading;
  }

  /**
   * Switch Muse's body: the field's own, or a Tripo sculpt on the same
   * skeleton (Tripo's first, made with its arms hanging, or its T-pose; its
   * own paint, the same fur and light). The sculpt is loaded the first time it is asked for; where it
   * cannot be had, Muse keeps the field's.
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
        if (isDressed(model)) {
          // a muse in clothes, loaded and rigged once for the page as src's Muse has it (museSculptLoader.ts sculptFor)
          const { sculptFor } = await import('../../../src/life/museSculptLoader');
          const dressed = await sculptFor(model);
          if (this.model === model) this.take(dressed.body, fitOf(model, dressed.body), dressed.grade, dressed.paint);
          return;
        }
        const { loadTripo } = await import('./museTripo');
        const sculpt = await loadTripo(model);
        if (this.model === model) this.take(sculpt.body, SCULPTS[model].fit, sculpt.grade, null);
      } catch (error) {
        console.warn('Muse: the Tripo sculpt could not be loaded; keeping the field body', error);
      }
    });
  }

  /** Put a body in place: one geometry for the skin and its shells, the skin alone for the shadow; its skeleton's fit, its paint, and its clothes' (src/life/museDress.ts). */
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
   * Muse at a time: where it is on its day, posed, set on the planet. The
   * camera (planet space) is where it turns to face you and looks; the wind
   * (the shared look uniforms' axis and strength) lays its fur over.
   */
  update(time: number, terrain: Terrain, camera: Vector3, wind: Vector4, pixelAngle: number, show: boolean): void {
    const L = terrain.layout;
    const R = terrain.radius;
    // the cottage's frame, as the homestead is placed (world.ts)
    this.U.copy(L.cottage);
    this.X.crossVectors(this.U, L.homeBearing).normalize();
    this.Z.crossVectors(this.X, this.U).normalize();
    const ground = R + terrain.cottageGround;
    const origin = tmp.copy(this.U).multiplyScalar(ground);
    // the camera in the cottage's local meters
    const rel = tmp2.subVectors(camera, origin);
    const cx = rel.dot(this.X);
    const cz = rel.dot(this.Z);
    const cy = rel.dot(this.U) - MUSE_FLOOR;
    this.day(time, cx, cz);
    // set on its stand: bent round the planet as the shelter is (props.vert.glsl), standing straight up there
    const [x, z] = this.at;
    const d = Math.hypot(x, z);
    const angle = Math.asin(Math.min(d / R, 1));
    const t = d > 1e-5 ? tmp.copy(this.X).multiplyScalar(x / d).addScaledVector(this.Z, z / d) : tmp.copy(this.X);
    this.up.copy(this.U).multiplyScalar(Math.cos(angle)).addScaledVector(t, Math.sin(angle));
    const pos = this.uniforms.uMusePos.value.copy(this.up).multiplyScalar(ground + MUSE_FLOOR);
    this.forward.copy(this.X).multiplyScalar(Math.sin(this.heading)).addScaledVector(this.Z, Math.cos(this.heading));
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up)).normalize();
    this.left.crossVectors(this.up, this.forward);
    const f = this.left;
    const u = this.up;
    const w = this.forward;
    this.uniforms.uMuseFrame.value.set(f.x, u.x, w.x, f.y, u.y, w.y, f.z, u.z, w.z);
    // the look toward the camera: its bearing from Muse's heading and its height over Muse's eyes
    const dx = cx - x;
    const dz = cz - z;
    const flat = Math.hypot(dx, dz);
    const yaw = wrap(Math.atan2(dx, dz) - this.heading);
    const pitch = Math.atan2(cy - 0.77 * MUSE_HEIGHT, Math.max(flat, 0.3));
    const near = smoothstep(14, 7, flat) * smoothstep(1.9, 1.2, Math.abs(yaw));
    // otherwise it looks about on its own
    const idleYaw = 0.32 * Math.sin(0.47 * time + 1) + 0.14 * Math.sin(1.27 * time);
    const idlePitch = -0.04 + 0.06 * Math.sin(0.37 * time + 2);
    const a = this.action;
    a.lookYaw = idleYaw + (yaw - idleYaw) * near;
    a.lookPitch = idlePitch + (pitch - idlePitch) * near;
    a.look = a.walk > 0.5 ? 0.4 : 1;
    a.time = time;
    this.rig.pose(a);
    // the eyes blink; it smiles more when you are close and in front, most while it waves
    this.uniforms.uMuseFace.value.set(this.rig.eyes, Math.min(1, this.rig.smile + 0.35 * near), 0, 0);
    this.uniforms.uMuseRaise.value = this.rig.raised;
    // the wind lays the fur over along its way here, in gusts
    const strength = wind.w;
    const along = tmp.set(wind.x, wind.y, wind.z).cross(this.up);
    if (along.lengthSq() > 1e-8) along.normalize();
    const push = FUR_LENGTH * 0.9 * strength * (0.75 + 0.25 * Math.sin(1.3 * time) * Math.sin(0.41 * time + 1));
    this.uniforms.uMuseWind.value.set(along.x * push, along.y * push, along.z * push, 0.3 * strength);
    const far = camera.distanceTo(pos);
    const seen = show && this.loaded && far < SEEN;
    this.mesh.visible = seen;
    this.shadowMesh.visible = seen;
    // as many shells as the fur's length on screen in pixels
    const shells = Math.max(2, Math.min(SHELLS, Math.ceil(FUR_LENGTH / Math.max(far, 0.1) / Math.max(pixelAngle, 1e-6))));
    this.uniforms.uMuseSize.value.z = shells;
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = shells + 1;
  }

  /** Where Muse is on its day at a time: its stand or its walk, its heading, and what its body is doing. */
  private day(time: number, cx: number, cz: number): void {
    const u = ((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
    let k = DAY.length - 1;
    while (k > 0 && STARTS[k] > u) k--;
    const beat = DAY[k];
    const s = Math.min(1, (u - STARTS[k]) / beat.time);
    const a = this.action;
    a.walk = 0;
    a.stride = 1;
    a.wave = -1;
    a.gait = GAITS[k];
    const facing = (f: Facing, x: number, z: number): number => {
      if (f !== 'you') return f;
      return Math.max(-FACE_YOU, Math.min(FACE_YOU, Math.atan2(cx - x, cz - z)));
    };
    if (beat.kind === 'walk') {
      const from = STANDS[beat.from];
      const to = STANDS[beat.to];
      // speeding up and slowing down at the ends; the feet keep pace with the ground covered
      const covered = (rampIntegral(s, 0, RAMP) - rampIntegral(s, 1 - RAMP, 1)) / (1 - RAMP);
      const speed = smoothstep(0, RAMP, s) - smoothstep(1 - RAMP, 1, s);
      this.at[0] = from[0] + (to[0] - from[0]) * covered;
      this.at[1] = from[1] + (to[1] - from[1]) * covered;
      this.heading = Math.atan2(to[0] - from[0], to[1] - from[1]);
      a.walk = smoothstep(0, 0.35, speed);
      a.gait += beatGait(beat) * covered;
    } else {
      const at = STANDS[beat.at];
      this.at[0] = at[0];
      this.at[1] = at[1];
      if (beat.kind === 'turn') {
        // stepping round on the spot
        const from = facing(beat.from, at[0], at[1]);
        const to = facing(beat.to, at[0], at[1]);
        this.heading = from + wrap(to - from) * smoothstep(0, 1, s);
        a.walk = 0.55 * Math.sin(Math.PI * s);
        a.stride = 0;
        a.gait += beatGait(beat) * s;
      } else {
        this.heading = facing(beat.facing, at[0], at[1]);
        if (beat.wave !== undefined) a.wave = u - STARTS[k] - beat.wave;
      }
    }
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

  /** Where Muse stands now (cottage-local m) and its heading (rad): for the camera's named view. */
  get spot(): { x: number; z: number; heading: number } {
    return { x: this.at[0], z: this.at[1], heading: this.heading };
  }
}
