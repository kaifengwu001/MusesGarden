import { PerspectiveCamera, Vector3 } from 'three';
import { smoothstep } from '../../../../src/core/math';
import type { Bed } from '../../garden/placement';
import type { Flight, Framing } from '../../../../src/view/flight';
import { el } from '../../../../src/ui/garden/dom';

// Opening a basket. It flies from where you picked it to the middle of the
// screen and opens; its finds rise out of it as small pictures and wait
// while the camera flies to where they were found (high enough to see them
// all); then each arcs down to its place on screen, following the view as
// it moves, and lands there, and its bed grows (a basket opened before only
// lights its finds up again). The basket fades last. Plain DOM over the
// canvas, placed each frame from the time since it began.

/** One find coming home. */
export interface Arrival {
  readonly id: string;
  readonly bed: Bed;
  readonly image?: string;
  /** Its interest's colour (the ring where it lands). */
  readonly colour: string;
}

export interface BasketFlightHost {
  /** A spot on the planet on screen (px from the top left), or null when it is behind the camera. */
  project(dir: Vector3, height: number): { x: number; y: number } | null;
  /** Seconds until the camera is where it is flying (0 once there, or once you took it over). */
  cameraRemaining(): number;
  /** Grow these finds' beds now. */
  plant(ids: readonly string[]): void;
  /** Light these finds up once (they have just come home). */
  pulse(ids: readonly string[]): void;
}

/** Seconds: the basket's flight to the middle, its lid opening, a find rising out and arcing down (and the gaps between finds), the basket's fade, a landing's ring. */
const T = { fly: 0.62, open: 0.32, out: 0.5, outGap: 0.09, arc: 1.05, arcGap: 0.15, fade: 0.55, ring: 1.1 } as const;
/** The finds leave the basket this long before the camera arrives (s). */
const LEAD = 0.45;
/** The basket's size (px), where the finds wait over it (px from its middle), and the height a find lands at (m). */
const BASKET = { width: 156, height: 120, mouth: -12, fan: 128, over: -70 } as const;
/** A screen narrower than this (px) shows the basket and its fan smaller, clear of the rail. */
const ROOMY = 560;
const LANDS_AT = 0.3;
/** Finds close together are seen from a little farther back than a find is, looking at the ground between them (m: off, up, looked-at height). */
const NEAR = { distance: 9.5, height: 3.6, aim: 0 } as const;
/** The view's angle from straight down (rad) a few times higher than NEAR, and from far up. */
const LOOK = { mid: 0.7, high: 0.2 } as const;
/** Where the finds must land on screen (normalized device coordinates): clear of its edges, the rail and the top line. */
const SCREEN = { x: 0.74, bottom: -0.68, top: 0.6 } as const;

interface Flyer {
  readonly arrival: Arrival;
  readonly el: HTMLElement;
  /** Where it waits, from the basket's middle (px), and when it rises out (s from the start). */
  readonly rest: { readonly x: number; readonly y: number };
  readonly out: number;
  /** When it leaves for its place (s; NaN until the camera is near), where it was then, and its place on screen. */
  leave: number;
  from: { x: number; y: number } | null;
  to: { x: number; y: number } | null;
  landed: boolean;
}

interface Opening {
  readonly fresh: boolean;
  readonly layer: HTMLElement;
  readonly back: HTMLElement;
  readonly front: HTMLElement;
  /** Where the basket set off from (px) and its size there. */
  readonly from: { readonly x: number; readonly y: number; readonly scale: number };
  readonly flyers: Flyer[];
  /** Seconds since it began. */
  t: number;
  /** When the last find landed (s; NaN until then). */
  allLanded: number;
}

const ease = (t: number): number => smoothstep(0, 1, t);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** A point `u` of the way along a quadratic Bézier from a through c to b (one coordinate). */
const quad = (a: number, c: number, b: number, u: number): number => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;
/** 0 → 1 with a little overshoot. */
const outBack = (t: number): number => {
  const u = t - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
};

const BACK_SVG = `<svg viewBox="0 0 156 120" aria-hidden="true">
  <path d="M33 47C33 12 123 12 123 47" fill="none" stroke="#9a6a3c" stroke-width="8" stroke-linecap="round"/>
  <path d="M33 47C33 12 123 12 123 47" fill="none" stroke="#d8a868" stroke-width="4" stroke-linecap="round" stroke-dasharray="5 4"/>
  <ellipse cx="78" cy="48" rx="68" ry="12" fill="#6e4a2a"/>
</svg>`;

const FRONT_SVG = `<svg viewBox="0 0 156 120" aria-hidden="true">
  <defs><linearGradient id="g-fly-wicker" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3b878"/><stop offset="1" stop-color="#c38c52"/></linearGradient></defs>
  <path d="M10 48a68 12 0 0 0 136 0l-12 56a10 10 0 0 1-9.8 8H31.8a10 10 0 0 1-9.8-8Z" fill="url(#g-fly-wicker)" stroke="rgba(92,60,30,.45)" stroke-width="1.4"/>
  <path d="M15 66q63 12 126 0M18 82q60 11 120 0M21 98q57 10 114 0" fill="none" stroke="#a8743f" stroke-width="2.2" stroke-linecap="round" opacity=".75"/>
  <path d="M40 60v46M59 63v47M78 64v48M97 63v47M116 60v46" fill="none" stroke="#f2cf98" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
  <path d="M10 48a68 12 0 0 0 136 0" fill="none" stroke="#a86f3a" stroke-width="7" stroke-linecap="round"/>
  <path d="M10 48a68 12 0 0 0 136 0" fill="none" stroke="#e6bf84" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 5"/>
</svg>`;

export class BasketFlight {
  private opening: Opening | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: BasketFlightHost,
  ) {}

  get active(): boolean {
    return this.opening !== null;
  }

  /** A find of a basket being opened for the first time, not landed yet: its bed stays unplanted. */
  waiting(id: string): boolean {
    return this.opening?.fresh === true && this.opening.flyers.some((f) => !f.landed && f.arrival.id === id);
  }

  /** Open a basket: `from` is where you picked it (the basket comes from there); `fresh` plants its finds as they land. */
  start(arrivals: readonly Arrival[], from: DOMRect, fresh: boolean): void {
    this.finish();
    if (arrivals.length === 0) return;
    if (reducedMotion()) {
      if (fresh) this.host.plant(arrivals.map((a) => a.id));
      this.host.pulse(arrivals.map((a) => a.id));
      return;
    }
    const layer = el('div', 'g-fly');
    layer.setAttribute('aria-hidden', 'true');
    const back = el('div', 'g-fly-basket');
    back.innerHTML = BACK_SVG;
    back.append(el('i', 'g-fly-lid is-left'), el('i', 'g-fly-lid is-right'));
    const front = el('div', 'g-fly-basket is-front');
    front.innerHTML = FRONT_SVG;
    layer.append(back);
    const n = arrivals.length;
    const step = Math.min(0.6, 2.4 / Math.max(1, n - 1));
    const flyers = arrivals.map((arrival, k): Flyer => {
      const thumb = el('div', 'g-fly-find');
      if (arrival.image) thumb.style.backgroundImage = `url("${arrival.image}")`;
      const dot = el('i');
      dot.style.background = arrival.colour;
      thumb.append(dot);
      layer.append(thumb);
      const a = (k - (n - 1) / 2) * step;
      return {
        arrival,
        el: thumb,
        rest: { x: Math.sin(a) * BASKET.fan, y: BASKET.over - Math.cos(a) * BASKET.fan * 0.42 },
        out: T.fly + 0.5 * T.open + k * T.outGap,
        leave: Number.NaN,
        from: null,
        to: null,
        landed: false,
      };
    });
    layer.append(front);
    this.root.append(layer);
    this.opening = {
      fresh,
      layer,
      back,
      front,
      from: { x: from.x + from.width / 2, y: from.y + from.height / 2, scale: Math.min(0.7, Math.max(0.22, from.height / BASKET.height)) },
      flyers,
      t: 0,
      allLanded: Number.NaN,
    };
    this.update(0);
  }

  /** Each frame, after the camera has moved. */
  update(dt: number): void {
    const o = this.opening;
    if (!o) return;
    o.t += dt;
    const t = o.t;
    const middle = { x: window.innerWidth / 2, y: window.innerHeight * 0.52 };

    // the basket: an arc from where it was picked to the middle, its lid opening there, and at last a fade
    const u = ease(clamp01(t / T.fly));
    const lift = Math.min(160, 0.35 * Math.hypot(middle.x - o.from.x, middle.y - o.from.y));
    const bx = quad(o.from.x, (o.from.x + middle.x) / 2, middle.x, u);
    const by = quad(o.from.y, (o.from.y + middle.y) / 2 - lift, middle.y, u);
    const gone = Number.isNaN(o.allLanded) ? 0 : ease(clamp01((t - o.allLanded) / T.fade));
    const size = Math.min(1, window.innerWidth / ROOMY);
    const scale = (o.from.scale + (size - o.from.scale) * outBack(clamp01(t / T.fly))) * (1 - 0.12 * gone);
    const basket = `translate3d(${bx - BASKET.width / 2}px, ${by - BASKET.height / 2 + 26 * gone}px, 0) scale(${scale})`;
    o.back.style.transform = o.front.style.transform = basket;
    o.back.style.opacity = o.front.style.opacity = String(Math.min(1, t / 0.12) * (1 - gone));
    o.back.style.setProperty('--open', String(ease(clamp01((t - T.fly + 0.08) / T.open))));

    // the finds leave once all are out and the camera is nearly there (or you took it over)
    const lastOut = o.flyers[o.flyers.length - 1].out + T.out;
    if (Number.isNaN(o.flyers[0].leave) && t >= lastOut && this.host.cameraRemaining() <= LEAD) {
      o.flyers.forEach((f, k) => (f.leave = t + k * T.arcGap));
    }
    o.flyers.forEach((f, k) => this.move(o, f, k, bx, by, scale));

    if (Number.isNaN(o.allLanded) && o.flyers.every((f) => f.landed)) o.allLanded = t;
    if (t >= o.allLanded + Math.max(T.fade, T.ring)) this.finish();
  }

  /** Land everything at once (another basket, a card, a flight elsewhere) and put the basket away. */
  finish(): void {
    const o = this.opening;
    if (!o) return;
    this.opening = null;
    const waiting = o.flyers.filter((f) => !f.landed).map((f) => f.arrival.id);
    if (o.fresh && waiting.length > 0) this.host.plant(waiting);
    this.host.pulse(o.flyers.map((f) => f.arrival.id));
    o.layer.remove();
  }

  private move(o: Opening, f: Flyer, k: number, bx: number, by: number, scale: number): void {
    if (f.landed) return;
    const t = o.t;
    const style = f.el.style;
    const a = (t - f.leave) / T.arc;
    if (!(a >= 0)) {
      // rising out of the basket's mouth to its place over it, then bobbing there
      const p = clamp01((t - f.out) / T.out);
      const r = outBack(p);
      const bob = p >= 1 ? Math.sin(2.4 * (t - f.out) + k * 1.3) * 3 : 0;
      const x = bx + scale * (f.rest.x * r);
      const y = by + scale * (BASKET.mouth + (f.rest.y - BASKET.mouth) * r + bob);
      f.from = { x, y };
      style.opacity = p > 0 ? '1' : '0';
      style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale * (0.45 + 0.55 * r)}) rotate(${(f.rest.x / BASKET.fan) * 8 * r}deg)`;
      return;
    }
    // the arc to its place as the view has it now, shrinking as it comes down
    const to = this.host.project(f.arrival.bed.dir, f.arrival.bed.ground + LANDS_AT) ?? f.to;
    f.to = to;
    const from = f.from ?? { x: bx, y: by };
    if (!to) {
      style.opacity = String(1 - clamp01(a));
      if (a >= 1) this.land(o, f, null);
      return;
    }
    const e = a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - 60 - 0.25 * Math.hypot(to.x - from.x, to.y - from.y);
    const x = quad(from.x, cx, to.x, e);
    const y = quad(from.y, cy, to.y, e);
    f.el.classList.add('is-leaving');
    // the last part of the way it sinks into the ground where it lands
    style.opacity = String(1 - smoothstep(0.82, 1, a));
    style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${1 - 0.6 * e * e})`;
    if (a >= 1) this.land(o, f, to);
  }

  private land(o: Opening, f: Flyer, at: { x: number; y: number } | null): void {
    f.landed = true;
    f.el.remove();
    if (at) {
      const ring = el('i', 'g-fly-ring');
      ring.style.left = `${at.x}px`;
      ring.style.top = `${at.y}px`;
      ring.style.setProperty('--ring', f.arrival.colour);
      o.layer.append(ring);
    }
    if (o.fresh) this.host.plant([f.arrival.id]);
  }
}

/**
 * The view a basket's flight ends on: over the middle of its finds, as low as still shows them all
 * well inside the screen (finds far apart: high above, looking down). The tiny-planet warp is left out
 * of the check: at the lowest of these views it moves a find a few centimeters.
 */
export function framingToFit(beds: readonly Bed[], flight: Flight, radius: number, ground: (dir: Vector3) => number): Framing {
  const middle = new Vector3();
  for (const bed of beds) middle.add(bed.dir);
  if (middle.lengthSq() < 1e-12) middle.copy(beds[0].dir);
  middle.normalize();
  const height = beds.reduce((sum, b) => sum + b.ground, 0) / beds.length;
  const camera = new PerspectiveCamera();
  const p = new Vector3();
  const fits = (f: Framing): boolean => {
    flight.camera(f, radius, ground, camera);
    return beds.every((bed) => {
      p.copy(bed.dir).multiplyScalar(radius + bed.ground + LANDS_AT);
      // on this side of the horizon, and inside the screen clear of its edges and the rail
      if (camera.position.dot(bed.dir) <= radius + bed.ground + LANDS_AT) return false;
      p.project(camera);
      return p.z > -1 && p.z < 1 && Math.abs(p.x) < SCREEN.x && p.y > SCREEN.bottom && p.y < SCREEN.top;
    });
  };
  let framing: Framing = { dir: middle, ground: height, ...NEAR };
  // from NEAR, up by steps, looking down more steeply (high over a small planet, nearly straight down), until all of them show
  const near = Math.atan2(NEAR.distance, NEAR.height);
  for (let s = 1; s < 160; s *= 1.15) {
    const up = NEAR.height * s;
    const look = near + (LOOK.mid - near) * smoothstep(1, 5, s) + (LOOK.high - LOOK.mid) * smoothstep(5, 30, s);
    framing = { dir: middle, ground: height, distance: up * Math.tan(look), height: up, aim: NEAR.aim };
    if (fits(framing)) break;
  }
  return framing;
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
