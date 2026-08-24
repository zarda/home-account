/**
 * Reading a JSON array out of a model answer that may stop mid-sentence.
 *
 * The prose equivalent is `dropIncompleteTrailingLine` in llm-text.utils.ts:
 * an answer that hit the output ceiling has a broken tail, and the useful
 * thing to do with it is to keep everything before the break. Until this
 * existed, a receipt read from several photos handed the half-array straight
 * to `JSON.parse` and the whole import died on the parser's own sentence —
 * `JSON Parse error: Expected ']'` on iOS, `Expected ',' or ']' after array
 * element` on Chrome (#331).
 *
 * Deliberately not a JSON repairer. It closes the array after the last
 * element that arrived whole and nothing else: no quote balancing, no
 * inventing the missing half of a row. A row that was cut in the middle is a
 * row nobody can vouch for.
 */
import { AI_ANSWER_INCOMPLETE } from './ai-error.utils';

/** Rows read out of a model answer, and whether the tail had to be dropped. */
export interface ParsedModelArray {
  rows: unknown[];
  /** True when the answer was cut short and only its complete rows survived. */
  salvaged: boolean;
}

/**
 * The offset just past the last top-level element that arrived whole, or -1
 * when none did.
 *
 * Same string/escape/depth bookkeeping as `extractJsonStrict` in
 * gemini.service.ts, which counts brackets to find where a payload ends. The
 * question here is the other one — where it last was *valid* — so the walk
 * remembers every point at which a top-level element closed rather than
 * stopping at the first balanced bracket.
 */
function lastCompleteElementEnd(payload: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  let cut = -1;

  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      // Back to the outer array means the element that just closed is whole.
      if (depth === 1) cut = i + 1;
    } else if (ch === ',' && depth === 1) {
      // A separator proves the element before it ended, which is the only
      // evidence a scalar element ever leaves.
      cut = i;
    }
  }

  return cut;
}

/**
 * Read a model's JSON array, keeping what survived if it was cut short.
 *
 * Throws `AI_ANSWER_INCOMPLETE` when nothing usable can be read — the answer
 * broke before its first complete row, or was never a list at all. Both reach
 * the user as one classified, translated failure rather than as whatever the
 * JSON parser happened to say.
 */
export function parseModelJsonArray(payload: string): ParsedModelArray {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      return { rows: parsed, salvaged: false };
    }
  } catch {
    // Fall through to salvage: a SyntaxError here is the case this exists for.
  }

  const cut = lastCompleteElementEnd(payload);
  if (cut > 0) {
    try {
      const salvagedRows: unknown = JSON.parse(`${payload.slice(0, cut)}]`);
      if (Array.isArray(salvagedRows) && salvagedRows.length > 0) {
        return { rows: salvagedRows, salvaged: true };
      }
    } catch {
      // Nothing to keep; the throw below is the answer.
    }
  }

  throw new Error(AI_ANSWER_INCOMPLETE);
}
