/**
 * Ids for rows produced by an import.
 *
 * These used to be `${prefix}_${index}_${Date.now()}`, which collides: the
 * import wizard processes non-image files in a loop, so two small CSVs parsed
 * inside the same millisecond both yield `import_0_<same timestamp>`. The
 * duplicate pass keys a `Map` on the row id, so one row would silently inherit
 * the other's verdict — and any batch-level pass keyed on ids has the same
 * exposure.
 *
 * A module-level counter removes the timing dependency entirely. It only has to
 * be unique within a session, since ids identify rows in a preview that is
 * discarded once the import is confirmed; the stored transactions get their own
 * Firestore ids.
 */
let sequence = 0;

/** A row id that is unique for the lifetime of the page. */
export function nextImportRowId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

/** Resets the counter so a spec can assert on exact ids. Tests only. */
export function resetImportRowIdsForTest(): void {
  sequence = 0;
}
