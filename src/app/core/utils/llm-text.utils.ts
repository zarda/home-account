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
 * Trim a response that was cut off mid-sentence (e.g. at the output token
 * limit) back to its last complete sentence. Returns the text unchanged
 * when it already ends a sentence or contains no complete sentence at all.
 */
export function trimToLastCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || endsWithSentenceTerminator(trimmed)) {
    return trimmed;
  }
  const lastEnd = Math.max(...SENTENCE_TERMINATORS.map(p => trimmed.lastIndexOf(p)));
  return lastEnd > 0 ? trimmed.slice(0, lastEnd + 1) : trimmed;
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
