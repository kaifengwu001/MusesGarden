import { Vector3 } from 'three';
import type { MuseDirection } from '../../life/muse';
import type { World } from '../../world';
import type { Dir, NowView } from '../../../../src/muse/contract';
import { dirAlong } from '../../../../src/muse/ui/route';
import type { SimClock } from '../../../../src/muse/ui/dom';

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
 * The 3D Muse's direction from the engine's view, a frame at a time. Out on the planet it waddles from where it stood
 * to where the view now has it, facing that way, and jumps when the move is a transport.
 */
export class Body {
  private shown: Vector3 | null = null;
  private readonly target = new Vector3();

  constructor(
    private readonly world: World,
    private readonly clock: SimClock,
    private readonly view: () => NowView | null,
  ) {}

  /** Muse's direction `dt` seconds on from the last frame; null leaves Muse as it is (the engine hasn't answered yet). */
  step(dt: number): MuseDirection | null {
    const want = intent(this.view(), this.clock.now());
    if (!want) return null;
    if (want.kind !== 'out') {
      this.shown = null;
      return want;
    }
    this.target.set(want.dir[0], want.dir[1], want.dir[2]);
    if (!this.shown || this.shown.angleTo(this.target) > JUMP) this.shown = this.target.clone();
    const left = this.shown.angleTo(this.target);
    const step = (PACE * Math.min(0.1, dt)) / this.world.growth.radius;
    const walking = !want.busy && left > 1e-6;
    if (walking) this.shown.lerp(this.target, Math.min(1, step / left)).normalize();
    return { kind: 'out', dir: this.shown, toward: walking ? this.target : null, walk: walking ? 1 : 0, busy: want.busy };
  }
}
