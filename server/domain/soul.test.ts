import { describe, expect, it } from 'vitest';
import type { Interest, ReflectionRecord } from '../../src/muse/contract';
import { eventRef, instant } from './ids';
import { newInterest } from './interests';
import { parseSoul, renderSoulSection } from './soul';
import { emptyState } from './state';
import { MOSS, topic, wiki } from './testing';

describe('parseSoul', () => {
  it('reads the name and the traits it has, clamped, and leaves the rest to be estimated', () => {
    const soul = parseSoul('---\nname: Moss\ncuriosity: 0.6\nfocus: 1.4\nwhimsy: "0.3"\nnovelty: lots\n---\nI like quiet places.\n');
    expect(soul).toEqual({ name: 'Moss', temperament: { curiosity: 0.6, focus: 1, whimsy: 0.3 }, body: 'I like quiet places.\n' });
  });

  it('treats a SOUL.md without frontmatter as all body', () => {
    expect(parseSoul('I like quiet places.')).toEqual({ name: null, temperament: {}, body: 'I like quiet places.' });
  });
});

describe('renderSoulSection', () => {
  const at = instant(Date.parse('2026-11-04T12:00:00-08:00'));
  const interest = (name: string, stage: Interest['stage'], affinity: number, sources: number): Interest => ({
    ...newInterest(topic(name), at, 'muse'),
    stage,
    affinity,
    sources: Array.from({ length: sources }, (_, k) => wiki(`${name} ${k}`)),
  });
  const reflection = (version: number, narrative: string): ReflectionRecord => ({ ref: eventRef(MOSS.id, version), version, at, narrative, deltas: [] });

  it('lists established and emerging interests with their evidence and the latest narrative, and nothing else', () => {
    const s = {
      ...emptyState(MOSS),
      interests: new Map([
        [topic('Pigment'), interest('Pigment', 'established', 0.5, 4)],
        [topic('Ultramarine'), interest('Ultramarine', 'emerging', 0.2, 2)],
        [topic('Jazz'), interest('Jazz', 'hypothesis', 0, 0)],
      ]),
      reflections: [reflection(1, 'Colours come from stones.')],
    };
    expect(renderSoulSection(s)).toBe(
      [
        "## What I've been into",
        '',
        'Garden soul version 1.',
        '',
        '### Established',
        '',
        '- **Pigment**: 4 sources, affinity 0.50.',
        '',
        '### Emerging',
        '',
        '- **Ultramarine**: 2 sources, affinity 0.20.',
        '',
        'Colours come from stones.',
        '',
      ].join('\n'),
    );
  });

  it('changes only where Muse changed between versions', () => {
    const v1 = { ...emptyState(MOSS), interests: new Map([[topic('Pigment'), interest('Pigment', 'emerging', 0.2, 2)]]), reflections: [reflection(1, 'One.')] };
    const v2 = { ...v1, interests: new Map([[topic('Pigment'), { ...interest('Pigment', 'emerging', 0.2, 2), salience: { value: 0.9, at } }]]) };
    expect(renderSoulSection(v2)).toBe(renderSoulSection(v1));
    const v3 = { ...v1, interests: new Map([[topic('Pigment'), interest('Pigment', 'established', 0.4, 4)]]), reflections: [reflection(1, 'One.'), reflection(2, 'Two.')] };
    const changed = renderSoulSection(v3)
      .split('\n')
      .filter((l) => !renderSoulSection(v1).split('\n').includes(l));
    expect(changed).toEqual(['Garden soul version 2.', '### Established', '- **Pigment**: 4 sources, affinity 0.40.', 'Two.']);
  });
});
