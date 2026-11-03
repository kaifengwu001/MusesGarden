import type { MediaInfo, Network } from '../muse/contract';
import type { Media } from './types';

// A find as the garden's card draws it, from what the server keeps of it: shared by the server's garden
// (server/engine/garden.ts) and a visit's cards (src/visit/), which read a friend's public finds.

const NETWORKS: Readonly<Record<Exclude<Network, 'web'>, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  tiktok: 'TikTok',
  flickr: 'Flickr',
  bluesky: 'Bluesky',
};

/** What a card reads of a find: a Discovery and a PlantCard both have it. */
export interface MediaSource {
  readonly url: string;
  readonly title: string;
  readonly summary: string;
  readonly media: MediaInfo;
}

/** Kai's card for a find: its own network's name, or an article site's own name, and the picture the server can show. */
export function mediaOf(d: MediaSource): Media {
  const info = d.media;
  const titled = info.kind === 'article' || info.kind === 'video';
  return {
    kind: info.kind,
    url: d.url,
    source: info.site ?? (info.network === 'web' ? new URL(d.url).hostname.replace(/^www\./, '') : NETWORKS[info.network]),
    author: info.author,
    title: titled ? d.title : undefined,
    text: titled ? d.summary : d.summary || d.title,
    image: info.image,
    aspect: info.aspect,
    duration: info.duration,
    minutes: info.minutes,
    published: info.published,
  };
}
