import type { Vector3 } from 'three';
import '../ui/garden/garden.css';
import './visit.css';
import { mediaOf } from '../garden/media';
import type { Basket, Find, Interest } from '../garden/types';
import type { PlanetId, VisitPlant, VisitWorldView } from '../muse/contract';
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
// long is left, and the way home. The world's main.ts calls prepareVisit before it makes its World, then uses a
// VisitUi in place of its GardenUi: update() before the world moves, frame() after, tap() first, interrupt() on any
// move of the camera.

/** How often the visit is read again (ms): the two set off together, or it ended. */
const POLL_MS = 30_000;
/** How long the ended screen stays before going home on its own (ms). */
const ENDED_MS = 4_000;
/** A find's framing (as the garden's): the camera's distance and height over the bed, and where it looks (m). */
const FIND_VIEW = { distance: 7.2, height: 3.1, aim: 1.15 } as const;
/** The two Muses' framing, from in front of the host, the guest at its side. */
const MUSES_VIEW = { distance: 6.2, height: 1.9, aim: 0.8 } as const;
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

  /** Lay the host's finds out on this planet: the world's own layout, then off the water, then as beds. */
  private relayout(): void {
    const view = this.view;
    if (!view) return;
    const radius = this.world.scene.growth.radius;
    this.laidFor = { radius, shape: this.world.shape() };
    const basket: Basket = { id: 'visit', day: '', finds: view.plants.map((p) => p.id) };
    this.laidOut = this.world.layOut([basket], view.plants.map((p) => this.findOf(p)));
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

  /** A plant as the garden's cards and the world's layout take a find: a public one as its card shows it. */
  private findOf(plant: VisitPlant): Find {
    const card = plant.card;
    const base = { id: plant.id, basket: 'visit', topic: this.topicOf(plant), place: plant.dir, shared: card !== null };
    if (!card) return { ...base, media: { kind: 'post', url: '', source: '' } };
    return { ...base, media: mediaOf(card), note: card.reason };
  }

  private topicOf(plant: VisitPlant): string {
    return plant.card?.pursuing ?? plant.card?.title ?? plant.id;
  }

  // ---- the camera ----------------------------------------------------------------------------------

  /** Fly to the two Muses: from in front of the host, the guest at its side. */
  frameMuses(): void {
    const where = this.world.host.where;
    const framing: Framing = { dir: where.dir.clone(), ground: where.height, ...MUSES_VIEW, from: where.heading.clone() };
    this.flight.to(framing, this.world.scene.growth.radius, this.ground);
  }

  // ---- the dev harness -------------------------------------------------------------------------------

  private installProbe(): void {
    (window as unknown as { __visit: unknown }).__visit = {
      ready: this.ready,
      state: () => this.state(),
      frameMuses: () => this.frameMuses(),
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
