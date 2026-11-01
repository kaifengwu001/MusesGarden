// Pictures whose links expire (Instagram, Facebook, TikTok): fetched once, kept under the garden's data folder, and
// served from /api/media/<id> for as long as the find lives.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA_ID, type MediaItem } from '../adapters/sources/media';

export interface MediaImage {
  readonly type: string;
  readonly body: Uint8Array;
}

/** An item's picture by its media id, or null when there is none to give. */
export type MediaImages = (mid: string) => Promise<MediaImage | null>;

const EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function mediaCache(opts: { readonly dir: string; readonly items: readonly MediaItem[]; readonly fetch?: typeof fetch }): MediaImages {
  const sources = new Map(opts.items.flatMap((i) => (i.imageSource === undefined ? [] : [[i.id, i.imageSource] as const])));
  const fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const cached = (mid: string): MediaImage | null => {
    for (const [type, ext] of Object.entries(EXTENSIONS)) {
      const path = join(opts.dir, `${mid}.${ext}`);
      if (existsSync(path)) return { type, body: new Uint8Array(readFileSync(path)) };
    }
    return null;
  };
  return async (mid) => {
    const source = MEDIA_ID.test(mid) ? sources.get(mid) : undefined;
    if (source === undefined) return null;
    const hit = cached(mid);
    if (hit !== null) return hit;
    const res = await fetchImpl(source).catch(() => null);
    const type = res?.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const ext = EXTENSIONS[type];
    if (res === null || !res.ok || ext === undefined) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    mkdirSync(opts.dir, { recursive: true });
    writeFileSync(join(opts.dir, `${mid}.${ext}`), body);
    return { type, body };
  };
}
