import { Vector3 } from 'three';
import museFace from '../assets/garden/muse-face.jpg';
import { faceOf } from '../ui/garden/faces';
import '../ui/garden/garden.css';
import './visit.css';
import { mediaOf } from '../garden/media';
import type { Basket, Find, Interest } from '../garden/types';
import type { PlanetId, VisitPlant, VisitWorldView } from '../muse/contract';
import { salt, unit } from '../core/hash';
import { angleBetween, slerpUnit, tangentToward, travel } from '../planet/geo';
import { warpPoint } from '../render/warp';
import { button, el, wait } from '../ui/garden/dom';
import { FindCard } from '../ui/garden/findCard';
import { ICONS } from '../ui/garden/icons';
import { Flight, type Framing } from '../view/flight';
import { loadVisit, planetOf, returnFromVisit, type VisitLoad } from './api';
import { FOLLOW, Follower } from './follow';
import { homeUrl, leftPhrase, readVisit, visitable, visitUrl, type VisitParams } from './params';
import { moved, snapBeds, type SnapBed } from './snap';
import { Transit } from './transit';
import type { VisitBody, VisitWorld } from './world';

// A visit on a ticket, on the host's own planet: `?visit=<ticket>&as=<guest>&garden=<base>` in place of the garden.
// The host's finds grow as beds where it found them, its public ones open their cards; the host lives its own life at
// home, and the guest's Muse keeps it company while the two are together; a banner says whose planet this is, how
// long is left, and the way home. A rail where the garden's is (the garden's own buttons and look) has the guest's
// Muse with where it is, a button to find the two Muses and one to the host's home; none of the garden's basket, post
// or tickets, which are the guest's own at home. The world's main.ts calls prepareVisit before it makes its World, then uses a
// VisitUi in place of its GardenUi: update() before the world moves, frame() after, tap() first, interrupt() on any
// move of the camera.

/** How often the visit is read again (ms): the two set off together, or it ended. */
const POLL_MS = 30_000;
/** How long the ended screen stays before going home on its own (ms). */
const ENDED_MS = 4_000;
/** A find's framing (as the garden's): the camera's distance and height over the bed, and where it looks (m). */
const FIND_VIEW = { distance: 7.2, height: 3.1, aim: 1.15 } as const;
/**
 * The two Muses' framing, side on to the pair (visitUi.frameMuses): the camera at least this far off and this high
 * (m), farther and higher in step where it needs the room for both, looking this high over their ground (m).
 */
const MUSES_VIEW = { distance: 6.2, height: 1.9, aim: 0.8 } as const;
/** Room left across the view on each side of the two Muses (m). */
const MUSES_ROOM = 1.1;
/** How many places on the way from the camera to the two are looked at for what stands in it, and how near a house's middle (m) is in its walls. */
const SIGHT_SAMPLES = 8;
const HOUSE_REACH = 6;
/** How much the side the host faces counts toward the camera's side, against open places (of SIGHT_SAMPLES): its face over a little more room. */
const FACING = 3;
/** The host's house as the camera comes to it, where the world has no view of its own (visitUi.goToHostHome). */
const HOME_VIEW = { distance: 16, height: 6, aim: 1.5 } as const;
/** A friend's garden round its home on its own planet (visitUi.gardenPlaces): its nearest find this far from the house's middle (m), past its walls, and each next one farther by this times the square root of its place (m). */
const GARDEN_FROM = 9;
const GARDEN_STEP = 3;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Where the card stands over its bed (m), and above which height (m) it is put away. */
const CARD_AT = 1.9;
const CARD_UNDER = 30;

/** What prepareVisit hands the page: the visit its URL names, as the server answered. */
export interface VisitStart {
  readonly params: VisitParams;
  readonly load: VisitLoad;
}

/** The parameter store as a visit sets it: the planet's seed and growth. */
export interface VisitStore {
  set(path: 'world.seed' | 'world.growth', value: number): void;
  flush(): void;
}

/**
 * Before the page makes its World: the visit its URL names, if any, read from the server, and the planet's seed and
 * growth set to the host's, so the world's own planet never shows first. A visit to another planet goes there (and
 * this resolves never, as the page leaves), unless that planet isn't open to visits: then the VisitUi says so. Null
 * when the URL names no visit.
 */
export async function prepareVisit(store: VisitStore, planet: PlanetId, search: string = location.search): Promise<VisitStart | null> {
  const params = readVisit(search);
  if (!params) return null;
  const load = await loadVisit(params);
  if (load.kind === 'open') {
    if (load.view.planet !== planet) {
      if (!visitable(load.view.planet)) return { params, load };
      location.replace(visitUrl(load.view.planet, params));
      return new Promise<never>(() => undefined);
    }
    store.set('world.seed', load.view.worldSeed);
    store.set('world.growth', load.view.g);
    store.flush();
  }
  return { params, load };
}

/** On the visit; over; out of reach; or the host's planet isn't open to visits (no page for it takes them yet). */
type Phase = 'visiting' | 'ended' | 'unreachable' | 'closed';

export class VisitUi {
  private readonly root: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly where: HTMLElement;
  private readonly left: HTMLElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly rail: HTMLElement;
  private readonly portrait: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly hostHome: HTMLButtonElement;
  private statusNote = '';
  private readonly card: FindCard;
  private readonly transit: Transit;
  private readonly flight: Flight;
  private readonly follower = new Follower();
  private readonly params: VisitParams;
  private view: VisitWorldView | null;
  private phase: Phase;
  /** The server's clock at the last read, and the page's then (ms): the countdown runs on from there. */
  private synced = { at: 0, wall: 0 };
  private guest: VisitBody | null = null;
  private guestShown = false;
  private plants = new Map<string, VisitPlant>();
  private placed: ReadonlyMap<string, SnapBed> = new Map();
  private laidOut: ReadonlyMap<string, SnapBed> = new Map();
  private laidFor: { radius: number; shape: object | null } = { radius: 0, shape: null };
  private relayoutAt = 0;
  private current: string | null = null;
  private offscreen = 0;
  private polling = false;
  private home: string | null = null;
  private leaving = false;
  private markReady: () => void = () => undefined;
  readonly ready: Promise<void>;

  constructor(
    parent: HTMLElement,
    private readonly world: VisitWorld,
    start: VisitStart,
  ) {
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    this.params = start.params;
    this.view = start.load.kind === 'open' ? start.load.view : null;
    this.phase = start.load.kind === 'open' ? 'visiting' : start.load.kind;
    this.root = el('div', 'garden visit');
    parent.append(this.root);
    document.body.classList.add('is-visiting');
    this.flight = new Flight(world.scene.rig);
    this.card = new FindCard(this.root, {
      // (a friend's find: nothing to like or keep private here)
      like: () => undefined,
      share: () => undefined,
      step: (d) => this.step(d),
      close: () => this.closeCard(),
    });
    this.banner = el('div', 'g-visit visit-banner');
    this.where = el('span', 'g-visit-where');
    this.left = el('span', 'g-visit-who visit-left');
    this.homeButton = button('g-visit-home', 'Return home', `${ICONS.house}<span>Return home</span>`, () => void this.goHome(true));
    this.banner.append(this.where, this.left, this.homeButton);
    this.root.append(this.banner);
    // the rail: the guest's Muse and where it is, the two Muses, the host's home
    this.rail = el('nav', 'g-rail visit-rail');
    this.rail.setAttribute('aria-label', 'Visit');
    this.portrait = button('g-portrait', 'Your Muse', '', () => this.frameMuses());
    this.portrait.style.backgroundImage = `url(${museFace})`;
    this.status = el('span', 'g-status');
    this.portrait.append(this.status);
    const find = button('g-railbtn', 'Find Muse', ICONS.find, () => this.frameMuses());
    find.dataset.label = 'Find Muse';
    this.hostHome = button('g-railbtn', 'Home', ICONS.house, () => this.goToHostHome());
    this.rail.append(this.portrait, find, this.hostHome);
    this.root.append(this.rail);
    this.transit = new Transit(this.root);
    if (import.meta.env.DEV || import.meta.env.VITE_PROBE) this.installProbe();

    if (this.view && this.view.planet !== world.planet) void this.stop('closed');
    else if (this.view) this.begin(this.view);
    else void this.stop(this.phase === 'ended' ? 'ended' : 'unreachable');
  }

  // ---- the visit ---------------------------------------------------------------------------

  private begin(view: VisitWorldView): void {
    this.sync(view);
    this.world.dressHost(view.host.look);
    this.guest = this.world.makeGuest(view.guest.look);
    this.plants = new Map(view.plants.map((p) => [p.id as string, p]));
    this.home = homeUrl(view.guest.planet, this.params);
    this.where.textContent = `Visiting ${view.host.name}’s planet`;
    this.banner.classList.add('is-on');
    // the guest's own face, by the body it wears
    this.portrait.style.backgroundImage = `url(${faceOf(view.guest.look) ?? museFace})`;
    this.portrait.dataset.label = view.guest.name;
    this.portrait.setAttribute('aria-label', view.guest.name);
    this.portrait.title = view.guest.name;
    const home = `${view.host.name}’s home`;
    this.hostHome.dataset.label = home;
    this.hostHome.setAttribute('aria-label', home);
    this.hostHome.title = home;
    this.showStatus(view);
    this.rail.classList.add('is-on');
    const timer = window.setInterval(() => void this.poll(), POLL_MS);
    window.addEventListener('pagehide', () => window.clearInterval(timer));
    void Promise.all([this.world.host.ready, this.guest.ready]).then(async () => {
      // (the beds wait for the planet's ground: laid out in the first frame)
      while (this.laidFor.shape === null) await wait(50);
      if (this.phase !== 'visiting') return;
      if (!/(^|[#&])pose=/.test(location.hash)) this.frameMuses();
      this.markReady();
    });
  }

  private sync(view: VisitWorldView): void {
    this.view = view;
    this.synced = { at: view.now, wall: performance.now() };
    if (this.phase === 'visiting') this.showStatus(view);
  }

  /** Under the guest's Muse on the rail: visiting, once the two are together; on the way, while one still works. */
  private showStatus(view: VisitWorldView): void {
    const note = view.together ? `Visiting ${view.host.name}’s planet` : `${view.guest.name} is on the way`;
    if (note === this.statusNote) return;
    this.statusNote = note;
    this.status.replaceChildren(el('i'), note);
    this.portrait.classList.toggle('is-out', !view.together);
  }

  /** The server's clock now, as last read and run on since (ms). */
  private now(): number {
    return this.synced.at + performance.now() - this.synced.wall;
  }

  /** Read the visit again: the two may have set off together, or the visit ended. */
  private async poll(): Promise<void> {
    if (this.polling || this.phase !== 'visiting') return;
    this.polling = true;
    const load = await loadVisit(this.params);
    this.polling = false;
    if (load.kind === 'open') this.sync(load.view);
    else if (load.kind === 'ended') await this.stop('ended');
  }

  /**
   * The visit is over, out of reach, or its planet isn't open: a word, and the way home, taken on its own once it
   * ended. Going home from a planet that isn't open ends the trip, which can't be taken there.
   */
  private async stop(phase: Exclude<Phase, 'visiting'>): Promise<void> {
    if (this.leaving) return;
    this.phase = phase;
    this.banner.classList.remove('is-on');
    this.rail.classList.remove('is-on');
    this.closeCard();
    this.home ??= homeUrl(this.view?.guest.planet ?? (await planetOf(this.params)) ?? 'meadow', this.params);
    const panel = el('div', 'visit-ended');
    const name = this.view ? `${this.view.host.name}’s planet` : 'Your friend’s planet';
    const words: Readonly<Record<typeof phase, readonly [string, string]>> = {
      ended: ['Your visit has ended', 'You’re on your way home.'],
      unreachable: [`${name} can’t be reached just now`, 'You can go home, and try the ticket again later.'],
      closed: [`${name} isn’t open for visits yet`, 'You can go home, and visit once it opens.'],
    };
    panel.append(
      el('h2', 'visit-ended-title', words[phase][0]),
      el('p', 'visit-ended-note', words[phase][1]),
      button('g-visit-home', 'Return home', `${ICONS.house}<span>Return home</span>`, () => void this.goHome(phase === 'closed')),
    );
    this.root.append(panel);
    requestAnimationFrame(() => panel.classList.add('is-on'));
    this.markReady();
    if (phase === 'ended') window.setTimeout(() => void this.goHome(false), ENDED_MS);
  }

  /** Home: the trip ends on the server first, when it is still on; then the ticket's stamp, and the guest's own planet. */
  private async goHome(returning: boolean): Promise<void> {
    if (this.leaving || !this.home) return;
    this.leaving = true;
    this.homeButton.disabled = true;
    if (returning) await returnFromVisit(this.params);
    this.banner.classList.remove('is-on');
    await this.transit.home();
    location.assign(this.home);
  }

  // ---- each frame ------------------------------------------------------------------------------

  /** Before the world moves: a flight drives the camera, and the two Muses are told what to do. */
  update(dt: number): void {
    this.flight.update(dt);
    this.world.hideOthers();
    const view = this.view;
    if (!view || this.phase !== 'visiting') return;
    const host = this.world.host;
    host.direct({ kind: 'home', busy: view.host.working });
    if (!this.guest) return;
    this.guestShown = view.together;
    if (!view.together) {
      this.follower.reset();
      this.guest.direct({ kind: 'hidden' });
      return;
    }
    const f = this.follower.step(host.where, dt, this.world.scene.growth.radius, (dir) => this.world.ground(dir).water > FOLLOW.dry && (this.world.standable?.(dir) ?? true));
    this.guest.direct({ kind: 'out', dir: f.dir, toward: f.toward, walk: f.walk, busy: view.guest.working });
  }

  /** After the world's update: the beds, the card over its bed, the time left. */
  frame(dt: number): void {
    const s = this.world.scene;
    const t = performance.now();
    if (this.view && t > this.relayoutAt && (s.growth.radius !== this.laidFor.radius || this.world.shape() !== this.laidFor.shape)) {
      // (while the planet grows, at most twice a second)
      this.relayoutAt = t + 500;
      this.relayout();
    }
    this.world.marks.update(s.rig.altitude);
    this.placeCard(dt);
    if (this.view && this.phase === 'visiting') {
      const left = this.view.until - this.now();
      const phrase = leftPhrase(left);
      if (this.left.textContent !== phrase) this.left.textContent = phrase;
      if (left <= 0) void this.poll();
    }
  }

  /** Lay the host's finds out on this planet: round its home, the world's own layout, then off the water, then as beds. */
  private relayout(): void {
    const view = this.view;
    if (!view) return;
    const radius = this.world.scene.growth.radius;
    this.laidFor = { radius, shape: this.world.shape() };
    const basket: Basket = { id: 'visit', day: '', finds: view.plants.map((p) => p.id) };
    const at = this.gardenPlaces(view, radius);
    this.laidOut = this.world.layOut([basket], view.plants.map((p) => this.findOf(p, at.get(p.id as string))));
    this.placed = snapBeds(this.laidOut, radius, (dir) => this.world.ground(dir));
    // (one public find has nowhere to step to)
    this.root.classList.toggle('is-single', this.publicIds.length < 2);
    this.world.marks.set(
      [...this.placed.values()].flatMap((bed) => {
        const plant = this.plants.get(bed.find);
        return plant ? [{ bed, species: plant.bed.species, variant: plant.bed.variant, topic: this.topicOf(plant) }] : [];
      }),
      radius,
    );
  }

  private placeCard(dt: number): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const bed = this.current ? this.placed.get(this.current) : undefined;
    if (!bed) {
      this.card.place(null, dt, width, height);
      return;
    }
    const foot = this.project(bed.dir, bed.ground + 0.35, width, height);
    const at = this.project(bed.dir, bed.ground + CARD_AT, width, height);
    const inView = foot !== null && foot.x > -40 && foot.x < width + 40 && foot.y > -40 && foot.y < height + 40;
    const near = this.world.scene.rig.altitude < CARD_UNDER;
    this.card.place(inView && (near || this.flight.flying) ? at : null, dt, width, height);
    // a bed left out of view for a moment, or left far below, closes its card
    this.offscreen = (inView && near) || this.flight.flying ? 0 : this.offscreen + dt;
    if (this.offscreen > 0.6 && this.card.shown) this.closeCard();
  }

  private project(dir: Vector3, height: number, width: number, h: number): { x: number; y: number } | null {
    const s = this.world.scene;
    const p = dir.clone().multiplyScalar(s.growth.radius + height);
    warpPoint(s.warp, p, p);
    p.project(s.rig.camera);
    if (p.z < -1 || p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * h };
  }

  // ---- input -------------------------------------------------------------------------------------

  /** A tap on the canvas: a public find's bed opens its card. True when the visit took it. */
  tap(x: number, y: number, width: number, height: number): boolean {
    if (this.phase !== 'visiting') return false;
    const hit = this.world.scene.pick((x / width) * 2 - 1, 1 - (y / height) * 2);
    const bed = hit ? this.world.bedAt(this.placed, hit.dir) : null;
    if (!bed || !this.plants.get(bed.find)?.card) return false;
    this.openFind(bed.find);
    return true;
  }

  /** You took the camera (a drag, the wheel, a key): any flight ends there. */
  interrupt(): void {
    this.flight.cancel();
  }

  // ---- finds -------------------------------------------------------------------------------------

  private ground = (dir: Vector3): number => this.world.ground(dir).height;

  /** The public finds, in the order the visit lists them: the ones a card opens for. */
  private get publicIds(): string[] {
    return [...this.plants.values()].filter((p) => p.card && this.placed.has(p.id)).map((p) => p.id);
  }

  /** Fly to a public find's bed and raise its card. */
  openFind(id: string): void {
    const bed = this.placed.get(id);
    if (!bed || !this.plants.get(id)?.card) return;
    this.interrupt();
    if (this.card.shown) this.card.hide(0);
    this.world.marks.open(null);
    this.current = id;
    this.flight.to({ dir: bed.dir, ground: bed.ground, ...FIND_VIEW }, this.world.scene.growth.radius, this.ground, () => this.raise(id));
  }

  private raise(id: string): void {
    const plant = this.plants.get(id);
    const ids = this.publicIds;
    if (!plant?.card || this.current !== id || !this.view) return;
    const find = this.findOf(plant);
    const interest: Interest = { id: find.topic, name: find.topic.replace(/_/g, ' '), ...plant.bed, shared: true, since: '' };
    this.card.show(find, interest, {
      day: '',
      from: `${this.view.host.name}’s garden`,
      index: ids.indexOf(id),
      total: ids.length,
      liked: false,
      shared: true,
      crossing: { back: null, forward: null },
    });
    this.world.marks.open(id);
  }

  private step(direction: 1 | -1): void {
    const ids = this.publicIds;
    if (!this.current || ids.length === 0) return;
    this.openFind(ids[(ids.indexOf(this.current) + direction + ids.length) % ids.length]);
  }

  private closeCard(): void {
    this.card.hide(0);
    this.world.marks.open(null);
    this.current = null;
  }

  /**
   * Where the host's finds grow here. On the meadow, where they were found (its places are the meadow's own). On any
   * other planet a find's place is the meadow's, nowhere in particular there, so the host's garden is laid round its
   * home instead: a spiral out from GARDEN_FROM m, past its walls, one find a turn of the golden angle, each a little
   * farther, so the two Muses at the house have it all about them and it is in view from the house.
   */
  private gardenPlaces(view: VisitWorldView, radius: number): ReadonlyMap<string, Vector3> {
    const out = new Map<string, Vector3>();
    if (this.world.planet === 'meadow') return out;
    const layout = this.world.shape() as { readonly cottage?: unknown };
    const home = layout.cottage instanceof Vector3 ? layout.cottage.clone().normalize() : this.world.host.where.dir.clone();
    const north = tangentToward(home, new Vector3(0, 1, 0), new Vector3());
    const east = new Vector3().crossVectors(home, north).normalize();
    const turn = unit(salt(`garden|${view.host.museId}`)) * Math.PI * 2;
    // public finds nearest the house, then in a fixed order
    const order = [...view.plants].sort((a, b) => Number(b.card !== null) - Number(a.card !== null) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const t = new Vector3();
    order.forEach((plant, k) => {
      const a = turn + k * GOLDEN_ANGLE;
      t.copy(north).multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
      out.set(plant.id, travel(home, t, (GARDEN_FROM + GARDEN_STEP * Math.sqrt(k)) / radius, new Vector3()));
    });
    return out;
  }

  /** A plant as the garden's cards and the world's layout take a find (at `place`, else where it was found): a public one as its card shows it. */
  private findOf(plant: VisitPlant, place?: Vector3): Find {
    const card = plant.card;
    const base = { id: plant.id, basket: 'visit', topic: this.topicOf(plant), place: place ? ([place.x, place.y, place.z] as const) : plant.dir, shared: card !== null };
    if (!card) return { ...base, media: { kind: 'post', url: '', source: '' } };
    return { ...base, media: mediaOf(card), note: card.reason };
  }

  private topicOf(plant: VisitPlant): string {
    return plant.card?.pursuing ?? plant.card?.title ?? plant.id;
  }

  // ---- the camera ----------------------------------------------------------------------------------

  /**
   * To the two Muses (on arriving, and whenever asked again): side on to them, both in the view, from the side with
   * open sight to them, never in toward the house. With no guest beside the host, the world's own view of its Muse
   * where it has one (it knows its home's walls), else from in front of the host.
   */
  frameMuses(): void {
    const framing = this.musesFraming();
    if (framing === null && this.world.scene.frameMuse) {
      this.interrupt();
      this.world.scene.frameMuse();
      return;
    }
    this.flight.to(framing ?? this.hostFraming(), this.world.scene.growth.radius, this.ground);
  }

  /** To the host's home: the world's own view of it where it has one, else from out in front of its house. */
  goToHostHome(): void {
    this.interrupt();
    if (this.world.frameHome) {
      this.world.frameHome();
      return;
    }
    // (every world's layout names its cottage and the way it faces; without them, wherever the host is)
    const layout = this.world.shape() as { readonly cottage?: unknown; readonly homeBearing?: unknown };
    const house = layout.cottage instanceof Vector3 ? layout.cottage.clone().normalize() : this.world.host.where.dir.clone();
    const from = layout.homeBearing instanceof Vector3 ? layout.homeBearing.clone() : undefined;
    this.flight.to({ dir: house, ground: this.world.ground(house).height, ...HOME_VIEW, from }, this.world.scene.growth.radius, this.ground);
  }

  /** The host alone, from in front of it. */
  private hostFraming(): Framing {
    const host = this.world.host.where;
    return { dir: host.dir.clone(), ground: host.height, ...(this.world.musesView ?? MUSES_VIEW), from: host.heading.clone() };
  }

  /**
   * The two Muses side on: from across the line between them, at their middle, far enough back that both fit across
   * the view with room to spare (the world's own musesView, or MUSES_VIEW, at least; higher in step, so it looks down
   * as steeply; and higher by as much as the camera's own ground rises above theirs, so it never stands down in what
   * grows on a slope), from the side with more open ground between the camera and the two (no rise of the ground,
   * wall in the way, never in toward the house) and toward the side the host faces. Null with no guest beside the host.
   */
  private musesFraming(): Framing | null {
    const base = this.world.musesView ?? MUSES_VIEW;
    const R = this.world.scene.growth.radius;
    const host = this.world.host.where;
    const guest = this.guest && this.guestShown ? this.guest.where : null;
    const apart = guest ? angleBetween(host.dir, guest.dir) * R : 0;
    if (!guest || apart < 0.3) return null;
    const middle = slerpUnit(host.dir, guest.dir, 0.5, new Vector3());
    const along = tangentToward(middle, guest.dir, new Vector3());
    const across = new Vector3().crossVectors(middle, along).normalize();
    // (the view's half width at the height it comes down to, as the rig opens its lens there)
    const rig = this.world.scene.rig;
    const fov = (rig.framing(rig.zoomForAltitude(base.height)).fov * Math.PI) / 180;
    const halfWidth = Math.atan(Math.tan(fov / 2) * rig.camera.aspect);
    const distance = Math.max(base.distance, (apart / 2 + MUSES_ROOM) / Math.tan(halfWidth));
    const scale = distance / base.distance;
    const framing = { dir: middle, ground: (host.height + guest.height) / 2, distance, height: base.height * scale, aim: base.aim };
    const sides = [across, across.clone().negate()];
    // (a side whose way runs in toward the house, through it or to a camera in it, is no side: of two opposite ways
    // from the two, at most one runs in toward it)
    const scores = sides.map((side) => {
      const open = this.openness(framing, side);
      return open < 0 ? -Infinity : open + FACING * side.dot(host.heading);
    });
    const from = scores[1] > scores[0] ? sides[1] : sides[0];
    const camera = travel(middle, from, distance / R, new Vector3());
    const rise = Math.max(0, this.world.ground(camera).height - framing.ground);
    return { ...framing, height: framing.height + rise, from };
  }

  /**
   * How open the way is from a framing's camera, on one side, to the two Muses: of the places along it, how many have
   * nothing in the line of sight (the ground below it, no wall where a Muse may not stand); -1 when the way runs in
   * toward the house (a place on it within HOUSE_REACH of the house and nearer it than the two stand, who may well be
   * on its own deck or terrace), so the camera neither looks through it nor stands in it.
   */
  private openness(f: Omit<Framing, 'from'>, side: Vector3): number {
    const R = this.world.scene.growth.radius;
    // (every world's layout names its cottage: its house stands about it)
    const cottage = (this.world.shape() as { readonly cottage?: unknown }).cottage;
    const house = cottage instanceof Vector3 ? cottage : null;
    const theirs = house ? angleBetween(f.dir, house) * R : 0;
    const p = new Vector3();
    let open = 0;
    for (let k = 1; k <= SIGHT_SAMPLES; k++) {
      const u = k / SIGHT_SAMPLES;
      travel(f.dir, side, (f.distance * u) / R, p);
      if (house) {
        const d = angleBetween(p, house) * R;
        if (d < HOUSE_REACH && d < theirs) return -1;
      }
      const sight = f.ground + f.aim + (f.height - f.aim) * u;
      if (this.world.ground(p).height > sight - 0.25) continue;
      if (this.world.standable && !this.world.standable(p)) continue;
      open++;
    }
    return open;
  }

  // ---- the dev harness -------------------------------------------------------------------------------

  private installProbe(): void {
    (window as unknown as { __visit: unknown }).__visit = {
      ready: this.ready,
      state: () => this.state(),
      frameMuses: () => this.frameMuses(),
      home: () => this.goToHostHome(),
      open: (id: string) => this.openFind(id),
      flying: () => this.flight.flying,
      poll: () => this.poll(),
    };
  }

  /** What the visit is doing, for checks: its phase, the two Muses, every plant and where it grows. */
  state(): object {
    const view = this.view;
    const R = this.world.scene.growth.radius;
    const host = this.world.host.where;
    const guest = this.guest?.where;
    const shift = moved(this.laidOut, this.placed, R);
    const xyz = (v: Vector3) => [v.x, v.y, v.z];
    return {
      phase: this.phase,
      planet: this.world.planet,
      invitation: this.params.invitation,
      together: view?.together ?? false,
      left: view ? view.until - this.now() : null,
      banner: this.banner.classList.contains('is-on') ? this.banner.innerText.replace(/\s+/g, ' ').trim() : null,
      ended: this.root.querySelector('.visit-ended')?.textContent ?? null,
      home: this.home,
      host: view && { museId: view.host.museId, look: view.host.look, working: view.host.working, dir: xyz(host.dir) },
      guest: view && {
        museId: view.guest.museId,
        look: view.guest.look,
        shown: this.guestShown,
        dir: guest ? xyz(guest.dir) : null,
        apart: guest ? host.dir.angleTo(guest.dir) * R : null,
      },
      plants: [...this.plants.values()].map((p) => {
        const bed = this.placed.get(p.id);
        return {
          id: p.id,
          public: p.card !== null,
          placed: bed !== undefined,
          dir: bed ? xyz(bed.dir) : null,
          water: bed ? this.world.ground(bed.dir).water : null,
          moved: shift.get(p.id) ?? null,
        };
      }),
      card: this.card.shown,
    };
  }
}
