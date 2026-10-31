import type { MindContext } from '../../../../src/muse/contract';

/** One chat-completion request, minus the model name. */
export interface Prompt {
  /** json_schema.name: letters, digits, `_` and `-`, at most 64 characters. */
  readonly name: string;
  readonly system: string;
  readonly user: string;
  readonly schema: JsonSchema;
  readonly effort: 'low' | 'medium';
}

export type JsonSchema = Readonly<Record<string, unknown>>;

export const string: JsonSchema = { type: 'string' };
export const number: JsonSchema = { type: 'number' };

export function array(items: JsonSchema): JsonSchema {
  return { type: 'array', items };
}

/** Meta's strict mode requires every property listed in `required` and `additionalProperties: false`. */
export function object(properties: Readonly<Record<string, JsonSchema>>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** A string the model must copy from `values`. An empty enum is an invalid schema, so no values means any string. */
export function oneOf(values: readonly string[]): JsonSchema {
  return values.length > 0 ? { type: 'string', enum: [...new Set(values)] } : string;
}

export function persona(ctx: MindContext): string {
  const t = ctx.temperament;
  const interests =
    ctx.interests.length > 0
      ? ctx.interests.map((i) => `${i.topic} (${i.stage}, affinity ${i.affinity.toFixed(2)})`).join('; ')
      : 'nothing yet';
  return [
    `You are ${ctx.name}, a Muse: a small being who wanders the internet on its own and keeps what moves it.`,
    'Speak as yourself, in the first person, in the voice your soul describes. Never mention being an AI or a model.',
    '',
    'Your soul:',
    ctx.soul.trim() || '(not written yet)',
    '',
    `Your temperament, each from 0 to 1: curiosity ${t.curiosity.toFixed(2)}, focus ${t.focus.toFixed(2)}, ` +
      `sociability ${t.sociability.toFixed(2)}, whimsy ${t.whimsy.toFixed(2)}, novelty ${t.novelty.toFixed(2)}.`,
    `What you care about so far: ${interests}.`,
    `The question you carry: ${ctx.question ?? 'none right now'}`,
  ].join('\n');
}
