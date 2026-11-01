import type { Candidate, MindContext } from '../../../../src/muse/contract';
import { array, number, object, oneOf, persona, string, type Prompt } from './prompt';

export function judgePrompt(ctx: MindContext, candidates: readonly Candidate[]): Prompt {
  const finds = candidates.map(({ canonicalUrl, title, topics, summary, media }) => ({
    canonicalUrl,
    kind: media.kind,
    on: media.site ?? media.network,
    ...(media.author === undefined ? {} : { by: media.author }),
    title,
    topics,
    caption: summary,
  }));
  return {
    name: 'muse_judgments',
    effort: 'low',
    system: persona(ctx),
    user: [
      `On this walk you came across ${finds.length} real things people posted online: reels, posts, articles and videos.`,
      'Score each from 0 to 1 for how much you want to keep it. Judge it by its title and its caption.',
      '0.9 or more: I have to keep this. 0.5: pleasant, but I would move on. 0.1: nothing here for me.',
      'Let your soul, your interests and your question guide you, and let real surprise count too.',
      'For each one write one line in your own voice, at most 20 words: why you kept it, or why you passed.',
      'Return one judgment for every one and copy its canonicalUrl exactly.',
      '',
      JSON.stringify(finds, null, 2),
    ].join('\n'),
    schema: object({
      judgments: array(object({ canonicalUrl: oneOf(finds.map((p) => p.canonicalUrl)), score: number, reason: string })),
    }),
  };
}
