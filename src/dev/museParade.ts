import {
  AddEquation,
  BufferAttribute,
  CanvasTexture,
  Color,
  CustomBlending,
  DirectionalLight,
  DoubleSide,
  HalfFloatType,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  type IUniform,
} from 'three';
import { smoothstep } from '../core/math';
import { FUR_LENGTH, MUSE_HEIGHT, SHELLS } from '../life/muse';
import { dressMuse, fitOf } from '../life/museDress';
import { DRESSED, type DressedKind, type MuseMesh, type SculptKind } from '../life/museMesh';
import { MuseRig } from '../life/museRig';
import { loadSculpt } from '../life/museSculptLoader';
import fragmentShader from '../life/muse.frag.glsl?raw';
import vertexShader from '../life/muse.vert.glsl?raw';
import { registerShaderChunks } from '../render/glsl';

// The muses' parade (museLab.html#parade=1), a shot for the demo film: the
// original Muse (Momo, tpose6) and the muses in clothes (museMesh.ts DRESSED)
// one after another on the lab's white, each taking over from the last on a
// match cut, in the same pose at the same moment, so it reads as one Muse
// whose clothes change at every cut. The first half it walks on the spot, a
// muse a step (each cut on a footfall), and comes to a stop; the second half
// it waves, and as the camera comes back round in front of it it turns its
// head to you, its eyes happy. The camera goes once round it, from its right,
// behind it and round its left (the waving arm's side), starting and stopping
// in front of it, at rest at both ends: it lingers in front and swings round
// behind fast (EASE). Everything is in meters, Muse one tall, standing at the
// middle facing +z.
//
// Every frame is a function of time only, so the film is rendered offline
// frame by frame (muse-look's parade.mjs): window.museParade.frame(t,
// samples, shutter) draws the moment t, averaging `samples` renders over the
// shutter (s) for motion blur, each with the light moved a little (soft
// shadows) and the view a fraction of a pixel (smooth edges). The muse on
// screen is the one whose turn it is at t, for the whole shutter, so a frame
// never mixes two. The hash:
//   order=tpose6,muse0,…   the muses in turn (default: the original, then 0–12, as in the lineup)
//   length=<s>             the shot (default 7), each muse on for length / their number
//   wave=<s>               when the walk has come to a stop and the wave begins (default: half way)
//   look=0                 no turning to you at either end
//   ease=<p>               how hard the camera eases off and onto its front (default 5; 1 goes round evenly)
//   live=1                 play it (space pauses, ← → step)
//   t=<s>, samples=<n>     the moment drawn on load (not live), and its renders
//   cam=<round°>,<up°>,<distance>   the camera held there (round from its front, + to its left), for checking

const params = new URLSearchParams(location.hash.slice(1));
const ORDER = (params.get('order')?.split(',') ?? ['tpose6', ...Object.keys(DRESSED)]) as (SculptKind | DressedKind)[];
const LENGTH = Number(params.get('length') ?? 7);
/** How long each muse is on (s). */
const SLOT = LENGTH / ORDER.length;
/** The gait (cycles of two steps a second): a whole number of steps a muse, near the lab's pace, so every cut falls on a footfall. */
const GAIT = Math.max(1, Math.round(SLOT * 2.2)) / (2 * SLOT);
/** When the walk has come to a stop (over its last step) and the wave begins (s). */
const WAVE_AT = Number(params.get('wave') ?? LENGTH / 2);
const LOOK = params.get('look') !== '0';
/**
 * How hard the camera eases off and onto Muse's front: the power of its curve, u^p / (u^p + (1 − u)^p) of the way
 * round. 1 goes round evenly; 5 (Kai: a very exaggerated one, more time in front) holds within 10° of the front for
 * the first and last 2.3 s and swings the other 340° in the 2.4 s between, behind it at five times the even pace.
 */
const EASE = Number(params.get('ease') ?? 5);
/** The camera: how far from what it looks at (m), how far above it (°), that point's height (m), the lens (° high). */
const LENS = { distance: 2.95, up: 6, at: 0.56, fov: 30 } as const;
/** Toward the light Muse is shaded by (the lab's key: from the front, on its left, a little above), and the floor's shadow's (higher, from the same side). */
const SUN = new Vector3(0.25, 0.45, 1).normalize();
const SHADOW_SUN = new Vector3(0.3, 1.25, 0.95).normalize();

// ---- the renderer ----

const canvas = document.querySelector<HTMLCanvasElement>('#lab');
if (!canvas) throw new Error('museLab.html is missing #lab');
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Number(params.get('dpr') ?? Math.min(devicePixelRatio, 2)));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.autoClear = false;
registerShaderChunks();
const scene = new Scene();

/** A soft round shade (a radial gradient), drawn once. */
function shade(inner: string, outer: string, size = 256): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d canvas');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ---- the floor: the white going on for ever, only the shadows on it ----

{
  const floor = new Mesh(new PlaneGeometry(14, 14), new ShadowMaterial({ color: 0x4a3f36, opacity: 0.2, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = -2;
  scene.add(floor);
  // (and where it stands, a soft shade, as in the lineup)
  const contact = new Mesh(new PlaneGeometry(0.86, 0.62), new MeshBasicMaterial({ map: shade('rgba(110,98,86,0.34)', 'rgba(110,98,86,0)'), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.001;
  contact.renderOrder = -1;
  scene.add(contact);
}
const shadowLight = new DirectionalLight(0xffffff, 1);
shadowLight.castShadow = true;
shadowLight.shadow.mapSize.set(2048, 2048);
shadowLight.shadow.camera.left = -1.2;
shadowLight.shadow.camera.right = 1.2;
shadowLight.shadow.camera.top = 1.2;
shadowLight.shadow.camera.bottom = -1.2;
shadowLight.shadow.camera.near = 0.5;
shadowLight.shadow.camera.far = 12;
shadowLight.shadow.bias = -0.0004;
shadowLight.shadow.normalBias = 0.01;
shadowLight.shadow.radius = 3;
shadowLight.target.position.set(0, 0.4, 0);
scene.add(shadowLight, shadowLight.target);

// ---- the muses, each with a skeleton of its own, and the shadow its skin casts ----

interface Turn {
  kind: SculptKind | DressedKind;
  rig: MuseRig;
  uniforms: Record<string, IUniform>;
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  caster: Mesh;
}

/** A muse's body in Muse's shaders, at the middle, as the lineup draws one (both sides: a garment is often one sheet), and its shadow's caster. */
function turnOf(kind: SculptKind | DressedKind, body: MuseMesh, paint: Parameters<typeof dressMuse>[3], grade: Vector3): Turn {
  const rig = new MuseRig(fitOf(kind, body));
  const g = new InstancedBufferGeometry();
  g.setIndex(new BufferAttribute(body.index, 1));
  const attributes: [string, ArrayLike<number> | undefined, number][] = [
    ['position', body.position, 3],
    ['normal', body.normal, 3],
    ['skinIndex', body.skinIndex, 4],
    ['skinWeight', body.skinWeight, 4],
    ['aFur', body.fur, 1],
    ['aOpen', body.open, 1],
    ['aColour', body.colour, 3],
    ['aRaise', body.raise, 3],
    ['aRaiseNormal', body.raiseNormal, 3],
    ['aRaiseOpen', body.raiseOpen, 1],
    ['aHang', body.hang, 3],
    ['aHangNormal', body.hangNormal, 3],
    ['aComb', body.comb, 3],
  ];
  for (const [name, array, size] of attributes) if (array) g.setAttribute(name, new BufferAttribute(array as Float32Array, size));
  g.instanceCount = SHELLS + 1;
  const defines: Record<string, number> = { MUSE_STUDIO: 1 };
  if (body.colour) defines.MUSE_COLOURED = 1;
  if (body.raise && body.raiseNormal && body.raiseOpen) defines.MUSE_RAISE = 1;
  if (body.hang && body.hangNormal) defines.MUSE_HANG = 1;
  if (body.comb) defines.MUSE_COMB = 1;
  const uniforms: Record<string, IUniform> = {
    uBones: { value: rig.skin },
    uBoneDQ: { value: rig.dual },
    uMusePos: { value: new Vector3() },
    uMuseFrame: { value: new Matrix3() },
    uMuseSize: { value: new Vector4(1, FUR_LENGTH / MUSE_HEIGHT, SHELLS, 0) },
    uMuseWind: { value: new Vector4() },
    uMuseFace: { value: new Vector4(1, 0, 0, 0) },
    uMuseMood: { value: new Vector4() },
    uMuseFluff: { value: rig.fluff },
    uMuseGrade: { value: grade },
    uMuseRaise: { value: new Vector4(0, 0, 1, 1) },
    uStudioSun: { value: SUN },
    uSunDir: { value: SUN },
    uSunTint: { value: new Color(1, 1, 1) },
    uShadeTint: { value: new Color(1, 1, 1) },
    uToon: { value: new Vector4(3, 0.08, 0.6, 0) },
    uWarpFocus: { value: new Vector3() },
    uWarpUp: { value: new Vector3(0, 1, 0) },
    uWarpK: { value: 0 },
    uTime: { value: 0 },
    uRadius: { value: 128 },
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentShader.replace(/}\s*$/, '  #include <colorspace_fragment>\n}\n'),
    defines,
    uniforms,
  });
  dressMuse(g, material, body, paint);
  material.side = DoubleSide;
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  // its shadow: its skin alone, skinned as it is drawn and a little out into its fur, into the light's map (not drawn)
  const s = new InstancedBufferGeometry();
  s.setIndex(g.getIndex());
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight', 'aFur']) s.setAttribute(name, g.getAttribute(name));
  s.instanceCount = 1;
  const caster = new Mesh(s, new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  caster.frustumCulled = false;
  caster.castShadow = true;
  caster.visible = false;
  caster.customDepthMaterial = new ShaderMaterial({
    uniforms: { uBones: uniforms.uBones, uMusePos: uniforms.uMusePos, uMuseFrame: uniforms.uMuseFrame, uMuseSize: uniforms.uMuseSize },
    vertexShader: /* glsl */ `
      uniform mat4 uBones[13];
      uniform vec3 uMusePos;
      uniform mat3 uMuseFrame;
      uniform vec4 uMuseSize;
      attribute vec4 skinIndex;
      attribute vec4 skinWeight;
      attribute float aFur;
      void main() {
        mat4 skin = uBones[int(skinIndex.x)] * skinWeight.x + uBones[int(skinIndex.y)] * skinWeight.y + uBones[int(skinIndex.z)] * skinWeight.z + uBones[int(skinIndex.w)] * skinWeight.w;
        vec3 p = (skin * vec4(position, 1.0)).xyz;
        vec3 n = normalize(mat3(skin) * normal);
        vec3 world = uMusePos + uMuseFrame * (p * uMuseSize.x + n * uMuseSize.y * aFur * 0.6);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`,
  });
  scene.add(caster);
  return { kind, rig, uniforms, mesh, caster };
}

// (each kind loaded and rigged once, in workers of their own, all at once; one in the order twice shares its body)
const kinds = [...new Set(ORDER)];
const turns = new Map<SculptKind | DressedKind, Turn>();
await Promise.all(
  kinds.map(async (kind) => {
    const loaded = await loadSculpt(kind);
    turns.set(kind, turnOf(kind, loaded.body, loaded.paint, loaded.grade));
  }),
);

// ---- the camera: once round, from its right, behind it, round its left, eased off and onto its front ----

const camera = new PerspectiveCamera(LENS.fov, innerWidth / innerHeight, 0.05, 40);
const held = params.get('cam')?.split(',').map(Number);
/** How far round its front the camera is at a time (rad, + to its left): 0 at both ends, all the way round its right first, eased (EASE). */
function roundAt(t: number): number {
  if (held && held.length >= 1) return (held[0] * Math.PI) / 180;
  const u = Math.max(0, Math.min(1, t / LENGTH));
  const a = u ** EASE;
  const b = (1 - u) ** EASE;
  return (-2 * Math.PI * a) / (a + b);
}
function aim(t: number): void {
  const r = roundAt(t);
  const e = ((held?.[1] ?? LENS.up) * Math.PI) / 180;
  const d = held?.[2] ?? LENS.distance;
  camera.position.set(d * Math.cos(e) * Math.sin(r), LENS.at + d * Math.sin(e), d * Math.cos(e) * Math.cos(r));
  camera.lookAt(0, LENS.at, 0);
}

// ---- a moment ----

/** Whose turn it is at a time: the place in the order. */
function turnAt(t: number): number {
  return Math.max(0, Math.min(ORDER.length - 1, Math.floor(t / SLOT + 1e-6)));
}
/** How much it turns to you (0 … 1): while the camera is near its front, at either end. */
function glanceAt(t: number): number {
  if (!LOOK) return 0;
  const r = Math.atan2(Math.sin(roundAt(t)), Math.cos(roundAt(t)));
  return 1 - smoothstep(0.45, 1.2, Math.abs(r));
}

/** Pose a muse at a time: walking on the spot until its last step brings it to a stop, then waving; turned to you while the camera is in front. */
function pose(m: Turn, t: number): void {
  const walk = 1 - smoothstep(WAVE_AT - 1 / (2 * GAIT), WAVE_AT, t);
  const r = roundAt(t);
  const yaw = Math.atan2(Math.sin(r), Math.cos(r));
  const glance = glanceAt(t);
  // (its head and chest turn 0.9 of the look between them, museRig.ts lookPose: to look at the camera, ask for a ninth more)
  const pitch = Math.atan2(camera.position.y - 0.78, Math.hypot(camera.position.x, camera.position.z));
  m.rig.pose({ time: t, walk, stride: 1, gait: t * GAIT, wave: t >= WAVE_AT ? t - WAVE_AT : -1, lookYaw: yaw / 0.9, lookPitch: pitch, look: glance, moves: [] });
  // happy eyes (∩) as it waves to you at the end, once the camera has come round in front
  const happy = glance * smoothstep(WAVE_AT + 0.9, WAVE_AT + 1.5, t);
  if (happy > 0) {
    m.rig.squint += (1 - m.rig.squint) * happy;
    m.rig.blush += (0.35 - m.rig.blush) * happy;
  }
  const u = m.uniforms;
  (u.uMuseFace.value as Vector4).set(m.rig.eyes, m.rig.smile, m.rig.squint, m.rig.squeeze);
  (u.uMuseMood.value as Vector4).set(m.rig.blush, 0, 0, 0);
  (u.uMuseRaise.value as Vector4).set(m.rig.raised, m.rig.raisedRight, m.rig.hung, m.rig.hungRight);
  u.uTime.value = t;
}

// ---- drawing: a moment averaged over the shutter, the light moved a little, the view over a pixel ----

let sampleTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
let sumTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
const quad = new Mesh(new PlaneGeometry(2, 2));
const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const passVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;
const addMaterial = new ShaderMaterial({
  uniforms: { tSample: { value: null }, uWeight: { value: 1 } },
  vertexShader: passVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSample;
    uniform float uWeight;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tSample, vUv) * uWeight; }`,
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  depthTest: false,
  depthWrite: false,
});
const outMaterial = new ShaderMaterial({
  uniforms: { tSum: { value: null } },
  vertexShader: passVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSum;
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(texture2D(tSum, vUv).rgb, 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
});
function fit(): void {
  const w = Math.round(innerWidth * renderer.getPixelRatio());
  const h = Math.round(innerHeight * renderer.getPixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  if (sampleTarget.width !== w || sampleTarget.height !== h) {
    sampleTarget.dispose();
    sumTarget.dispose();
    sampleTarget = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 });
    sumTarget = new WebGLRenderTarget(w, h, { type: HalfFloatType });
  }
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
fit();
addEventListener('resize', fit);
/** The ith point of a base's Halton sequence, in [0, 1). */
function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  for (let n = i + 1; n > 0; n = Math.floor(n / base)) {
    f /= base;
    r += f * (n % base);
  }
  return r;
}
const white = new Color(1, 1, 1);
const side = new Vector3();
const lift = new Vector3();
/** Draw the moment t: the muse whose turn it is, `samples` renders over the shutter (s) about t, each with the light and the view moved a little, averaged. */
function frame(t: number, samples = 1, shutter = 0): void {
  fit();
  const now = turns.get(ORDER[turnAt(t)]);
  for (const m of turns.values()) m.mesh.visible = m.caster.visible = m === now;
  renderer.setRenderTarget(sumTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  const w = sampleTarget.width;
  const h = sampleTarget.height;
  for (let i = 0; i < samples; i++) {
    const s = samples > 1 ? (i + 0.5) / samples - 0.5 : 0;
    const at = t + s * shutter;
    aim(at);
    if (now) pose(now, at);
    // the shadow's light from somewhere over a small disc (a soft edge), the view by a fraction of a pixel
    const jx = samples > 1 ? halton(i, 2) - 0.5 : 0;
    const jy = samples > 1 ? halton(i, 3) - 0.5 : 0;
    const a = samples > 1 ? halton(i, 5) * Math.PI * 2 : 0;
    const r = samples > 1 ? 0.13 * Math.sqrt(halton(i, 7)) : 0;
    side.set(-SHADOW_SUN.z, 0, SHADOW_SUN.x).normalize();
    lift.crossVectors(SHADOW_SUN, side).normalize();
    shadowLight.position
      .copy(shadowLight.target.position)
      .addScaledVector(SHADOW_SUN, 6)
      .addScaledVector(side, 6 * r * Math.cos(a))
      .addScaledVector(lift, 6 * r * Math.sin(a));
    if (samples > 1) camera.setViewOffset(w, h, jx, jy, w, h);
    else camera.clearViewOffset();
    renderer.setRenderTarget(sampleTarget);
    renderer.setClearColor(white, 1);
    renderer.clear();
    renderer.render(scene, camera);
    addMaterial.uniforms.tSample.value = sampleTarget.texture;
    addMaterial.uniforms.uWeight.value = 1 / samples;
    quad.material = addMaterial;
    renderer.setRenderTarget(sumTarget);
    renderer.render(quad, quadCamera);
  }
  camera.clearViewOffset();
  outMaterial.uniforms.tSum.value = sumTarget.texture;
  quad.material = outMaterial;
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(quad, quadCamera);
}

// ---- playing it, and the hooks for scripts ----

const api = {
  length: LENGTH,
  order: ORDER,
  slot: SLOT,
  gait: GAIT,
  wave: WAVE_AT,
  frame,
  /** Whose turn it is at a time (its kind), and how far round the camera is (°). */
  at: (t: number) => ({ kind: ORDER[turnAt(t)], round: (roundAt(t) * 180) / Math.PI }),
};
(window as unknown as { museParade: typeof api }).museParade = api;
if (params.get('live') === '1') {
  let t = Number(params.get('t') ?? 0);
  let paused = false;
  let last = performance.now();
  addEventListener('keydown', (event) => {
    if (event.key === ' ') paused = !paused;
    else if (event.key === 'ArrowRight') t += event.shiftKey ? 0.5 : 1 / 30;
    else if (event.key === 'ArrowLeft') t = Math.max(0, t - (event.shiftKey ? 0.5 : 1 / 30));
    else return;
    event.preventDefault();
  });
  renderer.setAnimationLoop((time) => {
    if (!paused) t += Math.min(0.1, (time - last) / 1000);
    last = time;
    if (t >= LENGTH) t = 0;
    frame(t, 1);
  });
} else frame(Number(params.get('t') ?? 0), Number(params.get('samples') ?? 1), 0.5 / 30);
(window as unknown as { museLabReady: boolean }).museLabReady = true;
