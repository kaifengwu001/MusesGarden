import { describe, expect, it } from 'vitest';
import { clockSeconds, parseBluesky, parseChannelShorts, parseChannelVideos, parseFlickr, parseLinkedArticles, parsePreview, parseSearchResults, parseWatchPage } from './readers';

const page = (data: unknown) => `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;

describe('YouTube channel pages', () => {
  it('lists long videos with their lengths, and Shorts', () => {
    const videos = page({
      tabs: [
        {
          lockupViewModel: {
            contentId: 'eyZEqSPeMwg',
            contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
            contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '34:28' } }] } }] } },
            metadata: { lockupMetadataViewModel: { title: { content: 'Clocks at sea' } } },
          },
        },
        { lockupViewModel: { contentId: 'PLx', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'A playlist' } } } } },
      ],
    });
    expect(parseChannelVideos(videos)).toEqual([{ id: 'eyZEqSPeMwg', title: 'Clocks at sea', duration: 2068 }]);
    const shorts = page({
      items: [{ shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'zEmabFZvdqA' } } }, overlayMetadata: { primaryText: { content: 'A sextant in 30 s' } } } }],
    });
    expect(parseChannelShorts(shorts)).toEqual([{ id: 'zEmabFZvdqA', title: 'A sextant in 30 s' }]);
    expect(() => parseChannelVideos('<html>consent</html>')).toThrow(/ytInitialData/);
  });

  it('reads search results: videos with a line of their description, and Shorts', () => {
    const results = page({
      contents: [
        {
          videoRenderer: {
            videoId: '1EzUlnRtDGM',
            title: { runs: [{ text: 'The Story of Ultramarine' }] },
            lengthText: { simpleText: '8:05' },
            detailedMetadataSnippets: [{ snippetText: { runs: [{ text: 'How did ' }, { text: 'ultramarine', bold: true }, { text: ' get so dear?' }] } }],
          },
        },
        { shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: '5YQbOWoCLIw' } } }, overlayMetadata: { primaryText: { content: 'Pigment spotlight' } } } },
      ],
    });
    expect(parseSearchResults(results)).toEqual({
      videos: [{ id: '1EzUlnRtDGM', title: 'The Story of Ultramarine', duration: 485, snippet: 'How did ultramarine get so dear?' }],
      shorts: [{ id: '5YQbOWoCLIw', title: 'Pigment spotlight' }],
    });
  });

  it('reads a watch page’s description, length and day', () => {
    const html = '<meta itemprop="datePublished" content="2026-10-23T11:46:44-07:00">{"lengthSeconds":"253","shortDescription":"Line one\\nLine \\"two\\""}';
    expect(parseWatchPage(html)).toEqual({ description: 'Line one\nLine "two"', duration: 253, published: '2026-10-23' });
    expect(clockSeconds('1:02:03')).toBe(3723);
    expect(clockSeconds('LIVE')).toBeUndefined();
  });
});

describe('article pages', () => {
  it('reads the preview tags and counts the words in the article', () => {
    const html = `<head><meta property="og:image" content="/img/lead.jpg"><meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="800"><meta property="og:site_name" content="Colossal">
      <meta name="author" content="Grace Ebert"><meta property="article:published_time" content="2026-10-29T08:00:00Z"></head>
      <body><p>Outside the article.</p><article><p>One two three.</p><p>Four &amp; five.</p></article></body>`;
    expect(parsePreview(html, 'https://www.thisiscolossal.com/2026/10/fungi/')).toEqual({
      image: 'https://www.thisiscolossal.com/img/lead.jpg',
      aspect: 1.5,
      site: 'Colossal',
      author: 'Grace Ebert',
      published: '2026-10-29',
      words: 5,
    });
  });
});

describe('Flickr tag feeds', () => {
  const feed = (title: string) => ({
    items: [
      {
        title,
        link: 'https://www.flickr.com/photos/terokarppinen/55621971597/',
        media: { m: 'https://live.staticflickr.com/65535/55621971597_dcf24a6b80_m.jpg' },
        published: '2026-11-01T02:33:27Z',
        author: 'nobody@flickr.com ("Tero Karppinen")',
        description: ' <p><a href="x">Tero Karppinen</a> posted a photo:</p> <p><a href="y"><img src="z" width="240" height="160" alt="" /></a></p> <p>Scarlet elf cup after rain.</p>',
        tags: 'fungi sarcoscyphacoccinea macro',
      },
    ],
  });

  it('keeps photos a person titled, at the larger size, with their tags', () => {
    expect(parseFlickr(feed('Tiny Fungi 17'))).toEqual([
      {
        id: 'flickr-55621971597',
        kind: 'post',
        network: 'flickr',
        url: 'https://www.flickr.com/photos/terokarppinen/55621971597/',
        title: 'Tiny Fungi 17',
        text: 'Scarlet elf cup after rain.',
        author: 'Tero Karppinen',
        site: 'Flickr',
        image: 'https://live.staticflickr.com/65535/55621971597_dcf24a6b80_b.jpg',
        aspect: 1.5,
        published: '2026-11-01',
        tags: ['fungi', 'sarcoscyphacoccinea', 'macro'],
        page: 'https://www.flickr.com/photos/terokarppinen/55621971597/',
      },
    ]);
  });

  it('drops photos titled by the camera', () => {
    for (const title of ['IMG_1234', 'DSC01234', 'P1010101', '20261031-A6505216']) expect(parseFlickr(feed(title)), title).toEqual([]);
  });
});

describe('articles that Bluesky posts link to', () => {
  const linking = (uri: string, over: Record<string, unknown> = {}) => ({
    author: { handle: 'someone.bsky.social' },
    record: { text: 'Worth a read', langs: ['en'] },
    embed: { $type: 'app.bsky.embed.external#view', external: { uri, title: 'Why ultramarine cost more than gold', description: 'A short history.', thumb: 'https://cdn.bsky.app/img/x.jpg' } },
    ...over,
  });

  it('keeps links to articles, not to videos or other networks, from unlabelled English posts', () => {
    expect(
      parseLinkedArticles([
        linking('https://www.example-magazine.com/ultramarine?utm_source=bsky'),
        linking('https://www.youtube.com/watch?v=abc'),
        linking('https://www.example-magazine.com/b', { labels: [{ val: 'spam' }] }),
        linking('https://www.example-magazine.com/c', { record: { text: 'x', langs: ['de'] } }),
      ]),
    ).toEqual([
      {
        url: 'https://www.example-magazine.com/ultramarine?utm_source=bsky',
        link: 'https://www.example-magazine.com/ultramarine',
        title: 'Why ultramarine cost more than gold',
        summary: 'A short history.',
        thumb: 'https://cdn.bsky.app/img/x.jpg',
      },
    ]);
  });
});

describe('Bluesky accounts', () => {
  const post = (over: Record<string, unknown> = {}, record: Record<string, unknown> = {}) => ({
    post: {
      uri: 'at://did:plc:abc/app.bsky.feed.post/3mz4aknl2rk2y',
      author: { handle: 'britmycolsoc.org.uk' },
      record: { text: 'Fly agaric season is here. Look under birches.', createdAt: '2026-10-30T09:00:00Z', langs: ['en'], ...record },
      embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x.jpg', aspectRatio: { width: 3, height: 4 } }] },
      labels: [],
      ...over,
    },
  });

  it('keeps the account’s own captioned pictures, unlabelled and in English', () => {
    const json = {
      feed: [
        post(),
        { ...post(), reason: { $type: 'app.bsky.feed.defs#reasonRepost' } },
        post({ labels: [{ val: 'graphic-media' }] }),
        post({ author: { handle: 'someone.else' } }),
        post({}, { langs: ['fr'] }),
        post({}, { text: '#AIart moody forest' }),
        post({ embed: undefined }),
      ],
    };
    expect(parseBluesky(json, 'britmycolsoc.org.uk')).toEqual([
      {
        id: 'bsky-3mz4aknl2rk2y',
        kind: 'post',
        network: 'bluesky',
        url: 'https://bsky.app/profile/britmycolsoc.org.uk/post/3mz4aknl2rk2y',
        title: 'Fly agaric season is here. Look under birches.',
        text: 'Fly agaric season is here. Look under birches.',
        author: '@britmycolsoc.org.uk',
        site: 'Bluesky',
        image: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x.jpg',
        aspect: 0.75,
        published: '2026-10-30',
        tags: [],
        uri: 'at://did:plc:abc/app.bsky.feed.post/3mz4aknl2rk2y',
      },
    ]);
  });
});
