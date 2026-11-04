// The mind the garden's rules see in a real Muse: it decides nothing. The Muse itself judges, asks, reflects and
// writes through its connector (server/agent), so the rules' trips only move its body, keep nothing and wonder
// nothing, and its postcards wait for its own words (the engine never asks this mind to write them).
import type {
  Candidate,
  Judgment,
  Mind,
  MindContext,
  PostcardAsk,
  PostcardWords,
  ReflectionProposal,
  Temperament,
  TopicKey,
} from '../../../src/muse/contract';

const NOTHING: ReflectionProposal = { deltas: [], narrative: '', questions: [] };
const NEUTRAL: Temperament = { curiosity: 0.5, focus: 0.5, sociability: 0.5, whimsy: 0.5, novelty: 0.5 };

export class AgentMind implements Mind {
  /** Every candidate scores 0, under every keep threshold: a rules trip keeps nothing for a real Muse. */
  judge(_ctx: MindContext, candidates: readonly Candidate[]): Promise<Judgment[]> {
    return Promise.resolve(candidates.map((c) => ({ canonicalUrl: c.canonicalUrl, score: 0, reason: '' })));
  }

  /** Never asked: a rules trip keeps nothing, so it has nothing to wonder about. */
  proposeQuestion(_ctx: MindContext, _topic: TopicKey, _recent: readonly Candidate[]): Promise<string> {
    return Promise.resolve('');
  }

  reflect(): Promise<ReflectionProposal> {
    return Promise.resolve(NOTHING);
  }

  /** Muse picks its own interests (AgentSoul); nothing is read out of its text. */
  extractInterests(): Promise<string[]> {
    return Promise.resolve([]);
  }

  /** Its soul always carries all five traits, so this is only a floor for a soul that somehow didn't. */
  estimateTemperament(): Promise<Temperament> {
    return Promise.resolve(NEUTRAL);
  }

  writePostcard(_ctx: MindContext, _ask: PostcardAsk): Promise<PostcardWords> {
    return Promise.reject(new Error('a real Muse writes its own postcards (agentPostcardBack)'));
  }
}
