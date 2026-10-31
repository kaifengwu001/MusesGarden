import type { Discovery, Interest, MuseState, PublicDiscovery, PublicProfile, TopicKey } from '../../../src/muse/contract';
import { SOCIAL } from './constants';

// Owner- and soul-seeded interests reveal the owner, so they stay private until Muse has made them its own.
function isPublicInterest(s: MuseState, i: Interest): boolean {
  if (s.hidden.has(`topic:${i.topic}`)) return false;
  return i.seededBy === 'muse' ? i.sources.length >= 1 : i.stage === 'established';
}

function weight(s: MuseState, i: Interest): number {
  const salience = i.salience.value * Math.exp(-Math.max(0, s.at - i.salience.at) / SOCIAL.salienceTauMs);
  const w = SOCIAL.weightFloor + SOCIAL.weightAffinity * i.affinity + SOCIAL.weightSalience * salience;
  return Math.min(1, Math.max(0, w));
}

function isPublicFind(s: MuseState, d: Discovery, publicTopics: ReadonlySet<TopicKey>): boolean {
  if (d.provenance !== 'own' || s.hidden.has(`discovery:${d.id}`)) return false;
  let touches = false;
  for (const i of s.interests.values()) {
    if (!i.sources.includes(d.canonicalUrl) && !d.topics.includes(i.topic)) continue;
    if (!publicTopics.has(i.topic)) return false;
    touches = true;
  }
  return touches;
}

function toPublic(d: Discovery): PublicDiscovery {
  const { id, url, canonicalUrl, title, summary, thumb, topics } = d;
  return thumb === undefined ? { id, url, canonicalUrl, title, summary, topics } : { id, url, canonicalUrl, title, summary, thumb, topics };
}

export function publicProfile(s: MuseState): PublicProfile {
  const interests = [...s.interests.values()]
    .filter((i) => isPublicInterest(s, i))
    .map((i) => ({ topic: i.topic, weight: weight(s, i) }))
    .sort((a, b) => b.weight - a.weight || compare(a.topic, b.topic));
  const publicTopics = new Set(interests.map((i) => i.topic));
  const discoveries = [...s.discoveries.values()]
    .filter((d) => isPublicFind(s, d, publicTopics))
    .sort((a, b) => b.at - a.at || compare(a.id, b.id))
    .map(toPublic);
  return { museId: s.seed.id, name: s.seed.name, worldSeed: s.seed.worldSeed, interests, discoveries };
}

export function similarity(a: PublicProfile, b: PublicProfile): number {
  const wb = new Map(b.interests.map((i) => [i.topic, i.weight]));
  let dot = 0;
  for (const i of a.interests) dot += i.weight * (wb.get(i.topic) ?? 0);
  const norm = (p: PublicProfile) => Math.hypot(...p.interests.map((i) => i.weight));
  const denominator = norm(a) * norm(b);
  return denominator > 0 ? dot / denominator : 0;
}

export function overlap(a: PublicProfile, b: PublicProfile): number {
  const tb = new Set(b.interests.map((i) => i.topic));
  const shared = a.interests.filter((i) => tb.has(i.topic)).length;
  const union = a.interests.length + b.interests.length - shared;
  return union > 0 ? shared / union : 0;
}

export function findOverlap(find: PublicDiscovery, receiver: PublicProfile): number {
  if (find.topics.length === 0) return 0;
  const tr = new Set(receiver.interests.map((i) => i.topic));
  return find.topics.filter((t) => tr.has(t)).length / find.topics.length;
}

export function stretch(x: number): number {
  return 4 * x * (1 - x);
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
