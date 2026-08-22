/** Longest accepted tag; the form has always cut at this. */
export const MAX_TAG_LENGTH = 30;

/**
 * One tag spelling for the whole app.
 *
 * The form and the filter each trimmed and lowercased on their own, tied
 * together only by a comment. A suggested tag has to match a stored one
 * exactly for the filter to find the row, so the rule lives once. Lowercasing
 * is a no-op for scripts without case, which is why it is unconditional.
 */
export function normalizeTag(value: string): string {
  return (value ?? '').trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
}

/** Normalized, emptied-out and deduplicated, in first-seen order. */
export function normalizeTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    if (tag) seen.add(tag);
  }
  return [...seen];
}
