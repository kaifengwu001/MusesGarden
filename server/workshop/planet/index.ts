// The planet pipeline (lane G). A placeholder until its lane lands: every job fails plainly.
import type { Pipeline } from '../types';

export const planetPipeline: Pipeline = {
  kind: 'planet',
  firstStage: 'start',
  step: () => Promise.resolve({ kind: 'failed', message: 'The planet workshop isn’t built yet.' } as const),
  answer: () => ({ ok: false, error: 'The planet workshop isn’t built yet.' }),
  estimateMs: () => 60_000,
};
