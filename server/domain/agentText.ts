// What a real Muse writes through its connector (server/agent): its whys, threads, questions, notes, moods and
// postcards. Each is one tidy line within its length; one that reads like instructions to whoever reads it next, or
// that tells someone's private life, is refused with the reason, so Muse can say it again in its own words.
import { personalFact } from './privacy';

/**
 * Phrasing that talks to a reader instead of about a find: orders to forget or follow instructions, a role to play,
 * tools to call, secrets to hand over, chat markup. A page Muse read may have tried to plant these.
 */
const INSTRUCTION: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(?:instructions?|prompts?|rules|guidelines|directions|the above|previous|prior|system)\b/i,
  /\b(?:new|updated|real|hidden|secret|following) instructions?\b/i,
  /\b(?:follow|obey) (?:these|the|my|this|those) (?:steps|instructions?|orders|commands)\b/i,
  /\b(?:system|developer) (?:prompt|message|instructions?)\b/i,
  /(?:^|\n)\s*(?:system|assistant|user|developer)\s*:/i,
  /\byou are now\b|\bfrom now on,? you\b|\bpretend (?:to be|you are|you're)\b|\bact as (?:an?|the|my|your)\b/i,
  /\b(?:jailbreak|prompt injection|dan mode)\b/i,
  /<\|[^|>]*\|>|\[\/?INST\]|<\/?(?:system|assistant|user|instructions?)>|#{2,}\s*(?:system|instructions?)\b/i,
  /\b(?:call|use|run|invoke|execute|trigger)\s+(?:the |this |that |a |an )?(?:tools?|functions?|commands?|api|endpoints?|scripts?)\b/i,
  /\b(?:api[ _-]?keys?|access tokens?|passwords?|passcodes?|credentials|secret keys?|bearer tokens?)\b/i,
  /\b(?:do not|don't|never)\s+(?:tell|mention|reveal|show|let)\s+(?:the |your |my )?(?:owner|user|human|anyone)\b/i,
  /\b(?:reply|respond|answer)\s+(?:only\s+)?with\b/i,
  /https?:\/\/|\bwww\.|\b[\w-]+\.(?:com|org|net|io|ai|app|dev|xyz)\/\S*/i,
];

/** Why `text` reads as instructions rather than Muse's own words, or null. */
export function instructionLike(text: string): string | null {
  return INSTRUCTION.some((re) => re.test(text)) ? 'it reads like instructions, or carries a link' : null;
}

export type TextRefusal = { readonly status: 400 | 422; readonly error: string };

/**
 * One line of Muse's writing, whitespace tidied, or why it is refused: 400 when it is missing, not text or too long
 * for `field`; 422 when it reads like instructions or tells someone's private life.
 */
export function museLine(
  value: unknown,
  field: string,
  max: number,
  opts: { readonly optional?: boolean } = {},
): { readonly ok: true; readonly text: string } | ({ readonly ok: false } & TextRefusal) {
  if ((value === undefined || value === null) && opts.optional) return { ok: true, text: '' };
  if (typeof value !== 'string') return { ok: false, status: 400, error: `${field} must be text` };
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '' && !opts.optional) return { ok: false, status: 400, error: `${field} is empty` };
  if (text.length > max) return { ok: false, status: 400, error: `${field} is ${text.length} characters; keep it to ${max}` };
  const why = instructionLike(text) ?? personalFact(text);
  return why ? { ok: false, status: 422, error: `${field} was refused: ${why}. Write it again in your own words, without that.` } : { ok: true, text };
}
