import { damp } from '../core/math';
import type { CameraRig } from './camera';

// Keyboard movement. W A S D walk (or slide the globe from orbit), Q rises
// and E descends as the wheel does, ← → turn and ↑ ↓ walk, Shift runs.
// Speeds ease in and out, so a tap nudges and a hold travels. Keys typed
// into the panel's fields, and shortcuts with ⌘, Ctrl or Alt, are left alone.

/** Per key: ahead, across (× walking speed), climb (zoom per second, negative rises), turn (rad/s, positive left). */
const KEYS: Record<string, readonly [number, number, number, number]> = {
  KeyW: [1, 0, 0, 0],
  KeyS: [-1, 0, 0, 0],
  KeyA: [0, -1, 0, 0],
  KeyD: [0, 1, 0, 0],
  ArrowUp: [1, 0, 0, 0],
  ArrowDown: [-1, 0, 0, 0],
  ArrowLeft: [0, 0, 0, 1.3],
  ArrowRight: [0, 0, 0, -1.3],
  KeyQ: [0, 0, -0.45, 0],
  KeyE: [0, 0, 0.45, 0],
};
const RUN = 2.5;
/** Time constant (s) of the ease toward the keys' speed. */
const EASE = 0.14;

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export class Keys {
  private readonly down = new Set<string>();
  private run = false;
  /** Eased speeds: ahead and across (m/s), zoom (1/s), turn (rad/s). */
  private readonly speed = [0, 0, 0, 0];
  private readonly detach: () => void;

  constructor(target: Window = window) {
    const onDown = (e: KeyboardEvent): void => {
      this.run = e.shiftKey;
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !(e.code in KEYS)) return;
      this.down.add(e.code);
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent): void => {
      this.run = e.shiftKey;
      this.down.delete(e.code);
    };
    const release = (): void => this.down.clear();
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    this.detach = () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }

  /** Move the camera for this frame; true when it moved. */
  update(rig: CameraRig, dt: number): boolean {
    const want = [0, 0, 0, 0];
    for (const code of this.down) KEYS[code].forEach((v, i) => (want[i] += v));
    const pace = rig.walkSpeed * (this.run ? RUN : 1);
    want[0] *= pace;
    want[1] *= pace;
    const k = damp(dt, EASE);
    let moving = false;
    for (let i = 0; i < 4; i++) {
      this.speed[i] += (want[i] - this.speed[i]) * k;
      if (Math.abs(this.speed[i]) < 1e-3 && want[i] === 0) this.speed[i] = 0;
      if (this.speed[i] !== 0) moving = true;
    }
    if (!moving) return false;
    rig.walk(this.speed[0] * dt, this.speed[1] * dt);
    rig.zoomBy(this.speed[2] * dt);
    rig.turn(this.speed[3] * dt);
    return true;
  }

  dispose(): void {
    this.detach();
  }
}
