import type { Vector3 } from 'three';
import type { ParamStore } from '../params';
import { seasonFor } from './format';

// Postcard mode: the view framed by a soft paper border, with a caption card
// naming the place, the season and where on the planet you are looking.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Latitude/longitude of a planet direction, as on a postcard. */
export function coordinates(dir: Vector3): string {
  const lat = (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI;
  const lon = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
  return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export class Postcard {
  private readonly frame: HTMLElement;
  private readonly place: HTMLElement;
  private readonly detail: HTMLElement;
  private last = '';

  constructor(root: HTMLElement, private readonly store: ParamStore) {
    this.frame = el('div', 'postcard-frame');
    const card = el('figure', 'postcard-card');
    this.place = el('p', 'postcard-place', 'Cherry Blossom Waterways');
    this.detail = el('p', 'postcard-detail');
    const close = el('button', 'postcard-close', 'Close');
    close.addEventListener('click', () => store.set('ui.postcard', false));
    card.append(this.place, this.detail, close);
    this.frame.append(card);
    root.append(this.frame);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && store.values.ui.postcard) store.set('ui.postcard', false);
    });
    this.apply();
  }

  apply(): void {
    document.body.classList.toggle('postcard', this.store.values.ui.postcard);
  }

  update(focus: Vector3, radius: number): void {
    if (!this.store.values.ui.postcard) return;
    const p = this.store.values;
    const text = `${seasonFor(p.world.bloom)} · ${coordinates(focus)} · R ${Math.round(radius)} m`;
    if (text !== this.last) {
      this.last = text;
      this.detail.textContent = text;
    }
  }
}
