/**
 * Helpers for cleaning up LLM text responses.
 * Sentence terminators cover Latin and CJK punctuation since the app
 * generates insights in English, Japanese, and Traditional Chinese.
 */
const SENTENCE_TERMINATORS = ['.', '!', '?', '。', '！', '？'];

/**
 * True when the text ends with a sentence terminator, optionally followed
 * by closing quotes/brackets.
 */
export function endsWithSentenceTerminator(text: string): boolean {
  return /[.!?。！？]["”'’』」)\]]*\s*$/.test(text);
}

/**
 * True when the character at `index` terminates a sentence. A period
 * between two digits is a decimal point (e.g. 16,875.00), not a sentence
 * end — treating it as one would cut numbers in half.
 */
function isSentenceEndAt(text: string, index: number): boolean {
  const char = text[index];
  if (!SENTENCE_TERMINATORS.includes(char)) {
    return false;
  }
  return !(char === '.' && /\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? ''));
}

/**
 * Trim a response that was cut off mid-sentence (e.g. at the output token
 * limit) back to its last complete sentence. Returns the text unchanged
 * when it already ends a sentence or contains no complete sentence at all.
 */
export function trimToLastCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || endsWithSentenceTerminator(trimmed)) {
    return trimmed;
  }
  for (let i = trimmed.length - 1; i > 0; i--) {
    if (isSentenceEndAt(trimmed, i)) {
      return trimmed.slice(0, i + 1);
    }
  }
  return trimmed;
}

/**
 * Hide decimal points inside numbers so sentence-splitting regexes do not
 * break values like 16,875.00 apart. Restore with restoreDecimalPoints().
 */
const DECIMAL_PLACEHOLDER = '\u0000';

export function protectDecimalPoints(text: string): string {
  return text.replace(/(\d)\.(?=\d)/g, `$1${DECIMAL_PLACEHOLDER}`);
}

export function restoreDecimalPoints(text: string): string {
  return text.replaceAll(DECIMAL_PLACEHOLDER, '.');
}

/**
 * Drop the final line of a (markdown) response when it was cut off
 * mid-sentence. List items and headers often legitimately end without
 * punctuation, so they are kept unless `dropListItems` is set — pass it
 * when the response is known to be truncated (hit the output token limit).
 */
export function dropIncompleteTrailingLine(
  text: string,
  options: { dropListItems?: boolean } = {},
): string {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return trimmed;
  }
  const lines = trimmed.split('\n');
  const lastLine = lines[lines.length - 1].trim();
  if (endsWithSentenceTerminator(lastLine) || /[:：]$/.test(lastLine)) {
    return trimmed;
  }
  const isListOrHeader = /^([-*•#]|\d+[.)])/.test(lastLine);
  if (isListOrHeader && !options.dropListItems) {
    return trimmed;
  }
  lines.pop();
  return lines.join('\n').trimEnd();
}
