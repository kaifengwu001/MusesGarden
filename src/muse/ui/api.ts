import type {
  BasketId,
  BasketView,
  CommandResult,
  DiscoveryId,
  HiddenRef,
  Instant,
  InvitationCard,
  InvitationId,
  MetricsRow,
  MindView,
  MuseId,
  NowView,
  Page,
  PhotoId,
  PhotoView,
  PlantCard,
  SharingView,
  ShelfView,
  VisitWorldView,
  WorldView,
} from '../contract';
import { path } from '../routes';
import * as samples from '../samples';

// The overlay's only door to the Muse server (vite proxies /api to npm run serve). Until a live
// answer arrives, an unreachable server (no connection, or the proxy's 5xx) falls back to an
// in-memory SampleGarden built from src/muse/samples.ts, so the overlay works before the server
// exists. After a live answer, errors are real errors.

export type Answer = 'approve' | 'decline' | 'accept';
export type ClockMode = 'live' | 'fast-forward';
export type DataSource = 'unknown' | 'live' | 'sample';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number; readonly error: string };

const ok = <T>(value: T): Reply<T> => ({ ok: true, value });
const DONE: CommandResult = { ok: true };

export class MuseApi {
  private sourceNow: DataSource = 'unknown';
  private readonly listeners = new Set<(s: DataSource) => void>();
  private readonly sample: SampleGarden;

  /** This Muse's id as route params. */
  private readonly id: { readonly id: string };

  constructor(readonly museId: MuseId) {
    this.id = { id: museId };
    this.sample = new SampleGarden(museId);
  }

  get source(): DataSource {
    return this.sourceNow;
  }

  onSource(fn: (s: DataSource) => void): void {
    this.listeners.add(fn);
  }

  now = () => this.get<NowView>(path('now', this.id), () => this.sample.now());
  world = () => this.get<WorldView>(path('world', this.id), () => samples.sampleWorld);
  plant = (id: DiscoveryId) => this.get<PlantCard | null>(path('plant', { ...this.id, pid: id }), () => samples.sampleCards.find((c) => c.id === id) ?? null);
  baskets = (before: BasketId | null) => this.get<Page<BasketView, BasketId>>(path('baskets', this.id, { before }), () => page(samples.sampleBaskets.items, before));
  photos = (before: PhotoId | null) => this.get<Page<PhotoView, PhotoId>>(path('photos', this.id, { before }), () => page(samples.samplePhotos.items, before));
  shelf = () => this.get<ShelfView>(path('shelf', this.id), () => samples.sampleShelf);
  invitations = () => this.get<readonly InvitationCard[]>(path('invitations', this.id), () => this.sample.invitations());
  sharing = () => this.get<SharingView>(path('sharing', this.id), () => this.sample.sharing);

  answer = (id: InvitationId, action: Answer) =>
    this.command(path('answer', { id, action }, { as: this.museId }), undefined, () => this.sample.answer(id, action));

  async visit(id: InvitationId): Promise<VisitWorldView | 'forbidden'> {
    const r = await this.request<VisitWorldView>('GET', path('visit', { id }, { as: this.museId }), undefined, () => {
      const v = this.sample.visit(id);
      return v ? ok(v) : { ok: false, status: 403, error: 'forbidden' };
    });
    if (r.ok) return r.value;
    if (r.status === 403) return 'forbidden';
    throw new ApiError(r.status, r.error);
  }

  setHidden = (ref: HiddenRef, hidden: boolean) => this.command(path('hidden', this.id), { ref, hidden }, () => this.sample.setHidden(ref, hidden));
  introduce = (shareCode: string) => this.command(path('introduce', this.id), { shareCode }, () => this.sample.introduce(shareCode));
  unshare = (other: MuseId) => this.command(path('unshare', this.id), { other }, () => this.sample.unshare(other));
  setBasketTime = (hhmm: string | null) => this.command(path('basketTime', this.id), { hhmm }, () => this.sample.setBasketTime(hhmm));

  // The host simulator: stands in for the Muse app.
  hostWork = (state: 'started' | 'ended') => this.command(path('hostWork', this.id), { state }, () => this.sample.work(state));
  hostSoul = (text: string) => this.command(path('hostSoul', this.id), { text }, () => DONE);
  hostMemory = (text: string) => this.command(path('hostMemory', this.id), { text }, () => DONE);

  // Dev only.
  clock = () => this.get<{ readonly mode: ClockMode; readonly now: Instant }>(path('clock', {}), () => this.sample.clock());
  setClock = (mode: ClockMode) => this.command(path('setClock', {}), { mode }, () => this.sample.setClock(mode));
  advance = (hours: number) => this.command(path('advance', {}), { hours }, () => this.sample.advance(hours));
  mind = () => this.get<MindView>(path('mind', this.id), () => samples.sampleMind);
  metrics = () => this.get<readonly MetricsRow[]>(path('metrics', this.id), () => samples.sampleMetrics);
  soulMd = () => this.get<string>(path('soulMd', this.id), () => samples.sampleSoulMd);

  private async get<T>(path: string, offline: () => T): Promise<T> {
    const r = await this.request<T>('GET', path, undefined, () => ok(offline()));
    if (!r.ok) throw new ApiError(r.status, r.error);
    return r.value;
  }

  private async command(path: string, body: unknown, offline: () => CommandResult): Promise<CommandResult> {
    const r = await this.request<unknown>('POST', path, body, () => {
      const c = offline();
      return c.ok ? ok(null) : { ok: false, status: c.status, error: c.error };
    });
    if (r.ok) return DONE;
    const status = r.status === 400 || r.status === 403 || r.status === 404 || r.status === 409 ? r.status : 400;
    return { ok: false, status, error: r.error };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown, offline: () => Reply<T>): Promise<Reply<T>> {
    let res: Response | null;
    try {
      res = await fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      res = null;
    }
    if ((!res || res.status >= 500) && this.sourceNow !== 'live') {
      this.setSource('sample');
      return offline();
    }
    if (!res) return { ok: false, status: 503, error: 'The garden is unreachable.' };
    this.setSource('live');
    if (!res.ok) return { ok: false, status: res.status, error: await errorOf(res) };
    const json = (res.headers.get('content-type') ?? '').includes('json');
    return ok((json ? await res.json() : await res.text()) as T);
  }

  private setSource(s: DataSource): void {
    if (s === this.sourceNow) return;
    this.sourceNow = s;
    for (const fn of this.listeners) fn(s);
  }
}

/** The server answers errors as JSON {error}. */
async function errorOf(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const { error } = JSON.parse(raw) as { error?: unknown };
    if (typeof error === 'string') return error;
  } catch {
    // not JSON: use the text as it is
  }
  return raw || res.statusText;
}


/** One item per page offline, so paging is exercised before the server exists. */
function page<T extends { readonly id: string }>(items: readonly T[], before: string | null): Page<T, T['id']> {
  const start = before === null ? 0 : items.findIndex((i) => i.id === before) + 1;
  const slice = items.slice(start, start + 1);
  return { items: slice, next: start + 1 < items.length ? slice[0].id : null };
}

const HOUR = 3_600_000;

/** A tiny stand-in server over the samples: a clock, invitation answers, sharing settings, work. */
class SampleGarden {
  private base = samples.sampleNowExploring.at as number;
  private wallAt = Date.now();
  private mode: ClockMode = 'live';
  private working = false;
  private readonly cards = new Map(samples.sampleInvitations.map((c) => [c.id, { ...c }]));
  sharing = structuredClone<SharingView>(samples.sampleSharing);

  constructor(private readonly museId: MuseId) {}

  private at(): Instant {
    return (this.mode === 'live' ? this.base + Date.now() - this.wallAt : this.base) as Instant;
  }

  now(): NowView {
    const view = this.working ? samples.sampleNowWorking : samples.sampleNowExploring;
    return { ...view, museId: this.museId, at: this.at() };
  }

  clock(): { readonly mode: ClockMode; readonly now: Instant } {
    return { mode: this.mode, now: this.at() };
  }

  setClock(mode: ClockMode): CommandResult {
    this.base = this.at();
    this.wallAt = Date.now();
    this.mode = mode;
    return DONE;
  }

  advance(hours: number): CommandResult {
    if (!(hours > 0)) return { ok: false, status: 400, error: 'hours must be positive' };
    this.base += hours * HOUR;
    return DONE;
  }

  invitations(): readonly InvitationCard[] {
    const t = this.at();
    return [...this.cards.values()].map((c): InvitationCard => {
      if (c.state !== 'accepted' && c.state !== 'open') return c;
      if (t >= c.window.end) return { ...c, state: 'closed', canVisitNow: false };
      const open = t >= c.window.start;
      return { ...c, state: open ? 'open' : 'accepted', canVisitNow: open && c.role === 'guest' };
    });
  }

  answer(id: InvitationId, action: Answer): CommandResult {
    const card = this.cards.get(id);
    if (!card) return { ok: false, status: 404, error: 'no such invitation' };
    if (!card.actions.includes(action)) return { ok: false, status: 409, error: `cannot ${action} now` };
    this.cards.set(id, { ...card, actions: [], state: action === 'decline' ? 'declined' : action === 'approve' ? 'sent' : 'accepted' });
    return DONE;
  }

  visit(id: InvitationId): VisitWorldView | null {
    const card = this.invitations().find((c) => c.id === id);
    return card?.canVisitNow ? { ...samples.sampleVisit, invitation: id, until: card.window.end } : null;
  }

  setHidden(ref: HiddenRef, hidden: boolean): CommandResult {
    const s = this.sharing;
    this.sharing = {
      ...s,
      interests: s.interests.map((i) => (`topic:${i.topic}` === ref ? { ...i, hidden } : i)),
      finds: s.finds.map((f) => (`discovery:${f.id}` === ref ? { ...f, hidden } : f)),
    };
    return DONE;
  }

  introduce(code: string): CommandResult {
    const name = code.trim();
    if (!name) return { ok: false, status: 400, error: 'Enter a share code.' };
    this.sharing = { ...this.sharing, friends: [...this.sharing.friends, { museId: `code-${name}` as MuseId, name, origin: 'introduced' }] };
    return DONE;
  }

  unshare(other: MuseId): CommandResult {
    this.sharing = { ...this.sharing, friends: this.sharing.friends.filter((f) => f.museId !== other) };
    return DONE;
  }

  setBasketTime(time: string | null): CommandResult {
    this.sharing = { ...this.sharing, basketTime: time };
    return DONE;
  }

  work(state: 'started' | 'ended'): CommandResult {
    this.working = state === 'started';
    return DONE;
  }
}
