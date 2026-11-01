import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMediaItem } from '../adapters/sources/media';
import { urlOf } from '../adapters/sources/samples';
import { mediaCache } from './media';

const PICTURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const reel = parseMediaItem({
  id: 'ig-DXyZ987',
  kind: 'reel',
  network: 'instagram',
  url: 'https://www.instagram.com/reel/DXyZ987/',
  title: 'Watercolour, slowly',
  text: '',
  topics: ['Watercolor painting'],
  area: 'botanical illustration',
  image: 'https://scontent.cdninstagram.com/v/t51/cover.jpg?oe=6722',
});
const video = parseMediaItem({ ...reel.candidate, id: 'yt-abc', kind: 'video', network: 'youtube', url: 'https://www.youtube.com/watch?v=abc', text: '', topics: ['Tea'], area: 'tea', image: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' });

let dir = '';
let asked: string[] = [];
let answer: () => Response = () => new Response(PICTURE, { headers: { 'content-type': 'image/jpeg' } });
const fetch: typeof globalThis.fetch = (input) => {
  asked.push(urlOf(input));
  return Promise.resolve(answer());
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'muse-media-'));
  asked = [];
  answer = () => new Response(PICTURE, { headers: { 'content-type': 'image/jpeg' } });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the picture cache for links that expire', () => {
  it('fetches a picture once, keeps it on disk, and serves it from there after', async () => {
    const images = mediaCache({ dir, items: [reel, video], fetch });
    expect(await images('ig-DXyZ987')).toEqual({ type: 'image/jpeg', body: PICTURE });
    expect(readdirSync(dir)).toEqual(['ig-DXyZ987.jpg']);
    const restarted = mediaCache({ dir, items: [reel], fetch });
    expect(await restarted('ig-DXyZ987')).toEqual({ type: 'image/jpeg', body: PICTURE });
    expect(asked).toEqual(['https://scontent.cdninstagram.com/v/t51/cover.jpg?oe=6722']);
  });

  it('serves only recorded pictures that expire, by a well-formed id', async () => {
    const images = mediaCache({ dir, items: [reel, video], fetch });
    expect(await images('yt-abc')).toBeNull();
    expect(await images('ig-unknown')).toBeNull();
    expect(await images('../garden.db')).toBeNull();
    expect(asked).toEqual([]);
  });

  it('keeps nothing when the network no longer gives the picture', async () => {
    answer = () => new Response('gone', { status: 403, headers: { 'content-type': 'text/plain' } });
    const images = mediaCache({ dir, items: [reel], fetch });
    expect(await images('ig-DXyZ987')).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });
});
