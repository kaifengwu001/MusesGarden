// Real Instagram posts and reels of public business and creator accounts, through the Graph API's Business Discovery.
// It needs the owner's token in META_IG_TOKEN; without one the recorder leaves Instagram out.
import { arr, obj, optStr, str } from './json';
import type { RawItem } from './media';
import { clampSummary } from './text';

const GRAPH = 'https://graph.facebook.com/v21.0';
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp';
const TITLE_MAX = 90;

export interface InstagramOptions {
  readonly token: string;
  /** The token owner's Instagram professional account; found through its Facebook Page when absent. */
  readonly userId?: string;
  readonly fetch?: typeof fetch;
}

/** A caption's first line, cut at a word, as the card's title. */
export function captionTitle(caption: string, fallback: string): string {
  const line = caption.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  if (line === '') return fallback;
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), TITLE_MAX / 2)).trim()}…`;
}

/** Reels are reels; photos, carousels and the rest are posts. */
function toItem(raw: unknown, username: string, i: number): RawItem | null {
  const m = obj(raw, `media[${i}]`);
  const permalink = optStr(m.permalink, 'permalink');
  const product = optStr(m.media_product_type, 'media_product_type');
  const type = optStr(m.media_type, 'media_type');
  const image = type === 'VIDEO' ? optStr(m.thumbnail_url, 'thumbnail_url') : optStr(m.media_url, 'media_url');
  if (permalink === undefined || image === undefined) return null;
  const reel = product === 'REELS' || type === 'VIDEO';
  const shortcode = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(permalink)?.[1] ?? str(m.id, 'id');
  const caption = optStr(m.caption, 'caption') ?? '';
  const timestamp = optStr(m.timestamp, 'timestamp');
  return {
    id: `ig-${shortcode}`,
    kind: reel ? 'reel' : 'post',
    network: 'instagram',
    url: permalink,
    title: captionTitle(caption, `@${username}`),
    text: clampSummary(caption),
    author: `@${username}`,
    site: 'Instagram',
    image,
    ...(reel ? { aspect: 9 / 16 } : {}),
    ...(timestamp === undefined ? {} : { published: timestamp.slice(0, 10) }),
    tags: [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((t) => t[1]),
  };
}

export class InstagramReader {
  private readonly fetchImpl: typeof fetch;
  private userId: Promise<string> | undefined;

  constructor(private readonly options: InstagramOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    if (options.userId !== undefined) this.userId = Promise.resolve(options.userId);
  }

  /** From META_IG_TOKEN (and META_IG_USER_ID if set), or null when there is no token. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): InstagramReader | null {
    const token = env.META_IG_TOKEN?.trim();
    if (!token) return null;
    const userId = env.META_IG_USER_ID?.trim();
    return new InstagramReader({ token, ...(userId ? { userId } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  /** The newest posts and reels of a public business or creator account. */
  async latest(username: string, limit: number): Promise<RawItem[]> {
    const fields = `business_discovery.username(${username}){username,media.limit(${limit}){${MEDIA_FIELDS}}}`;
    const body = await this.get(`${await this.ownId()}`, { fields });
    const discovery = obj(body.business_discovery, 'business_discovery');
    const media = obj(discovery.media, 'business_discovery.media');
    return arr(media.data, 'media.data').flatMap((m, i) => toItem(m, username, i) ?? []);
  }

  private ownId(): Promise<string> {
    this.userId ??= this.get('me/accounts', { fields: 'instagram_business_account' }).then((body) => {
      for (const page of arr(body.data, 'accounts.data')) {
        const account = obj(page, 'page').instagram_business_account;
        if (account !== undefined) return str(obj(account, 'instagram_business_account').id, 'instagram_business_account.id');
      }
      throw new Error('instagram: no Facebook Page of this token has an Instagram professional account linked');
    });
    return this.userId;
  }

  private async get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${GRAPH}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', this.options.token);
    const res = await this.fetchImpl(url);
    const body = obj(await res.json(), 'graph reply');
    if (!res.ok || body.error !== undefined) {
      const message = body.error === undefined ? '' : (optStr(obj(body.error, 'error').message, 'error.message') ?? '');
      throw new Error(`instagram: ${path.split('?')[0]} answered ${res.status} ${message}`.trim());
    }
    return body;
  }
}
