// The body pipeline (lane E). A placeholder until its lane lands: every job fails plainly.
import type { Pipeline } from '../types';

export const bodyPipeline: Pipeline = {
  kind: 'body',
  firstStage: 'start',
  step: () => Promise.resolve({ kind: 'failed', message: 'The body workshop isn’t built yet.' } as const),
  answer: () => ({ ok: false, error: 'The body workshop isn’t built yet.' }),
  estimateMs: () => 60_000,
};
