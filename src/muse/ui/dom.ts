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

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const day = (at: Instant | number): string => dayFmt.format(at);
export const time = (at: Instant | number): string => timeFmt.format(at);

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
