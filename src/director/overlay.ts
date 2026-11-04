import { Vector3, type PerspectiveCamera } from 'three';
import { tangentToward, travel } from '../planet/geo';
import { warpNormal, warpPoint, type WarpFrame } from '../render/warp';

// The director's marks over the planet (director.ts): for each Muse, where it starts and each beat's mark (a disc
// and the way it faces), the routes between them, the set pieces' footprints, and a tag over each Muse; on the mark
// picked, a gumball to move it: its middle slides it over the ground, its two arrows push it along the way it faces
// or across, its ring turns it. Drawn as an SVG over the canvas, each point carried through the planet's warp to the
// screen as the frame draws it, so the marks sit on the ground you see; nothing of it is drawn into the frame.

/** A mark to draw: a place, the way it faces, its label, its colour; whether it is picked and dimmed. */
export interface OverlayMark {
  readonly key: string;
  readonly dir: Vector3;
  readonly facing: Vector3;
  readonly label: string;
  readonly colour: string;
  readonly kind: 'start' | 'beat' | 'bench' | 'stove';
  readonly picked: boolean;
  readonly dim: boolean;
}

export interface OverlayRoute {
  readonly key: string;
  readonly points: readonly Vector3[];
  readonly colour: string;
  readonly blocked: boolean;
  readonly dim: boolean;
}

export interface OverlayActor {
  readonly key: string;
  /** Its feet (planet space, m). */
  readonly feet: Vector3;
  readonly up: Vector3;
  readonly name: string;
  readonly colour: string;
  readonly picked: boolean;
}

export interface OverlayScene {
  readonly marks: readonly OverlayMark[];
  readonly routes: readonly OverlayRoute[];
  readonly actors: readonly OverlayActor[];
  /** The mark the gumball stands on, if any. */
  readonly gumball: string | null;
}

/** What the overlay reads of the world each frame. */
export interface OverlayView {
  readonly camera: PerspectiveCamera;
  readonly warp: WarpFrame;
  readonly R: number;
  /** The ground's height over R at a place (m). */
  ground(dir: Vector3): number;
  /** The place on the planet under a point of the screen (normalised device coordinates), if any. */
  pick(ndcX: number, ndcY: number): Vector3 | null;
}

export interface OverlayHandlers {
  /** A mark, piece or Muse was clicked. */
  select(key: string): void;
  /** The gumball moved its mark (done: the drag is over). */
  move(key: string, dir: Vector3, facing: Vector3, done: boolean): void;
}

const SVG = 'http://www.w3.org/2000/svg';
/** The gumball's reach on the ground (m): its arrows' and its ring's. */
const ARROW = 1.15;
const RING = 0.85;
/** Points closer than this to the planet's rim, seen from the camera, are not drawn (they'd be on its far side). */
const RIM = -0.02;

type Drag =
  | { mode: 'slide'; key: string; facing: Vector3 }
  | { mode: 'axis'; key: string; axis: Vector3; dir: Vector3; facing: Vector3; x0: number; y0: number; sx: number; sy: number; perM: number }
  | { mode: 'ring'; key: string; dir: Vector3 };

export class Overlay {
  readonly svg: SVGSVGElement;
  private readonly layers: Record<'routes' | 'marks' | 'actors' | 'gumball', SVGGElement>;
  private readonly pool = new Map<string, SVGElement>();
  private readonly used = new Set<string>();
  private scene: OverlayScene = { marks: [], routes: [], actors: [], gumball: null };
  private drag: Drag | null = null;
  private shown = true;
  private width = 1;
  private height = 1;
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  private readonly n = new Vector3();
  private readonly t = new Vector3();

  constructor(
    parent: HTMLElement,
    private readonly view: OverlayView,
    private readonly handlers: OverlayHandlers,
  ) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('director-overlay');
    this.layers = {
      routes: this.group('routes'),
      marks: this.group('marks'),
      actors: this.group('actors'),
      gumball: this.group('gumball'),
    };
    parent.append(this.svg);
    this.svg.addEventListener('pointermove', (e) => this.onMove(e));
    this.svg.addEventListener('pointerup', (e) => this.onUp(e));
    this.svg.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  /** Whether a gumball drag is under way. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  set visible(on: boolean) {
    this.shown = on;
    this.svg.style.display = on ? '' : 'none';
  }

  get visible(): boolean {
    return this.shown;
  }

  private group(name: string): SVGGElement {
    const g = document.createElementNS(SVG, 'g');
    g.dataset.layer = name;
    this.svg.append(g);
    return g;
  }

  /** What to draw from now on. */
  set(scene: OverlayScene): void {
    this.scene = scene;
  }

  // ---- drawing ----------------------------------------------------------------------------------------

  /** A planet-space point on the screen (px), or null where it isn't seen (behind the camera, round the planet's far side). */
  private screen(planet: Vector3, out: { x: number; y: number }): boolean {
    const { camera, warp } = this.view;
    const w = warpPoint(warp, planet, this.q);
    // (round the far side of the planet as the frame bends it: the ground's up there turned away from the camera)
    warpNormal(warp, planet, this.n.copy(planet).normalize(), this.n);
    const toCamera = this.t.subVectors(camera.position, w);
    const d = toCamera.length();
    if (d > 1e-6 && this.n.dot(toCamera) / d < RIM) return false;
    w.project(camera);
    if (w.z < -1 || w.z > 1) return false;
    out.x = (w.x * 0.5 + 0.5) * this.width;
    out.y = (-w.y * 0.5 + 0.5) * this.height;
    return true;
  }

  /** A point on the ground at a place, lifted a little (m). */
  private onGround(dir: Vector3, lift: number, out: Vector3): Vector3 {
    return out.copy(dir).multiplyScalar(this.view.R + this.view.ground(dir) + lift);
  }

  private el<K extends keyof SVGElementTagNameMap>(key: string, tag: K, layer: SVGGElement, setup?: (e: SVGElementTagNameMap[K]) => void): SVGElementTagNameMap[K] {
    let e = this.pool.get(key) as SVGElementTagNameMap[K] | undefined;
    if (!e || e.tagName !== tag) {
      e?.remove();
      e = document.createElementNS(SVG, tag);
      setup?.(e);
      this.pool.set(key, e);
      layer.append(e);
    }
    this.used.add(key);
    return e;
  }

  /** Draw it all where the frame has the planet now (after the world's update). */
  draw(width: number, height: number): void {
    if (!this.shown) return;
    this.width = width;
    this.height = height;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.view.camera.updateMatrixWorld();
    this.used.clear();
    const s = { x: 0, y: 0 };
    const s2 = { x: 0, y: 0 };
    // the routes
    for (const r of this.scene.routes) {
      const pts: string[] = [];
      const runs: string[] = [];
      for (let i = 0; i < r.points.length; i += 2) {
        if (this.screen(this.onGround(r.points[i], 0.04, this.p), s)) pts.push(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
        else if (pts.length) runs.push(pts.splice(0).join(' '));
      }
      if (pts.length) runs.push(pts.join(' '));
      runs.forEach((run, k) => {
        const line = this.el(`route:${r.key}:${k}`, 'polyline', this.layers.routes, (e) => e.classList.add('d-route'));
        line.setAttribute('points', run);
        line.style.stroke = r.blocked ? '#d63a2f' : r.colour;
        line.classList.toggle('is-blocked', r.blocked);
        line.classList.toggle('is-dim', r.dim);
      });
    }
    // the marks: a disc on the ground with its number, an arrow the way it faces
    for (const m of this.scene.marks) {
      if (!this.screen(this.onGround(m.dir, 0.03, this.p), s)) continue;
      const g = this.el(`mark:${m.key}`, 'g', this.layers.marks, (e) => {
        e.classList.add('d-mark');
        e.dataset.key = m.key;
        e.append(document.createElementNS(SVG, 'path'), document.createElementNS(SVG, 'polygon'), document.createElementNS(SVG, 'circle'), document.createElementNS(SVG, 'text'));
        e.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          this.handlers.select(e.dataset.key ?? '');
          // (a press held on a picked mark slides it at once)
          if (this.scene.gumball === e.dataset.key) this.startSlide(ev, e);
        });
      });
      g.dataset.key = m.key;
      g.classList.toggle('is-picked', m.picked);
      g.classList.toggle('is-dim', m.dim);
      g.classList.toggle('is-piece', m.kind === 'bench' || m.kind === 'stove');
      g.classList.toggle('is-start', m.kind === 'start');
      g.style.color = m.colour;
      const [outline, arrow, disc, text] = g.children as unknown as [SVGPathElement, SVGPolygonElement, SVGCircleElement, SVGTextElement];
      // its footprint on the ground (a bench's, a stove's) or a ring round where it stands
      outline.setAttribute('d', this.footprint(m));
      const tip = travel(m.dir, m.facing, (m.kind === 'bench' || m.kind === 'stove' ? 0.75 : 0.62) / this.view.R, this.q.clone());
      if (this.screen(this.onGround(tip, 0.03, this.p), s2)) {
        const ax = s2.x - s.x;
        const ay = s2.y - s.y;
        const l = Math.hypot(ax, ay) || 1;
        const ux = ax / l;
        const uy = ay / l;
        const w = 5;
        arrow.setAttribute('points', `${s2.x + ux * 4},${s2.y + uy * 4} ${s2.x - ux * 6 - uy * w},${s2.y - uy * 6 + ux * w} ${s2.x - ux * 6 + uy * w},${s2.y - uy * 6 - ux * w}`);
        arrow.style.display = '';
      } else arrow.style.display = 'none';
      disc.setAttribute('cx', s.x.toFixed(1));
      disc.setAttribute('cy', s.y.toFixed(1));
      disc.setAttribute('r', m.kind === 'start' ? '7' : '9');
      text.setAttribute('x', s.x.toFixed(1));
      text.setAttribute('y', (s.y + 3.5).toFixed(1));
      text.textContent = m.label;
    }
    // a tag over each Muse, to pick it by
    for (const a of this.scene.actors) {
      const head = this.p.copy(a.feet).addScaledVector(a.up, 1.95);
      if (!this.screen(head, s)) continue;
      const g = this.el(`actor:${a.key}`, 'g', this.layers.actors, (e) => {
        e.classList.add('d-tag');
        e.dataset.key = a.key;
        e.append(document.createElementNS(SVG, 'rect'), document.createElementNS(SVG, 'text'));
        e.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          this.handlers.select(e.dataset.key ?? '');
        });
      });
      g.dataset.key = a.key;
      g.classList.toggle('is-picked', a.picked);
      const [rect, text] = g.children as unknown as [SVGRectElement, SVGTextElement];
      text.textContent = a.name;
      const w = 10 + 6.6 * a.name.length;
      rect.setAttribute('x', (s.x - w / 2).toFixed(1));
      rect.setAttribute('y', (s.y - 18).toFixed(1));
      rect.setAttribute('width', w.toFixed(1));
      rect.setAttribute('height', '18');
      rect.style.fill = a.colour;
      text.setAttribute('x', s.x.toFixed(1));
      text.setAttribute('y', (s.y - 5).toFixed(1));
    }
    this.drawGumball();
    for (const [key, e] of this.pool) {
      if (this.used.has(key)) continue;
      e.remove();
      this.pool.delete(key);
    }
  }

  /** A footprint on the ground, as an SVG path: a bench's or a stove's box, or a ring of half a metre. */
  private footprint(m: OverlayMark): string {
    const R = this.view.R;
    const left = this.t.crossVectors(m.dir, m.facing).normalize().clone();
    const s = { x: 0, y: 0 };
    const corner = (a: number, b: number): string | null => {
      const p = travel(travel(m.dir, m.facing, b / R, this.q.clone()), left, a / R, this.q.clone());
      return this.screen(this.onGround(p, 0.03, this.p), s) ? `${s.x.toFixed(1)},${s.y.toFixed(1)}` : null;
    };
    let pts: (string | null)[];
    if (m.kind === 'bench') pts = [corner(-0.74, -0.19), corner(0.74, -0.19), corner(0.74, 0.19), corner(-0.74, 0.19)];
    else if (m.kind === 'stove') pts = [corner(-0.27, -0.23), corner(0.27, -0.23), corner(0.27, 0.23), corner(-0.27, 0.23)];
    else {
      pts = [];
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        pts.push(corner(0.35 * Math.cos(a), 0.35 * Math.sin(a)));
      }
    }
    if (pts.some((p) => p === null)) return '';
    return `M${pts.join(' L')} Z`;
  }

  /** The gumball on its mark: its middle, its two arrows, its ring. */
  private drawGumball(): void {
    const key = this.scene.gumball;
    const m = key ? this.scene.marks.find((x) => x.key === key) : undefined;
    if (!m) return;
    const R = this.view.R;
    const s = { x: 0, y: 0 };
    const e = { x: 0, y: 0 };
    if (!this.screen(this.onGround(m.dir, 0.03, this.p), s)) return;
    const right = new Vector3().crossVectors(m.facing, m.dir).normalize();
    // the ring (turn), its knob where it faces
    const ring: string[] = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const way = this.q.copy(m.facing).multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
      const p = travel(m.dir, way, RING / R, new Vector3());
      if (this.screen(this.onGround(p, 0.03, this.p), e)) ring.push(`${e.x.toFixed(1)},${e.y.toFixed(1)}`);
    }
    const ringEl = this.el('gumball:ring', 'polyline', this.layers.gumball, (el) => {
      el.classList.add('d-ring');
      el.addEventListener('pointerdown', (ev) => this.startRing(ev, el));
    });
    ringEl.setAttribute('points', ring.join(' '));
    const knob = travel(m.dir, m.facing, RING / R, new Vector3());
    const knobEl = this.el('gumball:knob', 'circle', this.layers.gumball, (el) => {
      el.classList.add('d-knob');
      el.addEventListener('pointerdown', (ev) => this.startRing(ev, el));
    });
    if (this.screen(this.onGround(knob, 0.03, this.p), e)) {
      knobEl.setAttribute('cx', e.x.toFixed(1));
      knobEl.setAttribute('cy', e.y.toFixed(1));
      knobEl.setAttribute('r', '7');
    }
    // the two arrows: along the way it faces, and across to its right
    for (const [name, axis] of [
      ['forward', m.facing],
      ['across', right],
    ] as const) {
      const tip = travel(m.dir, axis, ARROW / R, new Vector3());
      if (!this.screen(this.onGround(tip, 0.03, this.p), e)) continue;
      const g = this.el(`gumball:${name}`, 'g', this.layers.gumball, (el) => {
        el.classList.add('d-axis', `d-axis-${name}`);
        el.append(document.createElementNS(SVG, 'line'), document.createElementNS(SVG, 'polygon'));
        el.addEventListener('pointerdown', (ev) => this.startAxis(ev, el, name));
      });
      const [line, head] = g.children as unknown as [SVGLineElement, SVGPolygonElement];
      const ax = e.x - s.x;
      const ay = e.y - s.y;
      const l = Math.hypot(ax, ay) || 1;
      const ux = ax / l;
      const uy = ay / l;
      line.setAttribute('x1', (s.x + ux * 12).toFixed(1));
      line.setAttribute('y1', (s.y + uy * 12).toFixed(1));
      line.setAttribute('x2', e.x.toFixed(1));
      line.setAttribute('y2', e.y.toFixed(1));
      head.setAttribute('points', `${e.x + ux * 11},${e.y + uy * 11} ${e.x - uy * 6},${e.y + ux * 6} ${e.x + uy * 6},${e.y - ux * 6}`);
    }
    // its middle: slides it over the ground
    const middle = this.el('gumball:middle', 'circle', this.layers.gumball, (el) => {
      el.classList.add('d-middle');
      el.addEventListener('pointerdown', (ev) => this.startSlide(ev, el));
    });
    middle.setAttribute('cx', s.x.toFixed(1));
    middle.setAttribute('cy', s.y.toFixed(1));
    middle.setAttribute('r', '12');
  }

  // ---- dragging ---------------------------------------------------------------------------------------

  private picked(): OverlayMark | null {
    const key = this.scene.gumball;
    return (key && this.scene.marks.find((x) => x.key === key)) || null;
  }

  private capture(ev: PointerEvent, el: Element): void {
    ev.stopPropagation();
    ev.preventDefault();
    try {
      (el as SVGElement).setPointerCapture(ev.pointerId);
    } catch {
      // (a pointer that has gone already)
    }
  }

  private startSlide(ev: PointerEvent, el: Element): void {
    const m = this.picked();
    if (!m) return;
    this.capture(ev, el);
    this.drag = { mode: 'slide', key: m.key, facing: m.facing.clone() };
  }

  private startRing(ev: PointerEvent, el: Element): void {
    const m = this.picked();
    if (!m) return;
    this.capture(ev, el);
    this.drag = { mode: 'ring', key: m.key, dir: m.dir.clone() };
  }

  private startAxis(ev: PointerEvent, el: Element, name: 'forward' | 'across'): void {
    const m = this.picked();
    if (!m) return;
    this.capture(ev, el);
    const axis = name === 'forward' ? m.facing.clone() : new Vector3().crossVectors(m.facing, m.dir).normalize();
    // (how far a metre along the axis goes on the screen, and which way)
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    this.screen(this.onGround(m.dir, 0.03, this.p), a);
    this.screen(this.onGround(travel(m.dir, axis, 1 / this.view.R, new Vector3()), 0.03, this.p), b);
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const perM = Math.max(Math.hypot(sx, sy), 1e-3);
    const r = this.svg.getBoundingClientRect();
    this.drag = { mode: 'axis', key: m.key, axis, dir: m.dir.clone(), facing: m.facing.clone(), x0: ev.clientX - r.left, y0: ev.clientY - r.top, sx: sx / perM, sy: sy / perM, perM };
  }

  private ground(ev: PointerEvent): Vector3 | null {
    const r = this.svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1;
    const y = 1 - ((ev.clientY - r.top) / Math.max(r.height, 1)) * 2;
    return this.view.pick(x, y);
  }

  private onMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.apply(d, ev, false);
  }

  private onUp(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.apply(d, ev, true);
  }

  private apply(d: Drag, ev: PointerEvent, done: boolean): void {
    const m = this.scene.marks.find((x) => x.key === d.key);
    if (!m) return;
    if (d.mode === 'slide') {
      const g = this.ground(ev);
      if (!g) return;
      // (the way it faces carried along with it)
      this.handlers.move(d.key, g, tangentToward(g, g.clone().add(d.facing), new Vector3()), done);
    } else if (d.mode === 'ring') {
      const g = this.ground(ev);
      if (!g || g.distanceTo(d.dir) * this.view.R < 0.05) return;
      this.handlers.move(d.key, d.dir, tangentToward(d.dir, g, new Vector3()), done);
    } else {
      const r = this.svg.getBoundingClientRect();
      const along = ((ev.clientX - r.left - d.x0) * d.sx + (ev.clientY - r.top - d.y0) * d.sy) / d.perM;
      const dir = travel(d.dir, d.axis, along / this.view.R, new Vector3());
      this.handlers.move(d.key, dir, tangentToward(dir, dir.clone().add(d.facing), new Vector3()), done);
    }
  }

  dispose(): void {
    this.svg.remove();
  }
}
