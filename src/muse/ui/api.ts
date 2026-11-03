import type { CommandResult, GardenQueries, Instant, MetricsRow, MindView, MuseId, NowView, SharingView } from '../contract';
import { path } from '../routes';

// The dev tools' and the 3D Muse's only door to the Muse engine (vite proxies /api to npm run serve).

export type ClockMode = 'live' | 'fast-forward';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number; readonly error: string };

const DONE: CommandResult = { ok: true };

export class MuseApi {
  /** This Muse's id as route params. */
  private readonly id: { readonly id: string };

  constructor(readonly museId: MuseId) {
    this.id = { id: museId };
  }

  now = () => this.get<NowView>(path('now', this.id));
  sharing = () => this.get<SharingView>(path('sharing', this.id));
  introduce = (shareCode: string) => this.command(path('introduce', this.id), { shareCode });
  setBasketTime = (hhmm: string | null) => this.command(path('basketTime', this.id), { hhmm });

  // The host simulator: stands in for the Muse app.
  hostWork = (state: 'started' | 'ended') => this.command(path('hostWork', this.id), { state });
  hostSoul = (text: string) => this.command(path('hostSoul', this.id), { text });
  hostMemory = (text: string) => this.command(path('hostMemory', this.id), { text });

  // Dev only.
  clock = () => this.get<{ readonly mode: ClockMode; readonly now: Instant }>(path('clock', {}));
  setClock = (mode: ClockMode) => this.command(path('setClock', {}), { mode });
  advance = (hours: number) => this.command(path('advance', {}), { hours });
  mind = () => this.get<MindView>(path('mind', this.id));
  metrics = () => this.get<readonly MetricsRow[]>(path('metrics', this.id));
  soulMd = () => this.get<string>(path('soulMd', this.id));
  muses = () => this.get<ReturnType<GardenQueries['muses']>>(path('muses', {}));
  /** For demos: `host` sends this Muse's owner a ticket now. */
  devInvite = (host: MuseId) => this.command(path('devInvite', {}), { host, guest: this.museId });
  /** For demos: this Muse is friends with exactly `friends`. */
  devFriends = (friends: readonly MuseId[]) => this.command(path('devFriends', {}), { muse: this.museId, friends });

  private async get<T>(path: string): Promise<T> {
    const r = await this.request<T>('GET', path, undefined);
    if (!r.ok) throw new ApiError(r.status, r.error);
    return r.value;
  }

  private async command(path: string, body: unknown): Promise<CommandResult> {
    const r = await this.request<unknown>('POST', path, body);
    if (r.ok) return DONE;
    const status = r.status === 400 || r.status === 403 || r.status === 404 || r.status === 409 ? r.status : 400;
    return { ok: false, status, error: r.error };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown): Promise<Reply<T>> {
    let res: Response;
    try {
      res = await fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, status: 503, error: 'The engine is unreachable.' };
    }
    if (!res.ok) return { ok: false, status: res.status, error: await errorOf(res) };
    const json = (res.headers.get('content-type') ?? '').includes('json');
    return { ok: true, value: (json ? await res.json() : await res.text()) as T };
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
