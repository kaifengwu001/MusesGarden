import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three';
import { el } from './dom';
import { paint } from './toyPaint';

// The post box, bottom right, as in Travel Frog: a little painted rural
// mailbox on a wooden post with grass and flowers at its foot, a real model
// in a small canvas of its own, lit like a toy on a sunny sill. Its red flag
// goes up when a postcard has come (and the count shows on a tag); an
// invitation adds a wax seal. Tap it and its door drops open and the cards
// inside rise to the mouth (ui/garden/mail.ts takes them from there). It
// draws only while something moves.

const W = 0.46;
const WALL = 0.2;
const ARCH = W / 2;
const DEPTH = 0.72;
const THICK = 0.024;
const POST = 0.6;
/** Where the count and an invitation's seal sit on the model (model space, m). */
const COUNT_AT = new Vector3(-W / 2 + 0.02, WALL + ARCH * 0.72, DEPTH / 2 - 0.02);
const SEAL_AT = new Vector3(0.07, WALL * 0.45, DEPTH / 2 + 0.03);

/** The box's profile: flat floor, straight sides, a round top; `inset` inward (m). */
function profile(inset: number): Shape {
  const s = new Shape();
  s.moveTo(-W / 2 + inset, inset);
  s.lineTo(W / 2 - inset, inset);
  s.lineTo(W / 2 - inset, WALL);
  s.absarc(0, WALL, ARCH - inset, 0, Math.PI, false);
  s.lineTo(-W / 2 + inset, inset);
  return s;
}

/** The profile with a hole: the walls of the box (outer, then inner inset, m). */
function walls(outer: number, inner: number): Shape {
  const s = profile(outer);
  s.holes.push(profile(inner));
  return s;
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(38, 52, 40, 0.42)');
  grad.addColorStop(0.55, 'rgba(38, 52, 40, 0.16)');
  grad.addColorStop(1, 'rgba(38, 52, 40, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  ms: number;
  ease: (t: number) => number;
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number): number => {
  const u = t - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
};
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PostBox {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly count: HTMLElement;
  private readonly seal: HTMLElement;
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(27, 156 / 184, 0.1, 20);
  private readonly model = new Group();
  private readonly door = new Group();
  private readonly flag = new Group();
  private readonly cards = new Group();
  private readonly state = { door: 0, flag: 0, cards: 0, wiggle: 0 };
  private readonly tweens = new Map<keyof PostBox['state'], Tween>();
  private raf = 0;
  private wake = 0;
  private flagUp = false;
  private nextWaggle = 0;
  private readonly tmp = new Vector3();

  constructor(parent: HTMLElement, onOpen: () => void) {
    this.el = el('div', 'g-postbox');
    this.canvas = el('canvas', 'g-postbox-canvas');
    const hit = el('button', 'g-postbox-hit');
    hit.type = 'button';
    hit.setAttribute('aria-label', 'Post box');
    hit.title = 'Post box';
    hit.addEventListener('click', onOpen);
    hit.addEventListener('pointerenter', () => this.wiggle());
    this.count = el('span', 'g-postbox-count');
    this.seal = el('span', 'g-seal');
    this.seal.title = 'An invitation';
    this.el.append(this.canvas, hit, this.count, this.seal);
    parent.append(this.el);
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true });
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch (error) {
      console.warn('garden: the post box could not get a canvas of its own', error);
      this.el.classList.add('is-flat');
    }
    this.build();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.kick();
  }

  private build(): void {
    const blue = paint(0x93bcd9, 0x5b82a8, 0.06);
    const wood = paint(0xb08156, 0x6c4a31, 0.12);
    const coral = paint(0xe8625a, 0xa83a3c, 0.04);
    const brass = paint(0xdcbf7a, 0x9a7a3c, 0.03);
    const grass = paint(0x9cc562, 0x5d8a3c, 0.1);
    const card = paint(0xfbf6ea, 0xc9bda6, 0.02);
    // the body: a round-topped tunnel, its walls with thickness, closed at the back
    const body = new ExtrudeGeometry(walls(0, THICK), { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 28 });
    body.translate(0, 0, -DEPTH / 2);
    const back = new ExtrudeGeometry(profile(0.004), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 28 });
    back.translate(0, 0, -DEPTH / 2 - 0.012);
    this.model.add(new Mesh(body, blue), new Mesh(back, blue));
    // a band round the back and a painted rim at the mouth
    const rim = new ExtrudeGeometry(walls(-0.012, 0.006), { depth: 0.03, bevelEnabled: false, curveSegments: 28 });
    rim.translate(0, 0, DEPTH / 2 - 0.05);
    this.model.add(new Mesh(rim, paint(0xa9cbe3, 0x6a90b4, 0.05)));
    // the door: hinged on its bottom edge at the mouth
    const doorGeometry = new ExtrudeGeometry(profile(-0.006), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 28 });
    const doorMesh = new Mesh(doorGeometry, blue);
    // a little brass pull at the top of the door
    const latch = new Mesh(new CylinderGeometry(0.013, 0.016, 0.034, 16), brass);
    latch.rotation.x = Math.PI / 2;
    latch.position.set(0, WALL + ARCH - 0.06, 0.045);
    const plate = new Mesh(new BoxGeometry(0.15, 0.06, 0.008), card);
    plate.position.set(0, 0.12, 0.034);
    const stamp = new Mesh(new BoxGeometry(0.035, 0.04, 0.004), coral);
    stamp.position.set(0.05, 0.12, 0.04);
    this.door.add(doorMesh, latch, plate, stamp);
    this.door.position.set(0, 0, DEPTH / 2 - 0.004);
    this.model.add(this.door);
    // the flag on the right side: up when there is post
    const arm = new Mesh(new BoxGeometry(0.016, 0.34, 0.028), coral);
    arm.position.y = 0.17;
    const banner = new Mesh(new BoxGeometry(0.014, 0.11, 0.13), coral);
    banner.position.set(0, 0.29, -0.078);
    const hub = new Mesh(new CylinderGeometry(0.028, 0.028, 0.02, 20), brass);
    hub.rotation.z = Math.PI / 2;
    this.flag.add(arm, banner, hub);
    this.flag.position.set(W / 2 + 0.02, 0.13, -0.16);
    this.model.add(this.flag);
    // the post, the board the box sits on
    const post = new Mesh(new BoxGeometry(0.085, POST, 0.085), wood);
    post.position.y = -POST / 2;
    const board = new Mesh(new BoxGeometry(W * 0.78, 0.026, DEPTH * 0.82), wood);
    board.position.y = -0.006;
    this.model.add(post, board);
    // postcards inside, ready to rise to the mouth
    for (let k = 0; k < 3; k++) {
      const c = new Mesh(new BoxGeometry(0.3, 0.006, 0.2), card);
      c.position.set((k - 1) * 0.01, 0.03 + k * 0.008, 0.12 - k * 0.012);
      c.rotation.y = (k - 1) * 0.06;
      this.cards.add(c);
    }
    this.model.add(this.cards);
    // its foot: a soft shadow, a tuft of grass, three flowers
    const shadow = new Mesh(new PlaneGeometry(0.62, 0.62), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -POST + 0.002;
    this.model.add(shadow);
    let seed = 7;
    const r = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const blade: BufferGeometry = new ConeGeometry(0.011, 1, 4, 1).translate(0, 0.5, 0);
    for (let k = 0; k < 26; k++) {
      const m = new Mesh(blade, grass);
      const a = r() * Math.PI * 2;
      const d = 0.05 + r() * 0.1;
      m.position.set(Math.cos(a) * d, -POST, Math.sin(a) * d);
      m.scale.set(1, 0.08 + r() * 0.12, 1);
      m.rotation.set((r() - 0.5) * 0.7, r() * 3, (r() - 0.5) * 0.7);
      this.model.add(m);
    }
    const head = new SphereGeometry(0.022, 12, 8);
    const stem = new CylinderGeometry(0.003, 0.003, 1, 5).translate(0, 0.5, 0);
    [
      [0xf08ea4, 0.11, 0.07, 0.16],
      [0xf7f2e4, -0.1, 0.09, 0.13],
      [0xf3c94e, 0.02, -0.12, 0.11],
    ].forEach(([colour, x, z, h]) => {
      const s = new Mesh(stem, grass);
      s.position.set(x, -POST, z);
      s.scale.y = h;
      const f = new Mesh(head, paint(colour, colour === 0xf7f2e4 ? 0xc9c0ad : colour === 0xf08ea4 ? 0xb85a72 : 0xb88f2a, 0.03));
      f.position.set(x, -POST + h, z);
      this.model.add(s, f);
    });
    this.model.position.y = 0.16;
    this.model.rotation.y = -0.38;
    this.scene.add(this.model);
    this.camera.position.set(0.22, 0.6, 2.85);
    this.camera.lookAt(0.03, 0.04, 0);
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth || 156;
    const h = this.canvas.clientHeight || 184;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  }

  private tween(key: keyof PostBox['state'], to: number, ms: number, ease = easeOut): void {
    this.tweens.set(key, { from: this.state[key], to, start: performance.now(), ms, ease });
    this.kick();
  }

  /** How much post is waiting: the flag and the count; invitations add the seal. */
  setMail(unread: number, invitations: number): void {
    const up = unread > 0;
    if (up !== this.flagUp) {
      this.flagUp = up;
      this.tween('flag', up ? 1 : 0, up ? 900 : 500, up ? easeBack : easeOut);
      if (up) this.nextWaggle = performance.now() + 2500;
    }
    this.count.textContent = unread > 0 ? String(unread) : '';
    this.count.classList.toggle('is-on', unread > 0);
    this.seal.classList.toggle('is-on', invitations > 0);
    this.el.classList.toggle('has-mail', up);
  }

  /** Drop the door open and lift the cards to the mouth; resolves with the mouth on screen (px). */
  async open(): Promise<{ x: number; y: number }> {
    this.tween('door', 1, 420, easeBack);
    setTimeout(() => this.tween('cards', 1, 380, easeOut), 160);
    await new Promise((resolve) => setTimeout(resolve, 420));
    return this.mouth();
  }

  close(): void {
    this.tween('cards', 0, 240, easeOut);
    setTimeout(() => this.tween('door', 0, 380, easeInOut), 120);
  }

  /** The box's mouth on screen (px). */
  mouth(): { x: number; y: number } {
    const p = new Vector3(0, WALL, DEPTH / 2 + 0.05);
    this.model.updateMatrixWorld(true);
    p.applyMatrix4(this.model.matrixWorld).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Hold a tag over a point of the model (model space). */
  private pin(tag: HTMLElement, at: Vector3): void {
    const p = this.tmp.copy(at).applyMatrix4(this.model.matrixWorld).project(this.camera);
    tag.style.left = `${(((p.x + 1) / 2) * this.canvas.clientWidth).toFixed(1)}px`;
    tag.style.top = `${(((1 - p.y) / 2) * this.canvas.clientHeight).toFixed(1)}px`;
  }

  private wiggle(): void {
    if (this.tweens.has('wiggle')) return;
    this.state.wiggle = 0;
    this.tween('wiggle', 1, 700, (t) => t);
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    this.raf = 0;
    let moving = false;
    for (const [key, t] of this.tweens) {
      const u = Math.min(1, (now - t.start) / t.ms);
      this.state[key] = t.from + (t.to - t.from) * t.ease(u);
      if (u >= 1) this.tweens.delete(key);
      else moving = true;
    }
    if (this.flagUp && now > this.nextWaggle && !this.tweens.has('wiggle')) {
      this.nextWaggle = now + 7000;
      this.state.wiggle = 0;
      this.tweens.set('wiggle', { from: 0, to: 1, start: now, ms: 900, ease: (t) => t });
      moving = true;
    }
    const s = this.state;
    this.door.rotation.x = s.door * 1.62;
    this.flag.rotation.x = (1 - s.flag) * (Math.PI / 2);
    this.cards.position.set(0, s.cards * 0.1, s.cards * 0.2);
    this.cards.visible = s.door > 0.05;
    const w = s.wiggle > 0 && s.wiggle < 1 ? Math.sin(s.wiggle * Math.PI * 4) * (1 - s.wiggle) : 0;
    this.model.rotation.z = w * 0.05;
    if (this.flagUp && s.flag > 0.99) this.flag.rotation.x = -w * 0.25;
    this.renderer?.render(this.scene, this.camera);
    // the count on the box's shoulder by its flag, the seal pressed on its door
    this.pin(this.count, COUNT_AT);
    this.pin(this.seal, SEAL_AT);
    if (moving || this.flagUp) {
      // while the flag is up, wake only for its waggle
      clearTimeout(this.wake);
      if (moving) this.kick();
      else this.wake = window.setTimeout(() => this.kick(), Math.max(50, this.nextWaggle - performance.now()));
    }
  }
}
