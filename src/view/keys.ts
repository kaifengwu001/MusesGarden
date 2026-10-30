import type { CameraRig } from './camera';

// Keyboard movement: W/S forward and back, A/D to the sides, Q/E up and down
// (as the wheel does). Keys are read by their place on the keyboard
// (KeyboardEvent.code), so the same keys work on any layout. Held keys move
// the camera by the time that passed each frame, so the speed does not
// depend on the frame rate.

/** Zoom per second while Q or E is held (the whole range in a little over two seconds). */
const CLIMB = 0.45;

export class KeyMovement {
  private readonly held = new Set<string>();

  constructor(target: Window) {
    const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    target.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    // a key let go while the window was not looking would stay held
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Move the camera for `dt` seconds of held keys. True when anything moved. */
  apply(rig: CameraRig, dt: number): boolean {
    if (this.held.size === 0) return false;
    const axis = (plus: string, minus: string): number => (this.held.has(plus) ? 1 : 0) - (this.held.has(minus) ? 1 : 0);
    const ahead = axis('KeyW', 'KeyS');
    const aside = axis('KeyD', 'KeyA');
    const climb = axis('KeyQ', 'KeyE');
    const step = rig.walkSpeed * dt;
    if (ahead !== 0 || aside !== 0) {
      const norm = ahead !== 0 && aside !== 0 ? Math.SQRT1_2 : 1;
      rig.move(ahead * step * norm, aside * step * norm);
    }
    if (climb !== 0) rig.zoomBy(-climb * CLIMB * dt);
    return ahead !== 0 || aside !== 0 || climb !== 0;
  }
}
