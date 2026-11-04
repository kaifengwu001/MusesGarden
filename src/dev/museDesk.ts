import {
  AddEquation,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CustomBlending,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedBufferGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  OneFactor,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SpotLight,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  type IUniform,
  type Material,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { smoothstep } from '../core/math';
import { FUR_LENGTH, MUSE_HEIGHT, SHELLS } from '../life/muse';
import { JOINT } from '../life/museBody';
import { dressMuse, fitOf } from '../life/museDress';
import { loadSculpt } from '../life/museSculptLoader';
import { DESK, MuseRig, lidBeats, phonesBeats, phonesFrame, phonesGrip, phonesShape, phonesSpan, type Move } from '../life/museRig';
import fragmentShader from '../life/muse.frag.glsl?raw';
import vertexShader from '../life/muse.vert.glsl?raw';
import { registerShaderChunks } from '../render/glsl';

// Momo at its desk (museLab.html#desk=1), for the demo film: the original
// Muse (tpose6, as in the meadow) on an orange shell chair at a white desk
// in a sunny room, headphones on, typing away at its laptop; hurrying,
// then frantic (sweat popping off it, its eyes spinning 🌀, its mouth
// wavy, its fur frizzing); stopping; closing the laptop; taking the
// headphones off and setting them down on it; leaning back in the chair
// for a long stretch (\(> ~ <)/) and a happy sigh. Round it on the desk:
// a pen pot, a phone on a stand, a notebook and a paper crane. Everything is in meters, Muse one tall (so its heights
// are meters too), sat facing +z toward the desk; the camera looks at it
// across the desk from its right front, as the reference shot does.
//
// Every frame is a function of time only (museRig.ts's moves, the beats
// below), so the film can be rendered offline frame by frame:
// window.museDesk.frame(t, samples, shutter) draws the moment t, averaging
// `samples` renders over the shutter (s) for motion blur, each with the
// light moved a little over its window (soft shadows) and the view a
// fraction of a pixel (smooth edges). The hash:
//   beats=ramp,frantic,stop,lid,phones,unwind,end   the film's beats (s; the defaults in BEATS)
//   hi=0                                            no glance at you as it is introduced
//   live=1                                          play it (space pauses, ← → step, 1–6 go to a beat; free=1 lets you orbit)
//   t=<s>                                           the moment drawn on load (not live)
//   samples=<n>                                     renders per frame on load
//   cam=<round°>,<up°>,<distance>,<x>,<y>,<z>        the camera held there (round from Muse's front, + to its left), for checking

const params = new URLSearchParams(location.hash.slice(1));

/** Its seat's height (m): Muse's frame stands there, its feet hanging off the seat's front. */
const SEAT = 0.44;
/**
 * The film's beats (s): typing calmly from the start; hurrying from `ramp`, frantic by `frantic`; stopping dead at
 * `stop`; closing its laptop at `lid`; taking its headphones off at `phones`; leaning back for its stretch at
 * `unwind`; the end.
 */
const BEATS = (() => {
  const b = { ramp: 2.6, frantic: 9.2, stop: 11.6, lid: 12.6, phones: 15.4, unwind: 18.75, end: 24.6 };
  const given = params.get('beats')?.split(',').map(Number);
  if (given && given.length === 7 && given.every(Number.isFinite)) [b.ramp, b.frantic, b.stop, b.lid, b.phones, b.unwind, b.end] = given;
  return b;
})();
const HI = params.get('hi') !== '0';
/** Toward the window's light (the sun through it): from Muse's right (the shot's left), in front of it, above. */
const KEY = new Vector3(-0.62, 0.6, 0.5).normalize();
const WALL = { z: -1.05, colour: 0xefede9 } as const;
const DESK_TOP = SEAT + DESK.top;
/** The desk (m): its half width, its near and far edges (z), the top's thickness. */
const TABLE = { half: 0.82, near: 0.215, far: 0.93, thick: 0.03 } as const;

// ---- the renderer ----

const canvas = document.querySelector<HTMLCanvasElement>('#lab');
if (!canvas) throw new Error('museLab.html is missing #lab');
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Number(params.get('dpr') ?? Math.min(devicePixelRatio, 2)));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.autoClear = false;
registerShaderChunks();
const scene = new Scene();
{
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.16;
  pmrem.dispose();
}

// ---- small helpers ----

/** A canvas drawn once, as a texture. */
function painted(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d canvas');
  draw(g);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const shadowed = <T extends Object3D>(o: T, cast = true, receive = true): T => {
  o.traverse((c) => {
    if ((c as Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
};
const box = (w: number, h: number, d: number, m: Material, r = 0.004, seg = 3): Mesh => new Mesh(new RoundedBoxGeometry(w, h, d, seg, r), m);
/** A rod from a to b (m). */
function rod(a: Vector3, b: Vector3, r: number, m: Material, r2 = r): Mesh {
  const d = new Vector3().subVectors(b, a);
  const mesh = new Mesh(new CylinderGeometry(r2, r, d.length(), 12), m);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  return mesh;
}
/** A rounded rectangle (w across × h through, corner r) swept along a curve, its width kept along `across`; the ends open. */
function sweep(at: (s: number, out: Vector3) => Vector3, n: number, w: number, h: number, r: number, across: Vector3): BufferGeometry {
  const ring: Vector2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-(w / 2 - r), h / 2 - r, Math.PI / 2],
    [-(w / 2 - r), -(h / 2 - r), Math.PI],
    [w / 2 - r, -(h / 2 - r), (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 4; k++) ring.push(new Vector2(cx + r * Math.cos(a0 + (k / 4) * (Math.PI / 2)), cy + r * Math.sin(a0 + (k / 4) * (Math.PI / 2))));
  const m = ring.length;
  const pos: number[] = [];
  const index: number[] = [];
  const p = new Vector3();
  const q = new Vector3();
  const tangent = new Vector3();
  const side = new Vector3();
  const normal = new Vector3();
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    at(Math.min(1, s + 1e-3), q);
    at(Math.max(0, s - 1e-3), p);
    tangent.subVectors(q, p).normalize();
    at(s, p);
    side.copy(across).addScaledVector(tangent, -across.dot(tangent)).normalize();
    normal.crossVectors(tangent, side);
    for (const c of ring) pos.push(p.x + side.x * c.x + normal.x * c.y, p.y + side.y * c.x + normal.y * c.y, p.z + side.z * c.x + normal.z * c.y);
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      const a = i * m + k;
      const b = i * m + ((k + 1) % m);
      index.push(a, b, a + m, b, b + m, a + m);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
/** A thin sheet with a thickness: a surface over (u, v) in [0, 1]², its back `thick` behind it along its normal, the rim closed. */
function sheet(nu: number, nv: number, at: (u: number, v: number, out: Vector3) => Vector3, thick: number): BufferGeometry {
  const top: Vector3[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) top.push(at(i / nu, j / nv, new Vector3()));
  const id = (i: number, j: number): number => j * (nu + 1) + i;
  const normals = top.map((_, k) => {
    const i = k % (nu + 1);
    const j = Math.floor(k / (nu + 1));
    const du = new Vector3().subVectors(top[id(Math.min(nu, i + 1), j)], top[id(Math.max(0, i - 1), j)]);
    const dv = new Vector3().subVectors(top[id(i, Math.min(nv, j + 1))], top[id(i, Math.max(0, j - 1))]);
    return new Vector3().crossVectors(du, dv).normalize();
  });
  const count = top.length;
  const pos = new Float32Array(count * 6);
  top.forEach((p, k) => {
    pos.set([p.x, p.y, p.z], k * 3);
    const n = normals[k];
    pos.set([p.x - n.x * thick, p.y - n.y * thick, p.z - n.z * thick], (count + k) * 3);
  });
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i + 1, j + 1);
      const d = id(i, j + 1);
      index.push(a, b, c, a, c, d);
      index.push(count + a, count + c, count + b, count + a, count + d, count + c);
    }
  }
  // the rim: round the four edges, front to back
  const edge: number[] = [];
  for (let i = 0; i < nu; i++) edge.push(id(i, 0));
  for (let j = 0; j < nv; j++) edge.push(id(nu, j));
  for (let i = nu; i > 0; i--) edge.push(id(i, nv));
  for (let j = nv; j > 0; j--) edge.push(id(0, j));
  for (let k = 0; k < edge.length; k++) {
    const a = edge[k];
    const b = edge[(k + 1) % edge.length];
    index.push(a, count + a, count + b, a, count + b, b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ---- the room ----

const wallMaterial = new MeshStandardMaterial({ color: WALL.colour, roughness: 0.96 });
const wall = new Mesh(new PlaneGeometry(9, 4), wallMaterial);
wall.position.set(0, 2, WALL.z);
wall.receiveShadow = true;
scene.add(wall);
const floor = new Mesh(new PlaneGeometry(9, 6), new MeshStandardMaterial({ color: 0xcfb796, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, 1.6);
floor.receiveShadow = true;
scene.add(floor);
// a skirting board along the wall
{
  const skirting = box(9, 0.08, 0.015, new MeshStandardMaterial({ color: 0xeee8de, roughness: 0.7 }), 0.003);
  skirting.position.set(0, 0.04, WALL.z + 0.008);
  scene.add(shadowed(skirting));
}

// ---- the desk: a white top on a birch-ply edge, slim legs ----

const birch = new MeshStandardMaterial({ color: 0xd8b78b, roughness: 0.62 });
const laminate = new MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.5 });
{
  const desk = new Group();
  const top = new Mesh(new BoxGeometry(TABLE.half * 2, TABLE.thick, TABLE.far - TABLE.near), [birch, birch, laminate, birch, birch, birch]);
  top.position.set(0, DESK_TOP - TABLE.thick / 2, (TABLE.near + TABLE.far) / 2);
  desk.add(top);
  const legMaterial = new MeshStandardMaterial({ color: 0xece9e4, roughness: 0.45, metalness: 0.2 });
  for (const x of [-TABLE.half + 0.06, TABLE.half - 0.06]) {
    for (const z of [TABLE.near + 0.06, TABLE.far - 0.06]) {
      const leg = box(0.035, DESK_TOP - TABLE.thick, 0.035, legMaterial, 0.006);
      leg.position.set(x, (DESK_TOP - TABLE.thick) / 2, z);
      desk.add(leg);
    }
  }
  scene.add(shadowed(desk));
}

// ---- the chair: an orange shell on four wooden legs and a wire cradle ----

{
  const chair = new Group();
  const orange = new MeshPhysicalMaterial({ color: 0xe0612b, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  // its middle line (chair space: y up from the seat's top, z back from Muse's place), from the seat's front lip to the back's top
  const line = new CatmullRomCurve3([
    new Vector3(0, -0.035, 0.06),
    new Vector3(0, -0.006, 0.01),
    new Vector3(0, -0.014, -0.14),
    new Vector3(0, -0.006, -0.25),
    new Vector3(0, 0.03, -0.325),
    new Vector3(0, 0.12, -0.37),
    new Vector3(0, 0.26, -0.392),
    new Vector3(0, 0.45, -0.425),
    new Vector3(0, 0.64, -0.475),
  ]);
  const p = new Vector3();
  const tangent = new Vector3();
  const up = new Vector3();
  const shell = sheet(
    36,
    64,
    (u, v, out) => {
      line.getPoint(v, p);
      line.getTangent(v, tangent);
      up.set(0, tangent.z, -tangent.y).normalize();
      if (up.y < -0.2) up.negate();

      const x = (u - 0.5) * 2;
      // wide over the seat, narrowing up the back; its sides rising (the seat a bucket, the back wrapping round)
      const half = 0.335 - 0.03 * smoothstep(0.6, 1, v);
      // (the rim high along the seat's sides, lower from the turn up into the back: risen as high round the turn, it
      // would fold over on itself)
      const rise = 0.075 * (1 - 0.7 * smoothstep(0.22, 0.52, v)) * smoothstep(0, 0.12, v);
      const lip = Math.abs(x) ** 3;
      out.copy(p).addScaledVector(up, rise * lip);
      out.x = x * half * (1 - 0.06 * lip);
      return out;
    },
    0.011,
  );
  chair.add(new Mesh(shell, orange));
  // the legs: maple dowels splayed out from under the seat, a black wire cradle between them
  const maple = new MeshStandardMaterial({ color: 0xd9b07a, roughness: 0.55 });
  const wire = new MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.35, metalness: 0.8 });
  const feet: Vector3[] = [];
  const tops: Vector3[] = [];
  for (const x of [-1, 1]) {
    for (const z of [-0.04, -0.27]) {
      const topAt = new Vector3(x * 0.18, -0.035, z);
      const footAt = new Vector3(x * 0.27, -SEAT, z + (z > -0.2 ? 0.08 : -0.1));
      chair.add(rod(topAt, footAt, 0.013, maple, 0.011));
      feet.push(footAt);
      tops.push(topAt);
    }
  }
  const mid = (a: Vector3, b: Vector3, k: number): Vector3 => new Vector3().lerpVectors(a, b, k);
  for (let i = 0; i < 4; i++) chair.add(rod(mid(tops[i], feet[i], 0.45), new Vector3(0, -0.06, -0.155), 0.004, wire));
  chair.add(rod(mid(tops[0], feet[0], 0.45), mid(tops[2], feet[2], 0.45), 0.004, wire));
  chair.add(rod(mid(tops[1], feet[1], 0.45), mid(tops[3], feet[3], 0.45), 0.004, wire));
  chair.position.set(0, SEAT, 0);
  scene.add(shadowed(chair));
}

// ---- the laptop: silver, its lid on a hinge at the back of its base ----

const L = DESK.laptop;
const aluminium = new MeshPhysicalMaterial({ color: 0xcdd0d5, metalness: 0.55, roughness: 0.36, envMapIntensity: 4 });
const lid = new Group();
{
  const laptop = new Group();
  const base = box(L.width, L.base, L.depth, aluminium, 0.006);
  base.position.set(0, L.base / 2, L.depth / 2);
  laptop.add(base);
  // the keys in their well, the trackpad
  const keyMaterial = new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });
  const well = box(L.width - 0.03, 0.001, 0.105, new MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.7 }), 0.0005, 1);
  well.position.set(0, L.base + 0.0002, L.depth - 0.072);
  laptop.add(well);
  const cols = 14;
  const rows = 5;
  const keys = new InstancedMesh(new RoundedBoxGeometry(0.0205, 0.004, 0.0175, 2, 0.002), keyMaterial, cols * rows);
  const m = new Matrix4();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const across = (L.width - 0.05) / cols;
      if (r === 0 && c > 3 && c < 10) {
        // the space bar, once
        if (c !== 4) continue;
        m.compose(new Vector3(0, L.base + 0.0015, L.depth - 0.03), new Quaternion(), new Vector3(6.2, 1, 1));
      } else m.compose(new Vector3(-L.width / 2 + 0.025 + across * (c + 0.5), L.base + 0.0015, L.depth - 0.03 - r * 0.0205), new Quaternion(), new Vector3(1, 1, 1));
      keys.setMatrixAt(n++, m);
    }
  }
  keys.count = n;
  laptop.add(keys);
  const pad = box(0.12, 0.0008, 0.07, new MeshPhysicalMaterial({ color: 0xbfc2c7, metalness: 1, roughness: 0.42 }), 0.0004, 1);
  pad.position.set(0, L.base + 0.0002, 0.05);
  laptop.add(pad);
  // the lid (shut, it lies toward Muse from the hinge, its screen down): its shell, the screen
  const shell = box(L.width, 0.007, L.lid, aluminium, 0.0035);
  shell.position.set(0, 0.0035, -L.lid / 2);
  lid.add(shell);
  const screen = new Mesh(
    new PlaneGeometry(L.width - 0.024, L.lid - 0.03),
    new MeshBasicMaterial({
      map: painted(512, 280, (g) => {
        // an inbox and a calendar, bright
        g.fillStyle = '#f7f8fb';
        g.fillRect(0, 0, 512, 280);
        g.fillStyle = '#e6e9f0';
        g.fillRect(0, 0, 110, 280);
        g.fillStyle = '#4b7bea';
        g.fillRect(14, 16, 80, 18);
        for (let i = 0; i < 9; i++) {
          g.fillStyle = i === 1 ? '#dde7fb' : '#ffffff';
          g.fillRect(118, 12 + i * 29, 230, 25);
          g.fillStyle = '#9aa3b2';
          g.fillRect(126, 18 + i * 29, 70 + ((i * 37) % 60), 5);
          g.fillStyle = '#c4cad4';
          g.fillRect(126, 27 + i * 29, 150 + ((i * 53) % 60), 4);
        }
        for (let i = 0; i < 5; i++) {
          g.fillStyle = ['#ffd27a', '#9fc3ff', '#ffb59c', '#b8e3b0', '#d6c2ff'][i];
          g.fillRect(360, 16 + i * 50, 140, 36);
        }
      }),
      toneMapped: true,
    }),
  );
  screen.rotation.x = Math.PI / 2;
  screen.position.set(0, -0.0002, -L.lid / 2 - 0.004);
  lid.add(screen);
  lid.position.set(0, L.base, L.depth);
  laptop.add(lid);
  laptop.position.set(0, DESK_TOP, L.z);
  scene.add(shadowed(laptop));
}

// ---- the headphones: matte black, padded band, round cups; the band springs narrower off its head ----

const phones = new Group();
/** Shape the headphones: the band clamped back from its head's width (0 … 1, phonesShape), the cups swivelled flat (0 … 1). */
let shapePhones: (clamp: number, swivel: number) => void = () => undefined;
{
  const P = DESK.phones;
  const black = new MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.55 });
  const leather = new MeshStandardMaterial({ color: 0x141416, roughness: 0.4 });
  const steel = new MeshStandardMaterial({ color: 0x9a9ca3, roughness: 0.28, metalness: 1 });
  const cupProfile = [new Vector2(0.071, 0), new Vector2(0.074, 0.01), new Vector2(0.073, 0.028), new Vector2(0.065, 0.041), new Vector2(0.045, 0.049), new Vector2(0.0, 0.052)];
  // each cup about its middle (its own frame: x out from the head), on its slider at the band's end
  const cups = [1, -1].map((side) => {
    const cup = new Group();
    const shell = new Mesh(new LatheGeometry(cupProfile, 40), black);
    shell.rotation.z = -side * (Math.PI / 2);
    shell.position.x = -side * 0.006;
    cup.add(shell);
    const cushion = new Mesh(new TorusGeometry(0.052, 0.019, 16, 40), leather);
    cushion.rotation.y = Math.PI / 2;
    cushion.scale.set(1, 1.08, 1);
    cushion.position.x = -side * 0.018;
    cup.add(cushion);
    const fill = new Mesh(new CylinderGeometry(0.05, 0.05, 0.004, 32), new MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.9 }));
    fill.rotation.z = Math.PI / 2;
    fill.position.x = -side * 0.02;
    cup.add(fill);
    cup.add(rod(new Vector3(side * 0.014, 0.05, 0), new Vector3(side * 0.02, 0.098, 0), 0.0075, steel));
    const yoke = new Mesh(new TorusGeometry(0.06, 0.006, 8, 24, Math.PI), black);
    yoke.rotation.set(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    yoke.position.x = side * 0.012;
    yoke.scale.set(1, 0.95, 1);
    cup.add(yoke);
    phones.add(cup);
    return { cup, side };
  });
  // the band: over the head from slider to slider, a padded cushion under its top; narrower and a little taller as it clamps
  const y0 = 0.092;
  const arcFor = (clamp: number) => {
    const a = phonesSpan(clamp) + 0.022;
    const b = P.band + 0.03 + 0.05 * Math.min(1, clamp);
    return (s: number, out: Vector3): Vector3 => {
      const th = Math.PI * s;
      return out.set(a * Math.cos(th), y0 + (b - y0) * Math.sin(th) ** 0.85, 0);
    };
  };
  const band = new Mesh(new BufferGeometry(), black);
  const pad = new Mesh(new BufferGeometry(), leather);
  phones.add(band, pad);
  let shaped = Number.NaN;
  shapePhones = (clamp: number, swivel: number): void => {
    for (const { cup, side } of cups) {
      cup.position.set(side * phonesSpan(clamp), 0, 0);
      // (swivelled about the slider to lie flat, pads down; clamped, tipped in at the bottom a little)
      cup.rotation.set(0, side * swivel * (Math.PI / 2), -side * 0.16 * Math.min(1, clamp), 'YXZ');
    }
    if (Math.abs(clamp - shaped) < 1e-4) return;
    shaped = clamp;
    const arc = arcFor(clamp);
    band.geometry.dispose();
    band.geometry = sweep(arc, 72, 0.042, 0.015, 0.006, new Vector3(0, 0, 1));
    pad.geometry.dispose();
    pad.geometry = sweep(
      (s, out) => {
        arc(0.22 + 0.56 * s, out);
        return out.set(out.x * 0.975, (out.y - y0) * 0.968 + y0 - 0.002, 0);
      },
      48,
      0.038,
      0.022,
      0.009,
      new Vector3(0, 0, 1),
    );
  };
  shapePhones(0, 0);
  scene.add(shadowed(phones));
}

// ---- the phone on its stand, its cable over the desk's edge ----

{
  const stand = new Group();
  const plate = box(0.085, 0.008, 0.1, aluminium, 0.003);
  plate.position.set(0, 0.004, 0);
  stand.add(plate);
  const back = box(0.068, 0.13, 0.006, aluminium, 0.002);
  back.position.set(0, 0.07, -0.022);
  back.rotation.x = -0.32;
  stand.add(back);
  const lip = box(0.07, 0.014, 0.012, aluminium, 0.003);
  lip.position.set(0, 0.026, 0.012);
  stand.add(lip);
  const phone = new Group();
  const body = box(0.074, 0.152, 0.0085, new MeshPhysicalMaterial({ color: 0x2b2c30, roughness: 0.25, clearcoat: 0.7 }), 0.009);
  phone.add(body);
  const glass = new Mesh(new PlaneGeometry(0.068, 0.146), new MeshPhysicalMaterial({ color: 0x08090b, roughness: 0.08, clearcoat: 1 }));
  glass.position.z = 0.0044;
  phone.add(glass);
  const bump = box(0.034, 0.034, 0.004, new MeshPhysicalMaterial({ color: 0x323338, roughness: 0.2, clearcoat: 0.8 }), 0.007);
  bump.position.set(-0.016, 0.052, -0.006);
  phone.add(bump);
  const lens = new MeshPhysicalMaterial({ color: 0x050608, roughness: 0.05, clearcoat: 1 });
  const ring = new MeshStandardMaterial({ color: 0x77797f, roughness: 0.3, metalness: 1 });
  for (const [x, y] of [
    [-0.024, 0.06],
    [-0.008, 0.06],
    [-0.016, 0.044],
  ] as const) {
    const r = new Mesh(new CylinderGeometry(0.0068, 0.0068, 0.003, 20), ring);
    r.rotation.x = Math.PI / 2;
    r.position.set(x, y, -0.0085);
    const g = new Mesh(new CylinderGeometry(0.0052, 0.0052, 0.0034, 20), lens);
    g.rotation.x = Math.PI / 2;
    g.position.set(x, y, -0.0087);
    phone.add(r, g);
  }
  phone.position.set(0, 0.098, -0.004);
  phone.rotation.x = -0.32;
  stand.add(phone);
  // its screen toward Muse's head
  stand.position.set(0.5, DESK_TOP, 0.5);
  stand.rotation.y = 2.45;
  scene.add(shadowed(stand));
  const cable = new CatmullRomCurve3([
    new Vector3(0.5, DESK_TOP + 0.004, 0.47).add(new Vector3(0.025, 0, -0.03)),
    new Vector3(0.58, DESK_TOP + 0.003, 0.4),
    new Vector3(0.7, DESK_TOP + 0.003, 0.36),
    new Vector3(0.79, DESK_TOP + 0.003, 0.4),
    new Vector3(TABLE.half + 0.006, DESK_TOP - 0.01, 0.43),
    new Vector3(TABLE.half + 0.01, DESK_TOP - 0.25, 0.45),
  ]);
  scene.add(shadowed(new Mesh(new TubeGeometry(cable, 80, 0.0028, 8), new MeshStandardMaterial({ color: 0xeeeeec, roughness: 0.5 }))));
}

// ---- the pen pot, the notebook, the paper crane ----

{
  const pot = new Group();
  const profile = [new Vector2(0, 0), new Vector2(0.039, 0), new Vector2(0.042, 0.004), new Vector2(0.044, 0.1), new Vector2(0.041, 0.104), new Vector2(0.038, 0.1), new Vector2(0.036, 0.008), new Vector2(0, 0.008)];
  pot.add(new Mesh(new LatheGeometry(profile, 48), new MeshStandardMaterial({ color: 0x7f9c86, roughness: 0.5 })));
  const pens: [number, number, number, number, number][] = [
    [0x1d1e22, 0.012, 0.008, 0.16, 0.0055],
    [0xf0efe8, -0.013, 0.011, 0.15, 0.0058],
    [0xd9772e, 0.004, -0.014, 0.17, 0.005],
    [0x6b6f78, -0.009, -0.006, 0.155, 0.0048],
    [0x1d1e22, 0.016, -0.004, 0.145, 0.0052],
  ];
  pens.forEach(([colour, x, z, length, r], i) => {
    const a = new Vector3(x * 0.6, 0.012, z * 0.6);
    const b = new Vector3(x * 3.2 + 0.006 * Math.sin(i * 2.3), 0.012 + length, z * 3.2 + 0.006 * Math.cos(i * 1.7));
    pot.add(rod(a, b, r, new MeshStandardMaterial({ color: colour, roughness: 0.45 })));
    const cap = new Mesh(new CylinderGeometry(r * 0.75, r, 0.018, 12), new MeshStandardMaterial({ color: i === 2 ? 0x2a2a2a : 0x8d9097, roughness: 0.4, metalness: i === 2 ? 0 : 0.8 }));
    cap.position.copy(b);
    cap.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3().subVectors(b, a).normalize());
    pot.add(cap);
  });
  pot.position.set(-0.13, DESK_TOP, 0.76);
  scene.add(shadowed(pot));

  const book = new Group();
  const cover = box(0.165, 0.019, 0.225, new MeshStandardMaterial({ color: 0x1f2a45, roughness: 0.62 }), 0.004);
  cover.position.y = 0.0095;
  book.add(cover);
  const pages = box(0.158, 0.014, 0.214, new MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.9 }), 0.002);
  pages.position.set(0.005, 0.0095, 0);
  book.add(pages);
  const band = box(0.006, 0.0195, 0.227, new MeshStandardMaterial({ color: 0x15192a, roughness: 0.5 }), 0.002);
  band.position.set(0.06, 0.0095, 0);
  book.add(band);
  book.position.set(-0.47, DESK_TOP, 0.79);
  book.rotation.y = 0.22;
  scene.add(shadowed(book));

  // the paper crane: its body, raised wings, neck and tail, folded flat
  const v = (x: number, y: number, z: number): number[] => [x, y, z];
  const tri: number[] = [];
  const face = (a: number[], b: number[], c: number[]): void => {
    tri.push(...a, ...b, ...c);
  };
  const nose = v(0.034, 0.016, 0);
  const tailRoot = v(-0.034, 0.016, 0);
  const ridge = v(0, 0.036, 0);
  const belly = v(0, 0.0, 0);
  for (const s of [1, -1]) {
    const flank = v(0, 0.018, 0.012 * s);
    face(nose, ridge, flank);
    face(ridge, tailRoot, flank);
    face(nose, flank, belly);
    face(flank, tailRoot, belly);
    // a wing up from the ridge
    face(v(0.018, 0.03, 0), v(-0.016, 0.03, 0), v(-0.006, 0.075, 0.085 * s));
  }
  face(nose, v(0.03, 0.02, 0.004), v(0.066, 0.083, 0));
  face(nose, v(0.066, 0.083, 0), v(0.03, 0.02, -0.004));
  face(v(0.066, 0.083, 0), v(0.081, 0.073, 0.002), v(0.06, 0.07, 0));
  face(tailRoot, v(-0.03, 0.02, 0.004), v(-0.072, 0.07, 0));
  face(tailRoot, v(-0.072, 0.07, 0), v(-0.03, 0.02, -0.004));
  const craneGeometry = new BufferGeometry();
  craneGeometry.setAttribute('position', new Float32BufferAttribute(tri, 3));
  craneGeometry.computeVertexNormals();
  const crane = new Mesh(craneGeometry, new MeshStandardMaterial({ color: 0xf0a43a, roughness: 0.85, side: DoubleSide, flatShading: true }));
  crane.scale.setScalar(1.25);
  crane.position.set(0.47, DESK_TOP, 0.83);
  crane.rotation.y = -0.7;
  scene.add(shadowed(crane));
}

// ---- the light: the sun through a window on its right, the room's own, the sky ----

const keyLight = new DirectionalLight(0xfff5ea, 3.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096);
keyLight.shadow.camera.left = -1.7;
keyLight.shadow.camera.right = 1.7;
keyLight.shadow.camera.top = 1.7;
keyLight.shadow.camera.bottom = -1.7;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 14;
keyLight.shadow.bias = -0.0003;
keyLight.shadow.normalBias = 0.012;
keyLight.shadow.radius = 2.5;
const keyAt = new Vector3(0, 0.9, 0.2);
keyLight.target.position.copy(keyAt);
scene.add(keyLight, keyLight.target);
// the window's square of sun on the wall, its bars in it
const windowLight = new SpotLight(0xfff0dc, 2.2, 0, 0.17, 0.12, 0);
windowLight.map = painted(256, 256, (g) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.filter = 'blur(5px)';
  g.fillStyle = '#fff';
  for (const [x, y] of [
    [36, 30],
    [134, 30],
    [36, 132],
    [134, 132],
  ])
    g.fillRect(x, y, 86, 92);
});
windowLight.castShadow = true;
windowLight.shadow.mapSize.set(2048, 2048);
windowLight.shadow.bias = -0.0004;
windowLight.shadow.radius = 3;
const windowAt = new Vector3(-0.62, 1.32, WALL.z);
windowLight.position.set(-3.6, 2.9, 1.9);
windowLight.target.position.copy(windowAt);
scene.add(windowLight, windowLight.target);
scene.add(new HemisphereLight(0xf8f9fb, 0xd6cfc5, 0.95));

// ---- Muse ----

const loaded = await loadSculpt('tpose6');
const body = loaded.body;
const rig = new MuseRig(fitOf('tpose6', body));
// (its reaches here go far, up to the lid and the cups: steps enough for each to settle, the upper arm's and the
// forearm's twists held still, and each reach kept near the arm's start for it, museRig.ts ARMS)
rig.reachSteps = 32;
rig.reachPrior = [0.02, 10, 0.02, 0.01, 10];
const museAt = new Vector3(0, SEAT, 0);
const museGeometry = new InstancedBufferGeometry();
museGeometry.setIndex(new BufferAttribute(body.index, 1));
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
for (const [name, array, size] of attributes) if (array) museGeometry.setAttribute(name, new BufferAttribute(array as Float32Array, size));
museGeometry.instanceCount = SHELLS + 1;
const defines: Record<string, number> = { MUSE_STUDIO: 1, MUSE_FLUSTER: 1 };
if (body.colour) defines.MUSE_COLOURED = 1;
if (body.raise && body.raiseNormal && body.raiseOpen) defines.MUSE_RAISE = 1;
if (body.hang && body.hangNormal) defines.MUSE_HANG = 1;
if (body.comb) defines.MUSE_COMB = 1;
const museFrame = new Matrix3();
const u: Record<string, IUniform> = {
  uBones: { value: rig.skin },
  uBoneDQ: { value: rig.dual },
  uMusePos: { value: museAt },
  uMuseFrame: { value: museFrame },
  uMuseSize: { value: new Vector4(1, FUR_LENGTH / MUSE_HEIGHT, SHELLS, 0) },
  uMuseWind: { value: new Vector4() },
  uMuseFace: { value: new Vector4(1, 0, 0, 0) },
  uMuseMood: { value: new Vector4() },
  uMuseFluster: { value: new Vector4(0, 0, 0, 2) },
  uMuseRipple: { value: 0 },
  uMuseFluff: { value: rig.fluff },
  uMuseGrade: { value: loaded.grade },
  uMuseRaise: { value: new Vector4(0, 0, 1, 1) },
  uStudioSun: { value: KEY },
  uSunDir: { value: KEY },
  uSunTint: { value: new Color(1.0, 0.95, 0.88) },
  uShadeTint: { value: new Color(1.16, 1.04, 0.88) },
  uToon: { value: new Vector4(3, 0.08, 0.6, 0) },
  uWarpFocus: { value: new Vector3() },
  uWarpUp: { value: new Vector3(0, 1, 0) },
  uWarpK: { value: 0 },
  uTime: { value: 0 },
  uRadius: { value: 128 },
};
const museMaterial = new ShaderMaterial({
  vertexShader,
  fragmentShader: fragmentShader.replace(/}\s*$/, '  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}\n'),
  defines,
  uniforms: u,
});
dressMuse(museGeometry, museMaterial, body, loaded.paint);
const muse = new Mesh(museGeometry, museMaterial);
muse.frustumCulled = false;
scene.add(muse);
// its shadow: its skin alone, skinned as it is drawn and a little out into its fur, into the lights' maps (not drawn)
{
  const g = new InstancedBufferGeometry();
  g.setIndex(museGeometry.getIndex());
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight', 'aFur']) g.setAttribute(name, museGeometry.getAttribute(name));
  g.instanceCount = 1;
  const caster = new Mesh(g, new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  caster.frustumCulled = false;
  caster.castShadow = true;
  caster.customDepthMaterial = new ShaderMaterial({
    uniforms: { uBones: u.uBones, uMusePos: u.uMusePos, uMuseFrame: u.uMuseFrame, uMuseSize: u.uMuseSize },
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
}

// ---- the sweat: drops popping off its head as it panics, flying off and falling ----

const DROPS = 28;
const dropMesh = (() => {
  const profile: Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI * (1 - i / 24);
    profile.push(new Vector2(0.55 * Math.sin(t) * Math.sin(t / 2) ** 0.9, Math.cos(t)));
  }
  const g = new LatheGeometry(profile, 24);
  const mesh = new InstancedMesh(
    g,
    new MeshPhysicalMaterial({ color: 0x8fd3ff, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x2f78b8, emissiveIntensity: 0.45, envMapIntensity: 1.4 }),
    DROPS,
  );
  mesh.frustumCulled = false;
  mesh.count = DROPS;
  return mesh;
})();
scene.add(dropMesh);

/** A clock of a rate (per s, a function of time), sampled finely and summed: its count at any time, by interpolation. */
function clock(rate: (t: number) => number, end: number, step = 1 / 240): (t: number) => number {
  const n = Math.ceil(end / step) + 2;
  const sum = new Float64Array(n);
  for (let i = 1; i < n; i++) sum[i] = sum[i - 1] + 0.5 * (rate((i - 1) * step) + rate(i * step)) * step;
  return (t: number): number => {
    const x = Math.max(0, Math.min(n - 1.001, t / step));
    const i = Math.floor(x);
    return sum[i] + (sum[i + 1] - sum[i]) * (x - i);
  };
}

/** How hurried its typing is (0 calm … 1 frantic): calm, then quickening from `ramp`, frantic by `frantic`, gone at `stop`. */
function rushAt(t: number): number {
  const B = BEATS;
  const up = 0.62 * smoothstep(B.ramp, B.frantic - 1.4, t) + 0.38 * smoothstep(B.frantic - 2.8, B.frantic, t);
  return up * (1 - smoothstep(B.stop + 0.05, B.stop + 0.75, t));
}
/** How quickly it types (keys a second): in bursts with little pauses between while calm, a steady hammering when frantic, still once it stops. */
function typingRate(t: number): number {
  const rush = rushAt(t);
  const wave = 0.5 + 0.26 * Math.sin(t * 2.3 + 0.4) + 0.16 * Math.sin(t * 3.9 + 1.9) + 0.1 * Math.sin(t * 6.7 + 4.2);
  const pause = smoothstep(0.34, 0.2, wave);
  const calm = Math.max(0.05, 1.5 * wave * (1 - 0.9 * pause));
  const burst = calm + (1 + 0.12 * Math.sin(t * 9.1) - calm) * smoothstep(0.2, 0.7, rush);
  const glance = HI ? 1 - 0.6 * hiAt(t) : 1;
  const stopped = 1 - smoothstep(BEATS.stop - 0.04, BEATS.stop + 0.06, t);
  return (4.4 + 11 * rush ** 1.25) * burst * glance * stopped;
}
/** Its glance at you as it is introduced (0 … 1). */
function hiAt(t: number): number {
  return smoothstep(0.45, 0.85, t) * (1 - smoothstep(1.75, 2.2, t));
}
const tapsAt = clock(typingRate, BEATS.end + 1);
/** Its sweat: how many drops a second while it panics (and a moment after it stops). */
const dropsAt = clock((t) => 11 * smoothstep(0.42, 0.95, Math.max(rushAt(t), rushAt(t - 0.35) * 0.8)), BEATS.end + 1, 1 / 480);

/** What it is doing at a moment: its moves (typing, then each of the rest coming in over a third of a second), and where it looks. */
function act(t: number): { moves: Move[]; glance: number } {
  const B = BEATS;
  const fade = (a: number): number => smoothstep(a, a + 0.35, t);
  const lidIn = fade(B.lid);
  const phonesIn = fade(B.phones);
  const unwindIn = fade(B.unwind);
  const moves: Move[] = [{ kind: 'type', time: t, amount: 1 - lidIn, rush: rushAt(t), taps: tapsAt(t) }];
  if (t >= B.lid) moves.push({ kind: 'lid', time: t - B.lid, amount: lidIn * (1 - phonesIn) });
  if (t >= B.phones) moves.push({ kind: 'phones', time: t - B.phones, amount: phonesIn * (1 - unwindIn) });
  if (t >= B.unwind) moves.push({ kind: 'unwind', time: t - B.unwind, amount: unwindIn });
  return { moves, glance: HI ? hiAt(t) : 0 };
}

// ---- the camera: across the desk from its right front, pushing in as it panics, back out for the rest ----

interface Shot {
  at: number;
  target: [number, number, number];
  round: number;
  up: number;
  distance: number;
}
const SHOTS: Shot[] = [
  { at: 0, target: [0.03, 0.99, 0.32], round: -32, up: 5, distance: 1.85 },
  { at: BEATS.ramp, target: [0.03, 0.99, 0.32], round: -32, up: 5, distance: 1.85 },
  { at: BEATS.stop, target: [0.0, 1.04, 0.22], round: -29, up: 4.5, distance: 1.42 },
  { at: BEATS.lid + 0.2, target: [0.0, 1.04, 0.22], round: -29, up: 4.5, distance: 1.42 },
  { at: BEATS.phones + 0.8, target: [0.02, 1.02, 0.3], round: -31, up: 5, distance: 1.7 },
  { at: BEATS.unwind + 0.6, target: [0.0, 1.07, 0.2], round: -32, up: 5, distance: 1.95 },
  { at: BEATS.end, target: [0.0, 1.06, 0.2], round: -33, up: 5.5, distance: 1.88 },
];
const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 30);
const free = params.get('free') === '1';
const controls = free ? new OrbitControls(camera, canvas) : null;
const held0 = params.get('cam')?.split(',').map(Number);
function aim(t: number): void {
  if (controls) return;
  if (held0 && held0.length === 6) {
    const [round, up, d, x, y, z] = held0;
    const r = (round * Math.PI) / 180;
    const e = (up * Math.PI) / 180;
    camera.position.set(x + d * Math.cos(e) * Math.sin(r), y + d * Math.sin(e), z + d * Math.cos(e) * Math.cos(r));
    camera.lookAt(x, y, z);
    return;
  }
  let i = 0;
  while (i < SHOTS.length - 2 && t > SHOTS[i + 1].at) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  const k = smoothstep(a.at, Math.max(a.at + 1e-3, b.at), t);
  const mix = (x: number, y: number): number => x + (y - x) * k;
  const target = new Vector3(mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2]));
  const round = (mix(a.round, b.round) * Math.PI) / 180;
  const up = (mix(a.up, b.up) * Math.PI) / 180;
  const d = mix(a.distance, b.distance);
  camera.position.set(target.x + d * Math.cos(up) * Math.sin(round), target.y + d * Math.sin(up), target.z + d * Math.cos(up) * Math.cos(round));
  camera.lookAt(target);
}
if (controls) {
  aim(0);
  camera.position.set(-1.3, 1.25, 2.1);
  controls.target.set(0, 0.95, 0.25);
  controls.update();
}

// ---- a moment ----

const head = new Matrix4();
const held = new Matrix4();
const m4 = new Matrix4();
const tmp = new Vector3();
const tmp2 = new Vector3();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const headRest = rig.fit.rest[JOINT.head];

/** Everything at time t: Muse's pose and face, the lid, the headphones, the sweat. */
function pose(t: number): void {
  const { moves, glance } = act(t);
  // (the glance: toward the camera, which is off to its right front)
  const toCamera = Math.atan2(camera.position.x - museAt.x, camera.position.z - museAt.z);
  rig.pose({ time: t, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: toCamera / 0.9, lookPitch: -0.05, look: glance, moves });
  if (glance > 0) {
    rig.squint += (1 - rig.squint) * glance;
    rig.smile += (0.85 - rig.smile) * glance;
    rig.blush += (0.4 - rig.blush) * glance;
  }
  (u.uMuseFace.value as Vector4).set(rig.eyes, rig.smile, rig.squint, rig.squeeze);
  (u.uMuseMood.value as Vector4).set(rig.blush, 0, 0, 0);
  (u.uMuseRaise.value as Vector4).set(rig.raised, rig.raisedRight, rig.hung, rig.hungRight);
  (u.uMuseFluster.value as Vector4).set(rig.spiral, rig.spiralTurn, rig.wavy, rig.ripples);
  u.uMuseRipple.value = rig.ripplePhase;
  u.uTime.value = t;
  // the lid: open until it is closed
  const open = t < BEATS.lid ? 1 : Math.max(0, Math.min(1.04, lidBeats(t - BEATS.lid).open));
  lid.rotation.x = open * L.open;
  // the headphones: on its head, then off and down onto the laptop
  rig.frameOf(JOINT.head, head);
  const p = t < BEATS.phones ? { off: 0, down: 0 } : phonesBeats(t - BEATS.phones);
  phonesFrame(p.off, p.down, head, headRest, held);
  const shape = t < BEATS.phones ? { clamp: 0, swivel: 0 } : phonesShape(t - BEATS.phones);
  shapePhones(shape.clamp, shape.swivel);
  // (while its mittens hold them, they go where the mittens are: moved by how far the mittens' middle is from the grip's)
  const carried = t < BEATS.phones ? 0 : smoothstep(0.02, 0.3, p.off) * (1 - smoothstep(0.8, 1, p.down));
  if (carried > 0) {
    const g = phonesGrip(p.off);
    const off = tmp.set(0, 0, 0);
    for (const side of [1, -1]) {
      rig.handFrame(side, m4);
      off.x += 0.5 * m4.elements[12];
      off.y += 0.5 * m4.elements[13];
      off.z += 0.5 * m4.elements[14];
    }
    off.x -= held.elements[12];
    off.y -= held.elements[13] + g[1];
    off.z -= held.elements[14] + g[2];
    held.elements[12] += off.x * carried;
    held.elements[13] += off.y * carried;
    held.elements[14] += off.z * carried;
  }
  held.premultiply(new Matrix4().makeTranslation(museAt.x, museAt.y, museAt.z));
  held.decompose(phones.position, phones.quaternion, phones.scale);
  // the sweat: each drop born on its head at its time, flying off and falling, popping in and shrinking away
  const born = dropsAt(t);
  const m = new Matrix4();
  const centre = tmp.set(0, 0.09, 0).applyMatrix4(head).add(museAt);
  for (let k = 0; k < DROPS; k++) {
    // (the drops alive now: the newest DROPS of them)
    const i = Math.floor(born) - k;
    const life = 0.62 + 0.3 * hash(i, 1);
    const age = i >= 0 ? (t - timeOfDrop(i)) : -1;
    if (i < 0 || age < 0 || age > life) {
      m.makeScale(0, 0, 0);
      dropMesh.setMatrixAt(k, m);
      continue;
    }
    // where it springs from: round the top and sides of its head, more to the sides
    const side = hash(i, 2) < 0.5 ? -1 : 1;
    const dir = tmp2.set(side * (0.55 + 0.45 * hash(i, 3)), 0.35 + 0.75 * hash(i, 4), -0.25 + 0.7 * hash(i, 5)).normalize();
    const speed = 0.55 + 0.45 * hash(i, 6);
    const start = centre.clone().addScaledVector(dir, 0.26);
    const vx = dir.x * speed;
    const vy = dir.y * speed + 0.45;
    const vz = dir.z * speed;
    const g = -3.4;
    const at = new Vector3(start.x + vx * age, start.y + vy * age + 0.5 * g * age * age, start.z + vz * age);
    const vel = new Vector3(vx, vy + g * age, vz).normalize();
    const size = (0.016 + 0.01 * hash(i, 7)) * Math.min(1, age / 0.07) * (1 + 0.25 * Math.sin(Math.PI * Math.min(1, age / 0.14))) * (1 - smoothstep(life - 0.18, life, age));
    // its point trailing behind it
    q.setFromUnitVectors(up, vel.negate());
    m.compose(at, q, new Vector3(size, size * 1.05, size));
    dropMesh.setMatrixAt(k, m);
  }
  dropMesh.instanceMatrix.needsUpdate = true;
  aim(t);
}
/** A number in [0, 1) for a drop and a salt. */
function hash(i: number, salt: number): number {
  const h = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return h - Math.floor(h);
}
/** When the ith drop was born (s): where the drops' clock passes i (found by bisection; the clock only rises). */
function timeOfDrop(i: number): number {
  let lo = 0;
  let hi = BEATS.end + 1;
  for (let k = 0; k < 30; k++) {
    const mid = 0.5 * (lo + hi);
    if (dropsAt(mid) < i + 0.5) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---- drawing: a moment averaged over the shutter, the light over its window, the view over a pixel ----

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
      #include <tonemapping_fragment>
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
const background = new Color(WALL.colour);
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
    pose(t + s * shutter);
    if (controls) controls.update();
    // the sun from somewhere over its window (a soft edge to every shadow), the view by a fraction of a pixel
    const jx = samples > 1 ? halton(i, 2) - 0.5 : 0;
    const jy = samples > 1 ? halton(i, 3) - 0.5 : 0;
    const a = samples > 1 ? halton(i, 5) * Math.PI * 2 : 0;
    const r = samples > 1 ? 0.3 * Math.sqrt(halton(i, 7)) : 0;
    const side = tmp.set(-KEY.z, 0, KEY.x).normalize();
    const lift = tmp2.crossVectors(KEY, side).normalize();
    keyLight.position.copy(keyAt).addScaledVector(KEY, 6).addScaledVector(side, r * 6 * Math.cos(a) * 0.1).addScaledVector(lift, r * 6 * Math.sin(a) * 0.1);
    windowLight.position.set(-3.6 + 0.25 * r * Math.cos(a), 2.9 + 0.25 * r * Math.sin(a), 1.9);
    if (samples > 1) camera.setViewOffset(w, h, jx, jy, w, h);
    else camera.clearViewOffset();
    renderer.setRenderTarget(sampleTarget);
    renderer.setClearColor(background, 1);
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
  beats: BEATS,
  length: BEATS.end,
  frame,
  /** Where Muse's mittens are now and where the rig wanted them (m), for checking reaches. */
  hands(): number[][] {
    const out: number[][] = [];
    for (const s of [1, -1]) {
      rig.handFrame(s, held);
      out.push([held.elements[12], held.elements[13], held.elements[14]]);
    }
    return out;
  },
  rig,
};
(window as unknown as { museDesk: typeof api }).museDesk = api;
if (params.get('live') === '1') {
  let t = Number(params.get('t') ?? 0);
  let paused = false;
  let last = performance.now();
  addEventListener('keydown', (event) => {
    const keys = [0, BEATS.ramp, BEATS.stop - 1.5, BEATS.lid - 0.3, BEATS.phones - 0.3, BEATS.unwind - 0.3];
    if (event.key === ' ') paused = !paused;
    else if (event.key === 'ArrowRight') t += event.shiftKey ? 0.5 : 1 / 30;
    else if (event.key === 'ArrowLeft') t = Math.max(0, t - (event.shiftKey ? 0.5 : 1 / 30));
    else if (event.key >= '1' && event.key <= '6') t = keys[Number(event.key) - 1];
    else return;
    event.preventDefault();
  });
  renderer.setAnimationLoop((now) => {
    if (!paused) t += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (t > BEATS.end) t = 0;
    frame(t, 1);
  });
} else frame(Number(params.get('t') ?? 0), Number(params.get('samples') ?? 1), 0.5 / 30);
(window as unknown as { museLabReady: boolean }).museLabReady = true;
