import type { ParamStore } from '../params';

/** State that lives in the URL hash next to the parameters (camera pose, frozen time). */
export interface HashExtra {
  readonly key: string;
  /** Current value to write, or null to leave it out. */
  read(): string | null;
  /** Apply a value from the URL; null when the key is absent. */
  write(value: string | null): void;
}

export function parseHash(hash: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of hash.replace(/^#/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    try {
      map.set(decodeURIComponent(i < 0 ? part : part.slice(0, i)), i < 0 ? '' : decodeURIComponent(part.slice(i + 1)));
    } catch {
      // malformed escape: skip the pair
    }
  }
  return map;
}

const encodeValue = (v: string): string => encodeURIComponent(v).replace(/%2C/gi, ',');

/**
 * Keeps `location.hash` and the param store in sync. Writes are debounced and
 * use replaceState (no history spam); external edits (typing a URL, back
 * button) are applied in full: anything missing from the hash returns to its
 * default, so a hash always describes one exact world and view.
 */
export class HashSync {
  private readonly extras: HashExtra[] = [];
  private lastHash = '';
  private timer: number | undefined;
  private applying = false;

  constructor(
    private readonly store: ParamStore,
    private readonly delayMs = 250,
  ) {}

  start(): void {
    this.apply(location.hash);
    this.store.subscribe(() => this.schedule());
    window.addEventListener('hashchange', () => {
      if (location.hash.replace(/^#/, '') !== this.lastHash) this.apply(location.hash);
    });
  }

  register(extra: HashExtra): void {
    this.extras.push(extra);
    extra.write(parseHash(location.hash).get(extra.key) ?? null);
  }

  /** Call when extra state changes; params changes schedule themselves. */
  schedule(): void {
    if (this.applying) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.writeNow(), this.delayMs);
  }

  serialize(): string {
    const parts: string[] = [];
    const query = this.store.toQuery();
    if (query) parts.push(query);
    for (const e of this.extras) {
      const v = e.read();
      if (v !== null) parts.push(`${e.key}=${encodeValue(v)}`);
    }
    return parts.join('&');
  }

  writeNow(): void {
    window.clearTimeout(this.timer);
    const hash = this.serialize();
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    history.replaceState(history.state, '', hash ? `#${hash}` : location.pathname + location.search);
  }

  /** Apply a hash string (with or without the leading #) to the store and extras. */
  apply(hash: string): void {
    this.applying = true;
    try {
      const map = parseHash(hash);
      this.store.applyQuery(map);
      for (const e of this.extras) e.write(map.get(e.key) ?? null);
      this.store.flush();
    } finally {
      this.applying = false;
    }
    // Track what the URL actually holds (the applied state may have come from
    // elsewhere, e.g. the harness), so the next write is not skipped.
    this.lastHash = location.hash.replace(/^#/, '');
  }
}
