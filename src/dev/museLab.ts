import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  InstancedBufferGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshStandardMaterial,
  Matrix3,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { smoothstep } from '../core/math';
import { FUR_LENGTH, MUSE_HEIGHT, SHELLS } from '../life/muse';
import { buildMuseBody, FIELD_FIT, PARENT, type MuseBody, type MuseFit } from '../life/museBody';
import { SCULPTS, type SculptKind } from '../life/museMesh';
import { loadSculpt } from '../life/museSculptLoader';
import fragmentShader from '../life/muse.frag.glsl?raw';
import vertexShader from '../life/muse.vert.glsl?raw';
import { BOUNCE_LENGTH, FISH, FLUFF_LENGTH, GARDEN, COOK, HOP, LIE_BACK, MuseRig, PET, PLOP, RISE, WAKE, WAVE_LENGTH, YAWN_LENGTH, type Move, type MoveKind } from '../life/museRig';
import { registerShaderChunks } from '../render/glsl';

// The Muse lab (dev only, served at /src/dev/museLab.html): Muse alone on
// white in a soft studio light, framed exactly as the front reference
// (reference/muse/1.webp: 1504 × 1680, Muse 1261 px tall, its feet 1438 px
// down and its middle 799.5 px across), so the two can be laid side by side
// and their silhouettes compared. The hash picks the body, the look, the view
// and the moment:
//   model=procedural|sculpt|tpose|tpose2|tpose5|tpose6 (src/assets/muse/sculpt*.glb, rigged on the skeleton by museMesh.ts)
//   look=muse|raw|weights|clay|facet|stretch|rough   (Muse's shaders; the file as exported; each vertex coloured by its joints;
//                           the bare skin in clay; the clay shaded by the triangles as drawn, not the skinned normals;
//                           how much each part of the skin is stretched (red) or squashed (blue) in the pose;
//                           how far each normal of the posed skin turns from its neighbours' (bumps, creases: red))
//   wire=1 (the triangles over it)
//   view=front|left|back|turn:<deg>|persp:<deg>   pose=idle|walk|wave|hang|<move>   t=<s>   gait=<cycles>   fur=0|1   bones=0|1
//   (a move, on the spot: bounce|pet|fluff|yawn|hopup|perch|hopdown|plop|sit|rise|lie|sleep|wake|fish|water|stir; pet is held 3.5 s, then let go)
//   size=<px> (Muse this many pixels tall, as if seen from further off)
//   skin=lbs|dqs (the joints blended as matrices, as Muse is drawn, or as dual quaternions)   raise=0 (without the correctives)
//   hang=<z>,<x>  wave=<z>,<fore>[,<x>,<y>] (other arm angles on the body's fit, rad)   reach=<H> (arms drawn longer)   comb=0 (the fur standing straight)
//   live=1: Muse living its day on its stage (museStage.ts: a lawn with a bench, a pond, flowers and a fire; click it,
//           hold it), the window filled, the camera following it (drag to turn, wheel to come close, right-drag to
//           slide; G stops following). Keys: 1–7 go to a part of its day; space pauses, ← → step (shift: half a
//           second); F fur, C clay, T the triangles as drawn, R rough, S stretch, W weights; X the wire, B the bones.
//           day=<s> starts at that moment of its day, pause=1 holds it there.
//           With a pose (or stage=0), Muse alone on a turntable, the pose played over and over; pose=day plays a little
//           day (stands, waves, waddles on the spot). Keys: 1 idle, 2 walk, 3 wave, 4 day, 0 arms hung
// Muse is one meter tall here; everything is in its heights.

const REF = { width: 1504, height: 1680, tall: 1261, feet: 1438, middle: 799.5 } as const;
/** A colour per joint for the weights view. */
const JOINT_COLOURS = [0x999999, 0xe0b040, 0x60b060, 0x4090d0, 0xd05050, 0xb060c0, 0xe08040, 0x40c0c0, 0x8080e0, 0x70a030, 0xc07090, 0xf0e070, 0x70e0a0];
/** Live, the walk's pace (cycles of two steps a second: about Muse's on the terrace, muse.ts), and the little day's beats (s): standing, then the wave, a breath, the waddle, a breath. */
const GAIT = 1.1;
const DAY = { stand: 3, rest: 1, walk: 4 } as const;
const DAY_LENGTH = DAY.stand + WAVE_LENGTH + DAY.rest + DAY.walk + DAY.rest;

const params = new URLSearchParams(location.hash.slice(1));
const model = params.get('model') ?? 'procedural';
const live = params.get('live') === '1';
let look = params.get('look') ?? 'muse';
const view = params.get('view') ?? 'front';
let pose = params.get('pose') ?? (live ? 'day' : 'idle');
const time = Number(params.get('t') ?? 2);
const fur = params.get('fur') !== '0';
const dual = params.get('skin') === 'dqs';
let bones = params.get('bones') === '1';

const canvas = document.querySelector<HTMLCanvasElement>('#lab');
if (!canvas) throw new Error('museLab.html is missing #lab');
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.outputColorSpace = SRGBColorSpace;
renderer.setPixelRatio(live ? Math.min(devicePixelRatio, 2) : 1);
// (size=<px>: Muse this many pixels tall, the frame scaled with it, as if seen from further off)
const scale = params.has('size') ? Number(params.get('size')) / REF.tall : 1;
if (live) renderer.setSize(innerWidth, innerHeight);
else renderer.setSize(Math.round(REF.width * scale), Math.round(REF.height * scale), false);
renderer.setClearColor(new Color(1, 1, 1));
registerShaderChunks();
const scene = new Scene();

// (hang=z,x and wave=z,fore try other arm angles on the body's fit, rad)
const sculpt = model in SCULPTS ? (model as SculptKind) : null;
const baseFit: MuseFit = sculpt ? SCULPTS[sculpt].fit : FIELD_FIT;
const angles = (key: string): number[] | null => params.get(key)?.split(',').map(Number) ?? null;
const hang = angles('hang');
const waveAt = angles('wave');
const rig = new MuseRig({
  ...baseFit,
  hang: hang ? { ...baseFit.hang, z: hang[0], x: hang[1] ?? baseFit.hang.x } : baseFit.hang,
  wave: waveAt ? { z: waveAt[0], fore: waveAt[1] ?? baseFit.wave.fore, x: waveAt[2] ?? baseFit.wave.x, y: waveAt[3] ?? baseFit.wave.y } : baseFit.wave,
  reach: params.has('reach') ? Number(params.get('reach')) : baseFit.reach,
});

/** The moves on the spot (museRig.ts), each played over and over live (this long, s); pet is held PET_HOLD s, then let go. */
const PET_HOLD = 3.5;
const MOVES: Record<string, { kind: MoveKind; length: number }> = {
  bounce: { kind: 'bounce', length: BOUNCE_LENGTH + 0.8 },
  pet: { kind: 'pet', length: PET_HOLD + PET.out + 2 },
  fluff: { kind: 'fluff', length: FLUFF_LENGTH + 0.8 },
  yawn: { kind: 'yawn', length: YAWN_LENGTH + 0.8 },
  hopup: { kind: 'hopUp', length: HOP.up + 0.8 },
  perch: { kind: 'perch', length: 15 },
  hopdown: { kind: 'hopDown', length: HOP.down + 0.8 },
  plop: { kind: 'plop', length: PLOP + 0.8 },
  sit: { kind: 'sit', length: 8 },
  rise: { kind: 'rise', length: RISE + 0.8 },
  lie: { kind: 'lieBack', length: LIE_BACK + 0.8 },
  sleep: { kind: 'sleep', length: 13 },
  wake: { kind: 'wake', length: WAKE + 0.8 },
  fish: { kind: 'fish', length: FISH.period },
  water: { kind: 'water', length: GARDEN.period },
  stir: { kind: 'stir', length: COOK.period },
};

/** Pose Muse at a time: a still's moment from the hash; live, its pose played over and over. */
function act(t: number): void {
  let walk = 0;
  let gait = Number(params.get('gait') ?? 0.25);
  let wave = -1;
  const moves: Move[] = [];
  const loop = MOVES[pose];
  if (loop) {
    const u = live ? t % loop.length : t;
    moves.push({ kind: loop.kind, time: u, amount: 1, side: 1, release: loop.kind === 'pet' ? (u > PET_HOLD ? u - PET_HOLD : -1) : undefined });
  }
  if (pose === 'walk') {
    walk = 1;
    if (live) gait = t * GAIT;
  } else if (pose === 'wave') {
    wave = live ? t % (WAVE_LENGTH + 1.5) : t;
  } else if (pose === 'day') {
    // stands, waves, takes a breath, waddles on the spot (easing in and out), takes a breath
    const u = t % DAY_LENGTH;
    const walking = u - DAY.stand - WAVE_LENGTH - DAY.rest;
    if (u >= DAY.stand && u < DAY.stand + WAVE_LENGTH) wave = u - DAY.stand;
    else if (walking >= 0 && walking < DAY.walk) {
      walk = smoothstep(0, 0.5, walking) * (1 - smoothstep(DAY.walk - 0.5, DAY.walk, walking));
      gait = walking * GAIT;
    }
  }
  rig.pose({ time: t, walk, stride: 1, gait, wave, lookYaw: 0, lookPitch: 0, look: 0, moves });
  // (the arms hung and nothing else moving, to compare the two arms)
  if (pose === 'hang') rig.hang();
}
act(time);

async function body(): Promise<{ body: MuseBody & { colour?: Float32Array; raise?: Float32Array; raiseNormal?: Float32Array; raiseOpen?: Float32Array; hang?: Float32Array; hangNormal?: Float32Array; comb?: Float32Array }; grade: Vector3; raw: Mesh | null }> {
  if (!sculpt) return { body: buildMuseBody(), grade: new Vector3(1, 1, 1), raw: null };
  const loaded = await loadSculpt(sculpt);
  return { body: loaded.body, grade: params.get('grade') === '0' ? new Vector3(1, 1, 1) : loaded.grade, raw: loaded.raw };
}

const { body: b, grade, raw } = await body();

/** The rigged body's geometry and materials (none where the file is shown as exported), and how it is redrawn for a look. */
let rigged: { g: InstancedBufferGeometry; material: ShaderMaterial; wire: Mesh; setLook: (next: string) => void; paint: () => void } | null = null;

if ((look === 'raw' || look === 'rawclay') && raw) {
  // the file as exported, in a plain studio light (rawclay: its bare geometry, untextured)
  if (look === 'rawclay') raw.material = new MeshStandardMaterial({ color: 0x9a9894, roughness: 0.85 });
  scene.add(raw, new HemisphereLight(0xffffff, 0xd8d0c0, 1.6), new AmbientLight(0xffffff, 0.4));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(0.25, 0.45, 1);
  scene.add(key);
} else {
  const g = new InstancedBufferGeometry();
  g.setIndex(new BufferAttribute(b.index, 1));
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('normal', new BufferAttribute(b.normal, 3));
  g.setAttribute('skinIndex', new BufferAttribute(b.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(b.skinWeight, 4));
  g.setAttribute('aFur', new BufferAttribute(b.fur, 1));
  g.setAttribute('aOpen', new BufferAttribute(b.open, 1));
  if (b.colour) g.setAttribute('aColour', new BufferAttribute(b.colour, 3));
  if (b.raise && b.raiseNormal && b.raiseOpen && params.get('raise') !== '0') {
    g.setAttribute('aRaise', new BufferAttribute(b.raise, 3));
    g.setAttribute('aRaiseNormal', new BufferAttribute(b.raiseNormal, 3));
    g.setAttribute('aRaiseOpen', new BufferAttribute(b.raiseOpen, 1));
  }
  if (b.hang && b.hangNormal && params.get('raise') !== '0') {
    g.setAttribute('aHang', new BufferAttribute(b.hang, 3));
    g.setAttribute('aHangNormal', new BufferAttribute(b.hangNormal, 3));
  }
  if (b.comb && params.get('comb') !== '0') g.setAttribute('aComb', new BufferAttribute(b.comb, 3));
  const raised = g.getAttribute('aRaise') !== undefined;
  const hung = g.getAttribute('aHang') !== undefined;
  const combed = g.getAttribute('aComb') !== undefined;
  const n = b.position.length / 3;
  const colours = new Float32BufferAttribute(new Float32Array(n * 3), 3);
  g.setAttribute('aWeightColour', colours);

  /** The per-vertex colours of the looks that have them, for the pose as it is now. */
  const paint = (): void => {
    const c = colours.array as Float32Array;
    c.fill(0);
    if (look === 'weights') {
      // each vertex the blend of its joints' colours
      const col = new Color();
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) {
          col.setHex(JOINT_COLOURS[b.skinIndex[i * 4 + k]]);
          const w = b.skinWeight[i * 4 + k];
          c[i * 3] += col.r * w;
          c[i * 3 + 1] += col.g * w;
          c[i * 3 + 2] += col.b * w;
        }
      }
    } else if (look === 'stretch' || look === 'rough') {
      // stretch: each vertex's change of area in the pose (the triangles about it, skinned as the shader
      // skins them): log2, blue −1 … white 0 … red +1. rough: how far each vertex's normal on the posed skin
      // turns from its neighbours' (bumps and creases): white none … red 25° and more
      // (with the hung corrective as the shader takes it: full, but on the left as the arm rises)
      const rest = Float32Array.from(b.position);
      const raisedAt = (i: number): number => (b.position[i * 3] > 0 ? rig.raised : rig.raisedRight);
      const hungAt = (i: number): number => (b.position[i * 3] > 0 ? rig.hung : rig.hungRight);
      if (hung && b.hang) for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) rest[i * 3 + a] += b.hang[i * 3 + a] * hungAt(i);
      const posed = rig.deform(rest, b.skinIndex, b.skinWeight, new Float32Array(n * 3), dual);
      if (raised && b.raise) {
        // with the wave's corrective, as the shader adds it (in the chest's frame)
        const e = rig.skin[3].elements;
        for (let i = 0; i < n; i++) {
          const [x, y, z] = [b.raise[i * 3], b.raise[i * 3 + 1], b.raise[i * 3 + 2]];
          const r = raisedAt(i);
          posed[i * 3] += r * (e[0] * x + e[4] * y + e[8] * z);
          posed[i * 3 + 1] += r * (e[1] * x + e[5] * y + e[9] * z);
          posed[i * 3 + 2] += r * (e[2] * x + e[6] * y + e[10] * z);
        }
      }
      let worst = 0;
      if (look === 'rough') {
        // the posed skin's normals (its triangles', area-weighted), then each one's turn from its neighbours' mean
        const normal = new Float64Array(n * 3);
        const near: number[][] = Array.from({ length: n }, () => []);
        for (let t = 0; t < b.index.length; t += 3) {
          const [i0, i1, i2] = [b.index[t], b.index[t + 1], b.index[t + 2]];
          const ux = posed[i1 * 3] - posed[i0 * 3];
          const uy = posed[i1 * 3 + 1] - posed[i0 * 3 + 1];
          const uz = posed[i1 * 3 + 2] - posed[i0 * 3 + 2];
          const wx = posed[i2 * 3] - posed[i0 * 3];
          const wy = posed[i2 * 3 + 1] - posed[i0 * 3 + 1];
          const wz = posed[i2 * 3 + 2] - posed[i0 * 3 + 2];
          const m = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
          for (const i of [i0, i1, i2]) for (let a = 0; a < 3; a++) normal[i * 3 + a] += m[a];
          near[i0].push(i1, i2);
          near[i1].push(i0, i2);
          near[i2].push(i0, i1);
        }
        for (let i = 0; i < n; i++) {
          const l = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
          for (let a = 0; a < 3; a++) normal[i * 3 + a] /= l;
        }
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const mean = [0, 0, 0];
          for (const j of near[i]) for (let a = 0; a < 3; a++) mean[a] += normal[j * 3 + a];
          const l = Math.hypot(mean[0], mean[1], mean[2]) || 1;
          const cos = (normal[i * 3] * mean[0] + normal[i * 3 + 1] * mean[1] + normal[i * 3 + 2] * mean[2]) / l;
          const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
          sum += angle;
          worst = Math.max(worst, angle);
          const s = Math.min(1, angle / 25);
          c.set([1, 1 - s, 1 - s], i * 3);
        }
        (window as unknown as { museRough: number[] }).museRough = [sum / n, worst];
      } else {
        const area = (p: Float32Array, a: number, e: number, d: number): number => {
          const ux = p[e * 3] - p[a * 3];
          const uy = p[e * 3 + 1] - p[a * 3 + 1];
          const uz = p[e * 3 + 2] - p[a * 3 + 2];
          const wx = p[d * 3] - p[a * 3];
          const wy = p[d * 3 + 1] - p[a * 3 + 1];
          const wz = p[d * 3 + 2] - p[a * 3 + 2];
          return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
        };
        const before = new Float64Array(n);
        const after = new Float64Array(n);
        for (let t = 0; t < b.index.length; t += 3) {
          const [i0, i1, i2] = [b.index[t], b.index[t + 1], b.index[t + 2]];
          const a0 = area(b.position, i0, i1, i2);
          const a1 = area(posed, i0, i1, i2);
          for (const i of [i0, i1, i2]) {
            before[i] += a0;
            after[i] += a1;
          }
        }
        for (let i = 0; i < n; i++) {
          const s = Math.max(-1, Math.min(1, Math.log2(Math.max(after[i], 1e-9) / Math.max(before[i], 1e-9))));
          worst = Math.max(worst, Math.abs(s));
          c.set(s > 0 ? [1, 1 - s, 1 - s] : [1 + s, 1 + s, 1], i * 3);
        }
        (window as unknown as { museStretch: number }).museStretch = worst;
      }
    }
    colours.needsUpdate = true;
  };

  // a big soft key from the front, a little left and above, as the reference is lit
  const sun = new Vector3(0.25, 0.45, 1).normalize();
  const shared: Record<string, number> = { MUSE_STUDIO: 1 };
  if (b.colour) shared.MUSE_COLOURED = 1;
  if (dual) shared.MUSE_DQS = 1;
  if (raised) shared.MUSE_RAISE = 1;
  if (hung) shared.MUSE_HANG = 1;
  if (combed) shared.MUSE_COMB = 1;
  /** A look's defines: the shared ones, and its own. */
  const definesFor = (l: string): Record<string, number> => {
    const d = { ...shared };
    if (l === 'weights' || l === 'stretch' || l === 'rough') d.MUSE_WEIGHTS = 1;
    if (l === 'clay' || l === 'facet') d.MUSE_CLAY = 1;
    if (l === 'facet') d.MUSE_FACET = 1;
    return d;
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentShader.replace(/}\s*$/, '  #include <colorspace_fragment>\n}\n'),
    defines: definesFor(look),
    uniforms: {
      uBones: { value: rig.skin },
      uBoneDQ: { value: rig.dual },
      uMusePos: { value: new Vector3() },
      uMuseFrame: { value: new Matrix3() },
      uMuseSize: { value: new Vector4(1, FUR_LENGTH / MUSE_HEIGHT, SHELLS, 0) },
      uMuseWind: { value: new Vector4() },
      uMuseFace: { value: new Vector4(rig.eyes, rig.smile, rig.squint, rig.squeeze) },
      uMuseMood: { value: new Vector4(rig.blush, 0, 0, 0) },
      uMuseFluff: { value: rig.fluff },
      uMuseGrade: { value: grade },
      uMuseRaise: { value: new Vector4(rig.raised, rig.raisedRight, rig.hung, rig.hungRight) },
      uStudioSun: { value: sun },
      uSunDir: { value: sun },
      uSunTint: { value: new Color(1, 1, 1) },
      uShadeTint: { value: new Color(1, 1, 1) },
      uToon: { value: new Vector4(3, 0.08, 0.6, 0) },
      uWarpFocus: { value: new Vector3() },
      uWarpUp: { value: new Vector3(0, 1, 0) },
      uWarpK: { value: 0 },
      uTime: { value: time },
      uRadius: { value: 128 },
    },
  });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  // (hide=1: Muse not drawn, all else as it is: the stage's grass and shadows round it)
  mesh.visible = params.get('hide') !== '1';
  scene.add(mesh);
  // the triangles, drawn over the skin
  const wireMaterial = material.clone();
  wireMaterial.uniforms = material.uniforms;
  wireMaterial.defines = { ...definesFor(look), MUSE_WIRE: 1 };
  wireMaterial.wireframe = true;
  wireMaterial.polygonOffset = true;
  wireMaterial.polygonOffsetFactor = -1;
  const wire = new Mesh(g, wireMaterial);
  wire.frustumCulled = false;
  wire.renderOrder = 5;
  wire.visible = params.get('wire') === '1';
  scene.add(wire);
  const setLook = (next: string): void => {
    look = next;
    material.defines = definesFor(look);
    wireMaterial.defines = { ...definesFor(look), MUSE_WIRE: 1 };
    material.needsUpdate = wireMaterial.needsUpdate = true;
    const coloured = look === 'weights' || look === 'stretch' || look === 'rough';
    g.instanceCount = fur && !coloured && look !== 'clay' && look !== 'facet' ? SHELLS + 1 : 1;
    paint();
  };
  setLook(look);
  rigged = { g, material, wire, setLook, paint };
}

// the skeleton as posed: a dot at each joint, a line to its parent, drawn over the body
const lineGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Float32Array((PARENT.length - 1) * 6), 3));
const dotGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Float32Array(PARENT.length * 3), 3));
const over = { depthTest: false, transparent: true };
const skeleton = new LineSegments(lineGeometry, new LineBasicMaterial({ color: 0xd02060, ...over }));
const dots = new Points(dotGeometry, new PointsMaterial({ color: 0xd02060, size: 14, sizeAttenuation: false, ...over }));
skeleton.renderOrder = dots.renderOrder = 10;
skeleton.frustumCulled = dots.frustumCulled = false;
scene.add(skeleton, dots);
const drawBones = (): void => {
  skeleton.visible = dots.visible = bones;
  if (!bones) return;
  const joints = rig.joints();
  const lines = lineGeometry.getAttribute('position');
  const pts = dotGeometry.getAttribute('position');
  let k = 0;
  for (let j = 0; j < joints.length / 3; j++) {
    pts.setXYZ(j, joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
    const p = PARENT[j];
    if (p < 0) continue;
    lines.setXYZ(k++, joints[p * 3], joints[p * 3 + 1], joints[p * 3 + 2]);
    lines.setXYZ(k++, joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
  }
  lines.needsUpdate = pts.needsUpdate = true;
};
drawBones();

// framed as the reference: orthographic for the straight views, its scale in pixels per height
const s = REF.tall;
const ortho = new OrthographicCamera(-REF.middle / s, (REF.width - REF.middle) / s, REF.feet / s, -(REF.height - REF.feet) / s, 0.1, 20);
const turn = view === 'left' ? Math.PI / 2 : view === 'right' ? -Math.PI / 2 : view === 'back' ? Math.PI : view.startsWith('turn:') ? (Number(view.slice(5)) * Math.PI) / 180 : 0;
let camera: OrthographicCamera | PerspectiveCamera = ortho;
if (view.startsWith('persp:') || view.startsWith('cam:') || live) {
  // a three-quarter view through a lens, as the reference photographs are (live: from the view's side, on a turntable);
  // cam:<deg round>,<deg up>,<distance>,<height looked at>[,<depth looked at>] for any other
  const a = view.startsWith('persp:') ? (Number(view.slice(6)) * Math.PI) / 180 : turn;
  const p = new PerspectiveCamera(30, live ? innerWidth / innerHeight : REF.width / REF.height, 0.05, 40);
  p.position.set(3.2 * Math.sin(a), 0.75, 3.2 * Math.cos(a));
  p.lookAt(0, 0.5, 0);
  if (view.startsWith('cam:')) {
    const [round, up, far, y, z] = view.slice(4).split(',').map(Number);
    const r = (round * Math.PI) / 180;
    const e = (up * Math.PI) / 180;
    const at = new Vector3(0, y, z || 0);
    p.position.set(at.x + far * Math.cos(e) * Math.sin(r), at.y + far * Math.sin(e), at.z + far * Math.cos(e) * Math.cos(r));
    p.lookAt(at);
  }
  camera = p;
} else {
  ortho.position.set(5 * Math.sin(turn), 0, 5 * Math.cos(turn));
  ortho.lookAt(0, 0, 0);
  ortho.position.y = 0;
}

if (!live) {
  renderer.render(scene, camera);
} else {
  const lens = camera as PerspectiveCamera;
  const controls = new OrbitControls(lens, canvas);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.update();
  // Muse's life on its stage (museStage.ts), unless a pose is asked for or stage=0: the bare turntable
  const stage = rigged && params.get('stage') !== '0' && !params.has('pose') ? (await import('./museStage')).buildStage(scene, lens, canvas, controls, { rig, uniforms: rigged.material.uniforms }) : null;
  if (stage) {
    skeleton.matrixAutoUpdate = dots.matrixAutoUpdate = false;
    skeleton.matrix = dots.matrix = stage.place;
    // (day=<s>: that moment of its day; pause=1: held there)
    if (params.has('day')) stage.seek(time, Number(params.get('day')));
    (window as unknown as { museStage: unknown }).museStage = stage;
  }
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    lens.aspect = innerWidth / innerHeight;
    lens.updateProjectionMatrix();
  });
  // what is playing, and the keys
  const legend = document.createElement('div');
  legend.style.cssText = 'position:fixed;left:12px;bottom:10px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#555;white-space:pre;pointer-events:none';
  document.body.append(legend);
  let t = time;
  let paused = params.get('pause') === '1';
  const tell = (): void => {
    const keys = stage ? stage.legend() : `${model} · ${pose} · ${look}${paused ? ' · paused' : ''}   t ${t.toFixed(2)} s\n1 idle  2 walk  3 wave  4 day  0 arms hung`;
    legend.textContent = `${keys}${stage && paused ? ' · paused' : ''}\nspace pause  ← → step   F fur  C clay  T triangles  R rough  S stretch  W weights   X wire  B bones   drag to turn, wheel to come close`;
  };
  const poses: Record<string, string> = { '1': 'idle', '2': 'walk', '3': 'wave', '4': 'day', '0': 'hang' };
  const looks: Record<string, string> = { f: 'muse', c: 'clay', t: 'facet', r: 'rough', s: 'stretch', w: 'weights' };
  addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (stage?.key(event, t)) event.preventDefault();
    else if (!stage && key in poses) {
      pose = poses[key];
      t = 0;
    } else if (key in looks && rigged) rigged.setLook(looks[key]);
    else if (key === ' ') paused = !paused;
    else if (key === 'arrowright' || key === 'arrowleft') t = Math.max(0, t + (key === 'arrowright' ? 1 : -1) * (event.shiftKey ? 0.5 : 1 / 30));
    else if (key === 'x' && rigged) rigged.wire.visible = !rigged.wire.visible;
    else if (key === 'b') bones = !bones;
    else return;
    event.preventDefault();
  });
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = paused ? 0 : Math.min(0.1, (now - last) / 1000);
    t += dt;
    last = now;
    if (stage) stage.update(t, dt);
    else act(t);
    if (rigged) {
      const u = rigged.material.uniforms;
      (u.uMuseFace.value as Vector4).set(rig.eyes, rig.smile, rig.squint, rig.squeeze);
      (u.uMuseMood.value as Vector4).set(rig.blush, 0, 0, 0);
      (u.uMuseRaise.value as Vector4).set(rig.raised, rig.raisedRight, rig.hung, rig.hungRight);
      u.uTime.value = t;
      if (look === 'stretch' || look === 'rough') rigged.paint();
    }
    drawBones();
    tell();
    controls.update();
    renderer.render(scene, camera);
  });
}
(window as unknown as { museLabReady: boolean }).museLabReady = true;
