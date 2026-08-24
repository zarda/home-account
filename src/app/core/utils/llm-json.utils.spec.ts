import { AI_ANSWER_INCOMPLETE } from './ai-error.utils';
import { parseModelJsonArray } from './llm-json.utils';

/** One answer row, close enough in shape to what the receipt prompts ask for. */
const row = (description: string, amount: number) =>
  `{"date":"2024-01-15","description":"${description}","amount":${amount},"receiptId":1}`;

describe('llm-json.utils', () => {
  describe('parseModelJsonArray', () => {
    it('returns a complete answer untouched', () => {
      const { rows, salvaged } = parseModelJsonArray(`[${row('Milk', 2.5)},${row('Bread', 3.1)}]`);

      expect(rows.length).toBe(2);
      expect(salvaged).toBeFalse();
    });

    it('reads an empty array as an empty answer rather than a broken one', () => {
      // The prompts say so explicitly: "If no transactions can be extracted,
      // return an empty array". Nothing to salvage is not the same as nothing
      // to read.
      expect(parseModelJsonArray('[]')).toEqual({ rows: [], salvaged: false });
    });

    it('keeps every whole row when the answer stops between rows', () => {
      const { rows, salvaged } = parseModelJsonArray(
        `[${row('Milk', 2.5)},${row('Bread', 3.1)},{"date":"2024-01-15","descri`
      );

      expect(rows).toEqual([
        { date: '2024-01-15', description: 'Milk', amount: 2.5, receiptId: 1 },
        { date: '2024-01-15', description: 'Bread', amount: 3.1, receiptId: 1 },
      ]);
      expect(salvaged).toBeTrue();
    });

    it('keeps the rows before a break inside a string', () => {
      // The case that made this necessary: receiptDetails reproduces the whole
      // receipt, so the last `}` in a cut-off answer often sits inside it and a
      // greedy bracket match hands back something worse than nothing.
      const { rows, salvaged } = parseModelJsonArray(
        `[${row('Milk', 2.5)},{"description":"Bread","receiptDetails":"Milk x1 2.50\\nBread x1 3.1`
      );

      expect(rows.length).toBe(1);
      expect(salvaged).toBeTrue();
    });

    it('keeps the rows before a break inside a number', () => {
      const { rows, salvaged } = parseModelJsonArray(
        `[${row('Milk', 2.5)},{"description":"Bread","amount":3.`
      );

      expect(rows.length).toBe(1);
      expect(salvaged).toBeTrue();
    });

    it('keeps a lone complete row that never got its closing bracket', () => {
      // No separator to prove the row ended — the closing brace is the proof.
      const { rows, salvaged } = parseModelJsonArray(`[${row('Milk', 2.5)}`);

      expect(rows.length).toBe(1);
      expect(salvaged).toBeTrue();
    });

    it('does not read a bracket inside a string as the end of the answer', () => {
      const { rows, salvaged } = parseModelJsonArray(
        '[{"description":"Rice [500g]","details":"aisle 3 ]"},{"description":"Tea'
      );

      expect(rows).toEqual([{ description: 'Rice [500g]', details: 'aisle 3 ]' }]);
      expect(salvaged).toBeTrue();
    });

    it('does not read an escaped quote as the end of a string', () => {
      const { rows } = parseModelJsonArray(
        '[{"description":"12\\" pizza, half \\\\"},{"description":"Cola'
      );

      expect(rows).toEqual([{ description: '12" pizza, half \\' }]);
    });

    it('gives up when the answer broke before its first whole row', () => {
      expect(() => parseModelJsonArray('[{"date":"2024-01-15","descri')).toThrowError(
        AI_ANSWER_INCOMPLETE
      );
    });

    it('gives up when the answer was never a list', () => {
      // A prompt-following failure rather than a truncation, but the same
      // thing from the caller's side: no rows, and no sentence worth showing.
      expect(() => parseModelJsonArray('{"merchant":"Cafe","amount":4}')).toThrowError(
        AI_ANSWER_INCOMPLETE
      );
      expect(() => parseModelJsonArray('I cannot help with that')).toThrowError(
        AI_ANSWER_INCOMPLETE
      );
    });
  });
});
