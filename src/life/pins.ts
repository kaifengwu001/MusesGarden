import { CylinderGeometry, ExtrudeGeometry, Group, Mesh, Quaternion, ShaderMaterial, Shape, SphereGeometry, Vector3, type BufferGeometry, type PerspectiveCamera } from 'three';
import { warpPoint, type WarpFrame } from '../render/warp';

// Pins stuck in the globe, as on a map you keep: a heart-headed pin for
// each find you liked and a round one with Muse's face for Muse. They show
// only from orbit (the planet hides those round the back; nothing points
// at pins off screen), keep a steady size on screen at any height, turn
// their heads to you (Muse's face, the heart), and pop
// up or down with a little bounce when they appear, when you toggle them,
// or when you come down from orbit.

export type PinKind = 'liked' | 'muse';

export interface PinSpec {
  readonly id: string;
  readonly kind: PinKind;
  /** Where it stands: a unit direction and the ground's height over R (m). */
  readonly dir: Vector3;
  readonly ground: number;
}

/** Pins show below this zoom (orbit and a little on the way down), and stand this tall on screen (a share of its height). */
const ORBIT_ZOOM = 0.22;
const SCREEN = 0.055;
/** Seconds to pop up or down; a pin's delay after the one before it. */
const POP = 0.42;
const STAGGER = 0.05;

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vView;
void main() {
  vLocal = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// A painted toy finish: a soft key light from the upper left in view space, two soft bands, a cool
// shade, a warm rim; Muse's head carries its face (two dark eyes, pink cheeks) on its front.
const fragmentShader = /* glsl */ `
uniform vec3 uColour;
uniform vec3 uShade;
uniform int uFace;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float key = dot(n, normalize(vec3(-0.45, 0.75, 0.5)));
  float lit = smoothstep(-0.15, 0.1, key) * 0.6 + smoothstep(0.45, 0.6, key) * 0.4;
  vec3 col = mix(uShade, uColour, lit);
  // a soft dark edge, as an ink line would, so a pin reads against clouds and water alike
  float edge = 1.0 - max(dot(n, v), 0.0);
  col *= mix(1.0, 0.62, smoothstep(0.55, 0.95, edge));
  if (uFace == 1) {
    // the face on the head's front (+z), as Muse's: eyes a little apart, a smile, cheeks
    vec2 p = vLocal.xy / 0.34;
    float front = smoothstep(0.0, 0.35, vLocal.z / 0.34);
    float eyes = 1.0 - smoothstep(0.075, 0.1, min(length(p - vec2(-0.3, 0.12)), length(p - vec2(0.3, 0.12))));
    float smile = (1.0 - smoothstep(0.02, 0.045, abs(length(p - vec2(0.0, 0.02)) - 0.16))) * step(p.y, -0.04) * step(abs(p.x), 0.13);
    float cheeks = 1.0 - smoothstep(0.08, 0.16, min(length(p - vec2(-0.47, -0.08)), length(p - vec2(0.47, -0.08))));
    col = mix(col, vec3(0.96, 0.66, 0.66), cheeks * 0.45 * front);
    col = mix(col, vec3(0.17, 0.14, 0.13), max(eyes, smile) * front);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function heart(): BufferGeometry {
  const s = new Shape();
  s.moveTo(0, -0.42);
  s.bezierCurveTo(-0.08, -0.3, -0.46, -0.08, -0.46, 0.14);
  s.bezierCurveTo(-0.46, 0.34, -0.3, 0.44, -0.18, 0.44);
  s.bezierCurveTo(-0.08, 0.44, -0.02, 0.38, 0, 0.3);
  s.bezierCurveTo(0.02, 0.38, 0.08, 0.44, 0.18, 0.44);
  s.bezierCurveTo(0.3, 0.44, 0.46, 0.34, 0.46, 0.14);
  s.bezierCurveTo(0.46, -0.08, 0.08, -0.3, 0, -0.42);
  const g = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 4, curveSegments: 18 });
  g.translate(0, 0, -0.06);
  return g;
}

/** A hex colour as the scene's linear light. */
function linear(hex: number): Vector3 {
  const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((x) => Math.pow(x / 255, 2.2));
  return new Vector3(r, g, b);
}

function material(colour: number, shade: number, face: boolean): ShaderMaterial {
  return new ShaderMaterial({
    name: 'pin',
    vertexShader,
    fragmentShader,
    uniforms: { uColour: { value: linear(colour) }, uShade: { value: linear(shade) }, uFace: { value: face ? 1 : 0 } },
    // drawn after the clouds (transparent, a later render order) so a pin is never lost under one
    transparent: true,
    depthWrite: true,
  });
}

interface Pin {
  spec: PinSpec;
  group: Group;
  head: Mesh;
  shown: number;
  target: number;
  delay: number;
}

const up = new Vector3();
const p = new Vector3();
const head = new Vector3();
const scale = new Vector3();
const q = new Quaternion();
const Y = new Vector3(0, 1, 0);

export class Pins {
  readonly group = new Group();
  private readonly pins = new Map<string, Pin>();
  private readonly needle = new CylinderGeometry(0.035, 0.012, 1.05, 10, 1).translate(0, 0.525, 0);
  private readonly heartGeometry = heart();
  private readonly ball = new SphereGeometry(0.34, 32, 20);
  private readonly materials = {
    needle: material(0xc9ccd3, 0x7d8494, false),
    liked: material(0xe9645a, 0xa83a3e, false),
    muse: material(0xf6eedf, 0xc9b9a3, true),
  };
  private visible = false;

  constructor() {
    this.group.renderOrder = 10;
    this.group.visible = false;
  }

  /** The pins to stand (all of them, each time the set changes). */
  set(specs: readonly PinSpec[]): void {
    const keep = new Set(specs.map((s) => s.id));
    for (const [id, pin] of this.pins) {
      if (!keep.has(id)) {
        this.group.remove(pin.group, pin.head);
        this.pins.delete(id);
      }
    }
    let k = 0;
    for (const spec of specs) {
      const existing = this.pins.get(spec.id);
      if (existing) {
        existing.spec = spec;
        continue;
      }
      const group = new Group();
      const needle = new Mesh(this.needle, this.materials.needle);
      const head = new Mesh(spec.kind === 'muse' ? this.ball : this.heartGeometry, spec.kind === 'muse' ? this.materials.muse : this.materials.liked);
      needle.renderOrder = head.renderOrder = 10;
      group.add(needle);
      group.matrixAutoUpdate = false;
      head.matrixAutoUpdate = false;
      this.group.add(group, head);
      // (one that arrives while the pins show pops up at once)
      this.pins.set(spec.id, { spec, group, head, shown: 0, target: this.visible ? 1 : 0, delay: STAGGER * k++ });
    }
  }

  /** Move a pin that walks about (Muse's) to where it is now: its direction and its ground's height (m). */
  move(id: string, dir: Vector3, ground: number): void {
    const pin = this.pins.get(id);
    if (pin && !(pin.spec.ground === ground && pin.spec.dir.equals(dir))) pin.spec = { ...pin.spec, dir: dir.clone(), ground };
  }

  /** Each frame: show from orbit when on, keep their size on screen, turn their heads to you. */
  update(dt: number, on: boolean, zoom: number, camera: PerspectiveCamera, warp: WarpFrame, radius: number): void {
    const visible = on && zoom < ORBIT_ZOOM;
    if (visible !== this.visible) {
      this.visible = visible;
      let k = 0;
      for (const pin of this.pins.values()) {
        pin.target = visible ? 1 : 0;
        pin.delay = STAGGER * k++;
      }
    }
    let any = false;
    const halfHeight = Math.tan((camera.fov * Math.PI) / 360);
    for (const pin of this.pins.values()) {
      if (pin.target !== pin.shown || pin.delay > 0) {
        if (pin.delay > 0) pin.delay -= dt;
        else pin.shown = pin.target > pin.shown ? Math.min(1, pin.shown + dt / POP) : Math.max(0, pin.shown - dt / (0.6 * POP));
      }
      const pop = pin.target > 0 ? popUp(pin.shown) : pin.shown * pin.shown;
      pin.group.visible = pop > 0.001;
      if (!pin.group.visible) continue;
      any = true;
      const { dir, ground } = pin.spec;
      up.copy(dir);
      warpPoint(warp, p.copy(dir).multiplyScalar(radius + ground), p);
      const size = p.distanceTo(camera.position) * halfHeight * 2 * SCREEN * pop;
      // the needle stands along the local up; the head on its top faces the camera, upright on screen
      // (a heart seen from straight above would be a sliver)
      q.setFromUnitVectors(Y, up);
      pin.group.matrix.compose(p, q, scale.setScalar(size));
      pin.group.matrixWorldNeedsUpdate = true;
      head.copy(p).addScaledVector(up, (pin.spec.kind === 'muse' ? 1.28 : 1.3) * size);
      pin.head.matrix.compose(head, camera.quaternion, scale);
      pin.head.matrixWorldNeedsUpdate = true;
      pin.head.visible = true;
    }
    for (const pin of this.pins.values()) if (!pin.group.visible) pin.head.visible = false;
    this.group.visible = any;
  }

  /** The pin under a screen point (px from the top left of a viewport w × h), if any. */
  pick(x: number, y: number, w: number, h: number, camera: PerspectiveCamera): PinSpec | null {
    let best: PinSpec | null = null;
    let bestD = 30;
    const v = new Vector3();
    for (const pin of this.pins.values()) {
      if (!pin.group.visible) continue;
      v.setFromMatrixPosition(pin.head.matrix).project(camera);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * w - x, ((1 - v.y) / 2) * h - y);
      if (d < bestD) {
        bestD = d;
        best = pin.spec;
      }
    }
    return best;
  }
}

/** 0 → 1 with a little bounce past 1. */
function popUp(t: number): number {
  const u = t - 1;
  return 1 + 2.6 * u * u * u + 1.6 * u * u;
}
