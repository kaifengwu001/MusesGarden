import type { Invitation } from '../../garden/types';
import type { ParamPath, ParamStore, ParamValue } from '../../params';
import { ticket } from '../../visit/transit';
import type { World } from '../../world';
import { button, el, nextFrame, wait } from './dom';
import { ICONS } from './icons';

// Travel: a visit to a friend's world on a ticket from the post, good for one
// visit (a guest at a friend's place, not a standing pass). Other
// worlds are not built yet, so a visit is a stand-in: the meadow re-seeded
// and re-planted (its own hills, wetter ground, white and blue flowers),
// your finds and pins put away, Muse left at home, until you return.

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

  async start(invitation: Invitation): Promise<void> {
    if (this.away) return;
    const friend = invitation.fromName;
    this.hooks.leaving();
    this.transit.replaceChildren(ticket(invitation.worldName, friend));
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
    this.transit.replaceChildren(ticket('Home', 'Muse'));
    this.transit.classList.add('is-on', 'is-home');
    await wait(450);
    for (const [p, v] of this.saved) this.store.set(p, v);
    this.store.flush();
    this.world.cameraPreset('homestead', true);
    this.away = false;
    this.hooks.changed(false);
    await wait(500);
    this.transit.classList.remove('is-on', 'is-home');
  }

}
