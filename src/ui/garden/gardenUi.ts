import { Vector3 } from 'three';
import friendFace from '../../assets/garden/friend-face.jpg';
import museFace from '../../assets/garden/muse-face.jpg';
import { bedAt, layOut, type Bed, type GardenLayout } from '../../garden/placement';
import { placeholderSource, type PlaceholderSource } from '../../garden/placeholder';
import { gardenSource, type GardenSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import type { Basket, Postcard } from '../../garden/types';
import { FindBeds, type BedLook } from '../../life/findBeds';
import type { MuseDirection } from '../../life/muse';
import { Pins, type PinSpec } from '../../life/pins';
import type { ParamStore } from '../../params';
import { tangentToward, travel } from '../../planet/geo';
import { createGroundSample, type Layout } from '../../planet/terrain';
import { warpPoint } from '../../render/warp';
import { Flight, type Framing } from '../../view/flight';
import type { World } from '../../world';
import { BasketsSheet } from './baskets';
import { button, dayName, el } from './dom';
import { FindCard } from './findCard';
import './garden.css';
import { ICONS } from './icons';
import { Mail } from './mail';
import { MuseSheet } from './musePage';
import { PostBox } from './postbox';
import { TravelSheet, Visit } from './travel';

// The garden's interface over the meadow: Muse's finds as flower beds with
// their cards, the pins on the globe, the post box with Muse's postcards and
// invitations, the ticket to other worlds, and a rail down the right: Muse
// (its page), find Muse, its cottage, the baskets, the pins. Everything it
// shows comes from a GardenSource (garden/source.ts) through GardenState.
// main.ts calls update() before the world moves its camera, frame() after,
// and offers it taps first.

/** How a find is framed: the camera's distance and height over the bed, and where it looks (m). */
const FIND_VIEW = { distance: 7.2, height: 3.1, aim: 1.15 } as const;
/** A basket's patch: its first find from a little farther back, under the clouds. */
const PATCH_VIEW = { distance: 9.5, height: 3.6, aim: 1.0 } as const;
/** The line from a bed up to its card (m); higher than this (m) a card is put away. */
const STEM = 1.9;
const CARD_UNDER = 30;
/** The cottage's view and Muse's (as world.ts's named views): distance, height, bearing from the front (rad), looked-at point (cottage-local x, y, z, m). */
const HOME_VIEW = { distance: 26, height: 11, bearing: 0.92, at: [-1.8, 2.6, 1.4] } as const;
const MUSE_VIEW = { distance: 4.6, height: 1.35, bearing: 0.3, aim: 0.62 } as const;
const AT_HOME: MuseDirection = { kind: 'home', busy: false };
const OUT_OF_SIGHT: MuseDirection = { kind: 'hidden' };

const sample = createGroundSample();
const tmp = new Vector3();

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
  private readonly flight: Flight;
  private readonly card: FindCard;
  private readonly postbox: PostBox;
  private readonly mail: Mail;
  private readonly basketsSheet: BasketsSheet;
  private readonly museSheet: MuseSheet;
  private readonly travelSheet: TravelSheet;
  private readonly visit: Visit;
  private readonly portrait: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly basketsButton: HTMLButtonElement;
  private readonly pinsButton: HTMLButtonElement;
  private readonly sign: HTMLElement;
  private readonly basketDot: HTMLElement;
  private readonly ticket: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private layout: GardenLayout = { beds: new Map(), patches: new Map() };
  private laidFor: { radius: number; layout: Layout | null } = { radius: 0, layout: null };
  private relayoutAt = 0;
  /** The find whose card is up (or rising), and the one being flown to. */
  private current: string | null = null;
  private offscreen = 0;
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
    world.scene.add(...this.beds.meshes, this.pins.group);
    this.flight = new Flight(world.rig);

    this.card = new FindCard(this.root, {
      like: () => this.like(),
      step: (d) => this.step(d),
      close: () => this.closeCard(),
    });

    // the rail
    const rail = el('nav', 'g-rail');
    rail.setAttribute('aria-label', 'Garden');
    this.portrait = button('g-portrait', 'Muse', '', () => this.museSheet.open());
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
    this.basketsButton = button('g-railbtn', 'Baskets', ICONS.basket, () => this.basketsSheet.open());
    this.basketsButton.dataset.label = 'Baskets';
    this.basketDot = el('span', 'g-dot');
    this.basketsButton.append(this.basketDot);
    this.pinsButton = button('g-railbtn', 'Pins', ICONS.pin, () => this.state.setPins(!this.state.pins));
    this.pinsButton.dataset.label = 'Pins on the globe';
    rail.append(this.portrait, find, this.homeButton, this.basketsButton, this.pinsButton);
    this.root.append(rail);

    // the post box and the ticket beside it
    this.postbox = new PostBox(this.root, () => void this.mail.open());
    this.ticket = button('g-ticket', 'Travel to other worlds', `${ICONS.globe}<span>Travel</span><i class="g-ticket-seal"></i>`, () => this.travelSheet.open());
    this.root.append(this.ticket);
    this.visit = new Visit(this.root, world, store, {
      leaving: () => this.closeCard(),
      changed: (away) => {
        this.root.classList.toggle('is-away', away);
        document.body.classList.toggle('g-away', away);
      },
    });
    this.mail = new Mail(this.root, this.state, this.postbox, {
      travel: (id) => this.board(id),
    });
    this.basketsSheet = new BasketsSheet(this.root, this.state, (id) => this.goToBasket(id));
    this.museSheet = new MuseSheet(this.root, this.state, { muse: museFace, friend: friendFace }, (home) => this.setHome(home));
    this.travelSheet = new TravelSheet(this.root, this.state, (id) => this.board(id));

    this.toastEl = el('div', 'g-toast');
    this.toastEl.setAttribute('role', 'status');
    this.root.append(this.toastEl);

    this.state.subscribe((change) => this.changed(change));
    this.state.start().catch((error: unknown) => {
      console.error('garden: could not load', error);
      this.toast('The garden could not be reached just now.');
    });
    window.addEventListener('keydown', (e) => this.key(e));
    if (import.meta.env.DEV || import.meta.env.VITE_PROBE) this.installProbe();
  }

  // ---- state → interface -----------------------------------------------------------

  private changed(change: string): void {
    const s = this.state;
    if (change === 'snapshot') this.applyWorld();
    if (change === 'snapshot' || change === 'baskets') this.relayout(true);
    if (change === 'snapshot' || change === 'likes' || change === 'pins' || change === 'status') this.refreshPins();
    const unread = s.unread.length;
    this.postbox.setMail(unread, s.invitations.filter((p) => !s.isRead(p.id)).length);
    this.ticket.classList.toggle('has-invite', s.invitations.length > 0);
    this.basketDot.classList.toggle('is-on', s.freshBasket !== undefined);
    this.pinsButton.setAttribute('aria-pressed', String(s.pins));
    const home = s.status.home;
    this.portrait.classList.toggle('is-out', !home);
    this.status.innerHTML = `<i></i>${home ? 'at home' : 'out exploring'}`;
    this.sign.classList.toggle('is-on', !home);
    this.homeButton.title = home ? 'Muse’s cottage' : 'Muse’s cottage: Muse is out';
    if (change === 'snapshot' && s.freshBasket) {
      const fresh = s.freshBasket;
      setTimeout(() => this.toast(`Muse brought you a basket${fresh.title ? `: ${fresh.title}` : ''}`, 'Go and see', () => this.goToBasket(fresh.id)), 1800);
    }
    if (change === 'postcards' || change === 'snapshot') {
      this.mail.refresh();
      this.travelSheet.render();
    }
    if (change === 'baskets' || change === 'snapshot') this.basketsSheet.render();
    if (change === 'interests' || change === 'snapshot' || change === 'status') this.museSheet.render();
  }

  /** Muse's own planet, when the source names one: the finds were found on it. */
  private applyWorld(): void {
    const world = this.state.snapshot?.world;
    if (!world) return;
    this.store.set('world.seed', world.seed);
    this.store.set('world.growth', world.g);
  }

  /** Lay the finds out on the planet again (a new basket, or a planet that grew). */
  private relayout(force = false): void {
    const w = this.world;
    const radius = w.growth.radius;
    if (!force && radius === this.laidFor.radius && w.terrain.layout === this.laidFor.layout) return;
    const s = this.state.snapshot;
    if (!s) return;
    this.laidFor = { radius, layout: w.terrain.layout };
    this.layout = layOut(w.terrain, s.baskets, s.finds);
    const looks: BedLook[] = [];
    const hidden = new Set<string>();
    for (const basket of this.state.baskets) {
      for (const id of basket.finds) {
        const bed = this.layout.beds.get(id);
        const find = this.state.find(id);
        if (!bed || !find) continue;
        const interest = this.state.interest(find.topic);
        looks.push({ bed, species: interest?.species ?? 0, variant: interest?.variant ?? 0.5 });
        if (!this.state.visitedBasket(basket.id)) hidden.add(id);
      }
    }
    this.beds.set(looks, radius, hidden);
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

  /** After the world's update: the beds' clock, the pins, the card over its bed. */
  frame(dt: number): void {
    const w = this.world;
    const now = performance.now();
    if (now > this.relayoutAt && (w.growth.radius !== this.laidFor.radius || w.terrain.layout !== this.laidFor.layout)) {
      // (while the planet grows, at most twice a second)
      this.relayoutAt = now + 500;
      this.relayout();
    }
    const away = this.visit.away;
    this.beds.update(away ? Infinity : w.rig.altitude);
    this.pins.update(dt, this.state.pins && !away, w.rig.zoom, w.rig.camera, w.warp, w.growth.radius);
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

  /** A tap on the canvas: a pin, or a bed. True when the garden took it. */
  tap(x: number, y: number, width: number, height: number): boolean {
    const w = this.world;
    const pin = this.pins.pick(x, y, width, height, w.rig.camera);
    if (pin) {
      if (pin.kind === 'muse') this.findMuse();
      else this.openFind(pin.id.slice('liked:'.length));
      return true;
    }
    if (this.visit.away) return false;
    const hit = w.pick((x / width) * 2 - 1, 1 - (y / height) * 2);
    if (!hit) return false;
    const bed = bedAt(this.layout, hit.dir, w.growth.radius);
    if (!bed) return false;
    if (!this.state.visitedBasket(bed.basket)) this.goToBasket(bed.basket);
    else this.openFind(bed.find);
    return true;
  }

  /** You took the camera (a drag, the wheel, a key): any flight ends there. */
  interrupt(): void {
    this.flight.cancel();
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      if (this.mail.isOpen) this.mail.close();
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
    this.beds.highlight(null);
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
    });
    this.beds.highlight(id);
  }

  private step(direction: 1 | -1): void {
    const order = this.state.browseOrder.filter((id) => this.state.visitedBasket(this.state.find(id)?.basket ?? ''));
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
    this.beds.highlight(null);
    this.current = null;
  }

  // ---- baskets ---------------------------------------------------------------------------

  /**
   * Fly to a basket's patch, framed on its first find (the beds round it in view); a basket not yet
   * visited is planted as you arrive, the middle bed first, and its card rises while the rest blossom.
   */
  goToBasket(id: string): void {
    const basket = this.state.basket(id);
    const first = basket?.finds.find((f) => this.layout.beds.has(f));
    const bed = first ? this.layout.beds.get(first) : undefined;
    if (!basket || !first || !bed) return;
    if (this.card.shown) this.card.hide(0);
    this.beds.highlight(null);
    this.current = first;
    const fresh = !this.state.visitedBasket(id);
    this.flight.to(this.framing(bed, PATCH_VIEW), this.world.growth.radius, this.ground, () => {
      if (!fresh) {
        this.raise(first);
        return;
      }
      this.state.visit(id);
      this.beds.plant(basket.finds, 0.24, 0.1);
      setTimeout(() => this.raise(first), 1150);
    });
  }

  // ---- Muse ---------------------------------------------------------------------------------

  /** Where Muse is: on its terrace (where its day has it) when home; out, where the source says, or by the newest basket. */
  private musePlace(): { dir: Vector3; ground: number; home: boolean } {
    const w = this.world;
    const status = this.state.status;
    if (!status.home) {
      if (status.where) {
        const dir = new Vector3(...status.where).normalize();
        return { dir, ground: this.ground(dir), home: false };
      }
      const newest = this.state.baskets[0];
      const patch = newest && this.layout.patches.get(newest.id);
      if (patch) return { dir: patch.dir.clone(), ground: this.ground(patch.dir), home: false };
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
      this.toast(this.state.status.note ?? 'Muse is out exploring. It’s somewhere round here.');
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
    // (a stand-in for the backend's status, from Muse's page: see what the garden does when Muse is out)
    const source = this.source as Partial<PlaceholderSource>;
    const status = home ? { home: true, note: 'Pottering about on the terrace' } : { home: false, note: 'Out exploring past the hills. Back with a basket.' };
    if (source.push) source.push({ type: 'status', status });
    else this.state.receive({ type: 'status', status });
  }

  // ---- travel ----------------------------------------------------------------------------------

  private board(invitationId: string): void {
    const card = this.state.postcards.find((p) => p.id === invitationId);
    if (!card?.invitation) return;
    this.mail.close();
    this.travelSheet.close();
    this.state.useInvitation(invitationId);
    const friend = this.state.snapshot?.friends.find((f) => f.id === card.invitation?.from);
    void this.visit.start(card.invitation, friend?.name ?? 'A friend');
  }

  // ---- toasts ----------------------------------------------------------------------------------

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
      open: (id: string) => this.openFind(id),
      basket: (id?: string) => this.goToBasket(id ?? this.state.baskets[0]?.id ?? ''),
      /** Replay a basket's planting: its beds hidden again and the basket marked new. */
      replant: (id?: string) => {
        const basket = this.state.basket(id ?? this.state.baskets[0]?.id ?? '');
        if (!basket) return;
        this.beds.unplant(basket.finds);
        (this.state as unknown as { visited: Set<string> }).visited.delete(basket.id);
        this.goToBasket(basket.id);
      },
      /** A postcard arrives as from the backend. */
      arrive: () => {
        const s = this.state.snapshot;
        const card: Postcard | undefined = s?.postcards.find((p) => !p.invitation);
        const source = this.source as Partial<PlaceholderSource>;
        if (card && source.push) source.push({ type: 'postcard', postcard: { ...card, id: `pc-${Date.now()}`, day: new Date().toISOString().slice(0, 10), place: 'Just now' } });
      },
      mail: () => this.mail.open(),
      muse: () => this.museSheet.open(),
      baskets: () => this.basketsSheet.open(),
      travel: () => this.travelSheet.open(),
      home: (h: boolean) => this.setHome(h),
      flying: () => this.flight.flying,
      placeholder: placeholderSource,
      newest: (): Basket | undefined => this.state.baskets[0],
    };
  }
}
