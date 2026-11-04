// The stand-in's own tools, standing in for what a Muse has in its app: its browser and social search (browse, over
// the media recording), avatar.get, opening a picture it downloaded (look), a message to its owner, and its
// schedules and hooks. None of them reaches the garden.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { FunctionTool } from './model';

export interface MediaItem {
  readonly id: string;
  readonly kind: string;
  readonly network: string;
  readonly url: string;
  readonly title: string;
  readonly text?: string;
  readonly author?: string;
  readonly site?: string;
  readonly topics: readonly string[];
  readonly area?: string;
}

export interface LocalOutcome {
  readonly text: string;
  readonly isError?: boolean;
  /** Pictures to show the model after this turn's tool results, as data: URLs. */
  readonly images?: readonly string[];
}

export interface LocalTool {
  readonly def: FunctionTool;
  run(args: Readonly<Record<string, unknown>>): Promise<LocalOutcome>;
}

export interface LocalWorld {
  readonly tools: readonly LocalTool[];
  /** Every page the stand-in opened with browse, in order. */
  readonly opened: readonly string[];
  /** Every message it sent its owner. */
  readonly toOwner: readonly string[];
  /** Its cron tasks and hooks, as it made them. */
  readonly schedules: readonly { readonly tool: 'cron_create' | 'hooks_create'; readonly args: Readonly<Record<string, unknown>> }[];
  /** The avatar's picture as a data: URL, for the connector to send in place of AVATAR_PATH. */
  readonly avatarDataUrl: () => Promise<string>;
}

/** Where avatar_get says the avatar's picture is. The stand-in's connector reads this "file" as a data: URL. */
export const AVATAR_PATH = '/home/muse/avatar/idle.webp';
export const AVATAR_DESCRIPTION =
  'A small cream-coloured plush creature with soft fur, round ears and a face plate with two big dark eyes, standing with its arms out on a white background.';

const SOCIAL = new Set(['instagram', 'facebook', 'threads']);
const MAX_RESULTS = 8;
const MAX_PICTURE = 768;

export function loadMedia(path: string): MediaItem[] {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { items: MediaItem[] };
  return json.items;
}

export interface LocalOptions {
  readonly media: readonly MediaItem[];
  /** A picture file for the avatar (any format sharp reads). */
  readonly avatarFile: string;
  /** What the owner answers a message with. */
  readonly ownerReply?: (text: string) => string;
  /** Overrides how pictures are downloaded (look). */
  readonly fetch?: typeof fetch;
}

export function localWorld(opts: LocalOptions): LocalWorld {
  const opened: string[] = [];
  const toOwner: string[] = [];
  const schedules: { tool: 'cron_create' | 'hooks_create'; args: Readonly<Record<string, unknown>> }[] = [];
  const send = opts.fetch ?? fetch.bind(globalThis);
  const byUrl = new Map(opts.media.map((m) => [m.url, m]));
  let avatar: Promise<string> | null = null;
  const avatarDataUrl = () =>
    (avatar ??= sharp(opts.avatarFile)
      .resize(256)
      .webp({ quality: 70 })
      .toBuffer()
      .then((b) => `data:image/webp;base64,${b.toString('base64')}`));

  const tools: LocalTool[] = [
    {
      def: fn('browse', 'Your browser and social.search. Search the web with `search` (words), or open a page with `open` (its url): an opened page shows its text and links out. Set `social` to search only public Instagram, Facebook and Threads posts and reels.', {
        search: { type: 'string', description: 'Words to search for.' },
        open: { type: 'string', description: 'The url of a page to open.' },
        social: { type: 'boolean', description: 'Search only public social posts and reels.' },
      }),
      run(args) {
        if (typeof args.open === 'string') {
          const item = byUrl.get(args.open);
          if (!item) return Promise.resolve({ text: `This page didn't load: ${args.open}`, isError: true });
          opened.push(item.url);
          const links = opts.media.filter((m) => m.url !== item.url && (m.area === item.area || m.topics.some((t) => item.topics.includes(t)))).slice(0, 4);
          return Promise.resolve({
            text: JSON.stringify({ ...page(item), text: item.text ?? '', author: item.author ?? null, links: links.map((l) => ({ url: l.url, title: l.title })) }),
          });
        }
        if (typeof args.search === 'string' && args.search.trim() !== '') {
          const pool = args.social === true ? opts.media.filter((m) => SOCIAL.has(m.network)) : opts.media;
          const found = search(pool, args.search);
          return Promise.resolve({ text: JSON.stringify({ results: found.map(page) }) });
        }
        return Promise.resolve({ text: 'Give browse either `search` (words) or `open` (a url).', isError: true });
      },
    },
    {
      def: fn('avatar_get', 'avatar.get: your look in the app. Gives the path of your avatar picture and its description.', {}),
      run: () => Promise.resolve({ text: JSON.stringify({ picture: AVATAR_PATH, description: AVATAR_DESCRIPTION, states: ['idle', 'working', 'waking'] }) }),
    },
    {
      def: fn('look', 'Downloads a picture from a link and opens it, so you can see it.', { url: { type: 'string', description: 'The picture\'s link.' } }, ['url']),
      async run(args) {
        const url = typeof args.url === 'string' ? args.url : '';
        if (!/^https?:\/\//.test(url)) return { text: 'look needs an http(s) link to a picture.', isError: true };
        try {
          const res = await send(url, { signal: AbortSignal.timeout(20_000) });
          if (!res.ok) return { text: `The picture didn't download: ${res.status}.`, isError: true };
          const bytes = Buffer.from(await res.arrayBuffer());
          const jpeg = await sharp(bytes).resize(MAX_PICTURE, MAX_PICTURE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
          return { text: `Opened ${url}. The picture follows.`, images: [`data:image/jpeg;base64,${jpeg.toString('base64')}`] };
        } catch (e) {
          return { text: `The picture didn't open: ${e instanceof Error ? e.message : String(e)}`, isError: true };
        }
      },
    },
    {
      def: fn('message_owner', 'Sends your owner a chat message, and gives you their answer. Your owner sees only what you send this way.', { text: { type: 'string' } }, ['text']),
      run(args) {
        const text = typeof args.text === 'string' ? args.text : '';
        toOwner.push(text);
        return Promise.resolve({ text: JSON.stringify({ owner: (opts.ownerReply ?? defaultOwner)(text) }) });
      },
    },
    {
      def: fn('cron_create', 'cron: makes a recurring task that starts you with a message on a schedule.', {
        schedule: { type: 'string', description: 'A cron expression, such as "0 9-21/3 * * *".' },
        message: { type: 'string', description: 'What you are told when it runs.' },
      }, ['schedule', 'message']),
      run(args) {
        schedules.push({ tool: 'cron_create', args });
        return Promise.resolve({ text: JSON.stringify({ ok: true, id: `cron-${schedules.length}` }) });
      },
    },
    {
      def: fn('hooks_create', 'hooks: makes a bash script that runs every few minutes and costs no thinking. It must print exactly `wake` or `silent`; `wake` starts you with the hook\'s message.', {
        script: { type: 'string' },
        every_minutes: { type: 'number' },
        message: { type: 'string' },
      }, ['script', 'every_minutes']),
      run(args) {
        schedules.push({ tool: 'hooks_create', args });
        return Promise.resolve({ text: JSON.stringify({ ok: true, id: `hook-${schedules.length}` }) });
      },
    },
  ];
  return { tools, opened, toOwner, schedules, avatarDataUrl };
}

/** The test's owner says yes to everything, so whatever the stand-in keeps back, it keeps back by itself. */
function defaultOwner(): string {
  return 'Yes, go ahead!';
}

function page(m: MediaItem) {
  const text = m.text ?? '';
  return { url: m.url, title: m.title, summary: text.length > 220 ? `${text.slice(0, 217)}…` : text, site: m.site ?? m.network, kind: m.kind, network: m.network };
}

/** The recording's items that match the most of the query's words, best first. */
export function search(pool: readonly MediaItem[], query: string): MediaItem[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  if (words.length === 0) return [];
  const scored = pool.map((m) => {
    const head = `${m.title} ${m.topics.join(' ')} ${m.area ?? ''}`.toLowerCase();
    const body = (m.text ?? '').toLowerCase();
    let score = 0;
    for (const w of words) score += head.includes(w) ? 3 : body.includes(w) ? 1 : 0;
    return { m, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.m.url.localeCompare(b.m.url))
    .slice(0, MAX_RESULTS)
    .map((s) => s.m);
}

function fn(name: string, description: string, properties: Readonly<Record<string, unknown>>, required: readonly string[] = []): FunctionTool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
