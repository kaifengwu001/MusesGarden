// Opt-in smoke against the real services: MUSE_LIVE=1 npx vitest run server/adapters/sources/live.test.ts
import { describe, expect, it } from 'vitest';
import type { CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import { loadCorpus, loadHeroChain, loadUnseenPool } from './corpus';
import { WikipediaSource } from './wikipedia';

const none = new Set<CanonicalUrl>();

describe.runIf(process.env.MUSE_LIVE === '1')('live sources', () => {
  const wiki = new WikipediaSource();

  it('Wikipedia answers every Source method', async () => {
    const [top] = await wiki.search('Ultramarine' as TopicKey, 3, none);
    expect(top.title).toBe('Ultramarine');
    expect((await wiki.next(top, 6, none)).length).toBe(6);
    expect((await wiki.serendipity(3, 0, none)).length).toBe(3);
    expect(await wiki.resolveTopic('colour')).toBe('Color');
  }, 300_000);

  it('every fixture page still resolves to its recorded canonical title', async () => {
    const pool = loadUnseenPool();
    const recorded = [...loadCorpus().pages.map((p) => p.candidate), ...loadHeroChain(), ...pool.botany, ...pool.jazz, ...pool.neutral];
    const found = await wiki.lookup(recorded.map((c) => c.title));
    const drifted = recorded.filter((c) => found.get(c.title)?.canonicalUrl !== c.canonicalUrl).map((c) => c.title);
    expect(drifted).toEqual([]);
  }, 600_000);
});
