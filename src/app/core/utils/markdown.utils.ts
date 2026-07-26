/**
 * The pure half of rendering model-written markdown.
 *
 * Extracted from AiSummaryComponent so the insights narrative does not carry a
 * second copy of the XSS pre-check. Two copies of a security check is how one of
 * them rots — the one nobody remembers to update.
 *
 * Deliberately string-in, string-out: the DomSanitizer call stays in each
 * component, because trusting HTML is a decision that belongs where the value is
 * rendered, not in a shared helper that could be called from anywhere.
 */

/**
 * Patterns that mean the text should be sanitised rather than trusted.
 *
 * A model should never emit any of these, so a hit means either a prompt
 * injection carried through from transaction text or a provider behaving
 * unexpectedly. Either way the output stops being trusted markdown.
 */
const XSS_PATTERNS: readonly RegExp[] = [
  /<script/i,
  /on\w+\s*=/i, // onclick=, onerror=, and friends
  /javascript:/i,
  /<iframe/i,
  /<embed/i,
  /<object/i,
];

export function containsPotentialXSS(text: string): boolean {
  return XSS_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * The small markdown subset the models are asked for: headings, bold, italic,
 * bullet lists and paragraphs.
 *
 * The caller must check `containsPotentialXSS` first and sanitise instead of
 * trusting the result — this function does no escaping of its own.
 */
export function markdownToHtml(markdown: string): string {
  let html = markdown;

  html = html.replace(/^### (.*?)$/gm, '<h3 class="markdown-h3">$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2 class="markdown-h2">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 class="markdown-h1">$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (line.trim().startsWith('- ')) {
      if (!inList) {
        processed.push('<ul class="markdown-list">');
        inList = true;
      }
      processed.push(`<li>${line.trim().substring(2)}</li>`);
    } else {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      if (line.trim()) {
        processed.push(`<p>${line}</p>`);
      }
    }
  }

  if (inList) {
    processed.push('</ul>');
  }

  return processed.join('');
}
