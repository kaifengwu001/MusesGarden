import type { GardenSource } from './source';
import type { Basket, Find, GardenEvent, GardenSnapshot, Interest, MuseStatus, Postcard, Reach, Reaction } from './types';

// The garden as the interface sees it: the snapshot from the source, kept
// current by its events, and what you have done here: the finds you liked
// or made public or private, the postcards you read, liked or starred, the
// baskets you have visited. Everything you do that
// Muse should hear about goes back through the source as a reaction. Likes,
// stars and sharing are the source's to keep when it sends them: a switch you
// flip shows at once and holds until the source sends that value back (or
// turns it down). The rest of your side, and likes and stars a source doesn't
// keep, are remembered in this browser only (localStorage, where it is allowed).

export type Change = 'snapshot' | 'likes' | 'postcards' | 'baskets' | 'visited' | 'interests' | 'finds' | 'status' | 'friends';

/** A reaction that flips a switch the source keeps. */
type Flip = Extract<Reaction, { liked: boolean } | { shared: boolean } | { favorite: boolean }>;
const FLIPS: readonly Flip['type'][] = ['like-find', 'like-postcard', 'favorite-postcard', 'share-find', 'share-interest'];

/** At most this many favourites when the garden picks them itself. */
const FAVOURITES = 12;

interface Kept {
  likedFinds: string[];
  likedCards: string[];
  favoriteCards: string[];
  readCards: string[];
  visited: string[];
  usedInvitations: string[];
}

const KEY = 'muses-garden.garden.v1';

/** The later of two ISO days. */
const later = (a: string, b: string): string => (b > a ? b : a);

function load(): Partial<Kept> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Kept>) : {};
  } catch {
    return {};
  }
}

export class GardenState {
  snapshot: GardenSnapshot | null = null;
  private readonly listeners = new Set<(change: Change) => void>();
  private readonly likedFinds: Set<string>;
  private readonly likedCards: Set<string>;
  private readonly favoriteCards: Set<string>;
  private readonly readCards: Set<string>;
  private readonly visited: Set<string>;
  private readonly usedInvitations: Set<string>;
  /** What you flipped here that the source has not sent back yet, by switch and id. */
  private readonly pending = new Map(FLIPS.map((type) => [type, new Map<string, boolean>()]));
  /** The friend group you picked here, until the source sends it back. */
  private pendingReach: Reach | null = null;
  /** True for a visitor who has never opened the garden in this browser: the older postcards and baskets count as seen. */
  private readonly firstVisit: boolean;
  private findIndex = new Map<string, Find>();
  private basketIndex = new Map<string, Basket>();

  constructor(private readonly source: GardenSource) {
    const kept = load();
    this.firstVisit = Object.keys(kept).length === 0;
    this.likedFinds = new Set(kept.likedFinds);
    this.likedCards = new Set(kept.likedCards);
    this.favoriteCards = new Set(kept.favoriteCards);
    this.readCards = new Set(kept.readCards);
    this.visited = new Set(kept.visited);
    this.usedInvitations = new Set(kept.usedInvitations);
  }

  /** Read everything from the source and listen for what arrives. */
  async start(): Promise<void> {
    const snapshot = await this.source.load();
    this.adopt(snapshot);
    this.source.subscribe((event) => this.receive(event));
  }

  subscribe(listener: (change: Change) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: Change): void {
    this.save();
    for (const listener of this.listeners) listener(change);
  }

  private save(): void {
    const kept: Kept = {
      likedFinds: [...this.likedFinds],
      likedCards: [...this.likedCards],
      favoriteCards: [...this.favoriteCards],
      readCards: [...this.readCards],
      visited: [...this.visited],
      usedInvitations: [...this.usedInvitations],
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
      // private windows and blocked storage: the garden still works, it just forgets
    }
  }

  private adopt(snapshot: GardenSnapshot): void {
    this.snapshot = snapshot;
    this.reindex();
    if (this.firstVisit) {
      // a first visit opens on today's arrivals: what came before counts as read and visited
      const today = this.latestDay();
      for (const card of snapshot.postcards) if (card.day < today) this.readCards.add(card.id);
      for (const basket of snapshot.baskets) if (basket.day < today) this.visited.add(basket.id);
    }
    this.settle();
    this.emit('snapshot');
  }

  private reindex(): void {
    const s = this.snapshot;
    this.findIndex = new Map(s?.finds.map((f) => [f.id, f]));
    this.basketIndex = new Map(s?.baskets.map((b) => [b.id, b]));
  }

  private latestDay(): string {
    const s = this.snapshot;
    if (!s) return '';
    return [...s.baskets.map((b) => b.day), ...s.postcards.map((p) => p.day)].reduce((a, b) => (a > b ? a : b), '');
  }

  /** Apply something the source pushed. */
  receive(event: GardenEvent): void {
    const s = this.snapshot;
    if (!s) return;
    if (event.type === 'basket') {
      const known = this.basketIndex.get(event.basket.id)?.finds;
      const again = known?.length === event.basket.finds.length && known.every((id, i) => id === event.basket.finds[i]);
      this.snapshot = {
        ...s,
        today: later(s.today, event.basket.day),
        baskets: [...s.baskets.filter((b) => b.id !== event.basket.id), event.basket],
        finds: [...s.finds.filter((f) => f.basket !== event.basket.id), ...event.finds],
      };
      this.reindex();
      this.settle();
      // a basket you already have, sent again because a like or its sharing changed: no arrival to replay
      this.emit(again ? 'likes' : 'baskets');
    } else if (event.type === 'postcard') {
      this.snapshot = { ...s, today: later(s.today, event.postcard.day), postcards: [...s.postcards.filter((p) => p.id !== event.postcard.id), event.postcard] };
      this.settle();
      this.emit('postcards');
    } else {
      this.snapshot = { ...s, muse: { ...s.muse, status: event.status } };
      this.emit('status');
    }
  }

  private react(reaction: Reaction): void {
    this.source.react(reaction).catch((error: unknown) => console.warn('garden: a reaction could not be sent', error));
  }

  // ---- switches the source keeps: likes, and what other Muses may see -----------

  /** The value the source last sent for a switch; undefined when it keeps no such thing (the placeholders keep no likes). */
  private sent(type: Flip['type'], id: string): boolean | undefined {
    switch (type) {
      case 'like-find':
        return this.findIndex.get(id)?.liked;
      case 'share-find':
        return this.findIndex.get(id)?.shared;
      case 'like-postcard':
        return this.snapshot?.postcards.find((p) => p.id === id)?.liked;
      case 'favorite-postcard':
        return this.snapshot?.postcards.find((p) => p.id === id)?.favorite;
      case 'share-interest':
        return this.snapshot?.interests.find((i) => i.id === id)?.shared;
    }
  }

  /** Likes and stars this browser keeps for a source that doesn't. */
  private kept(type: Flip['type']): Set<string> | undefined {
    switch (type) {
      case 'like-find':
        return this.likedFinds;
      case 'like-postcard':
        return this.likedCards;
      case 'favorite-postcard':
        return this.favoriteCards;
      default:
        return undefined;
    }
  }

  private value(type: Flip['type'], id: string): boolean {
    return this.pending.get(type)!.get(id) ?? this.sent(type, id) ?? this.kept(type)?.has(id) ?? false;
  }

  /** Show a flip at once and tell Muse; if the source turns it down, show what the source holds again. */
  private flip(reaction: Flip, change: Change): void {
    const { type, id } = reaction;
    const on = 'liked' in reaction ? reaction.liked : 'shared' in reaction ? reaction.shared : reaction.favorite;
    const kept = this.kept(type);
    const pending = this.pending.get(type)!;
    if (kept && this.sent(type, id) === undefined) {
      if (on) kept.add(id);
      else kept.delete(id);
    } else pending.set(id, on);
    this.source.react(reaction).catch((error: unknown) => {
      console.warn('garden: a reaction could not be sent', error);
      if (pending.get(id) !== on) return;
      pending.delete(id);
      this.emit(change);
    });
    this.emit(change);
  }

  /** Drop each flip the source has now sent back: from here on its value stands. */
  private settle(): void {
    for (const [type, pending] of this.pending) for (const [id, on] of pending) if (this.sent(type, id) === on) pending.delete(id);
  }

  // ---- finds and baskets ----------------------------------------------------

  find(id: string): Find | undefined {
    return this.findIndex.get(id);
  }

  basket(id: string): Basket | undefined {
    return this.basketIndex.get(id);
  }

  /** Baskets, newest first. */
  get baskets(): Basket[] {
    return [...(this.snapshot?.baskets ?? [])].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  }

  /** Every find in the order you browse them, as on the baskets' timeline: oldest basket first, each in Muse's order. */
  get browseOrder(): string[] {
    return this.baskets.reverse().flatMap((b) => b.finds.filter((id) => this.findIndex.has(id)));
  }

  /**
   * The find a step from `id` goes to, back in time (-1) or forward (1), round at the ends; `into` is the day (ISO)
   * of its basket when that is another basket than `id`'s.
   */
  step(id: string, direction: 1 | -1): { find: string; into: string | null; wraps: boolean } | null {
    const order = this.browseOrder;
    const i = order.indexOf(id);
    if (i < 0) return null;
    const next = i + direction;
    const find = order[(next + order.length) % order.length];
    const from = this.find(id)?.basket;
    const to = this.find(find)?.basket;
    return { find, into: to !== from ? (this.basket(to ?? '')?.day ?? null) : null, wraps: next < 0 || next >= order.length };
  }

  /**
   * Muse's favourites, on the shelf in its hut, in its order: the ones the
   * source names; without them (no backend sends them yet) the finds Muse
   * said something about, then one from each topic, newest first.
   */
  get favourites(): string[] {
    const s = this.snapshot;
    if (!s) return [];
    if (s.favourites) return s.favourites.filter((id) => this.findIndex.has(id));
    const order = this.browseOrder;
    const picked = order.filter((id) => this.findIndex.get(id)?.note);
    const topics = new Set(picked.map((id) => this.findIndex.get(id)?.topic));
    for (const id of order) {
      const topic = this.findIndex.get(id)?.topic;
      if (picked.includes(id) || topics.has(topic)) continue;
      topics.add(topic);
      picked.push(id);
    }
    return picked.slice(0, FAVOURITES);
  }

  interest(id: string): Interest | undefined {
    const interest = this.snapshot?.interests.find((i) => i.id === id);
    return interest && { ...interest, shared: this.value('share-interest', id) };
  }

  get interests(): Interest[] {
    return (this.snapshot?.interests ?? []).map((i) => ({ ...i, shared: this.value('share-interest', i.id) }));
  }

  setShared(id: string, shared: boolean): void {
    this.flip({ type: 'share-interest', id, shared }, 'interests');
  }

  /** Whether other Muses may see a find. */
  findShared(findId: string): boolean {
    return this.value('share-find', findId);
  }

  shareFind(findId: string, shared: boolean): void {
    this.flip({ type: 'share-find', id: findId, shared }, 'finds');
  }

  liked(findId: string): boolean {
    return this.value('like-find', findId);
  }

  get likedFindIds(): string[] {
    return (this.snapshot?.finds ?? []).filter((f) => this.liked(f.id)).map((f) => f.id);
  }

  toggleLike(findId: string): boolean {
    const liked = !this.liked(findId);
    this.flip({ type: 'like-find', id: findId, liked }, 'likes');
    return liked;
  }

  visitedBasket(id: string): boolean {
    return this.visited.has(id);
  }

  /** The newest basket you have not been to yet, if any. */
  get freshBasket(): Basket | undefined {
    return this.baskets.find((b) => !this.visited.has(b.id));
  }

  /** You opened this basket: the rail's dot and the timeline's ring for it go. */
  visit(basketId: string): void {
    if (this.visited.has(basketId)) return;
    this.visited.add(basketId);
    this.emit('visited');
  }

  // ---- postcards --------------------------------------------------------------

  /** Every postcard, newest first. */
  get postcards(): Postcard[] {
    return [...(this.snapshot?.postcards ?? [])].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.id < b.id ? 1 : -1));
  }

  isRead(id: string): boolean {
    return this.readCards.has(id);
  }

  get unread(): Postcard[] {
    return this.postcards.filter((p) => !this.readCards.has(p.id));
  }

  /** Invitations not yet used. */
  get invitations(): Postcard[] {
    return this.postcards.filter((p) => this.unused(p));
  }

  private unused(card: Postcard): boolean {
    return !!card.invitation && !card.invitation.used && !this.usedInvitations.has(card.id);
  }

  /** An invitation in today's post you have not opened: it comes as an envelope, and once opened it is a ticket. */
  private sealed(card: Postcard): boolean {
    return card.day === this.snapshot?.today && !this.readCards.has(card.id);
  }

  /** Today's post, newest first: Muse's photos of the day, and each invitation of the day still in its envelope. */
  get today(): Postcard[] {
    return this.postcards.filter((p) => p.day === this.snapshot?.today && (!p.invitation || (this.unused(p) && this.sealed(p))));
  }

  /** The tickets: every invitation not yet used, but for those still sealed in today's post, newest first. */
  get tickets(): Postcard[] {
    return this.invitations.filter((p) => !this.sealed(p));
  }

  /** Opening the box collects the post: everything in it counts as read, but an envelope stays sealed until it is opened. */
  collect(): void {
    const sealed = new Set(this.today.filter((p) => p.invitation).map((p) => p.id));
    const fresh = this.unread.filter((p) => !sealed.has(p.id));
    for (const p of fresh) this.readCards.add(p.id);
    if (fresh.length > 0) this.emit('postcards');
  }

  markRead(id: string): void {
    if (this.readCards.has(id)) return;
    this.readCards.add(id);
    this.emit('postcards');
  }

  cardLiked(id: string): boolean {
    return this.value('like-postcard', id);
  }

  toggleCardLike(id: string): boolean {
    const liked = !this.cardLiked(id);
    this.flip({ type: 'like-postcard', id, liked }, 'postcards');
    return liked;
  }

  cardFavorite(id: string): boolean {
    return this.value('favorite-postcard', id);
  }

  toggleCardFavorite(id: string): boolean {
    const favorite = !this.cardFavorite(id);
    this.flip({ type: 'favorite-postcard', id, favorite }, 'postcards');
    return favorite;
  }

  useInvitation(id: string): void {
    this.usedInvitations.add(id);
    this.react({ type: 'use-invitation', id });
    this.emit('postcards');
  }

  // ---- Muse ---------------------------------------------------------------------

  get status(): MuseStatus {
    return this.snapshot?.muse.status ?? { home: true };
  }

  /** What Muse is up to, in a few words: the source's line, or else at home or out exploring. */
  get statusNote(): string {
    const status = this.status;
    return status.note ?? (status.home ? 'At home' : 'Out exploring');
  }

  get reach(): Reach {
    return this.pendingReach ?? this.snapshot?.muse.reach ?? 'shared';
  }

  /**
   * Show the new friend group at once, then read the friends it takes in back from the source. It holds until the
   * source sends that group back; if the source turns it down, the page shows what the source holds again.
   */
  setReach(reach: Reach): void {
    if (reach === this.reach) return;
    this.pendingReach = reach;
    const reread = (fresh: GardenSnapshot): void => {
      const s = this.snapshot;
      if (!s) return;
      this.snapshot = { ...s, friends: fresh.friends, muse: { ...s.muse, reach: fresh.muse.reach } };
      if (this.pendingReach === fresh.muse.reach) this.pendingReach = null;
      this.emit('friends');
    };
    this.source.react({ type: 'set-reach', reach }).then(
      () => this.source.load().then(reread, (error: unknown) => console.warn('garden: the friends could not be read again', error)),
      (error: unknown) => {
        console.warn('garden: a reaction could not be sent', error);
        if (this.pendingReach !== reach) return;
        this.pendingReach = null;
        this.emit('friends');
      },
    );
    this.emit('friends');
  }
}
