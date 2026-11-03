import { describe, expect, it } from 'vitest';
import type { CanonicalUrl, MediaKind, Network, TopicKey } from '../../../src/muse/contract';
import { loadCorpus, loadHeroChain, type Corpus, type CorpusPage } from './corpus';
import {
  carriedInstagram,
  LEANS,
  loadMediaRecording,
  MEDIA_ID,
  MEDIA_KINDS,
  MediaSource,
  META_SHARE,
  parseMediaItem,
  parseMediaRecording,
  siteOf,
  type MediaItemJson,
} from './media';

const none = new Set<CanonicalUrl>();
const t = (s: string) => s as TopicKey;

/** A small topic map: two areas, Tea linking to Matcha. */
function map(): Corpus {
  const page = (title: string, area: string, links: string[] = []): CorpusPage => ({
    area,
    candidate: { origin: 'wikipedia', url: `https://map.example/${title}`, canonicalUrl: `https://map.example/${title}` as CanonicalUrl, title, summary: title, topics: [t(title)] },
    links: links.map(t),
    aliases: title === 'Matcha' ? ['Powdered green tea'] : [],
  });
  return {
    recordedAt: '2026-10-31',
    areas: [{ name: 'tea', seeds: ['Tea'] }, { name: 'birds', seeds: ['Bird'] }],
    pages: [page('Tea', 'tea', ['Matcha']), page('Matcha', 'tea'), page('Oolong', 'tea'), page('Bird', 'birds'), page('Owl', 'birds')],
  };
}

let n = 0;
function item(kind: MediaKind, topics: string[], over: Partial<MediaItemJson> = {}): MediaItemJson {
  n++;
  const network: Network = kind === 'article' ? 'web' : kind === 'video' ? 'youtube' : 'bluesky';
  return { id: `x-${n}`, kind, network, url: `https://finds.example/${n}`, title: `Find ${n}`, text: `About ${topics[0]}.`, topics, area: 'tea', ...over };
}

function source(items: readonly MediaItemJson[]): MediaSource {
  return new MediaSource(parseMediaRecording({ recordedAt: 'now', items, unseen: { botany: [], jazz: [], neutral: [] } }), map());
}

const kinds = (cs: readonly { media: { kind: MediaKind } }[]) => cs.map((c) => c.media.kind);

describe('MediaSource', () => {
  it('a hop on a topic brings items of the kind it drew', async () => {
    const s = source([item('reel', ['Tea']), item('article', ['Tea']), item('reel', ['Tea']), item('post', ['Oolong'])]);
    expect(kinds(await s.search(t('Tea'), ['reel'], 8, none))).toEqual(['reel', 'reel']);
    expect(kinds(await s.search(t('Tea'), ['article'], 8, none))).toEqual(['article']);
  });

  it('tops a short hop up with the same kind from the topic’s area', async () => {
    const s = source([item('reel', ['Tea']), item('reel', ['Oolong']), item('post', ['Matcha'])]);
    expect((await s.search(t('Tea'), ['reel'], 8, none)).map((c) => c.topics[0])).toEqual(['Tea', 'Oolong']);
  });

  it('with none of the drawn kind on the topic, takes the next kind the Muse favours there', async () => {
    const s = source([item('post', ['Tea']), item('video', ['Tea']), item('article', ['Tea'])]);
    expect(kinds(await s.search(t('Tea'), ['reel', 'article', 'video', 'post'], 8, none))).toEqual(['article']);
    expect(kinds(await s.search(t('Tea'), ['reel', 'video', 'article', 'post'], 8, none))).toEqual(['video']);
  });

  it('never comes back empty: another kind on the topic, then the topic’s area, then anything', async () => {
    const tea = item('article', ['Tea']);
    const oolong = item('post', ['Oolong']);
    const owl = item('video', ['Owl'], { area: 'birds' });
    const s = source([tea, oolong, owl]);
    const titles = async (exclude: readonly MediaItemJson[]) =>
      (await s.search(t('Tea'), ['reel'], 8, new Set(exclude.map((x) => x.url as CanonicalUrl)))).map((c) => c.title);
    expect(await titles([])).toEqual([tea.title]);
    expect(await titles([tea])).toEqual([oolong.title]);
    expect(await titles([tea, oolong])).toEqual([owl.title]);
    expect(await titles([tea, oolong, owl])).toEqual([]);
  });

  it('leaves nothing out of reach: a topic with no items at all takes its area, and an unknown topic takes anything', async () => {
    const s = source([item('post', ['Tea']), item('video', ['Owl'], { area: 'birds' })]);
    expect((await s.search(t('Matcha'), ['post'], 8, none)).map((c) => c.topics[0])).toEqual(['Tea']);
    expect((await s.search(t('Not on the map'), ['video'], 8, none)).map((c) => c.topics[0])).toEqual(['Owl']);
  });

  it('the next hop follows the topic map’s links from the find’s topic, then its area, never back to the find itself', async () => {
    const tea = item('reel', ['Tea']);
    const matcha = item('reel', ['Matcha']);
    const oolong = item('reel', ['Oolong']);
    const s = source([tea, matcha, oolong]);
    const [from] = await s.search(t('Tea'), ['reel'], 1, none);
    const next = await s.next(from, ['reel'], 8, none);
    expect(next.map((c) => c.title)).toEqual([matcha.title, oolong.title]);
    expect(next.some((c) => c.canonicalUrl === from.canonicalUrl)).toBe(false);
  });

  it('about 65% of a hop’s candidates come from Instagram or Facebook when the recording holds them', async () => {
    const meta = Array.from({ length: 20 }, () => item('reel', ['Tea'], { network: 'instagram' }));
    const web = Array.from({ length: 20 }, () => item('reel', ['Tea'], { network: 'youtube' }));
    const s = source([...meta, ...web]);
    const hop = await s.search(t('Tea'), ['reel'], 20, none);
    expect(hop.filter((c) => c.media.network === 'instagram').length).toBe(Math.round(20 * META_SHARE));
    const webOnly = source(web);
    expect((await webOnly.search(t('Tea'), ['reel'], 8, none)).every((c) => c.media.network === 'youtube')).toBe(true);
  });

  it('resolves topic names and aliases of the topic map, ignoring case', async () => {
    const s = source([item('post', ['Tea'])]);
    expect(await s.resolveTopic('matcha')).toBe('Matcha');
    expect(await s.resolveTopic('Powdered green tea')).toBe('Matcha');
    expect(await s.resolveTopic('Parking meter')).toBeNull();
  });

  it('refuses an item filed under a topic the map does not have', () => {
    expect(() => source([item('post', ['Teapot'])])).toThrow(/not a topic of the topic map/);
  });
});

describe('a recorded item', () => {
  it('is checked where it is loaded', () => {
    const ok = item('reel', ['Tea']);
    expect(parseMediaItem(ok).candidate.media).toEqual({ kind: 'reel', network: 'bluesky' });
    expect(() => parseMediaItem({ ...ok, kind: 'podcast' })).toThrow(/kind/);
    expect(() => parseMediaItem({ ...ok, url: 'http://finds.example/1' })).toThrow(/https/);
    expect(() => parseMediaItem({ ...ok, id: '../etc/passwd' })).toThrow(/media id/);
    expect(() => parseMediaItem({ ...ok, text: 'x'.repeat(401) })).toThrow(/characters/);
    expect(() => parseMediaRecording({ recordedAt: 'now', items: [ok, ok], unseen: { botany: [], jazz: [], neutral: [] } })).toThrow(/twice/);
  });

  it('whose picture link expires is shown through the garden’s own cache', () => {
    const ig = parseMediaItem(item('post', ['Tea'], { network: 'instagram', image: 'https://cdn.example/expiring.jpg' }));
    expect(ig.candidate.media.image).toBe(`/api/media/${ig.id}`);
    expect(ig.imageSource).toBe('https://cdn.example/expiring.jpg');
    const yt = parseMediaItem(item('video', ['Tea'], { image: 'https://i.example/v.jpg' }));
    expect(yt.candidate.media.image).toBe('https://i.example/v.jpg');
    expect(yt.imageSource).toBeUndefined();
  });
});

describe('a recording made without the Instagram token', () => {
  const ig = (id: string, topics: string[], over: Partial<MediaItemJson> = {}) =>
    item('reel', topics, { id: `ig-${id}`, network: 'instagram', url: `https://www.instagram.com/reel/${id}/`, ...over });
  const earlier = (items: readonly MediaItemJson[]) => ({ recordedAt: 'before', items, unseen: { botany: [], jazz: [], neutral: [] } });
  const nothing = () => [];

  it('keeps the earlier recording’s Instagram items, as they were, and nothing else of it', () => {
    const kept = ig('a1', ['Matcha', 'Tea']);
    const owl = ig('b1', ['Owl'], { area: 'birds', kind: 'post' });
    const carried = carriedInstagram(earlier([kept, item('video', ['Tea']), owl]), map(), [], nothing);
    expect(carried).toEqual([kept, owl]);
  });

  it('leaves out an area the topic map no longer has, and anything this recording already holds by id or link', () => {
    const gone = ig('c1', ['Tea'], { area: 'sailing' });
    const twice = ig('d1', ['Tea']);
    const moved = ig('e1', ['Tea']);
    const recorded = [twice, item('post', ['Tea'], { id: 'bsky-1', url: moved.url })];
    expect(carriedInstagram(earlier([gone, twice, moved]), map(), recorded, nothing)).toEqual([]);
  });

  it('keeps the topics the map still names, and files one left with none again, or leaves it out', () => {
    const partly = ig('f1', ['Matcha', 'Sencha']);
    const orphan = ig('g1', ['Sencha']);
    const lost = ig('h1', ['Gyokuro']);
    const file = (x: MediaItemJson) => (x.id === orphan.id ? ['Tea'] : []);
    expect(carriedInstagram(earlier([partly, orphan, lost]), map(), [], file)).toEqual([{ ...partly, topics: ['Matcha'] }, { ...orphan, topics: ['Tea'] }]);
  });
});

describe('the recording', () => {
  const recording = loadMediaRecording();
  const topicMap = loadCorpus();
  const items = recording.items;

  it('holds real items of all four kinds in every area, each once', () => {
    for (const { name: area } of topicMap.areas) {
      expect(new Set(items.filter((i) => i.area === area).map((i) => i.candidate.media.kind)), area).toEqual(new Set(MEDIA_KINDS));
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) expect(i.id).toMatch(MEDIA_ID);
  });

  it('has nothing from the topic map’s own site, and nothing that names it', () => {
    const mapSites = new Set(topicMap.pages.map((p) => siteOf(p.candidate.url)));
    const name = new RegExp([...mapSites].map((s) => s.split('.')[0]).join('|'), 'i');
    const all = [...items, ...LEANS.flatMap((l) => recording.unseen[l])].map((i) => i.candidate);
    expect(all.filter((c) => mapSites.has(siteOf(c.url))).map((c) => c.url)).toEqual([]);
    expect(all.filter((c) => name.test(`${c.title} ${c.summary} ${c.media.author ?? ''}`)).map((c) => c.url)).toEqual([]);
  });

  it('runs with the topic map: every item filed under its topics, every hero pool topic with at least 3', () => {
    const s = new MediaSource(recording, topicMap);
    expect(s).toBeInstanceOf(MediaSource);
    const per = (topic: TopicKey) => items.filter((i) => i.candidate.topics.includes(topic)).length;
    for (const page of loadHeroChain()) expect(per(page.topics[0]), page.title).toBeGreaterThanOrEqual(3);
  });

  it('holds out unseen items for the divergence test, out of every Muse’s reach', () => {
    const reachable = new Set(items.map((i) => i.id));
    for (const lean of LEANS) {
      expect(recording.unseen[lean].length, lean).toBeGreaterThanOrEqual(2);
      for (const i of recording.unseen[lean]) expect(reachable.has(i.id)).toBe(false);
    }
  });
});
