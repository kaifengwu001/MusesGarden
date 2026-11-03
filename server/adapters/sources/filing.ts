// Files a recorded item under topics of the topic map by matching its words against topic names and their aliases.
import type { TopicKey } from '../../../src/muse/contract';
import type { Corpus } from './corpus';
import { hasWords } from './text';

interface Name {
  readonly topic: TopicKey;
  readonly area: string;
  readonly name: string;
  /** The name lower-cased, matched as whole words. */
  readonly lower: string;
  /** The name lower-cased without spaces or punctuation, as hashtags and photo tags write it. */
  readonly squashed: string;
}

export interface TopicIndex {
  readonly names: readonly Name[];
  /** Each area's main topic: where the recorder files an item no name matched. */
  readonly roots: ReadonlyMap<string, TopicKey>;
}

const TOPICS_MAX = 6;
/** Shorter aliases ("RBC", "Red") are too loose to file anything by. */
const ALIAS_MIN = 4;
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** A name that only says something specific: two words or more, or a long single word. */
const specific = (name: string) => /\s/.test(name) || name.length >= 9;

export function topicIndex(map: Corpus): TopicIndex {
  const names: Name[] = [];
  for (const p of map.pages) {
    const topic = p.candidate.topics[0];
    const own = topic.replace(/\s*\([^)]*\)$/, '');
    const all = new Set([own, ...p.aliases.map((a) => a.replace(/\s*\([^)]*\)$/, '')).filter((a) => a.length >= ALIAS_MIN)]);
    for (const name of all) names.push({ topic, area: p.area, name, lower: name.toLowerCase(), squashed: squash(name) });
  }
  const titles = new Set(map.pages.map((p) => p.candidate.topics[0] as string));
  const roots = new Map<string, TopicKey>();
  for (const a of map.areas) {
    const root = a.seeds.find((s) => titles.has(s));
    if (root !== undefined) roots.set(a.name, root as TopicKey);
  }
  return { names, roots };
}

/**
 * The topics an item is about, best first: names in its own area before names elsewhere, a name in the title before
 * one only in the text, longer names before shorter. Outside its area only specific names count, so a passing "blue"
 * in a bird post doesn't make it a pigment. Empty when no name matches.
 */
export function fileUnder(index: TopicIndex, area: string, item: { readonly title: string; readonly text: string; readonly tags?: readonly string[] }): TopicKey[] {
  const tags = new Set((item.tags ?? []).map(squash));
  const title = item.title.toLowerCase();
  const text = item.text.toLowerCase();
  const scored = new Map<TopicKey, number>();
  for (const n of index.names) {
    const home = n.area === area;
    if (!home && !specific(n.name)) continue;
    const inTitle = hasWords(title, n.lower);
    const hit = inTitle || hasWords(text, n.lower) || tags.has(n.squashed);
    if (!hit) continue;
    const score = (home ? 1000 : 0) + (inTitle ? 100 : 0) + Math.min(99, n.name.length);
    scored.set(n.topic, Math.max(scored.get(n.topic) ?? 0, score));
  }
  return [...scored]
    .sort(([ta, a], [tb, b]) => b - a || (ta < tb ? -1 : 1))
    .slice(0, TOPICS_MAX)
    .map(([t]) => t);
}
