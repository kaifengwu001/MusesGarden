import {
  CanvasTexture,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type IUniform,
} from 'three';
import { JOINT } from './museBody';
import moteFragment from './museMotes.frag.glsl?raw';
import moteVertex from './museMotes.vert.glsl?raw';
import type { MuseRig } from './museRig';

// The icon over Muse's head as its moves set it (museRig.ts `emote`): a light bulb as an idea comes to it (lit with a
// glow, its rays flashing out round it), a heart as it adores you. It is drawn in step with the pose, over the head as
// posed, from a sheet of pictures of its own: on a planet as Muse's motes are (museMotes.*.glsl: squares facing the
// camera, warped with the planet; MuseEmotes, from each world's museProps.ts), in the lab as sprites (SpriteEmotes).
// It draws nothing at all unless one of those moves is playing.

/** The pictures, in a row and in the order they are drawn: the bulb's glow, its rays, the bulb unlit and lit, the heart. */
export const EMOTES = ['glow', 'rays', 'bulb', 'lit', 'heart'] as const;
const GLOW = 0;
const RAYS = 1;
const BULB = 2;
const LIT = 3;
const HEART = 4;
/** Each picture's size (H, across its square). */
const SIZE = [0.52, 0.5, 0.25, 0.25, 0.22] as const;
/**
 * Where the icon floats (H): its middle over the top of the head (in the head's frame), carried up along Muse's own up;
 * a muse whose top stands higher than tpose6's (1: a hat) has it carried up by as much more (MuseFit.crown).
 */
const CROWN = { y: 0.15, z: 0.03, over: 0.29, top: 1 } as const;

/** One picture of the sheet, painted into a square of a canvas (its left edge at x, size across). */
function paint(g: CanvasRenderingContext2D, picture: number, x: number, S: number): void {
  const cx = x + S / 2;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (picture === GLOW) {
    const f = g.createRadialGradient(cx, S / 2, 0, cx, S / 2, S / 2);
    f.addColorStop(0, 'rgba(255,240,170,0.95)');
    f.addColorStop(0.32, 'rgba(255,226,120,0.5)');
    f.addColorStop(0.62, 'rgba(255,214,96,0.16)');
    f.addColorStop(1, 'rgba(255,210,90,0)');
    g.fillStyle = f;
    g.fillRect(x, 0, S, S);
  } else if (picture === RAYS) {
    // short rays round the top of the bulb (none below, where its base is)
    const rays = (width: number, colour: string): void => {
      g.lineWidth = width;
      g.strokeStyle = colour;
      for (const deg of [-118, -78, -39, 0, 39, 78, 118]) {
        const a = (deg * Math.PI) / 180;
        const s = Math.sin(a);
        const c = Math.cos(a);
        g.beginPath();
        g.moveTo(cx + 0.33 * S * s, S * 0.52 - 0.33 * S * c);
        g.lineTo(cx + 0.45 * S * s, S * 0.52 - 0.45 * S * c);
        g.stroke();
      }
    };
    rays(S * 0.1, 'rgba(255,255,255,0.95)');
    rays(S * 0.05, '#ffc83a');
  } else if (picture === BULB || picture === LIT) {
    const lit = picture === LIT;
    // (the bulb fills its square: the glass round on top, narrowing into a neck, the screw base below it)
    const cy = 0.4 * S;
    const r = 0.27 * S;
    const glass = (): void => {
      g.beginPath();
      g.arc(cx, cy, r, Math.PI * 0.77, Math.PI * 0.23, false);
      g.quadraticCurveTo(cx + 0.13 * S, cy + r + 0.04 * S, cx + 0.115 * S, 0.76 * S);
      g.lineTo(cx - 0.115 * S, 0.76 * S);
      g.quadraticCurveTo(cx - 0.13 * S, cy + r + 0.04 * S, cx + r * Math.cos(Math.PI * 0.77), cy + r * Math.sin(Math.PI * 0.77));
      g.closePath();
    };
    const base = (): void => {
      g.beginPath();
      g.roundRect(cx - 0.12 * S, 0.74 * S, 0.24 * S, 0.13 * S, 0.035 * S);
      g.moveTo(cx - 0.05 * S, 0.87 * S);
      g.arc(cx, 0.87 * S, 0.05 * S, Math.PI, 0, true);
      g.closePath();
    };
    // the white outline round the whole of it
    g.lineWidth = S * 0.09;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    glass();
    g.stroke();
    base();
    g.stroke();
    // the glass: warm and bright lit, a pale cream unlit
    const f = g.createRadialGradient(cx - 0.08 * S, cy - 0.09 * S, 0.02 * S, cx, cy, r * 1.25);
    if (lit) {
      f.addColorStop(0, '#fffbe2');
      f.addColorStop(0.45, '#ffe46e');
      f.addColorStop(1, '#ffbf2e');
    } else {
      f.addColorStop(0, '#fbfaf4');
      f.addColorStop(0.6, '#ebe6d8');
      f.addColorStop(1, '#d9d2c0');
    }
    glass();
    g.fillStyle = f;
    g.fill();
    g.lineWidth = S * 0.022;
    g.strokeStyle = lit ? '#e2a521' : '#b9b19c';
    g.stroke();
    // the filament
    g.beginPath();
    g.moveTo(cx - 0.06 * S, 0.74 * S);
    g.lineTo(cx - 0.05 * S, cy + 0.05 * S);
    g.bezierCurveTo(cx - 0.05 * S, cy - 0.05 * S, cx + 0.05 * S, cy - 0.05 * S, cx + 0.05 * S, cy + 0.05 * S);
    g.lineTo(cx + 0.06 * S, 0.74 * S);
    g.lineWidth = S * 0.026;
    g.strokeStyle = lit ? '#f08a12' : '#a39b88';
    g.stroke();
    // a glint on the glass
    g.beginPath();
    g.arc(cx, cy, r * 0.68, Math.PI * 1.08, Math.PI * 1.38);
    g.lineWidth = S * 0.04;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
    // the screw base, its threads
    base();
    g.fillStyle = '#a9b1ba';
    g.fill();
    g.lineWidth = S * 0.018;
    g.strokeStyle = '#7f8892';
    g.stroke();
    g.beginPath();
    for (const y of [0.785, 0.825]) {
      g.moveTo(cx - 0.11 * S, y * S);
      g.lineTo(cx + 0.11 * S, y * S);
    }
    g.stroke();
  } else if (picture === HEART) {
    // a plump heart (the classic curve), the pink of the hearts when it is petted
    const heart = (): void => {
      g.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const hx = 16 * Math.sin(a) ** 3;
        const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
        const px = cx + hx * ((0.36 * S) / 16);
        const py = 0.47 * S - hy * ((0.36 * S) / 16);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
    };
    g.lineWidth = S * 0.09;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    heart();
    g.stroke();
    const f = g.createLinearGradient(0, 0.2 * S, 0, 0.88 * S);
    f.addColorStop(0, '#f8909f');
    f.addColorStop(1, '#ea5f86');
    g.fillStyle = f;
    g.fill();
    g.lineWidth = S * 0.02;
    g.strokeStyle = '#d6527a';
    g.stroke();
    g.beginPath();
    g.ellipse(cx - 0.17 * S, 0.34 * S, 0.06 * S, 0.035 * S, -0.7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fill();
  }
  g.restore();
}

/** The pictures on one canvas: all of them in a row (the planet's sheet), or only one (a sprite's). */
export function emoteCanvas(only = -1, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const count = only >= 0 ? 1 : EMOTES.length;
  canvas.width = size * count;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('museEmotes: no 2d canvas');
  if (only >= 0) paint(g, only, 0, size);
  else for (let k = 0; k < count; k++) paint(g, k, k * size, size);
  return canvas;
}

/** One picture of the icon as it is to be drawn: which, its middle (H, Muse's frame as posed), its size (H), how opaque, its turn (rad). */
export interface EmoteMark {
  picture: number;
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  spin: number;
}

const crown = new Vector3();
const headFrame = new Matrix4();

/** The icon's pictures this pose (into out, in the order to draw them; how many), none when no move shows one. */
export function emoteMarks(rig: MuseRig, out: EmoteMark[]): number {
  const em = rig.emote;
  if (em.bulb <= 0.004 && em.heart <= 0.004) return 0;
  rig.frameOf(JOINT.head, headFrame);
  crown.set(0, CROWN.y + Math.max(0, (rig.fit.crown ?? CROWN.top) - CROWN.top), CROWN.z).applyMatrix4(headFrame);
  const y = crown.y + CROWN.over + em.rise;
  let n = 0;
  const mark = (picture: number, size: number, alpha: number, spin: number): void => {
    if (alpha <= 0.004 || size <= 0.001) return;
    const m = (out[n] ??= { picture: 0, x: 0, y: 0, z: 0, size: 0, alpha: 0, spin: 0 });
    m.picture = picture;
    m.x = crown.x;
    m.y = y;
    m.z = crown.z;
    m.size = SIZE[picture] * size;
    m.alpha = Math.min(1, alpha);
    m.spin = spin;
    n++;
  };
  if (em.bulb > 0.004) {
    mark(GLOW, em.bulbSize * (0.8 + 0.25 * em.glow), 0.85 * em.glow * em.bulb, 0);
    mark(RAYS, em.bulbSize * em.raySize, em.rays * em.bulb, em.spin + em.rayTurn);
    mark(BULB, em.bulbSize, em.bulb * (1 - em.lit), em.spin);
    mark(LIT, em.bulbSize, em.bulb * em.lit, em.spin);
  }
  if (em.heart > 0.004) mark(HEART, em.heartSize, em.heart, em.spin);
  return n;
}

const p = new Vector3();

/** The icon on a planet: squares facing the camera, as Muse's motes (place: Muse's frame there, scaled by its height H). */
export class MuseEmotes {
  readonly mesh: Mesh;
  private readonly at: InstancedBufferAttribute;
  private readonly look: InstancedBufferAttribute;
  private readonly marks: EmoteMark[] = [];

  constructor(shared: Record<string, IUniform>) {
    const quad = new InstancedBufferGeometry().copy(new PlaneGeometry(1, 1) as unknown as InstancedBufferGeometry);
    this.at = new InstancedBufferAttribute(new Float32Array(EMOTES.length * 4), 4);
    this.look = new InstancedBufferAttribute(new Float32Array(EMOTES.length * 4), 4);
    quad.setAttribute('aMote', this.at);
    quad.setAttribute('aLook', this.look);
    quad.instanceCount = 0;
    const sheet = new CanvasTexture(emoteCanvas());
    sheet.colorSpace = 'srgb';
    this.mesh = new Mesh(
      quad,
      new ShaderMaterial({
        name: 'muse emotes',
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        uniforms: { ...shared, uMotes: { value: sheet }, uMoteCount: { value: EMOTES.length } },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** The icon for this pose, while Muse is drawn (shown). */
  update(rig: MuseRig, place: Matrix4, H: number, shown: boolean): void {
    const n = shown ? emoteMarks(rig, this.marks) : 0;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const m = this.marks[i];
      p.set(m.x, m.y, m.z).applyMatrix4(place);
      this.at.setXYZW(i, p.x, p.y, p.z, m.size * H);
      this.look.setXYZW(i, m.picture, m.alpha, m.spin, 0);
    }
    this.at.needsUpdate = true;
    this.look.needsUpdate = true;
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = n;
  }
}

/** The icon in the lab: a sprite per picture (place: Muse's frame in the scene, Muse one unit tall). */
export class SpriteEmotes {
  readonly group = new Group();
  private readonly sprites: Sprite[];
  private readonly marks: EmoteMark[] = [];

  constructor() {
    this.sprites = EMOTES.map((_, k) => {
      const map = new CanvasTexture(emoteCanvas(k));
      map.colorSpace = 'srgb';
      const s = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false }));
      s.renderOrder = 5;
      s.visible = false;
      this.group.add(s);
      return s;
    });
  }

  update(rig: MuseRig, place: Matrix4 | null = null): void {
    for (const s of this.sprites) s.visible = false;
    const n = emoteMarks(rig, this.marks);
    const scale = place ? Math.cbrt(Math.abs(place.determinant())) : 1;
    for (let i = 0; i < n; i++) {
      const m = this.marks[i];
      const s = this.sprites[m.picture];
      s.visible = true;
      s.position.set(m.x, m.y, m.z);
      if (place) s.position.applyMatrix4(place);
      s.scale.setScalar(m.size * scale);
      s.material.opacity = m.alpha;
      s.material.rotation = m.spin;
      // (drawn in the order of the marks: the glow, the rays, the bulb, the heart)
      s.renderOrder = 5 + i;
    }
  }
}
