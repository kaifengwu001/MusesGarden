import { hashOf, worldArt } from '../../garden/art';
import type { GardenState } from '../../garden/state';
import type { Postcard } from '../../garden/types';
import { button, dayName, el, nextFrame, reducedMotion, shortDate, wait } from './dom';
import { ICONS } from './icons';
import type { PostBox } from './postbox';

// The post: what comes out of the post box. Its door drops and today's cards
// fly out of its mouth into a deck, the newest on top. Swipe the top card
// away, any way, and the next comes up; the deck goes round. Tap a card and it
// turns over (a postcard's back: the place and the day, a stamp and a
// postmark, a mitten print for a signature). Beside it, a heart to like it and
// a star to keep it among your favorites. Up top, a switch: From today,
// Favorite (the starred cards) and Album (every card Muse has sent), the last
// two laid out on a page, each card held at its corners. Under the switch,
// every invitation not yet used waits as a ticket in its host's colours, with
// its host's name and planet on it; tap one to travel. An invitation in
// today's post comes sealed in an envelope: tap it and its ticket slides out
// and joins the others. Opening the box collects the post, so its flag comes
// down.

export interface MailActions {
  travel(invitation: string): void;
}

type View = 'today' | 'favorite' | 'album';

const VIEWS: ReadonlyArray<{ view: View; label: string }> = [
  { view: 'today', label: 'From today' },
  { view: 'favorite', label: 'Favorite' },
  { view: 'album', label: 'Album' },
];

/** A card's place: offset from the stage's centre in px, tilt in degrees, scale, and whether it shows. */
interface Slot {
  x: number;
  y: number;
  r: number;
  s: number;
  shown: boolean;
}

/** The deck, by how far under the top a card lies: the top card up close, two more peeking out under it. */
const DECK: readonly Slot[] = [
  { x: 0, y: -10, r: 0, s: 1, shown: true },
  { x: 16, y: -3, r: 2.6, s: 0.965, shown: true },
  { x: -14, y: 4, r: -2.2, s: 0.94, shown: true },
];

/** Deeper cards lie hidden under the last that shows. */
const slot = (depth: number): Slot => DECK[depth] ?? { ...DECK[DECK.length - 1], shown: false };

/** A drag on the top card; far or fast enough and it is thrown away. */
interface Drag {
  pointer: number;
  node: HTMLElement;
  x: number;
  y: number;
  moved: boolean;
  trail: { x: number; y: number; t: number }[];
}

/** A throw: past this many px, or faster than this many px per ms. */
const THROW_DISTANCE = 110;
const THROW_SPEED = 0.5;
const THROW_MS = 400;

function place(node: HTMLElement, at: Slot): void {
  node.style.setProperty('--x', `${at.x}px`);
  node.style.setProperty('--y', `${at.y}px`);
  node.style.setProperty('--r', `${at.r}deg`);
  node.style.setProperty('--s', String(at.s));
  node.classList.toggle('is-buried', !at.shown);
}

/** A stamp: a little painted planet with its cottage, on perforated card. */
const STAMP = `<svg viewBox="0 0 60 72" aria-hidden="true"><rect width="60" height="72" fill="#f4ead2"/><rect x="5" y="5" width="50" height="62" fill="#9fcbe6"/><circle cx="30" cy="44" r="21" fill="#86b65a"/><path d="M9 44a21 21 0 0 1 42 0" fill="#9ccc62"/><circle cx="21" cy="35" r="4" fill="#5d93c9"/><g transform="translate(30 25)"><path d="M-7 0 0-6 7 0Z" fill="#7a6a58"/><rect x="-5.5" y="0" width="11" height="7" fill="#f3e6c4"/></g><path d="M8 18c6-4 12-4 16 0M36 14c5-3 10-3 14 0" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".9"/><text x="49" y="64" font-family="Fraunces, Georgia, serif" font-size="9" font-style="italic" text-anchor="end" fill="#3e3a36">M</text></svg>`;

/** A mitten print, Muse's signature. */
const MITTEN = `<svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="24" rx="10" ry="11" fill="currentColor"/><ellipse cx="9" cy="17" rx="4" ry="5" fill="currentColor" transform="rotate(-24 9 17)"/></svg>`;

function postmark(day: string): string {
  const text = `MUSE’S GARDEN · ${shortDate(day).toUpperCase()} ·`;
  return `<svg viewBox="0 0 120 64" aria-hidden="true"><defs><path id="pm" d="M32 32 m-22 0 a22 22 0 1 1 44 0 a22 22 0 1 1 -44 0"/></defs><circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" stroke-width="1"/><text font-family="ui-sans-serif, system-ui" font-size="6.4" letter-spacing="1.1" fill="currentColor"><textPath href="#pm">${text}</textPath></text><text x="32" y="35" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="9" font-style="italic" fill="currentColor">${shortDate(day)}</text>${[0, 1, 2, 3].map((k) => `<path d="M62 ${18 + k * 9} q7 -5 14 0 t14 0 t14 0 t14 0" fill="none" stroke="currentColor" stroke-width="1.4"/>`).join('')}</svg>`;
}

/** A postcard as a thing you hold: its photo on the front; on the back the place and day, a stamp, a postmark. */
function postcard(card: Postcard, withName: string | null): HTMLElement {
  const root = el('div', 'g-pc');
  root.dataset.id = card.id;
  const inner = el('div', 'g-pc-inner');
  const front = el('div', 'g-pc-front');
  const photo = el('img', 'g-pc-photo');
  photo.src = card.image;
  photo.alt = card.place;
  photo.draggable = false;
  photo.decoding = 'async';
  front.append(photo);
  const back = el('div', 'g-pc-back');
  const left = el('div', 'g-pc-left');
  left.append(el('p', 'g-pc-place', card.place), el('p', 'g-pc-day', dayName(card.day)));
  if (withName) left.append(el('p', 'g-pc-with', `with ${withName}`));
  const mitten = el('span', 'g-pc-mitten');
  mitten.innerHTML = MITTEN;
  left.append(mitten);
  const right = el('div', 'g-pc-right');
  const stamp = el('span', 'g-stamp');
  stamp.innerHTML = STAMP;
  const mark = el('span', 'g-postmark');
  mark.innerHTML = postmark(card.day);
  const to = el('div', 'g-pc-to');
  to.append(el('span', '', 'For you'), el('i'), el('i'), el('i'));
  right.append(stamp, mark, to);
  back.append(el('p', 'g-pc-brand', 'Post card'), left, el('span', 'g-pc-rule'), right);
  inner.append(front, back);
  root.append(inner);
  return root;
}

/** Each host's ticket lies at its own slight angle (deg). */
const tilt = (host: string): number => ((hashOf(host) % 1000) / 1000 - 0.5) * 3.2;

/** A ticket to a friend's planet: in its host's colours, the planet and the host's name on it, good for one visit. */
function ticket<K extends 'button' | 'div'>(tag: K, card: Postcard): HTMLElementTagNameMap[K] {
  const inv = card.invitation!;
  const root = el(tag, 'g-ticket');
  root.dataset.id = card.id;
  root.style.setProperty('--coat', inv.coat);
  root.style.setProperty('--tilt', `${tilt(inv.from).toFixed(2)}deg`);
  const stub = el('span', 'g-ticket-stub');
  const planet = el('span', 'g-ticket-planet');
  planet.style.backgroundImage = `url("${worldArt(inv.world)}")`;
  stub.append(planet, el('span', 'g-ticket-admit', 'Admit one'));
  const main = el('span', 'g-ticket-main');
  const go = el('span', 'g-ticket-go');
  go.innerHTML = `${ICONS.globe}<span>Travel</span>`;
  main.append(el('span', 'g-ticket-world', inv.worldName), el('span', 'g-ticket-host', `from ${inv.fromName}`), el('span', 'g-ticket-once', 'Good for one visit'), go);
  root.append(stub, main);
  return root;
}

/** An invitation as a sealed envelope, its ticket inside. */
function envelope(card: Postcard): HTMLElement {
  const root = el('div', 'g-pc g-env');
  root.dataset.id = card.id;
  const body = el('div', 'g-env-body');
  const inside = el('div', 'g-env-ticket');
  inside.append(ticket('div', card));
  const pocket = el('div', 'g-env-pocket');
  pocket.append(el('span', 'g-env-to', 'For you'), el('span', 'g-env-from', `from ${card.invitation!.fromName}`));
  body.append(inside, pocket, el('div', 'g-env-flap'), el('span', 'g-env-seal'));
  root.append(body);
  return root;
}

export class Mail {
  private readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly side: HTMLElement;
  private readonly likeButton: HTMLButtonElement;
  private readonly starButton: HTMLButtonElement;
  private readonly album: HTMLElement;
  private readonly tickets: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly switches: Map<View, HTMLButtonElement>;
  private view: View = 'today';
  /** Favorite and Album open on a page of cards; a card picked there brings the page's cards up close as a deck. */
  private board = false;
  private cards: Postcard[] = [];
  private top = 0;
  private opening = false;
  private closing = false;
  private operation = 0;
  private readonly pending = new Set<number>();
  /** The invitation whose ticket is on its way out of its envelope to the others. */
  private pocketing: string | null = null;
  private ticketIds = '';
  private drag: Drag | null = null;
  private swallowClick = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GardenState,
    private readonly postbox: PostBox,
    private readonly actions: MailActions,
  ) {
    this.el = el('div', 'g-mail');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Post');
    const scrim = el('div', 'g-mail-scrim');
    scrim.addEventListener('click', () => this.back());
    const head = el('header', 'g-mail-head');
    this.title = el('h2', 'g-mail-title', 'Post');
    this.sub = el('p', 'g-mail-sub');
    const tools = el('div', 'g-mail-tools');
    const segments = el('div', 'g-segments');
    segments.setAttribute('role', 'group');
    segments.setAttribute('aria-label', 'Show');
    this.switches = new Map(
      VIEWS.map(({ view, label }) => {
        const b = button('g-segment', label, '', () => this.show(view));
        b.textContent = label;
        b.removeAttribute('title');
        segments.append(b);
        return [view, b];
      }),
    );
    tools.append(segments, button('g-mail-close', 'Close', ICONS.close, () => this.close()));
    head.append(this.title, this.sub, tools);

    const desk = el('div', 'g-mail-desk');
    this.stage = el('div', 'g-mail-stage');
    this.stage.addEventListener('click', (e) => this.stageClick(e));
    this.stage.addEventListener('pointerdown', (e) => this.grab(e));
    this.stage.addEventListener('pointermove', (e) => this.pull(e));
    this.stage.addEventListener('pointerup', (e) => this.release(e, false));
    this.stage.addEventListener('pointercancel', (e) => this.release(e, true));
    this.empty = el('div', 'g-mail-empty');
    this.empty.append(el('p', 'g-mail-quiet', 'Nothing from Muse today'), el('p', 'g-mail-hint', 'Muse sends a card now and then. Every card it has sent is in the Album.'));
    this.side = el('div', 'g-mail-side');
    this.likeButton = this.mark('g-mark-like', 'Like', () => this.like());
    this.starButton = this.mark('g-mark-star', 'Favorite', () => this.favorite());
    this.side.append(this.likeButton, this.starButton);
    this.album = el('div', 'g-album');
    desk.append(this.stage, this.empty, this.side, this.album);

    this.tickets = el('div', 'g-tickets');
    this.tickets.setAttribute('aria-label', 'Travel tickets');
    this.el.append(scrim, head, desk, this.tickets);
    parent.append(this.el);
    window.addEventListener('keydown', (e) => this.key(e));
  }

  get isOpen(): boolean {
    return this.opening || this.el.classList.contains('is-open');
  }

  private invalidate(): number {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
    return ++this.operation;
  }

  private later(action: () => void, ms: number): void {
    const operation = this.operation;
    const timer = window.setTimeout(() => {
      this.pending.delete(timer);
      if (operation === this.operation) action();
    }, reducedMotion() ? 0 : ms);
    this.pending.add(timer);
  }

  /** A heart or a star beside the card; its word shows to its right on hover. */
  private mark(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = button(`g-mark ${className}`, label, '', onClick);
    b.removeAttribute('title');
    b.setAttribute('aria-pressed', 'false');
    return b;
  }

  /** Called when the post changes: a card arrived, a like or a star came back, an envelope was opened. */
  refresh(): void {
    if (!this.isOpen || this.opening || this.closing) return;
    this.paintTickets();
    if (this.pocketing) return;
    if (this.board) this.paintBoard(false);
    else if (this.view === 'today' && ids(this.state.today) !== ids(this.cards)) {
      const keep = this.cards[this.top]?.id;
      const fresh = this.state.today;
      this.layDeck(fresh, Math.max(0, fresh.findIndex((c) => c.id === keep)));
    } else this.paint();
  }

  private friendName(card: Postcard): string | null {
    return card.with ? (this.state.snapshot?.friends.find((f) => f.id === card.with)?.name ?? null) : null;
  }

  private build(card: Postcard): HTMLElement {
    return card.invitation ? envelope(card) : postcard(card, this.friendName(card));
  }

  /** Open the box: its door drops, and today's cards fly from its mouth into the deck. */
  async open(): Promise<void> {
    if (this.opening || (this.isOpen && !this.closing)) return;
    const operation = this.invalidate();
    this.closing = false;
    this.opening = true;
    this.pocketing = null;
    this.el.classList.remove('is-open', 'is-closing', 'is-board');
    document.body.classList.remove('g-mail-open');
    this.stage.replaceChildren();
    const mouth = await this.postbox.open();
    if (operation !== this.operation) return;
    this.el.classList.add('is-open');
    document.body.classList.add('g-mail-open');
    this.ticketIds = '';
    this.show('today', reducedMotion() ? undefined : mouth);
    this.postbox.releaseMail();
    this.state.collect();
    this.opening = false;
  }

  close(): void {
    if (!this.isOpen || this.closing) return;
    this.invalidate();
    this.opening = false;
    this.pocketing = null;
    if (this.drag?.node.hasPointerCapture(this.drag.pointer)) this.drag.node.releasePointerCapture(this.drag.pointer);
    this.drag = null;
    this.swallowClick = false;
    const finish = (): void => {
      this.closing = false;
      this.el.classList.remove('is-open', 'is-board', 'is-closing');
      document.body.classList.remove('g-mail-open');
      this.stage.replaceChildren();
      this.postbox.close();
    };
    if (!this.el.classList.contains('is-open') || reducedMotion()) {
      finish();
      return;
    }
    this.closing = true;
    this.el.classList.add('is-closing');
    if (this.board) {
      this.later(finish, 180);
      return;
    }
    const mouth = this.postbox.mouth();
    const stage = this.stage.getBoundingClientRect();
    for (const node of this.stage.children) {
      const e = node as HTMLElement;
      e.classList.remove('is-flipped', 'is-open', 'is-dragging', 'is-thrown');
      e.style.transition = '';
      e.style.setProperty('--x', `${mouth.x - stage.left - stage.width / 2}px`);
      e.style.setProperty('--y', `${mouth.y - stage.top - stage.height / 2}px`);
      e.style.setProperty('--s', '0.075');
      e.style.setProperty('--r', '-12deg');
      e.style.opacity = '0';
    }
    this.later(finish, 520);
  }

  /** Esc, or a click beside the card: from a card picked on a page back to the page, else the post closes. */
  back(): void {
    if (this.opening || this.closing) this.close();
    else if (this.view !== 'today' && !this.board) this.showBoard();
    else this.close();
  }

  /** The switch: From today shows today's deck; Favorite and Album open on their page. */
  private show(view: View, mouth?: { x: number; y: number }): void {
    this.view = view;
    this.el.dataset.view = view;
    for (const [v, b] of this.switches) b.setAttribute('aria-pressed', String(v === view));
    if (view === 'today') {
      this.board = false;
      this.el.classList.remove('is-board');
      this.layDeck(this.state.today, 0, mouth);
    } else this.showBoard();
    this.paintTickets();
  }

  // ---- the deck ---------------------------------------------------------------------

  private layDeck(cards: Postcard[], top: number, mouth?: { x: number; y: number }): void {
    const operation = this.operation;
    this.cards = cards;
    this.top = cards.length > 0 ? Math.min(top, cards.length - 1) : 0;
    const nodes = cards.map((card, i) => {
      const node = this.build(card);
      node.dataset.index = String(i);
      return node;
    });
    this.stage.replaceChildren(...nodes);
    this.el.classList.toggle('is-empty', cards.length === 0);
    if (mouth) {
      const stage = this.stage.getBoundingClientRect();
      for (const node of nodes) {
        node.style.setProperty('--x', `${mouth.x - stage.left - stage.width / 2}px`);
        node.style.setProperty('--y', `${mouth.y - stage.top - stage.height / 2}px`);
        node.style.setProperty('--s', '0.075');
        node.style.setProperty('--r', '-20deg');
        node.style.opacity = '0';
      }
      // the deepest that shows lands first, the top card last
      void nextFrame().then(() => {
        if (operation !== this.operation) return;
        nodes.forEach((node, i) => {
          const depth = Math.min(this.depth(i), DECK.length - 1);
          this.later(
            () => {
              if (this.closing || !node.isConnected) return;
              node.style.opacity = '';
              this.arrange(node, i);
            },
            (DECK.length - 1 - depth) * 90,
          );
        });
      });
    } else nodes.forEach((node, i) => this.arrange(node, i));
    this.paint();
  }

  private depth(i: number): number {
    return (i - this.top + this.cards.length) % this.cards.length;
  }

  private arrange(node: HTMLElement, i: number): void {
    const depth = this.depth(i);
    node.classList.toggle('is-top', depth === 0);
    if (depth !== 0) node.classList.remove('is-flipped');
    node.style.zIndex = String(100 - depth);
    place(node, slot(depth));
  }

  private rearrange(): void {
    [...this.stage.children].forEach((node, i) => {
      if (!node.classList.contains('is-thrown')) this.arrange(node as HTMLElement, i);
    });
    this.paint();
  }

  private topNode(): HTMLElement | undefined {
    return this.stage.children[this.top] as HTMLElement | undefined;
  }

  private step(d: 1 | -1): void {
    if (this.board || this.pocketing || this.cards.length < 2) return;
    this.top = (this.top + d + this.cards.length) % this.cards.length;
    this.rearrange();
  }

  /** The head over the deck or the page, and the heart and star beside the top card. */
  private paint(): void {
    const card = this.board ? undefined : this.cards[this.top];
    if (this.board) {
      const cards = this.boardCards();
      this.title.textContent = this.view === 'favorite' ? 'Favorites' : 'Album';
      this.sub.textContent = `${cards.length} ${cards.length === 1 ? 'postcard' : 'postcards'}${this.view === 'favorite' ? ' you starred' : ' from Muse'}`;
    } else if (!card) {
      this.title.textContent = 'Post';
      this.sub.textContent = '';
    } else if (card.invitation) {
      this.title.textContent = 'An invitation';
      this.sub.textContent = `From ${card.invitation.fromName} · tap to open it`;
    } else {
      const withName = this.friendName(card);
      const count = this.cards.length > 1 ? ` · ${this.top + 1} of ${this.cards.length}` : '';
      this.title.textContent = card.place;
      this.sub.textContent = `${dayName(card.day)}${withName ? ` · with ${withName}` : ''}${count}`;
    }
    const photo = card && !card.invitation ? card : null;
    this.side.classList.toggle('is-on', photo !== null);
    if (!photo) return;
    const liked = this.state.cardLiked(photo.id);
    const starred = this.state.cardFavorite(photo.id);
    this.paintMark(this.likeButton, liked, liked ? ICONS.heartFilled : ICONS.heart, 'Like');
    this.paintMark(this.starButton, starred, starred ? ICONS.starFilled : ICONS.star, 'Favorite');
  }

  private paintMark(b: HTMLButtonElement, on: boolean, icon: string, word: string): void {
    // (unchanged, it is left alone: its pop plays once, when it turns on)
    if (b.firstChild && b.getAttribute('aria-pressed') === String(on)) return;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('is-on', on);
    b.innerHTML = `${icon}<span class="g-mark-word">${word}</span>`;
  }

  private stageClick(e: MouseEvent): void {
    if (this.opening || this.closing) return;
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    const node = (e.target as HTMLElement).closest<HTMLElement>('.g-pc');
    if (!node) {
      this.back();
      return;
    }
    const i = Number(node.dataset.index);
    if (i === this.top) this.act();
    else {
      this.top = i;
      this.rearrange();
    }
  }

  /** A tap on the top card: a postcard turns over, an envelope gives up its ticket. */
  private act(): void {
    const card = this.cards[this.top];
    const node = this.topNode();
    if (!card || !node || this.pocketing) return;
    if (card.invitation) void this.pocket(card, node);
    else node.classList.toggle('is-flipped');
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen || this.opening || this.closing || this.board || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.stopImmediatePropagation();
      this.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      this.act();
    }
  }

  // ---- swiping: the top card thrown away, any way, and the next comes up ---------------

  private grab(e: PointerEvent): void {
    if (this.opening || this.closing) return;
    this.swallowClick = false;
    const target = e.target as HTMLElement;
    const node = target.closest<HTMLElement>('.g-pc.is-top');
    if (this.board || this.pocketing || this.drag || !e.isPrimary || e.button !== 0 || !node || target.closest('button')) return;
    node.setPointerCapture(e.pointerId);
    this.drag = { pointer: e.pointerId, node, x: e.clientX, y: e.clientY, moved: false, trail: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
  }

  private pull(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    d.node.classList.add('is-dragging');
    d.trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    while (d.trail.length > 2 && e.timeStamp - d.trail[0].t > 90) d.trail.shift();
    place(d.node, { ...DECK[0], x: dx, y: DECK[0].y + dy, r: dx * 0.04 });
  }

  /** Let go: thrown far or fast enough, the card flies off and goes to the bottom of the deck; else it springs back. */
  private release(e: PointerEvent, cancelled: boolean): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    d.node.classList.remove('is-dragging');
    if (!d.moved) return;
    this.swallowClick = true;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const from = d.trail[0];
    const dt = Math.max(e.timeStamp - from.t, 1);
    const vx = (e.clientX - from.x) / dt;
    const vy = (e.clientY - from.y) / dt;
    const flung = Math.hypot(vx, vy) > THROW_SPEED;
    if (cancelled || (!flung && Math.hypot(dx, dy) < THROW_DISTANCE)) {
      place(d.node, DECK[0]);
      return;
    }
    const [ux, uy] = flung ? [vx, vy] : [dx, dy];
    const far = Math.hypot(window.innerWidth, window.innerHeight) / Math.hypot(ux, uy);
    const node = d.node;
    node.classList.add('is-thrown');
    place(node, { ...DECK[0], x: dx + ux * far, y: DECK[0].y + dy + uy * far, r: dx * 0.04 + Math.sign(ux) * 24 });
    this.top = (this.top + 1) % this.cards.length;
    this.rearrange();
    // under the deck out of sight, then it shows there
    this.later(() => {
      if (!node.isConnected) return;
      node.style.transition = 'none';
      this.arrange(node, Number(node.dataset.index));
      void node.offsetWidth;
      node.style.transition = '';
      node.classList.remove('is-thrown');
    }, THROW_MS);
  }

  // ---- like and favorite ----------------------------------------------------------------

  private like(): void {
    const card = this.cards[this.top];
    if (!card || card.invitation) return;
    this.state.toggleCardLike(card.id);
    this.paint();
  }

  private favorite(): void {
    const card = this.cards[this.top];
    if (!card || card.invitation) return;
    this.state.toggleCardFavorite(card.id);
    this.paint();
  }

  // ---- the pages: favorites and the album ------------------------------------------------

  private boardCards(): Postcard[] {
    const photos = this.state.postcards.filter((p) => !p.invitation);
    return this.view === 'favorite' ? photos.filter((p) => this.state.cardFavorite(p.id)) : photos;
  }

  private showBoard(): void {
    this.board = true;
    this.el.classList.add('is-board');
    this.paintBoard(true);
  }

  /** The page: each card held at its corners, its place and day under it, a heart after a liked one's. */
  private paintBoard(fromTop: boolean): void {
    const cards = this.boardCards();
    const page = el('div', 'g-album-page');
    cards.forEach((card, k) => {
      const slotEl = el('button', 'g-album-slot');
      slotEl.type = 'button';
      slotEl.dataset.id = card.id;
      slotEl.setAttribute('aria-label', `${card.place}, ${shortDate(card.day)}`);
      slotEl.style.setProperty('--r', `${Math.sin((k + 2) * 51.3) * 2.2}deg`);
      const img = el('img');
      img.src = card.image;
      img.alt = card.place;
      img.draggable = false;
      slotEl.append(img, el('span', 'g-corner g-corner-tl'), el('span', 'g-corner g-corner-tr'), el('span', 'g-corner g-corner-bl'), el('span', 'g-corner g-corner-br'));
      const label = el('span', 'g-album-label');
      // (a flex row trims its text's edge spaces: these hold)
      label.append(el('span', 'g-album-place', card.place), `\u00a0·\u00a0${shortDate(card.day)}`);
      if (this.state.cardLiked(card.id)) label.append(el('span', 'g-album-heart', '♥'));
      slotEl.append(label);
      slotEl.addEventListener('click', () => {
        this.board = false;
        this.el.classList.remove('is-board');
        this.layDeck(cards, k);
      });
      page.append(slotEl);
    });
    const blank = this.view === 'favorite' ? 'No favorites yet. Tap the star beside a card to keep it here.' : 'No postcards yet. Muse sends one now and then.';
    const scroll = this.album.scrollTop;
    this.album.replaceChildren(cards.length > 0 ? page : el('p', 'g-album-empty', blank));
    this.album.scrollTop = fromTop ? 0 : scroll;
    this.paint();
  }

  // ---- tickets ------------------------------------------------------------------------------

  private paintTickets(): void {
    const tickets = this.state.tickets;
    const key = ids(tickets);
    this.el.classList.toggle('has-tickets', tickets.length > 0);
    if (key === this.ticketIds) return;
    this.ticketIds = key;
    this.tickets.replaceChildren(
      ...tickets.map((card) => {
        const t = ticket('button', card);
        t.type = 'button';
        t.setAttribute('aria-label', `Travel to ${card.invitation!.worldName}`);
        t.classList.toggle('is-incoming', card.id === this.pocketing);
        t.addEventListener('click', () => this.actions.travel(card.id));
        return t;
      }),
    );
  }

  /** An envelope opened: its flap lifts, its ticket slides out, flies to its place among the tickets and lands there. */
  private async pocket(card: Postcard, node: HTMLElement): Promise<void> {
    const operation = this.operation;
    const motion = !reducedMotion();
    this.pocketing = card.id;
    this.side.classList.remove('is-on');
    node.classList.add('is-open');
    await wait(motion ? 950 : 0);
    if (operation !== this.operation) return;
    if (!node.isConnected) {
      this.pocketing = null;
      this.refresh();
      return;
    }
    // opened: it is a ticket now, and the column makes room for it
    this.state.markRead(card.id);
    this.paintTickets();
    const target = this.tickets.querySelector<HTMLElement>(`.g-ticket[data-id="${CSS.escape(card.id)}"]`);
    const inner = node.querySelector<HTMLElement>('.g-ticket');
    if (target && inner) {
      const to = target.getBoundingClientRect();
      const from = inner.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const stage = this.stage.getBoundingClientRect();
      const s = to.width / from.width;
      // the node turns about its centre: place it so its ticket's centre lands on the slot's
      const nx = box.left + box.width / 2;
      const ny = box.top + box.height / 2;
      const x = to.left + to.width / 2 - (stage.left + stage.width / 2) - s * (from.left + from.width / 2 - nx);
      const y = to.top + to.height / 2 - (stage.top + stage.height / 2) - s * (from.top + from.height / 2 - ny);
      node.classList.add('is-pocketed');
      place(node, { x, y, r: Number.parseFloat(getComputedStyle(target).getPropertyValue('--tilt')) || 0, s, shown: true });
      await wait(motion ? 620 : 0);
      if (operation !== this.operation) return;
      target.classList.remove('is-incoming');
      target.classList.add('is-landed');
    }
    this.pocketing = null;
    const index = this.top;
    const fresh = this.state.today;
    this.layDeck(fresh, Math.min(index, Math.max(0, fresh.length - 1)));
  }
}

const ids = (cards: readonly Postcard[]): string => cards.map((c) => c.id).join('|');
