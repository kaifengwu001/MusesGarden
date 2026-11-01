import type {
  Object3D,
  PerspectiveCamera,
  Scene} from 'three';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LatheGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  PointLight,
  Quaternion,
  Ray,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { smoothstep } from '../core/math';
import { JOINT } from '../life/museBody';
import { BED, BENCH, CAST, FIRE, MuseLife, POND, flowerAt, type Living } from '../life/museLife';
import { COOK, FISH, POT, STIR, cookBeats, fishBeats, gardenBeats, sleepBeats, type MuseRig } from '../life/museRig';

// The Muse lab's stage (museLab.html#live=1&stage=1): a round lawn in a
// pale sky where Muse lives its little day (museLife.ts) among the things
// its pastimes need, so they can be seen together and played with before
// they go into the meadow. A disc of ground and a few tens of thousands of
// grass blades; the meadow's bench (props.ts, in Muse's heights); a pond with
// lily pads and reeds; a flower bed; a campfire with a pot on a trivet; and
// what Muse holds or makes: a rod, its line, float and the fish; a watering
// can and its water; a ladle and the pot's steam; a snore bubble and Zzz; a
// few hearts, notes and sparkles. Everything is in Muse's heights (it is one
// tall), x to the right, z toward the camera.
//
// The light is one sun (the studio's, from the front, a little left and
// above, as Muse's own shader has it) and the sky. Muse's shadow, soft, falls
// on the ground and the grass from a few spheres about its posed body, and
// the same spheres push the grass aside: it parts where Muse walks and lies
// flat round it as it naps. Click Muse to answer it (a tap: a wave or a happy
// bounce); hold to pet it; while it sleeps a tap only stirs it.

/** The sun (toward it) and the sky's colours (linear): the horizon, the top. */
const SUN = new Vector3(-0.42, 0.72, 0.55).normalize();
const HORIZON = new Color(0.74, 0.84, 0.9);
const ZENITH = new Color(0.3, 0.52, 0.82);
/** The lawn's radius (H) and its blades: how many to a square H, their height. */
const LAWN = { radius: 6.2, edge: 1.6, density: 230, height: [0.07, 0.19] } as const;
/** Muse's shadow and its push on the grass: spheres about its body (the first CASTERS_MUSE), then the props' still ones. */
const CASTERS = 16;
const CASTERS_MUSE = 9;

const tones = (() => {
  const t = new DataTexture(new Uint8Array([120, 120, 120, 255, 196, 196, 196, 255, 255, 255, 255, 255]), 3, 1, RGBAFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const toon = (color: number, extra: Record<string, unknown> = {}): MeshToonMaterial => new MeshToonMaterial({ color, gradientMap: tones, ...extra });

/** The shadows' code, shared by the ground and the grass: how much of the sun the spheres (x, y, z, radius) take from a point, softer the further they are, with a little contact darkening under each. */
const SHADOW_GLSL = /* glsl */ `
uniform vec4 uCasters[${CASTERS}];
uniform vec3 uSun;
float shadowAt(vec3 p) {
  float lit = 1.0;
  for (int i = 0; i < ${CASTERS}; i++) {
    vec4 c = uCasters[i];
    if (c.w <= 0.0) continue;
    vec3 d = c.xyz - p;
    float along = dot(d, uSun);
    float off = length(d - uSun * along);
    float soft = c.w * 0.45 + max(along, 0.0) * 0.22;
    float sh = along > 0.0 ? 1.0 - smoothstep(c.w - soft, c.w + soft, off) : 0.0;
    float near = clamp(c.w * c.w / max(dot(d, d), 1e-4), 0.0, 1.0);
    lit *= (1.0 - 0.62 * sh) * (1.0 - 0.3 * near * near);
  }
  return lit;
}
`;

/** A sprite of a glyph (a heart, a note, a Z), drawn once on a canvas: filled, outlined in white. */
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
  t.colorSpace = 'srgb';
  return t;
}

/** A sprite that rises and fades, one of a few staggered in turn: where it is u (0 … 1) through its rise. */
function riser(material: SpriteMaterial, size: number): Sprite {
  const s = new Sprite(material.clone());
  s.scale.setScalar(size);
  s.visible = false;
  return s;
}

export interface StageMuse {
  rig: MuseRig;
  /** Muse's material's uniforms: its place and frame, its face, its raise, its fur. */
  uniforms: Record<string, IUniform>;
}

export interface Stage {
  /** Play the stage to a time (s): Muse's day and your doings, the props, the shadows, the grass, the camera's follow. */
  update(t: number, dt: number): void;
  /** Muse's place on the stage (its frame, H): the bones are drawn in it. */
  place: Matrix4;
  /** Set the day's clock to `day` s at time t (the camera jumps to Muse). */
  seek(t: number, day: number): void;
  /** The day's parts and their starts (s). */
  readonly names: { name: string; start: number }[];
  /** Look at Muse from a bearing round it (rad, from its front), a height (rad) and a distance (H). */
  frame(round: number, up: number, distance: number): void;
  /** Your doings, as a script would do them: a tap, a hold (+1 on its left), letting go. */
  tap(t: number): void;
  hold(t: number, side: number): void;
  letGo(t: number): void;
  /** The legend's lines, and a key (returns whether it was the stage's). */
  legend(): string;
  key(event: KeyboardEvent, t: number): boolean;
}

export function buildStage(scene: Scene, camera: PerspectiveCamera, canvas: HTMLCanvasElement, controls: OrbitControls, muse: StageMuse): Stage {
  const life = new MuseLife();
  const { rig } = muse;
  const u = muse.uniforms;
  const casters = Array.from({ length: CASTERS }, () => new Vector4());
  const shared = { uCasters: { value: casters }, uSun: { value: SUN }, uTime: { value: 0 } };
  u.uStudioSun.value = SUN;

  // ---- the sky, the light ----
  const sky = new Mesh(
    new SphereGeometry(30, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { uHorizon: { value: HORIZON }, uZenith: { value: ZENITH } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(mix(uHorizon, uZenith, pow(clamp(vDir.y, 0.0, 1.0), 0.55)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -100;
  scene.add(sky);
  const sun = new DirectionalLight(0xfff3e6, 2.1);
  sun.position.copy(SUN).multiplyScalar(10);
  scene.add(sun, new HemisphereLight(0xd8ecff, 0x7a9c62, 1.15));

  // ---- the ground ----
  const ground = new Mesh(
    new CircleGeometry(LAWN.radius + LAWN.edge, 128).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      uniforms: { ...shared, uHorizon: { value: HORIZON }, uPond: { value: new Vector3(POND.x, POND.z, POND.r) } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${SHADOW_GLSL}
        uniform vec3 uHorizon;
        uniform vec3 uPond;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 p = vWorld.xz;
          float n = 0.6 * noise(p * 0.9) + 0.4 * noise(p * 3.1);
          vec3 col = mix(vec3(0.16, 0.3, 0.08), vec3(0.27, 0.42, 0.12), n);
          // damp, darker earth round the pond's edge
          float shore = 1.0 - smoothstep(uPond.z, uPond.z + 0.45, length(p - uPond.xy));
          col = mix(col, vec3(0.2, 0.2, 0.1), 0.6 * shore);
          col *= 0.62 + 0.38 * shadowAt(vWorld);
          // the lawn's edge, into the haze
          col = mix(col, uHorizon, smoothstep(${LAWN.radius.toFixed(1)} - 0.4, ${(LAWN.radius + LAWN.edge).toFixed(1)}, length(p)));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  ground.renderOrder = -50;
  scene.add(ground);

  // ---- the grass ----
  /** How far Muse is lying in it (0 … 1): it presses the grass down round it only then. */
  const press = { value: 0 };
  {
    const blade = new InstancedBufferGeometry();
    const levels = [0, 0.36, 0.7];
    const widths = [1, 0.8, 0.5];
    const pos: number[] = [];
    levels.forEach((y, k) => pos.push(-0.5 * widths[k], y, 0, 0.5 * widths[k], y, 0));
    pos.push(0, 1, 0);
    blade.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    blade.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
    // blue-noise-ish: jittered cells, none in the pond, the bed, the fire or under the bench's feet
    const data: number[] = [];
    const cell = 1 / Math.sqrt(LAWN.density);
    let seed = 1;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let x = -LAWN.radius; x < LAWN.radius; x += cell) {
      for (let z = -LAWN.radius; z < LAWN.radius; z += cell) {
        const px = x + cell * rnd();
        const pz = z + cell * rnd();
        const r = Math.hypot(px, pz);
        if (r > LAWN.radius + 0.3 * rnd()) continue;
        if (Math.hypot(px - POND.x, pz - POND.z) < POND.r + 0.06) continue;
        if (Math.abs(px - BED.x) < 0.78 && Math.abs(pz - BED.z) < 0.24) continue;
        if (Math.hypot(px - FIRE.x, pz - FIRE.z) < 0.42) continue;
        // shorter toward the edge, taller in tufts
        const tuft = 0.5 + 0.5 * Math.sin(px * 1.7 + 2 * Math.sin(pz * 1.3)) * Math.sin(pz * 1.9 + px * 0.4);
        const h = LAWN.height[0] + (LAWN.height[1] - LAWN.height[0]) * (0.35 * rnd() + 0.65 * tuft) * (1 - 0.4 * smoothstep(LAWN.radius - 1.5, LAWN.radius, r));
        data.push(px, pz, rnd(), h);
      }
    }
    blade.setAttribute('aBlade', new InstancedBufferAttribute(new Float32Array(data), 4));
    blade.instanceCount = data.length / 4;
    const grass = new Mesh(
      blade,
      new ShaderMaterial({
        side: DoubleSide,
        uniforms: { ...shared, uPress: press },
        vertexShader: /* glsl */ `
          ${SHADOW_GLSL}
          uniform float uTime;
          uniform float uPress;
          attribute vec4 aBlade;
          varying vec3 vColour;
          void main() {
            vec3 base = vec3(aBlade.x, 0.0, aBlade.y);
            float seed = aBlade.z;
            float h = aBlade.w;
            float y = position.y;
            // a turn of its own, half toward the camera
            float yaw = seed * 6.2831853;
            vec3 side = vec3(cos(yaw), 0.0, sin(yaw));
            vec3 facing = cross(vec3(0.0, 1.0, 0.0), cameraPosition - base);
            if (dot(facing, facing) > 1e-6) side = normalize(mix(side, normalize(facing), 0.6));
            // the breeze, and a lean of its own
            vec3 lean = vec3(sin(uTime * 1.3 + base.x * 0.9 + seed * 5.0), 0.0, 0.6 * cos(uTime * 1.05 + base.z * 0.7 + seed * 3.0)) * 0.1;
            lean += vec3(seed - 0.5, 0.0, fract(seed * 7.31) - 0.5) * 0.5;
            // pushed aside by Muse as it lies in the grass (uPress: how far it is lying): away from each of its spheres it is
            // near, and pressed down under them, a hollow round it; walking, sitting, it leaves the grass standing
            vec3 push = vec3(0.0);
            float pressed = 0.0;
            for (int i = 0; i < ${CASTERS_MUSE}; i++) {
              vec4 c = uCasters[i];
              if (c.w <= 0.0) continue;
              vec3 d = base + vec3(0.0, 0.5 * h, 0.0) - c.xyz;
              float reach = c.w + 0.1;
              float k = 1.0 - smoothstep(0.55 * c.w, reach, length(d));
              vec2 away = d.xz / max(length(d.xz), 1e-3);
              push += vec3(away.x, 0.0, away.y) * k * 1.6;
              pressed = max(pressed, k * (1.0 - smoothstep(0.0, 0.6 * c.w, c.xyz.y - c.w)));
            }
            push *= uPress;
            pressed *= uPress;
            vec3 bend = lean + push;
            float tall = h * (1.0 - 0.55 * pressed);
            float l = length(bend);
            vec3 p = base + vec3(0.0, tall * y * (1.0 - 0.3 * min(l * l, 1.2) * y), 0.0) + side * (0.026 * position.x) + bend * tall * y * y;
            // dark at its root, light at its tip, in the shadows as the ground is
            float lit = shadowAt(base + vec3(0.0, tall * y, 0.0));
            vec3 root = vec3(0.1, 0.2, 0.05);
            vec3 tip = mix(vec3(0.36, 0.55, 0.15), vec3(0.5, 0.62, 0.2), fract(seed * 13.7));
            vColour = mix(root, tip, smoothstep(0.0, 1.0, y)) * (0.6 + 0.4 * lit) * (0.9 + 0.2 * fract(seed * 3.3));
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColour;
          void main() {
            gl_FragColor = vec4(vColour, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    grass.frustumCulled = false;
    scene.add(grass);
  }

  // ---- the bench: the meadow's (props.ts), in Muse's heights ----
  const wood = toon(0x9b6b45);
  const darkWood = toon(0x6e4a30);
  const bench = new Group();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m = wood, r = 0.012): Mesh => {
    const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 2, r), m);
    mesh.position.set(x, y, z);
    return mesh;
  };
  bench.add(
    box(BENCH.length, 0.064, BENCH.depth, 0, BENCH.seat - 0.032, 0),
    box(0.091, 0.382, 0.29, -0.564, 0.191, 0, darkWood),
    box(0.091, 0.382, 0.29, 0.564, 0.191, 0, darkWood),
    box(1.127, 0.045, 0.036, 0, 0.127, 0, darkWood, 0.008),
  );
  bench.position.set(BENCH.x, 0, BENCH.z);
  scene.add(bench);

  // ---- the pond: water, a rim of stones, lily pads, reeds ----
  const ripples = Array.from({ length: 4 }, () => new Vector4(0, 0, -100, 0));
  const water = new Mesh(
    new CircleGeometry(POND.r, 96).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      uniforms: { ...shared, uRipples: { value: ripples }, uCentre: { value: new Vector2(POND.x, POND.z) } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec4 uRipples[4];
        uniform vec2 uCentre;
        uniform float uTime;
        uniform vec3 uSun;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz;
          float r = length(p - uCentre) / ${POND.r.toFixed(2)};
          vec3 deep = vec3(0.05, 0.22, 0.3);
          vec3 edge = vec3(0.18, 0.42, 0.42);
          vec3 col = mix(deep, edge, smoothstep(0.35, 1.0, r));
          // rings spreading from where things touch it
          float ring = 0.0;
          for (int i = 0; i < 4; i++) {
            vec4 q = uRipples[i];
            float age = uTime - q.z;
            if (age < 0.0 || age > 2.5) continue;
            float d = length(p - q.xy);
            float front = age * 0.35;
            ring += q.w * exp(-age * 1.4) * smoothstep(0.03, 0.0, abs(d - front)) * smoothstep(front + 0.02, 0.0, d - 0.02 + 0.0);
            ring += q.w * 0.6 * exp(-age * 1.8) * smoothstep(0.025, 0.0, abs(d - front * 0.6));
          }
          // the sky in it, and a sparkle of the sun
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(v.y, 0.0), 3.0);
          col = mix(col, vec3(0.62, 0.78, 0.9), 0.45 * fres);
          float glint = pow(max(dot(reflect(-uSun, vec3(0.0, 1.0, 0.0)), v), 0.0), 120.0);
          float twinkle = 0.5 + 0.5 * sin(p.x * 23.0 + uTime * 2.0) * sin(p.y * 19.0 - uTime * 1.7);
          col += vec3(1.0, 0.97, 0.9) * glint * twinkle * 1.5;
          col += vec3(0.9, 0.95, 1.0) * min(ring, 1.0) * 0.45;
          // darker under the rim
          col *= 0.75 + 0.25 * smoothstep(1.0, 0.9, r);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  water.position.set(POND.x, 0.008, POND.z);
  scene.add(water);
  let ripple = 0;
  const splash = (x: number, z: number, at: number, strength: number): void => {
    // (a ring already set for this moment is kept)
    for (const r of ripples) if (Math.abs(r.z - at) < 1e-3 && Math.hypot(r.x - x, r.y - z) < 0.05) return;
    ripples[ripple].set(x, z, at, strength);
    ripple = (ripple + 1) % ripples.length;
  };
  const stone = toon(0x9b9a92);
  const stones = new InstancedMesh(new SphereGeometry(1, 12, 8), stone, 34);
  {
    const m = new Matrix4();
    const q = new Quaternion();
    let k = 0;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + 0.1 * Math.sin(i * 7.1);
      const s = 0.07 + 0.03 * Math.abs(Math.sin(i * 3.7));
      q.setFromAxisAngle(new Vector3(0, 1, 0), i * 1.3);
      m.compose(new Vector3(POND.x + Math.cos(a) * (POND.r + 0.03), 0.02, POND.z + Math.sin(a) * (POND.r + 0.03)), q, new Vector3(s * 1.4, s * 0.6, s));
      stones.setMatrixAt(k++, m);
    }
    // the fire's ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      q.setFromAxisAngle(new Vector3(0, 1, 0), a);
      m.compose(new Vector3(FIRE.x + Math.cos(a) * 0.27, 0.03, FIRE.z + Math.sin(a) * 0.27), q, new Vector3(0.09, 0.06, 0.07));
      stones.setMatrixAt(k++, m);
    }
    stones.count = k;
  }
  scene.add(stones);
  const pads = new Group();
  const padMaterial = toon(0x5d8f3a);
  for (const [dx, dz, r] of [
    [0.55, -0.45, 0.13],
    [0.75, -0.2, 0.09],
    [-0.2, -0.75, 0.11],
    [0.3, 0.6, 0.1],
  ] as const) {
    const pad = new Mesh(new CylinderGeometry(r, r, 0.012, 20, 1, false, 0.3, Math.PI * 2 - 0.6), padMaterial);
    pad.position.set(POND.x + dx, 0.015, POND.z + dz);
    pad.rotation.y = dx * 5;
    pads.add(pad);
  }
  const flowerPad = new Mesh(new SphereGeometry(0.035, 10, 8), toon(0xf4b8cf));
  flowerPad.scale.y = 0.6;
  flowerPad.position.set(POND.x + 0.55, 0.035, POND.z - 0.45);
  pads.add(flowerPad);
  scene.add(pads);
  const reedMaterial = toon(0x6b8a3a);
  const cattail = toon(0x7a4a2a);
  for (let i = 0; i < 9; i++) {
    const a = -0.9 + i * 0.13 + 0.05 * Math.sin(i * 5.3);
    const r = POND.r + 0.05 + 0.08 * Math.sin(i * 2.1);
    const h = 0.42 + 0.18 * Math.abs(Math.sin(i * 4.7));
    const reed = new Mesh(new CylinderGeometry(0.006, 0.01, h, 5), reedMaterial);
    reed.position.set(POND.x + Math.cos(a) * r, h / 2, POND.z + Math.sin(a) * r);
    reed.rotation.z = 0.08 * Math.sin(i * 3.1);
    scene.add(reed);
    if (i % 2 === 0) {
      const head = new Mesh(new CylinderGeometry(0.018, 0.018, 0.09, 8), cattail);
      head.position.set(reed.position.x, h - 0.05, reed.position.z);
      head.rotation.z = reed.rotation.z;
      scene.add(head);
    }
  }

  // ---- the flower bed, its flowers and the trowel ----
  const bed = new Group();
  bed.add(box(1.5, 0.16, 0.4, 0, 0.08, 0, wood, 0.02), box(1.42, 0.02, 0.32, 0, 0.165, 0, toon(0x4a3322), 0.008));
  bed.position.set(BED.x, 0, BED.z);
  scene.add(bed);
  const SOIL = 0.17;
  const petalColours = [0xf6a6c1, 0xc7a6f0, 0xffc28a];
  const flowers = petalColours.map((colour, i) => {
    const f = new Group();
    const stem = new Mesh(new CylinderGeometry(0.008, 0.011, 1, 6).translate(0, 0.5, 0), toon(0x5f9a3a));
    const leafGeometry = new SphereGeometry(0.035, 10, 6).scale(1.6, 0.35, 0.8);
    const leaves = [new Mesh(leafGeometry, toon(0x6aa842)), new Mesh(leafGeometry, toon(0x6aa842))];
    const head = new Group();
    const centre = new Mesh(new SphereGeometry(0.03, 12, 8).scale(1, 0.6, 1), toon(0xf5d04a));
    head.add(centre);
    const petal = new SphereGeometry(0.035, 10, 6).scale(1.15, 0.3, 0.7).translate(0.045, 0, 0);
    const petals = Array.from({ length: 6 }, (_, k) => {
      const p = new Mesh(petal, toon(colour));
      p.rotation.y = (k / 6) * Math.PI * 2;
      head.add(p);
      return p;
    });
    f.add(stem, ...leaves, head);
    // grown and open (watering grows nothing)
    stem.scale.set(1, 0.32, 1);
    leaves[0].position.set(0.03, 0.08, 0);
    leaves[0].rotation.z = 0.5;
    leaves[1].position.set(-0.03, 0.11, 0);
    leaves[1].rotation.z = -0.5;
    leaves.forEach((leaf) => leaf.scale.setScalar(1.2));
    head.position.y = 0.32;
    const at = flowerAt(i);
    f.position.set(at.x, SOIL, at.z);
    scene.add(f);
    return { group: f, stem, leaves, head, petals };
  });
  const trowel = new Group();
  trowel.add(new Mesh(new CylinderGeometry(0.014, 0.016, 0.12, 8).translate(0, 0.06, 0), wood));
  trowel.add(new Mesh(new SphereGeometry(0.04, 10, 6).scale(0.8, 1.5, 0.25).translate(0, -0.04, 0), toon(0xb8bcc2)));
  trowel.position.set(BED.x + 0.62, SOIL + 0.05, BED.z + 0.04);
  trowel.rotation.set(0.25, 0.4, -0.3);
  scene.add(trowel);
  // the watering can: a body, a spout with its rose, a handle over the top
  const can = new Group();
  const canMaterial = toon(0x8ec5c0);
  can.add(new Mesh(new CylinderGeometry(0.07, 0.078, 0.13, 18), canMaterial));
  const spout = new Mesh(new CylinderGeometry(0.011, 0.016, 0.17, 8), canMaterial);
  spout.position.set(0, 0.0, 0.1);
  spout.rotation.x = 1.0;
  can.add(spout);
  const rose = new Mesh(new ConeGeometry(0.025, 0.035, 10, 1, true), canMaterial);
  rose.position.set(0, 0.06, 0.17);
  rose.rotation.x = -2.1;
  can.add(rose);
  const handle = new Mesh(new TorusGeometry(0.055, 0.011, 6, 16, Math.PI), canMaterial);
  handle.position.set(0, 0.065, -0.01);
  handle.rotation.y = Math.PI / 2;
  can.add(handle);
  scene.add(can);
  /** Where the rose is on the can (its frame), and the can's rest by the bed. */
  const ROSE = new Vector3(0, 0.07, 0.19);
  const drops = new InstancedMesh(new SphereGeometry(0.011, 6, 4).scale(1, 1.5, 1), new MeshBasicMaterial({ color: 0x9fd4f0, transparent: true, opacity: 0.85 }), 18);
  drops.frustumCulled = false;
  scene.add(drops);

  // ---- the fire, the pot on its trivet, the ladle ----
  const fire = new Group();
  const logMaterial = toon(0x6b4226);
  for (let i = 0; i < 3; i++) {
    const log = new Mesh(new CylinderGeometry(0.03, 0.035, 0.36, 8), logMaterial);
    log.rotation.set(Math.PI / 2 - 0.25, (i / 3) * Math.PI * 2, 0, 'YXZ');
    log.position.y = 0.05;
    fire.add(log);
  }
  const flames = [0xffb347, 0xff8a3d, 0xffe08a].map((c, i) => {
    const f = new Mesh(new ConeGeometry(0.07 - i * 0.015, 0.22 - i * 0.04, 10, 1, true).translate(0, 0.11 - i * 0.02, 0), new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
    f.position.y = 0.05;
    fire.add(f);
    return f;
  });
  const glow = new PointLight(0xff9a50, 0.6, 2.2, 1.5);
  glow.position.y = 0.2;
  fire.add(glow);
  fire.position.set(FIRE.x, 0, FIRE.z);
  scene.add(fire);
  const iron = toon(0x3c3a3a);
  const pot = new Group();
  const POT_TOP = POT[1] - 0.02;
  {
    const profile = [new Vector2(0, -0.13), new Vector2(0.1, -0.125), new Vector2(0.135, -0.08), new Vector2(0.14, -0.02), new Vector2(0.13, 0.0), new Vector2(0.145, 0.006), new Vector2(0.14, 0.016)];
    const body = new Mesh(new LatheGeometry(profile, 24), toon(0x46413f, { side: DoubleSide }));
    pot.add(body);
    const soup = new Mesh(new CircleGeometry(0.128, 24).rotateX(-Math.PI / 2), toon(0xd9893f));
    soup.position.y = -0.025;
    pot.add(soup);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = new Mesh(new CylinderGeometry(0.008, 0.008, POT_TOP - 0.1, 5), iron);
      leg.position.set(Math.cos(a) * 0.15, -(POT_TOP - 0.1) / 2 - 0.06, Math.sin(a) * 0.15);
      pot.add(leg);
    }
    const ring = new Mesh(new TorusGeometry(0.15, 0.008, 6, 24).rotateX(Math.PI / 2), iron);
    ring.position.y = -0.06;
    pot.add(ring);
  }
  pot.position.set(FIRE.x, POT_TOP, FIRE.z);
  scene.add(pot);
  const ladle = new Group();
  const LADLE = 0.44;
  ladle.add(new Mesh(new CylinderGeometry(0.009, 0.009, LADLE, 6).translate(0, LADLE / 2, 0), wood));
  const bowl = new Mesh(new SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0xb8bcc2, { side: DoubleSide }));
  ladle.add(bowl);
  scene.add(ladle);
  // the steam: soft white puffs, a blurred disc drawn once
  const puff = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d canvas');
    const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, 'rgba(255,255,255,1)');
    fade.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 64, 64);
    const t = new CanvasTexture(canvas);
    t.colorSpace = 'srgb';
    return t;
  })();
  const puffs = Array.from({ length: 7 }, () => {
    const p = new Sprite(new SpriteMaterial({ map: puff, transparent: true, depthWrite: false }));
    scene.add(p);
    return p;
  });

  // ---- the rod, its line, float and the fish ----
  const rod = new Group();
  const ROD_LENGTH = 0.95;
  rod.add(new Mesh(new CylinderGeometry(0.006, 0.012, ROD_LENGTH, 6).translate(0, ROD_LENGTH / 2 - 0.12, 0), toon(0xd8b86a)));
  rod.add(new Mesh(new CylinderGeometry(0.026, 0.026, 0.02, 12).rotateZ(Math.PI / 2).translate(0.02, 0.02, 0), toon(0x8a5a3a)));
  scene.add(rod);
  const lineGeometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(16 * 3), 3));
  const line = new Line(lineGeometry, new LineBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.85 }));
  line.frustumCulled = false;
  scene.add(line);
  const float = new Group();
  float.add(new Mesh(new SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xe2483a)));
  float.add(new Mesh(new SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0xf6f2ea)));
  scene.add(float);
  const fish = new Group();
  {
    const orange = toon(0xff9a3c);
    fish.add(new Mesh(new SphereGeometry(0.05, 14, 10).scale(1.5, 1, 0.6), orange));
    const tail = new Mesh(new ConeGeometry(0.035, 0.06, 4).rotateZ(Math.PI / 2).scale(1, 1, 0.3), orange);
    tail.position.x = -0.09;
    fish.add(tail);
    const eye = new SphereGeometry(0.008, 6, 4);
    const black = new MeshBasicMaterial({ color: 0x111111 });
    for (const z of [-0.025, 0.025]) {
      const e = new Mesh(eye, black);
      e.position.set(0.045, 0.012, z);
      fish.add(e);
    }
  }
  scene.add(fish);

  // ---- the snore bubble, Zzz, hearts, notes, sparkles ----
  const bubble = new Mesh(
    new SphereGeometry(1, 20, 14),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uFade: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          float glint = smoothstep(0.93, 0.97, dot(normalize(vN), normalize(vec3(-0.4, 0.7, 0.6))));
          gl_FragColor = vec4(vec3(0.72, 0.86, 1.0) + glint, (0.18 + 0.7 * rim + glint) * uFade);
          #include <colorspace_fragment>
        }`,
    }),
  );
  bubble.renderOrder = 3;
  scene.add(bubble);
  const zMaterial = new SpriteMaterial({ map: glyph('Z', '#7f9fd6'), transparent: true, depthWrite: false });
  const zs = Array.from({ length: 3 }, () => riser(zMaterial, 0.16));
  const heartMaterial = new SpriteMaterial({ map: glyph('♥', '#f2789c'), transparent: true, depthWrite: false });
  const hearts = Array.from({ length: 3 }, () => riser(heartMaterial, 0.13));
  const noteMaterial = new SpriteMaterial({ map: glyph('♪', '#8a6fd0'), transparent: true, depthWrite: false });
  const notes = Array.from({ length: 3 }, () => riser(noteMaterial, 0.14));
  for (const s of [...zs, ...hearts, ...notes]) scene.add(s);

  // still props' shadows: the bench's seat, the bed, the pot
  const still: Vector4[] = [
    new Vector4(BENCH.x - 0.4, BENCH.seat - 0.05, BENCH.z, 0.24),
    new Vector4(BENCH.x + 0.4, BENCH.seat - 0.05, BENCH.z, 0.24),
    new Vector4(BED.x - 0.45, 0.08, BED.z, 0.2),
    new Vector4(BED.x + 0.45, 0.08, BED.z, 0.2),
    new Vector4(FIRE.x, POT_TOP - 0.06, FIRE.z, 0.13),
  ];
  for (let i = 0; i < still.length; i++) casters[CASTERS_MUSE + i].copy(still[i]);

  // ---- Muse on the stage: its place, its spheres, picking it ----
  const place = new Matrix4();
  const left = new Vector3();
  const up = new Vector3(0, 1, 0);
  const forward = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const hand = new Matrix4();
  const held = new Matrix4();
  const joints = new Float32Array(13 * 3);
  /** Muse's spheres (its own frame: joint, offset up from it, radius) for its shadow, the grass, and picking. */
  const BODY: readonly [number, number, number][] = [
    [JOINT.pelvis, 0.06, 0.21],
    [JOINT.spine, 0.02, 0.26],
    [JOINT.chest, 0.04, 0.24],
    [JOINT.head, 0.09, 0.25],
    [JOINT.legL, -0.08, 0.08],
    [JOINT.legR, -0.08, 0.08],
  ];
  const at = (j: number, dy: number, out: Vector3): Vector3 => {
    out.set(joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
    // (up along the joint's own frame)
    rig.frameOf(j, hand);
    const e = hand.elements;
    out.x += e[4] * dy;
    out.y += e[5] * dy;
    out.z += e[6] * dy;
    return out.applyMatrix4(place);
  };
  const spheres: Vector4[] = Array.from({ length: CASTERS_MUSE }, () => new Vector4());
  const handAt = (side: number, out: Matrix4): Matrix4 => out.multiplyMatrices(place, rig.handFrame(side, hand));
  /** A prop held in a mitten: at the mitten's middle, turned as Muse faces and then by its own turn (Muse's frame), set off from its grip. */
  const holding = (side: number, turn: Euler, grip: Vector3, out: Matrix4): Matrix4 => {
    handAt(side, out);
    const x = out.elements[12];
    const y = out.elements[13];
    const z = out.elements[14];
    out.copy(place).setPosition(0, 0, 0).multiply(new Matrix4().makeRotationFromEuler(turn)).multiply(new Matrix4().makeTranslation(grip.x, grip.y, grip.z));
    out.elements[12] += x;
    out.elements[13] += y;
    out.elements[14] += z;
    return out;
  };

  // ---- your doings: a tap, a hold ----
  let pressing = false;
  let now = 0;
  const ray = new Ray();
  const ball = new Sphere();
  const pick = (event: PointerEvent): { hit: boolean; side: number } => {
    const r = canvas.getBoundingClientRect();
    const ndc = new Vector3(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1, 0.5);
    ndc.unproject(camera);
    ray.origin.copy(camera.position);
    ray.direction.copy(ndc.sub(camera.position)).normalize();
    let best = Infinity;
    let side = 1;
    for (const s of spheres) {
      if (s.w <= 0) continue;
      const hit = ray.intersectSphere(ball.set(tmp.set(s.x, s.y, s.z), s.w * 1.1), tmp2);
      if (!hit) continue;
      const d = hit.distanceTo(camera.position);
      if (d < best) {
        best = d;
        // which side of Muse (its own left +1) the touch is on
        side = tmp2.sub(tmp.set(place.elements[12], place.elements[13], place.elements[14])).dot(left) >= 0 ? 1 : -1;
      }
    }
    return { hit: best < Infinity, side };
  };
  canvas.addEventListener('pointerdown', (event) => {
    const { hit, side } = pick(event);
    if (!hit) return;
    pressing = true;
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    life.hold(now, side);
  });
  const up2 = (event: PointerEvent): void => {
    if (!pressing) return;
    pressing = false;
    controls.enabled = true;
    canvas.releasePointerCapture(event.pointerId);
    life.letGo(now);
  };
  canvas.addEventListener('pointerup', up2);
  canvas.addEventListener('pointercancel', up2);
  canvas.addEventListener('pointermove', (event) => {
    if (!pressing) canvas.style.cursor = pick(event).hit ? 'pointer' : '';
  });

  // ---- the camera's follow ----
  let follow = true;
  const target = new Vector3();
  camera.far = 80;
  camera.updateProjectionMatrix();
  camera.position.set(0.5, 1.75, 4.3);
  controls.target.set(0, 0.45, 0.4);
  controls.maxDistance = 14;
  controls.minDistance = 1.2;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.update();

  /** Rising things: where one of n staggered risers (period, s) is at a time, as u (0 … 1). */
  const rise = (t: number, k: number, n: number, period: number): number => (((t / period + k / n) % 1) + 1) % 1;

  let living: Living | null = null;
  let snap = true;
  const placeMuse = (l: Living): void => {
    forward.set(Math.sin(l.heading), 0, Math.cos(l.heading));
    left.crossVectors(up, forward);
    place.makeBasis(left, up, forward).setPosition(l.x, l.y, l.z);
    (u.uMusePos.value as Vector3).set(l.x, l.y, l.z);
    (u.uMuseFrame.value as { setFromMatrix4(m: Matrix4): void }).setFromMatrix4(place);
  };

  const update = (t: number, dt: number): void => {
    now = t;
    shared.uTime.value = t;
    u.uTime.value = t;
    const l = life.at(t, camera.position);
    living = l;
    rig.pose(l.action);
    placeMuse(l);
    const face = u.uMuseFace.value as Vector4;
    face.set(rig.eyes, rig.smile, rig.squint, rig.squeeze);
    (u.uMuseMood.value as Vector4).set(rig.blush, 0, 0, 0);
    (u.uMuseRaise.value as Vector4).set(rig.raised, rig.raisedRight, rig.hung, rig.hungRight);
    // its spheres: the shadow, the grass, picking
    rig.joints(joints);
    for (let i = 0; i < CASTERS_MUSE; i++) spheres[i].set(0, 0, 0, 0);
    BODY.forEach(([j, dy, r], i) => {
      at(j, dy, tmp);
      spheres[i].set(tmp.x, tmp.y, tmp.z, r);
    });
    for (const [k, side] of [
      [BODY.length, 1],
      [BODY.length + 1, -1],
    ]) {
      handAt(side, held);
      spheres[k].set(held.elements[12], held.elements[13], held.elements[14], 0.07);
    }
    for (let i = 0; i < CASTERS_MUSE; i++) casters[i].copy(spheres[i]);
    press.value = rig.lying;

    // the watering can: out of its pocket into the right mitten while it waters (hung by its handle, tipped to pour), back after
    const cues = l.cues;
    handAt(-1, held);
    const w = cues.water;
    const gw = w ? w.grip : 0;
    const tip = w ? gardenBeats(w.time).tip : 0;
    hold(can, holding(-1, new Euler(0.1 + 0.8 * tip, 0, 0), new Vector3(0, -0.122, 0.012), new Matrix4()), gw);
    // its water, falling from the rose to the flower
    const pour = w ? gardenBeats(w.time).pour : 0;
    const roseAt = tmp.copy(ROSE).applyMatrix4(can.matrix);
    const flower = flowerAt(w ? w.flower : 0);
    const m = new Matrix4();
    for (let i = 0; i < 18; i++) {
      const f = ((t * 1.6 + i / 18) % 1 + 1) % 1;
      const x = roseAt.x + (flower.x - roseAt.x) * f + 0.02 * Math.sin(i * 7.7);
      const z = roseAt.z + (flower.z - roseAt.z) * f + 0.02 * Math.cos(i * 5.3);
      const y = roseAt.y + (SOIL + 0.05 - roseAt.y) * f * f + 0.04 * f * (1 - f);
      m.makeTranslation(x, y, z);
      if (pour < 0.05) m.makeScale(0, 0, 0);
      drops.setMatrixAt(i, m);
    }
    drops.instanceMatrix.needsUpdate = true;
    // the flowers, swaying a little
    flowers.forEach((f, i) => (f.group.rotation.z = 0.04 * Math.sin(t * 1.3 + i * 2)));

    // the ladle: out of its pocket into the right mitten while it cooks, its handle from the mitten down to its bowl going
    // round in the pot, or (tasting) up from the mitten to the bowl before its mouth; back into the pocket after
    const c = l.cues.cook;
    const gc = c ? c.grip : 0;
    const beat = c ? cookBeats(c.time) : { turn: 0, taste: 0 };
    rig.frameOf(JOINT.head, hand);
    const mouth = new Vector3(0, 0.01, 0.27).applyMatrix4(hand).applyMatrix4(place);
    const inPot = new Vector3(FIRE.x + STIR.bowl * Math.cos(beat.turn), POT_TOP - 0.035, FIRE.z + STIR.bowl * Math.sin(beat.turn));
    const bowlAt = inPot.lerp(mouth, beat.taste);
    const mitten = new Vector3(held.elements[12], held.elements[13], held.elements[14]);
    const handle = mitten.clone().sub(bowlAt);
    // (before it is at work, in or out of the pocket, it stands upright in the mitten)
    const working = c ? smoothstep(0.2, 0.9, c.time) * smoothstep(0.2, 0.9, COOK.period * 2 - c.time) : 0;
    const upright = new Vector3(0, 1, 0);
    const along = handle.lengthSq() > 1e-6 ? handle.normalize().lerp(upright, 1 - working).normalize() : upright;
    const reach = Math.min(LADLE - 0.05, mitten.distanceTo(bowlAt));
    const ladleAt = new Matrix4().compose(mitten.clone().addScaledVector(along, -(working * reach + (1 - working) * 0.3)), new Quaternion().setFromUnitVectors(upright, along), new Vector3(1, 1, 1));
    hold(ladle, ladleAt, gc);
    // the fire's flames flickering, the steam rising
    flames.forEach((f, i) => {
      const flick = 0.85 + 0.25 * Math.sin(t * (9 + i * 3) + i) * Math.sin(t * (5.3 + i) + 2 * i);
      f.scale.set(1 + 0.1 * Math.sin(t * 7 + i), flick, 1 + 0.1 * Math.cos(t * 6 + i));
      f.rotation.y = t * (0.5 + i * 0.3);
    });
    glow.intensity = 0.55 + 0.15 * Math.sin(t * 11) * Math.sin(t * 7.3);
    puffs.forEach((p, k) => {
      const v = rise(t, k, puffs.length, 2.8);
      p.position.set(FIRE.x + 0.05 * Math.sin(v * 5 + k) + 0.08 * v, POT_TOP + 0.02 + 0.45 * v, FIRE.z + 0.04 * Math.cos(v * 4 + k * 2));
      p.scale.setScalar(0.07 + 0.16 * v);
      p.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, v * 1.4)) * (1 - v);
    });

    // the rod in the right mitten while it fishes (else on the grass by the pond); its line out to the float, or the fish hung on it
    const fsh = l.cues.fish;
    const gf = fsh ? fsh.grip : 0;
    // (pointing out over the water and up, raised with the yank, back over its shoulder for the cast)
    const fu = fsh ? ((fsh.time % FISH.period) + FISH.period) % FISH.period : 0;
    const swing = fsh ? 0.9 * Math.sin(Math.PI * Math.min(1, Math.max(0, fu - FISH.cast[0]) / 0.7)) * (fu < 0.7 ? 1 : 0) : 0;
    hold(rod, holding(-1, new Euler(0.75 - 0.35 * fishBeats(fsh ? fsh.time : 0).yank * (fsh ? 1 : 0) - swing, 0, 0.12), new Vector3(0, 0, 0), new Matrix4()), gf);
    const rodTip = new Vector3(0, ROD_LENGTH - 0.12, 0).applyMatrix4(rod.matrix);
    const beats = fishBeats(fsh ? fsh.time : 0);
    const u0 = fsh ? ((fsh.time % FISH.period) + FISH.period) % FISH.period : 0;
    // where the float rests on the water, ahead of Muse
    const landing = tmp2.set(l.x, 0.012, l.z).addScaledVector(forward, CAST);
    const bob = 0.006 * Math.sin(t * 2.3) - 0.05 * beats.dip;
    let floatAt: Vector3;
    if (!fsh || gf < 0.98) floatAt = rodTip.clone().add(new Vector3(0, -0.12, 0));
    else if (beats.fish > 0) {
      // the fish flying out on the line, then hung from the rod's tip, wriggling
      const hang = rodTip.clone().add(new Vector3(0, -0.26, 0));
      floatAt = new Vector3().lerpVectors(landing, hang, beats.fish).add(new Vector3(0, 0.35 * Math.sin(Math.PI * beats.fish), 0));
    } else if (u0 < FISH.cast[1]) {
      // the cast: out from the tip in an arc
      floatAt = new Vector3().lerpVectors(rodTip, landing, beats.cast).add(new Vector3(0, 0.3 * Math.sin(Math.PI * beats.cast), 0));
    } else floatAt = landing.clone().add(new Vector3(0, bob, 0));
    float.position.copy(floatAt);
    float.visible = gf > 0.02;
    // the line: the tip to the float, sagging a little
    const pts = lineGeometry.getAttribute('position');
    for (let i = 0; i < 16; i++) {
      const f = i / 15;
      const x = rodTip.x + (floatAt.x - rodTip.x) * f;
      const y = rodTip.y + (floatAt.y - rodTip.y) * f - 0.08 * Math.sin(Math.PI * f) * (beats.fish > 0 || beats.yank > 0.5 ? 0.1 : 1);
      const z = rodTip.z + (floatAt.z - rodTip.z) * f;
      pts.setXYZ(i, x, y, z);
    }
    pts.needsUpdate = true;
    line.visible = gf > 0.02;
    // the fish: on the line while caught, dropped back in when let go
    fish.visible = !!fsh && (beats.fish > 0.02 || (beats.free > 0 && beats.free < 1));
    if (beats.fish > 0.02) {
      fish.position.copy(floatAt).add(new Vector3(0, -0.07, 0));
      fish.rotation.set(0, l.heading + Math.PI / 2, -1.2 + 0.5 * Math.sin(t * 14));
    } else if (beats.free > 0) {
      const hang = rodTip.clone().add(new Vector3(0, -0.33, 0));
      fish.position.copy(hang).lerp(landing, beats.free).add(new Vector3(0, 0.2 * Math.sin(Math.PI * beats.free), 0));
      fish.rotation.set(0, l.heading + Math.PI / 2, -1.2 + 2.6 * beats.free);
    }
    // rings on the water: the float landing, the nibbles, the bite, the fish dropped back
    if (fsh) {
      const cycle = fsh.time - u0;
      const base = t - fsh.time + cycle;
      splash(landing.x, landing.z, base + FISH.cast[1] - 0.02, 1);
      splash(landing.x, landing.z, base + FISH.nibble[0] + beats.shift, 0.6);
      splash(landing.x, landing.z, base + FISH.nibble[1] + beats.shift, 0.7);
      splash(landing.x, landing.z, base + FISH.bite + beats.shift, 1);
      if (beats.lucky && u0 > FISH.free + beats.shift) splash(landing.x, landing.z, base + FISH.free + 0.5 + beats.shift, 1.2);
    }
    (water.material).uniforms.uTime.value = t;

    // the snore bubble at its nose, blown and drawn back with each breath; popped when it stirs or wakes
    const sl = l.cues.sleep;
    rig.frameOf(JOINT.head, hand);
    const head = new Matrix4().multiplyMatrices(place, hand);
    if (sl) {
      const { bubble: size } = sleepBeats(sl.time);
      const pop = sl.roused >= 0 ? smoothstep(0, 0.18, sl.roused) : 0;
      const r = (0.015 + 0.075 * size) * (1 + 0.6 * pop);
      const nose = new Vector3(-0.01, 0.0, 0.23 + r * 0.85).applyMatrix4(head);
      bubble.position.copy(nose);
      bubble.scale.setScalar(r);
      bubble.visible = pop < 1;
      (bubble.material).uniforms.uFade.value = 1 - pop;
    } else bubble.visible = false;
    // Zzz rising from its head as it sleeps
    const top = new Vector3(0, 0.15, 0.05).applyMatrix4(head);
    zs.forEach((s, k) => {
      const v = rise(t, k, zs.length, 3);
      s.visible = !!sl && (sl.roused < 0 || sl.roused > 1.5);
      s.position.copy(top).add(new Vector3(0.18 * v + 0.05 * Math.sin(v * 6), 0.15 + 0.5 * v, 0));
      s.scale.setScalar(0.08 + 0.12 * v);
      s.material.opacity = Math.sin(Math.PI * Math.min(1, v * 1.2));
    });
    // hearts while you pet it
    hearts.forEach((s, k) => {
      const v = rise(t, k, hearts.length, 1.6);
      s.visible = l.cues.petted > 0.4;
      s.position.copy(top).add(new Vector3(0.22 * Math.sin(k * 2.1 + v * 2), 0.12 + 0.45 * v, 0.05));
      s.material.opacity = Math.sin(Math.PI * v) * smoothstep(0.4, 0.8, l.cues.petted);
    });
    // notes while it hums on the bench
    notes.forEach((s, k) => {
      const v = rise(t, k, notes.length, 2.2);
      s.visible = l.cues.hum > 0.05;
      s.position.copy(top).add(new Vector3(-0.15 + 0.3 * v + 0.05 * Math.sin(v * 9), 0.1 + 0.45 * v, 0));
      s.material.opacity = l.cues.hum * Math.sin(Math.PI * v);
    });

    // the camera's follow: its target eased toward Muse, the camera carried with it (jumping there after a seek)
    if (follow) {
      target.set(l.x, l.y + 0.45, l.z);
      const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
      snap = false;
      tmp.subVectors(target, controls.target).multiplyScalar(k);
      controls.target.add(tmp);
      camera.position.add(tmp);
    }
  };

  /** A tool in a mitten (its matrix there), there as much as it is held: it pops into being as it comes out of the pocket, and out as it goes back in. */
  function hold(object: Object3D, inHand: Matrix4, k: number): void {
    object.visible = k > 0.01;
    inHand.decompose(object.position, object.quaternion, object.scale);
    // (a little overshoot as it appears)
    const pop = Math.min(1, k) * (1 + 0.25 * Math.sin(Math.PI * Math.min(1, k)));
    object.scale.setScalar(Math.max(1e-3, pop));
    object.matrixAutoUpdate = true;
    object.updateMatrix();
  }

  const KEYS: Record<string, string> = { '1': 'home', '2': 'to the flowers', '3': 'to the bench', '4': 'to the pond', '5': 'to the fire', '6': 'to the nap', '7': 'home again' };
  return {
    update,
    place,
    seek(t: number, day: number): void {
      life.seek(t, day);
      snap = true;
    },
    get names() {
      return life.names;
    },
    frame(round: number, up: number, distance: number): void {
      follow = true;
      const l = living;
      if (!l) return;
      const a = l.heading + round;
      controls.target.set(l.x, l.y + 0.45, l.z);
      camera.position.set(l.x + distance * Math.cos(up) * Math.sin(a), l.y + 0.45 + distance * Math.sin(up), l.z + distance * Math.cos(up) * Math.cos(a));
      controls.update();
    },
    tap: (t: number) => life.tap(t),
    hold: (t: number, side: number) => life.hold(t, side),
    letGo: (t: number) => life.letGo(t),
    legend(): string {
      const l = living;
      const where = l ? life.names.filter((n) => n.start <= life.clock(now)).pop()?.name ?? '' : '';
      return `stage · ${where}   day ${life.clock(now).toFixed(1)} / ${life.length.toFixed(0)} s${follow ? ' · following' : ''}\n1 home  2 flowers  3 bench  4 pond  5 fire  6 nap  7 happy   click: wave or bounce · hold: pet (longer: fur up)   G follow`;
    },
    key(event: KeyboardEvent, t: number): boolean {
      const key = event.key.toLowerCase();
      if (key in KEYS) {
        life.seek(t, life.names.find((n) => n.name === KEYS[key])?.start ?? 0);
        snap = true;
        return true;
      }
      if (key === 'g') {
        follow = !follow;
        return true;
      }
      return false;
    },
  };
}
