import { worldArt } from '../../garden/art';
import type { GardenState } from '../../garden/state';
import type { Postcard } from '../../garden/types';
import { button, dayName, el, nextFrame, shortDate, wait } from './dom';
import { ICONS } from './icons';
import type { PostBox } from './postbox';

// The post: what comes out of the post box. Its door drops and the cards
// fly out of its mouth into a loose stack on the table, the newest on top;
// an invitation comes as a sealed envelope. Tap a card and it flies
// forward; tap it again and it turns over (a postcard's back: the place and
// the day, a stamp and a postmark, a mitten print for a signature). Like it,
// or put it away in the album, where every card Muse has sent is kept, each
// held at its corners. An envelope opens to its invitation: travel now
// (good for one visit) or keep it for later. Opening the box collects the
// post, so its flag comes down.

export interface MailActions {
  travel(invitation: string): void;
}

type View = 'stack' | 'focus' | 'album';

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

/** An invitation as a sealed envelope, its card inside. */
function envelope(card: Postcard, from: string, actions: { travel: () => void; later: () => void }): HTMLElement {
  const inv = card.invitation!;
  const root = el('div', 'g-pc g-env');
  root.dataset.id = card.id;
  const body = el('div', 'g-env-body');
  const letter = el('div', 'g-invite');
  const pic = el('div', 'g-invite-pic');
  pic.style.backgroundImage = `url("${worldArt(inv.world)}")`;
  letter.append(
    el('p', 'g-invite-kicker', 'You’re invited'),
    el('h3', 'g-invite-world', inv.worldName),
    el('p', 'g-invite-from', `${from} would love you to visit`),
    pic,
    el('p', 'g-invite-blurb', inv.blurb),
  );
  const row = el('div', 'g-invite-actions');
  row.append(button('g-invite-go', 'Travel now', `${ICONS.globe}<span>Travel now</span>`, (e) => (e.stopPropagation(), actions.travel())), button('g-invite-later', 'Keep for later', '', (e) => (e.stopPropagation(), actions.later())));
  (row.lastChild as HTMLElement).textContent = 'Keep for later';
  letter.append(row, el('p', 'g-invite-once', 'Good for one visit'));
  const pocket = el('div', 'g-env-pocket');
  pocket.append(el('span', 'g-env-to', 'For you'), el('span', 'g-env-from', `from ${from}`));
  const flap = el('div', 'g-env-flap');
  const seal = el('span', 'g-env-seal');
  body.append(letter, pocket, flap, seal);
  root.append(body);
  return root;
}

export class Mail {
  private readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly album: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly likeButton: HTMLButtonElement;
  private readonly albumButton: HTMLButtonElement;
  private view: View = 'stack';
  private cards: Postcard[] = [];
  private focused = -1;
  private from: View = 'stack';
  private opening = false;

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
    scrim.addEventListener('click', () => (this.view === 'focus' ? this.unfocus() : this.close()));
    const head = el('header', 'g-mail-head');
    this.title = el('h2', 'g-mail-title', 'Post');
    this.sub = el('p', 'g-mail-sub');
    const tools = el('div', 'g-mail-tools');
    this.albumButton = button('g-mail-tool', 'Album', `${ICONS.album}<span>Album</span>`, () => this.toggleAlbum());
    tools.append(this.albumButton, button('g-mail-tool g-mail-close', 'Close', ICONS.close, () => this.close()));
    head.append(this.title, this.sub, tools);
    this.stage = el('div', 'g-mail-stage');
    this.stage.addEventListener('click', (e) => this.stageClick(e));
    this.album = el('div', 'g-album');
    this.bar = el('div', 'g-mail-bar');
    this.likeButton = button('g-mail-act', 'Like', `${ICONS.heart}<span>Like</span>`, () => this.like());
    this.bar.append(
      button('g-mail-act g-mail-step', 'Previous', ICONS.left, () => this.step(-1)),
      this.likeButton,
      button('g-mail-act', 'Turn over', `${ICONS.flip}<span>Turn over</span>`, () => this.flip()),
      button('g-mail-act', 'Put away', `${ICONS.album}<span>Put away</span>`, () => void this.putAway()),
      button('g-mail-act g-mail-step', 'Next', ICONS.right, () => this.step(1)),
    );
    this.el.append(scrim, head, this.stage, this.album, this.bar);
    parent.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.stopImmediatePropagation();
        if (this.view === 'focus') this.step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === ' ' && this.view === 'focus') {
        e.preventDefault();
        this.flip();
      }
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  /** Called when the post changes (a card arrived while the garden is open). */
  refresh(): void {
    if (this.isOpen && this.view === 'stack' && !this.opening) this.layStack(false);
  }

  private friendName(card: Postcard): string | null {
    const id = card.with ?? card.invitation?.from;
    return id ? (this.state.snapshot?.friends.find((f) => f.id === id)?.name ?? null) : null;
  }

  private build(card: Postcard): HTMLElement {
    if (card.invitation) {
      return envelope(card, this.friendName(card) ?? 'A friend', {
        travel: () => this.actions.travel(card.id),
        later: () => this.unfocus(),
      });
    }
    return postcard(card, this.friendName(card));
  }

  /** Open the box: its door drops, the cards fly from its mouth to the stack. */
  async open(): Promise<void> {
    if (this.isOpen || this.opening) return;
    this.opening = true;
    const mouth = await this.postbox.open();
    this.view = 'stack';
    this.el.classList.add('is-open');
    this.el.dataset.view = 'stack';
    this.layStack(true, mouth);
    // collected: the flag comes down
    for (const card of this.cards) this.state.markRead(card.id);
    this.opening = false;
  }

  close(): void {
    if (!this.isOpen) return;
    const mouth = this.postbox.mouth();
    const stage = this.stage.getBoundingClientRect();
    for (const node of this.stage.children) {
      const e = node as HTMLElement;
      e.classList.remove('is-focus', 'is-flipped', 'is-open');
      e.style.setProperty('--x', `${mouth.x - stage.left - stage.width / 2}px`);
      e.style.setProperty('--y', `${mouth.y - stage.top - stage.height / 2}px`);
      e.style.setProperty('--s', '0.12');
      e.style.opacity = '0';
    }
    this.el.classList.remove('is-open', 'is-album');
    setTimeout(() => this.postbox.close(), 220);
  }

  private layStack(fly: boolean, mouth?: { x: number; y: number }): void {
    this.cards = this.state.mail;
    this.focused = -1;
    const unread = this.state.unread.length;
    this.title.textContent = 'Post';
    this.sub.textContent = this.cards.length === 0 ? 'Nothing in the box. Muse sends a card now and then.' : unread > 0 ? `${unread} new from Muse` : `${this.cards.length} ${this.cards.length === 1 ? 'card' : 'cards'} from Muse`;
    const stage = this.stage.getBoundingClientRect();
    const nodes = this.cards.map((card) => this.build(card));
    this.stage.replaceChildren(...nodes);
    nodes.forEach((node, k) => {
      const seed = Math.sin((k + 1) * 91.7) * 0.5;
      node.style.zIndex = String(100 - k);
      node.dataset.index = String(k);
      if (fly && mouth) {
        node.style.setProperty('--x', `${mouth.x - stage.left - stage.width / 2}px`);
        node.style.setProperty('--y', `${mouth.y - stage.top - stage.height / 2}px`);
        node.style.setProperty('--s', '0.12');
        node.style.setProperty('--r', '-20deg');
        node.style.opacity = '0';
      }
      const land = (): void => {
        node.style.opacity = '';
        node.style.setProperty('--x', `${seed * 26 + (k % 2 ? 6 : -6)}px`);
        node.style.setProperty('--y', `${k * 5 - 8}px`);
        node.style.setProperty('--s', String(1 - k * 0.012));
        node.style.setProperty('--r', `${seed * 7 + (k === 0 ? -1.5 : 0)}deg`);
      };
      if (fly) void nextFrame().then(() => setTimeout(land, (nodes.length - 1 - k) * 70));
      else land();
    });
  }

  private stageClick(e: MouseEvent): void {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.g-pc');
    if (!node) {
      if (this.view === 'focus') this.unfocus();
      return;
    }
    const k = Number(node.dataset.index);
    if (this.view === 'focus' && k === this.focused) this.flip();
    else this.focus(k);
  }

  private focus(k: number): void {
    if (k < 0 || k >= this.cards.length) return;
    if (this.view !== 'focus') this.from = this.view;
    this.view = 'focus';
    this.el.dataset.view = 'focus';
    this.focused = k;
    const card = this.cards[k];
    this.state.markRead(card.id);
    const nodes = [...this.stage.children] as HTMLElement[];
    nodes.forEach((node, i) => {
      const on = i === k;
      node.classList.toggle('is-focus', on);
      node.classList.remove('is-flipped');
      if (!on) node.classList.remove('is-open');
      node.style.zIndex = on ? '200' : String(100 - i);
      if (on) {
        node.style.setProperty('--x', '0px');
        node.style.setProperty('--y', '-10px');
        node.style.setProperty('--r', '0deg');
        node.style.setProperty('--s', '1');
        if (card.invitation) setTimeout(() => node.classList.add('is-open'), 380);
      } else {
        const seed = Math.sin((i + 1) * 91.7) * 0.5;
        node.style.setProperty('--x', `${seed * 40 + (i < k ? -1 : 1) * 30}px`);
        node.style.setProperty('--y', `${150 + i * 4}px`);
        node.style.setProperty('--s', '0.62');
        node.style.setProperty('--r', `${seed * 10}deg`);
      }
    });
    this.likeButton.classList.toggle('is-liked', this.state.cardLiked(card.id));
    this.likeButton.innerHTML = `${this.state.cardLiked(card.id) ? ICONS.heartFilled : ICONS.heart}<span>${this.state.cardLiked(card.id) ? 'Liked' : 'Like'}</span>`;
    this.bar.classList.toggle('is-invitation', !!card.invitation);
    this.title.textContent = card.invitation ? 'An invitation' : card.place;
    this.sub.textContent = card.invitation ? `From ${this.friendName(card) ?? 'a friend'}` : `${dayName(card.day)}${this.friendName(card) ? ` · with ${this.friendName(card)}` : ''}`;
  }

  private unfocus(): void {
    if (this.view !== 'focus') return;
    if (this.from === 'album') {
      this.showAlbum();
      return;
    }
    this.view = 'stack';
    this.el.dataset.view = 'stack';
    this.layStack(false);
  }

  private step(d: 1 | -1): void {
    if (this.view !== 'focus' || this.cards.length === 0) return;
    this.focus((this.focused + d + this.cards.length) % this.cards.length);
  }

  private flip(): void {
    const node = this.stage.children[this.focused] as HTMLElement | undefined;
    if (!node || this.cards[this.focused]?.invitation) return;
    node.classList.toggle('is-flipped');
  }

  private like(): void {
    const card = this.cards[this.focused];
    if (!card) return;
    const liked = this.state.toggleCardLike(card.id);
    this.likeButton.classList.toggle('is-liked', liked);
    this.likeButton.innerHTML = `${liked ? ICONS.heartFilled : ICONS.heart}<span>${liked ? 'Liked' : 'Like'}</span>`;
    const node = this.stage.children[this.focused] as HTMLElement | undefined;
    node?.classList.toggle('is-liked', liked);
  }

  /** The focused card shrinks into the album; the next comes forward. */
  private async putAway(): Promise<void> {
    const card = this.cards[this.focused];
    const node = this.stage.children[this.focused] as HTMLElement | undefined;
    if (!card || !node) return;
    const target = this.albumButton.getBoundingClientRect();
    const stage = this.stage.getBoundingClientRect();
    node.style.setProperty('--x', `${target.left + target.width / 2 - stage.left - stage.width / 2}px`);
    node.style.setProperty('--y', `${target.top + target.height / 2 - stage.top - stage.height / 2}px`);
    node.style.setProperty('--s', '0.08');
    node.style.setProperty('--r', '-12deg');
    node.classList.add('is-away');
    this.albumButton.classList.add('is-catching');
    await wait(420);
    this.albumButton.classList.remove('is-catching');
    this.state.putAway(card.id);
    const index = this.focused;
    this.view = 'stack';
    this.layStack(false);
    if (this.cards.length > 0) this.focus(Math.min(index, this.cards.length - 1));
  }

  private toggleAlbum(): void {
    if (this.view === 'album') {
      this.view = 'stack';
      this.el.classList.remove('is-album');
      this.el.dataset.view = 'stack';
      this.layStack(false);
    } else this.showAlbum();
  }

  /** Every card Muse has sent, held at its corners on the album's page. */
  private showAlbum(): void {
    this.view = 'album';
    this.el.dataset.view = 'album';
    this.el.classList.add('is-album');
    this.title.textContent = 'Album';
    const all = this.state.postcards.filter((p) => !p.invitation);
    this.sub.textContent = `${all.length} postcards from Muse`;
    const grid = el('div', 'g-album-page');
    all.forEach((card, k) => {
      const slot = el('button', 'g-album-slot');
      slot.type = 'button';
      slot.style.setProperty('--r', `${Math.sin((k + 2) * 51.3) * 2.2}deg`);
      const img = el('img');
      img.src = card.image;
      img.alt = card.place;
      img.draggable = false;
      slot.append(img, el('span', 'g-corner g-corner-tl'), el('span', 'g-corner g-corner-tr'), el('span', 'g-corner g-corner-bl'), el('span', 'g-corner g-corner-br'));
      const label = el('span', 'g-album-label', `${card.place} · ${shortDate(card.day)}`);
      slot.append(label);
      if (this.state.cardLiked(card.id)) {
        const heart = el('span', 'g-album-heart');
        heart.innerHTML = ICONS.heartFilled;
        slot.append(heart);
      }
      slot.addEventListener('click', () => {
        // look at it up close, among all the album's cards
        this.from = 'album';
        this.el.classList.remove('is-album');
        this.cards = all;
        this.stage.replaceChildren(...all.map((c) => this.build(c)));
        [...this.stage.children].forEach((n, i) => ((n as HTMLElement).dataset.index = String(i)));
        this.view = 'stack';
        this.focus(k);
      });
      grid.append(slot);
    });
    this.album.replaceChildren(grid);
    this.album.scrollTop = 0;
  }
}
