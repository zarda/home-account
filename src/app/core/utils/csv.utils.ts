/**
 * The CSV dialect the app writes and reads.
 *
 * This exists because the defect it replaces was never a wrong escaper. The old
 * `escapeCSV` was RFC 4180-correct; it was simply not called by seven of the ten
 * cells in a detailed row, so a comma in a category name or a tag shifted every
 * later column and the row re-imported as a wrong amount. Leaving each call site
 * free to remember is the bug, so the only route a cell has to the file is
 * `escapeCsvCell`, and `toCsvRow` is the only thing that calls it. A new column
 * cannot forget.
 *
 * Two rules beyond RFC 4180:
 *
 * - **Quoting** fires on `,` `"` `\n` and `\r`. The CR matters twice: a bare CR
 *   is a row terminator on the way back in, so an unquoted one inside a cell
 *   would tear the row.
 * - **Guarding.** A cell whose first character is `= + - @` tab or CR is read by
 *   Excel, Numbers and Sheets as a formula, and descriptions in this app come
 *   from parsed receipts and imported bank statements — text the app did not
 *   write. Such a cell is prefixed with an apostrophe, which those applications
 *   treat as "the rest is text". Whether they *display* the apostrophe varies by
 *   application and version, which is exactly why the importer strips it back
 *   off rather than hoping.
 *
 * Numbers are exempt from guarding. `-45.00` guarded to `'-45.00` lands in a
 * spreadsheet as text and makes `SUM()` over the Amount column return 0 —
 * breaking the most common thing anyone does with an export. Nothing that parses
 * whole as a decimal can be a payload; every real one needs a call or a DDE
 * reference. `-1+1` does not parse as a number, is a live formula, and is guarded.
 *
 * Write conservatively, read liberally: rows are written `\n`-terminated because
 * every spreadsheet reads that, and are read back with `\n`, `\r\n` or a lone
 * `\r` accepted, because foreign bank exports use all three.
 */

/** Leading characters a spreadsheet reads as the start of a formula. */
export const CSV_FORMULA_TRIGGERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

/** Prefixed to defuse such a cell; stripped again on the way back in. */
export const CSV_FORMULA_GUARD = "'";

/** Whole-cell decimal, the one shape that is never a formula. */
const NUMERIC = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function needsGuard(value: string): boolean {
  if (value === '' || NUMERIC.test(value.trim())) {
    return false;
  }
  const first = value[0];
  // The guard character guards itself, so that a description legitimately
  // beginning with an apostrophe survives the round trip.
  return first === CSV_FORMULA_GUARD || CSV_FORMULA_TRIGGERS.includes(first);
}

/**
 * Escape one cell: defuse a formula trigger, then quote per RFC 4180.
 *
 * Order matters. Quote first and the guard test sees `"` as the first character
 * and never fires.
 */
export function escapeCsvCell(value: string): string {
  const guarded = needsGuard(value) ? CSV_FORMULA_GUARD + value : value;

  if (/[,"\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Escape every cell and join them into one row. */
export function toCsvRow(values: readonly string[]): string {
  return values.map(escapeCsvCell).join(',');
}

/** A whole document: header row first, `\n` between rows, no trailing newline. */
export function toCsvText(headers: readonly string[], rows: readonly string[][]): string {
  return [toCsvRow(headers), ...rows.map(toCsvRow)].join('\n');
}

/**
 * Reverse `escapeCsvCell`'s guard.
 *
 * Conditional, never unconditional: an apostrophe is removed only when the
 * character behind it is one this module would have guarded. A cell reading
 * `'til payday` keeps its apostrophe, whether the app wrote the file or a bank did.
 */
export function unguardCsvCell(value: string): string {
  if (value[0] !== CSV_FORMULA_GUARD) {
    return value;
  }
  const next = value[1];
  if (next === CSV_FORMULA_GUARD || CSV_FORMULA_TRIGGERS.includes(next)) {
    return value.slice(1);
  }
  return value;
}

/**
 * Split a whole document into rows of raw cells.
 *
 * One pass over the entire text rather than a split on `\n` followed by a
 * per-line parse: a newline inside a quoted field is content, and splitting
 * first tore in half the very notes the escaper had correctly quoted.
 *
 * An unquoted field is trimmed, because a foreign CSV writing
 * `Date, Description, Amount` is ordinary. A quoted field is returned
 * byte-exact, because trimming it would defeat the round trip the quoting exists
 * to provide.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  let fieldQuoted = false;
  let rowQuoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(fieldQuoted ? current : current.trim());
    current = '';
    fieldQuoted = false;
  };

  const endRow = (): void => {
    endField();
    // One empty unquoted field is a blank line, not a row — matching what the
    // previous `filter(line => line.trim())` did. `""` is a real empty cell.
    if (row.length > 1 || row[0] !== '' || rowQuoted) {
      rows.push(row);
    }
    row = [];
    rowQuoted = false;
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      fieldQuoted = true;
      rowQuoted = true;
      i += 1;
      continue;
    }

    if (char === ',') {
      endField();
      i += 1;
      continue;
    }

    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    if (char === '\r') {
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    current += char;
    i += 1;
  }

  // A truncated download should import what it has, so an unterminated quote
  // flushes rather than throwing.
  if (current !== '' || row.length > 0 || rowQuoted) {
    endRow();
  }

  return rows;
}
