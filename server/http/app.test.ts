import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GardenCommands, GardenQueries, Instant } from '../../src/muse/contract';
import * as samples from '../../src/muse/samples';
import { createApp } from './app';
import { fakeCommands, fakeQueries } from './fake';
import type { FakeCommands } from './fake';
import type { MediaImages } from './media';

const HOUR = 3_600_000;
const SAMPLE_NOW = samples.sampleNowExploring.at;
const INVITE = samples.sampleVisit.invitation;
const WINDOW = samples.sampleInvitations.find((i) => i.id === INVITE)!.window;

let server: Server | undefined;
let base = '';
let commands: FakeCommands;

async function serve(
  overrides: { queries?: Partial<GardenQueries>; commands?: Partial<GardenCommands>; now?: () => Instant; media?: MediaImages } = {},
) {
  await stop();
  commands = fakeCommands();
  const fake = commands;
  const app = createApp({
    queries: { ...fakeQueries(), ...overrides.queries },
    commands: { ...fake, ...overrides.commands },
    now: overrides.now ?? (() => fake.clock().now),
    ...(overrides.media ? { media: overrides.media } : {}),
  });
  const s = createServer(app);
  server = s;
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

async function stop() {
  const s = server;
  server = undefined;
  if (s === undefined) return;
  s.closeAllConnections();
  await new Promise((resolve) => s.close(resolve));
}

/** A string body is sent as-is; anything else as JSON. */
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
}

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

beforeEach(() => serve());
afterEach(async () => {
  await stop();
  vi.restoreAllMocks();
});

describe('GET routes', () => {
  it.each<[string, unknown]>([
    ['/api/muses', samples.sampleMuses],
    ['/api/muses/hero/now', samples.sampleNowExploring],
    ['/api/muses/hero/world', samples.sampleWorld],
    ['/api/muses/hero/plants/d-pigment', samples.sampleCards.find((c) => c.id === 'd-pigment')],
    ['/api/muses/hero/baskets', samples.sampleBaskets],
    ['/api/muses/hero/photos', samples.samplePhotos],
    ['/api/muses/hero/home/shelf', samples.sampleShelf],
    ['/api/muses/hero/invitations', samples.sampleInvitations],
    ['/api/muses/hero/settings/sharing', samples.sampleSharing],
    ['/api/dev/hero/mind', samples.sampleMind],
    ['/api/dev/hero/metrics', samples.sampleMetrics],
    ['/api/dev/clock', { mode: 'fast-forward', now: SAMPLE_NOW }],
  ])('%s serves the sample as JSON', async (path, sample) => {
    const res = await call('GET', path);
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^application\/json/);
    expect(JSON.parse(res.text)).toEqual(wire(sample));
  });

  it.each([
    ['/api/dev/hero/soul.md', samples.sampleSoulMd],
    ['/api/dev/hero/journal.md', samples.sampleJournalMd],
    ['/api/dev/hero/journal.md?day=2026-11-04', samples.sampleJournalMd],
  ])('%s serves the sample as markdown', async (path, md) => {
    const res = await call('GET', path);
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^text\/markdown/);
    expect(res.text).toBe(md);
  });

  it.each([
    ['baskets', samples.sampleBaskets.items],
    ['photos', samples.samplePhotos.items],
  ] as const)('pages %s with before and limit', async (kind, [first, second]) => {
    const page1 = await call('GET', `/api/muses/hero/${kind}?limit=1`);
    expect(JSON.parse(page1.text)).toEqual(wire({ items: [first], next: first.id }));
    const page2 = await call('GET', `/api/muses/hero/${kind}?limit=1&before=${first.id}`);
    expect(JSON.parse(page2.text)).toEqual(wire({ items: [second], next: null }));
  });

  it('moves the dev clock with advance and switches its mode', async () => {
    await call('POST', '/api/dev/advance', { hours: 2 });
    expect(JSON.parse((await call('GET', '/api/dev/clock')).text)).toEqual({ mode: 'fast-forward', now: SAMPLE_NOW + 2 * HOUR });
    await call('POST', '/api/dev/clock', { mode: 'live' });
    expect(JSON.parse((await call('GET', '/api/dev/clock')).text)).toMatchObject({ mode: 'live' });
  });
});

describe('not found', () => {
  it.each<[string, string, unknown?]>([
    ['GET', '/api/muses/nobody/now'],
    ['GET', '/api/muses/nobody/baskets'],
    ['GET', '/api/muses/nobody/invitations'],
    ['GET', '/api/muses/wren/world'],
    ['GET', '/api/muses/hero/plants/d-nothing'],
    ['GET', '/api/dev/nobody/metrics'],
    ['GET', '/api/dev/hero/journal.md?day=2026-01-01'],
    ['POST', '/api/muses/nobody/settings/basket-time', { hhmm: null }],
    ['POST', '/api/host/nobody/work', { state: 'started' }],
    ['GET', '/api/nothing'],
    ['POST', '/api/muses/hero/now'],
    ['POST', '/api/invitations/inv-wren-hero-1/ignore?as=hero'],
  ])('%s %s is 404', async (method, path, body) => {
    const res = await call(method, path, body);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual({ error: expect.stringMatching(/./) as string });
    expect(commands.calls).toEqual([]);
  });
});

describe('bad input', () => {
  it.each<[string, string, string, unknown?]>([
    ['a Muse id', 'GET', '/api/muses/no%20spaces/now'],
    ['percent-encoding', 'GET', '/api/muses/%E0%A4%A/now'],
    ['a plant id', 'GET', '/api/muses/hero/plants/a%2Fb'],
    ['limit 0', 'GET', '/api/muses/hero/baskets?limit=0'],
    ['limit 101', 'GET', '/api/muses/hero/photos?limit=101'],
    ['a fractional limit', 'GET', '/api/muses/hero/baskets?limit=2.5'],
    ['an empty before', 'GET', '/api/muses/hero/photos?before='],
    ['a day', 'GET', '/api/dev/hero/journal.md?day=yesterday'],
    ['a visit without as', 'GET', `/api/visits/${INVITE}/world`],
    ['an answer without as', 'POST', `/api/invitations/${INVITE}/accept`],
    ['hhmm 24:00', 'POST', '/api/muses/hero/settings/basket-time', { hhmm: '24:00' }],
    ['hhmm 7:30', 'POST', '/api/muses/hero/settings/basket-time', { hhmm: '7:30' }],
    ['a missing hhmm', 'POST', '/api/muses/hero/settings/basket-time', {}],
    ['a ref kind', 'POST', '/api/muses/hero/settings/hidden', { ref: 'person:Kai', hidden: true }],
    ['an empty topic ref', 'POST', '/api/muses/hero/settings/hidden', { ref: 'topic:', hidden: true }],
    ['hidden as a string', 'POST', '/api/muses/hero/settings/hidden', { ref: 'topic:Tide', hidden: 'yes' }],
    ['a share code', 'POST', '/api/muses/hero/settings/introductions', { shareCode: 'not a code!' }],
    ['an unshare target', 'POST', '/api/muses/hero/settings/unshare', { other: '' }],
    ['a work state', 'POST', '/api/host/hero/work', { state: 'paused' }],
    ['soul text', 'POST', '/api/host/hero/soul', { text: 42 }],
    ['missing memory text', 'POST', '/api/host/hero/memory', {}],
    ['hours 0', 'POST', '/api/dev/advance', { hours: 0 }],
    ['hours over 24·60', 'POST', '/api/dev/advance', { hours: 1441 }],
    ['hours as a string', 'POST', '/api/dev/advance', { hours: '3' }],
    ['a clock mode', 'POST', '/api/dev/clock', { mode: 'slow' }],
    ['a body that is not JSON', 'POST', '/api/dev/clock', '{mode:'],
    ['a body that is not an object', 'POST', '/api/dev/advance', [1]],
    ['a missing body', 'POST', '/api/host/hero/work'],
  ])('rejects %s with 400', async (_what, method, path, body) => {
    const res = await call(method, path, body);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toEqual({ error: expect.stringMatching(/./) as string });
    expect(commands.calls).toEqual([]);
  });

  it('takes a body of 64 KB and refuses one byte more with 413', async () => {
    const body = (bytes: number) => JSON.stringify({ text: 'a'.repeat(bytes - '{"text":""}'.length) });
    expect((await call('POST', '/api/host/hero/soul', body(64 * 1024))).status).toBe(200);
    expect((await call('POST', '/api/host/hero/soul', body(64 * 1024 + 1))).status).toBe(413);
    expect(commands.calls).toHaveLength(1);
  });
});

describe('commands', () => {
  it.each<[string, unknown, unknown]>([
    ['/api/muses/hero/settings/basket-time', { hhmm: '07:30' }, { name: 'setBasketTime', args: ['hero', '07:30'] }],
    ['/api/muses/hero/settings/basket-time', { hhmm: null }, { name: 'setBasketTime', args: ['hero', null] }],
    [
      '/api/muses/hero/settings/hidden',
      { ref: 'topic:Botanical illustration', hidden: true },
      { name: 'setHidden', args: ['hero', 'topic:Botanical illustration', true] },
    ],
    [
      '/api/muses/hero/settings/hidden',
      { ref: 'discovery:d-pigment', hidden: false },
      { name: 'setHidden', args: ['hero', 'discovery:d-pigment', false] },
    ],
    ['/api/muses/hero/settings/introductions', { shareCode: 'WREN-4F2A' }, { name: 'introduce', args: ['hero', 'WREN-4F2A'] }],
    ['/api/muses/hero/settings/unshare', { other: 'wren' }, { name: 'unshare', args: ['hero', 'wren'] }],
    [`/api/invitations/${INVITE}/accept?as=hero`, undefined, { name: 'invitation', args: [INVITE, 'hero', 'accept'] }],
    ['/api/invitations/inv-hero-juniper-1/approve?as=hero', undefined, { name: 'invitation', args: ['inv-hero-juniper-1', 'hero', 'approve'] }],
    ['/api/invitations/inv-hero-juniper-1/decline?as=hero', undefined, { name: 'invitation', args: ['inv-hero-juniper-1', 'hero', 'decline'] }],
    ['/api/host/hero/work', { state: 'started' }, { name: 'hostWork', args: ['hero', 'started'] }],
    ['/api/host/hero/work', { state: 'ended' }, { name: 'hostWork', args: ['hero', 'ended'] }],
    ['/api/host/hero/soul', { text: '# Moss\n' }, { name: 'hostSoul', args: ['hero', '# Moss\n'] }],
    ['/api/host/hero/memory', { text: 'Loves botany.' }, { name: 'hostMemory', args: ['hero', 'Loves botany.'] }],
    ['/api/dev/advance', { hours: 0.5 }, { name: 'advance', args: [0.5] }],
    ['/api/dev/advance', { hours: 1440 }, { name: 'advance', args: [1440] }],
    ['/api/dev/clock', { mode: 'live' }, { name: 'setClock', args: ['live'] }],
    ['/api/dev/clock', { mode: 'fast-forward' }, { name: 'setClock', args: ['fast-forward'] }],
  ])('POST %s calls the command with parsed args', async (path, body, expected) => {
    const res = await call('POST', path, body);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true });
    expect(commands.calls).toEqual([expected]);
  });

  it.each([400, 403, 404, 409] as const)('answers a command refused with %i with that status', async (status) => {
    await serve({ commands: { invitation: () => Promise.resolve({ ok: false, status, error: 'already answered' }) } });
    const res = await call('POST', `/api/invitations/${INVITE}/accept?as=hero`);
    expect(res.status).toBe(status);
    expect(JSON.parse(res.text)).toEqual({ error: 'already answered' });
  });
});

describe('visits', () => {
  const visit = (as: string, invitation: string = INVITE) => call('GET', `/api/visits/${invitation}/world?as=${as}`);

  it('opens only for the invited owner, from the window start up to its end', async () => {
    let t = WINDOW.start - 1;
    await serve({ now: () => t as Instant });
    expect((await visit('hero')).status).toBe(403);

    t = WINDOW.start;
    const open = await visit('hero');
    expect(open.status).toBe(200);
    expect(JSON.parse(open.text)).toEqual(wire(samples.sampleVisit));
    expect((await visit('wren')).status).toBe(403);
    expect((await visit('juniper')).status).toBe(403);
    expect((await visit('hero', 'inv-nobody')).status).toBe(403);

    t = WINDOW.end - 1;
    expect((await visit('hero')).status).toBe(200);
    t = WINDOW.end;
    expect((await visit('hero')).status).toBe(403);
  });

  it('follows the dev clock', async () => {
    expect((await visit('hero')).status).toBe(403);
    await call('POST', '/api/dev/advance', { hours: 24 });
    expect((await visit('hero')).status).toBe(200);
    await call('POST', '/api/dev/advance', { hours: 2 });
    expect((await visit('hero')).status).toBe(403);
  });
});

describe('logs and errors', () => {
  function captureConsole(): string[] {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? `${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    return lines;
  }

  it('answers an unexpected failure with a bare 500 and logs it', async () => {
    const logs = captureConsole();
    await serve({ commands: { hostSoul: () => Promise.reject(new Error('soul store offline')) } });
    const res = await call('POST', '/api/host/hero/soul', { text: 'hi' });
    expect(res.status).toBe(500);
    expect(JSON.parse(res.text)).toEqual({ error: 'internal error' });
    expect(logs.join('\n')).toContain('soul store offline');
  });

  it('never puts MEMORY.md text in a reply or a log', async () => {
    const secret = 'Kai was diagnosed with asthma and lives at 12 Elm Street';
    const logs = captureConsole();
    const replies: { status: number; text: string }[] = [];
    const send = async (body: unknown) => replies.push(await call('POST', '/api/host/hero/memory', body));

    await send({ text: secret });
    expect(commands.calls).toEqual([{ name: 'hostMemory', args: ['hero', secret] }]);
    // Short enough that V8's JSON.parse message would quote all of it.
    await send('{"text": asthma}');
    await send({ text: secret, padding: 'x'.repeat(64 * 1024) });
    await serve({ commands: { hostMemory: () => Promise.reject(new Error(`Mind failed on: ${secret}`)) } });
    await send({ text: secret });
    await serve({ commands: { hostMemory: () => Promise.resolve({ ok: false, status: 400, error: `no topics in: ${secret}` }) } });
    await send({ text: secret });

    expect(replies.map((r) => r.status)).toEqual([200, 400, 413, 500, 400]);
    for (const r of replies) expect(r.text).not.toContain('asthma');
    expect(logs.join('\n')).not.toContain('asthma');
  });
});

describe('error bodies', () => {
  it.each<[number, string, string, unknown?, Parameters<typeof serve>[0]?]>([
    [400, 'POST', '/api/dev/clock', { mode: 'slow' }],
    [403, 'GET', `/api/visits/${INVITE}/world?as=wren`],
    [404, 'GET', '/api/muses/nobody/now'],
    [404, 'GET', '/api/nothing'],
    [409, 'POST', `/api/invitations/${INVITE}/accept?as=hero`, undefined, {
      commands: { invitation: () => Promise.resolve({ ok: false, status: 409, error: 'already answered' }) },
    }],
    [413, 'POST', '/api/host/hero/soul', { text: 'a'.repeat(64 * 1024) }],
    [500, 'GET', '/api/muses/hero/world', undefined, { queries: { world: () => { throw new Error('store offline'); } } }],
  ])('a %i is JSON with a short error message', async (status, method, path, body, overrides) => {
    if (overrides !== undefined) await serve(overrides);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(method, path, body);
    expect(res.status).toBe(status);
    expect(res.type).toBe('application/json; charset=utf-8');
    const parsed = JSON.parse(res.text) as unknown;
    expect(Object.keys(parsed as object)).toEqual(['error']);
    expect((parsed as { error: unknown }).error).toMatch(/^.{1,80}$/);
  });
});

describe('media pictures', () => {
  it('serves a cached picture with its type, and 404 for anything else', async () => {
    const picture = new Uint8Array([0xff, 0xd8, 0xff, 7]);
    await serve({ media: (mid) => Promise.resolve(mid === 'ig-DXyZ987' ? { type: 'image/jpeg', body: picture } : null) });
    const res = await fetch(`${base}/api/media/ig-DXyZ987`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(picture);
    expect((await call('GET', '/api/media/ig-other')).status).toBe(404);
  });

  it('answers 404 where the backend keeps no pictures', async () => {
    expect(await call('GET', '/api/media/ig-DXyZ987')).toMatchObject({ status: 404 });
  });
});

describe('CORS', () => {
  it('answers a preflight and lets any origin read replies', async () => {
    const pre = await fetch(`${base}/api/host/hero/memory`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(pre.headers.get('access-control-allow-headers')).toContain('content-type');

    const res = await fetch(`${base}/api/muses`, { headers: { origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
