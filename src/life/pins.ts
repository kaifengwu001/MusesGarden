import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial, Vector3, type PerspectiveCamera } from 'three';
import museFace from '../assets/garden/muse-face.jpg';
import { smoothstep } from '../core/math';
import { warpPoint, type WarpFrame } from '../render/warp';

// Bubbles anchored on the globe, as on a map you keep: Muse's shows its photo,
// as the rail's portrait does, and each find you liked shows a heart. A round
// bubble with a cream rim stands upright on screen, its short tail pointing
// down to a dot on the place it marks. They show only from orbit, fade as the
// planet turns them round its back, keep a steady size on screen at any
// height, and pop up or down with a little bounce when they appear or when
// you come down from orbit.

export type PinKind = 'liked' | 'muse';

export interface PinSpec {
  readonly id: string;
  readonly kind: PinKind;
  /** Where it stands: a unit direction and the ground's height over R (m). */
  readonly dir: Vector3;
  readonly ground: number;
}

/** Pins show below this zoom (orbit and a little on the way down); a bubble is this wide on screen (a share of its height). */
const ORBIT_ZOOM = 0.22;
const SCREEN = 0.058;
/** Seconds to pop up or down; a pin's delay after the one before it. */
const POP = 0.42;
const STAGGER = 0.05;
/** How squarely the ground under a pin faces the camera (cosine) where its bubble has faded out, and where it is whole. */
const HORIZON = [0.03, 0.2] as const;

/** The bubble's drawing (px): the canvas, the bubble's centre and radius, its rim, the tail's tip, the anchor dot. */
const ART = { w: 256, h: 320, x: 128, y: 120, r: 100, rim: 11, tip: 262, dot: 288, dotR: 11 } as const;
const PAPER = '#fbf8ee';
/** The portrait's crop of the photo (garden.css .g-portrait: 132 % wide, centred, 38 % down). */
const PHOTO = { size: 1.32, x: 0.5, y: 0.38 } as const;
/** The garden's heart (icons.ts), on its 24 px grid. */
const HEART = 'M12 19.6s-7.4-4.4-7.4-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.4 2.3c0 5.3-7.4 9.7-7.4 9.7Z';

/** Paint a bubble: the rim, the tail and the anchor dot in paper with a soft shadow, then what shows inside the rim. */
function paint(canvas: HTMLCanvasElement, inside: (g: CanvasRenderingContext2D, r: number) => void): void {
  const g = canvas.getContext('2d')!;
  const { x, y, r } = ART;
  g.clearRect(0, 0, ART.w, ART.h);
  // one outline, all wound the same way: the round, the tail (in from its right shoulder to a rounded tip and
  // back up), the dot
  const s = 0.36 * r;
  const outline = new Path2D();
  outline.arc(x, y, r, 0, Math.PI * 2);
  outline.moveTo(x + s, y + r * 0.9);
  outline.quadraticCurveTo(x + s * 0.3, ART.tip - 22, x + 5, ART.tip - 3);
  outline.quadraticCurveTo(x, ART.tip + 2, x - 5, ART.tip - 3);
  outline.quadraticCurveTo(x - s * 0.3, ART.tip - 22, x - s, y + r * 0.9);
  outline.closePath();
  outline.moveTo(x + ART.dotR, ART.dot);
  outline.arc(x, ART.dot, ART.dotR, 0, Math.PI * 2);
  g.save();
  g.shadowColor = 'rgba(28, 60, 96, 0.4)';
  g.shadowBlur = 16;
  g.shadowOffsetY = 4;
  g.fillStyle = PAPER;
  g.fill(outline);
  g.restore();
  const inner = new Path2D();
  inner.arc(x, y, r - ART.rim, 0, Math.PI * 2);
  g.save();
  g.clip(inner);
  inside(g, r - ART.rim);
  g.restore();
  // a faint edge where the rim meets the picture, as on the portrait
  g.strokeStyle = 'rgba(62, 58, 54, 0.12)';
  g.lineWidth = 2;
  g.stroke(inner);
}

function look(inside: (g: CanvasRenderingContext2D, r: number) => void): { texture: CanvasTexture; repaint: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = ART.w;
  canvas.height = ART.h;
  paint(canvas, inside);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return {
    texture,
    repaint: () => {
      paint(canvas, inside);
      texture.needsUpdate = true;
    },
  };
}

/** Muse's photo, cropped as the portrait crops it, on paper until it loads. */
function museLook(): CanvasTexture {
  const photo = new Image();
  const { texture, repaint } = look((g, r) => {
    g.fillStyle = PAPER;
    g.fillRect(ART.x - r, ART.y - r, 2 * r, 2 * r);
    if (!photo.complete || photo.naturalWidth === 0) return;
    const d = 2 * r;
    const size = PHOTO.size * d;
    g.drawImage(photo, ART.x - r + (d - size) * PHOTO.x, ART.y - r + (d - size) * PHOTO.y, size, size);
  });
  photo.onload = repaint;
  photo.src = museFace;
  return texture;
}

/** A pink heart on blush paper, lit softly from the upper left. */
function likedLook(): CanvasTexture {
  return look((g, r) => {
    const paper = g.createRadialGradient(ART.x - r * 0.35, ART.y - r * 0.4, r * 0.1, ART.x, ART.y, r * 1.05);
    paper.addColorStop(0, '#fff3ef');
    paper.addColorStop(1, '#f6dcda');
    g.fillStyle = paper;
    g.fillRect(ART.x - r, ART.y - r, 2 * r, 2 * r);
    const k = (1.42 * r) / 24;
    g.translate(ART.x - 12 * k, ART.y - 13.4 * k);
    g.scale(k, k);
    const pink = g.createLinearGradient(6, 7, 17, 20);
    pink.addColorStop(0, '#f799b4');
    pink.addColorStop(0.55, '#ec6b91');
    pink.addColorStop(1, '#d9557c');
    g.fillStyle = pink;
    g.fill(new Path2D(HEART));
  }).texture;
}

interface Pin {
  spec: PinSpec;
  sprite: Sprite;
  shown: number;
  target: number;
  delay: number;
}

const p = new Vector3();
const toCamera = new Vector3();

export class Pins {
  readonly group = new Group();
  private readonly pins = new Map<string, Pin>();
  private readonly looks: Record<PinKind, CanvasTexture>;
  private visible = false;

  constructor() {
    this.looks = { muse: museLook(), liked: likedLook() };
    this.group.visible = false;
  }

  /** The pins to stand (all of them, each time the set changes). */
  set(specs: readonly PinSpec[]): void {
    const keep = new Set(specs.map((s) => s.id));
    for (const [id, pin] of this.pins) {
      if (!keep.has(id)) {
        this.group.remove(pin.sprite);
        pin.sprite.material.dispose();
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
      // over everything from orbit (clouds, Muse, the cottage); round the back of the planet only by fading
      const sprite = new Sprite(new SpriteMaterial({ map: this.looks[spec.kind], transparent: true, depthTest: false, depthWrite: false, fog: false }));
      sprite.center.set(0.5, 1 - ART.dot / ART.h);
      sprite.renderOrder = 10;
      sprite.visible = false;
      this.group.add(sprite);
      // (one that arrives while the pins show pops up too)
      this.pins.set(spec.id, { spec, sprite, shown: 0, target: this.visible ? 1 : 0, delay: STAGGER * k++ });
    }
  }

  /** Move a pin that walks about (Muse's) to where it is now: its direction and its ground's height (m). */
  move(id: string, dir: Vector3, ground: number): void {
    const pin = this.pins.get(id);
    if (pin && !(pin.spec.ground === ground && pin.spec.dir.equals(dir))) pin.spec = { ...pin.spec, dir: dir.clone(), ground };
  }

  /** Each frame: show from orbit when on, fade those turning round the back, keep their size on screen. */
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
      const { sprite, spec } = pin;
      warpPoint(warp, p.copy(spec.dir).multiplyScalar(radius + spec.ground), p);
      const fade = smoothstep(HORIZON[0], HORIZON[1], toCamera.subVectors(camera.position, p).normalize().dot(spec.dir));
      sprite.visible = pop > 0.001 && fade > 0.001;
      if (!sprite.visible) continue;
      any = true;
      sprite.material.opacity = fade;
      const width = p.distanceTo(camera.position) * halfHeight * 2 * SCREEN * pop * (ART.w / (2 * ART.r));
      sprite.position.copy(p);
      sprite.scale.set(width, (width * ART.h) / ART.w, 1);
    }
    this.group.visible = any;
  }

  /** The pin whose bubble is under a screen point (px from the top left of a viewport w × h), if any. */
  pick(x: number, y: number, w: number, h: number, camera: PerspectiveCamera): PinSpec | null {
    let best: PinSpec | null = null;
    let bestD = Infinity;
    const v = new Vector3();
    const halfHeight = Math.tan((camera.fov * Math.PI) / 360);
    for (const { sprite, spec } of this.pins.values()) {
      if (!sprite.visible || sprite.material.opacity < 0.5) continue;
      v.copy(sprite.position).project(camera);
      if (v.z > 1) continue;
      // the bubble stands over its anchor on screen
      const height = (sprite.scale.y / (2 * halfHeight * sprite.position.distanceTo(camera.position))) * h;
      const r = (height * ART.r) / ART.h;
      const d = Math.hypot(((v.x + 1) / 2) * w - x, ((1 - v.y) / 2) * h - ((ART.dot - ART.y) / ART.h) * height - y);
      if (d < Math.max(1.15 * r, 14) && d < bestD) {
        bestD = d;
        best = spec;
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
