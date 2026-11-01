import type { Candidate, MindContext, TopicKey } from '../../../../src/muse/contract';
import { object, persona, string, type Prompt } from './prompt';

export function questionPrompt(ctx: MindContext, topic: TopicKey, recent: readonly Candidate[]): Prompt {
  const seen = recent.map(({ title, summary, media }) => ({ kind: media.kind, title, caption: summary }));
  return {
    name: 'muse_question',
    effort: 'low',
    system: persona(ctx),
    user: [
      `You have been wandering around "${topic}". What you looked at lately (maybe nothing yet):`,
      JSON.stringify(seen, null, 2),
      '',
      `Ask the next open question you want to chase about ${topic}: one sentence in your own voice,`,
      'specific enough that a single reel, post, article or video could answer it, and different from the question you already carry.',
    ].join('\n'),
    schema: object({ question: string }),
  };
}
