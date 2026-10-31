import type { BasketId, BasketView, InvitationCard, MuseId, PhotoId, PhotoSubject, PhotoView, PlantCard } from '../contract';
import type { Answer, MuseApi } from './api';
import { arrowNav, button, day, el, outLink, thumb, time } from './dom';
import { photoHash } from './pose';

type Tab = 'baskets' | 'photos' | 'letters';
const TABS: readonly (readonly [Tab, string])[] = [
  ['baskets', 'Baskets'],
  ['photos', 'Photos'],
  ['letters', 'Invitations'],
];

const ANSWER_LABEL: Record<Answer, string> = { approve: 'Approve', accept: 'Accept', decline: 'Decline' };

/** A find from a basket: why Muse kept it, then what it is. Opens the page. */
export function findCard(card: PlantCard): HTMLAnchorElement {
  const a = outLink(card.url, 'mu-card');
  a.dataset.card = '';
  const img = thumb(card.thumb, 'mu-thumb');
  if (img) a.append(img);
  const body = el('div', 'mu-card-body');
  const why = el('p', 'mu-why');
  why.append(el('span', 'mu-eyebrow', 'Why I kept this'), el('span', 'mu-quote', card.reason));
  body.append(why, el('h3', 'mu-title', card.title), el('p', 'mu-summary', card.summary), el('span', 'mu-open', 'Read the page ↗'));
  a.append(body);
  return a;
}

function photoTitle(p: PhotoView): string {
  const who = p.companionNames.join(' and ');
  const titles: Record<PhotoSubject, string> = {
    selfie: 'A selfie',
    scenery: 'Scenery',
    creature: 'A creature',
    find: 'A find',
    friend: who ? `With ${who}` : 'With a friend',
    'new-friend': who ? `A new friend: ${who}` : 'A new friend',
  };
  return titles[p.subject];
}

function photoPlace(p: PhotoView, self: MuseId): string {
  if (p.planetOf === self) return 'at home';
  const i = p.companions.indexOf(p.planetOf);
  return i >= 0 ? `on ${p.companionNames[i]}’s planet` : 'on a friend’s planet';
}

function photoCard(p: PhotoView, self: MuseId): HTMLAnchorElement {
  const a = outLink(`${location.pathname}${location.search}#${photoHash(p)}`, 'mu-card mu-photo');
  a.dataset.card = '';
  a.dataset.subject = p.subject;
  const print = el('div', 'mu-print');
  print.append(el('span', 'mu-print-title', photoTitle(p)));
  const body = el('div', 'mu-card-body');
  body.append(el('p', 'mu-caption', `${day(p.at)}, ${time(p.at)} · ${photoPlace(p, self)}`), el('span', 'mu-open', 'Step into the view ↗'));
  a.append(print, body);
  return a;
}

/** Pages of cards with a finite "earlier" button at the end, never an endless feed. */
class Paged<Item, Cursor> {
  readonly el = el('div', 'mu-pages');
  private next: Cursor | null = null;
  private readonly more: HTMLButtonElement;

  constructor(
    private readonly load: (before: Cursor | null) => Promise<{ readonly items: readonly Item[]; readonly next: Cursor | null }>,
    private readonly render: (items: readonly Item[]) => HTMLElement[],
    moreLabel: string,
    private readonly empty: string,
  ) {
    this.more = button(moreLabel, 'mu-btn mu-more', () => void this.page(false));
    arrowNav(this.el);
  }

  async reset(): Promise<void> {
    await this.page(true);
  }

  private async page(first: boolean): Promise<void> {
    this.more.disabled = true;
    const got = await this.load(first ? null : this.next);
    this.next = got.next;
    const nodes = this.render(got.items);
    if (first) this.el.replaceChildren(...(nodes.length ? nodes : [el('p', 'mu-empty', this.empty)]));
    else this.more.before(...nodes);
    this.more.disabled = false;
    if (this.next !== null) this.el.append(this.more);
    else this.more.remove();
    if (!first) nodes[0]?.querySelector<HTMLElement>('[data-card]')?.focus();
  }
}

export class Mailbox {
  readonly el = el('section', 'mu-panel mu-mailbox');
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly bodies: Record<Tab, HTMLElement>;
  private readonly baskets: Paged<BasketView, BasketId>;
  private readonly photos: Paged<PhotoView, PhotoId>;
  private readonly letters = el('div', 'mu-letters');
  private tab: Tab = 'baskets';

  constructor(
    private readonly api: MuseApi,
    private readonly museName: () => string,
    /** After an answer: the overlay refreshes everything that may have changed. */
    private readonly changed: () => void,
    /** Opens visit mode for an invitation. */
    private readonly visit: (card: InvitationCard) => void,
  ) {
    this.el.setAttribute('aria-label', 'Mailbox');
    this.baskets = new Paged(
      (before) => api.baskets(before),
      (items) => items.map((b) => this.basket(b)),
      'Earlier baskets',
      'No baskets yet. Muse sends one when it has found enough.',
    );
    this.photos = new Paged(
      (before) => api.photos(before),
      (items) => {
        const row = el('div', 'mu-strip');
        row.dataset.row = '';
        row.append(...items.map((p) => photoCard(p, api.museId)));
        return items.length ? [row] : [];
      },
      'Earlier photos',
      'No photos yet.',
    );
    this.bodies = { baskets: this.baskets.el, photos: this.photos.el, letters: this.letters };

    const tabs = el('div', 'mu-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [tab, label] of TABS) {
      const b = button(label, 'mu-tab', () => void this.show(tab));
      b.setAttribute('role', 'tab');
      b.dataset.tab = tab;
      this.tabButtons.set(tab, b);
      tabs.append(b);
    }
    const head = el('header', 'mu-panel-head');
    head.append(el('h2', 'mu-panel-title', 'Mailbox'), tabs);
    const scroll = el('div', 'mu-panel-body');
    scroll.append(this.baskets.el, this.photos.el, this.letters);
    this.el.append(head, scroll);
    this.select(this.tab);
  }

  async refresh(): Promise<void> {
    await this.show(this.tab);
  }

  async show(tab: Tab): Promise<void> {
    this.select(tab);
    if (tab === 'baskets') await this.baskets.reset();
    else if (tab === 'photos') await this.photos.reset();
    else this.renderLetters(await this.api.invitations());
  }

  /** Invitations waiting on the owner, for the badge. */
  static pending(cards: readonly InvitationCard[]): number {
    return cards.filter((c) => c.actions.length > 0 || c.canVisitNow).length;
  }

  private select(tab: Tab): void {
    this.tab = tab;
    for (const [t, b] of this.tabButtons) b.setAttribute('aria-selected', String(t === tab));
    for (const [t, body] of Object.entries(this.bodies)) body.hidden = t !== tab;
  }

  private basket(b: BasketView): HTMLElement {
    const section = el('section', 'mu-basket');
    const n = b.items.length;
    section.append(el('h3', 'mu-basket-head', `${day(b.at)} · ${n} ${n === 1 ? 'find' : 'finds'}`));
    const row = el('div', 'mu-strip');
    row.dataset.row = '';
    row.append(...b.items.map(findCard));
    section.append(row);
    return section;
  }

  private renderLetters(cards: readonly InvitationCard[]): void {
    if (cards.length === 0) {
      this.letters.replaceChildren(el('p', 'mu-empty', 'No invitations.'));
      return;
    }
    this.letters.replaceChildren(...cards.map((c) => this.letter(c)));
  }

  private letter(c: InvitationCard): HTMLElement {
    const card = el('article', 'mu-letter');
    card.dataset.state = c.state;
    const title =
      c.role === 'guest' ? `${c.otherName} invites you over` : c.state === 'proposed' ? `${this.museName()} would like to invite ${c.otherName}’s human` : `An invitation to ${c.otherName}’s human`;
    const when = `${day(c.window.start)}, ${time(c.window.start)} to ${time(c.window.end)}`;
    card.append(el('h3', 'mu-title', title), el('p', 'mu-caption', when), el('p', 'mu-state', stateLine(c)));
    const actions = el('div', 'mu-actions');
    for (const a of c.actions) actions.append(button(ANSWER_LABEL[a], a === 'decline' ? 'mu-btn' : 'mu-btn mu-primary', () => void this.answer(c, a, card)));
    if (c.canVisitNow) actions.append(button('Visit', 'mu-btn mu-primary', () => this.visit(c)));
    if (actions.childElementCount) card.append(actions);
    return card;
  }

  private async answer(c: InvitationCard, action: Answer, card: HTMLElement): Promise<void> {
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    const r = await this.api.answer(c.id, action);
    if (!r.ok) card.append(el('p', 'mu-error', r.error));
    this.changed();
  }
}

function stateLine(c: InvitationCard): string {
  switch (c.state) {
    case 'proposed':
      return 'Send it?';
    case 'sent':
      return c.role === 'guest' ? 'Will you come?' : 'Sent. Waiting for an answer.';
    case 'accepted':
      return 'Accepted. Come by during the window if you like.';
    case 'open':
      return c.role === 'guest' ? 'The door is open now.' : 'The window is open.';
    case 'closed':
      return 'The window has closed.';
    case 'declined':
      return 'Declined.';
    case 'expired':
      return 'Expired without an answer.';
  }
}
