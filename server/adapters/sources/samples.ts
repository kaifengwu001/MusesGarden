// Recorded HTTP for the source tests: record.ts saves real responses, and tests replay them without the network.

export type Samples = Record<string, unknown>;

/** More than one batch of extracts (20 per request), plus a redirect and a duplicate after redirects. */
export const SAMPLE_BATCH = [
  'Jazz', 'Bebop', 'Swing music', 'Miles Davis', 'Pigment', 'Ultramarine', 'Lapis lazuli', 'Vermilion', 'Ochre',
  'Indigo dye', 'Tea', 'Matcha', 'Oolong', 'Fungus', 'Mycology', 'Origami', 'Typography', 'Serif', 'Cartography',
  'Map projection', 'Bird', 'Owl', 'Sextant', 'Astrolabe', 'Ukiyo-e', 'Colour', 'Color',
];

export function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** The request URL with its query parameters sorted, so the key doesn't depend on parameter order. */
export function sampleKey(url: string): string {
  const u = new URL(url);
  const params = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${u.origin}${u.pathname}?${new URLSearchParams(params).toString()}`;
}

/** Records each request once and serves repeats from the recording, so recording sees exactly what replay will. */
export function recordingFetch(into: Samples): typeof fetch {
  return async (input, init) => {
    const key = sampleKey(urlOf(input));
    if (key in into) return Response.json(into[key]);
    const res = await fetch(input, init);
    if (res.ok) into[key] = await res.clone().json();
    return res;
  };
}

/** Serves recorded JSON. Any request that wasn't recorded fails, so a replay can never reach the network. */
export function replayFetch(samples: Readonly<Samples>): typeof fetch {
  return (input) => {
    const key = sampleKey(urlOf(input));
    if (!(key in samples)) return Promise.reject(new Error(`no recorded response for ${key}`));
    return Promise.resolve(Response.json(samples[key]));
  };
}
