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
  /** Tell Muse what you did. Fire and forget: the garden has already shown it. */
  react(reaction: Reaction): Promise<void>;
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
      await fetch(`${root}/garden/reactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reaction),
      });
    },
  };
}

/** The source this page reads: a backend named in the URL, or the placeholders. */
export function gardenSource(search = typeof location === 'undefined' ? '' : location.search): GardenSource {
  const base = new URLSearchParams(search).get('garden');
  return base ? httpSource(base) : placeholderSource();
}
