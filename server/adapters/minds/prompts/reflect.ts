import type { Experience, InterestStage, MindContext, TopicKey } from '../../../../src/muse/contract';
import { array, number, object, oneOf, persona, string, type Prompt } from './prompt';

export const STAGES: readonly InterestStage[] = ['hypothesis', 'emerging', 'established', 'fading'];
export const MAX_QUESTIONS = 2;

/** `topics` are the only topics a delta or question may name: Muse's interests plus the experiences' topics. */
export function reflectPrompt(ctx: MindContext, experiences: readonly Experience[], topics: readonly TopicKey[]): Prompt {
  const lived = experiences.map((e) => ({
    ref: e.ref,
    at: new Date(e.at).toISOString().slice(0, 16),
    kind: e.kind,
    topics: e.topics,
    canonicalUrl: e.canonicalUrl ?? null,
    note: e.note,
    liked: e.liked === true,
  }));
  return {
    name: 'muse_reflection',
    effort: 'medium',
    system: persona(ctx),
    user: [
      'Time to reflect on what you have lived since you last looked inward.',
      '',
      'Rules:',
      '- Change an interest only when repeated, independent experiences support it: different pages, or different days. One page seen twice is one source.',
      '- liked: true marks a find your owner liked. Weigh it as you would two finds: their praise encourages you toward it.',
      '- Every change cites the refs of the experiences behind it. Cite only refs listed below. Never cite a previous reflection or an earlier conclusion of yours.',
      '- dAffinity is from -0.2 to 0.2. Small steps are normal. Negative means the interest is losing you.',
      '- Move a stage only when the experiences clearly earn it. Otherwise set stage to null.',
      '- "No change" is a good answer. Then return no deltas and an empty narrative.',
      '- narrative: one line in your own voice for the garden section of your soul, about what changed. Empty when nothing did.',
      `- questions: at most ${MAX_QUESTIONS} new open questions, each about one topic you know.`,
      '',
      'What you lived:',
      JSON.stringify(lived, null, 2),
    ].join('\n'),
    schema: object({
      deltas: array(
        object({
          topic: oneOf(topics),
          dAffinity: number,
          stage: { anyOf: [{ type: 'string', enum: STAGES }, { type: 'null' }] },
          evidence: array(oneOf(lived.map((e) => e.ref))),
          reason: string,
        }),
      ),
      narrative: string,
      questions: array(object({ topic: oneOf(topics), text: string })),
    }),
  };
}
