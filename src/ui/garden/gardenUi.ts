import { Box3, Matrix4, Vector3, type Vector4 } from 'three';
import friendFace from '../../assets/garden/friend-face.jpg';
import museFace from '../../assets/garden/muse-face.jpg';
import { bedAt, layOut, type Bed, type GardenLayout } from '../../garden/placement';
import { placeholderSource, type PlaceholderSource } from '../../garden/placeholder';
import { gardenSource, type GardenSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import type { Basket, Postcard } from '../../garden/types';
import { FindBeds, type BedLook } from '../../life/findBeds';
import { MUSE_HEIGHT, type MuseDirection } from '../../life/muse';
import { POT } from '../../life/museRig';
import type { Indoors, Room } from '../../life/museRoam';
import { Pins, type PinSpec } from '../../life/pins';
import { FLOOR, FRONT, OUTER } from '../../life/props';
import type { ParamStore } from '../../params';
import { angleBetween, tangentToward, travel } from '../../planet/geo';
import { createGroundSample, type Layout } from '../../planet/terrain';
import { warpPoint } from '../../render/warp';
import { Cutaway } from '../../view/cutaway';
import { Flight, type Framing } from '../../view/flight';
import type { World } from '../../world';
import { BasketsSheet } from './baskets';
import { BasketFlight, framingToFit, type Arrival } from './basketFlight';
import { button, dayName, el } from './dom';
import { FindCard, topicColour, topicRgb } from './findCard';
import { HutEditor } from './hutEditor';
import './garden.css';
import { ICONS } from './icons';
import { Mail } from './mail';
import { MuseSheet } from './musePage';
import { PostBox } from './postbox';
import { TravelSheet, Visit } from './travel';

// The garden's interface over the meadow: Muse's finds as patches of flowers
// with their cards, the pins on the globe, the post box with Muse's postcards and
// invitations, the ticket to other worlds, and a rail down the right: Muse
// (its page), find Muse, its cottage, the baskets, the pins. Tap the hut's
// door while Muse is about and the cutaway opens the room (view/cutaway.ts);
// a glowing dot on Muse's showpiece turns the camera to it, where a white dot
// on each favourite opens its card as a find's does. Everything it shows
// comes from a GardenSource
// (garden/source.ts) through GardenState. main.ts calls update() before the
// world moves its camera, frame() after, and offers it taps first.

/** How a find is framed: the camera's distance and height over the bed, and where it looks (m). */
const FIND_VIEW = { distance: 7.2, height: 3.1, aim: 1.15 } as const;
/** The line from a bed up to its card (m); higher than this (m) a card is put away. */
const STEM = 1.9;
const CARD_UNDER = 30;
/** The cottage's view (as world.ts's named view): distance, height, bearing from the front (rad), looked-at point (cottage-local x, y, z, m). */
const HOME_VIEW = { distance: 26, height: 11, bearing: 0.92, at: [-1.8, 2.6, 1.4] } as const;
/** Muse's, as the M key frames it (world.ts's MUSE_VIEW): distance and height (m), bearing round from in front of Muse (rad), looked-at height (m). */
const MUSE_VIEW = { distance: 4 * MUSE_HEIGHT, height: 1.23 * MUSE_HEIGHT, bearing: 0.3, aim: 0.55 * MUSE_HEIGHT } as const;
const AT_HOME: MuseDirection = { kind: 'home', busy: false };
const OUT_OF_SIGHT: MuseDirection = { kind: 'hidden' };

/** A tap or the pointer this near a find's sphere (px) picks it; the sphere stands this high over its bed (m). */
const SPHERE = { slop: 16, height: 0.6 } as const;
/** The hut's door (the homestead's local m: its sides, its sill and its head, the wall's face): tap it to go in. */
const DOOR = { x0: -OUTER.x + FRONT.door[0], x1: -OUTER.x + FRONT.door[1], y0: FLOOR, y1: FLOOR + 2.15, z: OUTER.z } as const;
/** At Muse's shelf: how near a tap must come to a favourite's dot, or in the room to the showpiece's (px); where a card stands up the screen (a share of its height). */
const SHELF = { slop: 18, beacon: 26, cardFoot: 0.8 } as const;
/** Nearer than this to the cottage (m) and lower than this (m), the hut's furniture is fetched ahead of a knock. */
const NEAR_HUT = { distance: 70, altitude: 80 } as const;
/** Muse this near the hut (m) is about it: its door opens to you, wherever Muse is pottering. */
const MUSE_NEAR = 30;
/**
 * Muse in its hut: where it stands greeting you (local m: on the rug, clear of the table), facing the way the
 * cutaway looks in from (its bearing from the front, rad); at the stove, how far it is turned from facing the back
 * wall toward the left (rad), clear of the table; asleep, how far toward the bed's foot from the mattress's middle
 * (m: so its head lies on the pillow, not over the headboard), how far it sinks in, and how far in from the bed's
 * side it sits on the edge getting in; and how often a visit finds it cooking, greeting you, asleep.
 */
const INSIDE = { x: 0.6, z: 0.75, facing: 0.68, stove: 0.96, toFoot: 0.55, sink: 0.12, edge: 0.08 } as const;
const VISITS: ReadonlyArray<readonly [Indoors, number]> = [
  ['cook', 0.4],
  ['greet', 0.35],
  ['sleep', 0.25],
];

const sample = createGroundSample();
const tmp = new Vector3();
const tmpLocal = new Vector3();

/** The finds' marks on the planet (their patches of flowers, and the glowing spheres seen from high up). */
export interface FindMarks {
  hover(id: string | null): void;
  open(id: string | null): void;
  pulse(ids: readonly string[]): void;
  /** How plainly the spheres show at the camera's height, 0..1. */
  spheresShown(): number;
  /** Whether the patches are drawn at the camera's height. */
  bedsShown(): boolean;
  /** Whether a find's patch is planted (growing or grown) by now. */
  planted(id: string): boolean;
  /** The find under the pointer. */
  readonly hovered: string | null;
  /** The picked basket's finds, marked until another basket is picked. */
  readonly selected: readonly string[];
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
  /** The cutaway into Muse's hut. */
  private readonly cutaway: Cutaway;
  /** Muse's favourites in the shelf's order (find ids), the one whose card is up (its place, -1: none), the one under the pointer. */
  private favourites: string[] = [];
  private favourite = -1;
  private hoveredFavourite = -1;
  private hoveredBeacon = false;
  private readonly outside: HTMLButtonElement;
  private hutFetched = false;
  /** What Muse is doing in its hut this visit (chosen as you knock), and whether it was put there (the room laid out while it was away) rather than walking in. */
  private indoors: Indoors = 'greet';
  private placed = false;
  /** The hut's layout editor (temporary: ?edit in the address), and its button in the room. */
  private readonly editor: HutEditor | null;
  private readonly editOpen: HTMLButtonElement | null;
  private readonly basketFlight: BasketFlight;
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
  /** Where Muse was last shown to be (at home, in the meadow, out exploring), and whether it was drawn. */
  private whereabouts = '';
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
    this.cutaway = new Cutaway(world);
    this.basketFlight = new BasketFlight(this.root, {
      project: (dir, height) => this.project(dir, height, window.innerWidth, window.innerHeight),
      cameraRemaining: () => this.flight.remaining,
      // (a quarter second back on the planting clock: its first sprouts show as it lands)
      plant: (ids) => this.beds.plant(ids, 0.12, -0.25),
      pulse: (ids) => this.marks?.pulse(ids),
    });

    this.card = new FindCard(this.root, {
      like: () => this.like(),
      share: (id, shared) => this.state.shareFind(id, shared),
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
    this.basketsSheet = new BasketsSheet(this.root, this.state, (id, from) => this.goToBasket(id, from));
    this.museSheet = new MuseSheet(this.root, this.state, { muse: museFace, friend: friendFace }, (home) => this.setHome(home));
    this.travelSheet = new TravelSheet(this.root, this.state, (id) => this.board(id));

    this.toastEl = el('div', 'g-toast');
    this.toastEl.setAttribute('role', 'status');
    this.root.append(this.toastEl);
    // the way out of the hut, while in it
    this.outside = button('g-outside', 'Step outside', `${ICONS.door}<span>Step outside</span>`, () => {
      // (at the shelf, back to the room first)
      if (this.cutaway.atShelf) {
        this.closeCard();
        this.cutaway.fromShelf();
      } else this.leaveHut();
    });
    this.root.append(this.outside);
    // (the layout editor, while the room is being laid out: ?edit in the address)
    const scene = document.querySelector<HTMLCanvasElement>('#scene');
    this.editor = new URLSearchParams(location.search).has('edit') && scene ? new HutEditor(this.root, world, scene, () => undefined) : null;
    this.editOpen = this.editor ? button('g-edit-open', 'Edit the layout', '', () => void this.editor?.open()) : null;
    if (this.editOpen) {
      this.editOpen.textContent = 'Edit layout';
      this.root.append(this.editOpen);
    }

    this.state.subscribe((change) => this.changed(change));
    this.state.start().catch((error: unknown) => {
      console.error('garden: could not load', error);
      this.toast('The garden could not be reached just now.');
    });
    window.addEventListener('keydown', (e) => this.key(e));
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
    if (change === 'snapshot' || change === 'likes' || change === 'pins' || change === 'status') this.refreshPins();
    const unread = s.unread.length;
    this.postbox.setMail(unread, s.invitations.filter((p) => !s.isRead(p.id)).length);
    this.ticket.classList.toggle('has-invite', s.invitations.length > 0);
    this.basketDot.classList.toggle('is-on', s.freshBasket !== undefined);
    this.pinsButton.setAttribute('aria-pressed', String(s.pins));
    this.whereabouts = '';
    this.refreshWhereabouts();
    if (change === 'snapshot' && s.freshBasket) {
      const fresh = s.freshBasket;
      setTimeout(() => this.toast(`Muse brought you a basket${fresh.title ? `: ${fresh.title}` : ''}`, 'Go and see', (from) => this.goToBasket(fresh.id, from)), 1800);
    }
    if (change === 'postcards' || change === 'snapshot') {
      this.mail.refresh();
      this.travelSheet.render();
    }
    if (change === 'baskets' || change === 'snapshot') this.basketsSheet.render();
    if (change === 'interests' || change === 'snapshot' || change === 'status') this.museSheet.render();
    if (change === 'snapshot' || change === 'baskets' || change === 'interests') this.refreshFavourites();
  }

  /** Muse's favourites on its shelf: their lights in their topics' colours. */
  private refreshFavourites(): void {
    const hut = this.world.hut;
    this.favourites = this.state.favourites.slice(0, hut.slots);
    hut.setFavourites(this.favourites.map((id) => ({ colour: topicRgb(this.state.interest(this.state.find(id)?.topic ?? '')) })));
    if (this.favourite >= this.favourites.length) this.closeCard();
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
        if (!this.state.visitedBasket(basket.id) || this.basketFlight.waiting(id)) hidden.add(id);
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
    if (muse) specs.push({ id: 'muse', kind: 'muse', dir: muse.dir, ground: muse.ground });
    this.pins.set(specs);
  }

  /** Where Muse is, in a word: at home (about its hut, as the door has it: MUSE_NEAR), in the meadow (farther off), or out exploring (as the source says). */
  private refreshWhereabouts(): void {
    const w = this.world;
    const word = !this.state.status.home ? 'out exploring' : this.museAbout() ? 'at home' : 'in the meadow';
    // (drawn or not decides where its pin stands, so a change of that alone stands the pins again)
    const now = w.muse.away ? `${word}, unseen` : word;
    if (now === this.whereabouts) return;
    this.whereabouts = now;
    const home = word === 'at home';
    this.portrait.classList.toggle('is-out', !home);
    this.status.innerHTML = `<i></i>${word}`;
    this.sign.classList.toggle('is-on', !home);
    this.homeButton.title = home ? 'Muse’s cottage' : 'Muse’s cottage: Muse is out';
    this.refreshPins();
  }

  // ---- each frame ------------------------------------------------------------------------

  /** Before the world moves: a flight drives the camera, and Muse is told where to be. */
  update(dt: number): void {
    this.flight.update(dt);
    this.cutaway.update(dt);
    const muse = this.visit.away ? OUT_OF_SIGHT : this.cutaway.entering && this.placed ? this.inside() : this.driveMuse ? this.driveMuse(dt) : this.state.status.home ? AT_HOME : OUT_OF_SIGHT;
    if (muse) this.world.muse.direct(muse);
  }

  /**
   * Muse put in its hut (the room laid out while it was away, ?edit), doing what this visit found it doing (until the
   * room is in, greeting you): at the hearth's stove, cooking (the pot ahead of it and a little to its right, as its
   * cooking pose has it: museRig.ts POT; standing at the hearth's right front, turned toward the pot); on the rug,
   * greeting you, turned toward the way you look in; or asleep on its bed, lying back along it, its head on the
   * pillow. About the hut, it walks in instead (room, museRoam.ts comeIn).
   */
  private inside(): MuseDirection {
    const c = this.cutaway;
    const hut = this.world.hut;
    const pot = this.indoors === 'cook' ? hut.potAt(tmpLocal) : null;
    const bed = this.indoors === 'sleep' ? hut.bedAt(new Vector3()) : null;
    const doing: Indoors = pot ? 'cook' : bed ? 'sleep' : 'greet';
    let [x, y, z, aheadX, aheadZ]: number[] = [INSIDE.x, FLOOR, INSIDE.z, Math.sin(INSIDE.facing), Math.cos(INSIDE.facing)];
    if (pot) {
      // facing f (turned INSIDE.stove from the back wall toward the left), its left l = up × f: the pot at l·POT[0] + f·POT[2]
      const [fx, fz] = [-Math.sin(INSIDE.stove), -Math.cos(INSIDE.stove)];
      const [lx, lz] = [fz, -fx];
      [x, z, aheadX, aheadZ] = [pot.x - (lx * POT[0] + fx * POT[2]) * MUSE_HEIGHT, pot.z - (lz * POT[0] + fz * POT[2]) * MUSE_HEIGHT, fx, fz];
    } else if (bed) {
      // facing the bed's foot, so that lying back its head goes to the pillow
      [x, y, z, aheadX, aheadZ] = [bed.at.x + bed.foot.x * INSIDE.toFoot, bed.at.y - INSIDE.sink, bed.at.z + bed.foot.z * INSIDE.toFoot, bed.foot.x, bed.foot.z];
    }
    const dir = c.local(x, 0, z, new Vector3());
    const ahead = c.local(x + aheadX, 0, z + aheadZ, new Vector3());
    const up = dir.clone().normalize();
    const heading = ahead.sub(dir);
    heading.addScaledVector(up, -heading.dot(up)).normalize();
    return { kind: 'inside', doing, dir: up, height: this.world.terrain.cottageGround + y, heading, pot: pot ? c.local(pot.x, pot.y, pot.z, new Vector3()) : null };
  }

  /**
   * The hut inside as Muse goes about it (museRoam.ts Room), as it is laid out now: what stands on the floor (not the
   * rug, nor what hangs over its head), where it greets you, where it cooks (at the hearth's right front, turned to
   * the pot) and where it lies on its bed (its head on the pillow), getting in from the side toward the room's
   * middle; null before the room is in.
   */
  private room(): Room | null {
    const hut = this.world.hut;
    const pot = hut.potAt(new Vector3());
    const bed = hut.bedAt(new Vector3());
    if (!pot || !bed) return null;
    const box = new Box3();
    const things = hut.pieces.flatMap((p) => {
      if (!p.piece) return [];
      box.copy(p.box).applyMatrix4(p.place.value);
      return box.min.y > FLOOR + MUSE_HEIGHT ? [] : [{ x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z }];
    });
    const [fx, fz] = [-Math.sin(INSIDE.stove), -Math.cos(INSIDE.stove)];
    const [lx, lz] = [fz, -fx];
    const cook = { x: pot.x - (lx * POT[0] + fx * POT[2]) * MUSE_HEIGHT, z: pot.z - (lz * POT[0] + fz * POT[2]) * MUSE_HEIGHT, facing: [fx, fz] as const, pot: [pot.x, pot.y, pot.z] as const };
    const lie = { x: bed.at.x + bed.foot.x * INSIDE.toFoot, z: bed.at.z + bed.foot.z * INSIDE.toFoot };
    let side: [number, number] = [bed.foot.z, -bed.foot.x];
    if (side[0] * -lie.x + side[1] * -lie.z < 0) side = [-side[0], -side[1]];
    const b = bed.box;
    const edge = (Math.abs(side[0]) > Math.abs(side[1]) ? (side[0] > 0 ? b.max.x - lie.x : lie.x - b.min.x) : side[1] > 0 ? b.max.z - lie.z : lie.z - b.min.z) - INSIDE.edge;
    return {
      things,
      greet: { x: INSIDE.x, z: INSIDE.z, facing: [Math.sin(INSIDE.facing), Math.cos(INSIDE.facing)] },
      cook,
      bed: { ...lie, y: bed.at.y - INSIDE.sink, foot: [bed.foot.x, bed.foot.z], side, edge },
    };
  }

  /** What a visit finds Muse doing in its hut, at random by how often each is (VISITS). */
  private pickIndoors(): Indoors {
    const total = VISITS.reduce((t, [, w]) => t + w, 0);
    let r = Math.random() * total;
    for (const [doing, w] of VISITS) {
      r -= w;
      if (r <= 0) return doing;
    }
    return 'greet';
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
    // Muse's whereabouts as it goes about, and its pin where it is now while it is drawn on the planet
    this.refreshWhereabouts();
    if (!w.muse.away) this.pins.move('muse', w.muse.where.dir, w.muse.where.height);
    this.basketFlight.update(dt);
    // (picked when the pointer moved, or the view moved under it: a flight, a zoom still gliding)
    if (this.pointer && (this.pointerMoved || !w.rig.camera.matrixWorld.equals(this.pickedIn))) this.hover(this.pointer);
    this.beds.update(w.rig.altitude, !away);
    this.pins.update(dt, this.state.pins && !away, w.rig.zoom, w.rig.camera, w.warp, w.growth.radius);
    // the hut: its furniture fetched as you come near, the way out shown while in, its favourites' lights marked
    if (!this.hutFetched && this.nearHut()) {
      this.hutFetched = true;
      w.hut.load().catch((error: unknown) => console.error('hut: could not load', error));
    }
    this.outside.classList.toggle('is-on', this.cutaway.entering);
    this.labelOutside();
    this.editOpen?.classList.toggle('is-on', this.cutaway.open && !this.cutaway.atShelf && !this.editor?.active);
    w.hut.mark(this.cutaway.atShelf ? this.hoveredFavourite : -1, this.favourite, this.hoveredBeacon && !this.cutaway.atShelf);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const bed = this.current ? this.layout.beds.get(this.current) : undefined;
    if (!bed && this.favourite >= 0) {
      // a favourite's card: beside the showpiece, on the side of the screen with more room, its line rising from its dot
      const at = this.cutaway.active ? w.hut.slot(this.favourite, tmpLocal) : null;
      const foot = at ? this.projectLocal(at, width, height) : null;
      const shelf = w.shared.uOcclude.value as Vector4;
      const right = 1 - shelf.z >= shelf.x;
      const top = foot ? { x: width * (right ? (1 + shelf.z) / 2 : shelf.x / 2), y: height * SHELF.cardFoot } : null;
      this.card.place(foot, top, dt, width, height);
    } else if (bed) {
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

  /** A point in the homestead's local meters on screen (px), or null behind the camera. */
  private projectLocal(local: Vector3, width: number, height: number): { x: number; y: number } | null {
    const w = this.world;
    this.cutaway.local(local.x, local.y, local.z, tmp);
    warpPoint(w.warp, tmp, tmp);
    tmp.project(w.rig.camera);
    if (tmp.z < -1 || tmp.z > 1) return null;
    return { x: ((tmp.x + 1) / 2) * width, y: ((1 - tmp.y) / 2) * height };
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

  /** A tap on the canvas: in the hut, a favourite on the shelf; else a pin, the hut's door, or a find (its sphere from high up, its bed below). True when the garden took it. */
  tap(x: number, y: number, width: number, height: number): boolean {
    if (this.editor?.active) {
      // laying the room out: a tap picks the piece under it (one on the gizmo is the gizmo's)
      if (!this.editor.busy) this.editor.pick(x, y, width, height);
      return true;
    }
    if (this.cutaway.active) {
      // (while the camera rises or comes down, taps wait)
      if (!this.cutaway.open) return true;
      if (this.cutaway.atShelf) {
        // at the shelf: a favourite's dot opens its card; elsewhere a tap puts the card away, then goes back to the room
        const i = this.favouriteAt(x, y, width, height);
        if (i >= 0) this.openFavourite(i);
        else if (this.card.shown) this.closeCard();
        else this.cutaway.fromShelf();
        return true;
      }
      if (this.onBeacon(x, y, width, height)) {
        this.cutaway.toShelf();
        return true;
      }
      return false;
    }
    const pin = this.pins.pick(x, y, width, height, this.world.rig.camera);
    if (pin) {
      if (pin.kind === 'muse') this.findMuse();
      else this.openFind(pin.id.slice('liked:'.length));
      return true;
    }
    if (this.doorAt(x, y, width, height)) {
      this.knock();
      return true;
    }
    const bed = this.findAt(x, y, width, height);
    if (!bed) return false;
    if (!this.state.visitedBasket(bed.basket)) this.goToBasket(bed.basket);
    else this.openFind(bed.find);
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
        // only what is drawn: planted, and on this side of the horizon
        if (!this.state.visitedBasket(bed.basket) || this.basketFlight.waiting(bed.find)) continue;
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
    if (this.editor?.active) {
      at.canvas.style.cursor = '';
      return;
    }
    if (this.cutaway.active) {
      const open = this.cutaway.open;
      this.hoveredFavourite = open && this.cutaway.atShelf ? this.favouriteAt(at.x, at.y, width, height) : -1;
      this.hoveredBeacon = open && !this.cutaway.atShelf && this.onBeacon(at.x, at.y, width, height);
      this.setHovered(null);
      at.canvas.style.cursor = this.hoveredFavourite >= 0 || this.hoveredBeacon ? 'pointer' : '';
      return;
    }
    this.hoveredBeacon = false;
    this.hoveredFavourite = -1;
    const pin = this.pins.pick(at.x, at.y, width, height, this.world.rig.camera);
    const bed = pin ? null : this.findAt(at.x, at.y, width, height);
    const shown = bed && this.state.visitedBasket(bed.basket) && !this.basketFlight.waiting(bed.find) ? bed.find : null;
    this.setHovered(shown);
    const door = !pin && !shown && this.doorAt(at.x, at.y, width, height);
    at.canvas.style.cursor = pin || shown || door ? 'pointer' : '';
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.marks?.hover(id);
  }

  /** You took the camera (a drag, the wheel, a key): any flight ends there. */
  interrupt(): void {
    this.flight.cancel();
  }

  /** Whether the layout editor's gizmo has the pointer (main.ts leaves drags, taps and holds to it then). */
  get gizmo(): boolean {
    return this.editor?.busy ?? false;
  }

  /** A drag while in the hut turns round the room (true: the garden took it). */
  drag(dx: number, dy: number, width: number, height: number): boolean {
    if (!this.cutaway.active) return false;
    this.cutaway.drag(dx, dy, width, height);
    return true;
  }

  /** The wheel or a pinch while in the hut comes closer to the room or stands back (true: the garden took it); scrolling out of the showpiece's view puts its card away. */
  zoom(delta: number): boolean {
    if (!this.cutaway.active) return false;
    if (this.cutaway.atShelf && delta < 0) this.closeCard();
    this.cutaway.zoom(delta);
    return true;
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      if (this.editor?.active) this.editor.close();
      else if (this.mail.isOpen) this.mail.close();
      else if (this.card.shown) this.closeCard();
      else if (this.cutaway.atShelf) this.cutaway.fromShelf();
      else if (this.cutaway.entering) this.leaveHut();
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
    if (this.cutaway.active) {
      this.leaveHut(() => this.openFind(id, direction));
      return;
    }
    const bed = this.layout.beds.get(id);
    const find = this.state.find(id);
    if (!bed || !find) return;
    if (this.card.shown) this.card.hide(direction);
    this.basketFlight.finish();
    this.marks?.open(null);
    this.favourite = -1;
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
    if (this.favourite >= 0) {
      const n = this.favourites.length;
      if (n > 0) this.openFavourite((this.favourite + direction + n) % n, direction);
      return;
    }
    const order = this.state.browseOrder.filter((id) => this.state.visitedBasket(this.state.find(id)?.basket ?? ''));
    if (!this.current || order.length === 0) return;
    const i = order.indexOf(this.current);
    const next = order[(i + direction + order.length) % order.length];
    this.openFind(next, direction);
  }

  private like(): void {
    const id = this.current ?? this.favourites[this.favourite];
    if (!id) return;
    const liked = this.state.toggleLike(id);
    this.card.setLiked(liked);
    if (liked && this.state.likedFindIds.length === 1) this.toast('Liked. Muse will hear of it, and it’s pinned on your map.');
  }

  private closeCard(): void {
    this.card.hide(0);
    this.basketFlight.finish();
    this.marks?.open(null);
    this.current = null;
    this.favourite = -1;
  }

  // ---- Muse's hut ------------------------------------------------------------------------------

  /** Whether the camera is near enough the hut that a knock may come (its furniture is fetched then). */
  private nearHut(): boolean {
    const w = this.world;
    return w.rig.altitude < NEAR_HUT.altitude && angleBetween(w.rig.up, w.terrain.layout.cottage) * w.growth.radius < NEAR_HUT.distance;
  }

  /** Whether a point on the canvas (px) is on the hut's door, seen from in front and big enough to mean it. */
  private doorAt(x: number, y: number, width: number, height: number): boolean {
    if (this.visit.away) return false;
    const corners: Array<{ x: number; y: number }> = [];
    for (const [cx, cy] of [
      [DOOR.x0, DOOR.y0],
      [DOOR.x1, DOOR.y0],
      [DOOR.x1, DOOR.y1],
      [DOOR.x0, DOOR.y1],
    ]) {
      const p = this.projectLocal(tmpLocal.set(cx, cy, DOOR.z), width, height);
      if (!p) return false;
      corners.push(p);
    }
    const c = this.cutaway;
    const mid = c.local((DOOR.x0 + DOOR.x1) / 2, (DOOR.y0 + DOOR.y1) / 2, DOOR.z, new Vector3());
    const out = c.local((DOOR.x0 + DOOR.x1) / 2, (DOOR.y0 + DOOR.y1) / 2, DOOR.z + 1, new Vector3()).sub(mid);
    if (out.dot(tmp.copy(this.world.rig.camera.position).sub(mid)) <= 0) return false;
    // its area on screen (the shoelace), and the point inside its outline (same side of every edge)
    let area = 0;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      area += a.x * b.y - b.x * a.y;
      const side = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
      if (side !== 0 && sign !== 0 && side !== sign) return false;
      if (side !== 0) sign = side;
    }
    return Math.abs(area) / 2 > 90;
  }

  /** Whether Muse is about the hut: home, or out in the meadow but close by (MUSE_NEAR); not when it is out exploring. */
  private museAbout(): boolean {
    const w = this.world;
    if (!this.state.status.home || w.muse.away) return false;
    return w.muse.home || angleBetween(w.muse.where.dir, w.terrain.layout.cottage) * w.growth.radius < MUSE_NEAR;
  }

  /** A knock on the door: in, if Muse is in or about the hut (or the room is being laid out); if not, why not. */
  private knock(): void {
    const w = this.world;
    if (!this.museAbout() && !this.editor) {
      if (!this.state.status.home || w.muse.away) this.toast('Muse is out exploring, and the door is shut. It’ll be back with a basket.');
      else this.toast('Muse is out in the meadow, and the door is shut.', 'Find Muse', () => this.findMuse());
      return;
    }
    this.closeCard();
    this.flight.cancel();
    this.basketFlight.finish();
    this.enterHut(this.pickIndoors(), this.museAbout());
  }

  /**
   * Into the hut, the camera rising to the cutaway: Muse, about the hut, puts by what it was doing and walks in to do
   * `doing` there once the room is in (walk); else (the room being laid out while it is away) it is put there.
   */
  private enterHut(doing: Indoors, walk: boolean): void {
    const w = this.world;
    this.indoors = doing;
    this.placed = !walk;
    const loading = w.hut.load();
    loading.catch((error: unknown) => console.error('hut: could not load', error));
    if (walk) {
      void loading.then(() => {
        const room = this.room();
        if (!room || !this.cutaway.entering || this.placed) return;
        w.muse.comeIn(doing, room);
      });
    }
    this.cutaway.enter();
  }

  /** Step outside: the card put away, Muse out onto its porch after you (unless it was put in), the camera back down to where it was before; `then` once it is there. */
  leaveHut(then?: () => void): void {
    this.closeCard();
    this.editor?.close();
    if (!this.placed) this.world.muse.goOut();
    this.placed = false;
    this.cutaway.leave(then);
  }

  /** The way out says where it goes: back to the room from the shelf, outside from the room. */
  private labelOutside(): void {
    const label = this.cutaway.atShelf ? 'Back to the room' : 'Step outside';
    if (this.outside.title === label) return;
    this.outside.title = label;
    this.outside.setAttribute('aria-label', label);
    this.outside.innerHTML = `${this.cutaway.atShelf ? ICONS.left : ICONS.door}<span>${label}</span>`;
  }

  /** Whether a point on the canvas (px) is on the showpiece's glowing dot (in the room's view). */
  private onBeacon(x: number, y: number, width: number, height: number): boolean {
    const at = this.world.hut.beaconAt(tmpLocal);
    const p = at && this.favourites.length > 0 ? this.projectLocal(at, width, height) : null;
    return p !== null && Math.hypot(p.x - x, p.y - y) < SHELF.beacon;
  }

  /** The favourite whose light is under a point on the canvas (px), or -1. */
  private favouriteAt(x: number, y: number, width: number, height: number): number {
    let best = -1;
    let bestD: number = SHELF.slop;
    for (let i = 0; i < this.favourites.length; i++) {
      const at = this.world.hut.slot(i, tmpLocal);
      const p = at ? this.projectLocal(at, width, height) : null;
      const d = p ? Math.hypot(p.x - x, p.y - y) : Infinity;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Open a favourite's card on the shelf: the last one goes off to its side, then the line rises from this one's light. */
  private openFavourite(i: number, direction: 1 | -1 | 0 = 0): void {
    const id = this.favourites[i];
    const find = id ? this.state.find(id) : undefined;
    if (!find) return;
    const wasUp = this.card.shown !== null;
    if (wasUp) this.card.hide(direction);
    this.current = null;
    this.marks?.open(null);
    this.favourite = i;
    const show = (): void => {
      if (this.favourite !== i || !this.cutaway.active) return;
      this.card.show(find, this.state.interest(find.topic), {
        basket: 'Muse’s favourites',
        index: i,
        total: this.favourites.length,
        liked: this.state.liked(id),
        shared: this.state.findShared(id),
      });
    };
    if (wasUp) setTimeout(show, 240);
    else show();
  }

  // ---- baskets ---------------------------------------------------------------------------

  /**
   * Open a basket: it flies in from `from` (where you picked it; the rail's basket by default) and its
   * finds fly to where they were found while the camera follows, high enough to see them all. A basket
   * not opened before plants its finds as they land; one opened before lights them up again.
   */
  goToBasket(id: string, from: DOMRect | null = null): void {
    if (this.cutaway.active) {
      this.leaveHut(() => this.goToBasket(id, from));
      return;
    }
    const basket = this.state.basket(id);
    const arrivals = (basket?.finds ?? []).flatMap((f): Arrival[] => {
      const bed = this.layout.beds.get(f);
      const find = this.state.find(f);
      return bed && find ? [{ id: f, bed, image: find.media.image, colour: topicColour(this.state.interest(find.topic)) }] : [];
    });
    if (arrivals.length === 0) return;
    this.closeCard();
    this.beds.select(arrivals.map((a) => a.id));
    const fresh = !this.state.visitedBasket(id);
    this.basketFlight.start(arrivals, from ?? this.basketsButton.getBoundingClientRect(), fresh);
    // (after the start: until each lands, its bed stays unplanted)
    if (fresh) this.state.visit(id);
    const R = this.world.growth.radius;
    const view = framingToFit(arrivals.map((a) => a.bed), this.flight, R, this.ground);
    this.flight.to(view, R, this.ground);
  }

  // ---- Muse ---------------------------------------------------------------------------------

  /**
   * Where Muse is: where it is drawn on the planet (world.muse.where, kept up by its life or the engine); out of sight,
   * where the source says it is; or null when it is out exploring nowhere the source says.
   */
  private musePlace(): { dir: Vector3; ground: number; heading: Vector3 } | null {
    const w = this.world;
    if (!w.muse.away) return { dir: w.muse.where.dir.clone(), ground: w.muse.where.height, heading: w.muse.where.heading.clone() };
    const where = this.state.status.where;
    if (!where) return null;
    const dir = new Vector3(...where).normalize();
    return { dir, ground: this.ground(dir), heading: tangentToward(dir, w.rig.forward, new Vector3()) };
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

  /** Fly to Muse wherever it is, as the M key frames it (world.frameMuse): in front of it and a little to its left; at home, from out in front of the terrace. */
  findMuse(): void {
    if (this.cutaway.active) {
      this.leaveHut(() => this.findMuse());
      return;
    }
    this.closeCard();
    const place = this.musePlace();
    const status = this.state.status;
    const R = this.world.growth.radius;
    if (!place) {
      this.toast(status.note ?? 'Muse is out exploring. It’ll be back with a basket.');
      return;
    }
    if (this.world.muse.away) {
      // out of sight, though the source says where: from high over the place
      this.toast(status.note ?? 'Muse is out exploring. It’s somewhere round here.');
      this.flight.to({ dir: place.dir, ground: place.ground, distance: 22, height: 26, aim: 0 }, R, this.ground);
      return;
    }
    // (out on a trip the engine walks it about the planet: what it is up to, as it goes)
    if (!status.home && status.note) this.toast(status.note);
    const front = this.world.muse.home ? tangentToward(place.dir, this.world.terrain.layout.homeBearing.clone().add(place.dir), new Vector3()) : place.heading;
    const from = front.applyAxisAngle(place.dir, MUSE_VIEW.bearing);
    this.flight.to({ dir: place.dir, ground: place.ground, distance: MUSE_VIEW.distance, height: MUSE_VIEW.height, aim: MUSE_VIEW.aim, from }, R, this.ground);
  }

  goHome(): void {
    if (this.cutaway.active) {
      this.leaveHut(() => this.goHome());
      return;
    }
    this.closeCard();
    const R = this.world.growth.radius;
    const at = this.cottageLocal(HOME_VIEW.at[0], HOME_VIEW.at[2]);
    const from = tangentToward(at, this.fromFront(HOME_VIEW.bearing).add(at), new Vector3());
    const ground = this.world.terrain.cottageGround;
    this.flight.to({ dir: at, ground, distance: HOME_VIEW.distance, height: HOME_VIEW.height, aim: HOME_VIEW.at[1], from }, R, this.ground, () => {
      if (!this.state.status.home) this.toast('Muse is out exploring, and the door is shut. It’ll be back with a basket.');
      else if (!this.museAbout()) this.toast('Muse is out in the meadow, and the door is shut.', 'Find Muse', () => this.findMuse());
      else this.toast('Muse is home. Tap the door to go in.');
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
    if (this.cutaway.active) {
      this.leaveHut(() => this.board(invitationId));
      return;
    }
    const card = this.state.postcards.find((p) => p.id === invitationId);
    if (!card?.invitation) return;
    this.mail.close();
    this.travelSheet.close();
    this.state.useInvitation(invitationId);
    const friend = this.state.snapshot?.friends.find((f) => f.id === card.invitation?.from);
    void this.visit.start(card.invitation, friend?.name ?? 'A friend');
  }

  // ---- toasts ----------------------------------------------------------------------------------

  /** A line at the top for a moment, with an action (it is handed the button's place on screen) if given. */
  toast(text: string, action?: string, onAction?: (from: DOMRect) => void): void {
    this.toastEl.replaceChildren(el('span', '', text));
    if (action && onAction) {
      this.toastEl.append(
        button('', action, '', (e) => {
          const from = (e.currentTarget as HTMLElement).getBoundingClientRect();
          this.toastEl.classList.remove('is-on');
          onAction(from);
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
      /** Into the hut (as a knock on the door, Muse walking in if it is about, else put there; put: put there at once; `doing`: what it does there, else at random), out again, its state, a favourite's card. */
      hut: (doing?: Indoors, put = false) => this.enterHut(doing ?? this.pickIndoors(), !put && this.museAbout()),
      outside: () => this.leaveHut(),
      inHut: () => ({ active: this.cutaway.active, open: this.cutaway.open, shelf: this.cutaway.shelfAmount, loaded: this.world.hut.loaded, favourites: this.favourites.length }),
      favourite: (i: number) => this.openFavourite(i),
      shelf: () => this.cutaway.toShelf(),
      room: () => this.cutaway.fromShelf(),
      editor: this.editor,
      cutaway: this.cutaway,
      placeholder: placeholderSource,
      newest: (): Basket | undefined => this.state.baskets[0],
    };
  }
}
