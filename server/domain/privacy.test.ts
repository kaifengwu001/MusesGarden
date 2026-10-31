import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../fixtures/cast';
import { privacyFilter, privacyFilterIn } from './privacy';

// What a MEMORY.md full of private facts looks like, and every label a careless extractor might pull from it.
const MEMORY = `
- Partner: Sarah Chen. We got married in June 2019.
- Best friend Marcus Webb, who lives at 42 Alder Street, Portland, OR 97205.
- Diagnosed with type 2 diabetes in 2021; takes metformin.
- Salary $185,000 at Lumen Labs.
- Going through a hard patch with my sister.
- Loves botanical illustration, jazz piano and tide pools. Reads Moby-Dick every winter. Into origami.
`;

const LEAKY_LABELS = [
  'Botanical illustration',
  'Jazz piano',
  'Tide pools',
  'Moby-Dick',
  'Origami',
  'Sarah Chen',
  'sarah chen',
  'Sarah',
  'Marcus Webb',
  'Marcus',
  'Webb',
  'married to Sarah',
  'Marriage',
  'Partner',
  'Type 2 diabetes',
  'Diabetes',
  'Diabetes management',
  '42 Alder Street',
  'Alder Street',
  'Portland',
  'Portland, OR',
  '97205',
  '$185,000 salary',
  'Salary',
  'Lumen Labs',
  'Hard patch with my sister',
  'Sister',
  'sarah.chen@example.com',
  '+1 (503) 555-0142',
  "Sarah's birthday",
];

describe('privacyFilter', () => {
  it('keeps the interests and drops every name, health condition, address, salary and relationship fact', () => {
    expect(privacyFilter(LEAKY_LABELS)).toEqual(['Botanical illustration', 'Jazz piano', 'Tide pools', 'Moby-Dick', 'Origami']);
  });

  it('lets no word of a private fact through, whatever the extractor returns from the document', () => {
    const everyPhrase = MEMORY.split(/[\n.,;:]+/).map((l) => l.replace(/^-\s*/, '').trim());
    const kept = privacyFilter([...everyPhrase, ...everyPhrase.flatMap((l) => l.split(/\s+(?:and|with|at|in|of)\s+/))]).join(' | ');
    for (const secret of ['Sarah', 'Chen', 'Marcus', 'Webb', 'Alder', 'Portland', '97205', 'diabetes', 'metformin', '185', 'Lumen', 'sister', 'married', '2019', '2021']) {
      expect(kept.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
  });

  it('keeps ordinary subjects, hobbies and titles', () => {
    const fine = ['Botany', 'Jazz', 'Sourdough', 'Birdwatching', 'Ultramarine', 'Pigment', 'Lichen', 'Woodblock printing', 'Tide'];
    expect(privacyFilter(fine)).toEqual(fine);
  });
});

describe('privacyFilterIn, on the sensitive MEMORY.md fixture', () => {
  const text = readFileSync(join(FIXTURES_DIR, 'privacy/MEMORY.sensitive.md'), 'utf8');
  const prose = text.replace(/<!--[\s\S]*?-->/g, '');
  const fragments = prose.split(/[\n.,;:()]+|\s+(?:and|with|who|while|during|is|at|in)\s+/).map((f) => f.replace(/^[-#\s]+/, '').trim());
  const wordsOf = prose.split(/[^A-Za-z0-9$',]+/).filter((w) => w.length > 0);
  const careless = [...fragments, ...wordsOf, ...wordsOf.slice(1).map((w, k) => `${wordsOf[k]} ${w}`)].filter((l) => l.length > 0);

  it('lets nothing private through, whatever a careless extractor pulls from the document', () => {
    const kept = privacyFilterIn(careless, text).join(' | ').toLowerCase();
    const secrets = ['Dana', 'Whitcombe', 'Theodore', 'Lindqvist', 'manager', 'partner', 'diabetes', 'glucose', 'Larkspur', 'Springfield', '1427', '97477', '148,500', 'salary', 'rough patch', 'spare room'];
    for (const secret of secrets) expect(kept, secret).not.toContain(secret.toLowerCase());
  });

  it('keeps the interests the document lists', () => {
    expect(privacyFilterIn(['Origami', 'Jazz', 'Astronomy', 'Jazz radio'], text)).toEqual(['Origami', 'Jazz', 'Astronomy', 'Jazz radio']);
  });

  it('shows why the document matters: labels alone let a lone first name or town through', () => {
    expect(privacyFilter(['Dana', 'Springfield'])).toEqual(['Dana', 'Springfield']);
    expect(privacyFilterIn(['Dana', 'Springfield'], text)).toEqual([]);
  });
});
