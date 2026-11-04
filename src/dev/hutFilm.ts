import { DataTexture, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2, Vector3, type WebGLRenderer } from 'three';
import { smoothstep } from '../core/math';
import type { FilmLook } from '../life/hut';
import { MUSE_HEIGHT } from '../life/muse';
import { BOUNCE } from '../life/museRig';
import type { Roaming } from '../life/museRoam';
import { FLOOR } from '../life/props';
import type { Cutaway } from '../view/cutaway';
import type { World } from '../world';

// The room furnishing itself, a shot for the demo film (Kai, 2026-11-04): Muse's hut seen through the cutaway
// (view/cutaway.ts), empty at first but for Muse in its middle, facing you and bouncing for joy; then each piece of
// furniture comes into being in turn, out from Muse (the rug bubbling in under its feet first, Muse's showpiece
// last), each from its foot up behind a ragged, glowing blue edge (hut.frag.glsl FILM), the fire, the candle and
// the lantern coming alight with their pieces, the camera turning slowly round and coming in a little.
//
// Every frame is a function of time only, so it is filmed frame by frame
// (tools/workflows/muse-look/scripts/furnish.mjs): hutFilm.frame(t, samples, shutter) averages renders over the
// shutter (s), each with the view moved by a fraction of a pixel (motion blur, smooth edges). Dev only, and loaded
// into the meadow's dev server by that script; by hand, in the console of the meadow's dev page:
//   const { hutFilm } = await import('/src/dev/hutFilm.ts'); await hutFilm.start(); hutFilm.play();
// The meadow is untouched until start() and as it was after stop().

/** The film's length (s). */
export const LENGTH = 6;
/**
 * The cues: each piece (and the rug) by name, when it starts coming in (s) and how long it takes (s). Out from Muse,
 * near to far: the rug under its feet, the table, the armchair, the hearth's stove, the desk, the low shelf, the bed,
 * the pots' shelf over the low one, the dish cabinet, and last its showpiece, the tall display cabinet.
 */
export const CUES: Array<[string, number, number]> = [
  ['rug', 0.3, 1.5],
  ['dining-table', 0.75, 1.1],
  ['woven-armchair', 1.05, 1.0],
  ['wood-stove', 1.35, 1.45],
  ['work-desk', 1.65, 1.1],
  ['display-shelf', 1.95, 1.1],
  ['single-bed', 2.2, 1.25],
  ['wall-shelf', 2.5, 0.95],
  ['dish-cabinet', 2.75, 1.3],
  ['display-cabinet', 3.05, 1.6],
];
/** Where Muse stands (local m): on the rug at the room's middle, clear of the table and the armchair. */
export const SPOT = { x: 0.3, z: 0.2 };
/**
 * The view: the point looked at (local m), the camera's bearing round from the front toward the right end and its
 * height over the horizon (rad), and the half-height of the view at the room (m), at the start and at the end (a slow
 * turn and a push in, eased); the field of view (°).
 */
export const SHOT = {
  // (the whole room in frame, centred: its far corner's top and its near corner's foot as far from the middle)
  at: [-0.39, FLOOR + 0.55, -0.53] as [number, number, number],
  // (lower than the cutaway's own view, a little from the side: the pieces rise up their fronts, and Muse's hops show)
  from: { azimuth: 0.74, elevation: 0.87, size: 4.75 },
  to: { azimuth: 0.52, elevation: 0.92, size: 4.48 },
  fov: 15,
};
/** How far into its bounce Muse is as the film starts (s): already up off the floor. How high its hops go (× its own bounce's: seen from high above, the hops' own height hardly shows). */
const BOUNCE_LEAD = 0.35;
const HOP = 1.7;
/** Muse's shade on the floor under it: how wide (m) and how dark, on the floor; how much wider and lighter at the top of a hop. */
const SHADE = { width: 0.6, dark: 0.62, wider: 0.35, lighter: 0.55 } as const;

interface Meadow {
  isReady: boolean;
  freeze(t: number | null): void;
  renderFrame(): void;
  settle(): Promise<void>;
  setScale(scale: number): void;
}
interface Garden {
  cutaway: Cutaway;
  hut(doing?: string, put?: boolean): void;
  inHut(): { active: boolean; open: boolean; loaded: boolean };
}
const page = window as unknown as { __world: World; __meadow: Meadow; __garden: Garden };

/** How far into its bounce Muse is at t (s): the hops go on and on (the second and third hops looped, seamless). */
function bounceClock(t: number): number {
  const p = BOUNCE.period;
  const b = t + BOUNCE_LEAD;
  return b < 2 * p ? b : p + ((b - p) % (2 * p));
}

/** How high Muse is off the floor at a moment of its bounce (H): as museRig.ts bounce() lifts it (0.32 of each hop on the ground). */
function hopLift(b: number): number {
  const u = b / BOUNCE.period - Math.floor(b / BOUNCE.period);
  if (b >= BOUNCE.hops * BOUNCE.period || u < 0.32) return 0;
  const s = (u - 0.32) / 0.68;
  return 4 * BOUNCE.height * s * (1 - s);
}

/** Each piece's share in at t (0 … 1), eased. */
function builtAt(t: number, start: number, length: number): number {
  return smoothstep(0, 1, (t - start) / length);
}

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

const tmp = new Vector3();
const tmp2 = new Vector3();

class HutFilm {
  readonly length = LENGTH;
  readonly cues = CUES;
  readonly shot = SHOT;
  readonly spot = SPOT;
  /** World time at the film's start (s): the clock is frozen at t0 + t for each moment t. */
  t0 = 40;
  private started = false;
  private playing = 0;
  /** Muse's life while the film plays (muse.ts film). */
  private readonly life: Roaming = {
    dir: new Vector3(0, 1, 0),
    height: 0,
    heading: new Vector3(1, 0, 0),
    action: { time: 0, walk: 0, stride: 1, gait: 0, wave: -1, lookYaw: 0, lookPitch: 0, look: 1, moves: [] },
    lookAt: null,
    cues: { water: null, fish: null, cook: null, sleep: null, hum: 0, petted: -1 },
    home: true,
  };
  private readonly view = { at: new Vector3(), azimuth: 0, elevation: 0, fov: SHOT.fov, size: 1 };
  // averaging the renders of a frame: each as drawn on the canvas read back and summed, the mean drawn back onto it
  // (the canvas has no alpha, so it can't be copied into a texture on the GPU)
  private pixels = new Uint8Array(0);
  private sum = new Float32Array(0);
  private mean: DataTexture | null = null;
  private readonly quad = new Mesh(new PlaneGeometry(2, 2));
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly out = new ShaderMaterial({
    uniforms: { tMean: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tMean; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tMean, vUv).rgb, 1.0); }',
    depthTest: false,
    depthWrite: false,
  });

  /** How its edge looks (hut.ts FilmLook), to tune it. */
  get look(): FilmLook {
    return page.__world.hut.filmLook;
  }

  /**
   * Into the hut (Muse put there, the clock frozen at t0), the room's furniture in, then the film set going: every
   * piece out, Muse in the middle, the camera on the shot. Resolves once the first moment is drawn.
   */
  async start(options: { t0?: number; look?: Partial<FilmLook> } = {}): Promise<void> {
    const { __world: w, __meadow: m, __garden: g } = page;
    if (options.t0 !== undefined) this.t0 = options.t0;
    m.freeze(this.t0);
    this.view.size = SHOT.from.size;
    g.cutaway.film = this.view;
    this.moment(0);
    if (!g.inHut().active) g.hut('greet', true);
    // (the camera rises into the room on the app's own frames; the furniture loads meanwhile)
    for (let k = 0; k < 600; k++) {
      const s = g.inHut();
      if (s.open && s.loaded) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!g.inHut().open) throw new Error('hut film: the cutaway did not open');
    w.hut.film(true);
    if (options.look) Object.assign(w.hut.filmLook, options.look);
    w.muse.film = (time, camera) => this.muse(time, camera);
    this.started = true;
    this.moment(0);
    m.freeze(this.t0);
    await m.settle();
    await m.settle();
    m.setScale(1);
  }

  /** Back to the meadow as it was: the room drawn as ever, Muse its own, the view the cutaway's; still in the hut. */
  stop(): void {
    const { __world: w, __garden: g } = page;
    this.playing = 0;
    w.hut.film(false);
    w.muse.film = null;
    g.cutaway.film = null;
    this.started = false;
  }

  /** Set the moment t (s) for the next render: each piece's share in, the view, Muse's shade on the floor (Muse itself follows the clock). */
  moment(t: number): void {
    const w = page.__world;
    for (const [name, start, length] of CUES) w.hut.built.set(name, builtAt(t, start, length));
    // the view: a slow turn round and a push in, eased over the whole film
    const e = smoothstep(0, 1, t / LENGTH);
    const v = this.view;
    v.at.set(...SHOT.at);
    v.azimuth = SHOT.from.azimuth + (SHOT.to.azimuth - SHOT.from.azimuth) * e;
    v.elevation = SHOT.from.elevation + (SHOT.to.elevation - SHOT.from.elevation) * e;
    v.size = Math.exp(Math.log(SHOT.from.size) + (Math.log(SHOT.to.size) - Math.log(SHOT.from.size)) * e);
    v.fov = SHOT.fov;
    // the rug bubbles in from under Muse; Muse's shade on the floor, wider and lighter as it hops up
    w.hut.filmFrom(SPOT.x, SPOT.z);
    const up = hopLift(bounceClock(t)) / BOUNCE.height;
    w.hut.filmMuse(SPOT.x, SPOT.z, SHADE.width * (1 + SHADE.wider * up), SHADE.dark * (1 - SHADE.lighter * up));
  }

  /** Muse's life at a time (world s): on its spot, facing the camera, bouncing on and on, looking up at you. */
  private muse(time: number, camera: Vector3): Roaming {
    const w = page.__world;
    const l = this.life;
    const t = time - this.t0;
    page.__garden.cutaway.local(SPOT.x, 0, SPOT.z, l.dir).normalize();
    l.height = w.terrain.cottageGround + FLOOR;
    // facing the camera: its way along the ground toward it
    l.heading.copy(camera).addScaledVector(l.dir, -camera.dot(l.dir));
    if (l.heading.lengthSq() < 1e-8) l.heading.set(1, 0, 0);
    l.heading.normalize();
    const a = l.action;
    a.time = time;
    a.moves.length = 0;
    a.moves.push({ kind: 'bounce', time: bounceClock(t), amount: 1, hop: HOP });
    // looking at you (up toward the camera, as far as its head tips: museRig.ts lookPose)
    const eye = tmp.copy(l.dir).multiplyScalar(w.growth.radius + l.height + 0.77 * MUSE_HEIGHT);
    const d = tmp2.subVectors(camera, eye);
    const ahead = d.dot(l.heading);
    a.lookYaw = 0;
    a.lookPitch = Math.atan2(d.dot(l.dir), Math.max(Math.abs(ahead), 0.3));
    a.look = 1;
    return l;
  }

  /**
   * Draw the moment t (s): `samples` renders over the shutter (s) about it, each with the view moved by a fraction of
   * a pixel, averaged onto the canvas (one render: just that moment). Synchronous, so the canvas still holds it when
   * a screenshot is taken (with the app's own loop held: lib.mjs pausable, window.__pause).
   */
  frame(t: number, samples = 1, shutter = 0): void {
    if (!this.started) throw new Error('hut film: start() first');
    const { __world: w, __meadow: m } = page;
    // (main.ts owns the renderer; the world holds it, unexposed but for dev hooks like this)
    const r = (w as unknown as { renderer: WebGLRenderer }).renderer;
    const camera = w.rig.camera;
    if (samples <= 1) {
      this.moment(t);
      m.freeze(this.t0 + t);
      camera.clearViewOffset();
      m.renderFrame();
      return;
    }
    const size = r.getDrawingBufferSize(new Vector2());
    const [W, H] = [size.x, size.y];
    if (this.pixels.length !== W * H * 4) {
      this.pixels = new Uint8Array(W * H * 4);
      this.sum = new Float32Array(W * H * 4);
      this.mean?.dispose();
      this.mean = new DataTexture(new Uint8Array(W * H * 4), W, H, RGBAFormat, UnsignedByteType);
      this.mean.minFilter = this.mean.magFilter = NearestFilter;
      this.mean.generateMipmaps = false;
    }
    const gl = r.getContext();
    const { pixels, sum } = this;
    sum.fill(0);
    for (let i = 0; i < samples; i++) {
      const s = t + ((i + 0.5) / samples - 0.5) * shutter;
      this.moment(s);
      m.freeze(this.t0 + s);
      camera.setViewOffset(W, H, halton(i, 2) - 0.5, halton(i, 3) - 0.5, W, H);
      m.renderFrame();
      r.setRenderTarget(null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let k = 0; k < pixels.length; k++) sum[k] += pixels[k];
    }
    camera.clearViewOffset();
    const mean = this.mean!;
    const data = mean.image.data as Uint8Array;
    for (let k = 0; k < data.length; k++) data[k] = Math.round(sum[k] / samples);
    mean.needsUpdate = true;
    this.out.uniforms.tMean.value = mean;
    this.quad.material = this.out;
    r.setRenderTarget(null);
    r.render(this.quad, this.quadCamera);
  }

  /** Play it live, over and over, on the app's own frames (from t, s); stop() or pause() to end it. */
  play(from = 0): void {
    const id = ++this.playing;
    const start = performance.now() - from * 1000;
    const tick = (): void => {
      if (this.playing !== id) return;
      const t = (((performance.now() - start) / 1000) % LENGTH + LENGTH) % LENGTH;
      this.moment(t);
      page.__meadow.freeze(this.t0 + t);
      requestAnimationFrame(tick);
    };
    tick();
  }

  pause(): void {
    this.playing = 0;
  }
}

export const hutFilm = new HutFilm();
(window as unknown as { hutFilm: HutFilm }).hutFilm = hutFilm;
