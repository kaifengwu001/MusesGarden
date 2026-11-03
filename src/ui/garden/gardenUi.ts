import { Box3, Matrix4, PerspectiveCamera, Quaternion, Vector3, Vector4 } from 'three';
import friendFace from '../../assets/garden/friend-face.jpg';
import museFace from '../../assets/garden/muse-face.jpg';
import basketImage from '../../assets/garden/orchard-basket-warm-brown.png';
import { smoothstep } from '../../core/math';
import { layOut, type Bed, type GardenLayout } from '../../garden/placement';
import { placeholderSource, type PlaceholderSource } from '../../garden/placeholder';
import { gardenSource, type GardenSource } from '../../garden/source';
import { GardenState } from '../../garden/state';
import type { Basket, Postcard } from '../../garden/types';
import { FindBeds, heroStance, type BedLook } from '../../life/findBeds';
import { HEADS } from '../../life/flowers';
import { SPECIES_MESH } from '../../life/flowerMeshes';
import { MUSE_HEIGHT, type MuseDirection } from '../../life/muse';
import { POT } from '../../life/museRig';
import type { Indoors, Room } from '../../life/museRoam';
import { Pins, type PinSpec } from '../../life/pins';
import { FLOOR, FRONT, OUTER } from '../../life/props';
import type { ParamStore } from '../../params';
import { angleBetween, tangentToward, travel } from '../../planet/geo';
import { createGroundSample, type Layout } from '../../planet/terrain';
import { sunAt } from '../../render/palette';
import { localSun } from '../../render/sun';
import { warpPoint } from '../../render/warp';
import { Cutaway } from '../../view/cutaway';
import { Flight, type Framing } from '../../view/flight';
import type { World } from '../../world';
import { basketFan, FAN_MAX, freeRect, type Fan } from './basketFan';
import { basketStep, CLOSED, holdsPointer, type BasketEvent, type BasketState, type Effect, type Picked, type Target } from './basketMachine';
import { BasketOverlay, type DayEntry } from './basketOverlay';
import { BasketStage, type Landing, type Pose, type StageFlower } from './basketStage';
import { button, chipNote, el, reducedMotion } from './dom';
import { cardBody, FindCard, topicRgb, type Crossing } from './findCard';
import { paintFlower, worldLight, type Light, type Shape } from './flowerPaint';
import { framingToFit } from './framing';
import { HutEditor } from './hutEditor';
import './garden.css';
import { ICONS } from './icons';
import { Mail } from './mail';
import { MuseSheet } from './musePage';
import { PostBox } from './postbox';
import { dayLabel } from './timeline';
import { boardingUrl, closed, refusal, tripUrl } from './travel';
import { Transit } from '../../visit/transit';

// The garden's interface over the meadow: Muse's finds as patches of flowers
// with their cards, the pins on the globe, the post box with Muse's postcards and
// the tickets to other worlds, and a rail down the right: Muse
// (its page), find Muse, its cottage, the basket. The basket comes out of the
// rail with the day's finds as flowers in it (basketStage.ts, basketOverlay.ts,
// its phases in basketMachine.ts); a flower picked flies home into its patch.
// Tap the hut's door while Muse is about and the cutaway opens the room
// (view/cutaway.ts); a glowing dot on Muse's showpiece turns the camera to it,
// where a white dot on each favourite opens its card as a find's does.
// Everything it shows comes from a GardenSource (garden/source.ts) through
// GardenState. main.ts calls update() before the world moves its camera,
// frame() after, and offers it taps first.

/** How a find is framed: the camera's distance and height over the bed, and where it looks (m). */
const FIND_VIEW = { distance: 7.2, height: 3.1, aim: 1.15 } as const;
/** A card stands this high over its bed (m); higher than this (m) a card is put away. */
const CARD_AT = 1.9;
const CARD_UNDER = 30;
/** The cottage's view (as world.ts's named view): distance, height, bearing from the front (rad), looked-at point (cottage-local x, y, z, m). */
const HOME_VIEW = { distance: 26, height: 11, bearing: 0.92, at: [-1.8, 2.6, 1.4] } as const;
/** Muse's, as the M key frames it (world.ts's MUSE_VIEW): distance and height (m), bearing round from in front of Muse (rad), looked-at height (m). */
const MUSE_VIEW = { distance: 4 * MUSE_HEIGHT, height: 1.23 * MUSE_HEIGHT, bearing: 0.3, aim: 0.55 * MUSE_HEIGHT } as const;
const AT_HOME: MuseDirection = { kind: 'home', busy: false };
const OUT_OF_SIGHT: MuseDirection = { kind: 'hidden' };

/** A tap or the pointer this near a find's sphere (px) picks it; the sphere stands this high over its bed (m). */
const SPHERE = { slop: 16, height: 0.6 } as const;
/** The ground must stand this much nearer (m) than a patch to hide it from the pointer (the terrain under a patch's rim). */
const GROUND_SLACK = 0.1;
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

/** What a press on the planet, outside the hut, can be on. */
type PlanetTarget = { readonly kind: 'pin'; readonly pin: PinSpec } | { readonly kind: 'door' } | { readonly kind: 'find'; readonly bed: Bed };

const sample = createGroundSample();
const tmp = new Vector3();
const tmpLocal = new Vector3();

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
  private readonly card: FindCard;
  private readonly postbox: PostBox;
  private readonly mail: Mail;
  private readonly museSheet: MuseSheet;
  /** The ticket's stamp as you set off, and the way back to a trip under way. */
  private readonly transit: Transit;
  private readonly tripPill: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly portrait: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly basketsButton: HTMLButtonElement;
  private readonly sign: HTMLElement;
  private readonly basketIcon: HTMLImageElement;
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
    this.basketIcon = el('img', 'g-basket-icon');
    this.basketIcon.src = basketImage;
    this.basketIcon.alt = '';
    this.basketIcon.draggable = false;
    this.basketDot = el('span', 'g-dot');
    this.basketsButton.append(this.basketIcon, this.basketDot);
    this.rail.append(this.portrait, find, this.homeButton, this.basketsButton);
    this.root.append(this.rail);

    // the post box
    this.postbox = new PostBox(this.root, () => this.openSheet(() => void this.mail.open()));
    this.transit = new Transit(this.root);
    this.tripPill = el('div', 'g-visit g-trip');
    this.root.append(this.tripPill);
    this.mail = new Mail(this.root, this.state, this.postbox, {
      travel: (id) => void this.board(id),
    });
    this.museSheet = new MuseSheet(this.root, this.state, { muse: museFace, friend: friendFace });

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
    this.postbox.setMail(unread, s.today.length);
    this.basketDot.classList.toggle('is-on', s.freshBasket !== undefined);
    this.whereabouts = '';
    this.refreshWhereabouts();
    if (change === 'snapshot' && s.freshBasket) {
      const fresh = s.freshBasket;
      setTimeout(() => this.toast(`Muse brought you a basket${fresh.title ? `: ${fresh.title}` : ''}`, 'Go and see', () => this.showBasket(fresh.id)), 1800);
    }
    if (change === 'postcards' || change === 'snapshot') this.mail.refresh();
    if (change === 'status' || change === 'snapshot' || change === 'friends') this.refreshTrip();
    if ((change === 'baskets' || change === 'visited' || change === 'snapshot') && holdsPointer(this.basket.phase)) this.showDays();
    if (change === 'interests' || change === 'snapshot' || change === 'status' || change === 'friends') this.museSheet.render();
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
    if (muse) specs.push({ id: 'muse', kind: 'muse', dir: muse.dir, ground: muse.ground });
    this.pins.set(specs);
  }

  /**
   * Where Muse is, in a word: at home (about its hut, as the door has it: MUSE_NEAR), in the meadow (farther off), or
   * out exploring (as the source says). The chip says the source's own words when they say more than that Muse is home
   * (napping, a friend visiting, away at a friend's planet).
   */
  private refreshWhereabouts(): void {
    const w = this.world;
    const s = this.state;
    const word = !s.status.home ? 'out exploring' : this.museAbout() ? 'at home' : 'in the meadow';
    const note = s.status.home && s.statusNote === 'At home' ? word : chipNote(s.statusNote, s.snapshot?.friends.map((f) => f.name) ?? []);
    // (drawn or not decides where its pin stands, so a change of that alone stands the pins again)
    const now = `${word}: ${note}${w.muse.away ? ', unseen' : ''}`;
    if (now === this.whereabouts) return;
    this.whereabouts = now;
    const home = word === 'at home';
    this.portrait.classList.toggle('is-out', !home);
    this.status.replaceChildren(el('i'), note);
    this.sign.classList.toggle('is-on', !home);
    this.homeButton.title = home ? 'Muse’s cottage' : 'Muse’s cottage: Muse is out';
    this.refreshPins();
  }

  // ---- each frame ------------------------------------------------------------------------

  /** Before the world moves: a flight drives the camera, and Muse is told where to be. */
  update(dt: number): void {
    this.flight.update(dt);
    this.cutaway.update(dt);
    const muse = this.cutaway.entering && this.placed ? this.inside() : this.driveMuse ? this.driveMuse(dt) : this.state.status.home ? AT_HOME : OUT_OF_SIGHT;
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
    // Muse's whereabouts as it goes about, and its pin where it is now while it is drawn on the planet
    this.refreshWhereabouts();
    if (!w.muse.away) this.pins.move('muse', w.muse.where.dir, w.muse.where.height);
    // (picked when the pointer moved, or the view moved under it: a flight, a zoom still gliding)
    if (this.pointer && (this.pointerMoved || !w.rig.camera.matrixWorld.equals(this.pickedIn))) this.hover(this.pointer);
    // the basket first: a flower that lands this frame hands over to its patch before the patches' state goes up
    this.stage.frame(dt);
    if (holdsPointer(this.basket.phase)) this.overlay.place(this.stage.layout(), this.fan?.more ?? 0, this.basket.preview);
    this.beds.update(w.rig.altitude, true);
    this.pins.update(dt, true, w.rig.zoom, w.rig.camera, w.warp, w.growth.radius);
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
      // a favourite's card: beside the showpiece, on the side of the screen with more room, while its dot is in view
      const at = this.cutaway.active ? w.hut.slot(this.favourite, tmpLocal) : null;
      const foot = at ? this.projectLocal(at, width, height) : null;
      const shelf = w.shared.uOcclude.value as Vector4;
      const right = 1 - shelf.z >= shelf.x;
      const top = foot ? { x: width * (right ? (1 + shelf.z) / 2 : shelf.x / 2), y: height * SHELF.cardFoot } : null;
      this.card.place(top, dt, width, height);
    } else if (bed) {
      const foot = this.project(bed.dir, bed.ground + 0.35, width, height);
      const at = this.project(bed.dir, bed.ground + CARD_AT, width, height);
      const inView = foot !== null && foot.x > -40 && foot.x < width + 40 && foot.y > -40 && foot.y < height + 40;
      const shown = inView && (w.rig.altitude < CARD_UNDER || this.flight.flying);
      this.card.place(shown ? at : null, dt, width, height);
      // a bed left out of view for a moment, or left far below, closes its card
      const near = w.rig.altitude < CARD_UNDER;
      this.offscreen = (inView && near) || this.flight.flying ? 0 : this.offscreen + dt;
      if (this.offscreen > 0.6 && this.card.shown) this.closeCard();
    } else this.card.place(null, dt, width, height);
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
    const target = this.targetAt(x, y, width, height);
    if (!target) return false;
    if (target.kind === 'door') {
      this.knock();
      return true;
    }
    // a flower still on its way home lands now: what you tapped takes over, as a sheet would
    this.dispatch({ type: 'sheet' });
    if (target.kind === 'find') this.openFind(target.bed.find);
    else if (target.pin.kind === 'muse') this.findMuse();
    else this.openFind(target.pin.id.slice('liked:'.length));
    return true;
  }

  /** Whether a press here is the garden's (a pin, the hut's door, or a find): then the meadow's own click, double-click and hold leave it be. */
  claims(x: number, y: number, width: number, height: number): boolean {
    return this.targetAt(x, y, width, height) !== null;
  }

  /**
   * What on the planet is under a point on the canvas (px), outside the hut: a pin (drawn over everything), else the
   * hut's door or a find, the nearer along the pointer's ray when both are under it.
   */
  private targetAt(x: number, y: number, width: number, height: number): PlanetTarget | null {
    if (this.cutaway.active) return null;
    const pin = this.pins.pick(x, y, width, height, this.world.rig.camera);
    if (pin) return { kind: 'pin', pin };
    const door = this.doorAt(x, y, width, height);
    const find = this.findAt(x, y, width, height);
    if (find && (door === null || find.depth < door)) return { kind: 'find', bed: find.bed };
    return door === null ? null : { kind: 'door' };
  }

  /**
   * The find under a point on the canvas (px), and how far it is from the camera (m): its sphere when the spheres show,
   * else the patch as drawn (its flowers standing up off the ground, a lit hero over them) nearest along the pointer's
   * ray, unless the ground stands in front.
   */
  private findAt(x: number, y: number, width: number, height: number): { bed: Bed; depth: number } | null {
    const w = this.world;
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
      if (!best) return null;
      const sphere = warpPoint(w.warp, tmp.copy(best.dir).multiplyScalar(R + best.ground + SPHERE.height), tmp);
      return { bed: best, depth: sphere.distanceTo(w.rig.camera.position) };
    }
    const ndcX = (x / width) * 2 - 1;
    const ndcY = 1 - (y / height) * 2;
    const camera = w.rig.camera;
    const ray = new Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const patch = this.beds.pick(camera.position, ray, w.warp, w.growth.radius);
    if (!patch) return null;
    const ground = w.pick(ndcX, ndcY);
    if (ground && warpPoint(w.warp, ground.point, tmp).distanceTo(camera.position) < patch.depth - GROUND_SLACK) return null;
    const bed = this.layout.beds.get(patch.find);
    return bed ? { bed, depth: patch.depth } : null;
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
    const target = this.targetAt(at.x, at.y, width, height);
    this.setHovered(target?.kind === 'find' ? target.bed.find : null);
    at.canvas.style.cursor = target ? 'pointer' : '';
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
      if (this.editor?.active) this.editor.close();
      else if (this.mail.isOpen) this.mail.back();
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

  /** Fly to a find's bed and raise its card (its card up, or on its way: left as it is). */
  openFind(id: string, direction: 1 | -1 | 0 = 0): void {
    if (this.cutaway.active) {
      this.leaveHut(() => this.openFind(id, direction));
      return;
    }
    const bed = this.layout.beds.get(id);
    const find = this.state.find(id);
    if (!bed || !find) return;
    if (this.current === id && (this.card.shown === id || this.flight.flying)) return;
    if (this.card.shown) this.card.hide(direction);
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
      day: basket.day,
      index,
      total: basket.finds.length,
      liked: this.state.liked(id),
      shared: this.state.findShared(id),
      crossing: { back: this.crossingOf(id, -1), forward: this.crossingOf(id, 1) },
    });
    this.marks?.open(id);
  }

  /** The basket a step from `id` goes into, if it leaves `id`'s basket. */
  private crossingOf(id: string, direction: 1 | -1): Crossing | null {
    const step = this.state.step(id, direction);
    return step?.into ? { day: step.into, wraps: step.wraps } : null;
  }

  /** The find before (-1, older) or after (1, newer) the one whose card is up, as on the baskets' timeline. */
  private step(direction: 1 | -1): void {
    if (this.favourite >= 0) {
      const n = this.favourites.length;
      if (n > 0) this.openFavourite((this.favourite + direction + n) % n, direction);
      return;
    }
    const next = this.current ? this.state.step(this.current, direction) : null;
    if (next) this.openFind(next.find, direction);
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

  /**
   * Whether a point on the canvas (px) is on the hut's door, seen from in front and big enough to mean it: how far
   * from the camera the pointer's ray meets the door as drawn (m), or null when it is not on it.
   */
  private doorAt(x: number, y: number, width: number, height: number): number | null {
    const corners: Array<{ x: number; y: number }> = [];
    for (const [cx, cy] of [
      [DOOR.x0, DOOR.y0],
      [DOOR.x1, DOOR.y0],
      [DOOR.x1, DOOR.y1],
      [DOOR.x0, DOOR.y1],
    ]) {
      const p = this.projectLocal(tmpLocal.set(cx, cy, DOOR.z), width, height);
      if (!p) return null;
      corners.push(p);
    }
    const c = this.cutaway;
    const camera = this.world.rig.camera;
    const mid = c.local((DOOR.x0 + DOOR.x1) / 2, (DOOR.y0 + DOOR.y1) / 2, DOOR.z, new Vector3());
    const out = c.local((DOOR.x0 + DOOR.x1) / 2, (DOOR.y0 + DOOR.y1) / 2, DOOR.z + 1, new Vector3()).sub(mid);
    if (out.dot(tmp.copy(camera.position).sub(mid)) <= 0) return null;
    // its area on screen (the shoelace), and the point inside its outline (same side of every edge)
    let area = 0;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      area += a.x * b.y - b.x * a.y;
      const side = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
      if (side !== 0 && sign !== 0 && side !== sign) return null;
      if (side !== 0) sign = side;
    }
    if (Math.abs(area) / 2 <= 90) return null;
    // the door's face through the warp (three of its corners), met by the ray
    const [a, b, d] = [
      [DOOR.x0, DOOR.y0],
      [DOOR.x1, DOOR.y0],
      [DOOR.x0, DOOR.y1],
    ].map(([cx, cy]) => warpPoint(this.world.warp, c.local(cx, cy, DOOR.z, new Vector3()), new Vector3()));
    const normal = b.sub(a).cross(d.sub(a));
    const ray = new Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    return normal.dot(a.sub(camera.position)) / normal.dot(ray);
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
    // (a flower still on its way home lands now, as a sheet would)
    this.dispatch({ type: 'sheet' });
    this.flight.cancel();
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
        from: 'Muse’s favourites',
        day: this.state.basket(find.basket)?.day ?? '',
        index: i,
        total: this.favourites.length,
        liked: this.state.liked(id),
        shared: this.state.findShared(id),
        crossing: { back: null, forward: null },
      });
    };
    if (wasUp) setTimeout(show, 240);
    else show();
  }

  // ---- the basket ------------------------------------------------------------------------

  /** The rail's basket: out on the freshest basket not opened yet (else the newest), or back in; out of the hut first. */
  private railBasket(): void {
    if (this.cutaway.active) {
      this.leaveHut(() => this.railBasket());
      return;
    }
    const basket = this.state.freshBasket ?? this.state.baskets[0];
    if (!basket && this.basket.phase.kind === 'closed') {
      this.toast('No basket yet: Muse brings one home after a day out.');
      return;
    }
    this.dispatch({ type: 'rail', basket: basket?.id ?? '' });
  }

  /** Out on this day's basket (a toast's "Go and see"), out of the hut first. */
  private showBasket(id: string): void {
    if (this.cutaway.active) {
      this.leaveHut(() => this.showBasket(id));
      return;
    }
    this.dispatch({ type: 'show', basket: id });
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

  /** Where the basket is in the rail: its icon, the same picture the stage draws. */
  private railRect(): DOMRect {
    return this.basketIcon.getBoundingClientRect();
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
      this.toast(this.state.statusNote);
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
    // (a stand-in for the backend's status, for the probe: see what the garden does when Muse is out)
    const source = this.source as Partial<PlaceholderSource>;
    const status = home ? { home: true, note: 'At home' } : { home: false, note: 'Out exploring' };
    if (source.push) source.push({ type: 'status', status });
    else this.state.receive({ type: 'status', status });
  }

  // ---- travel ----------------------------------------------------------------------------------

  /**
   * Board on a ticket: the backend is asked first, and only once it has taken the ticket does the stamp come down
   * and the page go to the host's planet (src/visit/). Turned down, or out of reach, you stay home and are told why.
   */
  private async board(invitationId: string): Promise<void> {
    if (this.cutaway.active) {
      this.leaveHut(() => void this.board(invitationId));
      return;
    }
    const card = this.state.postcards.find((p) => p.id === invitationId);
    if (!card?.invitation) return;
    // (a planet not open to visits yet: the ticket stays unused, and you stay home)
    const shut = closed(card.invitation);
    if (shut) {
      this.toast(shut);
      return;
    }
    const to = boardingUrl(invitationId, card.invitation, location.search);
    if (!to) {
      this.toast('Other worlds open to visits once your garden is connected to Muse.');
      return;
    }
    try {
      await this.state.useInvitation(invitationId);
    } catch (error) {
      // (the post stays open, the ticket back in it)
      this.toast(refusal(error));
      return;
    }
    this.mail.close();
    this.closeCard();
    this.dispatch({ type: 'sheet' });
    await this.transit.leave(card.invitation.worldName, card.invitation.fromName);
    location.assign(to);
  }

  /** While a trip is under way (the backend's status says so), the way back to it. */
  private refreshTrip(): void {
    const trip = this.state.status.trip;
    const to = trip ? tripUrl(trip, location.search) : null;
    this.tripPill.classList.toggle('is-on', to !== null);
    if (!trip || !to) return;
    const host = this.state.snapshot?.friends.find((f) => f.id === trip.host)?.name ?? 'your friend';
    this.tripPill.replaceChildren(
      el('span', 'g-visit-where', `On a trip to ${host}’s planet`),
      button('g-visit-home', `Back to ${host}’s planet`, `${ICONS.globe}<span>Back to ${host}’s planet</span>`, () => location.assign(to)),
    );
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
      basket: (id?: string) => this.showBasket(id ?? this.state.freshBasket?.id ?? this.state.baskets[0]?.id ?? ''),
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
