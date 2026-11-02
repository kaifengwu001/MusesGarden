import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Euler,
  Group,
  LatheGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { smoothstep } from '../../core/math';
import { HEADS } from '../../life/flowers';
import { SPECIES_MESH } from '../../life/flowerMeshes';
import type { Fan } from './basketFan';
import type { ButtonLayout } from './basketOverlay';
import { el } from './dom';
import { paint } from './toyPaint';

// The basket as a real thing: a wicker basket with a handle, in the post
// box's toy paint, and in it the finds' flowers, the meadow's own flower
// meshes painted as their patches paint them (flowerPaint.ts). It flies out
// of the rail's icon to the middle, its flowers rise into a fan over it and
// bob there; they drop back in and it flies home; a flower picked comes down
// into its patch on the planet just as the camera stops over it, the size,
// the turn and the colour its patch's hero has there, so the patch takes over
// from it in one frame. One full-screen canvas of its own over the planet
// (pointer events go through it), drawn only while the basket is out,
// made once when the page is idle and never let go. Its camera is
// orthographic in CSS pixels; poses are kept with y down, as the screen is.

/** A find's flower in the basket: its species' mesh, painted by vertex (graded, display-ready), and its hero's size. */
export interface StageFlower {
  readonly id: string;
  readonly species: 0 | 1 | 2 | 3;
  readonly colours: Float32Array;
  /** Its hero's size against the flower mesh (findBeds.ts: species and plant size). */
  readonly size: number;
}

/** A flower's pose on the screen: its stem's foot (px from the top left; z toward you), its turn (y up), its size (px per m of its mesh), its opacity. */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly q: Quaternion;
  readonly s: number;
  readonly a: number;
}

/** Where a flower comes home to: its hero's pose as the frame shows it. */
export interface Landing {
  readonly id: string;
  /** Its colours as its hero shows where it lands (it takes them on over its way). */
  readonly colours: Float32Array;
  /** Its pose once the camera has stopped, foreseen as the flight sets off (null: out of that view). */
  readonly end: Pose | null;
  /** Its pose in the frame drawn now (null: out of view). */
  live(): Pose | null;
}

export interface StageHost {
  /** Seconds until the camera stops (0 once stopped). */
  cameraRemaining(): number;
  /** The basket has left the rail (false), or is back in it (true): the rail's icon shows only then. */
  basketHome(home: boolean): void;
}

type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
type Where = (t: number) => Pose;

/** The basket model's size (model units): its rim's radius, and the box it fills (rim to rim, foot to handle). */
const RIM = 0.52;
const MODEL = { width: 2 * (RIM + 0.05), height: 0.98, middle: 0.07 } as const;
/**
 * A flower in the basket, out of sight: lying on its bottom (model units: its stem this long, its foot this deep and
 * this far to one side, raised this much, rad), a little toward the front, where the front wall hides it.
 */
const IN_BASKET = { stem: 0.6, foot: -0.3, reach: 0.3, raised: 0.12, front: 0.08, spread: 0.12 } as const;
/** A flower ready to go home, standing in the basket: its stem this long (model units), its foot this deep and this far out, leaning out. */
const READY = { stem: 0.7, foot: -0.3, reach: 0.22, lean: 0.24 } as const;
/** A fanned flower's stem against the fan's spacing, and how it is turned toward you. */
const FAN_STEM = 2.3;
const FAN_TIP = 0.55;
/** The basket as it sits: tipped toward you to show its inside, turned a little; smaller while flowers go home. */
const BASKET_TILT = new Euler(0.42, -0.32, 0);
const SMALL = 0.72;
/**
 * Seconds: the basket's flights, a flower's rise out of the basket to its slot (and its drop back in, the same way
 * backward), the stagger between flowers, a vanish, a flower's leave before the camera stops, the gap between leaves,
 * and the beat after the last touch-down before an act is done (the card rises after its flower has settled, not on
 * the frame it lands).
 */
const T = { out: 0.62, home: 0.5, rise: 0.5, stagger: 0.04, vanish: 0.3, lead: 0.45, gap: 0.11, landed: 0.35 } as const;
/** A rise's bow up, against its length. */
const RISE_ARC = 0.3;
/** A flower going home: the least time it takes over its whole way (s), its touch-down after the camera stops (s), and where it starts following the live view. */
const HOMING = { least: 0.6, after: 0.08, follow: 0.7 } as const;
/** Sparkles: how many at once, how long each lives (s). */
const SPARKS = 160;
const SPARK_LIFE = 0.75;
/** Depths (px): fanned flowers stand in the basket's middle (their stems go down into it), flowers going home in front of all. */
const Z = { fan: 0, home: 320 } as const;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const linear = (t: number): number => t;
const early = (t: number): number => 1 - (1 - t) * (1 - t);
const late = (t: number): number => t * t;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeBack = (t: number): number => {
  const u = t - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
};

const flowerVertex = /* glsl */ `
attribute vec3 aColour;
attribute vec3 aHome;
uniform float uHome;
varying vec3 vColour;
varying vec3 vNormal;
void main() {
  vColour = mix(aColour, aHome, uHome);
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// The patch's own paint, and over it while the flower is held up to you a toy's light (a key from the upper
// left, a soft rim) so its cup or star reads as a thing; it fades as the flower comes down into its patch.
// Premultiplied: the canvas is composited over the planet as premultiplied alpha.
const flowerFragment = /* glsl */ `
uniform float uAlpha;
uniform float uShade;
varying vec3 vColour;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float key = max(dot(n, normalize(vec3(-0.45, 0.7, 0.55))), 0.0);
  float rim = pow(1.0 - abs(n.z), 3.0);
  vec3 toy = vColour * (0.74 + 0.36 * key) + rim * 0.08;
  gl_FragColor = vec4(mix(vColour, toy, uShade) * uAlpha, uAlpha);
}`;

const sparkVertex = /* glsl */ `
attribute float aBirth;
attribute vec3 aVelocity;
attribute float aSize;
uniform float uTime;
uniform float uPixelRatio;
varying float vLife;
varying float vTwinkle;
void main() {
  float age = uTime - aBirth;
  vLife = clamp(age / ${SPARK_LIFE.toFixed(2)}, 0.0, 1.0);
  vTwinkle = 0.6 + 0.4 * sin(age * 38.0 + aSize * 11.0);
  vec3 p = position + aVelocity * age * (1.0 - 0.45 * vLife) + vec3(0.0, -60.0, 0.0) * age * age;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = age < 0.0 || vLife >= 1.0 ? 0.0 : aSize * uPixelRatio * (1.0 - vLife * 0.6);
}`;
const sparkFragment = /* glsl */ `
varying float vLife;
varying float vTwinkle;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  // a four-pointed star with a soft core
  float star = max(0.0, 1.0 - abs(d.x * d.y) * 260.0) * smoothstep(0.5, 0.0, r);
  float core = smoothstep(0.2, 0.0, r);
  float a = clamp(star * 0.8 + core, 0.0, 1.0) * (1.0 - vLife) * vTwinkle;
  vec3 col = mix(vec3(1.0, 0.95, 0.78), vec3(1.0, 0.82, 0.55), vLife);
  gl_FragColor = vec4(col * a, a);
}`;

/** The flower meshes as the patches draw them in still air: each head nodded on its stem (findBed.vert.glsl). */
function speciesGeometry(species: number): BufferGeometry {
  const source = SPECIES_MESH[species]();
  const [top, nod] = HEADS[species];
  const pos = source.getAttribute('position').array as Float32Array;
  const part = source.getAttribute('aPart').array as Float32Array;
  const out = new Float32Array(pos.length);
  const c = Math.cos(nod);
  const s = Math.sin(nod);
  for (let i = 0; i < part.length; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (part[i] < 0.5) {
      out.set([x, y, z], i * 3);
      continue;
    }
    const hy = y - top;
    out.set([x, top + hy * c - z * s, z * c + hy * s], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  g.setIndex(source.getIndex());
  g.computeVertexNormals();
  return g;
}

/** The basket: a wicker bowl coiled in rows of two tones, a rim and a handle, its inside dark. */
function basketModel(): Group {
  const light = paint(0xdcae6c, 0x96683a, 0.12, 0x5b3d22);
  const dark = paint(0xbd8a4e, 0x7c522c, 0.12, 0x5b3d22);
  const rim = paint(0xe6be80, 0xa0703f, 0.08, 0x5b3d22);
  const group = new Group();
  // its outline from the foot up (radius, height)
  const outline = [
    [0, -0.4],
    [0.26, -0.4],
    [0.36, -0.36],
    [0.44, -0.25],
    [0.49, -0.11],
    [0.515, 0],
  ];
  const bowl = new LatheGeometry(
    outline.map(([r, y]) => new Vector2(r, y)),
    44,
  );
  group.add(new Mesh(bowl, paint(0xa97543, 0x6b4526, 0.1, 0x4f331c)));
  const radiusAt = (y: number): number => {
    for (let k = 1; k < outline.length; k++) {
      const [r1, y1] = outline[k];
      const [r0, y0] = outline[k - 1];
      if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(y1 - y0, 1e-6);
    }
    return RIM;
  };
  for (let k = 0; k < 6; k++) {
    const y = -0.355 + k * 0.066;
    const row = new Mesh(new TorusGeometry(radiusAt(y) + 0.012, 0.034, 6, 44), k % 2 ? dark : light);
    row.rotation.x = Math.PI / 2;
    row.position.y = y;
    group.add(row);
  }
  const lip = new Mesh(new TorusGeometry(RIM + 0.005, 0.048, 8, 48), rim);
  lip.rotation.x = Math.PI / 2;
  group.add(lip);
  const handle = new Mesh(new TorusGeometry(RIM - 0.02, 0.038, 8, 40, Math.PI), rim);
  handle.rotation.y = 0.12;
  group.add(handle);
  return group;
}

/** A pose from a point (px, y down), a turn, a size and an opacity. */
const pose = (x: number, y: number, z: number, q: Quaternion, s: number, a = 1): Pose => ({ x, y, z, q, s, a });

/** One flower in the stage, where it rests and where it is going. */
interface Bloom {
  readonly look: StageFlower;
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  /** Its place (by its index among the flowers, which is its slot in the fan): out of sight in the basket, standing in it ready to go home, or in the fan. */
  rest: { readonly in: 'basket' | 'ready' | 'fan'; readonly k: number };
  leg: Leg | null;
  /** Going home to its patch. */
  homing: Homing | null;
  /** When it began to vanish (stage s). */
  vanish: number | null;
  /** Under the pointer, eased 0..1. */
  hover: number;
}

/** A way between two places, each followed as it moves (a place in the basket flies with it), eased over [start, start + span] s, bowing up by `arc` of its length. */
interface Leg {
  readonly from: Where;
  readonly to: Where;
  readonly start: number;
  readonly span: number;
  readonly arc: number;
  readonly ease: (t: number) => number;
  /** How far its turn and its size have come when its place is `e` of the way. */
  readonly turn: (e: number) => number;
  readonly grow: (e: number) => number;
}

interface Homing {
  readonly landing: Landing;
  readonly start: number;
  /** How far along, 0..1 (moved on each frame by the time left: the camera's, or the least a flight takes). */
  u: number;
  setOff: Pose | null;
  /** When the camera stopped (stage s; null while it flies). */
  stopped: number | null;
  readonly land: (id: string) => void;
}

/** The basket's place: its middle (px), its size (px per model unit). */
interface BasketPose {
  readonly x: number;
  readonly y: number;
  readonly s: number;
}

interface BasketLeg {
  readonly from: BasketPose;
  readonly to: () => BasketPose;
  readonly start: number;
  readonly span: number;
  readonly arc: number;
  readonly ease: (t: number) => number;
  readonly then?: () => void;
}

/** Sending them all home: the landings still to leave, and when the next goes. */
interface Departures {
  readonly landings: Landing[];
  readonly land: (id: string) => void;
  next: number | null;
}

export class BasketStage {
  private readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer | null = null;
  private failed = false;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(0, 1, 0, -1, -4000, 4000);
  private readonly basket = basketModel();
  private readonly geometries = [0, 1, 2, 3].map(speciesGeometry);
  private readonly flowerMaterial = new ShaderMaterial({
    vertexShader: flowerVertex,
    fragmentShader: flowerFragment,
    uniforms: { uAlpha: { value: 1 }, uHome: { value: 0 }, uShade: { value: 1 } },
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  private readonly sparks: Points<BufferGeometry, ShaderMaterial>;
  private sparkNext = 0;
  private sparkUntil = -1;
  private readonly blooms = new Map<string, Bloom>();
  /** Flowers vanishing or landed, kept until they are gone from the screen. */
  private readonly leaving: Bloom[] = [];
  private fan: Fan | null = null;
  /** Where the basket rests (null: in the rail, not drawn) and its way there. */
  private basketRest: 'centre' | 'small' | null = null;
  private basketLeg: BasketLeg | null = null;
  private basketAt: BasketPose = { x: 0, y: 0, s: 1 };
  private rail: Rect | null = null;
  private basketHover = 0;
  private hovered: string | null = null;
  private departures: Departures | null = null;
  private time = 0;
  private lastLanding = -Infinity;
  private act: { token: number; done: () => void } | null = null;
  private token = 0;
  private drawn = false;
  private width = 1;
  private height = 1;
  private readonly tq = new Quaternion();
  private readonly tv = new Vector3();
  private readonly basketTurn = new Quaternion().setFromEuler(BASKET_TILT);

  constructor(
    parent: HTMLElement,
    private readonly host: StageHost,
  ) {
    this.canvas = el('canvas', 'g-basket-canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.append(this.canvas);
    this.basket.quaternion.copy(this.basketTurn);
    this.basket.visible = false;
    this.scene.add(this.basket);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 3), 3));
    geometry.setAttribute('aVelocity', new BufferAttribute(new Float32Array(SPARKS * 3), 3));
    geometry.setAttribute('aBirth', new BufferAttribute(new Float32Array(SPARKS).fill(-1e6), 1));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(SPARKS), 1));
    this.sparks = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: sparkVertex,
        fragmentShader: sparkFragment,
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.scene.add(this.sparks);
    window.addEventListener('resize', () => this.resize());
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => this.ready(), { timeout: 4000 });
    else setTimeout(() => this.ready(), 1500);
  }

  /** The canvas and its programs, made once (at idle, or at the first use if that comes sooner). */
  private ready(): WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      const r = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
      r.outputColorSpace = SRGBColorSpace;
      r.setClearColor(0x000000, 0);
      this.renderer = r;
      this.resize();
      // every program now, not at the first open
      const probe = this.flower({ id: '', species: 0, colours: new Float32Array(this.geometries[0].getAttribute('position').count * 3), size: 1 });
      this.scene.add(probe.mesh);
      this.basket.visible = true;
      this.sparks.visible = true;
      r.compile(this.scene, this.camera);
      this.scene.remove(probe.mesh);
      probe.mesh.geometry.dispose();
      probe.mesh.material.dispose();
      this.basket.visible = false;
      this.sparks.visible = false;
    } catch (error) {
      console.warn('garden: the basket could not get a canvas of its own', error);
      this.failed = true;
    }
    return this.renderer;
  }

  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const c = this.camera;
    c.right = this.width;
    c.bottom = -this.height;
    c.updateProjectionMatrix();
    const r = this.renderer;
    if (!r) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(ratio);
    r.setSize(this.width, this.height, false);
    this.sparks.material.uniforms.uPixelRatio.value = ratio;
  }

  // ---- the acts (gardenUi carries the basket's effects out through these) ----------------------

  /** Bring the basket out of the rail's icon (`from`) to the middle with these flowers, rising into `fan`. */
  open(flowers: readonly StageFlower[], from: Rect, fan: Fan, animate: boolean, done: () => void): void {
    this.ready();
    this.begin(done);
    this.fan = fan;
    this.rail = from;
    const t = this.time;
    const wasHome = this.basketRest === null && !this.basketLeg;
    if (wasHome) this.basketAt = this.railPose();
    this.setFlowers(flowers);
    this.departures = null;
    if (!animate) {
      this.place('centre');
      for (const [k, b] of this.order()) this.settleIn(b, { in: 'fan', k });
      return;
    }
    this.moveBasket('centre', T.out, 0.22, easeBack);
    this.rise(t + (wasHome ? 0.3 : 0.08));
  }

  /** Another day: the flowers out vanish in a sparkle and these rise out of the basket into `fan`. */
  swap(flowers: readonly StageFlower[], fan: Fan, animate: boolean, done: () => void): void {
    this.begin(done);
    this.fan = fan;
    for (const b of [...this.blooms.values()]) this.vanish(b, animate);
    this.blooms.clear();
    this.setFlowers(flowers);
    if (!animate) {
      for (const [k, b] of this.order()) this.settleIn(b, { in: 'fan', k });
      return;
    }
    this.rise(this.time + 0.15);
  }

  /** Put the flowers back in the basket and the basket back into the rail's icon (`to`). */
  close(to: Rect, animate: boolean, done: () => void): void {
    this.begin(done);
    this.rail = to;
    this.departures = null;
    if (!animate) {
      this.putAway();
      return;
    }
    const t = this.time;
    this.moveBasket(null, T.home, -0.12, easeInOut, this.dropIn(t) - 0.1);
  }

  /** One flower goes home to its patch as the camera flies there; the others drop in and the basket goes back to `to`. */
  sendOne(landing: Landing, to: Rect, animate: boolean, land: (id: string) => void, done: () => void): void {
    this.begin(done);
    this.rail = to;
    this.departures = null;
    const picked = this.take(landing.id);
    const t = this.time;
    const inside = this.dropIn(t);
    if (picked) this.home(picked, landing, t, land, animate);
    else land(landing.id);
    if (animate) this.moveBasket(null, T.home, -0.12, easeInOut, inside - 0.1);
    else this.putAway();
  }

  /** Every flower goes home: they drop in, the basket waits smaller in the middle, and as the camera nears they leave one by one. */
  sendAll(flowers: readonly StageFlower[], landings: readonly Landing[], to: Rect, animate: boolean, land: (id: string) => void, done: () => void): void {
    this.begin(done);
    this.rail = to;
    this.setFlowers(flowers);
    if (!animate) {
      for (const l of landings) {
        const b = this.take(l.id);
        if (b) this.home(b, l, this.time, land, false);
        else land(l.id);
      }
      this.putAway();
      return;
    }
    const t = this.time;
    this.dropIn(t, 'ready');
    this.moveBasket('small', 0.42, 0, easeInOut, t + 0.12);
    this.departures = { landings: [...landings], land, next: null };
  }

  /** Land whatever is in the air now and put the basket away at once (an act cut short). */
  settle(): void {
    const pending = [...this.leaving].filter((b) => b.homing);
    for (const b of pending) this.landNow(b);
    if (this.departures) for (const l of this.departures.landings) this.departures.land(l.id);
    this.departures = null;
    this.act = null;
    this.putAway();
  }

  /** The fan moved (the screen changed size): the flowers out go to their new places. */
  refan(fan: Fan): void {
    this.fan = fan;
  }

  /** Lift the flower under the pointer, or the basket (null: neither). */
  hover(target: { kind: 'find'; id: string } | { kind: 'basket' } | null): void {
    this.hovered = target === null ? null : target.kind === 'basket' ? '' : target.id;
  }

  /** Whether anything of the basket is on the screen. */
  get shown(): boolean {
    return this.drawn;
  }

  // ---- where things are ------------------------------------------------------------------------------

  private begin(done: () => void): void {
    this.act = { token: ++this.token, done };
  }

  /** The flowers in the stage by their place (the order they were given). */
  private *order(): Generator<[number, Bloom]> {
    let k = 0;
    for (const b of this.blooms.values()) yield [k++, b];
  }

  /** Keep these flowers (one already out keeps its place and motion), bring in the new ones in the basket, let the rest vanish. */
  private setFlowers(flowers: readonly StageFlower[]): void {
    const keep = new Map<string, Bloom>();
    flowers.forEach((f, k) => {
      const b = this.blooms.get(f.id) ?? this.flower(f);
      if (!this.blooms.has(f.id)) {
        b.rest = { in: 'basket', k };
        this.scene.add(b.mesh);
      }
      keep.set(f.id, b);
    });
    for (const [id, b] of this.blooms) if (!keep.has(id)) this.vanish(b, true);
    this.blooms.clear();
    for (const [id, b] of keep) this.blooms.set(id, b);
  }

  private flower(look: StageFlower): Bloom {
    // its own copy of its species' mesh (a few dozen vertices): disposing a geometry frees the buffers of every
    // attribute in it, so flowers that shared one would lose theirs when another was put away
    const g = this.geometries[look.species].clone();
    g.setAttribute('aColour', new BufferAttribute(look.colours, 3));
    g.setAttribute('aHome', new BufferAttribute(look.colours, 3));
    const material = this.flowerMaterial.clone();
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
    return { look, mesh, rest: { in: 'basket', k: 0 }, leg: null, homing: null, vanish: null, hover: 0 };
  }

  /** A flower taken out of the stage to go home. */
  private take(id: string): Bloom | undefined {
    const b = this.blooms.get(id);
    this.blooms.delete(id);
    return b;
  }

  private railPose(): BasketPose {
    const r = this.rail;
    if (!r) return { x: this.width - 40, y: this.height / 2, s: 20 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: (r.width * 0.62) / MODEL.width };
  }

  private restingBasket(rest: 'centre' | 'small' | null): BasketPose {
    const fan = this.fan;
    if (rest === null || !fan) return this.railPose();
    const s = ((fan.basket.right - fan.basket.left) / MODEL.width) * (rest === 'small' ? SMALL : 1);
    return { x: fan.basket.x, y: fan.basket.y - MODEL.middle * s, s };
  }

  private place(rest: 'centre' | 'small' | null): void {
    this.basketRest = rest;
    this.basketLeg = null;
    this.basketAt = this.restingBasket(rest);
    this.host.basketHome(rest === null);
  }

  private moveBasket(rest: 'centre' | 'small' | null, span: number, arc: number, ease: (t: number) => number, start = this.time): void {
    const from = { ...this.basketAt };
    this.basketRest = rest;
    if (rest !== null) this.host.basketHome(false);
    this.basketLeg = {
      from,
      to: () => this.restingBasket(rest),
      start,
      span,
      arc,
      ease,
      then: rest === null ? () => this.putAway() : undefined,
    };
  }

  /** Into the rail: every flower in the basket goes with it, and nothing more is drawn. */
  private putAway(): void {
    for (const b of this.blooms.values()) this.drop(b);
    this.blooms.clear();
    for (const b of this.leaving) if (!b.homing) this.drop(b);
    this.leaving.splice(0, this.leaving.length, ...this.leaving.filter((b) => b.homing));
    this.place(null);
  }

  private drop(b: Bloom): void {
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
  }

  /** A point of the basket (model units) on the screen (px, y down), and the basket's turn. */
  private basketPoint(local: Vector3, at: BasketPose, out: Vector3): Vector3 {
    out.copy(local).applyQuaternion(this.basketTurn).multiplyScalar(at.s);
    return out.set(at.x + out.x, at.y - out.y, out.z);
  }

  /** A flower in the basket, lying on its bottom out of sight, its head toward its side of the fan. */
  private inBasket(b: Bloom, k: number): Pose {
    const at = this.basketAt;
    const fan = this.fan;
    const slot = fan?.slots[k];
    const off = slot && fan ? slot.x - fan.basket.x : 0;
    const side = Math.abs(off) > 1 ? Math.sign(off) : k % 2 ? 1 : -1;
    const front = IN_BASKET.front + IN_BASKET.spread * (((k * 0.618) % 1) - 0.5);
    const foot = this.basketPoint(this.tv.set(-side * IN_BASKET.reach, IN_BASKET.foot, front), at, new Vector3());
    const q = this.basketTurn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -side * (Math.PI / 2 - IN_BASKET.raised)));
    return pose(foot.x, foot.y, foot.z, q, (at.s * IN_BASKET.stem) / HEADS[b.look.species][0]);
  }

  /** A flower ready to go home: its foot inside, leaning out, its head above the rim (it leaves from here in view). */
  private readyPose(b: Bloom, k: number, t: number): Pose {
    const at = this.basketAt;
    const angle = k * 2.399 + 0.6;
    const reach = READY.reach * Math.sqrt((k + 0.5) / Math.max(1, this.blooms.size));
    const foot = this.basketPoint(this.tv.set(Math.cos(angle) * reach, READY.foot, Math.sin(angle) * reach * 0.8), at, new Vector3());
    const lean = new Quaternion().setFromEuler(new Euler(Math.sin(angle) * READY.lean, 0, -Math.cos(angle) * READY.lean));
    const sway = Math.sin(t * 1.3 + k * 1.7) * 0.03;
    const q = this.basketTurn.clone().multiply(lean).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sway)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), k * 1.1));
    return pose(foot.x, foot.y, foot.z, q, (at.s * READY.stem) / HEADS[b.look.species][0]);
  }

  /** A flower in the fan: its head on its slot, its stem toward the basket, turned to show its face, bobbing; under the pointer it lifts and grows a little. */
  private inFan(b: Bloom, k: number, t: number): Pose {
    const fan = this.fan;
    const slot = fan?.slots[k];
    if (!fan || !slot) return this.inBasket(b, k);
    const bob = Math.sin(t * 1.7 + k * 1.3);
    const lift = b.hover;
    const s = ((FAN_STEM * fan.size) / HEADS[b.look.species][0]) * (1 + 0.12 * lift) * (b.look.size / 1.6) ** 0.35;
    const q = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 0, 1), -slot.tilt + Math.sin(t * 1.1 + k) * 0.05)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), FAN_TIP))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (k % 2 ? 1 : -1) * 0.9));
    const stem = this.tv.set(0, HEADS[b.look.species][0] * s, 0).applyQuaternion(q);
    return pose(slot.x - stem.x, slot.y + stem.y - 2.5 * bob - 6 * lift, Z.fan + k, q, s);
  }

  /** Where a flower rests, in the basket or on its slot (by default where it is going now). */
  private restPose(b: Bloom, t: number, rest: Bloom['rest'] = b.rest): Pose {
    if (rest.in === 'fan') return this.inFan(b, rest.k, t);
    return rest.in === 'ready' ? this.readyPose(b, rest.k, t) : this.inBasket(b, rest.k);
  }

  /**
   * Send a flower to a place on the rise's way, setting off from wherever it is then. Out of the basket it turns up
   * early and grows late, so it clears the rim before it reaches out to its slot; back in, the same played backward.
   */
  private send(b: Bloom, rest: Bloom['rest'], start: number): void {
    const was = b.leg;
    const at = b.rest;
    const from: Where = was ? (t) => this.legPose(was, t) : (t) => this.restPose(b, t, at);
    const out = rest.in === 'fan';
    b.rest = rest;
    b.leg = { from, to: (t) => this.restPose(b, t, rest), start, span: T.rise, arc: RISE_ARC, ease: easeInOut, turn: out ? early : late, grow: out ? late : early };
  }

  /** Every flower out of the basket to its slot, one after another from `start`. */
  private rise(start: number): void {
    for (const [k, b] of this.order()) this.send(b, { in: 'fan', k }, start + k * T.stagger);
  }

  /** Every flower back into the basket from `start` (out of sight, or ready to go home), the rise played backward (the last out goes in first); returns when the last is in. */
  private dropIn(start: number, into: 'basket' | 'ready' = 'basket'): number {
    const last = this.blooms.size - 1;
    for (const [k, b] of this.order()) this.send(b, { in: into, k }, start + (last - k) * T.stagger);
    return start + Math.max(0, last) * T.stagger + T.rise;
  }

  private settleIn(b: Bloom, rest: Bloom['rest']): void {
    b.rest = rest;
    b.leg = null;
  }

  private vanish(b: Bloom, animate: boolean): void {
    if (!animate) {
      this.drop(b);
      return;
    }
    const now = this.pose(b, this.time);
    b.leg = { from: () => now, to: () => now, start: this.time, span: 1, arc: 0, ease: linear, turn: linear, grow: linear };
    b.vanish = this.time;
    this.sparkle(this.headOf(b), 9, 1);
    this.leaving.push(b);
  }

  private home(b: Bloom, landing: Landing, start: number, land: (id: string) => void, animate: boolean): void {
    const was = b.leg;
    const at = was ? this.legPose(was, this.time) : this.restPose(b, this.time);
    b.leg = null;
    b.homing = { landing, start, u: 0, setOff: at, stopped: null, land };
    const home = b.mesh.geometry.getAttribute('aHome') as BufferAttribute;
    if (landing.colours.length === home.array.length) b.mesh.geometry.setAttribute('aHome', new BufferAttribute(landing.colours, 3));
    if (!animate) b.mesh.visible = false;
    this.leaving.push(b);
  }

  private landNow(b: Bloom): void {
    const h = b.homing;
    if (!h) return;
    b.homing = null;
    this.drop(b);
    this.leaving.splice(this.leaving.indexOf(b), 1);
    this.lastLanding = this.time;
    h.land(b.look.id);
  }

  private headOf(b: Bloom): Vector3 {
    const p = this.pose(b, this.time);
    const v = new Vector3(0, HEADS[b.look.species][0] * p.s, 0).applyQuaternion(p.q);
    return new Vector3(p.x + v.x, p.y - v.y, p.z + v.z);
  }

  private legPose(leg: Leg, t: number): Pose {
    if (t < leg.start) return leg.from(t);
    const u = clamp01((t - leg.start) / leg.span);
    const e = leg.ease(u);
    return blend(leg.from(t), leg.to(t), e, leg.arc, leg.turn(e), leg.grow(e));
  }

  private homePose(h: Homing): Pose {
    const from = h.setOff!;
    const live = h.landing.live();
    const end = h.landing.end ?? live ?? from;
    const follow = smoothstep(HOMING.follow, 1, h.u);
    const target = live ? blend(end, live, follow, 0) : end;
    const e = easeInOut(h.u);
    // up off its place a little, then down onto its patch from above
    const lift = 36;
    const drop = 70 * Math.min(1, target.s / 60);
    const x = cubic(from.x, from.x, target.x, target.x, e);
    const y = cubic(from.y, from.y - lift, target.y - drop, target.y, e);
    const q = from.q.clone().slerp(target.q, smoothstep(0, 0.85, h.u));
    const s = from.s * Math.pow(target.s / from.s, e);
    return pose(x, y, Z.home, q, s, 1);
  }

  private pose(b: Bloom, t: number): Pose {
    let p: Pose;
    if (b.homing) p = this.homePose(b.homing);
    else if (b.leg) p = this.legPose(b.leg, t);
    else p = this.restPose(b, t);
    if (b.vanish !== null) {
      const v = clamp01((t - b.vanish) / T.vanish);
      p = { ...p, s: p.s * (1 - easeInOut(v)) * (1 + 0.3 * v), a: p.a * (1 - v * v) };
    }
    return p;
  }

  private sparkle(at: Vector3, n: number, spread: number): void {
    const g = this.sparks.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const vel = g.getAttribute('aVelocity') as BufferAttribute;
    const birth = g.getAttribute('aBirth') as BufferAttribute;
    const size = g.getAttribute('aSize') as BufferAttribute;
    for (let i = 0; i < n; i++) {
      const k = this.sparkNext;
      this.sparkNext = (k + 1) % SPARKS;
      const a = Math.random() * Math.PI * 2;
      const speed = (40 + Math.random() * 90) * spread;
      pos.setXYZ(k, at.x + Math.cos(a) * 6, -at.y + Math.sin(a) * 6, Z.home + 10);
      vel.setXYZ(k, Math.cos(a) * speed, Math.sin(a) * speed + 40 * spread, 0);
      birth.setX(k, this.time + Math.random() * 0.12);
      size.setX(k, 7 + Math.random() * 9);
    }
    pos.needsUpdate = vel.needsUpdate = birth.needsUpdate = size.needsUpdate = true;
    this.sparkUntil = Math.max(this.sparkUntil, this.time + 0.12 + SPARK_LIFE);
  }

  // ---- each frame --------------------------------------------------------------------------------------

  /** Move everything on by `dt` s and draw (only while anything of the basket is out). */
  frame(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.stepBasket(t);
    this.stepDepartures(t);
    for (const b of this.blooms.values()) {
      b.hover = approach(b.hover, this.hovered === b.look.id ? 1 : 0, dt / 0.12);
      if (b.leg && t >= b.leg.start + b.leg.span) b.leg = null;
    }
    this.basketHover = approach(this.basketHover, this.hovered === '' ? 1 : 0, dt / 0.15);
    for (const b of [...this.leaving]) {
      if (b.homing) this.stepHoming(b, b.homing, t, dt);
      else if (b.vanish !== null && t >= b.vanish + T.vanish) {
        this.drop(b);
        this.leaving.splice(this.leaving.indexOf(b), 1);
      }
    }
    const busy = this.basketRest !== null || this.basketLeg !== null || this.blooms.size > 0 || this.leaving.length > 0 || t < this.sparkUntil;
    if (this.act && this.settled()) {
      const act = this.act;
      this.act = null;
      act.done();
    }
    if (!busy) {
      if (this.drawn) this.clear();
      return;
    }
    this.draw(t);
  }

  /** Nothing moving: every flower at rest, the basket where it rests, nothing in the air. */
  private settled(): boolean {
    if (this.basketLeg || this.departures || this.leaving.some((b) => b.homing) || this.time < this.lastLanding + T.landed) return false;
    for (const b of this.blooms.values()) if (b.leg) return false;
    return true;
  }

  private stepBasket(t: number): void {
    const leg = this.basketLeg;
    if (!leg) {
      if (this.basketRest !== null) this.basketAt = this.restingBasket(this.basketRest);
      return;
    }
    if (t < leg.start) return;
    const u = clamp01((t - leg.start) / leg.span);
    const to = leg.to();
    const e = leg.ease(u);
    const lift = leg.arc * Math.hypot(to.x - leg.from.x, to.y - leg.from.y);
    const mid = { x: (leg.from.x + to.x) / 2, y: (leg.from.y + to.y) / 2 - lift };
    this.basketAt = {
      x: quad(leg.from.x, mid.x, to.x, clamp01(e)),
      y: quad(leg.from.y, mid.y, to.y, clamp01(e)),
      s: leg.from.s * Math.pow(to.s / leg.from.s, e),
    };
    if (u >= 1) {
      this.basketLeg = null;
      leg.then?.();
    }
  }

  private stepDepartures(t: number): void {
    const d = this.departures;
    if (!d) return;
    if (d.next === null) {
      // the flowers are in and the camera nearly there (or stopped)
      const dropping = [...this.blooms.values()].some((b) => b.leg);
      if (dropping || this.host.cameraRemaining() > T.lead) return;
      d.next = t;
    }
    while (d.next !== null && t >= d.next && d.landings.length > 0) {
      const landing = d.landings.shift()!;
      const b = this.take(landing.id);
      if (b) this.home(b, landing, t, d.land, true);
      else d.land(landing.id);
      d.next += T.gap;
    }
    if (d.landings.length === 0) {
      this.departures = null;
      this.moveBasket(null, T.home, -0.1, easeInOut, t + 0.25);
    }
  }

  private stepHoming(b: Bloom, h: Homing, t: number, dt: number): void {
    const camera = this.host.cameraRemaining();
    if (camera <= 0 && h.stopped === null) h.stopped = t;
    if (!b.mesh.visible) {
      // no motion to watch: it lands as the camera stops
      if (h.stopped !== null) this.landNow(b);
      return;
    }
    const settle = h.stopped === null ? camera + HOMING.after : Math.max(0, h.stopped + HOMING.after - t);
    const left = Math.max(HOMING.least * (1 - h.u), settle);
    h.u = dt >= left ? 1 : h.u + (1 - h.u) * (dt / left);
    if (h.u >= 1) this.landNow(b);
  }

  private draw(t: number): void {
    const r = this.renderer;
    if (!r) return;
    const at = this.basketAt;
    const b = this.basket;
    b.visible = this.basketRest !== null || this.basketLeg !== null;
    const wobble = Math.sin(t * 9) * 0.04 * this.basketHover;
    b.position.set(at.x, -at.y, 0);
    b.scale.setScalar(at.s * (1 + 0.04 * this.basketHover));
    b.quaternion.copy(this.basketTurn).multiply(this.tq.setFromAxisAngle(this.tv.set(0, 0, 1), wobble));
    for (const bloom of [...this.blooms.values(), ...this.leaving]) {
      const p = this.pose(bloom, t);
      const m = bloom.mesh;
      m.position.set(p.x, -p.y, p.z);
      m.quaternion.copy(p.q);
      m.scale.setScalar(Math.max(p.s, 1e-4));
      m.material.uniforms.uAlpha.value = p.a;
      m.material.uniforms.uHome.value = bloom.homing ? smoothstep(0, 0.9, bloom.homing.u) : 0;
      m.material.uniforms.uShade.value = bloom.homing ? 1 - smoothstep(0.1, HOMING.follow, bloom.homing.u) : 1;
      m.material.transparent = p.a < 0.999;
      m.material.depthWrite = p.a >= 0.999;
    }
    this.sparks.visible = t < this.sparkUntil;
    this.sparks.material.uniforms.uTime.value = t;
    this.canvas.classList.add('is-on');
    this.drawn = true;
    r.render(this.scene, this.camera);
  }

  private clear(): void {
    this.drawn = false;
    this.canvas.classList.remove('is-on');
    this.renderer?.clear();
  }

  /** Where the overlay's buttons go this frame: the fanned flowers' heads and the basket. */
  layout(): ButtonLayout {
    const flowers: Array<{ id: string; x: number; y: number }> = [];
    for (const b of this.blooms.values()) {
      if (b.rest.in !== 'fan') continue;
      const h = this.headOf(b);
      flowers.push({ id: b.look.id, x: h.x, y: h.y });
    }
    const shown = this.basketRest !== null || this.basketLeg !== null;
    const at = this.basketAt;
    return {
      flowers,
      basket: shown ? { x: at.x, y: at.y + MODEL.middle * at.s, width: MODEL.width * at.s, height: MODEL.height * at.s } : null,
    };
  }
}

function approach(value: number, target: number, k: number): number {
  return value + (target - value) * Math.min(1, k);
}

const quad = (a: number, c: number, b: number, u: number): number => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;
const cubic = (a: number, b: number, c: number, d: number, u: number): number => {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
};

/** Between two poses, `e` of the way (its turn `turn` and its size `grow` of theirs), bowing up (toward the screen's top) by `arc` of the distance. */
function blend(a: Pose, b: Pose, e: number, arc: number, turn = e, grow = e): Pose {
  const lift = arc * Math.hypot(b.x - a.x, b.y - a.y);
  const u = clamp01(e);
  return {
    x: quad(a.x, (a.x + b.x) / 2, b.x, e),
    y: quad(a.y, (a.y + b.y) / 2 - lift, b.y, e),
    z: a.z + (b.z - a.z) * u,
    q: a.q.clone().slerp(b.q, clamp01(turn)),
    s: a.s * Math.pow(b.s / Math.max(a.s, 1e-6), grow),
    a: a.a + (b.a - a.a) * u,
  };
}
