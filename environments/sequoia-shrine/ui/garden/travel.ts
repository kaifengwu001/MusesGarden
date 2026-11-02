import { worldArt } from '../../../../src/garden/art';
import type { GardenState } from '../../garden/state';
import type { Invitation } from '../../../../src/garden/types';
import type { ParamPath, ParamStore, ParamValue } from '../../params';
import type { World } from '../../world';
import { button, el, nextFrame, wait } from '../../../../src/ui/garden/dom';
import { ICONS } from '../../../../src/ui/garden/icons';
import { Sheet } from '../../../../src/ui/garden/sheet';

// Travel: the worlds you are invited to, each good for one visit (a guest
// at a friend's place, not a standing pass), and the visit itself. Other
// worlds are not built yet, so a visit is a stand-in: the meadow re-seeded
// and re-planted (its own hills, wetter ground, white and blue flowers),
// your finds and pins put away, Muse left at home, until you return.

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
      const go = button('g-board', `Travel to ${inv.worldName}`, `${ICONS.globe}<span>Board</span>`, () => this.board(card.id));
      text.append(el('p', 'g-once', 'Good for one visit'), go);
      item.append(pic, text);
      list.append(item);
    }
    this.body.replaceChildren(list);
  }
}

/** The stand-in for a friend's world: what changes while you visit. */
const AWAY: ReadonlyArray<readonly [ParamPath, ParamValue]> = [
  ['terrain.wetlands', 0.68],
  ['terrain.roll', 2.1],
  ['flowers.pink', 0.04],
  ['flowers.star', 0.6],
  ['flowers.yellow', 0.1],
  ['flowers.blue', 0.55],
  ['clouds.coverage', 0.62],
  ['grass.height', 0.55],
];

function seedFor(world: string): number {
  let h = 2166136261;
  for (let i = 0; i < world.length; i++) h = Math.imul(h ^ world.charCodeAt(i), 16777619);
  return 1000 + ((h >>> 0) % 8000);
}

export class Visit {
  away = false;
  private saved: Array<[ParamPath, ParamValue]> = [];
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
    if (this.away) return;
    this.hooks.leaving();
    this.transit.replaceChildren(this.ticket(invitation.worldName, friend));
    this.transit.classList.add('is-on');
    await nextFrame();
    this.transit.classList.add('is-stamped');
    await wait(900);
    const paths: ParamPath[] = ['world.seed', ...AWAY.map(([p]) => p)];
    this.saved = paths.map((p) => [p, this.store.get(p)]);
    this.store.set('world.seed', seedFor(invitation.world));
    for (const [p, v] of AWAY) this.store.set(p, v);
    this.store.flush();
    this.world.cameraPreset('vista', true);
    this.away = true;
    this.hooks.changed(true);
    this.banner.replaceChildren(
      el('span', 'g-visit-where', `Visiting ${invitation.worldName}`),
      el('span', 'g-visit-who', `${friend}’s world · a stand-in until other worlds are built`),
      button('g-visit-home', 'Return home', `${ICONS.house}<span>Return home</span>`, () => void this.end()),
    );
    await wait(500);
    this.banner.classList.add('is-on');
    this.transit.classList.remove('is-on', 'is-stamped');
  }

  async end(): Promise<void> {
    if (!this.away) return;
    this.banner.classList.remove('is-on');
    this.transit.replaceChildren(this.ticket('Home', 'Muse'));
    this.transit.classList.add('is-on', 'is-home');
    await wait(450);
    for (const [p, v] of this.saved) this.store.set(p, v);
    this.store.flush();
    this.world.cameraPreset('cabin', true);
    this.away = false;
    this.hooks.changed(false);
    await wait(500);
    this.transit.classList.remove('is-on', 'is-home');
  }

  private ticket(where: string, who: string): HTMLElement {
    const t = el('div', 'g-transit-ticket');
    t.append(el('p', 'g-transit-admit', 'Admit one'), el('p', 'g-transit-where', where), el('p', 'g-transit-who', where === 'Home' ? 'Back to Muse’s garden' : `Guest of ${who}`), el('span', 'g-transit-stamp', where === 'Home' ? 'Welcome back' : 'Visiting'));
    return t;
  }
}
