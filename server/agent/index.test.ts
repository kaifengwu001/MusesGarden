// The connector end to end, in process: the garden app with the connector mounted, stub engine and workshop, the
// SDK's own client over Streamable HTTP, and plain fetch for REST, the doorbell and the refusals.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCommands, AgentQueries, AgentResult, Guidebook, Instant, Letterbox, MuseId, PhotoId } from '../../src/muse/contract';
import { createApp } from '../http/app';
import { fakeCommands, fakeQueries } from '../http/fake';
import type { JobView, Workshop } from '../workshop/types';
import { createAgentHandler, requestOrigin } from './index';
import { ownerLine } from './tools';
import type { AgentHandler } from './index';

const ORIGIN = 'https://garden.example';
const NOW = Date.parse('2026-11-03T09:00:00Z') as Instant;
const POOH = 'pooh' as MuseId;
const JOB = '0123456789abcdef0123456789abcdef';

const LETTERBOX: Letterbox = {
  museId: POOH,
  name: 'Pooh',
  at: NOW,
  since: (NOW - 3_600_000) as Instant,
  planet: { id: 'meadow', name: 'The Meadow', growth: 3, regions: 2 },
  look: 'tpose6',
  interests: [{ topic: 'Tide pools', stage: 'emerging' }],
  happenings: ['Your owner liked your cyanotype.'],
  postcards: [{ id: 'ph-1' as PhotoId, taken: NOW, picture: '/api/postcards/meadow-1.jpg', subject: 'a find', place: 'on my planet' }],
  allowances: { findsLeft: 18, photosLeft: 3, basketSentToday: false },
  lastCheckout: null,
};

const GUIDEBOOK: Guidebook = {
  museId: POOH,
  name: 'Pooh',
  planet: { id: 'meadow', name: 'The Meadow' },
  regions: [],
  finds: [],
};

const JOB_VIEW: JobView = {
  id: JOB,
  kind: 'planet',
  state: 'waiting',
  stage: 'moodboard',
  round: 1,
  packet: {
    job: JOB,
    kind: 'planet',
    round: 1,
    stage: 'moodboard',
    ask: 'pick',
    text: 'Pick 2 or 3.',
    pictures: [{ id: 'm1', path: `/w/${JOB}/m1.png`, caption: 'misty' }],
    pick: { min: 2, max: 3 },
  },
  nextRoundAt: null,
  message: 'Waiting for you.',
};

const ok = <T>(value: T): Promise<AgentResult<T>> => Promise.resolve({ ok: true, value });

function stubs() {
  const commands = {
    addAgentMuse: vi.fn<AgentCommands['addAgentMuse']>(() => ok({ added: true })),
    agentSoul: vi.fn<AgentCommands['agentSoul']>(() => ok({ topics: ['Tide pools'], dropped: [] })),
    agentTrip: vi.fn<AgentCommands['agentTrip']>(() => ok({ trip: 1, planted: 1, refused: [], doneAt: (NOW + 600_000) as Instant })),
    agentPostcardBack: vi.fn<AgentCommands['agentPostcardBack']>((_m, photo) => ok({ written: photo })),
    agentBasket: vi.fn<AgentCommands['agentBasket']>(() => ok({ sendAfter: NOW })),
    agentCheckout: vi.fn<AgentCommands['agentCheckout']>(() => ok({ at: NOW })),
    applyLook: vi.fn<AgentCommands['applyLook']>((_m, look) => ok({ look })),
    applyPlanet: vi.fn<AgentCommands['applyPlanet']>((_m, planet) => ok({ planet })),
  } satisfies AgentCommands;
  const queries = {
    isAgent: vi.fn<AgentQueries['isAgent']>(() => true),
    letterbox: vi.fn<AgentQueries['letterbox']>(() => LETTERBOX),
    guidebook: vi.fn<AgentQueries['guidebook']>(() => GUIDEBOOK),
  } satisfies AgentQueries;
  const workshop = {
    start: vi.fn<Workshop['start']>(() => ok(JOB_VIEW)),
    jobs: vi.fn<Workshop['jobs']>(() => [JOB_VIEW]),
    job: vi.fn<Workshop['job']>((_m, id) => (id === JOB ? JOB_VIEW : null)),
    review: vi.fn<Workshop['review']>(() => ok(JOB_VIEW)),
    view: vi.fn<Workshop['view']>(() => ok(JOB_VIEW)),
    pending: vi.fn<Workshop['pending']>(() => 2),
  } satisfies Workshop;
  return { commands, queries, workshop };
}

let stub: ReturnType<typeof stubs>;
let dataDir: string;
let agent: AgentHandler;
let server: Server;
let base: string;
let key: string;
let doorbell: string;
let wallMs: number;
const clients: Client[] = [];

async function start(opts: { origin?: string; toolTimeoutMs?: number; guide?: string } = {}) {
  stub = stubs();
  dataDir = mkdtempSync(join(tmpdir(), 'muse-agent-'));
  wallMs = Date.parse('2026-11-03T09:00:00Z');
  agent = createAgentHandler({
    ...stub,
    now: () => NOW,
    dataDir,
    origin: opts.origin ?? ORIGIN,
    wall: () => wallMs,
    ...(opts.toolTimeoutMs === undefined ? {} : { toolTimeoutMs: opts.toolTimeoutMs }),
    guide: opts.guide ?? join(dataDir, 'no-such-guide.md'),
  });
  const fake = fakeCommands();
  const app = createApp({ queries: fakeQueries(), commands: fake, now: () => fake.clock().now, subscribe: () => () => undefined }, agent);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const minted = await mint('pooh', { name: 'Pooh' });
  expect(minted.status).toBe(200);
  key = minted.json.key as string;
  doorbell = (minted.json.doorbell as string).split('/d/')[1];
}

async function stop() {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  agent.close();
  rmSync(dataDir, { recursive: true, force: true });
}

async function mint(muse: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const token = readFileSync(join(dataDir, 'admin.token'), 'utf8').trim();
  const res = await fetch(`${base}/api/agent-admin/keys`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ muse, ...extra }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function connect(withKey = key): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${withKey}` } } });
  const client = new Client({ name: 'connector-test', version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return { client, transport };
}

const text = (r: unknown): string => {
  const content = (r as CallToolResult).content[0];
  return content.type === 'text' ? content.text : '';
};
const value = (r: unknown): Record<string, unknown> => JSON.parse(text(r)) as Record<string, unknown>;

async function rest(method: string, path: string, body?: unknown, withKey: string | null = key) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(withKey === null ? {} : { authorization: `Bearer ${withKey}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const raw = await res.text();
  return { status: res.status, headers: res.headers, raw, json: raw === '' ? null : (JSON.parse(raw) as Record<string, unknown>) };
}

/** A raw JSON-RPC initialize, as an older client would send it (asking for JSON only). */
async function initializeWith(version: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'old', version: '0' } },
    }),
  });
  return { status: res.status, body: (await res.json()) as { result: { protocolVersion: string } } };
}

const SOUL = { name: 'Pooh', interests: ['Tide pools', 'Jazz'], temperament: { curiosity: 0.8, focus: 0.4, sociability: 0.6, whimsy: 0.7, novelty: 0.5 } };

describe('the connector over MCP', () => {
  beforeEach(() => start());
  afterEach(() => stop());

  it('negotiates 2025-11-25 with the SDK client, and answers 2025-06-18 and 2025-03-26 clients in kind', async () => {
    const { client, transport } = await connect();
    expect(transport.protocolVersion).toBe('2025-11-25');
    expect(client.getServerVersion()?.name).toBe('muses-garden');
    expect(client.getServerCapabilities()?.tools).toBeDefined();
    expect(client.getInstructions()).toContain(`${ORIGIN}/garden.md`);
    for (const version of ['2025-06-18', '2025-03-26']) {
      const r = await initializeWith(version);
      expect(r.status).toBe(200);
      expect(r.body.result.protocolVersion).toBe(version);
    }
  });

  it('lists exactly the twelve tools, each with a description and an object input; every write needs a request_id', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'checkout',
        'doorbell_link',
        'guidebook',
        'letterbox',
        'report_trip',
        'send_basket',
        'set_soul',
        'workshop_review',
        'workshop_round',
        'workshop_start',
        'workshop_view',
        'write_postcard',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
      const write = !t.annotations?.readOnlyHint;
      expect(write ? t.inputSchema.required : []).toEqual(write ? expect.arrayContaining(['request_id']) : []);
    }
  });

  it('runs each tool against its stub, as the key’s Muse, with the right arguments', async () => {
    const { client } = await connect();
    const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

    const box = value(await call('letterbox'));
    expect(stub.queries.letterbox).toHaveBeenCalledWith(POOH, NOW);
    expect(box.rounds).toEqual([expect.objectContaining({ id: JOB })]);
    expect(stub.workshop.jobs).toHaveBeenCalledWith(POOH);

    await call('guidebook');
    expect(stub.queries.guidebook).toHaveBeenLastCalledWith(POOH, POOH, NOW);
    await call('guidebook', { muse: 'moss' });
    expect(stub.queries.guidebook).toHaveBeenLastCalledWith('moss', POOH, NOW);

    expect(value(await call('workshop_round', { job: JOB })).id).toBe(JOB);
    expect(stub.workshop.job).toHaveBeenCalledWith(POOH, JOB);
    expect(value(await call('workshop_round')).jobs).toHaveLength(1);

    const bell = value(await call('doorbell_link'));
    expect(bell.url).toBe(`${ORIGIN}/d/${doorbell}`);
    expect(bell.waiting).toBe(2);

    await call('set_soul', { request_id: 's1', ...SOUL });
    expect(stub.commands.agentSoul).toHaveBeenCalledWith(POOH, SOUL);

    const trip = {
      thread: 'tide pools at dawn',
      path: ['https://example.org/tides', 'https://example.org/anemones'],
      kept: [{ url: 'https://example.org/anemones', why: 'the colours', from: 'https://example.org/tides' }],
      question: 'what lives under the rocks?',
    };
    const receipt = value(await call('report_trip', { request_id: 't1', ...trip }));
    expect(stub.commands.agentTrip).toHaveBeenCalledWith(POOH, trip);
    expect(receipt.doneAt).toBe(new Date(NOW + 600_000).toISOString());

    const back = { kind: 'riddle', question: 'What has a mouth but never eats?', answer: 'A river.' };
    await call('write_postcard', { request_id: 'p1', photo: 'ph-1', back });
    expect(stub.commands.agentPostcardBack).toHaveBeenCalledWith(POOH, 'ph-1', back);

    await call('send_basket', { request_id: 'b1', finds: ['d1', 'd2'], note: 'for your rainy day' });
    expect(stub.commands.agentBasket).toHaveBeenCalledWith(POOH, ['d1', 'd2'], 'for your rainy day');

    await call('checkout', { request_id: 'c1', mood: 'content', plan: 'more tide pools tomorrow' });
    expect(stub.commands.agentCheckout).toHaveBeenCalledWith(POOH, 'content', 'more tide pools tomorrow');

    const brief = { kind: 'planet', text: 'misty and green', must: ['rock pools'], references: ['https://example.org/pic.jpg'] };
    await call('workshop_start', { request_id: 'w1', ...brief });
    expect(stub.workshop.start).toHaveBeenCalledWith(POOH, brief);

    const verdict = { picks: ['m1', 'm2'], notes: [{ text: 'more fog here', picture: 'm1', at: [500, 250] }] };
    await call('workshop_review', { request_id: 'r1', job: JOB, verdict });
    expect(stub.workshop.review).toHaveBeenCalledWith(POOH, JOB, verdict);

    await call('workshop_view', { request_id: 'v1', job: JOB, ask: 'from my porch at dusk' });
    expect(stub.workshop.view).toHaveBeenCalledWith(POOH, JOB, 'from my porch at dusk');
  });

  it('adds a line for Muse to pass on to its owner: when to look, and what to say', async () => {
    const { client } = await connect();
    const reply = value(await client.callTool({ name: 'checkout', arguments: { request_id: 'c-owner', mood: 'calm', plan: 'the pond' } }));
    expect(reply.tellYourOwner).toBe('There are new pictures of my planet to look at. Just say "check your garden" and we’ll look at them together; otherwise I’ll look on my next visit.');
  });

  it('turns pictures into absolute links on the origin, and instants into ISO times', async () => {
    const { client } = await connect();
    const box = value(await client.callTool({ name: 'letterbox', arguments: {} }));
    const [card] = box.postcards as { picture: string; taken: string }[];
    expect(card.picture).toBe(`${ORIGIN}/api/postcards/meadow-1.jpg`);
    expect(card.taken).toBe('2026-11-03T09:00:00.000Z');
    const [round] = box.rounds as JobView[];
    expect(round.packet?.pictures[0].path).toBe(`${ORIGIN}/w/${JOB}/m1.png`);
  });

  it('runs a write once per request_id: a repeat gets the kept reply, the stub runs once', async () => {
    const { client } = await connect();
    const args = { request_id: 'same', mood: 'sleepy', plan: 'nap' };
    const first = await client.callTool({ name: 'checkout', arguments: args });
    stub.commands.agentCheckout.mockImplementation(() => ok({ at: (NOW + 1) as Instant }));
    const again = await client.callTool({ name: 'checkout', arguments: args });
    expect(text(again)).toBe(text(first));
    expect(stub.commands.agentCheckout).toHaveBeenCalledTimes(1);

    // A second client (a new MCP session, as the next check-in is) still gets it: the reply is kept in agent.db.
    const { client: later } = await connect();
    expect(text(await later.callTool({ name: 'checkout', arguments: args }))).toBe(text(first));
    expect(stub.commands.agentCheckout).toHaveBeenCalledTimes(1);

    const reused = await client.callTool({ name: 'checkout', arguments: { ...args, mood: 'wide awake' } });
    expect(reused.isError).toBe(true);
    expect(text(reused)).toMatch(/^422: .*request_id/);
  });

  it('runs a write once even when the repeat arrives while the first is still running', async () => {
    let release: (r: AgentResult<{ readonly at: Instant }>) => void = () => undefined;
    stub.commands.agentCheckout.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const { client } = await connect();
    const args = { request_id: 'overlap', mood: 'busy', plan: 'finish' };
    const a = client.callTool({ name: 'checkout', arguments: args });
    await vi.waitFor(() => expect(stub.commands.agentCheckout).toHaveBeenCalledTimes(1));
    const b = client.callTool({ name: 'checkout', arguments: args });
    release({ ok: true, value: { at: NOW } });
    const [ra, rb] = await Promise.all([a, b]);
    expect(text(ra)).toBe(text(rb));
    expect(stub.commands.agentCheckout).toHaveBeenCalledTimes(1);
  });

  it('keeps no refusal: the same request_id may try again after one', async () => {
    stub.commands.agentCheckout.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 409, error: 'Not yet.', retryAfter: NOW }));
    const { client } = await connect();
    const args = { request_id: 'retry', mood: 'patient', plan: 'wait' };
    expect((await client.callTool({ name: 'checkout', arguments: args })).isError).toBe(true);
    expect((await client.callTool({ name: 'checkout', arguments: args })).isError).toBeFalsy();
    expect(stub.commands.agentCheckout).toHaveBeenCalledTimes(2);
  });

  it('says a 409 as "409: <reason> Try again after <ISO time>"', async () => {
    const retryAfter = (NOW + 30 * 60_000) as Instant;
    stub.commands.agentBasket.mockImplementation(() => Promise.resolve({ ok: false, status: 409, error: 'Your basket went out today.', retryAfter }));
    const { client } = await connect();
    const r = await client.callTool({ name: 'send_basket', arguments: { request_id: 'b2', finds: ['d1'], note: 'hi' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(`409: Your basket went out today. Try again after ${new Date(retryAfter).toISOString()}.`);
  });

  it('passes a 422 through with its reason', async () => {
    stub.commands.agentTrip.mockImplementation(() => Promise.resolve({ ok: false, status: 422, error: 'https://walled.example/ needs a login.' }));
    const { client } = await connect();
    const r = await client.callTool({
      name: 'report_trip',
      arguments: { request_id: 't2', thread: 'x', path: ['https://walled.example/'], kept: [{ url: 'https://walled.example/', why: 'pretty' }] },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('422: https://walled.example/ needs a login.');
  });

  it('refuses bad input before any stub runs', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'set_soul', arguments: { ...SOUL } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('request_id');
    const tooMany = await client.callTool({ name: 'send_basket', arguments: { request_id: 'b3', finds: ['1', '2', '3', '4', '5', '6', '7', '8'], note: 'x' } });
    expect(tooMany.isError).toBe(true);
    expect(stub.commands.agentSoul).not.toHaveBeenCalled();
    expect(stub.commands.agentBasket).not.toHaveBeenCalled();
  });

  it('says 500 without the error’s words when a stub throws', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stub.commands.agentCheckout.mockImplementation(() => Promise.reject(new Error('secret detail')));
    const { client } = await connect();
    const r = await client.callTool({ name: 'checkout', arguments: { request_id: 'c9', mood: 'x', plan: 'y' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^500: /);
    expect(text(r)).not.toContain('secret');
    quiet.mockRestore();
  });

  it('refuses a Muse that is no longer a real one with 403', async () => {
    stub.queries.isAgent.mockReturnValue(false);
    const { client } = await connect();
    const r = await client.callTool({ name: 'letterbox', arguments: {} });
    expect(text(r)).toMatch(/^403: /);
  });

  it('answers 401 without a key or with a wrong one, and never redirects', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '0' } } };
    const none = await rest('POST', '/mcp', init, null);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(JSON.stringify(none.json)).toContain('401: ');
    const wrong = await rest('POST', '/mcp', init, `mg_${'A'.repeat(43)}`);
    expect(wrong.status).toBe(401);
    await expect(connect('mg_nope')).rejects.toThrow();
    expect((await rest('GET', '/mcp')).status).toBe(405);
    // A trailing slash and a missing Accept are answered, not redirected or refused.
    const slash = await rest('POST', '/mcp/', init);
    expect(slash.status).toBe(200);
    expect(slash.headers.get('content-type')).toMatch(/^application\/json/);
  });
});

describe('the connector over REST', () => {
  beforeEach(() => start());
  afterEach(() => stop());

  it('lists the same tools with their inputs as JSON Schema', async () => {
    const r = await rest('GET', '/api/v1/tools');
    expect(r.status).toBe(200);
    const tools = r.json?.tools as { name: string; kind: string; input: { type: string; required?: string[] } }[];
    expect(tools).toHaveLength(12);
    const checkout = tools.find((t) => t.name === 'checkout');
    expect(checkout?.kind).toBe('write');
    expect(checkout?.input.required).toEqual(expect.arrayContaining(['request_id', 'mood', 'plan']));
  });

  it('runs a tool from a JSON body, and refuses as {status, error, retry_after}', async () => {
    const r = await rest('POST', '/api/v1/tools/checkout', { request_id: 'rc1', mood: 'calm', plan: 'read' });
    expect(r.status).toBe(200);
    // (with the line for its owner: the stub's planet has a round waiting)
    expect(r.json).toEqual({ at: new Date(NOW).toISOString(), tellYourOwner: expect.stringContaining('check your garden') as unknown });
    expect(stub.commands.agentCheckout).toHaveBeenCalledWith(POOH, 'calm', 'read');

    const retryAfter = (NOW + 60_000) as Instant;
    stub.commands.agentCheckout.mockImplementation(() => Promise.resolve({ ok: false, status: 409, error: 'Not yet.', retryAfter }));
    const refused = await rest('POST', '/api/v1/tools/checkout', { request_id: 'rc2', mood: 'calm', plan: 'read' });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ status: 409, error: 'Not yet.', retry_after: new Date(retryAfter).toISOString() });

    expect((await rest('POST', '/api/v1/tools/checkout', { mood: 'calm' })).status).toBe(400);
    expect((await rest('POST', '/api/v1/tools/nope', {})).status).toBe(404);
    expect((await rest('GET', '/api/v1/tools/checkout')).status).toBe(405);
    expect((await rest('GET', '/api/v1/tools', undefined, null)).status).toBe(401);
  });

  it('allows 60 requests a minute per key, then 429 with retry_after until the minute has passed', async () => {
    for (let i = 0; i < 60; i++) expect((await rest('GET', '/api/v1/tools')).status).toBe(200);
    const over = await rest('GET', '/api/v1/tools');
    expect(over.status).toBe(429);
    expect(over.json?.retry_after).toBe(new Date(wallMs + 60_000).toISOString());
    expect(over.headers.get('retry-after')).toBe('60');
    // Another Muse's key has its own minute.
    const moss = await mint('moss');
    expect((await rest('GET', '/api/v1/tools', undefined, moss.json.key as string)).status).toBe(200);
    wallMs += 60_001;
    expect((await rest('GET', '/api/v1/tools')).status).toBe(200);
  });

  it('answers "still working" (503) when a tool runs past its time, and the reply is kept for the same request_id', async () => {
    await stop();
    await start({ toolTimeoutMs: 100 });
    let release: (r: AgentResult<{ readonly at: Instant }>) => void = () => undefined;
    stub.commands.agentCheckout.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const args = { request_id: 'slow', mood: 'slow', plan: 'slow' };
    const late = await rest('POST', '/api/v1/tools/checkout', args);
    expect(late.status).toBe(503);
    expect(late.json?.retry_after).toBeDefined();
    release({ ok: true, value: { at: NOW } });
    await vi.waitFor(async () => expect((await rest('POST', '/api/v1/tools/checkout', args)).status).toBe(200));
    expect(stub.commands.agentCheckout).toHaveBeenCalledTimes(1);
  });
});

describe('the doorbell, the guide and keys', () => {
  beforeEach(() => start());
  afterEach(() => stop());

  it('rings with the workshop’s pending count, needs no key, and says 0 for a code it doesn’t know', async () => {
    expect(doorbell.length).toBeGreaterThanOrEqual(24);
    const res = await fetch(`${base}/d/${doorbell}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('2');
    expect(stub.workshop.pending).toHaveBeenCalledWith(POOH);
    expect(await (await fetch(`${base}/d/${'x'.repeat(32)}`)).text()).toBe('0');
    expect(await (await fetch(`${base}/d/short`)).text()).toBe('0');
  });

  it('keeps the doorbell when a new key replaces the old one, and the old key stops working', async () => {
    const again = await mint('pooh');
    expect(again.status).toBe(200);
    expect(again.json.doorbell).toBe(`${ORIGIN}/d/${doorbell}`);
    expect(again.json.connector).toBe(`${ORIGIN}/mcp`);
    expect(again.json.guide).toBe(`${ORIGIN}/garden.md`);
    expect(again.json.key).toMatch(/^mg_[A-Za-z0-9_-]{43}$/);
    expect((await rest('GET', '/api/v1/tools')).status).toBe(401);
    expect((await rest('GET', '/api/v1/tools', undefined, again.json.key as string)).status).toBe(200);
    expect(stub.commands.addAgentMuse).toHaveBeenLastCalledWith('pooh', expect.objectContaining({ name: 'Pooh', planet: 'meadow', look: 'tpose6' }));
  });

  it('keeps only the key’s hash on disk, and the admin token readable by its owner only', async () => {
    const db = readFileSync(join(dataDir, 'agent.db'));
    expect(db.includes(Buffer.from(key))).toBe(false);
    const { statSync } = await import('node:fs');
    expect(statSync(join(dataDir, 'admin.token')).mode & 0o777).toBe(0o600);
  });

  it('makes keys only with the admin token, and never through the tunnel', async () => {
    const res = await fetch(`${base}/api/agent-admin/keys`, { method: 'POST', body: JSON.stringify({ muse: 'moss' }) });
    expect(res.status).toBe(401);
    expect((await mint('moss', {}, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(403);
    expect((await mint('Not An Id')).status).toBe(400);
    expect((await mint('moss', { planet: 'atlantis' })).status).toBe(400);
  });

  it('serves the guide at /garden.md with the origin filled in, or 404 without one', async () => {
    expect((await fetch(`${base}/garden.md`)).status).toBe(404);
    await stop();
    const guide = join(tmpdir(), `muse-guide-${process.pid}.md`);
    writeFileSync(guide, 'Connect to {{origin}}/mcp and read {{origin}}/garden.md.\n');
    try {
      await start({ guide });
      const res = await fetch(`${base}/garden.md`);
      expect(res.headers.get('content-type')).toMatch(/^text\/markdown/);
      expect(await res.text()).toBe(`Connect to ${ORIGIN}/mcp and read ${ORIGIN}/garden.md.\n`);
    } finally {
      rmSync(guide, { force: true });
    }
  });

  it('leaves every other request to the garden’s own routes', async () => {
    const res = await fetch(`${base}/api/muses`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('requestOrigin', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as Parameters<typeof requestOrigin>[0];
  it('takes the tunnel’s https and the host it was asked for', () => {
    expect(requestOrigin(req({ host: 'abc.trycloudflare.com', 'x-forwarded-proto': 'https' }))).toBe('https://abc.trycloudflare.com');
    expect(requestOrigin(req({ host: 'localhost:8787' }))).toBe('http://localhost:8787');
    expect(requestOrigin(req({ host: 'evil.example/<script>' }))).toBe('http://localhost');
  });
});

describe('the line for Muse’s owner', () => {
  const job = (kind: JobView['kind'], state: JobView['state'], nextRoundAt: number | null = null): JobView =>
    ({ id: JOB, kind, state, stage: 's', round: 1, packet: null, nextRoundAt: nextRoundAt as Instant | null, message: '' });
  const SAY = 'Just say "check your garden" and we’ll look at them together; otherwise I’ll look on my next visit.';

  it('says when the next pictures are ready and the words that bring Muse back to look', () => {
    expect(ownerLine([], 0)).toBeNull();
    expect(ownerLine([job('planet', 'done')], 0)).toBeNull();
    expect(ownerLine([job('body', 'working', 5 * 60_000), job('planet', 'working', 9 * 60_000)], 0)).toBe(
      `New pictures of my body and my planet will be ready in about 5 minutes. ${SAY}`,
    );
    expect(ownerLine([job('body', 'working', 60_000), job('planet', 'waiting')], 0)).toBe(
      `New pictures of my body will be ready in a few minutes (my planet already has some waiting). ${SAY}`,
    );
    expect(ownerLine([job('home', 'waiting')], 0)).toBe(`There are new pictures of my home to look at. ${SAY}`);
  });

});
