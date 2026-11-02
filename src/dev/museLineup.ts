import {
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Ray,
  Scene,
  ShaderMaterial,
  Sphere,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderer,
  type IUniform,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { smoothstep } from '../core/math';
import { FUR_LENGTH, MUSE_HEIGHT, SHELLS } from '../life/muse';
import { JOINT } from '../life/museBody';
import { Answers } from '../life/museLife';
import { DRESSED, SCULPTS, type DressedKind, type MuseMesh, type SculptKind } from '../life/museMesh';
import { BOUNCE_LENGTH, FLUFF_LENGTH, MuseRig, YAWN_LENGTH, type Move, type MoveKind } from '../life/museRig';
import { loadSculpt } from '../life/museSculptLoader';
import fragmentShader from '../life/muse.frag.glsl?raw';
import vertexShader from '../life/muse.vert.glsl?raw';
import { registerShaderChunks } from '../render/glsl';

// The muses in two rows of seven (museLab.html#lineup=1): the original Muse
// (tpose6, as in the meadow) and the muses in clothes (museMesh.ts DRESSED,
// rigged as Muse is), in reading order, the back row first and staggered
// half a place so its faces show between the front row's heads, as in a
// class photo. On white in the lab's soft studio light, each one
// standing at its ease on a clock of its own (breathing, blinking, its weight
// going from foot to foot, glancing about) and now and then doing what it
// does when it has nothing to do (a yawn, its fur shaken out, a little hop,
// a look round), each at its own seeded times. Click one and it waves (the
// first time in a while) or bounces for joy; hold it to pet it (its eyes
// squeezed shut, hearts; held longer, its fur stands up and it shakes it out
// when you let go). It turns to you while it answers. Drag to turn round the
// rows, the wheel to come close. Keys: space pauses, F fur, C clay, K fur and
// cloth. Everything is in Muse's heights (one tall); a hat reaches above.
// window.museLineup: tap(i), hold(i, side), letGo(i), where(i) for scripts, i
// a place in the rows (0 the original Muse) or a muse's name ('muse5').

const KINDS: readonly (SculptKind | DressedKind)[] = ['tpose6', ...(Object.keys(DRESSED) as DressedKind[])];
/** The rows: how many stand in each, how far apart (H), and how far behind the front row the back one stands (H). */
const COLUMNS = 7;
const SPACING = 0.98;
const ROWS = 1.35;
/**
 * Where the muse at a place stands (H): the back row first, staggered half a place, and spread by its distance
 * from the camera against the front row's, so on the screen it stands between the front row's muses all along
 * (seen in perspective, the back row's places close in toward the middle).
 */
function place(i: number, camera: number): { x: number; z: number } {
  const rows = Math.ceil(KINDS.length / COLUMNS);
  const row = Math.floor(i / COLUMNS);
  const col = i % COLUMNS;
  const z = (row - (rows - 1) / 2) * ROWS;
  const front = ((rows - 1) / 2) * ROWS;
  const stagger = row % 2 === 0 ? -0.25 : 0.25;
  return { x: (col - (COLUMNS - 1) / 2 + stagger) * SPACING * ((camera - z) / (camera - front)), z };
}
/** What each does now and then when it has nothing to do (museRig.ts moves; 'look' a long look round), and how often (s, seeded about it). */
const HABITS: readonly { kind: MoveKind | 'look'; every: number }[] = [
  { kind: 'look', every: 13 },
  { kind: 'fluff', every: 17 },
  { kind: 'bounce', every: 15 },
  { kind: 'yawn', every: 19 },
  { kind: 'fluff', every: 14 },
  { kind: 'yawn', every: 16 },
  { kind: 'look', every: 12 },
  { kind: 'bounce', every: 18 },
  { kind: 'fluff', every: 15 },
  { kind: 'look', every: 11 },
  { kind: 'yawn', every: 12 },
  { kind: 'bounce', every: 16 },
  { kind: 'fluff', every: 13 },
  { kind: 'look', every: 14 },
];
const HABIT_LENGTH: Record<string, number> = { look: 3.2, fluff: FLUFF_LENGTH, bounce: BOUNCE_LENGTH, yawn: YAWN_LENGTH };
/** Its spheres (its own frame: joint, offset up from it, radius) for picking it, as on the lab's stage. */
const BODY: readonly [number, number, number][] = [
  [JOINT.pelvis, 0.06, 0.21],
  [JOINT.spine, 0.02, 0.26],
  [JOINT.chest, 0.04, 0.24],
  [JOINT.head, 0.09, 0.25],
  [JOINT.legL, -0.08, 0.08],
  [JOINT.legR, -0.08, 0.08],
];
/** A hash of an integer and a seed, 0 … 1. */
function hash(k: number, seed: number): number {
  const h = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** A sprite's glyph (a heart), drawn once on a canvas: filled, outlined in white. */
function glyph(text: string, fill: string, size = 128): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d canvas');
  g.font = `bold ${Math.round(size * 0.78)}px "Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.09;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.strokeText(text, size / 2, size * 0.54);
  g.fillStyle = fill;
  g.fillText(text, size / 2, size * 0.54);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft round shade on the floor (a radial gradient), or the floor's own fall-off. */
function shade(inner: string, outer: string, size = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d canvas');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** One muse in the row: its rig, its body's material, its answers to you and its place. */
interface Standing {
  kind: SculptKind | DressedKind;
  rig: MuseRig;
  uniforms: Record<string, IUniform>;
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  answers: Answers;
  x: number;
  z: number;
  /** Its clock's offset (s) and seed. */
  offset: number;
  seed: number;
  hearts: Sprite[];
  petted: number;
}

/** A muse's body as a mesh in Muse's shaders (as the lab draws one), at its place: its paint graded (the original's to the reference's cream). */
function standing(kind: SculptKind | DressedKind, body: MuseMesh, paint: Texture | null, grade: Vector3, at: { x: number; z: number }, seed: number, sun: Vector3): Standing {
  const fit = body.fit ?? (kind in DRESSED ? DRESSED[kind as DressedKind].fit : SCULPTS[kind as SculptKind].fit);
  const rig = new MuseRig(fit);
  const g = new InstancedBufferGeometry();
  g.setIndex(new BufferAttribute(body.index, 1));
  g.setAttribute('position', new BufferAttribute(body.position, 3));
  g.setAttribute('normal', new BufferAttribute(body.normal, 3));
  g.setAttribute('skinIndex', new BufferAttribute(body.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(body.skinWeight, 4));
  g.setAttribute('aFur', new BufferAttribute(body.fur, 1));
  g.setAttribute('aOpen', new BufferAttribute(body.open, 1));
  g.setAttribute('aColour', new BufferAttribute(body.colour, 3));
  const defines: Record<string, number> = { MUSE_STUDIO: 1, MUSE_COLOURED: 1 };
  if (body.raise && body.raiseNormal && body.raiseOpen) {
    g.setAttribute('aRaise', new BufferAttribute(body.raise, 3));
    g.setAttribute('aRaiseNormal', new BufferAttribute(body.raiseNormal, 3));
    g.setAttribute('aRaiseOpen', new BufferAttribute(body.raiseOpen, 1));
    defines.MUSE_RAISE = 1;
  }
  if (body.hang && body.hangNormal) {
    g.setAttribute('aHang', new BufferAttribute(body.hang, 3));
    g.setAttribute('aHangNormal', new BufferAttribute(body.hangNormal, 3));
    defines.MUSE_HANG = 1;
  }
  if (body.comb) {
    g.setAttribute('aComb', new BufferAttribute(body.comb, 3));
    defines.MUSE_COMB = 1;
  }
  if (body.cloth && body.uv && paint) {
    g.setAttribute('aCloth', new BufferAttribute(body.cloth, 1));
    g.setAttribute('uv', new BufferAttribute(body.uv, 2));
    defines.MUSE_PAINTED = 1;
  }
  if (body.features) defines.MUSE_FEATURES = 1;
  // (the lab's looks: K colours fur, cloth and face, as museLab.ts does)
  const n = body.position.length / 3;
  const kinds = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = body.cloth ? body.cloth[i] : 0;
    const face = body.fur[i] < 0.03 && k < 0.5 && body.position[i * 3 + 2] > 0.05 && body.position[i * 3 + 1] > 0.55;
    kinds.set(face ? [0.95, 0.55, 0.65] : [0.93 - 0.63 * k, 0.88 - 0.38 * k, 0.78 + 0.12 * k], i * 3);
  }
  g.setAttribute('aWeightColour', new BufferAttribute(kinds, 3));
  g.instanceCount = SHELLS + 1;
  const f = body.features;
  const uniforms: Record<string, IUniform> = {
    uBones: { value: rig.skin },
    uBoneDQ: { value: rig.dual },
    uMusePos: { value: new Vector3(at.x, 0, at.z) },
    uMuseFrame: { value: new Matrix3() },
    uMuseSize: { value: new Vector4(1, FUR_LENGTH / MUSE_HEIGHT, SHELLS, 0) },
    uMuseWind: { value: new Vector4() },
    uMuseFace: { value: new Vector4(1, 0, 0, 0) },
    uMuseMood: { value: new Vector4() },
    uMuseFluff: { value: rig.fluff },
    uMuseGrade: { value: grade },
    uMuseRaise: { value: new Vector4(0, 0, 1, 1) },
    uStudioSun: { value: sun },
    uSunDir: { value: sun },
    uSunTint: { value: new Color(1, 1, 1) },
    uShadeTint: { value: new Color(1, 1, 1) },
    uToon: { value: new Vector4(3, 0.08, 0.6, 0) },
    uWarpFocus: { value: new Vector3() },
    uWarpUp: { value: new Vector3(0, 1, 0) },
    uWarpK: { value: 0 },
    uTime: { value: 0 },
    uRadius: { value: 128 },
    uMusePaint: { value: paint },
    uMuseEyeAt: { value: new Vector3(...(f?.eye ?? [0, 0, 0])) },
    uMuseMouthAt: { value: new Vector4(...(f?.mouth ?? [0, 0, 0, 0])) },
    uMuseBlushAt: { value: new Vector3(...(f?.blush ?? [0, 0, 0])) },
    uMuseFaceAt: { value: new Vector4(...(f?.plate ?? [0, 0, 0, 0])) },
  };
  // (both sides: a garment is often a single sheet, an apron or a collar, whose back would show the sky through it)
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentShader.replace(/}\s*$/, '  #include <colorspace_fragment>\n}\n'),
    defines,
    uniforms,
    side: DoubleSide,
  });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  return { kind, rig, uniforms, mesh, answers: new Answers(), x: at.x, z: at.z, offset: seed * 7.3, seed, hearts: [], petted: -1 };
}

/** A look round (yaw, pitch, rad) at a time on a muse's clock: a new place every few seconds, turned to quickly, held. */
function glance(t: number, seed: number, out: number[]): void {
  const period = 4.5 + 2.5 * hash(seed, 3);
  const k = Math.floor(t / period);
  const u = t / period - k;
  const e = smoothstep(0, 0.16, u);
  const target = (j: number): number[] => [0.55 * (hash(j, seed + 1) - 0.5), 0.12 * (hash(j, seed + 2) - 0.35)];
  const [a, b] = [target(k - 1), target(k)];
  out[0] = a[0] + e * (b[0] - a[0]);
  out[1] = a[1] + e * (b[1] - a[1]);
}

/** A muse's habit at a time on its clock: the one under way (its start, s), if any. */
function habitAt(t: number, i: number): number {
  const every = HABITS[i % HABITS.length].every;
  const k = Math.floor(t / every);
  const start = k * every + 2 + (every - 6) * hash(k, i + 11);
  return t >= start && t < start + HABIT_LENGTH[HABITS[i % HABITS.length].kind] ? start : -1;
}

/** How far above the rows the camera looks down at them (rad). */
const RAISE = 0.31;

registerShaderChunks();
const canvas = document.querySelector<HTMLCanvasElement>('#lab');
if (!canvas) throw new Error('museLab.html is missing #lab');
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(new Color(1, 1, 1));
const scene = new Scene();
const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 60);
/** Far enough back to see every row across the window, and high enough to see the back row over the front one. */
const fit = (): void => {
  const front = ((Math.ceil(KINDS.length / COLUMNS) - 1) / 2) * ROWS;
  const half = (COLUMNS / 2 + 0.25) * SPACING + 0.15;
  const across = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
  const far = Math.max(4, half / Math.tan(across) + front);
  camera.position.set(0, 0.5 + Math.tan(RAISE) * far, far);
};
fit();
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 1.4;
controls.maxDistance = 22;
controls.update();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
// a big soft key from the front, a little left and above, as the lab's
const sun = new Vector3(0.25, 0.45, 1).normalize();

// the floor: white fading out at its edge, a soft shade under each muse
const floor = new Mesh(new PlaneGeometry(24, 14), new MeshBasicMaterial({ map: shade('#f3f0eb', '#ffffff'), depthWrite: false }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.001;
floor.renderOrder = -2;
scene.add(floor);
const blob = new MeshBasicMaterial({ map: shade('rgba(120,110,100,0.38)', 'rgba(120,110,100,0)'), transparent: true, depthWrite: false });
const heart = new SpriteMaterial({ map: glyph('♥', '#f2789c'), transparent: true, depthWrite: false });

// the muses, each as soon as it is rigged (in a worker of its own)
const muses: Standing[] = [];
const legend = document.createElement('div');
legend.style.cssText = 'position:fixed;left:12px;bottom:10px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#555;white-space:pre;pointer-events:none';
document.body.append(legend);
let look = 'muse';
const setLook = (m: Standing): void => {
  const d = m.mesh.material.defines as Record<string, number>;
  delete d.MUSE_CLAY;
  delete d.MUSE_WEIGHTS;
  if (look === 'clay') d.MUSE_CLAY = 1;
  if (look === 'kind') d.MUSE_WEIGHTS = 1;
  m.mesh.material.needsUpdate = true;
  m.mesh.geometry.instanceCount = look === 'muse' ? SHELLS + 1 : 1;
};
const loading = KINDS.map(async (kind, i) => {
  const at = place(i, camera.position.z);
  const loaded = await loadSculpt(kind);
  const m = standing(kind, loaded.body, loaded.paint, loaded.grade, at, i, sun);
  scene.add(m.mesh);
  const shadow = new Mesh(new PlaneGeometry(0.78, 0.5), blob);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(at.x, 0.001, at.z + 0.02);
  shadow.renderOrder = -1;
  scene.add(shadow);
  m.hearts = Array.from({ length: 3 }, () => {
    const s = new Sprite(heart.clone());
    s.scale.setScalar(0.11);
    s.visible = false;
    scene.add(s);
    return s;
  });
  setLook(m);
  muses[i] = m;
});

// ---- your doings: a press on a muse (a tap, or held: petting) ----
let now = 0;
let paused = false;
let pressed: Standing | null = null;
const ray = new Ray();
const ball = new Sphere();
const hit = new Vector3();
const point = new Vector3();
const joints = new Float32Array(13 * 3);
/** The muse under a point on the canvas (and which of its sides, +1 its own left), if any. */
const pick = (clientX: number, clientY: number): { muse: Standing; side: number } | null => {
  const r = canvas.getBoundingClientRect();
  point.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
  ray.origin.copy(camera.position);
  ray.direction.copy(point.sub(camera.position)).normalize();
  let best: { muse: Standing; side: number; d: number } | null = null;
  for (const m of muses) {
    if (!m) continue;
    m.rig.joints(joints);
    for (const [j, dy, radius] of BODY) {
      ball.center.set(m.x + joints[j * 3], joints[j * 3 + 1] + dy, m.z + joints[j * 3 + 2]);
      ball.radius = radius * 1.05;
      if (!ray.intersectSphere(ball, hit)) continue;
      const d = hit.distanceTo(camera.position);
      if (!best || d < best.d) best = { muse: m, side: hit.x >= m.x ? 1 : -1, d };
    }
  }
  return best;
};
const press = (m: Standing, side: number): void => {
  pressed = m;
  m.answers.hold(now, side, false);
};
const release = (): void => {
  if (!pressed) return;
  pressed.answers.letGo(now, false);
  pressed = null;
};
canvas.addEventListener('pointerdown', (event) => {
  const found = pick(event.clientX, event.clientY);
  if (!found) return;
  controls.enabled = false;
  canvas.setPointerCapture(event.pointerId);
  press(found.muse, found.side);
});
const up = (event: PointerEvent): void => {
  if (!pressed) return;
  controls.enabled = true;
  canvas.releasePointerCapture(event.pointerId);
  release();
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointermove', (event) => {
  if (!pressed) canvas.style.cursor = pick(event.clientX, event.clientY) ? 'pointer' : '';
});
addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const looks: Record<string, string> = { f: 'muse', c: 'clay', k: 'kind' };
  if (key === ' ') paused = !paused;
  else if (key in looks) {
    look = looks[key];
    for (const m of muses) if (m) setLook(m);
  } else return;
  event.preventDefault();
});

// ---- each frame: each muse at its ease, its answers over that ----
const aim = [0, 0];
const toCamera = new Vector3();
const pose = (m: Standing, i: number, t: number): void => {
  const clock = t + m.offset;
  const moves: Move[] = [];
  const action = { time: clock, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 1, moves };
  glance(clock, m.seed, aim);
  [action.lookYaw, action.lookPitch] = aim;
  // its habit, while it is not answering you
  // (while you hold it its attention has no end, and Answers.attending reads it as NaN: turned to you, wholly)
  const turned = m.answers.attending(t);
  const attending = Number.isNaN(turned) ? 1 : turned;
  const habit = HABITS[i % HABITS.length];
  const start = attending > 0 ? -1 : habitAt(clock, i);
  if (start >= 0) {
    const u = clock - start;
    if (habit.kind === 'look') {
      // a long look round, over its shoulder and back
      const s = Math.sin((Math.PI * u) / HABIT_LENGTH.look);
      action.lookYaw = (hash(Math.floor(start), i) > 0.5 ? 1 : -1) * 0.95 * s * s;
      action.lookPitch = 0.08 * s;
    } else moves.push({ kind: habit.kind, time: u, amount: 1 });
  }
  const cues = { sleep: null, petted: -1 };
  const toYou = m.answers.apply(t, action, cues);
  m.petted = cues.petted;
  if (toYou || attending > 0) {
    // turned to you: its head toward the camera
    toCamera.copy(camera.position).sub(new Vector3(m.x, 0.75, m.z));
    const yaw = Math.atan2(toCamera.x, toCamera.z);
    const pitch = Math.atan2(toCamera.y, Math.hypot(toCamera.x, toCamera.z));
    action.lookYaw += (yaw - action.lookYaw) * attending;
    action.lookPitch += (pitch - action.lookPitch) * attending;
  }
  m.rig.pose(action);
  m.answers.settle(t);
  const u = m.uniforms;
  (u.uMuseFace.value as Vector4).set(m.rig.eyes, m.rig.smile, m.rig.squint, m.rig.squeeze);
  (u.uMuseMood.value as Vector4).set(m.rig.blush, 0, 0, 0);
  (u.uMuseRaise.value as Vector4).set(m.rig.raised, m.rig.raisedRight, m.rig.hung, m.rig.hungRight);
  u.uTime.value = t;
  // hearts while you pet it
  m.rig.joints(joints);
  m.hearts.forEach((s, k) => {
    const v = (((t / 1.6 + k / 3) % 1) + 1) % 1;
    s.visible = m.petted > 0.4;
    s.position.set(m.x + joints[JOINT.head * 3] + 0.2 * Math.sin(k * 2.1 + v * 2), joints[JOINT.head * 3 + 1] + 0.42 + 0.42 * v, m.z + 0.08);
    s.material.opacity = Math.sin(Math.PI * v) * smoothstep(0.4, 0.8, m.petted);
  });
};

let last = performance.now();
renderer.setAnimationLoop((time) => {
  const dt = paused ? 0 : Math.min(0.1, (time - last) / 1000);
  last = time;
  now += dt;
  muses.forEach((m, i) => m && pose(m, i, now));
  const ready = muses.filter(Boolean).length;
  legend.textContent = `the muses · ${ready} of ${KINDS.length}${paused ? ' · paused' : ''}\nclick one: it waves, or bounces for joy · hold: pet it (longer: its fur stands up)   space pause  F fur  C clay  K fur and cloth   drag to turn, wheel to come close`;
  controls.update();
  renderer.render(scene, camera);
});

// for scripts: press and let go of a muse by its place in the rows or its name, and where one is on the screen
const at = (k: number | string): number => (typeof k === 'string' ? KINDS.indexOf(k as SculptKind | DressedKind) : k);
const where = (k: number | string): { x: number; y: number } | null => {
  const m = muses[at(k)];
  if (!m) return null;
  m.rig.joints(joints);
  const p = new Vector3(m.x + joints[JOINT.chest * 3], joints[JOINT.chest * 3 + 1], m.z + joints[JOINT.chest * 3 + 2]).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
};
Object.assign(window, {
  museLineup: {
    kinds: KINDS,
    muses,
    // (a press let go at once: a tap)
    tap: (k: number | string) => {
      const m = muses[at(k)];
      if (!m) return;
      press(m, 1);
      release();
    },
    hold: (k: number | string, side = 1) => muses[at(k)] && press(muses[at(k)], side),
    letGo: () => release(),
    where,
    clock: () => now,
    pause: (on: boolean) => {
      paused = on;
    },
  },
});
await Promise.all(loading);
(window as unknown as { museLabReady: boolean }).museLabReady = true;
