// Typo-tolerant matching for transaction search.
//
// Hand-rolled rather than a library (Fuse.js & co.): the evaluated set is a
// bounded window of at most ~100 rows, the code path only runs after an exact
// substring pass found nothing, and skipping the dependency keeps the offline
// PWA bundle untouched. At this scale the O(rows x tokens x words x length^2)
// worst case is far below a millisecond.

// Edits allowed for a query token: none for short tokens (a 1-2 edit budget
// on a 3-character token matches nearly everything), one for medium, two for
// long merchant-name-sized tokens.
export function editTolerance(tokenLength: number): number {
  if (tokenLength < 4) return 0;
  if (tokenLength < 7) return 1;
  return 2;
}

// Levenshtein distance between a and b, except that any distance provably
// greater than max is reported as max + 1 (callers only compare against max).
// Two-row dynamic programming with an early exit once a full row exceeds max.
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > max) return max + 1;
    [previous, current] = [current, previous];
  }

  return Math.min(previous[b.length], max + 1);
}

// Splits on anything that is not a letter or digit; CJK text has no spaces
// and stays intact as one "word", which the substring branch handles.
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

// A query token matches when it appears as a substring of the text, or lies
// within its edit tolerance of a word of the text — or of that word's prefix
// of the token's length, so a typo inside a longer word still hits.
export function fuzzyTokenMatches(token: string, text: string): boolean {
  const needle = token.toLowerCase();
  const haystack = text.toLowerCase();
  if (haystack.includes(needle)) return true;

  const tolerance = editTolerance(needle.length);
  if (tolerance === 0) return false;

  for (const word of haystack.split(WORD_SEPARATOR)) {
    if (!word) continue;
    if (boundedLevenshtein(needle, word, tolerance) <= tolerance) return true;
    if (
      word.length > needle.length &&
      boundedLevenshtein(needle, word.slice(0, needle.length), tolerance) <= tolerance
    ) {
      return true;
    }
  }
  return false;
}

// Every whitespace-separated token of the query must match somewhere in the
// text. An empty query matches vacuously; callers guard the minimum length.
export function fuzzyQueryMatches(query: string, text: string): boolean {
  return query
    .split(/\s+/)
    .filter(token => token.length > 0)
    .every(token => fuzzyTokenMatches(token, text));
}
