import { normalizeTags } from './tag.utils';

/** A row never gets more than this many suggested tags. */
export const MAX_SUGGESTED_TAGS = 3;

interface TagSuggestionEntry {
  index?: unknown;
  tags?: unknown;
}

/**
 * The model's tag answers, one list per input row in input order, kept only
 * where they name a tag the account already uses.
 *
 * ADR 0046's rule applied to tags: an answer outside the vocabulary is not a
 * tag, it is absent. A skipped, misindexed or garbled row answers empty.
 */
export function applyTagSuggestions(
  rowCount: number,
  parsed: unknown,
  vocabulary: readonly string[]
): string[][] {
  const known = new Set(vocabulary);
  const entries: TagSuggestionEntry[] = Array.isArray(parsed)
    ? parsed.filter((e): e is TagSuggestionEntry => !!e && typeof e === 'object')
    : [];
  const out: string[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const match = entries.find(e => e.index === i);
    const raw = Array.isArray(match?.tags)
      ? match.tags.filter((t): t is string => typeof t === 'string')
      : [];
    out.push(normalizeTags(raw).filter(t => known.has(t)).slice(0, MAX_SUGGESTED_TAGS));
  }
  return out;
}
