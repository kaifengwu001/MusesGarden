import { Vector3 } from 'three';
import type { World } from '../../world';
import type { Dir, NowView } from '../contract';
import type { MuseApi } from './api';
import { button, el, type SimClock } from './dom';
import type { Pin, Pins } from './pins';
import { dirAlong } from './route';

/** Movement keys (view/keys.ts): pressing one means the owner is roaming on their own. */
const ROAM_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Re-glide when Muse has walked this far from where the camera was sent (rad), at most this often (ms). */
const FOLLOW = { drift: 0.004, everyMs: 4000 } as const;

const angle = (a: Dir, b: Dir): number => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

/** Why Follow is off: Muse is beyond the planet or away at a friend's, where the owner can't go along. */
const unfollowable = (view: NowView): string => `Follow is back when ${view.name} returns.`;

/** The status pill (what Muse is doing), the Follow toggle, and Muse's pin on the planet. */
export class Status {
  readonly el = el('div', 'mu-status');
  private readonly dot = el('span', 'mu-dot');
  private readonly name = el('span', 'mu-name');
  private readonly label = el('span', 'mu-label');
  private readonly follow: HTMLButtonElement;
  private readonly reason = el('span', 'mu-reason');
  private readonly tag = el('span', 'mu-tag', 'sample data');
  private readonly pinName = el('span', 'mu-muse-name');
  private readonly pin: Pin;
  private view: NowView | null = null;
  /** Where the drawn Muse stands while it walks out on the planet; the name tag sits there rather than on the route. */
  private drawnAt: Dir | null = null;
  private following = false;
  private sentTo: Dir | null = null;
  private sentAt = 0;

  constructor(
    private readonly api: MuseApi,
    private readonly world: World,
    private readonly clock: SimClock,
    pins: Pins,
  ) {
    this.el.setAttribute('role', 'status');
    this.follow = button('Follow', 'mu-btn mu-follow', () => this.setFollowing(!this.following));
    this.follow.setAttribute('aria-pressed', 'false');
    this.tag.hidden = true;
    this.el.append(this.dot, this.name, this.label, this.follow, this.reason, this.tag);
    api.onSource((s) => (this.tag.hidden = !(import.meta.env.DEV && s === 'sample')));

    const pinEl = el('div', 'mu-muse');
    pinEl.append(el('span', 'mu-muse-mark'), this.pinName);
    this.pin = pins.add(pinEl, null);
    window.setInterval(() => this.tick(), 1000);
    this.watchRoaming();
  }

  get current(): NowView | null {
    return this.view;
  }

  /** The 3D Muse's spot while it is out, so the name tag stays on it; null puts the tag back on the route. */
  placeTag(dir: Dir | null): void {
    this.drawnAt = dir;
    if (dir) this.pin.dir = dir;
  }

  get museName(): string {
    return this.view?.name ?? 'Muse';
  }

  async refresh(): Promise<void> {
    let view: NowView;
    try {
      view = await this.api.now();
    } catch (error) {
      if (!this.view) this.label.textContent = 'Muse is quiet right now.';
      throw error;
    }
    this.view = view;
    this.clock.sync(view.at);
    this.dot.dataset.activity = view.working ? 'work' : view.sleeping ? 'sleep' : view.activity;
    this.name.textContent = view.name;
    this.label.textContent = view.label;
    this.pin.el.classList.toggle('working', view.working);
    this.pinName.textContent = view.name;
    const can = view.path !== null && view.path.length > 0;
    this.follow.disabled = !can;
    this.follow.hidden = !can;
    this.reason.hidden = can;
    this.reason.textContent = can ? '' : unfollowable(view);
    if (!can) this.setFollowing(false);
    this.tick();
  }

  /** The owner sent the camera somewhere else. */
  unfollow(): void {
    this.setFollowing(false);
  }

  /** Hide while the owner is visiting another planet: this Muse isn't there. */
  setAway(away: boolean): void {
    this.el.hidden = away;
    if (away) this.setFollowing(false);
    this.pin.el.hidden = away;
  }

  private tick(): void {
    const path = this.view?.path;
    const dir = path ? dirAlong(path, this.clock.now()) : null;
    this.pin.dir = this.drawnAt ?? dir;
    if (!this.following || !dir) return;
    const now = performance.now();
    if (this.sentTo && (now - this.sentAt < FOLLOW.everyMs || angle(dir, this.sentTo) < FOLLOW.drift)) return;
    this.sentTo = dir;
    this.sentAt = now;
    this.world.rig.glideTo(new Vector3(dir[0], dir[1], dir[2]));
  }

  private setFollowing(on: boolean): void {
    if (on === this.following) return;
    this.following = on;
    this.sentTo = null;
    this.follow.setAttribute('aria-pressed', String(on));
    this.follow.textContent = on ? 'Following' : 'Follow';
    if (on) this.tick();
  }

  /** Dragging the planet, double-clicking elsewhere or walking with the keys hands the camera back to the owner. */
  private watchRoaming(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#scene');
    if (canvas) {
      let downX = 0;
      let downY = 0;
      canvas.addEventListener('pointerdown', (e) => ((downX = e.clientX), (downY = e.clientY)), { passive: true });
      canvas.addEventListener(
        'pointermove',
        (e) => {
          if (e.buttons && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) this.setFollowing(false);
        },
        { passive: true },
      );
      canvas.addEventListener('dblclick', () => this.setFollowing(false));
    }
    window.addEventListener('keydown', (e) => {
      if (ROAM_KEYS.has(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey) this.setFollowing(false);
    });
  }
}
