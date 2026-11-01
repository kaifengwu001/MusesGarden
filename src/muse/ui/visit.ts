import { Vector3 } from 'three';
import { parseHash } from '../../core/hashSync';
import type { World } from '../../world';
import type { InvitationCard, VisitWorldView } from '../contract';
import type { Anchors } from './anchors';
import type { MuseApi } from './api';
import { button, duration, el, type SimClock } from './dom';

interface Visiting {
  readonly view: VisitWorldView;
  /** The owner's own hash, restored on the way home. */
  readonly home: string;
}

/**
 * Visit mode: for 2 h after the owner uses an invitation, the world switches to the host's planet through
 * the URL hash (HashSync applies it like any typed URL), the host's finds take the anchors (private ones
 * as plain dots), and a banner counts the visit down. When it ends, the owner's own hash comes back and
 * `onChange(false)` hands the anchors back to the owner's planet.
 */
export class Visit {
  readonly banner = el('div', 'mu-status mu-visit');
  private readonly text = el('span', 'mu-label');
  private readonly left = el('span', 'mu-reason');
  private visiting: Visiting | null = null;

  constructor(
    private readonly api: MuseApi,
    private readonly world: World,
    private readonly anchors: Anchors,
    private readonly clock: SimClock,
    private readonly onChange: (visiting: boolean, note?: string) => void,
  ) {
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    this.banner.append(el('span', 'mu-dot'), this.text, this.left, button('Leave', 'mu-btn', () => this.leave()));
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

    this.visiting = { view, home };
    this.anchors.set(view.plants.map((p) => ({ id: p.id, dir: p.dir, preview: p.preview, card: () => Promise.resolve(p.card) })));
    this.text.textContent = `Visiting ${view.host.name}’s planet`;
    this.banner.hidden = false;
    const first = view.plants.find((p) => p.preview) ?? view.plants[0];
    if (first) this.world.rig.glideTo(new Vector3(...first.dir));
    this.onChange(true);
    this.tick();
  }

  leave(note?: string): void {
    const v = this.visiting;
    if (!v) return;
    this.visiting = null;
    this.anchors.set([]);
    this.anchors.close();
    this.banner.hidden = true;
    location.replace(`#${v.home}`);
    this.onChange(false, note);
  }

  /** Counts the visit down; leaves when it ends. */
  tick(): void {
    const v = this.visiting;
    if (!v) return;
    const ms = v.view.until - this.clock.now();
    if (ms <= 0) this.leave(`The visit is over. Back home from ${v.view.host.name}’s planet.`);
    else this.left.textContent = `${duration(ms)} left`;
  }
}
