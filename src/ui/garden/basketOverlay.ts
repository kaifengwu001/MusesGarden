import type { Fan } from './basketFan';
import type { Target } from './basketMachine';
import { el } from './dom';
import { dayLabel, nearestDot, timelineLayout, type TimelineLayout } from './timeline';

// What you touch while the basket is out, over its canvas (basketStage.ts):
// a scrim that keeps every drag and wheel off the planet (a click on it puts
// the basket away), a button over each fanned flower and one over the basket,
// placed each frame where they are drawn (hover, focus and the keyboard, with
// no 3D picking), a light preview of the one under the pointer, and under
// the basket the baskets by day: a dot per basket along a track that bulges
// round the pointer so a dense run of days stays easy to hit.

/** Where the buttons go this frame: each fanned flower's head and the basket, on the screen (px). */
export interface ButtonLayout {
  readonly flowers: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>;
  readonly basket: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
}

/** A basket on the timeline: its day, Muse's name for it, and whether you have opened it. */
export interface DayEntry {
  readonly id: string;
  readonly day: string;
  readonly title?: string;
  readonly fresh: boolean;
}

export interface OverlayActions {
  hover(target: Target | null): void;
  /** A flower or the basket clicked or tapped (`touch`: by a finger, whose first tap only previews). */
  pick(target: Target, touch: boolean): void;
  /** The timeline moved to another basket. */
  day(basket: string): void;
  dismiss(): void;
  /** A target's name for screen readers, and its preview. */
  label(target: Target): string;
  preview(target: Target): HTMLElement | null;
}

/** The timeline's widest (px), and how far under the basket it sits (px). */
const TRACK = { width: 460, under: 26 } as const;

const key = (t: Target): string => (t.kind === 'basket' ? 'basket' : `find:${t.id}`);

export class BasketOverlay {
  readonly layer: HTMLElement;
  /** Where the basket's canvas goes: over the scrim, under the buttons. */
  readonly stage: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly hits: HTMLElement;
  private readonly more: HTMLElement;
  private readonly peek: HTMLElement;
  private readonly days: HTMLElement;
  private readonly track: HTMLElement;
  private readonly label: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private touch = false;
  private entries: DayEntry[] = [];
  private picked = 0;
  /** Where the pointer is on the track (px), while over it or dragging it. */
  private pointerX: number | null = null;
  private dragging: number | null = null;
  private width: number = TRACK.width;
  private shownPeek: string | null = null;
  private fanSize = 60;

  constructor(
    parent: HTMLElement,
    private readonly actions: OverlayActions,
  ) {
    this.layer = el('div', 'g-basket');
    this.scrim = el('div', 'g-basket-scrim');
    this.stage = el('div', 'g-basket-stage');
    this.hits = el('div', 'g-basket-hits');
    this.more = el('span', 'g-basket-more');
    this.peek = el('div', 'g-peek');
    this.peek.setAttribute('role', 'tooltip');
    this.peek.id = 'g-peek';
    this.days = el('div', 'g-days');
    this.days.tabIndex = 0;
    this.days.setAttribute('role', 'slider');
    this.days.setAttribute('aria-label', 'Baskets by day');
    this.days.setAttribute('aria-valuemin', '0');
    this.track = el('div', 'g-days-track');
    this.label = el('p', 'g-days-label');
    this.label.setAttribute('aria-hidden', 'true');
    this.days.append(this.label, this.track);
    // (the days first: from the keyboard, Tab goes from them to the flowers, then the basket)
    this.layer.append(this.scrim, this.stage, this.days, this.hits, this.more, this.peek);
    parent.append(this.layer);

    // the scrim takes every gesture meant for the planet; a click on it is a click outside the basket
    this.scrim.addEventListener('click', () => this.actions.dismiss());
    for (const type of ['wheel', 'touchmove'] as const) this.scrim.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    this.days.addEventListener('pointerdown', (e) => this.dragStart(e));
    this.days.addEventListener('pointermove', (e) => this.dragMove(e));
    this.days.addEventListener('pointerup', (e) => this.dragEnd(e));
    this.days.addEventListener('pointercancel', (e) => this.dragEnd(e));
    this.days.addEventListener('pointerleave', () => {
      if (this.dragging === null) this.pointer(null);
    });
    this.days.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  /** Out (opening, open, swapping): the scrim holds the pointer and the buttons and timeline show. Otherwise all of it steps back. */
  sync(out: boolean): void {
    const was = this.layer.classList.contains('is-out');
    this.layer.classList.toggle('is-out', out);
    document.body.classList.toggle('g-basket-open', out);
    // the keyboard comes into the basket: the arrows already move through the days, Tab goes on to the flowers
    if (out && !was) this.days.focus({ preventScroll: true });
    if (!out) {
      this.dragging = null;
      this.pointerX = null;
      this.showPeek(null, null);
      if (this.layer.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }
  }

  /** The baskets by day and the one out; where the fan is (the timeline goes under its basket). */
  show(entries: readonly DayEntry[], current: string, fan: Fan): void {
    this.entries = [...entries].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    this.picked = Math.max(0, this.entries.findIndex((e) => e.id === current));
    this.fanSize = fan.size;
    const free = Math.max(160, Math.min(TRACK.width, (fan.basket.right - fan.basket.left) * 3.4, window.innerWidth - 48));
    this.width = free;
    this.days.style.width = `${free}px`;
    this.days.style.left = `${Math.round(Math.min(window.innerWidth - free / 2 - 16, Math.max(free / 2 + 16, fan.basket.x)) - free / 2)}px`;
    this.days.style.top = `${Math.round(fan.basket.bottom + TRACK.under)}px`;
    this.days.setAttribute('aria-valuemax', String(Math.max(0, this.entries.length - 1)));
    this.render();
  }

  /** The keyboard's arrows: an older (−1) or newer (+1) basket. */
  step(direction: 1 | -1): void {
    const next = Math.min(this.entries.length - 1, Math.max(0, this.picked + direction));
    if (next !== this.picked) this.choose(next);
  }

  /** Each frame: the buttons over what the stage drew, the "+N" on the basket, the preview of `preview`. */
  place(layout: ButtonLayout, more: number, preview: Target | null): void {
    const seen = new Set<string>();
    const size = this.fanSize;
    for (const f of layout.flowers) {
      const target: Target = { kind: 'find', id: f.id };
      const b = this.button(target);
      seen.add(key(target));
      b.style.width = b.style.height = `${size}px`;
      b.style.transform = `translate(${(f.x - size / 2).toFixed(1)}px, ${(f.y - size / 2).toFixed(1)}px)`;
    }
    const basket = layout.basket;
    if (basket) {
      const target: Target = { kind: 'basket' };
      const b = this.button(target);
      seen.add(key(target));
      // its body, below the handle
      const w = basket.width * 0.82;
      const h = basket.height * 0.55;
      b.style.width = `${w.toFixed(1)}px`;
      b.style.height = `${h.toFixed(1)}px`;
      b.style.transform = `translate(${(basket.x - w / 2).toFixed(1)}px, ${(basket.y + basket.height / 2 - h).toFixed(1)}px)`;
      this.more.textContent = more > 0 ? `+${more}` : '';
      this.more.classList.toggle('is-on', more > 0);
      this.more.style.transform = `translate(${(basket.x + w * 0.32).toFixed(1)}px, ${(basket.y + basket.height * 0.36).toFixed(1)}px)`;
    } else this.more.classList.remove('is-on');
    for (const [k, b] of this.buttons) {
      if (seen.has(k)) continue;
      b.remove();
      this.buttons.delete(k);
    }
    const anchor = preview ? this.buttons.get(key(preview)) : undefined;
    this.showPeek(preview && anchor ? preview : null, anchor ?? null);
  }

  private button(target: Target): HTMLButtonElement {
    const k = key(target);
    let b = this.buttons.get(k);
    if (b) return b;
    b = el('button', target.kind === 'basket' ? 'g-basket-hit is-basket' : 'g-basket-hit');
    b.type = 'button';
    b.setAttribute('aria-label', this.actions.label(target));
    b.setAttribute('aria-describedby', 'g-peek');
    b.addEventListener('pointerdown', (e) => (this.touch = e.pointerType === 'touch'));
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') this.actions.hover(target);
    });
    b.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.actions.hover(null);
    });
    // focus from the keyboard previews; a tap focuses too, and that first tap is the preview already
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) this.actions.hover(target);
    });
    b.addEventListener('blur', () => this.actions.hover(null));
    b.addEventListener('click', (e) => {
      // a click from the keyboard (detail 0) is never a finger's first tap
      const touch = this.touch && e.detail > 0;
      this.touch = false;
      this.actions.pick(target, touch);
    });
    this.hits.append(b);
    this.buttons.set(k, b);
    return b;
  }

  private showPeek(target: Target | null, anchor: HTMLElement | null): void {
    const k = target ? key(target) : null;
    if (k !== this.shownPeek) {
      this.shownPeek = k;
      const body = target ? this.actions.preview(target) : null;
      this.peek.replaceChildren(...(body ? [body] : []));
      this.peek.classList.toggle('is-on', body !== null);
    }
    if (!anchor || !this.peek.classList.contains('is-on')) return;
    // beside the flower, on the side with room, inside the screen
    const r = anchor.getBoundingClientRect();
    const w = this.peek.offsetWidth;
    const h = this.peek.offsetHeight;
    const gap = 14;
    const right = r.right + gap + w < window.innerWidth - 12;
    const x = right ? r.right + gap : r.left - gap - w;
    const y = Math.min(window.innerHeight - h - 12, Math.max(12, r.top + r.height / 2 - h / 2));
    this.peek.style.transform = `translate(${Math.max(12, x).toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // ---- the timeline ----------------------------------------------------------------------------------

  private layoutAt(focus: number | null): TimelineLayout {
    return timelineLayout(
      this.entries.map((e) => e.day),
      focus,
      this.width,
    );
  }

  /** The lens round the pointer while it is over the track, else round the basket out. */
  private current(): TimelineLayout {
    const focus = this.pointerX ?? this.layoutAt(null).xs[this.picked] ?? null;
    return this.layoutAt(focus);
  }

  private render(): void {
    const n = this.entries.length;
    const layout = this.current();
    const hovered = this.pointerX !== null ? nearestDot(layout, this.pointerX) : null;
    const dots: HTMLElement[] = this.entries.map((e, i) => {
      const dot = el('b', 'g-days-dot');
      dot.style.left = `${layout.xs[i].toFixed(1)}px`;
      if (i === this.picked) dot.classList.add('is-picked');
      if (e.fresh) dot.classList.add('is-new');
      if (i === hovered) dot.classList.add('is-hover');
      return dot;
    });
    const ticks = layout.ticks.map((t) => {
      const tick = el('i', 'g-days-tick');
      tick.style.left = `${t.x.toFixed(1)}px`;
      if (t.label) tick.append(el('span', '', t.label));
      return tick;
    });
    this.track.replaceChildren(...ticks, ...dots);
    const shown = hovered ?? this.picked;
    const entry = this.entries[shown];
    const text = entry ? dayLabel(entry.day, entry.title) : '';
    this.label.textContent = text;
    this.label.classList.toggle('is-hover', hovered !== null && hovered !== this.picked);
    const x = layout.xs[shown] ?? this.width / 2;
    const w = this.label.offsetWidth;
    this.label.style.left = `${Math.min(this.width - w / 2, Math.max(w / 2, x)).toFixed(1)}px`;
    const picked = this.entries[this.picked];
    this.days.setAttribute('aria-valuenow', String(this.picked));
    this.days.setAttribute('aria-valuetext', picked ? dayLabel(picked.day, picked.title) : '');
    this.days.classList.toggle('is-single', n < 2);
  }

  private choose(index: number): void {
    this.picked = index;
    this.render();
    const entry = this.entries[index];
    if (entry) this.actions.day(entry.id);
  }

  private trackX(e: PointerEvent): number {
    return e.clientX - this.track.getBoundingClientRect().left;
  }

  private pointer(x: number | null): void {
    this.pointerX = x;
    this.render();
  }

  private dragStart(e: PointerEvent): void {
    if (this.entries.length < 2) return;
    this.dragging = e.pointerId;
    this.days.setPointerCapture(e.pointerId);
    this.dragMove(e);
  }

  private dragMove(e: PointerEvent): void {
    if (this.dragging !== null && e.pointerId !== this.dragging) return;
    const x = this.trackX(e);
    this.pointer(x);
    if (this.dragging === null) return;
    const i = nearestDot(this.current(), x);
    if (i !== this.picked) this.choose(i);
  }

  private dragEnd(e: PointerEvent): void {
    if (e.pointerId !== this.dragging) return;
    this.dragging = null;
    if (e.pointerType === 'touch') this.pointer(null);
  }
}
