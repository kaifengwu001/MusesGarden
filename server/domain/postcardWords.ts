// The words on a postcard's back as plain text, and whether two of them say the same thing: Muse keeps its latest
// in its state (recentWords) so neither the model nor the templates write the same postcard twice.
import type { PostcardWords } from '../../src/muse/contract';

/** How many of a Muse's latest postcards' words it remembers, so it doesn't repeat itself. */
export const RECENT_WORDS = 30;

/** Every piece of text on a back, joined. */
export function wordsOf(w: PostcardWords): string {
  switch (w.kind) {
    case 'line':
      return w.text;
    case 'doodle':
    case 'game':
      return w.caption;
    case 'map':
    case 'pressed':
      return w.label;
    case 'ticket':
      return w.note;
    case 'note':
      return [w.title, ...w.lines].join(' / ');
    case 'list':
      return [w.title, ...w.items.map((i) => i.text)].join(' / ');
    case 'riddle':
      return `${w.question} ${w.answer}`;
    case 'tally':
      return `${w.what} ${w.count}`;
    case 'poem':
      return w.lines.join(' / ');
  }
}

/** Words that carry no meaning of their own, left out when two postcards are compared. */
const SMALL = new Set(
  'a an the and or but of to in on at for with by from it its i me my you your we our is was are be this that so just too very all one'.split(' '),
);

function content(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1 && !SMALL.has(w)),
  );
}

/** Whether `text` says what one of `recent` already said: the same words, or most of the same words that matter. */
export function tooClose(text: string, recent: readonly string[]): boolean {
  const a = content(text);
  if (a.size === 0) return false;
  return recent.some((r) => {
    const b = content(r);
    if (b.size === 0) return false;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / Math.min(a.size, b.size) >= 0.6;
  });
}
