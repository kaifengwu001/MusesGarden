import { el, reducedMotion, wait } from './dom';
import { PostboxIllustration } from './postboxIllustration';

type Motion = { latch: number; door: number; flag: number; cards: number; wiggle: number };
interface Tween { from: number; to: number; start: number; ms: number; ease: (t: number) => number }
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const LATCH_LIFT_MS = 480;
const LATCH_HOLD_MS = 180;

/** The hand-drawn mailbox, with a hinged door, lifting latch and unread flag. */
export class PostBox {
  readonly el: HTMLElement;
  private readonly visual: HTMLElement;
  private readonly hit: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly seal: HTMLElement;
  private readonly illustration = new PostboxIllustration();
  private readonly state: Motion = { latch: 0, door: 0, flag: 0, cards: 0, wiggle: 0 };
  private readonly tweens = new Map<keyof Motion, Tween>();
  private raf = 0;
  private wake = 0;
  private operation = 0;
  private flagUp = false;
  private nextWaggle = 0;
  private total = 0;
  private invitations = 0;
  private handedOff = false;
  private opened = false;

  constructor(parent: HTMLElement, onOpen: () => void) {
    this.el = el('div', 'g-postbox is-illustrated');
    this.visual = el('div', 'g-postbox-visual');
    this.visual.append(this.illustration.el);
    this.hit = el('button', 'g-postbox-hit');
    this.hit.type = 'button';
    this.hit.setAttribute('aria-label', 'Post box');
    this.hit.setAttribute('aria-expanded', 'false');
    this.hit.title = 'Post box';
    this.hit.addEventListener('click', onOpen);
    this.hit.addEventListener('pointerenter', () => this.wiggle());
    this.count = el('span', 'g-postbox-count');
    this.seal = el('span', 'g-seal');
    this.seal.title = 'An invitation';
    this.el.append(this.visual, this.hit, this.count, this.seal);
    parent.append(this.el);
    this.kick();
    window.addEventListener('resize', () => this.kick());
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      if (reducedMotion()) {
        for (const [key, tween] of this.tweens) this.state[key] = tween.to;
        this.tweens.clear();
        this.state.wiggle = 0;
        clearTimeout(this.wake);
      }
      this.kick();
    });
  }

  setMail(unread: number, invitations: number, total = unread): void {
    this.total = total;
    this.invitations = invitations;
    const up = unread > 0;
    if (up !== this.flagUp) {
      this.flagUp = up;
      this.tween('flag', up ? 1 : 0, 500);
      if (up) this.nextWaggle = performance.now() + 3500;
    }
    this.count.textContent = unread > 0 ? String(unread) : '';
    this.count.classList.toggle('is-on', up);
    this.seal.classList.toggle('is-on', invitations > 0 && !this.opened);
    this.el.classList.toggle('has-mail', up);
    this.hit.setAttribute('aria-label', unread > 0 ? `Post box, ${unread} unread` : 'Post box');
    this.kick();
  }

  /** Lift the keeper, then drop the door before any postcard moves through it. */
  async open(): Promise<{ x: number; y: number }> {
    const operation = ++this.operation;
    this.opened = true;
    this.handedOff = false;
    this.tweens.delete('cards');
    this.tweens.delete('door');
    this.tweens.delete('wiggle');
    this.state.wiggle = 0;
    this.state.cards = 0;
    this.hit.setAttribute('aria-expanded', 'true');
    this.el.classList.add('is-open');
    this.seal.style.visibility = 'hidden';
    this.tween('latch', 1, LATCH_LIFT_MS, easeInOut);
    if (!reducedMotion()) await wait(LATCH_LIFT_MS + LATCH_HOLD_MS);
    if (operation !== this.operation) return this.mouth();
    this.tween('door', 1, 460);
    if (!reducedMotion()) await wait(460);
    if (operation !== this.operation) return this.mouth();
    if (this.total > 0) {
      this.tween('cards', 1, 180);
      if (!reducedMotion()) await wait(180);
    }
    return this.mouth();
  }

  /** The DOM postcards take over from the tiny cards inside the prop. */
  releaseMail(): void {
    this.handedOff = true;
    this.kick();
  }

  close(): void {
    const operation = ++this.operation;
    this.opened = false;
    this.handedOff = false;
    this.tweens.delete('cards');
    this.tweens.delete('latch');
    this.state.cards = 0;
    this.hit.setAttribute('aria-expanded', 'false');
    this.el.classList.remove('is-open');
    this.seal.style.visibility = '';
    this.seal.classList.toggle('is-on', this.invitations > 0);
    const doorMoving = this.state.door > 0.001;
    this.tween('door', 0, doorMoving ? 420 : 0, easeInOut);
    void (async () => {
      if (doorMoving && !reducedMotion()) await wait(420);
      if (operation !== this.operation) return;
      this.tween('latch', 0, 300, easeInOut);
    })();
  }

  mouth(): { x: number; y: number } {
    const rect = this.visual.getBoundingClientRect();
    return { x: rect.left + this.illustration.mouth.x * rect.width, y: rect.top + this.illustration.mouth.y * rect.height };
  }

  private tween(key: keyof Motion, to: number, ms: number, ease = easeOut): void {
    if (reducedMotion() || ms === 0) { this.state[key] = to; this.tweens.delete(key); }
    else this.tweens.set(key, { from: this.state[key], to, start: performance.now(), ms, ease });
    this.kick();
  }

  private wiggle(): void {
    if (reducedMotion() || this.opened || this.tweens.has('wiggle')) return;
    this.state.wiggle = 0;
    this.tween('wiggle', 1, 650, t => t);
  }

  private pin(tag: HTMLElement, at: { x: number; y: number }): void {
    tag.style.left = `${at.x * this.visual.clientWidth}px`;
    tag.style.top = `${at.y * this.visual.clientHeight}px`;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(now => this.frame(now));
  }

  private frame(now: number): void {
    this.raf = 0;
    for (const [key, t] of this.tweens) {
      const u = Math.min(1, (now - t.start) / t.ms);
      this.state[key] = t.from + (t.to - t.from) * t.ease(u);
      if (u >= 1) this.tweens.delete(key);
    }
    if (!reducedMotion() && this.flagUp && !this.opened && now >= this.nextWaggle) {
      this.nextWaggle = now + 7000;
      this.wiggle();
    }
    const s = this.state;
    const hasCards = this.total > 0 && !this.handedOff;
    this.illustration.render(s, hasCards);
    this.pin(this.count, this.illustration.countAt);
    this.pin(this.seal, this.illustration.sealAt);
    this.el.dataset.door = s.door > 0.99 ? 'open' : s.door < 0.01 ? 'closed' : 'moving';
    this.el.dataset.latch = s.latch > 0.99 ? 'released' : s.latch < 0.01 ? 'latched' : 'moving';
    clearTimeout(this.wake);
    if (this.tweens.size) this.kick();
    else if (this.flagUp && !this.opened && !reducedMotion()) this.wake = window.setTimeout(() => this.kick(), Math.max(50, this.nextWaggle - now));
  }
}
