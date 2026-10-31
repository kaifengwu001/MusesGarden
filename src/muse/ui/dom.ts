import type { Instant } from '../contract';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A link that opens in a new tab and tells the page nothing about where it came from. */
export function outLink(href: string, className: string): HTMLAnchorElement {
  const a = el('a', className);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** A thumbnail that takes its place only once the image has arrived; a missing image leaves no gap. */
export function thumb(src: string | undefined, className: string): HTMLImageElement | null {
  if (!src) return null;
  const img = el('img', className);
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.hidden = true;
  img.addEventListener('load', () => (img.hidden = false));
  img.addEventListener('error', () => img.remove());
  img.src = src;
  return img;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const day = (at: Instant | number): string => dayFmt.format(at);
export const time = (at: Instant | number): string => timeFmt.format(at);

/** "1 h 40 min", "25 min", "under a minute". */
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** Sim time from the last server reading, carried forward by the wall clock between readings. */
export class SimClock {
  private at = Date.now();
  private wall = Date.now();

  sync(at: Instant): void {
    this.at = at;
    this.wall = Date.now();
  }

  now(): number {
    return this.at + Date.now() - this.wall;
  }
}

/** Arrow keys walk the focus through the `[data-card]` elements inside `root`: ← → in order, ↑ ↓ to the next row. */
export function arrowNav(root: HTMLElement): void {
  root.addEventListener('keydown', (e) => {
    if (!e.key.startsWith('Arrow')) return;
    const cards = [...root.querySelectorAll<HTMLElement>('[data-card]')];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let target: HTMLElement | undefined;
    if (e.key === 'ArrowRight') target = cards[i + 1];
    else if (e.key === 'ArrowLeft') target = cards[i - 1];
    else {
      const row = cards[i].closest('[data-row]');
      const rows = [...root.querySelectorAll<HTMLElement>('[data-row]')];
      const next = rows[rows.indexOf(row as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)];
      target = next?.querySelector<HTMLElement>('[data-card]') ?? undefined;
    }
    e.preventDefault();
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  });
}
