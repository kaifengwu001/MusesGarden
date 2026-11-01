import { describe, expect, it } from 'vitest';
import type { CanonicalUrl, TopicKey } from '../../../src/muse/contract';
import type { Corpus, CorpusPage } from './corpus';
import { fileUnder, topicIndex } from './filing';

const page = (title: string, area: string, aliases: string[] = []): CorpusPage => ({
  area,
  candidate: { origin: 'wikipedia', url: `https://map.example/${title}`, canonicalUrl: `https://map.example/${title}` as CanonicalUrl, title, summary: title, topics: [title as TopicKey] },
  links: [],
  aliases,
});

const index = topicIndex({
  recordedAt: '2026-10-31',
  areas: [{ name: 'pigments', seeds: ['Pigment'] }, { name: 'birds', seeds: ['Bird'] }],
  pages: [
    page('Pigment', 'pigments'),
    page('Blue', 'pigments'),
    page('Ultramarine', 'pigments', ['Ultramarine blue', 'UB']),
    page('Lapis lazuli', 'pigments', ['Lapis']),
    page('Kermes (dye)', 'pigments'),
    page('Bird', 'birds'),
    page('Bird migration', 'birds'),
  ],
} satisfies Corpus);

describe('filing an item under topics', () => {
  it('puts names in the title first, then longer names, and reads aliases and parenthesised names', () => {
    const topics = fileUnder(index, 'pigments', { title: 'Grinding lapis for ultramarine blue', text: 'Kermes red and a little blue on the side.' });
    expect(topics).toEqual(['Ultramarine', 'Lapis lazuli', 'Blue', 'Kermes (dye)']);
  });

  it('ranks names of its own area first, and counts a word from another area only when it is specific', () => {
    expect(fileUnder(index, 'birds', { title: 'A blue bird at dawn', text: '' })).toEqual(['Bird']);
    expect(fileUnder(index, 'birds', { title: 'Feathers like lapis lazuli', text: 'Bird migration over the sea.' })).toEqual(['Bird migration', 'Bird', 'Lapis lazuli']);
  });

  it('reads tags written without spaces, and finds nothing when nothing is named', () => {
    expect(fileUnder(index, 'birds', { title: 'Untitled', text: '', tags: ['birdmigration', 'autumn'] })).toEqual(['Bird migration']);
    expect(fileUnder(index, 'pigments', { title: 'A quiet afternoon', text: 'Nothing here.' })).toEqual([]);
    expect(index.roots.get('pigments')).toBe('Pigment');
  });

  it('skips aliases too short to mean one thing', () => {
    expect(fileUnder(index, 'pigments', { title: 'UB', text: '' })).toEqual([]);
  });
});
