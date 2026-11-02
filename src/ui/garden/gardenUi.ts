import { Matrix4, PerspectiveCamera, Quaternion, Vector3, Vector4 } from 'three';
import friendFace from '../../assets/garden/friend-face.jpg';
import museFace from '../../assets/garden/muse-face.jpg';
import basketImage from '../../assets/garden/orchard-basket-warm-brown.png';
import { smoothstep } from '../../core/math';
import { bedAt, layOut, type Bed, type GardenLayout } from '../../garden/placement';
import { placeholderSource, type PlaceholderSource } from '../../garden/placeholder';
import { gardenSource, type GardenSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import type { Basket, Postcard } from '../../garden/types';
import { FindBeds, heroStance, type BedLook } from '../../life/findBeds';
import { HEADS } from '../../life/flowers';
import { SPECIES_MESH } from '../../life/flowerMeshes';
import type { MuseDirection } from '../../life/muse';
import { Pins, type PinSpec } from '../../life/pins';
import type { ParamStore } from '../../params';
import { tangentToward, travel } from '../../planet/geo';
import { createGroundSample, type Layout } from '../../planet/terrain';
import { sunAt } from '../../render/palette';
import { localSun } from '../../render/sun';
import { warpPoint } from '../../render/warp';
import { Flight, type Framing } from '../../view/flight';
import type { World } from '../../world';
import { basketFan, FAN_MAX, freeRect, type Fan } from './basketFan';
import { basketStep, CLOSED, holdsPointer, type BasketEvent, type BasketState, type Effect, type Picked, type Target } from './basketMachine';
import { BasketOverlay, type DayEntry } from './basketOverlay';
import { BasketStage, type Landing, type Pose, type StageFlower } from './basketStage';
import { button, chipNote, dayName, el, reducedMotion } from './dom';
import { cardBody, FindCard } from './findCard';
import { paintFlower, worldLight, type Light, type Shape } from './flowerPaint';
import { framingToFit } from './framing';
import './garden.css';
import { ICONS } from './icons';
import { Mail } from './mail';
import { MuseSheet } from './musePage';
import { PostBox } from './postbox';
import { dayLabel } from './timeline';
import { Visit } from './travel';

// The garden's interface over the meadow: Muse's finds as patches of flowers
// with their cards, the pins on the globe, the post box with Muse's postcards and
// the tickets to other worlds, and a rail down the right: Muse
// (its page), find Muse, its cottage, the basket. The basket comes out of the
// rail with the day's finds as flowers in it (basketStage.ts, basketOverlay.ts,
// its phases in basketMachine.ts); a flower picked flies home into its patch.
// Everything it shows comes from a GardenSource (garden/source.ts) through
// GardenState. main.ts calls update() before the world moves its camera,
// frame() after, and offers it taps first.

/** How a find is framed: the camera's distance and height over the bed, and where it looks (m). */
const FIND_VIEW = { distance: 7.2, height: 3.1, aim: 1.15 } as const;
/** The line from a bed up to its card (m); higher than this (m) a card is put away. */
const STEM = 1.9;
const CARD_UNDER = 30;
/** The cottage's view and Muse's (as world.ts's named views): distance, height, bearing from the front (rad), looked-at point (cottage-local x, y, z, m). */
const HOME_VIEW = { distance: 26, height: 11, bearing: 0.92, at: [-1.8, 2.6, 1.4] } as const;
const MUSE_VIEW = { distance: 4.6, height: 1.35, bearing: 0.3, aim: 0.62 } as const;
const AT_HOME: MuseDirection = { kind: 'home', busy: false };
const OUT_OF_SIGHT: MuseDirection = { kind: 'hidden' };

/** A tap or the pointer this near a find's sphere (px) picks it; the sphere stands this high over its bed (m). */
const SPHERE = { slop: 16, height: 0.6 } as const;

const sample = createGroundSample();
const tmp = new Vector3();

/** The flower meshes' own attributes, as flowerPaint reads them. */
const SHAPES: readonly Shape[] = SPECIES_MESH.map((make) => {
  const g = make();
  const position = g.getAttribute('position').array;
  return { part: g.getAttribute('aPart').array, t: g.getAttribute('aT').array, y: Array.from({ length: position.length / 3 }, (_, i) => position[i * 3 + 1]) };
});

/** The finds' marks on the planet (their patches of flowers, and the glowing spheres seen from high up). */
export interface FindMarks {
  hover(id: string | null): void;
  open(id: string | null): void;
  pulse(ids: readonly string[]): void;
  /** How plainly the spheres show at the camera's height, 0..1. */
  spheresShown(): number;
  /** Whether the patches are drawn at the camera's height. */
  bedsShown(): boolean;
  /** The find under the pointer. */
  readonly hovered: string | null;
  /** The last basket sent home's finds, marked until another flower or basket is. */
  readonly selected: readonly string[];
  /** The find whose flower came home last, in focus until another does. */
  readonly focused: string | null;
}

/** 'Today’s basket', 'Tuesday’s basket', 'The basket of Tue 21 Oct'. */
export function basketName(day: string): string {
  const name = dayName(day);
  return /\d/.test(name) ? `The basket of ${name}` : `${name}’s basket`;
}

export class GardenUi {
  readonly state: GardenState;
  private readonly root: HTMLElement;
  private readonly beds: FindBeds;
  private readonly pins = new Pins();
  /** The finds' patches and spheres, once they are drawn. */
  marks: FindMarks | null = null;
  private readonly flight: Flight;
  private readonly card: FindCard;
  private readonly postbox: PostBox;
  private readonly mail: Mail;
  private readonly museSheet: MuseSheet;
  private readonly visit: Visit;
  private readonly rail: HTMLElement;
  private readonly portrait: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly basketsButton: HTMLButtonElement;
  private readonly sign: HTMLElement;
  private readonly basketDot: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  /** The basket: its phase (basketMachine.ts), its canvas, and what you touch over it. */
  private basket: BasketState = CLOSED;
  private readonly stage: BasketStage;
  private readonly overlay: BasketOverlay;
  private fan: Fan | null = null;
  /** Where a flight now will end, worked out once a frame (a send and its flight ask for the same one). */
  private planned: { key: string; framing: Framing | null } | null = null;
  private readonly foreseen = new PerspectiveCamera();
  private layout: GardenLayout = { beds: new Map() };
  private laidFor: { radius: number; layout: Layout | null } = { radius: 0, layout: null };
  private relayoutAt = 0;
  /** The find whose card is up (or rising), and the one being flown to. */
  private current: string | null = null;
  private offscreen = 0;
  /** Hover, with a pointer that can: where it is over the canvas (px; null when off it), whether it moved since the last pick, the view it was last picked in, and the find under it. */
  private pointer: { x: number; y: number; canvas: HTMLCanvasElement } | null = null;
  private pointerMoved = false;
  private readonly pickedIn = new Matrix4();
  private hovered: string | null = null;
  private readonly source: GardenSource;

  /**
   * `driveMuse`: the engine's say over the 3D Muse each frame (muse/ui/overlay.ts), when the page follows an engine;
   * without one Muse is at home or out of sight as the source's status says.
   */
  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly store: ParamStore,
    private readonly driveMuse: ((dt: number) => MuseDirection | null) | null = null,
  ) {
    this.source = gardenSource();
    this.state = new GardenState(this.source);
    this.root = el('div', 'garden');
    parent.append(this.root);
    document.body.classList.add('garden-on');
    this.beds = new FindBeds(world.shared);
    this.marks = this.beds;
    world.scene.add(...this.beds.objects, this.pins.group);
    this.flight = new Flight(world.rig);

    this.card = new FindCard(this.root, {
      like: () => this.like(),
      share: (id, shared) => this.state.shareFind(id, shared),
      step: (d) => this.step(d),
      close: () => this.closeCard(),
    });

    // the basket, over the card and under the rail
    this.overlay = new BasketOverlay(this.root, {
      hover: (target) => this.dispatch({ type: 'hover', target }),
      pick: (target, touch) => this.dispatch(target.kind === 'basket' ? { type: 'pickBasket', touch } : { type: 'pick', find: target.id, touch }),
      day: (basket) => this.dispatch({ type: 'day', basket }),
      dismiss: () => this.dispatch({ type: 'dismiss' }),
      label: (target) => this.targetLabel(target),
      preview: (target) => this.preview(target),
    });
    this.stage = new BasketStage(this.overlay.stage, {
      cameraRemaining: () => this.flight.remaining,
      basketHome: (home) => this.basketsButton.classList.toggle('is-away', !home),
    });

    // the rail
    this.rail = el('nav', 'g-rail');
    this.rail.setAttribute('aria-label', 'Garden');
    this.portrait = button('g-portrait', 'Muse', '', () => this.openSheet(() => this.museSheet.open()));
    this.portrait.dataset.label = 'Muse';
    this.portrait.style.backgroundImage = `url(${museFace})`;
    this.status = el('span', 'g-status');
    this.portrait.append(this.status);
    const find = button('g-railbtn', 'Find Muse', ICONS.find, () => this.findMuse());
    find.dataset.label = 'Find Muse';
    this.homeButton = button('g-railbtn', 'Muse’s cottage', ICONS.house, () => this.goHome());
    this.homeButton.dataset.label = 'Muse’s cottage';
    this.sign = el('span', 'g-sign', 'out');
    this.homeButton.append(this.sign);
    this.basketsButton = button('g-railbtn g-basketbtn', 'Baskets', '', () => this.railBasket());
    this.basketsButton.dataset.label = 'Baskets';
    const basketIcon = el('img', 'g-basket-icon');
    basketIcon.src = basketImage;
    basketIcon.alt = '';
    basketIcon.draggable = false;
    this.basketDot = el('span', 'g-dot');
    this.basketsButton.append(basketIcon, this.basketDot);
    this.rail.append(this.portrait, find, this.homeButton, this.basketsButton);
    this.root.append(this.rail);

    // the post box
    this.postbox = new PostBox(this.root, () => this.openSheet(() => void this.mail.open()));
    this.visit = new Visit(this.root, world, store, {
      leaving: () => {
        this.closeCard();
        this.dispatch({ type: 'sheet' });
      },
      changed: (away) => {
        this.root.classList.toggle('is-away', away);
        document.body.classList.toggle('g-away', away);
      },
    });
    this.mail = new Mail(this.root, this.state, this.postbox, {
      travel: (id) => this.board(id),
    });
    this.museSheet = new MuseSheet(this.root, this.state, { muse: museFace, friend: friendFace });

    this.toastEl = el('div', 'g-toast');
    this.toastEl.setAttribute('role', 'status');
    this.root.append(this.toastEl);

    this.state.subscribe((change) => this.changed(change));
    this.state.start().catch((error: unknown) => {
      console.error('garden: could not load', error);
      this.toast('The garden could not be reached just now.');
    });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('resize', () => this.refan());
    if (matchMedia('(hover: hover)').matches) {
      window.addEventListener('pointermove', (e) => this.pointerAt(e), { passive: true });
      window.addEventListener('pointerout', (e) => {
        if (!e.relatedTarget) this.pointerAt(null);
      });
    }
    if (import.meta.env.DEV || import.meta.env.VITE_PROBE) this.installProbe();
  }

  // ---- state → interface -----------------------------------------------------------

  private changed(change: string): void {
    const s = this.state;
    if (change === 'snapshot') this.applyWorld();
    if (change === 'snapshot' || change === 'baskets') this.relayout(true);
    if (change === 'snapshot' || change === 'likes' || change === 'status') this.refreshPins();
    const unread = s.unread.length;
    this.postbox.setMail(unread, s.invitations.filter((p) => !s.isRead(p.id)).length, s.today.length);
    this.basketDot.classList.toggle('is-on', s.freshBasket !== undefined);
    const home = s.status.home;
    this.portrait.classList.toggle('is-out', !home);
    this.status.replaceChildren(el('i'), chipNote(s.statusNote, s.snapshot?.friends.map((f) => f.name) ?? []));
    this.sign.classList.toggle('is-on', !home);
    this.homeButton.title = home ? 'Muse’s cottage' : 'Muse’s cottage: Muse is out';
    if (change === 'snapshot' && s.freshBasket) {
      const fresh = s.freshBasket;
      setTimeout(() => this.toast(`Muse brought you a basket${fresh.title ? `: ${fresh.title}` : ''}`, 'Go and see', () => this.dispatch({ type: 'show', basket: fresh.id })), 1800);
    }
    if (change === 'postcards' || change === 'snapshot') this.mail.refresh();
    if ((change === 'baskets' || change === 'visited' || change === 'snapshot') && holdsPointer(this.basket.phase)) this.showDays();
    if (change === 'interests' || change === 'snapshot' || change === 'status' || change === 'friends') this.museSheet.render();
  }

  /** Muse's own planet, when the source names one: the finds were found on it. */
  private applyWorld(): void {
    const world = this.state.snapshot?.world;
    if (!world) return;
    this.store.set('world.seed', world.seed);
    this.store.set('world.growth', world.g);
  }

  /** Lay the finds out on the planet again (a new basket, or a planet that grew): every patch stands grown. */
  private relayout(force = false): void {
    const w = this.world;
    const radius = w.growth.radius;
    if (!force && radius === this.laidFor.radius && w.terrain.layout === this.laidFor.layout) return;
    const s = this.state.snapshot;
    if (!s) return;
    this.laidFor = { radius, layout: w.terrain.layout };
    this.layout = layOut(w.terrain, s.baskets, s.finds);
    const looks: BedLook[] = [];
    for (const basket of this.state.baskets) {
      for (const id of basket.finds) {
        const bed = this.layout.beds.get(id);
        const find = this.state.find(id);
        if (!bed || !find) continue;
        const interest = this.state.interest(find.topic);
        looks.push({ bed, species: interest?.species ?? 0, variant: interest?.variant ?? 0.5 });
      }
    }
    this.beds.set(looks, radius);
    this.refreshPins();
  }

  private refreshPins(): void {
    const specs: PinSpec[] = [];
    for (const id of this.state.likedFindIds) {
      const bed = this.layout.beds.get(id);
      if (bed) specs.push({ id: `liked:${id}`, kind: 'liked', dir: bed.dir, ground: bed.ground });
    }
    const muse = this.musePlace();
    specs.push({ id: 'muse', kind: 'muse', dir: muse.dir, ground: muse.ground });
    this.pins.set(specs);
  }

  // ---- each frame ------------------------------------------------------------------------

  /** Before the world moves: a flight drives the camera, and Muse is told where to be. */
  update(dt: number): void {
    this.flight.update(dt);
    const muse = this.visit.away ? OUT_OF_SIGHT : this.driveMuse ? this.driveMuse(dt) : this.state.status.home ? AT_HOME : OUT_OF_SIGHT;
    if (muse) this.world.muse.direct(muse);
  }

  /** After the world's update: the beds' clock, the pins, the card over its bed, the basket. */
  frame(dt: number): void {
    const w = this.world;
    const now = performance.now();
    this.planned = null;
    if (now > this.relayoutAt && (w.growth.radius !== this.laidFor.radius || w.terrain.layout !== this.laidFor.layout)) {
      // (while the planet grows, at most twice a second)
      this.relayoutAt = now + 500;
      this.relayout();
    }
    const away = this.visit.away;
    // (picked when the pointer moved, or the view moved under it: a flight, a zoom still gliding)
    if (this.pointer && (this.pointerMoved || !w.rig.camera.matrixWorld.equals(this.pickedIn))) this.hover(this.pointer);
    // the basket first: a flower that lands this frame hands over to its patch before the patches' state goes up
    this.stage.frame(dt);
    if (holdsPointer(this.basket.phase)) this.overlay.place(this.stage.layout(), this.fan?.more ?? 0, this.basket.preview);
    this.beds.update(w.rig.altitude, !away);
    this.pins.update(dt, !away, w.rig.zoom, w.rig.camera, w.warp, w.growth.radius);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const bed = this.current ? this.layout.beds.get(this.current) : undefined;
    if (bed) {
      const foot = this.project(bed.dir, bed.ground + 0.35, width, height);
      const top = this.project(bed.dir, bed.ground + STEM, width, height);
      const inView = foot !== null && foot.x > -40 && foot.x < width + 40 && foot.y > -40 && foot.y < height + 40;
      const shown = inView && (w.rig.altitude < CARD_UNDER || this.flight.flying);
      this.card.place(shown ? foot : null, shown ? top : null, dt, width, height);
      // a bed left out of view for a moment, or left far below, closes its card
      const near = w.rig.altitude < CARD_UNDER;
      this.offscreen = (inView && near) || this.flight.flying ? 0 : this.offscreen + dt;
      if (this.offscreen > 0.6 && this.card.shown) this.closeCard();
    } else this.card.place(null, null, dt, width, height);
  }

  private project(dir: Vector3, height: number, width: number, h: number): { x: number; y: number } | null {
    const w = this.world;
    tmp.copy(dir).multiplyScalar(w.growth.radius + height);
    warpPoint(w.warp, tmp, tmp);
    tmp.project(w.rig.camera);
    if (tmp.z < -1 || tmp.z > 1) return null;
    return { x: ((tmp.x + 1) / 2) * width, y: ((1 - tmp.y) / 2) * h };
  }

  // ---- input ----------------------------------------------------------------------------

  /** A tap on the canvas: a pin, or a find (its sphere from high up, its bed below). True when the garden took it. */
  tap(x: number, y: number, width: number, height: number): boolean {
    const pin = this.pins.pick(x, y, width, height, this.world.rig.camera);
    const bed = pin ? null : this.findAt(x, y, width, height);
    if (!pin && !bed) return false;
    // a flower still on its way home lands now: what you tapped takes over, as a sheet would
    this.dispatch({ type: 'sheet' });
    if (pin?.kind === 'muse') this.findMuse();
    else if (pin) this.openFind(pin.id.slice('liked:'.length));
    else if (bed) this.openFind(bed.find);
    return true;
  }

  /** The find under a point on the canvas (px): its sphere when the spheres show, else the bed the surface pick lands in. */
  private findAt(x: number, y: number, width: number, height: number): Bed | null {
    const w = this.world;
    if (this.visit.away) return null;
    if ((this.marks?.spheresShown() ?? 0) > 0.5) {
      const R = w.growth.radius;
      let best: Bed | null = null;
      let bestD: number = SPHERE.slop;
      for (const bed of this.layout.beds.values()) {
        // only what is drawn: on this side of the horizon
        if (w.rig.camera.position.dot(bed.dir) <= R + bed.ground + SPHERE.height) continue;
        const p = this.project(bed.dir, bed.ground + SPHERE.height, width, height);
        const d = p ? Math.hypot(p.x - x, p.y - y) : Infinity;
        if (d < bestD) {
          bestD = d;
          best = bed;
        }
      }
      return best;
    }
    const hit = w.pick((x / width) * 2 - 1, 1 - (y / height) * 2);
    return hit ? bedAt(this.layout, hit.dir, w.growth.radius) : null;
  }

  /** The pointer moved (null: it left the window). Picked at the next frame, so at most once a frame. */
  private pointerAt(e: PointerEvent | null): void {
    const canvas = e && e.pointerType !== 'touch' && e.buttons === 0 && e.target instanceof HTMLCanvasElement ? e.target : null;
    if (e && canvas) {
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, canvas };
      this.pointerMoved = true;
      return;
    }
    if (this.pointer) this.pointer.canvas.style.cursor = '';
    this.pointer = null;
    this.setHovered(null);
  }

  private hover(at: { x: number; y: number; canvas: HTMLCanvasElement }): void {
    this.pointerMoved = false;
    this.pickedIn.copy(this.world.rig.camera.matrixWorld);
    const { clientWidth: width, clientHeight: height } = at.canvas;
    const pin = this.pins.pick(at.x, at.y, width, height, this.world.rig.camera);
    const bed = pin ? null : this.findAt(at.x, at.y, width, height);
    const shown = bed ? bed.find : null;
    this.setHovered(shown);
    at.canvas.style.cursor = pin || shown ? 'pointer' : '';
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.marks?.hover(id);
  }

  /** You took the camera (a drag, the wheel, a key): any flight ends there, and flowers on their way land where their patches are now. */
  interrupt(): void {
    this.flight.cancel();
    this.dispatch({ type: 'camera' });
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
    if (holdsPointer(this.basket.phase)) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.dispatch({ type: 'dismiss' });
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // the days, not the camera
        e.preventDefault();
        e.stopImmediatePropagation();
        this.overlay.step(e.key === 'ArrowRight' ? 1 : -1);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (this.mail.isOpen) this.mail.back();
      else if (this.card.shown) this.closeCard();
    } else if (this.card.shown && !this.mail.isOpen && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.step(e.key === 'ArrowRight' ? 1 : -1);
    }
  }

  // ---- finds ------------------------------------------------------------------------------

  private framing(bed: Bed, view: { distance: number; height: number; aim: number }, from?: Vector3): Framing {
    return { dir: bed.dir, ground: bed.ground, ...view, from };
  }

  private ground = (dir: Vector3): number => this.world.terrain.sample(dir, sample).height;

  /** Fly to a find's bed and raise its card. */
  openFind(id: string, direction: 1 | -1 | 0 = 0): void {
    const bed = this.layout.beds.get(id);
    const find = this.state.find(id);
    if (!bed || !find) return;
    if (this.card.shown) this.card.hide(direction);
    this.marks?.open(null);
    this.current = id;
    // look from the side the camera comes from, unless it is right over the bed
    this.flight.to(this.framing(bed, FIND_VIEW), this.world.growth.radius, this.ground, () => this.raise(id));
  }

  private raise(id: string): void {
    const find = this.state.find(id);
    const basket = find && this.state.basket(find.basket);
    if (!find || !basket || this.current !== id) return;
    const index = basket.finds.indexOf(id);
    this.card.show(find, this.state.interest(find.topic), {
      basket: basketName(basket.day),
      index,
      total: basket.finds.length,
      liked: this.state.liked(id),
      shared: this.state.findShared(id),
    });
    this.marks?.open(id);
  }

  private step(direction: 1 | -1): void {
    const order = this.state.browseOrder;
    if (!this.current || order.length === 0) return;
    const i = order.indexOf(this.current);
    const next = order[(i + direction + order.length) % order.length];
    this.openFind(next, direction);
  }

  private like(): void {
    if (!this.current) return;
    const liked = this.state.toggleLike(this.current);
    this.card.setLiked(liked);
    if (liked && this.state.likedFindIds.length === 1) this.toast('Liked. Muse will hear of it, and it’s pinned on your map.');
  }

  private closeCard(): void {
    this.card.hide(0);
    this.marks?.open(null);
    this.current = null;
  }

  // ---- the basket ------------------------------------------------------------------------

  /** The rail's basket: out on the freshest basket not opened yet (else the newest), or back in. */
  private railBasket(): void {
    const basket = this.state.freshBasket ?? this.state.baskets[0];
    if (!basket && this.basket.phase.kind === 'closed') {
      this.toast('No basket yet: Muse brings one home after a day out.');
      return;
    }
    this.dispatch({ type: 'rail', basket: basket?.id ?? '' });
  }

  /** The post or Muse's page opens: the basket goes back first. */
  private openSheet(open: () => void): void {
    this.dispatch({ type: 'sheet' });
    open();
  }

  private dispatch(event: BasketEvent): void {
    const was = this.basket.phase;
    const step = basketStep(this.basket, event, reducedMotion());
    this.basket = step.state;
    for (const effect of step.effects) this.carry(effect);
    const out = holdsPointer(step.state.phase);
    if (step.state.phase !== was) this.overlay.sync(out);
    this.stage.hover(out ? step.state.preview : null);
  }

  private carry(effect: Effect): void {
    switch (effect.type) {
      case 'open':
        this.openBasket(effect.basket, effect.animate);
        break;
      case 'swap':
        this.swapBasket(effect.basket, effect.animate);
        break;
      case 'close':
        this.stage.close(this.railRect(), effect.animate, () => this.dispatch({ type: 'done', phase: 'closing' }));
        break;
      case 'send':
        this.sendFind(effect.find, effect.animate);
        break;
      case 'sendAll':
        this.sendBasket(effect.basket, effect.animate);
        break;
      case 'fly': {
        const framing = this.framingFor(effect.to);
        if (framing) this.flight.to(framing, this.world.growth.radius, this.ground);
        break;
      }
      case 'cancelFlight':
        this.flight.cancel();
        break;
      case 'settle':
        this.stage.settle();
        break;
      case 'highlight':
        this.highlight(effect.picked);
        break;
      case 'card':
        this.current = effect.find;
        this.raise(effect.find);
        break;
      case 'visit':
        this.state.visit(effect.basket);
        break;
    }
  }

  private openBasket(id: string, animate: boolean): void {
    this.closeCard();
    const basket = this.state.basket(id);
    const fan = this.refan(basket);
    if (!basket || !fan) return;
    this.overlay.show(this.dayEntries(), id, fan);
    this.stage.open(this.flowersOf(basket, FAN_MAX), this.railRect(), fan, animate, () => this.dispatch({ type: 'done', phase: 'opening' }));
  }

  private swapBasket(id: string, animate: boolean): void {
    const basket = this.state.basket(id);
    const fan = this.refan(basket);
    if (!basket || !fan) return;
    this.overlay.show(this.dayEntries(), id, fan);
    this.stage.swap(this.flowersOf(basket, FAN_MAX), fan, animate, () => this.dispatch({ type: 'done', phase: 'swapping' }));
  }

  private sendFind(id: string, animate: boolean): void {
    this.closeCard();
    const done = (): void => this.dispatch({ type: 'done', phase: 'sending' });
    const landing = this.landing(id, this.framingFor({ find: id }));
    if (!landing) {
      this.stage.close(this.railRect(), animate, done);
      return;
    }
    this.beds.away(id, true);
    this.stage.sendOne(landing, this.railRect(), animate, (f) => this.landed(f, true), done);
  }

  private sendBasket(id: string, animate: boolean): void {
    this.closeCard();
    const basket = this.state.basket(id);
    const framing = this.framingFor({ basket: id });
    const landings = (basket?.finds ?? []).flatMap((f) => this.landing(f, framing) ?? []);
    for (const l of landings) this.beds.away(l.id, true);
    const flowers = basket ? this.flowersOf(basket) : [];
    this.stage.sendAll(flowers, landings, this.railRect(), animate, (f) => this.landed(f, false), () => this.dispatch({ type: 'done', phase: 'sendingAll' }));
  }

  /** A flower touched down in its patch: in this frame the patch takes over (its hero back, a sway through it, a pulse; in focus if picked alone). */
  private landed(id: string, focus: boolean): void {
    this.beds.away(id, false);
    this.beds.land(id);
    this.beds.pulse([id]);
    if (focus) this.beds.focus(id);
  }

  /** Light what came home (a flower: its hero in focus; a basket: its patches marked), and stop lighting what came before. */
  private highlight(picked: Picked): void {
    if ('find' in picked) {
      this.beds.select([]);
      this.beds.focus(picked.find);
    } else {
      this.beds.focus(null);
      this.beds.select(this.state.basket(picked.basket)?.finds ?? []);
    }
  }

  /** The camera's goal for a pick: a find framed as its card would be, or a basket's finds all in view. */
  private framingFor(to: Picked): Framing | null {
    const key = 'find' in to ? `find:${to.find}` : `basket:${to.basket}`;
    if (this.planned?.key === key) return this.planned.framing;
    let framing: Framing | null = null;
    if ('find' in to) {
      const bed = this.layout.beds.get(to.find);
      if (bed) framing = this.framing(bed, FIND_VIEW);
    } else {
      const beds = (this.state.basket(to.basket)?.finds ?? []).flatMap((f) => this.layout.beds.get(f) ?? []);
      if (beds.length > 0) framing = framingToFit(beds, this.flight, this.world.growth.radius, this.ground);
    }
    this.planned = { key, framing };
    return framing;
  }

  private railRect(): DOMRect {
    return this.basketsButton.getBoundingClientRect();
  }

  /** The fan for the basket out (or `basket`), on this screen and clear of the rail; the stage and timeline follow it. */
  private refan(basket?: Basket): Fan | null {
    const phase = this.basket.phase;
    const out = basket ?? ('basket' in phase ? this.state.basket(phase.basket) : undefined);
    if (!out) return null;
    const screen = { width: window.innerWidth, height: window.innerHeight };
    const fan = basketFan(out.finds.length, screen, freeRect(screen, this.rail.getBoundingClientRect()));
    this.fan = fan;
    if (!basket && holdsPointer(phase)) {
      this.stage.refan(fan);
      this.overlay.show(this.dayEntries(), out.id, fan);
    }
    return fan;
  }

  private showDays(): void {
    const phase = this.basket.phase;
    if ('basket' in phase && this.fan) this.overlay.show(this.dayEntries(), phase.basket, this.fan);
  }

  private dayEntries(): DayEntry[] {
    return this.state.baskets.map((b) => ({ id: b.id, day: b.day, title: b.title, fresh: !this.state.visitedBasket(b.id) }));
  }

  /**
   * The camera a flight to `framing` ends with, and the light a hero is seen in from there: the world's, with the haze
   * that view will have (world.ts updateLook: its density by the view's tilt, the clear air below its height).
   */
  private viewFrom(framing: Framing): { camera: PerspectiveCamera; light: Light } {
    const w = this.world;
    const R = w.growth.radius;
    const camera = this.flight.camera(framing, R, this.ground, this.foreseen);
    const pose = this.flight.pose(framing, R, this.ground);
    const tilt = smoothstep(0.3, 1, w.rig.zoomForAltitude(pose.altitude));
    const style = this.store.values.style;
    const light = worldLight(w.palette, w.look, { contrast: style.contrast, brightness: style.brightness });
    const fog = new Vector4(style.fogDensity * 0.0028 * (1 + 10 * tilt), 0.06 + 0.34 * style.fogDensity, pose.altitude * 0.95, 0.8);
    const up = pose.focus.clone().normalize();
    // and the sun as that view's focus sees it (world.ts updateLight)
    const sun = sunAt(this.store.values.light.timeOfDay);
    const sunDir = localSun(up, sun.elevation, sun.azimuth, new Vector3());
    return { camera, light: { ...light, fog, fogUp: up, sunDir } };
  }

  /** A basket's finds as flowers (the first `limit`), each painted as its patch paints its hero seen from its card's view. */
  private flowersOf(basket: Basket, limit = Infinity): StageFlower[] {
    return basket.finds.slice(0, limit).flatMap((id): StageFlower[] => {
      const hero = this.beds.hero(id);
      const bed = this.layout.beds.get(id);
      if (!hero || !bed) return [];
      const colours = this.heroColours(id, this.viewFrom(this.framing(bed, FIND_VIEW)));
      return colours ? [{ id, species: hero.species, colours, size: hero.size }] : [];
    });
  }

  /** A hero's colours as a view sees them (flowerPaint.ts). */
  private heroColours(id: string, view: { camera: PerspectiveCamera; light: Light }): Float32Array | null {
    const hero = this.beds.hero(id);
    const state = this.beds.heroState(id);
    if (!hero || !state) return null;
    const stance = heroStance(hero, this.world.growth.radius, state);
    return paintFlower(
      SHAPES[hero.species],
      { species: hero.species, variant: hero.variant, dir: hero.dir, foot: stance.foot, camera: view.camera.position, stemTop: HEADS[hero.species][0], mark: state.mark, open: state.open, lit: Math.max(state.lift, state.focus) },
      view.light,
    );
  }

  /** Where a find's flower comes home: its hero as the flight's end will show it (its colours too), and as the frame shows it now. */
  private landing(id: string, framing: Framing | null): Landing | null {
    const bed = this.layout.beds.get(id);
    if (!this.beds.hero(id) || !bed) return null;
    const view = this.viewFrom(framing ?? this.framing(bed, FIND_VIEW));
    const colours = this.heroColours(id, view);
    if (!colours) return null;
    const end = framing ? this.heroPose(id, view.camera, false) : null;
    return { id, colours, end, live: () => this.heroPose(id, this.world.rig.camera, true) };
  }

  /** A hero's pose on the screen through a camera (`warped`: through the tiny-planet warp the frame is drawn with); null when out of view. */
  private heroPose(id: string, camera: PerspectiveCamera, warped: boolean): Pose | null {
    const hero = this.beds.hero(id);
    const state = this.beds.heroState(id);
    if (!hero || !state) return null;
    const st = heroStance(hero, this.world.growth.radius, state);
    const foot = warped ? warpPoint(this.world.warp, st.foot.clone(), new Vector3()) : st.foot.clone();
    // past the horizon
    if (tmp.copy(camera.position).sub(foot).dot(st.up) <= 0) return null;
    const view = foot.clone().applyMatrix4(camera.matrixWorldInverse);
    const depth = -view.z;
    if (depth <= camera.near) return null;
    const ndc = foot.clone().project(camera);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const focal = height / 2 / Math.tan((camera.getEffectiveFOV() * Math.PI) / 360);
    const turn = new Matrix4().extractRotation(camera.matrixWorldInverse).multiply(new Matrix4().makeBasis(st.side, st.up, st.forward));
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, z: 0, q: new Quaternion().setFromRotationMatrix(turn), s: (focal / depth) * st.scale, a: 1 };
  }

  private targetLabel(target: Target): string {
    if (target.kind === 'basket') return 'Send them all home';
    const find = this.state.find(target.id);
    const m = find?.media;
    return m ? `${m.title ?? m.text?.slice(0, 60) ?? m.source}, from ${m.author ?? m.source}` : 'A find';
  }

  /** What shows over a flower (its find's card, light) or over the basket (its day, and what a tap does). */
  private preview(target: Target): HTMLElement | null {
    if (target.kind === 'find') {
      const find = this.state.find(target.id);
      return find ? cardBody(find, this.state.interest(find.topic)) : null;
    }
    const phase = this.basket.phase;
    const basket = 'basket' in phase ? this.state.basket(phase.basket) : undefined;
    if (!basket) return null;
    const box = el('div', 'g-peek-basket');
    const n = basket.finds.length;
    box.append(el('p', 'g-peek-day', dayLabel(basket.day, basket.title)), el('p', 'g-peek-do', `Send ${n === 1 ? 'it' : `all ${n}`} home, each to where Muse found it`));
    return box;
  }

  // ---- Muse ---------------------------------------------------------------------------------

  /** Where Muse is: on its terrace (where its day has it) when home; out, where the source says, or by the newest find. */
  private musePlace(): { dir: Vector3; ground: number; home: boolean } {
    const w = this.world;
    const status = this.state.status;
    if (!status.home) {
      if (status.where) {
        const dir = new Vector3(...status.where).normalize();
        return { dir, ground: this.ground(dir), home: false };
      }
      const newest = this.state.baskets[0]?.finds[0];
      const bed = newest ? this.layout.beds.get(newest) : undefined;
      if (bed) return { dir: bed.dir.clone(), ground: bed.ground, home: false };
    }
    // at home: wherever its life has it about the hut (world.muse.where, kept current even while it isn't drawn)
    return { dir: w.muse.where.dir.clone(), ground: w.muse.where.height, home: true };
  }

  /** Cottage-local meters (x along the front, z out toward the pond) as a planet direction. */
  private cottageLocal(x: number, z: number): Vector3 {
    const L = this.world.terrain.layout;
    const R = this.world.growth.radius;
    const t = new Vector3().crossVectors(L.cottage, L.homeBearing).normalize();
    const d = Math.hypot(x, z);
    if (d > 1e-5) t.multiplyScalar(x / d).addScaledVector(L.homeBearing, z / d).normalize();
    return travel(L.cottage, t, d / R, new Vector3());
  }

  private fromFront(bearing: number): Vector3 {
    const L = this.world.terrain.layout;
    return L.homeBearing.clone().applyAxisAngle(L.cottage, bearing);
  }

  findMuse(): void {
    this.closeCard();
    const place = this.musePlace();
    const R = this.world.growth.radius;
    if (place.home) {
      // out in front of the terrace, a little toward the steps (as the named view)
      const from = tangentToward(place.dir, this.fromFront(MUSE_VIEW.bearing).add(place.dir), new Vector3());
      this.flight.to({ dir: place.dir, ground: place.ground, distance: MUSE_VIEW.distance, height: MUSE_VIEW.height, aim: MUSE_VIEW.aim, from }, R, this.ground);
    } else {
      this.toast(this.state.statusNote);
      this.flight.to({ dir: place.dir, ground: place.ground, distance: 22, height: 26, aim: 0 }, R, this.ground);
    }
  }

  goHome(): void {
    this.closeCard();
    const R = this.world.growth.radius;
    const at = this.cottageLocal(HOME_VIEW.at[0], HOME_VIEW.at[2]);
    const from = tangentToward(at, this.fromFront(HOME_VIEW.bearing).add(at), new Vector3());
    const ground = this.world.terrain.cottageGround;
    this.flight.to({ dir: at, ground, distance: HOME_VIEW.distance, height: HOME_VIEW.height, aim: HOME_VIEW.at[1], from }, R, this.ground, () => {
      if (!this.state.status.home) this.toast('Muse is out, and the door is shut. It’ll be back with a basket.');
    });
  }

  private setHome(home: boolean): void {
    // (a stand-in for the backend's status, for the probe: see what the garden does when Muse is out)
    const source = this.source as Partial<PlaceholderSource>;
    const status = home ? { home: true, note: 'At home' } : { home: false, note: 'Out exploring' };
    if (source.push) source.push({ type: 'status', status });
    else this.state.receive({ type: 'status', status });
  }

  // ---- travel ----------------------------------------------------------------------------------

  private board(invitationId: string): void {
    const card = this.state.postcards.find((p) => p.id === invitationId);
    if (!card?.invitation) return;
    this.mail.close();
    this.state.useInvitation(invitationId);
    void this.visit.start(card.invitation);
  }

  // ---- toasts ----------------------------------------------------------------------------------

  /** A line at the top for a moment, with an action if given. */
  toast(text: string, action?: string, onAction?: () => void): void {
    this.toastEl.replaceChildren(el('span', '', text));
    if (action && onAction) {
      this.toastEl.append(
        button('', action, '', () => {
          this.toastEl.classList.remove('is-on');
          onAction();
        }),
      );
      (this.toastEl.lastChild as HTMLButtonElement).textContent = action;
    }
    this.toastEl.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-on'), action ? 7000 : 3800);
  }

  // ---- the dev harness ----------------------------------------------------------------------------

  private installProbe(): void {
    (window as unknown as { __garden: unknown }).__garden = {
      state: this.state,
      ui: this,
      layout: () => this.layout,
      beds: this.beds,
      stage: this.stage,
      open: (id: string) => this.openFind(id),
      /** The basket out on a day (by default the freshest not opened, else the newest), as the toast's "Go and see" does. */
      basket: (id?: string) => this.dispatch({ type: 'show', basket: id ?? this.state.freshBasket?.id ?? this.state.baskets[0]?.id ?? '' }),
      /** Pick a flower in the basket out, or the basket itself, as a click does. */
      pick: (id: string) => this.dispatch({ type: 'pick', find: id, touch: false }),
      sendAll: () => this.dispatch({ type: 'pickBasket', touch: false }),
      /** The basket's phase: closed, opening, open, swapping, closing, sending, sendingAll. */
      phase: () => this.basket.phase.kind,
      /** A postcard arrives as from the backend. */
      arrive: () => {
        const s = this.state.snapshot;
        const card: Postcard | undefined = s?.postcards.find((p) => !p.invitation);
        const source = this.source as Partial<PlaceholderSource>;
        if (card && source.push) source.push({ type: 'postcard', postcard: { ...card, id: `pc-${Date.now()}`, day: new Date().toISOString().slice(0, 10), place: 'Just now' } });
      },
      mail: () => this.openSheet(() => void this.mail.open()),
      muse: () => this.openSheet(() => this.museSheet.open()),
      /** The post, where the tickets are. */
      travel: () => this.openSheet(() => void this.mail.open()),
      home: (h: boolean) => this.setHome(h),
      flying: () => this.flight.flying,
      /** Take the pins off the globe, or put them back (a frame or a draw count without them). */
      pins: (shown: boolean) => (shown ? this.world.scene.add(this.pins.group) : this.pins.group.removeFromParent()),
      placeholder: placeholderSource,
      newest: (): Basket | undefined => this.state.baskets[0],
    };
  }
}
