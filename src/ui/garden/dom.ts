// Small DOM helpers for the garden's interface, and the way it says days.
import { ICONS } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button with an accessible name; `html` is trusted markup (our own icons). */
export function button(className: string, label: string, html = '', onClick?: (event: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  if (html) b.innerHTML = html;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** A switch; with `words` ([on, off]) it shows the state in words beside it and keeps the label for screen readers. */
export function toggle(label: string, on: boolean, onChange: (on: boolean) => void, words?: [string, string]): HTMLLabelElement {
  const row = el('label', 'g-toggle');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = on;
  input.setAttribute('role', 'switch');
  const track = el('span', 'g-switch');
  const text = el('span', words ? 'g-toggle-label g-sr' : 'g-toggle-label', label);
  row.append(text);
  if (words) {
    const state = el('span', 'g-toggle-state');
    const paint = (): void => {
      state.innerHTML = `${input.checked ? ICONS.share : ICONS.lock}<span>${input.checked ? words[0] : words[1]}</span>`;
    };
    paint();
    input.addEventListener('change', paint);
    row.append(state);
  }
  row.append(input, track);
  input.addEventListener('change', () => onChange(input.checked));
  return row;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Whole days from `day` to today (0 today, 1 yesterday). */
export function daysAgo(day: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - parseDay(day).getTime()) / 86_400_000);
}

/** 'Today', 'Yesterday', 'Tuesday' within the week, then 'Tue 21 Oct'. */
export function dayName(day: string, now = new Date()): string {
  const ago = daysAgo(day, now);
  const d = parseDay(day);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago > 1 && ago < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** '31 Oct' (postmarks, captions). */
export function shortDate(day: string): string {
  return parseDay(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** 'since 2 Oct' / 'met 12 days ago'. */
export function agoPhrase(day: string, now = new Date()): string {
  const ago = daysAgo(day, now);
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 14) return `${ago} days ago`;
  return `on ${shortDate(day)}`;
}

/** 0:24, 4:01:00. */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Wait for the next frames (lets a style apply before a transition starts). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const reducedMotion = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
