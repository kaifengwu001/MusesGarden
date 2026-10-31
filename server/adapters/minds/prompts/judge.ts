import type { Candidate, MindContext } from '../../../../src/muse/contract';
import { array, number, object, oneOf, persona, string, type Prompt } from './prompt';

export function judgePrompt(ctx: MindContext, candidates: readonly Candidate[]): Prompt {
  const pages = candidates.map(({ canonicalUrl, title, topics, summary }) => ({ canonicalUrl, title, topics, summary }));
  return {
    name: 'muse_judgments',
    effort: 'low',
    system: persona(ctx),
    user: [
      `On this walk you looked at ${pages.length} pages. Score each from 0 to 1 for how much you want to keep it.`,
      '0.9 or more: I have to keep this. 0.5: pleasant, but I would move on. 0.1: nothing here for me.',
      'Let your soul, your interests and your question guide you, and let real surprise count too.',
      'For each page write one line in your own voice, at most 20 words: why you kept it, or why you passed.',
      'Return one judgment for every page and copy its canonicalUrl exactly.',
      '',
      JSON.stringify(pages, null, 2),
    ].join('\n'),
    schema: object({
      judgments: array(object({ canonicalUrl: oneOf(pages.map((p) => p.canonicalUrl)), score: number, reason: string })),
    }),
  };
}
