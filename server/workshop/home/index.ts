// The home pipeline (lane H). A placeholder until its lane lands: every job fails plainly.
import type { Pipeline } from '../types';

export const homePipeline: Pipeline = {
  kind: 'home',
  firstStage: 'start',
  step: () => Promise.resolve({ kind: 'failed', message: 'The home workshop isn’t built yet.' } as const),
  answer: () => ({ ok: false, error: 'The home workshop isn’t built yet.' }),
  estimateMs: () => 60_000,
};
