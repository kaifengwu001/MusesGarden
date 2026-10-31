import { Vector3 } from 'three';
import { parseHash } from '../../core/hashSync';
import type { World } from '../../world';
import type { InvitationCard, PlantCard, VisitWorldView } from '../contract';
import type { MuseApi } from './api';
import { button, duration, el, type SimClock } from './dom';
import { findCard } from './mailbox';
import type { Pin, Pins } from './pins';

interface Visiting {
  readonly view: VisitWorldView;
  /** The owner's own hash, restored on the way home. */
  readonly home: string;
  readonly pins: readonly Pin[];
}

/**
 * Visit mode: inside an open invitation window, the world switches to the host's planet through the
 * URL hash (HashSync applies it like any typed URL), the host's public finds show as pins, and a
 * banner counts down the window. When the window ends, the owner's own hash comes back.
 */
export class Visit {
  readonly banner = el('div', 'mu-status mu-visit');
  readonly card = el('aside', 'mu-visit-card');
  private readonly text = el('span', 'mu-label');
  private readonly left = el('span', 'mu-reason');
  private visiting: Visiting | null = null;

  constructor(
    private readonly api: MuseApi,
    private readonly world: World,
    private readonly pins: Pins,
    private readonly clock: SimClock,
    private readonly onChange: (visiting: boolean, note?: string) => void,
  ) {
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    this.banner.append(el('span', 'mu-dot'), this.text, this.left, button('Leave', 'mu-btn', () => this.leave()));
    this.card.hidden = true;
    this.card.setAttribute('aria-label', 'A find on this planet');
    window.setInterval(() => this.tick(), 15_000);
  }

  get active(): boolean {
    return this.visiting !== null;
  }

  async enter(invitation: InvitationCard): Promise<void> {
    if (this.visiting) this.leave();
    const view = await this.api.visit(invitation.id);
    if (view === 'forbidden') {
      this.onChange(false, 'The door isn’t open right now.');
      return;
    }
    const home = location.hash.replace(/^#/, '');
    const hash = parseHash(home);
    hash.set('seed', String(view.worldSeed));
    hash.set('g', String(view.g));
    hash.delete('pose');
    location.replace(`#${[...hash].map(([k, v]) => (v === '' ? k : `${k}=${encodeURIComponent(v).replace(/%2C/gi, ',')}`)).join('&')}`);

    const pins = view.plants.map((plant) => {
      if (!plant.card) {
        const dot = el('span', 'mu-plant mu-private');
        dot.title = 'A private find';
        return this.pins.add(dot, plant.dir);
      }
      const card = plant.card;
      const b = button('', 'mu-plant', () => this.show(card));
      b.setAttribute('aria-label', card.title);
      b.title = card.title;
      return this.pins.add(b, plant.dir);
    });
    this.visiting = { view, home, pins };
    this.text.textContent = `Visiting ${view.host.name}’s planet`;
    this.banner.hidden = false;
    const first = view.plants.find((p) => p.card) ?? view.plants[0];
    if (first) this.world.rig.glideTo(new Vector3(...first.dir));
    this.onChange(true);
    this.tick();
  }

  leave(note?: string): void {
    const v = this.visiting;
    if (!v) return;
    this.visiting = null;
    for (const pin of v.pins) this.pins.remove(pin);
    this.banner.hidden = true;
    this.card.hidden = true;
    location.replace(`#${v.home}`);
    this.onChange(false, note);
  }

  /** Counts the window down; leaves when it closes. */
  tick(): void {
    const v = this.visiting;
    if (!v) return;
    const ms = v.view.until - this.clock.now();
    if (ms <= 0) this.leave(`The window closed. Back home from ${v.view.host.name}’s planet.`);
    else this.left.textContent = `${duration(ms)} left`;
  }

  private show(card: PlantCard): void {
    const close = button('Close', 'mu-btn mu-close', () => (this.card.hidden = true));
    this.card.replaceChildren(findCard(card), close);
    this.card.hidden = false;
  }

  /** Esc: the open card first. */
  closeCard(): boolean {
    if (this.card.hidden) return false;
    this.card.hidden = true;
    return true;
  }
}
