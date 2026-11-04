import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { liveClients, clientsFromEnv } from '../../workshop/live';
import { metaHttp } from './http';
import { metaImages } from './images';
import { metaJudge } from './judge';
import type { MaskDecoder } from './sam';
import { metaSegmenter, parseSamText } from './sam';

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly auth: string;
}

type Reply = object | ((signal: AbortSignal) => Promise<Response>);

/** A fetch that answers from `replies` in turn and keeps every request. */
function fakeFetch(replies: readonly Reply[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? init.body : '{}';
    calls.push({ url, body: JSON.parse(body) as Record<string, unknown>, auth: headers.Authorization ?? '' });
    const reply = replies[Math.min(i++, replies.length - 1)];
    if (typeof reply === 'function') return (reply as (s: AbortSignal) => Promise<Response>)(init?.signal as AbortSignal);
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const png = (w = 40, h = 30, color = { r: 200, g: 180, b: 160 }) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const jpeg = (w = 40, h = 30) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
const opts = (fn: typeof fetch) => ({ apiKey: 'k-test', baseUrl: 'https://meta.test/v1/', fetch: fn, retryPauseMs: 1 });

describe('Meta over HTTP', () => {
  it('says plainly what went wrong', async () => {
    const envelope = { error: { type: 'invalid_request_error', param: 'n', message: 'n must be at most 10' } };
    const { fn } = fakeFetch([new Response(JSON.stringify(envelope), { status: 400 })]);
    await expect(metaHttp(opts(fn)).post('/x', {}, { what: 'Making pictures', timeoutMs: 1000 })).rejects.toThrow(
      'Making pictures refused the request (400 invalid_request_error, param n): n must be at most 10',
    );
    await expect(metaHttp({ ...opts(fn), apiKey: '' }).post('/x', {}, { what: 'Judging', timeoutMs: 1000 })).rejects.toThrow('Judging needs MODEL_API_KEY');
  });

  it('tries a busy backend once more', async () => {
    const { fn, calls } = fakeFetch([new Response('{"error":{"message":"busy"}}', { status: 503 }), { fine: true }]);
    expect(await metaHttp(opts(fn)).post('/x', { a: 1 }, { what: 'x', timeoutMs: 1000 })).toEqual({ fine: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: 'https://meta.test/v1/x', auth: 'Bearer k-test', body: { a: 1 } });
  });

  it('gives up after its timeout', async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true }));
    const { fn } = fakeFetch([hang]);
    await expect(metaHttp(opts(fn)).post('/x', {}, { what: 'Finding “plush toy”', timeoutMs: 30 })).rejects.toThrow('Finding “plush toy” took longer than 0 s');
    const stop = new AbortController();
    const p = metaHttp(opts(fn)).post('/x', {}, { what: 'Editing', timeoutMs: 10_000, signal: stop.signal });
    stop.abort();
    await expect(p).rejects.toThrow('Editing was stopped');
  });
});

describe('muse-image-1.0', () => {
  it('generates PNGs, with search off unless asked for', async () => {
    const a = await png();
    const j = await jpeg();
    const { fn, calls } = fakeFetch([{ created: 1, data: [{ b64_json: a.toString('base64') }, { b64_json: j.toString('base64') }] }, { data: [{ b64_json: a.toString('base64') }] }]);
    const images = metaImages(opts(fn));
    const out = await images.generate({ prompt: 'a misty moss planet', n: 2, size: '1024x1024' });
    expect(calls[0]?.url).toBe('https://meta.test/v1/images/generations');
    expect(calls[0]?.body).toEqual({
      model: 'muse-image-1.0',
      prompt: 'a misty moss planet',
      n: 2,
      size: '1024x1024',
      response_format: 'b64_json',
      output_format: 'png',
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.equals(a)).toBe(true);
    expect((await sharp(out[1]).metadata()).format).toBe('png');

    await images.generate({ prompt: 'p', n: 1, search: true });
    expect(calls[1]?.body).not.toHaveProperty('tool_enablement');
    await expect(images.generate({ prompt: 'p', n: 11 })).rejects.toThrow('1 to 10 pictures');
  });

  it('edits the first picture, with the rest as references', async () => {
    const base = await jpeg();
    const avatar = await png();
    const { fn, calls } = fakeFetch([{ data: [{ b64_json: avatar.toString('base64') }] }]);
    const out = await metaImages(opts(fn)).edit({ prompt: 'make the fur pale blue', images: [base, avatar], n: 1 });
    expect(out).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://meta.test/v1/images/edits');
    const sent = calls[0]?.body.images as { image_url: string }[];
    expect(sent.map((i) => i.image_url.slice(0, 23))).toEqual(['data:image/jpeg;base64,', 'data:image/png;base64,i']);
    expect(Buffer.from(sent[0]?.image_url.split(',')[1] ?? '', 'base64').equals(base)).toBe(true);
    await expect(metaImages(opts(fn)).edit({ prompt: 'p', images: [], n: 1 })).rejects.toThrow('1 to 10 pictures');
  });

  it('refuses an answer with no pictures', async () => {
    const { fn } = fakeFetch([{ data: [] }]);
    await expect(metaImages(opts(fn)).generate({ prompt: 'p', n: 1 })).rejects.toThrow('without any pictures');
  });
});

describe('sam-3.1', () => {
  // As seen live on base.jpg: one record, the mask an H×W raster over its box.
  const line =
    '<0f>0<|box;x1=10;y1=5;x2=19;y2=14;w=40;h=30;c=0.98|><|mask;x=0;y=0;c=0.98;data=10,10,!AAAA|>,3<|box;x1=0;y1=0;x2=3;y2=1;w=40;h=30|><|mask;x=0;y=0;data=2,4,!BB|>\n';
  const reply = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: line }] }] };

  it('reads each record’s box, confidence and mask', () => {
    expect(parseSamText(line)).toEqual([
      { id: 0, box: [10, 5, 19, 14], size: [40, 30], confidence: 0.98, mask: { encoding: 'one_bit', payload: '!AAAA', height: 10, width: 10 } },
      { id: 3, box: [0, 0, 3, 1], size: [40, 30], mask: { encoding: 'one_bit', payload: '!BB', height: 2, width: 4 } },
    ]);
    expect(parseSamText('')).toEqual([]);
    expect(parseSamText('<0f>')).toEqual([]);
  });

  it('asks with one phrase and one picture, and draws each mask the picture’s size', async () => {
    const picture = await png(40, 30);
    const { fn, calls } = fakeFetch([reply]);
    // the left half of each box's raster is in
    const decode: MaskDecoder = ({ width, height }) => Uint8Array.from({ length: width * height }, (_, i) => (i % width < width / 2 ? 1 : 0));
    const found = await metaSegmenter({ ...opts(fn), decodeMask: decode }).find(picture, 'plush toy');
    expect(calls[0]?.url).toBe('https://meta.test/v1/responses');
    expect(calls[0]?.body).toMatchObject({
      model: 'sam-3.1',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'plush toy' }, { type: 'input_image' }] }],
      metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
    });
    expect(found.map((s) => [s.box, s.confidence])).toEqual([
      [[10, 5, 19, 14], 0.98],
      [[0, 0, 3, 1], undefined],
    ]);
    const mask = found[0]?.mask;
    expect(mask).not.toBeNull();
    const { data, info } = await sharp(mask!).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([40, 30]);
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect([at(10, 5), at(14, 14), at(15, 5), at(19, 14), at(9, 5), at(10, 4), at(0, 29)]).toEqual([255, 255, 0, 0, 0, 0, 0]);
  });

  it('keeps boxes with no mask when it can’t decode, and finds nothing as nothing', async () => {
    const picture = await png(40, 30);
    const { fn } = fakeFetch([reply, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] }]);
    const sam = metaSegmenter({ ...opts(fn), decodeMask: null });
    expect((await sam.find(picture, 'plush toy')).map((s) => s.mask)).toEqual([null, null]);
    expect(await sam.find(picture, 'dragon')).toEqual([]);
  });
});

describe('muse-spark-1.3 as the judge', () => {
  it('asks for strict JSON, with pictures as data URLs, and reads the answer', async () => {
    const a = await png();
    const answer = { ok: true, reasons: ['the pose holds'] };
    const { fn, calls } = fakeFetch([{ choices: [{ message: { content: 'not json' } }] }, { choices: [{ message: { content: JSON.stringify(answer) } }] }]);
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    const got = await metaJudge(opts(fn)).json<typeof answer>({ name: 'pose check', system: 'You check poses.', prompt: 'Same pose?', images: [a], schema });
    expect(got).toEqual(answer);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://meta.test/v1/chat/completions');
    expect(calls[0]?.body).toMatchObject({
      model: 'muse-spark-1.3',
      messages: [
        { role: 'system', content: 'You check poses.' },
        { role: 'user', content: [{ type: 'text', text: 'Same pose?' }, { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) as unknown } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'pose_check', schema, strict: true } },
    });
  });

  it('gives up after two answers that aren’t JSON', async () => {
    const { fn } = fakeFetch([{ choices: [{ message: { content: 'hmm' } }] }]);
    await expect(metaJudge(opts(fn)).json({ name: 'x', system: '', prompt: '', schema: {} })).rejects.toThrow('isn’t the JSON asked for');
  });
});

describe('the workshop’s clients', () => {
  it('fakes every client under WORKSHOP_FAKE=1, and says plainly what isn’t wired yet', async () => {
    const fake = clientsFromEnv({}, { WORKSHOP_FAKE: '1' });
    expect(await fake.images.generate({ prompt: 'p', n: 2 })).toHaveLength(2);
    const live = liveClients({ meta: { apiKey: 'k' } });
    await expect(live.mesher.fromImage(Buffer.alloc(1), { purpose: 'test' })).rejects.toThrow('isn’t wired into the workshop yet');
    expect(await live.builder.available()).toBe(false);
  });
});
