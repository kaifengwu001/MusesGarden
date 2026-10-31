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
import { FUR_LENGTH, MUSE_HEIGHT, SHELLS } from '../life/muse';
import { buildMuseBody, FIELD_FIT, PARENT, type MuseBody, type MuseFit } from '../life/museBody';
import { SCULPTS, type SculptKind } from '../life/museMesh';
import { loadTripo } from '../life/museTripo';
import fragmentShader from '../life/muse.frag.glsl?raw';
import vertexShader from '../life/muse.vert.glsl?raw';
import { MuseRig } from '../life/museRig';
import { registerShaderChunks } from '../render/glsl';

// The Muse lab (dev only, served at /src/dev/museLab.html): Muse alone on
// white in a soft studio light, framed exactly as the front reference
// (reference/muse/1.webp: 1504 × 1680, Muse 1261 px tall, its feet 1438 px
// down and its middle 799.5 px across), so the two can be laid side by side
// and their silhouettes compared. The hash picks the body, the look, the view
// and the moment:
//   model=procedural|tripo|tpose|tpose2 (reference/muse/tripo.glb, tripo-tpose.glb, tripo-tpose2.glb, rigged on the skeleton by museMesh.ts)
//   look=muse|raw|weights|clay|facet|stretch|rough   (Muse's shaders; the file as exported; each vertex coloured by its joints;
//                           the bare skin in clay; the clay shaded by the triangles as drawn, not the skinned normals;
//                           how much each part of the skin is stretched (red) or squashed (blue) in the pose;
//                           how far each normal of the posed skin turns from its neighbours' (bumps, creases: red))
//   wire=1 (the triangles over it)
//   view=front|left|back|turn:<deg>|persp:<deg>   pose=idle|walk|wave|hang   t=<s>   gait=<cycles>   fur=0|1   bones=0|1
//   skin=lbs|dqs (the joints blended as matrices, as Muse is drawn, or as dual quaternions)   raise=0 (without the correctives)
//   hang=<z>,<x>  wave=<z>,<fore>[,<x>,<y>] (other arm angles on the body's fit, rad)   reach=<H> (arms drawn longer)   comb=0 (the fur standing straight)
// Muse is one meter tall here; everything is in its heights.

const REF = { width: 1504, height: 1680, tall: 1261, feet: 1438, middle: 799.5 } as const;
/** A colour per joint for the weights view. */
const JOINT_COLOURS = [0x999999, 0xe0b040, 0x60b060, 0x4090d0, 0xd05050, 0xb060c0, 0xe08040, 0x40c0c0, 0x8080e0, 0x70a030, 0xc07090, 0xf0e070, 0x70e0a0];

const params = new URLSearchParams(location.hash.slice(1));
const model = params.get('model') ?? 'procedural';
const look = params.get('look') ?? 'muse';
const view = params.get('view') ?? 'front';
const pose = params.get('pose') ?? 'idle';
const time = Number(params.get('t') ?? 2);
const fur = params.get('fur') !== '0';
const dual = params.get('skin') === 'dqs';
const bones = params.get('bones') === '1';

const canvas = document.querySelector<HTMLCanvasElement>('#lab');
if (!canvas) throw new Error('museLab.html is missing #lab');
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.outputColorSpace = SRGBColorSpace;
renderer.setPixelRatio(1);
renderer.setSize(REF.width, REF.height, false);
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
rig.pose({
  time,
  walk: pose === 'walk' ? 1 : 0,
  stride: 1,
  gait: Number(params.get('gait') ?? 0.25),
  wave: pose === 'wave' ? time : -1,
  lookYaw: 0,
  lookPitch: 0,
  look: 0,
});
// (the arms hung and nothing else moving, to compare the two arms)
if (pose === 'hang') rig.hang();

async function body(): Promise<{ body: MuseBody & { colour?: Float32Array; raise?: Float32Array; raiseNormal?: Float32Array; raiseOpen?: Float32Array; hang?: Float32Array; hangNormal?: Float32Array; comb?: Float32Array }; grade: Vector3; raw: Mesh | null }> {
  if (!sculpt) return { body: buildMuseBody(), grade: new Vector3(1, 1, 1), raw: null };
  const loaded = await loadTripo(sculpt);
  return { body: loaded.body, grade: params.get('grade') === '0' ? new Vector3(1, 1, 1) : loaded.grade, raw: loaded.raw };
}

const { body: b, grade, raw } = await body();

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
  const weights = look === 'weights' || look === 'stretch' || look === 'rough';
  if (look === 'stretch' || look === 'rough') {
    // stretch: each vertex's change of area in the pose (the triangles about it, skinned as the shader
    // skins them): log2, blue −1 … white 0 … red +1. rough: how far each vertex's normal on the posed skin
    // turns from its neighbours' (bumps and creases): white none … red 25° and more
    const n = b.position.length / 3;
    // (with the hung corrective as the shader takes it: full, but on the left as the arm rises)
    const rest = Float32Array.from(b.position);
    if (hung && b.hang) for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) rest[i * 3 + a] += b.hang[i * 3 + a] * (b.position[i * 3] > 0 ? 1 - rig.raised : 1);
    const posed = rig.deform(rest, b.skinIndex, b.skinWeight, new Float32Array(n * 3), dual);
    if (raised && b.raise) {
      // with the wave's corrective, as the shader adds it (in the chest's frame)
      const e = rig.skin[3].elements;
      for (let i = 0; i < n; i++) {
        const [x, y, z] = [b.raise[i * 3], b.raise[i * 3 + 1], b.raise[i * 3 + 2]];
        posed[i * 3] += rig.raised * (e[0] * x + e[4] * y + e[8] * z);
        posed[i * 3 + 1] += rig.raised * (e[1] * x + e[5] * y + e[9] * z);
        posed[i * 3 + 2] += rig.raised * (e[2] * x + e[6] * y + e[10] * z);
      }
    }
    const area = (p: Float32Array, a: number, c: number, d: number): number => {
      const ux = p[c * 3] - p[a * 3];
      const uy = p[c * 3 + 1] - p[a * 3 + 1];
      const uz = p[c * 3 + 2] - p[a * 3 + 2];
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
    const c = new Float32Array(n * 3);
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
      for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, Math.log2(Math.max(after[i], 1e-9) / Math.max(before[i], 1e-9))));
        worst = Math.max(worst, Math.abs(s));
        c.set(s > 0 ? [1, 1 - s, 1 - s] : [1 + s, 1 + s, 1], i * 3);
      }
      (window as unknown as { museStretch: number }).museStretch = worst;
    }
    g.setAttribute('aWeightColour', new Float32BufferAttribute(c, 3));
  } else if (weights) {
    // each vertex the blend of its joints' colours
    const c = new Float32Array((b.position.length / 3) * 3);
    const col = new Color();
    for (let i = 0; i < b.position.length / 3; i++) {
      for (let k = 0; k < 4; k++) {
        col.setHex(JOINT_COLOURS[b.skinIndex[i * 4 + k]]);
        const w = b.skinWeight[i * 4 + k];
        c[i * 3] += col.r * w;
        c[i * 3 + 1] += col.g * w;
        c[i * 3 + 2] += col.b * w;
      }
    }
    g.setAttribute('aWeightColour', new Float32BufferAttribute(c, 3));
  }
  g.instanceCount = fur && !weights && look !== 'clay' && look !== 'facet' ? SHELLS + 1 : 1;

  // a big soft key from the front, a little left and above, as the reference is lit
  const sun = new Vector3(0.25, 0.45, 1).normalize();
  const defines: Record<string, number> = { MUSE_STUDIO: 1 };
  if (b.colour) defines.MUSE_COLOURED = 1;
  if (weights) defines.MUSE_WEIGHTS = 1;
  if (look === 'clay' || look === 'facet') defines.MUSE_CLAY = 1;
  if (look === 'facet') defines.MUSE_FACET = 1;
  if (dual) defines.MUSE_DQS = 1;
  if (raised) defines.MUSE_RAISE = 1;
  if (hung) defines.MUSE_HANG = 1;
  if (combed) defines.MUSE_COMB = 1;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader: fragmentShader.replace(/}\s*$/, '  #include <colorspace_fragment>\n}\n'),
    defines,
    uniforms: {
      uBones: { value: rig.skin },
      uBoneDQ: { value: rig.dual },
      uMusePos: { value: new Vector3() },
      uMuseFrame: { value: new Matrix3() },
      uMuseSize: { value: new Vector4(1, FUR_LENGTH / MUSE_HEIGHT, SHELLS, 0) },
      uMuseWind: { value: new Vector4() },
      uMuseFace: { value: new Vector4(rig.eyes, rig.smile, 0, 0) },
      uMuseGrade: { value: grade },
      uMuseRaise: { value: rig.raised },
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
  scene.add(mesh);
  if (params.get('wire') === '1') {
    // the triangles, drawn over the skin
    const wire = material.clone();
    wire.defines = { ...defines, MUSE_WIRE: 1 };
    wire.wireframe = true;
    wire.polygonOffset = true;
    wire.polygonOffsetFactor = -1;
    const lines = new Mesh(g, wire);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    scene.add(lines);
  }
}

if (bones) {
  // the skeleton as posed: a dot at each joint, a line to its parent, drawn over the body
  const joints = rig.joints();
  const pts: number[] = [];
  const lines: number[] = [];
  for (let j = 0; j < joints.length / 3; j++) {
    pts.push(joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
    const p = PARENT[j];
    if (p >= 0) lines.push(joints[p * 3], joints[p * 3 + 1], joints[p * 3 + 2], joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
  }
  const lineGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3));
  const dotGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3));
  const over = { depthTest: false, transparent: true };
  const skeleton = new LineSegments(lineGeometry, new LineBasicMaterial({ color: 0xd02060, ...over }));
  const dots = new Points(dotGeometry, new PointsMaterial({ color: 0xd02060, size: 14, sizeAttenuation: false, ...over }));
  skeleton.renderOrder = dots.renderOrder = 10;
  scene.add(skeleton, dots);
}

// framed as the reference: orthographic for the straight views, its scale in pixels per height
const s = REF.tall;
const ortho = new OrthographicCamera(-REF.middle / s, (REF.width - REF.middle) / s, REF.feet / s, -(REF.height - REF.feet) / s, 0.1, 20);
const turn = view === 'left' ? Math.PI / 2 : view === 'right' ? -Math.PI / 2 : view === 'back' ? Math.PI : view.startsWith('turn:') ? (Number(view.slice(5)) * Math.PI) / 180 : 0;
let camera: OrthographicCamera | PerspectiveCamera = ortho;
if (view.startsWith('persp:')) {
  // a three-quarter view through a lens, as the reference photographs are
  const a = (Number(view.slice(6)) * Math.PI) / 180;
  const p = new PerspectiveCamera(30, REF.width / REF.height, 0.1, 20);
  p.position.set(3.2 * Math.sin(a), 0.75, 3.2 * Math.cos(a));
  p.lookAt(0, 0.5, 0);
  camera = p;
} else {
  ortho.position.set(5 * Math.sin(turn), 0, 5 * Math.cos(turn));
  ortho.lookAt(0, 0, 0);
  ortho.position.y = 0;
}
renderer.render(scene, camera);
(window as unknown as { museLabReady: boolean }).museLabReady = true;
