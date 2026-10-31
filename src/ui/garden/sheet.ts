import { button, el } from './dom';
import { ICONS } from './icons';

// A sheet of paper that slides in from the right (from below on a phone):
// the baskets, Muse's page, travel. The meadow stays in view beside it; a
// tap outside it, Esc or its × puts it away.

const open = new Set<Sheet>();

export abstract class Sheet {
  readonly el: HTMLElement;
  protected readonly body: HTMLElement;
  private readonly scrim: HTMLElement;

  constructor(parent: HTMLElement, title: string, subtitle: string, className: string) {
    this.scrim = el('div', 'g-scrim');
    this.scrim.addEventListener('click', () => this.close());
    this.el = el('section', `g-sheet ${className}`);
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', title);
    const head = el('header', 'g-sheet-head');
    const h = el('h2', 'g-sheet-title', title);
    head.append(h, el('p', 'g-sheet-sub', subtitle), button('g-sheet-close', 'Close', ICONS.close, () => this.close()));
    this.body = el('div', 'g-sheet-body');
    this.el.append(head, this.body);
    parent.append(this.scrim, this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  open(): void {
    for (const other of open) if (other !== this) other.close();
    this.render();
    open.add(this);
    this.el.classList.add('is-open');
    this.scrim.classList.add('is-open');
    this.body.scrollTop = 0;
  }

  close(): void {
    open.delete(this);
    this.el.classList.remove('is-open');
    this.scrim.classList.remove('is-open');
  }

  /** Fill the body from the state (on open, and whenever what it shows changes). */
  abstract render(): void;
}
