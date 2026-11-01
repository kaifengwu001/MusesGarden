import { worldArt } from '../../../../src/garden/art';
import type { GardenState } from '../../garden/state';
import type { Invitation } from '../../../../src/garden/types';
import type { ParamStore } from '../../params';
import type { World } from '../../world';
import { button, el, nextFrame, wait } from './dom';
import { ICONS } from './icons';
import { Sheet } from './sheet';

// Invitations remain the garden source's relationship data. Destinations are
// not connected to this standalone environment yet: previewing one explores
// another seeded hamlet layout without redeeming the invitation or changing
// this world's material, planting or atmosphere parameters.

export class TravelSheet extends Sheet {
  constructor(
    parent: HTMLElement,
    private readonly state: GardenState,
    private readonly board: (invitation: string) => void,
  ) {
    super(parent, 'Travel', 'Worlds you’re invited to', 'g-travel');
  }

  render(): void {
    const invitations = this.state.invitations;
    const friends = this.state.snapshot?.friends ?? [];
    if (invitations.length === 0) {
      const empty = el('div', 'g-travel-empty');
      const stub = el('div', 'g-stub', 'Admit one');
      empty.append(stub, el('p', '', 'No invitations just now. When Muse hits it off with another Muse, it may invite you over: once, as a guest.'));
      this.body.replaceChildren(empty);
      return;
    }
    const list = el('div', 'g-worlds');
    for (const card of invitations) {
      const inv = card.invitation;
      if (!inv) continue;
      const friend = friends.find((f) => f.id === inv.from);
      const item = el('article', 'g-world');
      const pic = el('div', 'g-world-pic');
      pic.style.backgroundImage = `url("${worldArt(inv.world)}")`;
      const text = el('div', 'g-world-text');
      text.append(el('h3', '', inv.worldName), el('p', 'g-world-who', `${friend?.name ?? 'A friend'}’s world`), el('p', 'g-world-blurb', inv.blurb));
      const go = button('g-board', `Preview hamlet route for ${inv.worldName}`, `${ICONS.globe}<span>Preview hamlet route</span>`, () => this.board(card.id));
      text.append(el('p', 'g-once', 'This destination is not connected yet. Preview another hamlet layout; your invitation stays unused.'), go);
      item.append(pic, text);
      list.append(item);
    }
    this.body.replaceChildren(list);
  }
}

function seedFor(world: string): number {
  let h = 2166136261;
  for (let i = 0; i < world.length; i++) h = Math.imul(h ^ world.charCodeAt(i), 16777619);
  return 1000 + ((h >>> 0) % 8000);
}

export class Visit {
  away = false;
  private savedSeed = 412;
  private transitioning = false;
  private readonly transit: HTMLElement;
  private readonly banner: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly world: World,
    private readonly store: ParamStore,
    private readonly hooks: { leaving(): void; changed(away: boolean): void },
  ) {
    this.transit = el('div', 'g-transit');
    this.banner = el('div', 'g-visit');
    parent.append(this.transit, this.banner);
  }

  async start(invitation: Invitation, friend: string): Promise<void> {
    if (this.away || this.transitioning) return;
    this.transitioning = true;
    this.hooks.leaving();
    this.transit.replaceChildren(this.ticket(invitation.worldName, friend));
    this.transit.classList.add('is-on');
    await nextFrame();
    this.transit.classList.add('is-stamped');
    await wait(900);
    this.savedSeed = this.store.values.world.seed;
    this.store.set('world.seed', seedFor(invitation.world));
    this.store.flush();
    this.world.cameraPreset('vista', true);
    this.away = true;
    this.hooks.changed(true);
    this.banner.replaceChildren(
      el('span', 'g-visit-where', 'Hamlet route preview'),
      el('span', 'g-visit-who', `${friend}’s invitation to ${invitation.worldName} stays unused`),
      button('g-visit-home', 'Return home', `${ICONS.house}<span>Return home</span>`, () => void this.end()),
    );
    await wait(500);
    this.banner.classList.add('is-on');
    this.transit.classList.remove('is-on', 'is-stamped');
    this.transitioning = false;
  }

  async end(): Promise<void> {
    if (!this.away || this.transitioning) return;
    this.transitioning = true;
    this.banner.classList.remove('is-on');
    this.transit.replaceChildren(this.ticket('Home', 'Muse'));
    this.transit.classList.add('is-on', 'is-home');
    await wait(450);
    this.store.set('world.seed', this.savedSeed);
    this.store.flush();
    this.world.cameraPreset('homestead', true);
    this.away = false;
    this.hooks.changed(false);
    await wait(500);
    this.transit.classList.remove('is-on', 'is-home');
    this.transitioning = false;
  }

  private ticket(where: string, who: string): HTMLElement {
    const t = el('div', 'g-transit-ticket');
    t.append(el('p', 'g-transit-admit', 'Hamlet route preview'), el('p', 'g-transit-where', where), el('p', 'g-transit-who', where === 'Home' ? 'Back to Muse’s garden' : `Inspired by ${who}’s invitation`), el('span', 'g-transit-stamp', where === 'Home' ? 'Welcome back' : 'Preview'));
    return t;
  }
}
