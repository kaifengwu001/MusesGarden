import type { Vector3 } from 'three';
import type { MuseLook, NowView } from '../muse/contract';
import { FOLLOW, Follower } from './follow';
import type { VisitBody } from './world';

// A friend's Muse visiting yours, drawn: while the engine's view of your Muse names a companion (a friend's Muse come
// over, with its owner on a ticket or not), that Muse stands beside yours in its own body and keeps it company
// (follow.ts). Its Muse is made the first time a friend comes, so a planet no friend has visited draws as it always
// has; when the friend leaves, it is out of sight until the next one comes.

/** The world as a friend's visit reads it: your Muse, the planet's size and ground, and a Muse for the friend. */
export interface CompanionWorld<B extends VisitBody = VisitBody> {
  /** The Muse whose planet this is; `away` while it is off the planet itself. */
  readonly host: VisitBody & { readonly away: boolean };
  readonly growth: { readonly radius: number };
  /** A Muse for a friend, in its body: drawn and kept up to date with the world's. */
  makeGuest(look: MuseLook): B;
  /** The friend's Muse in another body: another friend came. */
  dress(guest: B, look: MuseLook): void;
  /** The ground at a place: its signed distance to the shore (m, negative on water). */
  ground(dir: Vector3): { readonly water: number };
  /** Where a Muse may stand beyond dry ground (off the walls of a house, on a deck's free part), if the world knows. */
  standable?(dir: Vector3): boolean;
}

export interface CompanionState {
  readonly companion: string | null;
  readonly look: MuseLook | null;
  readonly made: boolean;
  readonly shown: boolean;
  /** How far the friend's Muse stands from yours (m). */
  readonly apart: number | null;
}

export class Companions<B extends VisitBody = VisitBody> {
  private guest: B | null = null;
  private dressed: MuseLook | null = null;
  private companion: NowView['companion'] = null;
  private shown = false;
  private readonly follower = new Follower();

  constructor(private readonly world: CompanionWorld<B>) {
    if ((import.meta.env.DEV || import.meta.env.VITE_PROBE) && typeof window !== 'undefined') {
      (window as unknown as { __companions: unknown }).__companions = { state: () => this.state() };
    }
  }

  /** Each view of your Muse the engine sends: who is visiting it, if anyone. */
  view(view: NowView): void {
    const c = view.companion;
    this.companion = c;
    if (!c) return;
    if (!this.guest) this.guest = this.world.makeGuest(c.look);
    else if (this.dressed !== c.look) this.world.dress(this.guest, c.look);
    this.dressed = c.look;
  }

  /** Each frame, before the world moves: the friend's Muse beside yours, or out of sight. */
  update(dt: number): void {
    const guest = this.guest;
    if (!guest) return;
    const host = this.world.host;
    this.shown = this.companion !== null && !host.away;
    if (!this.shown) {
      this.follower.reset();
      guest.direct({ kind: 'hidden' });
      return;
    }
    const stands = (dir: Vector3) => this.world.ground(dir).water > FOLLOW.dry && (this.world.standable?.(dir) ?? true);
    const f = this.follower.step(host.where, dt, this.world.growth.radius, stands);
    guest.direct({ kind: 'out', dir: f.dir, toward: f.toward, walk: f.walk, busy: false });
  }

  state(): CompanionState {
    const guest = this.guest;
    return {
      companion: this.companion?.museId ?? null,
      look: this.dressed,
      made: guest !== null,
      shown: this.shown,
      apart: guest && this.shown ? this.world.host.where.dir.angleTo(guest.where.dir) * this.world.growth.radius : null,
    };
  }
}
