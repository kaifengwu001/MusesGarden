import type {
  BasketId,
  BasketView,
  CommandResult,
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
  SharingView,
  ShelfView,
  VisitWorldView,
  WorldView,
} from '../contract';
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
  private readonly m: string;

  constructor(readonly museId: MuseId) {
    this.sample = new SampleGarden(museId);
    this.m = `/api/muses/${encodeURIComponent(museId)}`;
  }

  get source(): DataSource {
    return this.sourceNow;
  }

  onSource(fn: (s: DataSource) => void): void {
    this.listeners.add(fn);
  }

  now = () => this.get<NowView>(`${this.m}/now`, () => this.sample.now());
  world = () => this.get<WorldView>(`${this.m}/world`, () => samples.sampleWorld);
  baskets = (before: BasketId | null) => this.get<Page<BasketView, BasketId>>(`${this.m}/baskets${q({ before })}`, () => page(samples.sampleBaskets.items, before));
  photos = (before: PhotoId | null) => this.get<Page<PhotoView, PhotoId>>(`${this.m}/photos${q({ before })}`, () => page(samples.samplePhotos.items, before));
  shelf = () => this.get<ShelfView>(`${this.m}/home/shelf`, () => samples.sampleShelf);
  invitations = () => this.get<readonly InvitationCard[]>(`${this.m}/invitations`, () => this.sample.invitations());
  sharing = () => this.get<SharingView>(`${this.m}/settings/sharing`, () => this.sample.sharing);

  answer = (id: InvitationId, action: Answer) =>
    this.command(`/api/invitations/${encodeURIComponent(id)}/${action}${q({ as: this.museId })}`, undefined, () => this.sample.answer(id, action));

  async visit(id: InvitationId): Promise<VisitWorldView | 'forbidden'> {
    const r = await this.request<VisitWorldView>('GET', `/api/visits/${encodeURIComponent(id)}/world${q({ as: this.museId })}`, undefined, () => {
      const v = this.sample.visit(id);
      return v ? ok(v) : { ok: false, status: 403, error: 'forbidden' };
    });
    if (r.ok) return r.value;
    if (r.status === 403) return 'forbidden';
    throw new ApiError(r.status, r.error);
  }

  setHidden = (ref: HiddenRef, hidden: boolean) => this.command(`${this.m}/settings/hidden`, { ref, hidden }, () => this.sample.setHidden(ref, hidden));
  introduce = (shareCode: string) => this.command(`${this.m}/settings/introductions`, { shareCode }, () => this.sample.introduce(shareCode));
  unshare = (other: MuseId) => this.command(`${this.m}/settings/unshare`, { other }, () => this.sample.unshare(other));
  setBasketTime = (hhmm: string | null) => this.command(`${this.m}/settings/basket-time`, { hhmm }, () => this.sample.setBasketTime(hhmm));

  // The host simulator: stands in for the Muse app.
  hostWork = (state: 'started' | 'ended') => this.command(`/api/host/${encodeURIComponent(this.museId)}/work`, { state }, () => this.sample.work(state));
  hostSoul = (text: string) => this.command(`/api/host/${encodeURIComponent(this.museId)}/soul`, { text }, () => DONE);
  hostMemory = (text: string) => this.command(`/api/host/${encodeURIComponent(this.museId)}/memory`, { text }, () => DONE);

  // Dev only.
  clock = () => this.get<{ readonly mode: ClockMode; readonly now: Instant }>('/api/dev/clock', () => this.sample.clock());
  setClock = (mode: ClockMode) => this.command('/api/dev/clock', { mode }, () => this.sample.setClock(mode));
  advance = (hours: number) => this.command('/api/dev/advance', { hours }, () => this.sample.advance(hours));
  mind = () => this.get<MindView>(`/api/dev/${encodeURIComponent(this.museId)}/mind`, () => samples.sampleMind);
  metrics = () => this.get<readonly MetricsRow[]>(`/api/dev/${encodeURIComponent(this.museId)}/metrics`, () => samples.sampleMetrics);
  soulMd = () => this.get<string>(`/api/dev/${encodeURIComponent(this.museId)}/soul.md`, () => samples.sampleSoulMd);

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

function q(params: Record<string, string | null>): string {
  const parts = Object.entries(params).flatMap(([k, v]) => (v === null ? [] : [`${k}=${encodeURIComponent(v)}`]));
  return parts.length ? `?${parts.join('&')}` : '';
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
