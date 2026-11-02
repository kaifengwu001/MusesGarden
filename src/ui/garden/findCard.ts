import type { Find, Interest } from '../../garden/types';
import { basketCalled, button, duration, el, toggle } from './dom';
import { ICONS } from './icons';

// A find's card, standing over its bed: tap a bed and the card rises there,
// its basket's day at its head. The card is drawn
// from the find's fields (never an embed): a reel or a video with its
// picture and length, a post with its picture and caption, an article with
// its headline, the site and the time it takes to read. Under it a heart
// (a like goes back to Muse and pins the find on your map), the link out,
// the find's topic, and a Public/Private switch (a private find never
// leaves the planet: other Muses don't see it). Swipe it, or press the
// arrows (← → on a keyboard), for the find before or after it in time, as
// on the basket's timeline; the camera flies there and the next card rises.
// An arrow whose step goes into another day's basket turns blue and says so.

export interface CardContext {
  /** Its basket's day (ISO). */
  day: string;
  /** What its head calls where it is shown from, in place of its basket's day (Muse's favourites, on the shelf in its hut). */
  from?: string;
  index: number;
  total: number;
  liked: boolean;
  /** Whether other Muses may see it. */
  shared: boolean;
  /** The day (ISO) of the basket a step back (older) or forward (newer) goes into; null within this basket. */
  crossing: { back: string | null; forward: string | null };
}

export interface CardActions {
  like(): void;
  share(findId: string, shared: boolean): void;
  step(direction: 1 | -1): void;
  close(): void;
}

/** The four species' colours in the interface (the meadow's palette), by variant: hue (°), saturation and lightness (%). */
function topicHsl(interest: Pick<Interest, 'species' | 'variant'> | undefined): readonly [number, number, number] {
  if (!interest) return [40, 30, 70];
  const v = interest.variant;
  switch (interest.species) {
    case 0:
      return [348 - 10 * v, 58 + 10 * v, 70 - 12 * v];
    case 1:
      return [46 + 8 * v, 30 + 20 * v, 90 - 8 * v];
    case 2:
      return [46 - 10 * v, 82, 62 - 6 * v];
    default:
      return [224 - 18 * v, 52 + 8 * v, 68 - 8 * v];
  }
}

/** A topic's colour as CSS. */
export function topicColour(interest: Pick<Interest, 'species' | 'variant'> | undefined): string {
  const [h, s, l] = topicHsl(interest);
  return `hsl(${h} ${s}% ${l}%)`;
}

/** A topic's colour as linear RGB (0 … 1), for what is drawn in the world (the favourites' lights on Muse's shelf). */
export function topicRgb(interest: Pick<Interest, 'species' | 'variant'> | undefined): [number, number, number] {
  const [h, s, l] = topicHsl(interest);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [channel(0), channel(8), channel(4)];
}

function media(find: Find): HTMLElement {
  const m = find.media;
  const box = el('div', 'g-media');
  box.style.aspectRatio = String(m.aspect ?? (m.kind === 'reel' ? 9 / 16 : m.kind === 'article' || m.kind === 'video' ? 16 / 9 : 1));
  if (m.image) {
    const img = el('img');
    img.src = m.image;
    img.alt = m.title ?? m.text ?? '';
    img.decoding = 'async';
    img.draggable = false;
    box.append(img);
  }
  if (m.kind === 'reel' || m.kind === 'video') {
    const play = el('span', 'g-play');
    play.innerHTML = ICONS.play;
    box.append(play);
    if (m.duration) box.append(el('span', 'g-duration', duration(m.duration)));
  }
  return box;
}

function head(find: Find, colour: string): HTMLElement {
  const m = find.media;
  const h = el('header', 'g-card-head');
  const avatar = el('span', 'g-avatar');
  avatar.style.setProperty('--topic', colour);
  avatar.textContent = (m.author ?? m.source).replace(/^@/, '').slice(0, 1).toUpperCase();
  const who = el('span', 'g-who');
  who.append(el('span', 'g-handle', m.author ?? m.source));
  const src = el('span', 'g-source');
  src.innerHTML = m.source === 'Instagram' ? ICONS.camera : '';
  src.append(m.kind === 'reel' ? 'Reel' : m.kind === 'video' ? `Video · ${m.source}` : m.source);
  who.append(src);
  h.append(avatar, who);
  return h;
}

/** The card's body for a find. */
export function cardBody(find: Find, interest: Interest | undefined): HTMLElement {
  const m = find.media;
  const colour = topicColour(interest);
  const body = el('div', `g-card-body g-kind-${m.kind}`);
  if (m.kind === 'article' || m.kind === 'video') {
    body.append(media(find));
    const text = el('div', 'g-article');
    text.append(el('p', 'g-kicker', m.kind === 'video' ? `${m.source} · ${m.author ?? ''}` : m.source));
    if (m.title) text.append(el('h3', 'g-headline', m.title));
    if (m.text) text.append(el('p', 'g-dek', m.text));
    const by = [m.kind === 'article' ? m.author : null, m.minutes ? `${m.minutes} min read` : null].filter(Boolean).join(' · ');
    if (by) text.append(el('p', 'g-byline', by));
    body.append(text);
  } else {
    body.append(head(find, colour), media(find));
    if (m.text) body.append(el('p', 'g-caption', m.text));
  }
  if (find.note) body.append(el('p', 'g-note', `“${find.note}”`));
  return body;
}

/** How long a card put away takes to leave (s): its layer stays up till then. */
const LEAVE = 0.45;

/** `v` (px) to the pixel, or `last` while `v` is still within a little over half a pixel of it. */
const steady = (v: number, last: number): number => (Math.abs(v - last) < 0.6 ? last : Math.round(v));

/** An arrow whose step goes into another day's basket (`day`, ISO; null: it stays in this one): blue, its line over it. */
function crossing(arrow: HTMLButtonElement, hint: HTMLElement, day: string | null, label: string): void {
  const text = day ? `Going to ${basketCalled(day)}` : '';
  arrow.classList.toggle('is-crossing', day !== null);
  arrow.setAttribute('aria-label', text || label);
  arrow.title = text || label;
  hint.textContent = text;
  hint.classList.toggle('is-on', day !== null);
}

export class FindCard {
  readonly el: HTMLElement;
  private readonly card: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly content: HTMLElement;
  private readonly likeButton: HTMLButtonElement;
  private readonly openLink: HTMLAnchorElement;
  private readonly topic: HTMLElement;
  private readonly share: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly prevHint: HTMLElement;
  private readonly nextHint: HTMLElement;
  /** Seconds the layer stays up after the card is put away, while it leaves. */
  private leaving = 0;
  /** Where the card was last put (px). */
  private readonly placed = { left: Number.NaN, top: Number.NaN };
  private open = false;
  private swipe: { id: number; x: number; y: number; dx: number } | null = null;
  private findId: string | null = null;

  constructor(parent: HTMLElement, private readonly actions: CardActions) {
    this.el = el('div', 'g-findlayer');
    this.card = el('article', 'g-card');
    this.card.setAttribute('aria-live', 'polite');
    this.kicker = el('p', 'g-card-kicker');
    this.content = el('div', 'g-card-content');
    const foot = el('footer', 'g-card-foot');
    this.likeButton = button('g-like', 'Like', ICONS.heart, () => actions.like());
    this.openLink = el('a', 'g-open');
    this.openLink.target = '_blank';
    this.openLink.rel = 'noopener noreferrer';
    this.openLink.innerHTML = `<span>Open</span>${ICONS.open}`;
    this.topic = el('span', 'g-topic');
    foot.append(this.likeButton, this.topic, this.openLink);
    this.share = el('div', 'g-card-share');
    this.share.title = 'Public: other Muses can see it. Private: it never leaves your planet.';
    const close = button('g-card-close', 'Close', ICONS.close, () => actions.close());
    this.card.append(this.kicker, close, this.content, foot, this.share);
    this.prev = button('g-step g-step-prev', 'Earlier find', ICONS.left, () => actions.step(-1));
    this.next = button('g-step g-step-next', 'Later find', ICONS.right, () => actions.step(1));
    this.prevHint = el('span', 'g-step-hint g-step-hint-prev');
    this.nextHint = el('span', 'g-step-hint g-step-hint-next');
    this.el.append(this.card, this.prev, this.next, this.prevHint, this.nextHint);
    parent.append(this.el);
    this.card.addEventListener('pointerdown', (e) => this.swipeStart(e));
    this.card.addEventListener('pointermove', (e) => this.swipeMove(e));
    this.card.addEventListener('pointerup', (e) => this.swipeEnd(e));
    this.card.addEventListener('pointercancel', () => this.swipeEnd(null));
  }

  get shown(): string | null {
    return this.open ? this.findId : null;
  }

  /** Fill the card for a find and let it rise. */
  show(find: Find, interest: Interest | undefined, context: CardContext): void {
    this.findId = find.id;
    this.content.replaceChildren(cardBody(find, interest));
    this.card.className = `g-card g-card--${find.media.kind}`;
    const called = context.from ?? basketCalled(context.day);
    this.kicker.textContent = `${called[0].toUpperCase()}${called.slice(1)} · ${context.index + 1} of ${context.total}`;
    crossing(this.prev, this.prevHint, context.crossing.back, 'Earlier find');
    crossing(this.next, this.nextHint, context.crossing.forward, 'Later find');
    this.openLink.href = find.media.url;
    this.openLink.querySelector('span')!.textContent = find.media.kind === 'article' ? 'Read' : 'Open';
    this.openLink.title = `Open on ${find.media.source}`;
    this.topic.innerHTML = '';
    const dot = el('i');
    dot.style.background = topicColour(interest);
    this.topic.append(dot, interest?.name ?? find.topic);
    this.setLiked(context.liked, false);
    this.share.replaceChildren(toggle('Let other Muses see this find', context.shared, (on) => this.actions.share(find.id, on), ['Public', 'Private']));
    this.open = true;
    this.leaving = 0;
    this.el.classList.add('is-on');
    this.card.classList.remove('is-up', 'is-leaving-left', 'is-leaving-right');
    this.card.style.removeProperty('--swipe');
    // straight to its hidden pose, from wherever the last card left: place() lets it rise from there
    this.card.style.transition = 'none';
    void this.card.offsetWidth;
    this.card.style.removeProperty('transition');
  }

  /** Send the card off (to the side it was swiped, or down). */
  hide(direction: 1 | -1 | 0 = 0): void {
    if (!this.open) return;
    this.open = false;
    this.leaving = LEAVE;
    this.card.classList.remove('is-up');
    if (direction !== 0) this.card.classList.add(direction > 0 ? 'is-leaving-left' : 'is-leaving-right');
  }

  setLiked(liked: boolean, animate = true): void {
    this.likeButton.innerHTML = liked ? ICONS.heartFilled : ICONS.heart;
    this.likeButton.classList.toggle('is-liked', liked);
    this.likeButton.setAttribute('aria-pressed', String(liked));
    this.likeButton.title = liked ? 'Liked: pinned on your map' : 'Like';
    if (animate && liked) {
      this.likeButton.classList.remove('is-popping');
      void this.likeButton.offsetWidth;
      this.likeButton.classList.add('is-popping');
    }
  }

  /**
   * Each frame: where the card stands over its bed on screen (px), or null when the bed is out of view. The card
   * stands there, kept inside the screen; the arrows sit at its sides, a crossing's line over its arrow.
   */
  place(at: { x: number; y: number } | null, dt: number, width: number, height: number): void {
    this.leaving = Math.max(0, this.leaving - dt);
    const visible = at !== null && (this.open || this.leaving > 0);
    this.el.classList.toggle('is-on', visible);
    if (!visible || !at) return;
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    const margin = 14;
    const phone = width < 700;
    const right = phone ? margin : 88; // clear of the rail
    const bottom = phone ? 150 : 96; // clear of the controls
    const above = phone ? 64 : margin; // clear of the panel's corner on a phone
    const cx = Math.min(Math.max(at.x, margin + w / 2), width - right - w / 2);
    const cardBottom = Math.min(Math.max(at.y, above + h), height - bottom);
    // to the pixel, kept unless it truly moved: a framed bed stands at the screen's middle, where half an odd card's
    // width falls on half a pixel, and the camera's float noise at rest flipped the rounding to and fro
    const left = (this.placed.left = steady(cx - w / 2, this.placed.left));
    const top = (this.placed.top = steady(cardBottom - h, this.placed.top));
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
    // (placed before it rises, so it rises where it stands)
    if (this.open && !this.card.classList.contains('is-up')) this.card.classList.add('is-up');
    const arrowTop = top + Math.round(h / 2 - 22);
    const prevLeft = left - 54;
    const nextLeft = left + w + 10;
    this.prev.style.left = `${prevLeft}px`;
    this.next.style.left = `${nextLeft}px`;
    this.prev.style.top = this.next.style.top = `${arrowTop}px`;
    // each line runs outward from over its arrow, kept on the screen
    const hintTop = `${arrowTop - 30}px`;
    const pw = this.prevHint.offsetWidth;
    this.prevHint.style.left = `${Math.round(Math.max(margin, prevLeft + 44 - pw))}px`;
    this.nextHint.style.left = `${Math.round(Math.min(nextLeft, width - right - this.nextHint.offsetWidth))}px`;
    this.prevHint.style.top = this.nextHint.style.top = hintTop;
  }

  private swipeStart(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button, a, label') || !this.open) return;
    this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
    this.card.setPointerCapture(e.pointerId);
    this.card.classList.add('is-dragging');
  }

  private swipeMove(e: PointerEvent): void {
    const s = this.swipe;
    if (!s || s.id !== e.pointerId) return;
    s.dx = e.clientX - s.x;
    this.card.style.setProperty('--swipe', `${s.dx}px`);
  }

  private swipeEnd(e: PointerEvent | null): void {
    const s = this.swipe;
    if (!s || (e && s.id !== e.pointerId)) return;
    this.swipe = null;
    this.card.classList.remove('is-dragging');
    this.card.style.removeProperty('--swipe');
    if (Math.abs(s.dx) > 70) this.actions.step(s.dx < 0 ? 1 : -1);
  }
}
