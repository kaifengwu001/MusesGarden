import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalUrl, Candidate, IntakeOutcome, TopicKey } from '../../src/muse/contract';
import { FixtureSource, type Corpus, type CorpusPage } from '../adapters/sources/corpus';
import { createIntake, defaultIntake, filingFor, INSTAGRAM_LOOK, isLoginUrl, LINK_TIMEOUT_MS, REASONS, REPORT_TIMEOUT_MS, type IntakeOptions } from './intake';

const FIXTURES = new URL('./fixtures/intake/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');

const page = (title: string, area: string, aliases: string[] = []): CorpusPage => ({
  area,
  candidate: { origin: 'wikipedia', url: `https://map.example/${title}`, canonicalUrl: `https://map.example/${title}` as CanonicalUrl, title, summary: title, topics: [title as TopicKey] },
  links: [],
  aliases,
});

/** A small topic map: pigments, birds and jazz. */
const MAP: Corpus = {
  recordedAt: '2026-10-31',
  areas: [
    { name: 'pigments', seeds: ['Pigment'] },
    { name: 'birds', seeds: ['Bird'] },
    { name: 'jazz', seeds: ['Jazz'] },
  ],
  pages: [
    page('Pigment', 'pigments'),
    page('Blue', 'pigments'),
    page('Ultramarine', 'pigments', ['Ultramarine blue']),
    page('Lapis lazuli', 'pigments', ['Lapis']),
    page('Kermes (dye)', 'pigments'),
    page('Bird', 'birds'),
    page('Bird migration', 'birds'),
    page('Jazz', 'jazz'),
    page('Bebop', 'jazz'),
  ],
};
const source = new FixtureSource(MAP);
const T = (t: string) => t as TopicKey;

// ─── The fixture site ───────────────────────────────────────────────────────

interface Site {
  readonly origin: string;
  /** Requests by path, in order. */
  readonly hits: string[];
  /** Bytes the endless page sent before the reader hung up. */
  endlessSent: number;
  endlessClosed: Promise<void>;
}

let server: Server;
let site: Site;

function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function endless(res: ServerResponse, done: () => void): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.write('<!doctype html><html><head><title>An endless page</title><meta property="og:title" content="The longest scroll"></head><body>');
  const chunk = `<p>${'and the scroll goes on '.repeat(2800)}</p>`;
  let open = true;
  res.on('close', () => {
    open = false;
    done();
  });
  const pump = () => {
    while (open) {
      site.endlessSent += chunk.length;
      if (!res.write(chunk)) {
        res.once('drain', pump);
        return;
      }
    }
  };
  pump();
}

function route(req: IncomingMessage, res: ServerResponse, endlessDone: () => void): void {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  site.hits.push(path);
  switch (path) {
    case '/article':
      return html(res, fixture('article.html'));
    case '/moved':
      res.writeHead(301, { location: '/article' });
      return void res.end();
    case '/forbidden':
      return html(res, '<title>Forbidden</title>', 403);
    case '/members':
      res.writeHead(302, { location: '/accounts/login?next=%2Fmembers' });
      return void res.end();
    case '/accounts/login':
    case '/soft-wall':
      return html(res, fixture('login.html'));
    case '/video':
      return html(res, fixture('video.html'));
    case '/plain':
      return html(res, fixture('plain.html'));
    case '/shell':
      return html(res, fixture('shell.html'));
    case '/late':
      return html(res, `<html><head><title>A long page with a late description</title></head><body><p>${'x'.repeat(1_200_000)}</p><meta name="description" content="too late to be read"></body></html>`);
    case '/endless':
      return endless(res, endlessDone);
    case '/hang':
      return;
    case '/missing':
      return html(res, '<title>Not found</title>', 404);
    case '/busy':
      return html(res, '<title>Slow down</title>', 429);
    case '/oops':
      return html(res, '<title>Oops</title>', 503);
    case '/file.pdf':
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return void res.end('%PDF-1.7');
    case '/picture.jpg':
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return void res.end('jpeg');
    case '/loop':
      res.writeHead(302, { location: '/loop' });
      return void res.end();
    default:
      return html(res, '<title>Not found</title>', 404);
  }
}

beforeAll(async () => {
  let endlessDone = () => {};
  site = {
    origin: '',
    hits: [],
    endlessSent: 0,
    endlessClosed: new Promise<void>((resolve) => {
      endlessDone = resolve;
    }),
  };
  server = createServer((req, res) => route(req, res, endlessDone));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = { ...site, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const local = (more: Partial<IntakeOptions> = {}) => createIntake({ resolveTopic: (l) => source.resolveTopic(l), fileUnder: filingFor(MAP), openPrivate: true, ...more });
const at = (path: string) => `${site.origin}${path}`;
const accepted = (o: IntakeOutcome | undefined): Candidate => {
  if (o === undefined || !o.ok) throw new Error(`refused: ${o === undefined ? 'no outcome' : o.reason}`);
  return o.candidate;
};
const reason = (o: IntakeOutcome | undefined): string => {
  if (o === undefined || o.ok) throw new Error('accepted');
  return o.reason;
};
const visit = { interests: [T('Ultramarine')], thread: 'blue pigments' };

// ─── Pages ──────────────────────────────────────────────────────────────────

describe('a page Muse kept', () => {
  it('is read from its preview tags, as the recorder reads an article', async () => {
    const [o] = await local()([at('/article')], visit);
    expect(o.url).toBe(at('/article'));
    expect(accepted(o)).toEqual({
      url: at('/article'),
      canonicalUrl: `https://127.0.0.1:${new URL(site.origin).port}/stories/lapis?id=7`,
      title: 'Grinding lapis lazuli for ultramarine',
      summary: 'How painters once ground the blue stone into the costliest pigment of all, and why it still glows.',
      topics: ['Lapis lazuli', 'Ultramarine', 'Pigment', 'Blue'],
      media: {
        kind: 'article',
        network: 'web',
        author: 'Ada Ferrous',
        image: 'https://cdn.paintbox.example/lapis.jpg',
        aspect: 1.5,
        minutes: 2,
        site: 'The Paint Box',
        published: '2026-10-30',
      },
    });
  });

  it('follows a redirect, and is kept where it opened', async () => {
    const [o] = await local()([at('/moved')], visit);
    expect(o.url).toBe(at('/moved'));
    expect(accepted(o).url).toBe(at('/article'));
  });

  it('reads a video page as a video, with its length', async () => {
    const c = accepted((await local()([at('/video')], visit))[0]);
    expect(c.title).toBe("Mixing a robin's-egg blue");
    expect(c.media).toEqual({ kind: 'video', network: 'web', image: 'https://films.example/robin.jpg', duration: 95, site: 'Studio Films' });
  });

  it('reads a page with no preview tags from its title and first lines', async () => {
    const c = accepted((await local()([at('/plain')], { interests: [T('Jazz')], thread: '' }))[0]);
    expect(c.title).toBe('A quiet afternoon at the window');
    expect(c.summary).toBe('The rain stopped a little after three, and the light came back in long stripes across the floor. Nothing much happened, which was the point of it.');
    expect(c.media.site).toBe('127.0.0.1');
  });
});

describe('a page behind a login', () => {
  it('is refused for a 403, a redirect to a login page, or a login form', async () => {
    const before = site.hits.length;
    const outcomes = await local()([at('/forbidden'), at('/members'), at('/soft-wall')], visit);
    expect(outcomes.map(reason)).toEqual([REASONS.login, REASONS.login, REASONS.login]);
    expect(site.hits.slice(before)).not.toContain('/accounts/login');
  });

  it('knows login pages by their address', () => {
    const login = ['https://www.instagram.com/accounts/login/?next=%2Fp%2Fabc%2F', 'https://www.facebook.com/login.php', 'https://accounts.google.com/v3/signin', 'https://example.com/users/sign_in', 'https://news.example/login?next=/a', 'https://x.com/i/flow/login'];
    const pages = ['https://example.com/author/ada', 'https://example.com/blog/login-tips-for-gardeners', 'https://example.com/sessions/42', 'https://www.instagram.com/p/abcdef/'];
    expect(login.filter((u) => !isLoginUrl(new URL(u)))).toEqual([]);
    expect(pages.filter((u) => isLoginUrl(new URL(u)))).toEqual([]);
  });
});

describe('a link that does not open', () => {
  it('says why, in words Muse can act on', async () => {
    const outcomes = await local()([at('/missing'), at('/busy'), at('/oops'), at('/file.pdf'), at('/picture.jpg'), at('/loop'), at('/shell'), 'not a link', 'ftp://files.example/a', 'javascript:alert(1)'], visit);
    expect(outcomes.map(reason)).toEqual([
      REASONS.notFound(404),
      REASONS.busy,
      REASONS.serverError(503),
      REASONS.file('application/pdf'),
      REASONS.picture,
      REASONS.tooManyRedirects,
      REASONS.nothing,
      REASONS.notALink,
      REASONS.notALink,
      REASONS.notALink,
    ]);
  });

  it('is refused when it points at this machine or a private network', async () => {
    const port = new URL(site.origin).port;
    const before = site.hits.length;
    const intake = createIntake({ resolveTopic: (l) => source.resolveTopic(l) });
    const outcomes = await intake([`http://127.0.0.1:${port}/article`, `http://localhost:${port}/article`, 'http://192.168.1.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/'], visit);
    expect(outcomes.map(reason)).toEqual(Array<string>(5).fill(REASONS.private));
    expect(site.hits.length).toBe(before);
  });

  it('times out on its own clock', async () => {
    const started = Date.now();
    const [o] = await local({ linkTimeoutMs: 300 })([at('/hang')], visit);
    expect(reason(o)).toBe("the link didn't open in 0.3 s");
    expect(Date.now() - started).toBeLessThan(1500);
    expect(REASONS.timedOut(LINK_TIMEOUT_MS)).toBe("the link didn't open in 8 s");
  });

  it('keeps a whole report inside its budget, six links at a time', async () => {
    const open = { now: 0, most: 0 };
    const counted: typeof fetch = async (input, init) => {
      open.most = Math.max(open.most, ++open.now);
      try {
        return await globalThis.fetch(input, init);
      } finally {
        open.now--;
      }
    };
    const started = Date.now();
    const urls = Array.from({ length: 8 }, (_, i) => at(`/hang?i=${i}`));
    const outcomes = await local({ fetch: counted, linkTimeoutMs: 400, reportTimeoutMs: 700 })(urls, visit);
    const took = Date.now() - started;
    expect(outcomes.map(reason)).toEqual([...Array<string>(6).fill(REASONS.timedOut(400)), ...Array<string>(2).fill(REASONS.outOfTime(700))]);
    expect(open.most).toBe(6);
    expect(took).toBeLessThan(700 + 600);
    expect(REPORT_TIMEOUT_MS).toBe(30_000);
  });

  it('stops reading an endless page at about a megabyte, and keeps what its head said', async () => {
    const started = Date.now();
    const [endless, late] = await local()([at('/endless'), at('/late')], visit);
    expect(accepted(endless).title).toBe('The longest scroll');
    expect(Date.now() - started).toBeLessThan(3000);
    await site.endlessClosed;
    // The reader hangs up after a megabyte; what the socket's buffers took on the way is all the rest.
    expect(site.endlessSent).toBeLessThan(4_000_000);
    expect(accepted(late).summary).not.toContain('too late');
    expect(accepted(late).title).toBe('A long page with a late description');
  });

  it('is cancelled with the report', async () => {
    const outcomes = await local()([at('/article'), at('/video')], { ...visit, signal: AbortSignal.abort() });
    expect(outcomes.map(reason)).toEqual([REASONS.cancelled, REASONS.cancelled]);
  });
});

describe('a report', () => {
  it('gives one outcome per link, in order, opening a repeated link once', async () => {
    const before = site.hits.filter((h) => h === '/article').length;
    const urls = [at('/article'), at('/missing'), ` ${at('/article')}`];
    const outcomes = await local()(urls, visit);
    expect(outcomes.map((o) => o.url)).toEqual(urls);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect(accepted(outcomes[2])).toEqual(accepted(outcomes[0]));
    expect(site.hits.filter((h) => h === '/article').length - before).toBe(1);
  });

  it('never throws, whatever its helpers do', async () => {
    const broken = createIntake({
      resolveTopic: () => {
        throw new Error('no map');
      },
      fileUnder: () => {
        throw new Error('no index');
      },
      fetch: () => {
        throw new Error('no network');
      },
      openPrivate: true,
    });
    const outcomes = await broken([at('/article'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'], visit);
    expect(outcomes.map((o) => o.ok)).toEqual([false, false]);
  });
});

// ─── Filing ─────────────────────────────────────────────────────────────────

describe('filing a find', () => {
  const plain = async (interests: string[], thread: string) => (await local()([at('/plain')], { interests: interests.map(T), thread }))[0];

  it('files it by its own words, in the area of what Muse was on', async () => {
    expect(accepted((await local()([at('/article')], { interests: [T('Jazz')], thread: '' }))[0]).topics[0]).toBe('Lapis lazuli');
  });

  it('falls back to the interest it or its thread names, then the thread, then the first interest', async () => {
    expect(accepted(await plain(['Bird', 'Jazz'], 'late night jazz')).topics).toEqual(['Jazz']);
    expect(accepted(await plain(['Jazz', 'Bird'], 'Bird migration')).topics).toEqual(['Bird']);
    expect(accepted(await plain(['Jazz'], 'bird migration')).topics).toEqual(['Bird migration']);
    expect(accepted(await plain(['Jazz'], 'nothing in particular')).topics).toEqual(['Jazz']);
    expect(reason(await plain([], ''))).toBe(REASONS.noTopic);
  });

  it('without the recorder’s filing, resolves the page’s own tags', async () => {
    const intake = createIntake({ resolveTopic: (l) => source.resolveTopic(l), openPrivate: true });
    expect(accepted((await intake([at('/article')], { interests: [], thread: '' }))[0]).topics).toEqual(['Pigment']);
  });

  it('files under the real topic map by default', async () => {
    const intake = defaultIntake({}, { openPrivate: true });
    const c = accepted((await intake([at('/article')], { interests: [T('Ultramarine')], thread: 'blue pigments' }))[0]);
    expect(c.topics).toContain('Ultramarine');
    expect(c.topics).toContain('Lapis lazuli');
    expect(c.topics.length).toBeLessThanOrEqual(6);
  });
});

// ─── Networks that answer through oEmbed ────────────────────────────────────

type Answer = { readonly status?: number; readonly json?: unknown; readonly html?: string };

/** A fetch that answers the networks' endpoints from `answer`, and logs every URL it was asked for. */
function networks(answer: (url: URL) => Answer | undefined): { readonly fetch: typeof fetch; readonly asked: URL[] } {
  const asked: URL[] = [];
  const fake: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url);
    const a = answer(url);
    if (a === undefined) return globalThis.fetch(input, init);
    const body = a.json !== undefined ? JSON.stringify(a.json) : (a.html ?? '');
    const type = a.json !== undefined ? 'application/json' : 'text/html';
    return Promise.resolve(new Response(body, { status: a.status ?? 200, headers: { 'content-type': type } }));
  };
  return { fetch: fake, asked };
}

const TOKEN = 'secret-token-123';

describe('YouTube', () => {
  const youtube = networks((url) => {
    if (url.pathname === '/oembed') {
      const link = url.searchParams.get('url') ?? '';
      if (link.includes('PrivateVid0')) return { status: 401, json: {} };
      if (link.includes('MissingVid0')) return { status: 404, html: 'Not Found' };
      return { json: { title: 'Lapis to ultramarine, start to finish', author_name: 'The Paint Box', thumbnail_url: 'https://i.ytimg.com/vi/LapisVideo1/hqdefault.jpg', type: 'video' } };
    }
    if (url.pathname === '/watch') return { html: '<script>{"lengthSeconds":"754","shortDescription":"We grind lapis lazuli by hand. #pigment","publishDate":"2026-09-12T08:00:00-07:00"}</script>' };
    return undefined;
  });
  const intake = local({ fetch: youtube.fetch });

  it('reads a video through its public oEmbed and its watch page', async () => {
    const [o] = await intake(['https://youtu.be/LapisVideo1?t=30&si=share'], visit);
    expect(accepted(o)).toEqual({
      url: 'https://www.youtube.com/watch?v=LapisVideo1',
      canonicalUrl: 'https://www.youtube.com/watch?v=LapisVideo1',
      title: 'Lapis to ultramarine, start to finish',
      summary: 'We grind lapis lazuli by hand. #pigment',
      topics: ['Ultramarine', 'Lapis lazuli', 'Pigment'],
      media: { kind: 'video', network: 'youtube', author: 'The Paint Box', image: 'https://i.ytimg.com/vi/LapisVideo1/hqdefault.jpg', aspect: 1.778, duration: 754, site: 'YouTube', published: '2026-09-12' },
    });
    const oembed = youtube.asked.find((u) => u.pathname === '/oembed');
    expect(oembed?.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=LapisVideo1');
  });

  it('reads a Short as a reel', async () => {
    const c = accepted((await intake(['https://www.youtube.com/shorts/LapisVideo1'], visit))[0]);
    expect(c.url).toBe('https://www.youtube.com/shorts/LapisVideo1');
    expect([c.media.kind, c.media.aspect]).toEqual(['reel', 0.563]);
  });

  it('refuses a private or missing video, and a channel or playlist', async () => {
    const outcomes = await intake(['https://www.youtube.com/watch?v=PrivateVid0', 'https://www.youtube.com/watch?v=MissingVid0', 'https://www.youtube.com/@thepaintbox', 'https://www.youtube.com/playlist?list=PL123'], visit);
    expect(outcomes.map(reason)).toEqual([REASONS.youtubePrivate, REASONS.youtubeMissing, REASONS.youtubeOther, REASONS.youtubeOther]);
  });
});

describe('Instagram', () => {
  const reel = {
    id: '1789',
    caption: 'Grinding lapis lazuli on the slab\nThe first washing is the bluest. #ultramarine',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    thumbnail_url: 'https://scontent.cdninstagram.com/v/reel.jpg?oe=1',
    permalink: 'https://www.instagram.com/reel/LapisReel1/',
    timestamp: '2026-10-01T12:00:00+0000',
  };
  const graph = (oembed: 'open' | 'closed', feed: readonly unknown[] = [reel]) =>
    networks((url) => {
      if (url.hostname !== 'graph.facebook.com') return undefined;
      if (url.pathname.endsWith('/instagram_oembed')) {
        if (oembed === 'closed') return { status: 400, json: { error: { message: "(#10) To use 'Meta oEmbed Read', your use of this endpoint must be reviewed", type: 'OAuthException', code: 10 } } };
        return { json: { author_name: 'paintbox', thumbnail_url: 'https://scontent.cdninstagram.com/v/thumb.jpg', thumbnail_width: 640, thumbnail_height: 640, html: '<blockquote class="instagram-media"><a>View this post on Instagram</a><p>Lapis lazuli, ground by hand</p><p><a>A post shared by The Paint Box (@paintbox)</a></p></blockquote>' } };
      }
      if (url.searchParams.get('fields')?.startsWith('business_discovery') === true) {
        if (url.searchParams.get('fields')?.includes('username(privateperson)') === true) return { status: 400, json: { error: { message: 'Invalid user id', code: 110 } } };
        return { json: { business_discovery: { username: 'paintbox', media: { data: feed } } } };
      }
      return { status: 404, json: { error: { message: 'unknown', code: 803 } } };
    });

  it('needs the garden’s token', async () => {
    const g = graph('open');
    const outcomes = await local({ fetch: g.fetch })(['https://www.instagram.com/p/LapisPost1/'], visit);
    expect(outcomes.map(reason)).toEqual([REASONS.instagramToken]);
    expect(g.asked).toEqual([]);
  });

  it('reads a post through the Graph API’s oEmbed', async () => {
    const g = graph('open');
    const c = accepted((await local({ fetch: g.fetch, igToken: TOKEN, keepPicture: (id) => `/api/media/${id}` })(['https://www.instagram.com/p/LapisPost1/?igsh=abc'], visit))[0]);
    expect(c).toEqual({
      url: 'https://www.instagram.com/p/LapisPost1/',
      canonicalUrl: 'https://www.instagram.com/p/LapisPost1/',
      title: 'Lapis lazuli, ground by hand',
      summary: 'Lapis lazuli, ground by hand',
      topics: ['Lapis lazuli'],
      media: { kind: 'post', network: 'instagram', author: '@paintbox', image: '/api/media/ig-LapisPost1', aspect: 1, site: 'Instagram' },
    });
    expect(g.asked[0].searchParams.get('url')).toBe('https://www.instagram.com/p/LapisPost1/');
  });

  it('reads a reel from its account’s own feed while oEmbed is closed to the garden', async () => {
    const g = graph('closed');
    const intake = local({ fetch: g.fetch, igToken: TOKEN, igUserId: '1784' });
    const [first] = await intake(['https://www.instagram.com/paintbox/reel/LapisReel1/'], visit);
    const [second] = await intake(['https://www.instagram.com/reel/LapisReel1/'], visit);
    expect(accepted(first)).toEqual({
      url: 'https://www.instagram.com/reel/LapisReel1/',
      canonicalUrl: 'https://www.instagram.com/reel/LapisReel1/',
      title: 'Grinding lapis lazuli on the slab',
      summary: 'Grinding lapis lazuli on the slab The first washing is the bluest. #ultramarine',
      topics: ['Lapis lazuli', 'Ultramarine'],
      media: { kind: 'reel', network: 'instagram', author: '@paintbox', image: 'https://scontent.cdninstagram.com/v/reel.jpg?oe=1', aspect: 9 / 16, site: 'Instagram', published: '2026-10-01' },
    });
    expect(reason(second)).toBe(REASONS.instagramNoAccount);
    expect(g.asked.filter((u) => u.pathname.endsWith('/instagram_oembed')).length).toBe(1);
    expect(g.asked.find((u) => u.searchParams.has('fields'))?.pathname).toBe('/v21.0/1784');
  });

  it('says when the post is not among the account’s latest, or the account cannot be read', async () => {
    const g = graph('closed', []);
    const outcomes = await local({ fetch: g.fetch, igToken: TOKEN, igUserId: '1784' })(['https://www.instagram.com/paintbox/p/OlderPost1/', 'https://www.instagram.com/privateperson/p/HerPost11/', 'https://www.instagram.com/paintbox/'], visit);
    expect(outcomes.map(reason)).toEqual([REASONS.instagramNotFound('paintbox'), REASONS.instagramAccount('privateperson'), REASONS.instagramOther]);
    expect(REASONS.instagramNotFound('paintbox')).toContain(`latest ${INSTAGRAM_LOOK}`);
    expect(outcomes.map(reason).join(' ')).not.toContain(TOKEN);
  });
});

describe('Facebook, Vimeo and TikTok', () => {
  const fake = networks((url) => {
    if (url.pathname.endsWith('/oembed_post')) {
      if (url.searchParams.get('url')?.includes('closed') === true) return { status: 400, json: { error: { message: '(#10) oEmbed Read must be reviewed', code: 10 } } };
      return {
        json: {
          author_name: 'The Paint Box',
          html: '<div class="fb-post"><blockquote cite="https://www.facebook.com/paintbox/posts/123456789" class="fb-xfbml-parse-ignore"><p>Our lapis lazuli arrived today.</p>Posted by <a href="https://www.facebook.com/paintbox">The Paint Box</a> on <a href="https://www.facebook.com/paintbox/posts/123456789">Thursday, October 1, 2026</a></blockquote></div>',
        },
      };
    }
    if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') {
      return { json: { title: 'Ultramarine in the studio', author_name: 'Studio Films', description: 'A short film about <b>blue</b>.', thumbnail_url: 'https://i.vimeocdn.com/video/1.jpg', width: 1920, height: 1080, duration: 312, upload_date: '2026-08-02 10:00:00' } };
    }
    if (url.hostname === 'www.tiktok.com' && url.pathname === '/oembed') {
      return { json: { title: 'Mixing ultramarine #pigment', author_name: 'Paint Box', author_unique_id: 'paintbox', thumbnail_url: 'https://p16.tiktokcdn.com/obj/1.jpg' } };
    }
    return undefined;
  });

  it('reads a Facebook post through the Graph API’s oEmbed, and refuses without the token or approval', async () => {
    const withToken = local({ fetch: fake.fetch, igToken: TOKEN });
    const [post, closed] = await withToken(['https://www.facebook.com/paintbox/posts/123456789?mibextid=xyz', 'https://www.facebook.com/closed/posts/987654321'], visit);
    expect(accepted(post)).toMatchObject({
      url: 'https://www.facebook.com/paintbox/posts/123456789',
      title: 'Our lapis lazuli arrived today.',
      media: { kind: 'post', network: 'facebook', author: 'The Paint Box', site: 'Facebook', published: '2026-10-01' },
    });
    expect(reason(closed)).toBe(REASONS.facebookClosed);
    expect(reason((await local({ fetch: fake.fetch })(['https://www.facebook.com/paintbox/posts/123456789'], visit))[0])).toBe(REASONS.facebookToken);
  });

  it('reads Vimeo and TikTok through their public oEmbed', async () => {
    const [video, tiktok] = await local({ fetch: fake.fetch })(['https://vimeo.com/123456789', 'https://www.tiktok.com/@paintbox/video/7300000000000000000?is_from_webapp=1'], visit);
    expect(accepted(video)).toMatchObject({
      url: 'https://vimeo.com/123456789',
      title: 'Ultramarine in the studio',
      summary: 'A short film about blue.',
      media: { kind: 'video', network: 'vimeo', author: 'Studio Films', aspect: 1.778, duration: 312, site: 'Vimeo', published: '2026-08-02' },
    });
    expect(accepted(tiktok)).toMatchObject({
      url: 'https://www.tiktok.com/@paintbox/video/7300000000000000000',
      title: 'Mixing ultramarine #pigment',
      media: { kind: 'reel', network: 'tiktok', author: '@paintbox', site: 'TikTok' },
    });
  });
});

// Opt-in smoke against the real sites: MUSE_LIVE=1 npx vitest run server/agent/intake.test.ts
describe.runIf(process.env.MUSE_LIVE === '1')('live intake', () => {
  it('opens a public article and a YouTube Short logged out', async () => {
    const intake = defaultIntake({});
    const outcomes = await intake(['https://drawbotanical.com/practicing-apples/', 'https://www.youtube.com/shorts/SJyvaEe2cK8'], { interests: [T('Botanical illustration')], thread: 'botanical drawing' });
    const [article, short] = outcomes.map(accepted);
    expect(article.media.kind).toBe('article');
    expect(article.title.length).toBeGreaterThan(0);
    expect(short.media).toMatchObject({ kind: 'reel', network: 'youtube', site: 'YouTube' });
    console.info(JSON.stringify(outcomes, null, 1));
  }, 40_000);
});
