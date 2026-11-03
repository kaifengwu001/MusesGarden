import { placeholderSource } from './placeholder';
import type { GardenEvent, GardenSnapshot, Reaction } from './types';

// The hook a backend fills. The garden asks a GardenSource for everything it
// shows once (load), listens for what arrives while it is open (subscribe:
// a new basket, a postcard, Muse coming home), and sends back what you do
// (react: a like, an interest shared or kept private, an invitation used).
// Nothing else crosses: the interface never asks Muse to do anything.
//
// The page picks its source from the URL: `?garden=<base URL>` reads a
// backend over HTTP (httpSource below: GET <base>/garden for the snapshot,
// server-sent events from <base>/garden/events, POST <base>/garden/reactions);
// without it, the placeholder gallery (placeholder.ts).

export interface GardenSource {
  /** Everything the garden shows, as of now. */
  load(): Promise<GardenSnapshot>;
  /** Called with each thing that arrives while the garden is open; returns the way to stop listening. */
  subscribe(listener: (event: GardenEvent) => void): () => void;
  /** Tell Muse what you did. The garden has already shown it; a rejection means the backend turned it down. */
  react(reaction: Reaction): Promise<void>;
}

/** The backend turned a reaction down, with its status and its reason (status 0: it could not be reached). */
export class ReactionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A backend over HTTP: the snapshot as JSON, events as server-sent events (each a GardenEvent in JSON), reactions posted as JSON. */
export function httpSource(base: string): GardenSource {
  const root = base.replace(/\/+$/, '');
  return {
    async load() {
      const response = await fetch(`${root}/garden`, { headers: { accept: 'application/json' }, credentials: 'include' });
      if (!response.ok) throw new Error(`garden: ${response.status} from ${root}/garden`);
      return (await response.json()) as GardenSnapshot;
    },
    subscribe(listener) {
      if (typeof EventSource === 'undefined') return () => undefined;
      const events = new EventSource(`${root}/garden/events`, { withCredentials: true });
      events.onmessage = (message: MessageEvent<string>) => {
        try {
          listener(JSON.parse(message.data) as GardenEvent);
        } catch (error) {
          console.warn('garden: an event could not be read', error);
        }
      };
      return () => events.close();
    },
    async react(reaction) {
      const response = await fetch(`${root}/garden/reactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reaction),
      }).catch(() => null);
      if (!response) throw new ReactionError(0, 'garden: the backend could not be reached');
      if (response.ok) return;
      // the API answers a refusal as {error}: its reason, for whoever shows it
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new ReactionError(response.status, typeof body?.error === 'string' ? body.error : `garden: ${response.status} from ${root}/garden/reactions`);
    },
  };
}

/** The Muse whose garden a backend URL reads (`…/api/muses/<id>`), or null for a URL of any other shape. */
export function gardenMuse(base: string): string | null {
  const id = /\/api\/muses\/([^/]+)\/?$/.exec(new URL(base, 'http://garden').pathname)?.[1];
  return id ? decodeURIComponent(id) : null;
}

/** The source this page reads: a backend named in the URL, or the placeholders. */
export function gardenSource(search = typeof location === 'undefined' ? '' : location.search): GardenSource {
  const base = new URLSearchParams(search).get('garden');
  return base ? httpSource(base) : placeholderSource();
}
