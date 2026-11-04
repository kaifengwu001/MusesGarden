import {
  AddEquation,
  BufferAttribute,
  CanvasTexture,
  Color,
  CustomBlending,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  HalfFloatType,
  InstancedBufferGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  type IUniform,
} from 'three';
import { smoothstep } from '../core/math';
import { FUR_LENGTH, MUSE_HEIGHT, SHELLS } from '../life/muse';
import { JOINT, JOINTS, ORDER, PARENT } from '../life/museBody';
import { fitOf } from '../life/museDress';
import { MuseRig } from '../life/museRig';
import { loadSculpt } from '../life/museSculptLoader';
import fragmentShader from '../life/muse.frag.glsl?raw';
import vertexShader from '../life/muse.vert.glsl?raw';
import { registerShaderChunks } from '../render/glsl';

// The making of Muse (museLab.html#making=1), a shot for the demo film: the
// original Muse (Momo, tpose6) as it was made, pass by pass, on the lab's
// white. First the mesh as generated (the sculpt's file, untextured, in its
// own T-pose) comes into being from its feet up behind a ragged, glowing
// blue front (the hut's furniture's, hut.frag.glsl FILM); then each of the
// lab's looks sweeps up it behind a thinner blue line, the passes its making
// went through: its triangles, then the clay (the skin as rigged takes over
// from the file), the rough heat map, the weights; then its bones show and it
// starts walking, its arms coming down from the T-pose; then its colour, its
// bones going and its fur growing; and the camera, which has drifted round
// its left while it was made, comes back round to its front as it stops and
// looks at you. Everything is in meters, Muse one tall, standing at the
// middle facing +z.
//
// Every frame is a function of time only, so the film is rendered offline
// frame by frame (muse-look's making.mjs): window.museMaking.frame(t,
// samples, shutter) draws the moment t, averaging `samples` renders over the
// shutter (s) for motion blur, each with the shadow's light moved a little
// and the view a fraction of a pixel. The hash:
//   beats=gen,tris,clay,rough,weights,bones,walk,colour,fur,front,stop,end   the beats (s; the defaults in BEATS)
//   live=1                 play it (space pauses, ← → step)
//   t=<s>, samples=<n>     the moment drawn on load (not live), and its renders
//   cam=<round°>,<up°>,<distance>   the camera held there (round from its front, + to its left), for checking

const params = new URLSearchParams(location.hash.slice(1));
/**
 * The beats (s): the mesh generated from `gen`; the passes from `tris`, `clay`, `rough`, `weights` (each sweeping up
 * it in PASS s); its bones showing from `bones`; walking from `walk`; its colour from `colour`; its fur growing and its
 * bones going from `fur`; the camera turning back to its front from `front`; stopping, turned to you, from `stop`.
 */
const BEATS = (() => {
  const b = { gen: 0.2, tris: 2.8, clay: 3.8, rough: 4.8, weights: 5.8, bones: 6.75, walk: 7.5, colour: 8.9, fur: 9.5, front: 9.9, stop: 11.2, end: 12.3 };
  const given = params.get('beats')?.split(',').map(Number);
  const keys = Object.keys(b) as (keyof typeof b)[];
  if (given && given.length === keys.length && given.every(Number.isFinite)) keys.forEach((k, i) => (b[k] = given[i]));
  return b;
})();
/** How long the generation's front takes to come up the mesh, and each pass's (s). */
const SWEEP = { gen: 2.3, pass: 0.6 } as const;
/**
 * The fronts, each making a stage: where it starts (s), how long it takes (s), how ragged it is (H, either way), its
 * edge's core width and its glow's reach behind it (H), how bright, and how far the glow cools the colours into blue.
 * The generation's is the hut's furniture's own (hut.ts FILM_LOOK); the passes', a thinner line.
 */
const FRONTS = [
  { at: BEATS.gen, take: SWEEP.gen, ragged: 0.12, core: 0.006, reach: 0.06, edge: 1, cool: 1 },
  ...[BEATS.tris, BEATS.clay, BEATS.rough, BEATS.weights, BEATS.colour].map((at) => ({ at, take: SWEEP.pass, ragged: 0.025, core: 0.005, reach: 0.035, edge: 0.75, cool: 0.55 })),
];
/** The stages the fronts make (one more than the fronts passed): 1 the mesh as generated, 2 its triangles, 3 clay, 4 rough, 5 weights, 6 its colour. */
const STAGE = { generated: 1, triangles: 2, clay: 3, rough: 4, weights: 5, colour: 6 } as const;
/** The top the fronts must pass (H): the generated mesh's crown. */
const TOP = 1.0;
/** Its walk's pace (cycles of two steps a second: the lab's). */
const GAIT = 1.1;
/** How long its arms take to come down out of the T-pose as it starts to walk, and its bones to show and to go (s). */
const ALIVE = 0.9;
const BONES = { show: 0.6, go: 0.45 } as const;
/** How long its fur takes to grow (s). */
const FUR_GROWS = 1.0;
/** The camera: how far round its left it drifts while it is made (°, from its front: three-quarter views, where its bones read), how far from what it looks at (m), how far above it (°), that point's height (m), the lens (° high). */
const LENS = { from: 30, to: 62, distance: [3.3, 3.05], up: [13, 6], at: 0.52, fov: 30 } as const;
/** Toward the light it is shaded by (the lab's key: from the front, on its left, a little above), and the floor's shadow's (higher, from the same side). */
const SUN = new Vector3(0.25, 0.45, 1).normalize();
const SHADOW_SUN = new Vector3(0.3, 1.25, 0.95).normalize();
/** A colour per joint for the weights (the lab's). */
const JOINT_COLOURS = [0x999999, 0xe0b040, 0x60b060, 0x4090d0, 0xd05050, 0xb060c0, 0xe08040, 0x40c0c0, 0x8080e0, 0x70a030, 0xc07090, 0xf0e070, 0x70e0a0];

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

// ---- the floor: the white going on for ever, only the shadows on it (as in the parade) ----

const contactMaterial = new MeshBasicMaterial({ map: shade('rgba(110,98,86,0.34)', 'rgba(110,98,86,0)'), transparent: true, depthWrite: false, opacity: 0 });
{
  const floor = new Mesh(new PlaneGeometry(14, 14), new ShadowMaterial({ color: 0x4a3f36, opacity: 0.2, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = -2;
  scene.add(floor);
  const contact = new Mesh(new PlaneGeometry(0.86, 0.62), contactMaterial);
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

// ---- the fronts, in every material that takes part: which stage a point is in, the edge at the front sweeping now ----

/** Where each front is now (H, as filmAt counts), and how ragged; the stages a material draws; the front sweeping now (its index, or −1), its edge's brightness, core and reach; how far its glow cools the colours. */
const film: Record<string, IUniform> = {
  uFronts: { value: FRONTS.map(() => -1) },
  uRagged: { value: FRONTS.map((f) => f.ragged) },
  uEdge: { value: new Vector4(-1, 0, 0.006, 0.06) },
  uCool: { value: 1 },
};
const FILM_GLSL = /* glsl */ `
uniform float uFronts[${FRONTS.length}];
uniform float uRagged[${FRONTS.length}];
uniform vec2 uStages;   // the stages this draws (from, to)
uniform vec4 uEdge;     // the front sweeping now (its index; -1 none), its edge's brightness, its core's width (H), its glow's reach (H)
uniform float uCool;    // how far its glow cools the colours behind it into blue
const vec3 FILM_EDGE = vec3(0.16, 0.55, 2.0);
float filmHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// smooth noise, -1 ... 1
float filmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(filmHash(i), filmHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(filmHash(i + vec3(0.0, 1.0, 0.0)), filmHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(filmHash(i + vec3(0.0, 0.0, 1.0)), filmHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(filmHash(i + vec3(0.0, 1.0, 1.0)), filmHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return 2.0 * mix(a, b, f.z) - 1.0;
}
// how far a front has to have come to pass a point (H, rest space): its height, ragged (each front its own noise)
float filmAt(vec3 p, int i) {
  vec3 q = p + float(i) * vec3(3.1, 7.7, 5.3);
  return p.y + uRagged[i] * (0.62 * filmNoise(q * 2.4) + 0.38 * filmNoise(q * 6.7 + 3.1));
}
// the stage a point is in: how many fronts have passed it
float filmStage(vec3 p) {
  float k = 0.0;
  for (int i = 0; i < ${FRONTS.length}; i++) if (filmAt(p, i) < uFronts[i]) k += 1.0;
  return k;
}
// how far the front sweeping now has passed a point (H; < 0 not yet; large when none sweeps)
float filmBehind(vec3 p) {
  if (uEdge.x < -0.5) return 1e3;
  int a = int(uEdge.x + 0.5);
  return uFronts[a] - filmAt(p, a);
}
// the edge: a hairline core burning white-blue, a blue glow either side, the colours behind cooling in from blue;
// seen from inside (a back face, through the cut), one flat glowing blue, so the cut reads as a solid cross-section
// (on the lab's white an empty inside would show the white through it; shaded, it read as a bowl)
vec3 filmEdge(vec3 col, float behind, float width, bool front) {
  if (uEdge.x < -0.5) return col;
  float b = abs(behind);
  float core = 1.0 - smoothstep(0.0, max(uEdge.z, 1.5 * width), b);
  float glow = exp(-b / uEdge.w);
  float cool = behind > 0.0 ? 1.0 - smoothstep(0.0, 4.0 * uEdge.w, behind) : 0.0;
  col = mix(col, (col + 0.04) * vec3(0.32, 0.55, 1.3), 0.85 * uCool * cool);
  col += FILM_EDGE * uEdge.y * (0.45 * glow + 3.2 * core);
  if (!front) col = FILM_EDGE * uEdge.y * 0.7;
  return col;
}
`;

// ---- the mesh as generated: the sculpt's file, untextured, in its own T-pose, scaled to Muse's height ----

const loaded = await loadSculpt('tpose6');
const raw = loaded.raw.geometry;
raw.computeBoundingBox();
const rawBox = raw.boundingBox;
if (!rawBox) throw new Error('the sculpt has no extent');
/** Its scale and place: one tall, its feet at the floor, as the rig fits it (museMesh.ts: the file is the coat's outside). */
const rawScale = 1 / (rawBox.max.y - rawBox.min.y);
const RAW_VERTEX = /* glsl */ `
  varying vec3 vP;
  varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
/** The file in the lab's rawclay (a grey under a sky, a fill and the key), or its triangles as made, or its wire. */
function rawMaterial(wire: boolean): ShaderMaterial {
  const m = new ShaderMaterial({
    uniforms: { ...film, uStages: { value: wire ? [STAGE.triangles, STAGE.triangles] : [STAGE.generated, STAGE.triangles] }, uKey: { value: SUN } },
    vertexShader: RAW_VERTEX,
    fragmentShader: /* glsl */ `
      ${FILM_GLSL}
      uniform vec3 uKey;
      varying vec3 vP;
      varying vec3 vN;
      void main() {
        // (every derivative first: the branches after them are not uniform)
        vec3 facet = normalize(cross(dFdx(vP), dFdy(vP)));
        float behind = filmBehind(vP);
        float width = fwidth(behind);
        float stage = filmStage(vP);
        if (stage < uStages.x - 0.5 || stage > uStages.y + 0.5) discard;
        bool generating = uEdge.x > -0.5 && uEdge.x < 0.5;
        // (its inside seen through the cut only while it comes)
        if (!gl_FrontFacing && !generating) discard;
#ifdef WIRE
        vec3 col = vec3(0.1, 0.105, 0.125);
#else
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        // (its triangles as made: each face flat)
        if (stage > ${STAGE.generated}.5) n = facet;
        float key = max(dot(n, uKey), 0.0);
        vec3 sky = mix(vec3(0.686, 0.631, 0.527), vec3(1.0), 0.5 + 0.5 * n.y);
        vec3 col = vec3(0.325, 0.31, 0.3) * (sky * 1.6 + 0.4 + 1.8 * key) / 3.14159;
#endif
        col = filmEdge(col, behind, width, gl_FrontFacing);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: DoubleSide,
    defines: wire ? { WIRE: 1 } : {},
  });
  if (wire) m.wireframe = true;
  else {
    // (pushed back a hair, so its wire draws over it)
    m.polygonOffset = true;
    m.polygonOffsetFactor = 1;
    m.polygonOffsetUnits = 1;
  }
  return m;
}
const rawMesh = new Mesh(raw, rawMaterial(false));
const rawWire = new Mesh(raw, rawMaterial(true));
for (const m of [rawMesh, rawWire]) {
  m.scale.setScalar(rawScale);
  m.position.set(-0.5 * (rawBox.min.x + rawBox.max.x) * rawScale, -rawBox.min.y * rawScale, -0.5 * (rawBox.min.z + rawBox.max.z) * rawScale);
  m.frustumCulled = false;
  scene.add(m);
}
rawWire.renderOrder = 1;
// its shadow, as much of it as has come
rawMesh.castShadow = true;
rawMesh.customDepthMaterial = new ShaderMaterial({
  uniforms: { ...film },
  vertexShader: RAW_VERTEX,
  fragmentShader: /* glsl */ `
    ${FILM_GLSL}
    varying vec3 vP;
    varying vec3 vN;
    void main() {
      if (filmStage(vP) < 0.5) discard;
      gl_FragColor = vec4(1.0);
    }`,
  side: DoubleSide,
});

// ---- Muse as rigged: its skin in the lab's looks, each drawing its own stage ----

const body = loaded.body;
const rig = new MuseRig(fitOf('tpose6', body));
/** The skin matrices drawn (the rig's, or blended from the T-pose toward them), and its correctives' shares. */
const skin = Array.from({ length: JOINTS }, () => new Matrix4());
const raise = new Vector4(0, 0, 0, 0);
const furSize = new Vector4(1, 0, SHELLS, 0);
const face = new Vector4(1, 0, 0, 0);
const mood = new Vector4();
const time: IUniform = { value: 0 };
/** How far its fur has grown (0 … 1). */
const grown: IUniform = { value: 0 };
const n = body.position.length / 3;

/** Each vertex's blend of its joints' colours (the lab's weights). */
function weightColours(): Float32Array {
  const c = new Float32Array(n * 3);
  const col = new Color();
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      col.setHex(JOINT_COLOURS[body.skinIndex[i * 4 + k]]);
      const w = body.skinWeight[i * 4 + k];
      c[i * 3] += col.r * w;
      c[i * 3 + 1] += col.g * w;
      c[i * 3 + 2] += col.b * w;
    }
  }
  return c;
}
/** How far each vertex's normal turns from its neighbours' (the lab's rough: white none … red 25° and more), at rest. */
function roughColours(): Float32Array {
  const c = new Float32Array(n * 3);
  const p = body.position;
  const normal = new Float64Array(n * 3);
  const near: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < body.index.length; t += 3) {
    const [i0, i1, i2] = [body.index[t], body.index[t + 1], body.index[t + 2]];
    const ux = p[i1 * 3] - p[i0 * 3];
    const uy = p[i1 * 3 + 1] - p[i0 * 3 + 1];
    const uz = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const wx = p[i2 * 3] - p[i0 * 3];
    const wy = p[i2 * 3 + 1] - p[i0 * 3 + 1];
    const wz = p[i2 * 3 + 2] - p[i0 * 3 + 2];
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
  for (let i = 0; i < n; i++) {
    const mean = [0, 0, 0];
    for (const j of near[i]) for (let a = 0; a < 3; a++) mean[a] += normal[j * 3 + a];
    const l = Math.hypot(mean[0], mean[1], mean[2]) || 1;
    const cos = (normal[i * 3] * mean[0] + normal[i * 3 + 1] * mean[1] + normal[i * 3 + 2] * mean[2]) / l;
    const s = Math.min(1, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI / 25);
    c.set([1, 1 - s, 1 - s], i * 3);
  }
  return c;
}

/** Its skin, with what a look needs: shared arrays, a geometry of its own (the fur's shells are counted per geometry). */
function skinGeometry(colours?: Float32Array): InstancedBufferGeometry {
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
  if (colours) g.setAttribute('aWeightColour', new Float32BufferAttribute(colours, 3));
  g.instanceCount = 1;
  return g;
}
/** Muse's shaders in a look (its defines), drawing only its stage of the making, the front's edge over it. */
function skinMaterial(stage: number, look: Record<string, number>): ShaderMaterial {
  const defines: Record<string, number> = { MUSE_STUDIO: 1, ...look };
  if (body.colour) defines.MUSE_COLOURED = 1;
  if (body.raise && body.raiseNormal && body.raiseOpen) defines.MUSE_RAISE = 1;
  if (body.hang && body.hangNormal) defines.MUSE_HANG = 1;
  if (body.comb) defines.MUSE_COMB = 1;
  const once = (source: string, find: string, put: string): string => {
    if (source.split(find).length !== 2) throw new Error(`muse.frag.glsl: expected one "${find}"`);
    return source.replace(find, put);
  };
  let frag = once(fragmentShader, 'void main() {', `${FILM_GLSL}\nuniform float uFurGrown;\nvoid main() {\n  float filmB = filmBehind(vRest);\n  float filmW = fwidth(filmB);\n  float filmS = filmStage(vRest);\n  if (filmS < uStages.x - 0.5 || filmS > uStages.y + 0.5) discard;`);
  // (the fur's tips lighten as it grows: just sprouted, its shells are the bare skin's colour, so it doesn't flash on)
  frag = once(frag, 'float depth = skin ? 0.0 : smoothstep(0.0, 0.7, shell);', 'float depth = skin ? 0.0 : smoothstep(0.0, 0.7, shell) * uFurGrown;');
  frag = once(frag, 'gl_FragColor = vec4(col, 1.0);', 'col = filmEdge(col, filmB, filmW, gl_FrontFacing);\n  gl_FragColor = vec4(col, 1.0);');
  frag = frag.replace(/}\s*$/, '  #include <colorspace_fragment>\n}\n');
  return new ShaderMaterial({
    vertexShader,
    fragmentShader: frag,
    defines,
    uniforms: {
      ...film,
      uStages: { value: [stage, stage] },
      uBones: { value: skin },
      uBoneDQ: { value: rig.dual },
      uMusePos: { value: new Vector3() },
      uMuseFrame: { value: new Matrix3() },
      uMuseSize: { value: furSize },
      uMuseWind: { value: new Vector4() },
      uMuseFace: { value: face },
      uMuseMood: { value: mood },
      uMuseFluff: { value: rig.fluff },
      uMuseGrade: { value: loaded.grade },
      uMuseRaise: { value: raise },
      uStudioSun: { value: SUN },
      uSunDir: { value: SUN },
      uSunTint: { value: new Color(1, 1, 1) },
      uShadeTint: { value: new Color(1, 1, 1) },
      uToon: { value: new Vector4(3, 0.08, 0.6, 0) },
      uWarpFocus: { value: new Vector3() },
      uWarpUp: { value: new Vector3(0, 1, 0) },
      uWarpK: { value: 0 },
      uTime: time,
      uRadius: { value: 128 },
      uFurGrown: grown,
    },
  });
}
const looks = {
  clay: new Mesh(skinGeometry(), skinMaterial(STAGE.clay, { MUSE_CLAY: 1 })),
  rough: new Mesh(skinGeometry(roughColours()), skinMaterial(STAGE.rough, { MUSE_WEIGHTS: 1 })),
  weights: new Mesh(skinGeometry(weightColours()), skinMaterial(STAGE.weights, { MUSE_WEIGHTS: 1 })),
  colour: new Mesh(skinGeometry(), skinMaterial(STAGE.colour, {})),
};
for (const m of Object.values(looks)) {
  m.frustumCulled = false;
  scene.add(m);
}
// its shadow: its skin alone, skinned as it is drawn and a little out into its fur, into the light's map (not drawn)
const caster = (() => {
  const s = skinGeometry();
  const mesh = new Mesh(s, new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.customDepthMaterial = new ShaderMaterial({
    uniforms: { uBones: { value: skin }, uMuseSize: { value: furSize } },
    vertexShader: /* glsl */ `
      uniform mat4 uBones[13];
      uniform vec4 uMuseSize;
      attribute vec4 skinIndex;
      attribute vec4 skinWeight;
      attribute float aFur;
      void main() {
        mat4 skin = uBones[int(skinIndex.x)] * skinWeight.x + uBones[int(skinIndex.y)] * skinWeight.y + uBones[int(skinIndex.z)] * skinWeight.z + uBones[int(skinIndex.w)] * skinWeight.w;
        vec3 p = (skin * vec4(position, 1.0)).xyz;
        vec3 n = normalize(mat3(skin) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(p + n * uMuseSize.y * aFur * 0.6, 1.0);
      }`,
    fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`,
  });
  scene.add(mesh);
  return mesh;
})();

// ---- its bones: a ball at each joint, a rod to its parent, drawn over it ----

const boneMaterial = new MeshBasicMaterial({ color: 0xd02060, depthTest: false, depthWrite: false, transparent: true, opacity: 0 });
const boneRim = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0 });
/** How deep each joint is in the skeleton (the root 0): they show from the root out. */
const DEPTH = PARENT.map((_, j) => {
  let d = 0;
  for (let p = PARENT[j]; p >= 0; p = PARENT[p]) d++;
  return d;
});
const DEEPEST = Math.max(...DEPTH);
const balls = PARENT.map(() => {
  const rim = new Mesh(new SphereGeometry(0.024, 20, 14), boneRim);
  const ball = new Mesh(new SphereGeometry(0.017, 20, 14), boneMaterial);
  rim.renderOrder = 10;
  ball.renderOrder = 11;
  rim.frustumCulled = ball.frustumCulled = false;
  scene.add(rim, ball);
  return { rim, ball };
});
const rods = PARENT.map((p) => {
  if (p < 0) return null;
  const rod = new Mesh(new CylinderGeometry(0.0065, 0.0065, 1, 10), boneMaterial);
  rod.renderOrder = 11;
  rod.frustumCulled = false;
  scene.add(rod);
  return rod;
});

// ---- its pose: the T-pose it was made in, coming alive into a walk ----

const frames = Array.from({ length: JOINTS }, () => new Matrix4());
const m4 = new Matrix4();
const m5 = new Matrix4();
const tv = new Vector3();
const tq = new Quaternion();
const ts = new Vector3();
const restAt = new Vector3();
const one = new Vector3(1, 1, 1);
const still = new Quaternion();
/**
 * The skin matrices k of the way from the T-pose (every joint at rest: the mesh as made) to the rig's pose: each
 * joint's turn from its parent eased by k (slerped), its shift and stretch with it, then chained down the skeleton,
 * so the arms come down as arcs, not as chords. Its joints' frames are left in `frames`.
 */
function blend(k: number): void {
  const rest = rig.fit.rest;
  for (const j of ORDER) {
    const p = PARENT[j];
    rig.frameOf(j, m4);
    // its frame from its parent's, as posed, then eased from rest
    if (p >= 0) m4.premultiply(rig.frameOf(p, m5).invert());
    m4.decompose(tv, tq, ts);
    const o = p >= 0 ? rest[p] : [0, 0, 0];
    restAt.set(rest[j][0] - o[0], rest[j][1] - o[1], rest[j][2] - o[2]);
    tv.lerpVectors(restAt, tv, k);
    // (toward still by 1 − k: slerpQuaternions(still, tq, k) would copy `still` over tq before reading it)
    tq.slerp(still, 1 - k);
    ts.lerpVectors(one, ts, k);
    m4.compose(tv, tq, ts);
    if (p >= 0) frames[j].multiplyMatrices(frames[p], m4);
    else frames[j].copy(m4);
    // its own swelling as the rig has it (posed frame⁻¹ · skin · rest frame), eased the same way
    rig.frameOf(j, m5).invert().multiply(rig.skin[j]).multiply(m4.makeTranslation(rest[j][0], rest[j][1], rest[j][2]));
    const e = m5.elements;
    for (let i = 0; i < 16; i++) e[i] = (i % 5 === 0 ? 1 : 0) + (e[i] - (i % 5 === 0 ? 1 : 0)) * k;
    skin[j].multiplyMatrices(frames[j], m5).multiply(m4.makeTranslation(-rest[j][0], -rest[j][1], -rest[j][2]));
  }
}

// ---- the camera: drifting round its left while it is made, then back round to its front ----

const camera = new PerspectiveCamera(LENS.fov, innerWidth / innerHeight, 0.05, 40);
const held = params.get('cam')?.split(',').map(Number);
/** An ease that lingers at both ends (the parade's: u^p / (u^p + (1 − u)^p)). */
const ease = (a: number, b: number, t: number, p: number): number => {
  const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
  const x = u ** p;
  return x / (x + (1 - u) ** p);
};
/** How far back round to its front the camera has come (0 … 1). */
const backAt = (t: number): number => ease(BEATS.front, BEATS.stop + 0.7, t, 3);
/** How far round its front the camera is at a time (rad, + to its left). */
function roundAt(t: number): number {
  if (held && held.length >= 1) return (held[0] * Math.PI) / 180;
  const drift = LENS.from + (LENS.to - LENS.from) * smoothstep(0.3, BEATS.front + 0.8, t);
  return ((drift * (1 - backAt(t))) * Math.PI) / 180;
}
function aim(t: number): void {
  const r = roundAt(t);
  const k = backAt(t);
  const e = ((held?.[1] ?? LENS.up[0] + (LENS.up[1] - LENS.up[0]) * (0.35 * smoothstep(0, BEATS.front, t) + 0.65 * k)) * Math.PI) / 180;
  const d = held?.[2] ?? LENS.distance[0] + (LENS.distance[1] - LENS.distance[0]) * k;
  camera.position.set(d * Math.cos(e) * Math.sin(r), LENS.at + d * Math.sin(e), d * Math.cos(e) * Math.cos(r));
  camera.lookAt(0, LENS.at, 0);
}

// ---- a moment ----

/** Each front's height at a time (H): below its feet before it starts, over its crown once it is done. */
function frontAt(i: number, t: number): number {
  const f = FRONTS[i];
  const from = -f.ragged - 0.02;
  const to = TOP + f.ragged + 6 * f.reach + 0.02;
  const u = Math.max(0, Math.min(1, (t - f.at) / f.take));
  // (the generation's comes up steadily, easing in and out a little; a pass's sweeps)
  const k = i === 0 ? 0.5 * u + 0.5 * smoothstep(0, 1, u) : smoothstep(0, 1, u);
  return from + (to - from) * k;
}
/** Whether a stage is anywhere on it at a time: its front has started, the next one not yet passed it all. */
function shows(stage: number, t: number): boolean {
  const made = FRONTS[stage - 1];
  const next = FRONTS[stage];
  return t >= made.at && (!next || t < next.at + next.take);
}
const tmp = new Vector3();
const up = new Vector3(0, 1, 0);
/** Everything at time t: the fronts, which looks draw, its pose and face, its bones and its fur. */
function pose(t: number): void {
  const fronts = film.uFronts.value as number[];
  FRONTS.forEach((_, i) => (fronts[i] = frontAt(i, t)));
  const sweeping = FRONTS.findIndex((f) => t >= f.at && t < f.at + f.take);
  const f = FRONTS[sweeping] ?? FRONTS[0];
  (film.uEdge.value as Vector4).set(sweeping, f.edge, f.core, f.reach);
  film.uCool.value = f.cool;
  rawMesh.visible = shows(STAGE.generated, t) || shows(STAGE.triangles, t);
  rawWire.visible = shows(STAGE.triangles, t);
  looks.clay.visible = shows(STAGE.clay, t);
  looks.rough.visible = shows(STAGE.rough, t);
  looks.weights.visible = shows(STAGE.weights, t);
  looks.colour.visible = shows(STAGE.colour, t);
  caster.visible = t >= FRONTS[STAGE.clay - 1].at;
  // (its shade on the floor as its feet come)
  contactMaterial.opacity = smoothstep(0, 0.25, fronts[0]);
  // alive from `walk`: its arms down out of the T-pose as it starts to walk, stopping at `stop`, turned to you as the camera comes round
  const alive = smoothstep(BEATS.walk, BEATS.walk + ALIVE, t);
  const walk = alive * (1 - smoothstep(BEATS.stop, BEATS.stop + 0.6, t));
  const r = roundAt(t);
  const yaw = Math.atan2(Math.sin(r), Math.cos(r));
  const glance = (1 - smoothstep(0.45, 1.2, Math.abs(yaw))) * smoothstep(BEATS.front, BEATS.front + 0.8, t);
  const pitch = Math.atan2(camera.position.y - 0.78, Math.hypot(camera.position.x, camera.position.z));
  rig.pose({ time: t, walk, stride: 1, gait: Math.max(0, t - BEATS.walk) * GAIT, wave: -1, lookYaw: yaw / 0.9, lookPitch: pitch, look: glance * alive, moves: [] });
  if (alive >= 1) for (let j = 0; j < JOINTS; j++) skin[j].copy(rig.skin[j]);
  else blend(alive);
  if (alive >= 1) for (let j = 0; j < JOINTS; j++) rig.frameOf(j, frames[j]);
  // (the correctives the rig's pose calls for, as far as it has come out of the T-pose: none in it)
  raise.set(rig.raised * alive, rig.raisedRight * alive, rig.hung * alive, rig.hungRight * alive);
  // happy eyes (∩) once it has stopped, turned to you
  const happy = glance * smoothstep(BEATS.stop, BEATS.stop + 0.6, t);
  face.set(rig.eyes, rig.smile, rig.squint + (1 - rig.squint) * happy, rig.squeeze);
  mood.set(rig.blush + (0.35 - rig.blush) * happy, 0, 0, 0);
  time.value = t;
  // its fur growing from `fur`
  const fur = smoothstep(BEATS.fur, BEATS.fur + FUR_GROWS, t);
  furSize.y = (FUR_LENGTH / MUSE_HEIGHT) * fur;
  grown.value = fur;
  looks.colour.geometry.instanceCount = fur > 0.002 ? SHELLS + 1 : 1;
  // its bones: each joint popping in from the root out at `bones`, each rod growing out from its parent; gone from `fur`
  const go = 1 - smoothstep(BEATS.fur, BEATS.fur + BONES.go, t);
  boneMaterial.opacity = 0.95 * go;
  boneRim.opacity = 0.85 * go;
  for (let j = 0; j < JOINTS; j++) {
    const s = BEATS.bones + (DEPTH[j] / DEEPEST) * BONES.show * 0.7;
    const pop = smoothstep(s, s + 0.18, t);
    const size = go > 0 ? pop * (1 + 0.35 * Math.sin(Math.PI * smoothstep(s, s + 0.26, t))) : 0;
    const at = tmp.setFromMatrixPosition(frames[j]);
    balls[j].ball.position.copy(at);
    balls[j].rim.position.copy(at);
    balls[j].ball.scale.setScalar(Math.max(1e-4, size));
    balls[j].rim.scale.setScalar(Math.max(1e-4, size));
    balls[j].ball.visible = balls[j].rim.visible = size > 0.001;
    const rod = rods[j];
    if (!rod) continue;
    const p = PARENT[j];
    const from = new Vector3().setFromMatrixPosition(frames[p]);
    const grow = smoothstep(s - 0.05, s + 0.22, t);
    const to = from.clone().lerp(at, grow);
    const d = to.clone().sub(from);
    rod.visible = go > 0 && d.length() > 1e-4;
    if (!rod.visible) continue;
    rod.position.copy(from).addScaledVector(d, 0.5);
    rod.quaternion.setFromUnitVectors(up, d.clone().normalize());
    rod.scale.set(1, d.length(), 1);
  }
}

// ---- drawing: a moment averaged over the shutter, the light moved a little, the view over a pixel (as the parade) ----

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
  for (let k = i + 1; k > 0; k = Math.floor(k / base)) {
    f /= base;
    r += f * (k % base);
  }
  return r;
}
const white = new Color(1, 1, 1);
const side = new Vector3();
const lift = new Vector3();
/** Draw the moment t: `samples` renders over the shutter (s) about it, each with the light and the view moved a little, averaged. */
function frame(t: number, samples = 1, shutter = 0): void {
  fit();
  renderer.setRenderTarget(sumTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  const w = sampleTarget.width;
  const h = sampleTarget.height;
  for (let i = 0; i < samples; i++) {
    const s = samples > 1 ? (i + 0.5) / samples - 0.5 : 0;
    const at = t + s * shutter;
    aim(at);
    pose(at);
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
  length: BEATS.end,
  beats: BEATS,
  frame,
  /** The stage under each joint now, and how far round the camera is (°): for checking. */
  at: (t: number) => ({ round: (roundAt(t) * 180) / Math.PI, fronts: FRONTS.map((_, i) => frontAt(i, t)) }),
  rig,
  joints: JOINT,
  /** The skin matrices drawn now, and its joints' frames: for checking the blend out of the T-pose. */
  skin,
  frames,
  blend,
};
(window as unknown as { museMaking: typeof api }).museMaking = api;
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
  renderer.setAnimationLoop((now) => {
    if (!paused) t += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (t >= BEATS.end) t = 0;
    frame(t, 1);
  });
} else frame(Number(params.get('t') ?? 0), Number(params.get('samples') ?? 1), 0.5 / 30);
(window as unknown as { museLabReady: boolean }).museLabReady = true;
