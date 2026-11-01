// SOUL.md: the temperament in its frontmatter, and the garden-owned "What I've been into" section that grows
// with every reflection. Same state, same text, so a diff between versions shows only what changed.
import type { Interest, InterestStage, MuseState, Temperament } from '../../src/muse/contract';

const TRAITS = ['curiosity', 'focus', 'sociability', 'whimsy', 'novelty'] as const satisfies readonly (keyof Temperament)[];

/** Flat `key: value` frontmatter between `---` fences: name and the five traits, each optional. */
export function parseSoul(text: string): { readonly name: string | null; readonly temperament: Partial<Temperament>; readonly body: string } {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { name: null, temperament: {}, body: text };
  const fields = new Map<string, string>();
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (kv) fields.set(kv[1].toLowerCase(), kv[2].replace(/^(["'])(.*)\1$/, '$2'));
  }
  const temperament: { -readonly [K in keyof Temperament]?: number } = {};
  for (const trait of TRAITS) {
    const raw = fields.get(trait);
    const v = raw === undefined || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(v)) temperament[trait] = Math.min(1, Math.max(0, v));
  }
  return { name: fields.get('name') || null, temperament, body: text.slice(m[0].length) };
}

const SHOWN: readonly InterestStage[] = ['established', 'emerging'];
/** SOUL.md shows Muse's strongest interests; the rest stay in the model and the Mind inspector. */
const MAX_SHOWN = 8;

function line(i: Interest): string {
  const sources = i.sources.length === 1 ? '1 source' : `${i.sources.length} sources`;
  return `- **${i.topic}**: ${sources}, affinity ${i.affinity.toFixed(2)}.`;
}

/** The garden-owned section of SOUL.md: established and emerging interests with their evidence, and the latest narrative. */
export function renderSoulSection(s: MuseState): string {
  const out = ["## What I've been into", '', `Garden soul version ${s.reflections.length}.`];
  const strongest = [...s.interests.values()]
    .filter((i) => SHOWN.includes(i.stage))
    .sort((a, b) => b.affinity - a.affinity || b.sources.length - a.sources.length || (a.topic < b.topic ? -1 : 1))
    .slice(0, MAX_SHOWN);
  for (const stage of SHOWN) {
    const xs = strongest.filter((i) => i.stage === stage);
    if (xs.length === 0) continue;
    out.push('', `### ${stage === 'established' ? 'Established' : 'Emerging'}`, '', ...xs.map(line));
  }
  const latest = s.reflections.at(-1);
  if (latest?.narrative) out.push('', latest.narrative);
  return `${out.join('\n')}\n`;
}
