import type { Find, Interest } from '../../garden/types';
import { button, duration, el } from './dom';
import { ICONS } from './icons';

// A find's card, standing over its bed on a thin line: tap a bed and the
// line rises from it, then the card pops up at its top. The card is drawn
// from the find's fields (never an embed): a reel or a video with its
// picture and length, a post with its picture and caption, an article with
// its headline, the site and the time it takes to read. Under it a heart
// (a like goes back to Muse and pins the find on your map), the link out,
// and the find's topic. Swipe it, or press the arrows (← → on a keyboard),
// for the next find; the camera flies there and the next card rises.

export interface CardContext {
  /** 'Today’s basket', 'Tuesday’s basket'. */
  basket: string;
  index: number;
  total: number;
  liked: boolean;
}

export interface CardActions {
  like(): void;
  step(direction: 1 | -1): void;
  close(): void;
}

/** The four species' colours in the interface (the meadow's palette, as CSS), by variant. */
export function topicColour(interest: Pick<Interest, 'species' | 'variant'> | undefined): string {
  if (!interest) return 'hsl(40 30% 70%)';
  const v = interest.variant;
  switch (interest.species) {
    case 0:
      return `hsl(${348 - 10 * v} ${58 + 10 * v}% ${70 - 12 * v}%)`;
    case 1:
      return `hsl(${46 + 8 * v} ${30 + 20 * v}% ${90 - 8 * v}%)`;
    case 2:
      return `hsl(${46 - 10 * v} ${82}% ${62 - 6 * v}%)`;
    default:
      return `hsl(${224 - 18 * v} ${52 + 8 * v}% ${68 - 8 * v}%)`;
  }
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

export class FindCard {
  readonly el: HTMLElement;
  private readonly stem: SVGLineElement;
  private readonly dot: SVGCircleElement;
  private readonly card: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly content: HTMLElement;
  private readonly likeButton: HTMLButtonElement;
  private readonly openLink: HTMLAnchorElement;
  private readonly topic: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  /** The line's rise: 0 at the bed, 1 at the card; animated toward `riseTo`. */
  private rise = 0;
  private riseTo = 0;
  private open = false;
  private swipe: { id: number; x: number; y: number; dx: number } | null = null;
  private findId: string | null = null;

  constructor(parent: HTMLElement, private readonly actions: CardActions) {
    this.el = el('div', 'g-findlayer');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('g-stem');
    this.stem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.dot.setAttribute('r', '5');
    svg.append(this.stem, this.dot);
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
    const close = button('g-card-close', 'Close', ICONS.close, () => actions.close());
    this.card.append(this.kicker, close, this.content, foot);
    this.prev = button('g-step g-step-prev', 'Previous find', ICONS.left, () => actions.step(-1));
    this.next = button('g-step g-step-next', 'Next find', ICONS.right, () => actions.step(1));
    this.el.append(svg, this.card, this.prev, this.next);
    parent.append(this.el);
    this.card.addEventListener('pointerdown', (e) => this.swipeStart(e));
    this.card.addEventListener('pointermove', (e) => this.swipeMove(e));
    this.card.addEventListener('pointerup', (e) => this.swipeEnd(e));
    this.card.addEventListener('pointercancel', () => this.swipeEnd(null));
  }

  get shown(): string | null {
    return this.open ? this.findId : null;
  }

  /** Fill the card for a find and let it rise (the line first, then the card). */
  show(find: Find, interest: Interest | undefined, context: CardContext): void {
    this.findId = find.id;
    this.content.replaceChildren(cardBody(find, interest));
    this.card.className = `g-card g-card--${find.media.kind}`;
    this.kicker.textContent = `${context.basket} · ${context.index + 1} of ${context.total}`;
    this.openLink.href = find.media.url;
    this.openLink.querySelector('span')!.textContent = find.media.kind === 'article' ? 'Read' : find.media.source === 'Instagram' ? 'Open in Instagram' : 'Open';
    this.topic.innerHTML = '';
    const dot = el('i');
    dot.style.background = topicColour(interest);
    this.topic.append(dot, interest?.name ?? find.topic);
    this.setLiked(context.liked, false);
    this.open = true;
    this.rise = 0;
    this.riseTo = 1;
    this.el.classList.add('is-on');
    this.card.classList.remove('is-up', 'is-leaving-left', 'is-leaving-right');
    this.card.style.removeProperty('--swipe');
  }

  /** Send the card off (to the side it was swiped, or down) and let the line sink back. */
  hide(direction: 1 | -1 | 0 = 0): void {
    if (!this.open) return;
    this.open = false;
    this.riseTo = 0;
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
   * Each frame: where the bed's foot and the line's top are on screen (px), or null when the bed is out of
   * view. The card stands on the line's top, kept inside the screen; the arrows sit at its sides.
   */
  place(foot: { x: number; y: number } | null, top: { x: number; y: number } | null, dt: number, width: number, height: number): void {
    const step = Math.min(1, dt / 0.32);
    this.rise += (this.riseTo - this.rise) * (this.riseTo > this.rise ? 1 - Math.pow(1 - step, 2) : step * 1.4);
    if (Math.abs(this.riseTo - this.rise) < 0.002) this.rise = this.riseTo;
    const visible = foot !== null && top !== null && (this.open || this.rise > 0.01);
    this.el.classList.toggle('is-on', visible);
    if (!visible || !foot || !top) return;
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    const margin = 14;
    const right = width < 700 ? margin : 88; // clear of the rail
    const bottom = width < 700 ? 150 : 96; // clear of the controls
    const cx = Math.min(Math.max(top.x, margin + w / 2), width - right - w / 2);
    const cardBottom = Math.min(Math.max(top.y, margin + h), height - bottom);
    this.card.style.left = `${Math.round(cx - w / 2)}px`;
    this.card.style.top = `${Math.round(cardBottom - h)}px`;
    // the line from the bed to the card's foot, risen this far
    const ty = foot.y + (cardBottom - foot.y) * this.rise;
    const tx = foot.x + (cx - foot.x) * this.rise;
    this.stem.setAttribute('x1', String(foot.x));
    this.stem.setAttribute('y1', String(foot.y));
    this.stem.setAttribute('x2', String(tx));
    this.stem.setAttribute('y2', String(ty));
    this.dot.setAttribute('cx', String(foot.x));
    this.dot.setAttribute('cy', String(foot.y));
    if (this.open && this.rise > 0.9 && !this.card.classList.contains('is-up')) this.card.classList.add('is-up');
    const top0 = cardBottom - h;
    this.prev.style.left = `${Math.round(cx - w / 2 - 54)}px`;
    this.next.style.left = `${Math.round(cx + w / 2 + 10)}px`;
    this.prev.style.top = this.next.style.top = `${Math.round(top0 + h / 2 - 22)}px`;
  }

  private swipeStart(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button, a') || !this.open) return;
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
