import { Vector3 } from 'three';
import type { MuseDirection } from '../../life/muse';
import type { World } from '../../world';
import type { Dir, NowView } from '../contract';
import { dirAlong } from './route';
import type { SimClock } from './dom';

/** Muse's walking pace (m/s), as on the terrace; farther than JUMP (rad) is a transport, not a walk. */
const PACE = 0.36;
const JUMP = 0.1;

/** Where the engine's view puts Muse and what it is doing, before any walking between spots. */
export function intent(view: NowView | null, now: number): { kind: 'home'; busy: boolean } | { kind: 'hidden' } | { kind: 'out'; dir: Dir; busy: boolean } | null {
  if (!view) return null;
  if (view.away) return { kind: 'hidden' };
  if (view.activity === 'travel' && view.path) {
    const dir = dirAlong(view.path, now);
    if (dir) return { kind: 'out', dir, busy: view.working };
  }
  return { kind: 'home', busy: view.working };
}

/**
 * Drives the 3D Muse from the engine's view every frame. Out on the planet it waddles from where it stood to where
 * the view now has it, facing that way, and jumps when the move is a transport. While the owner visits a friend's
 * planet the world drawn is the friend's, and this Muse is there as the guest, on the terrace.
 */
export class Body {
  private shown: Vector3 | null = null;
  private readonly target = new Vector3();
  private last = performance.now();
  private visiting = false;

  constructor(
    private readonly world: World,
    private readonly clock: SimClock,
    private readonly view: () => NowView | null,
    private readonly onShown: (dir: Dir | null) => void,
  ) {
    requestAnimationFrame(this.frame);
  }

  /** Where the drawn Muse stands while it is out, for its name tag; null while it is home or hidden. */
  get displayed(): Dir | null {
    return this.shown ? [this.shown.x, this.shown.y, this.shown.z] : null;
  }

  setVisiting(visiting: boolean): void {
    this.visiting = visiting;
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    const t = performance.now();
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.visiting) {
      this.shown = null;
      this.onShown(null);
      this.world.muse.direct({ kind: 'home', busy: false });
      return;
    }
    const want = intent(this.view(), this.clock.now());
    if (!want) return;
    if (want.kind !== 'out') {
      this.shown = null;
      this.onShown(null);
      this.world.muse.direct(want);
      return;
    }
    this.target.set(want.dir[0], want.dir[1], want.dir[2]);
    if (!this.shown || this.shown.angleTo(this.target) > JUMP) this.shown = this.target.clone();
    const left = this.shown.angleTo(this.target);
    const step = (PACE * dt) / this.world.growth.radius;
    const walking = !want.busy && left > 1e-6;
    if (walking) this.shown.lerp(this.target, Math.min(1, step / left)).normalize();
    const direction: MuseDirection = { kind: 'out', dir: this.shown, toward: walking ? this.target : null, walk: walking ? 1 : 0, busy: want.busy };
    this.world.muse.direct(direction);
    this.onShown(this.displayed);
  };
}
