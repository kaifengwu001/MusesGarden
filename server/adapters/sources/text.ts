const SUMMARY_MAX = 400;

/** Plain text of at most `max` characters, cut at a sentence end when one falls in the second half. */
export function clampSummary(text: string, max = SUMMARY_MAX): string {
  const flat = text
    .replace(/\(\s*[;,]?\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const stop = head.lastIndexOf('. ');
  if (stop >= max / 2) return head.slice(0, stop + 1);
  const space = head.lastIndexOf(' ', max - 1);
  return `${head.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:]+$/, '')}…`;
}

/** Matches `label` as whole words, ignoring case. */
export function wordPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** `label` appears in `text` as whole words, ignoring case. */
export function mentions(text: string, label: string): boolean {
  return wordPattern(label).test(text);
}

const WORD_CHAR = /^[\p{L}\p{N}]$/u;
const isWordChar = (ch: string | undefined) => ch !== undefined && WORD_CHAR.test(ch);

/**
 * `words` appears in `text` as whole words, both already lower-cased: what wordPattern matches, for callers that hold
 * thousands of names, since one regular expression per name compiles each to native code and exhausts V8's code space.
 */
export function hasWords(text: string, words: string): boolean {
  if (words === '') return false;
  for (let i = text.indexOf(words); i >= 0; i = text.indexOf(words, i + 1)) {
    const before = i === 0 ? undefined : String.fromCodePoint(text.codePointAt(i - (i >= 2 && /[\uDC00-\uDFFF]/.test(text[i - 1]) ? 2 : 1)) ?? 0);
    const end = i + words.length;
    const after = end < text.length ? String.fromCodePoint(text.codePointAt(end) ?? 0) : undefined;
    if (!isWordChar(before) && !isWordChar(after)) return true;
  }
  return false;
}
