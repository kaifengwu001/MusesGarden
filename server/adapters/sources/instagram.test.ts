import { describe, expect, it } from 'vitest';
import { captionTitle, InstagramReader } from './instagram';
import { parseMediaItem } from './media';
import { urlOf } from './samples';

/** The shape Business Discovery answers with, trimmed to the fields the reader asks for. */
const discovery = {
  business_discovery: {
    username: 'kewgardens',
    media: {
      data: [
        {
          id: '17900000000000001',
          caption: 'Autumn in the Temperate House 🍂\nA closer look at Camellia sinensis, the tea plant. #botany #tea',
          media_type: 'IMAGE',
          media_product_type: 'FEED',
          media_url: 'https://scontent.cdninstagram.com/v/t51/photo.jpg?oe=6721',
          permalink: 'https://www.instagram.com/p/DAbCdEf123/',
          timestamp: '2026-10-28T09:15:00+0000',
        },
        {
          id: '17900000000000002',
          caption: 'Watch a botanical artist work in watercolour.',
          media_type: 'VIDEO',
          media_product_type: 'REELS',
          media_url: 'https://scontent.cdninstagram.com/v/t50/clip.mp4',
          thumbnail_url: 'https://scontent.cdninstagram.com/v/t51/clip-cover.jpg?oe=6722',
          permalink: 'https://www.instagram.com/reel/DXyZ987/',
          timestamp: '2026-10-25T18:00:00+0000',
        },
        { id: '17900000000000003', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: '2026-10-20T10:00:00+0000' },
      ],
    },
    id: '17841400000000000',
  },
  id: '17841499999999999',
};

function stubGraph(answers: Readonly<Record<string, unknown>>, status = 200) {
  const calls: URL[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    const url = new URL(urlOf(input));
    calls.push(url);
    const body = answers[url.pathname];
    return Promise.resolve(body === undefined ? Response.json({ error: { message: 'Unknown path' } }, { status: 400 }) : Response.json(body, { status }));
  };
  return { calls, fetch };
}

describe('the Instagram reader', () => {
  it('stays off without a token', () => {
    expect(InstagramReader.fromEnv({})).toBeNull();
    expect(InstagramReader.fromEnv({ META_IG_TOKEN: '  ' })).toBeNull();
    expect(InstagramReader.fromEnv({ META_IG_TOKEN: 'token' })).toBeInstanceOf(InstagramReader);
  });

  it('reads an account’s newest posts and reels through Business Discovery, as recordable items', async () => {
    const graph = stubGraph({
      '/v21.0/me/accounts': { data: [{ id: 'page-1' }, { id: 'page-2', instagram_business_account: { id: '17841499999999999' } }] },
      '/v21.0/17841499999999999': discovery,
    });
    const reader = InstagramReader.fromEnv({ META_IG_TOKEN: 'secret-token' }, graph.fetch);
    const items = await reader!.latest('kewgardens', 25);

    expect(items.map(({ tags: _, ...rest }) => rest)).toEqual([
      {
        id: 'ig-DAbCdEf123',
        kind: 'post',
        network: 'instagram',
        url: 'https://www.instagram.com/p/DAbCdEf123/',
        title: 'Autumn in the Temperate House 🍂',
        text: 'Autumn in the Temperate House 🍂 A closer look at Camellia sinensis, the tea plant. #botany #tea',
        author: '@kewgardens',
        site: 'Instagram',
        image: 'https://scontent.cdninstagram.com/v/t51/photo.jpg?oe=6721',
        published: '2026-10-28',
      },
      {
        id: 'ig-DXyZ987',
        kind: 'reel',
        network: 'instagram',
        url: 'https://www.instagram.com/reel/DXyZ987/',
        title: 'Watch a botanical artist work in watercolour.',
        text: 'Watch a botanical artist work in watercolour.',
        author: '@kewgardens',
        site: 'Instagram',
        image: 'https://scontent.cdninstagram.com/v/t51/clip-cover.jpg?oe=6722',
        aspect: 9 / 16,
        published: '2026-10-25',
      },
    ]);
    expect(items[0].tags).toEqual(['botany', 'tea']);
    const asked = graph.calls[1];
    expect(asked.searchParams.get('fields')).toContain('business_discovery.username(kewgardens){username,media.limit(25){');
    expect(asked.searchParams.get('access_token')).toBe('secret-token');
    const recorded = parseMediaItem({ ...items[0], tags: undefined, topics: ['Tea'], area: 'tea' });
    expect(recorded.candidate.media.image).toBe('/api/media/ig-DAbCdEf123');
  });

  it('skips the Page lookup when the account id is given, and reports Meta’s refusal without the token', async () => {
    const graph = stubGraph({ '/v21.0/42': { error: { message: 'Application does not have permission for this action' } } }, 403);
    const reader = InstagramReader.fromEnv({ META_IG_TOKEN: 'secret-token', META_IG_USER_ID: '42' }, graph.fetch);
    const failure = await reader!.latest('kewgardens', 5).catch((e: unknown) => String(e));
    expect(failure).toMatch(/answered 403 Application does not have permission/);
    expect(failure).not.toContain('secret-token');
    expect(graph.calls.map((c) => c.pathname)).toEqual(['/v21.0/42']);
  });

  it('titles a find by its caption’s first line, cut at a word', () => {
    expect(captionTitle('\n\nFirst line\nsecond', '@x')).toBe('First line');
    expect(captionTitle('', '@x')).toBe('@x');
    const long = captionTitle('word '.repeat(40), '@x');
    expect(long.length).toBeLessThanOrEqual(91);
    expect(long.endsWith('word…')).toBe(true);
  });
});
