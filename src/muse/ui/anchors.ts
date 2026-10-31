import type { Dir, DiscoveryId, PlantCard, PlantPreview } from '../contract';
import { button, el, outLink, thumb } from './dom';
import type { Pin, Pins } from './pins';

/** One collected object where it stands on the planet being shown. */
export interface Anchor {
  readonly id: DiscoveryId;
  readonly dir: Dir;
  /** null: a private find on a friend's planet, shown only as where it stands. */
  readonly preview: PlantPreview | null;
  /** The full card: carried by a visit, fetched on click at home. */
  readonly card: () => Promise<PlantCard | null>;
}

interface Placed {
  /** What the target shows: a refetch with the same key keeps the target (and its hover or focus). */
  readonly key: string;
  readonly pin: Pin;
}

const keyOf = (a: Anchor): string => JSON.stringify([a.dir, a.preview]);

/**
 * A quiet glint over every collected object on the planet being shown (the renderer will draw the
 * object itself later). Hover or focus shows its preview; a click opens its card. The glints are
 * DOM over the canvas, so their pointer events never reach the canvas's gust, ripple or bloom.
 */
export class Anchors {
  /** The open card. */
  readonly panel = el('section', 'mu-panel mu-object');
  private readonly preview = el('span', 'mu-preview');
  private readonly placed = new Map<DiscoveryId, Placed>();
  private opener: HTMLElement | null = null;

  constructor(
    private readonly pins: Pins,
    /** A card opened: close whatever else sits in its place. */
    private readonly onOpen: () => void,
  ) {
    this.preview.id = 'mu-preview';
    this.preview.setAttribute('role', 'tooltip');
    this.panel.hidden = true;
    this.panel.tabIndex = -1;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'A find');
  }

  /** Show exactly these objects, keeping the targets of any already shown. */
  set(anchors: readonly Anchor[]): void {
    const next = new Map(anchors.map((a) => [a.id, keyOf(a)]));
    for (const [id, p] of this.placed) {
      if (next.get(id) === p.key) continue;
      this.pins.remove(p.pin);
      this.placed.delete(id);
    }
    for (const anchor of anchors) {
      if (!this.placed.has(anchor.id)) this.placed.set(anchor.id, { key: keyOf(anchor), pin: this.pins.add(this.target(anchor), anchor.dir) });
    }
  }

  /** Draw the eye to one object for a moment. */
  highlight(id: DiscoveryId): void {
    const target = this.placed.get(id)?.pin.el;
    if (!target) return;
    target.classList.remove('mu-glow');
    void target.offsetWidth; // restart the animation
    target.classList.add('mu-glow');
  }

  /** Esc: true when there was a card to close. */
  close(): boolean {
    if (this.panel.hidden) return false;
    const hadFocus = this.panel.contains(document.activeElement);
    this.panel.hidden = true;
    if (hadFocus && this.opener?.isConnected && !this.opener.inert) this.opener.focus({ preventScroll: true });
    return true;
  }

  private target(anchor: Anchor): HTMLElement {
    const glint = el('span', 'mu-glint');
    // Each glint twinkles on its own beat.
    glint.style.animationDelay = `${-(hashOf(anchor.id) % 4000)}ms`;
    const preview = anchor.preview;
    if (!preview) {
      const dot = el('span', 'mu-plant mu-private');
      dot.append(glint);
      return dot;
    }
    const b = button('', 'mu-plant', () => void this.open(anchor, b));
    b.setAttribute('aria-label', preview.title);
    b.setAttribute('aria-describedby', this.preview.id);
    b.append(glint);
    const show = (): void => {
      this.preview.replaceChildren(...[thumb(preview.thumb, 'mu-preview-thumb'), el('span', 'mu-title', preview.title), el('span', 'mu-quote', preview.reason)].filter((n) => n !== null));
      b.append(this.preview);
    };
    const hide = (): void => {
      if (this.preview.parentElement === b && !b.matches(':hover, :focus-visible')) this.preview.remove();
    };
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('pointerleave', hide);
    b.addEventListener('blur', hide);
    return b;
  }

  private async open(anchor: Anchor, opener: HTMLElement): Promise<void> {
    this.opener = opener;
    this.preview.remove();
    this.onOpen();
    let card: PlantCard | null;
    try {
      card = await anchor.card();
    } catch (error) {
      this.render(el('p', 'mu-error', `Couldn’t reach the garden (${error instanceof Error ? error.message : 'unknown error'}).`));
      return;
    }
    if (!card) {
      this.render(el('p', 'mu-empty', 'This one keeps to itself.'));
      return;
    }
    const body = el('div', 'mu-card-body');
    const why = el('p', 'mu-why');
    why.append(el('span', 'mu-eyebrow', 'Why I kept this'), el('span', 'mu-quote', card.reason));
    const open = outLink(card.url, 'mu-btn mu-primary');
    open.textContent = 'Open ↗';
    const actions = el('div', 'mu-actions');
    actions.append(open, button('Close', 'mu-btn', () => this.close()));
    body.append(why, el('h3', 'mu-title', card.title), el('p', 'mu-summary', card.summary), actions);
    this.render(...[thumb(card.thumb, 'mu-thumb'), body].filter((n) => n !== null));
  }

  private render(...nodes: HTMLElement[]): void {
    this.panel.replaceChildren(...nodes);
    this.panel.hidden = false;
    this.panel.focus({ preventScroll: true });
  }
}

/** A small stable number from an id (FNV-1a). */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
