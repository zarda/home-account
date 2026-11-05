import { isUntitled, quotedTransactionName, transactionDisplayName } from './transaction-display.utils';
import { catalogTranslator } from '../services/testing';

describe('transaction display name', () => {
  // Marks what went through the translator, so a raw key that skipped it
  // cannot pass for a translated one.
  const t = (key: string) => `t(${key})`;

  it('names a transaction by its description, trimmed', () => {
    expect(transactionDisplayName('Cafe', t)).toBe('Cafe');
    expect(transactionDisplayName('  Cafe ', t)).toBe('Cafe');
  });

  it('names a transaction saved with no description as an untitled one', () => {
    expect(transactionDisplayName('', t)).toBe('t(transactions.untitledRow)');
  });

  it('names a description of only spaces as an untitled one', () => {
    expect(transactionDisplayName('   ', t)).toBe('t(transactions.untitledRow)');
  });

  // A sentence that quotes a description reads a wording of its own for an
  // untitled transaction, chosen by this test, so the rule is the display
  // name's own and never a second copy of it.
  describe('an untitled transaction', () => {
    it('is one whose description is empty or only white space', () => {
      expect(['', '   ', '\t\n'].map(isUntitled)).toEqual([true, true, true]);
    });

    it('is never one with a description, however it is padded', () => {
      expect(['Cafe', '  Cafe '].map(isUntitled)).toEqual([false, false]);
    });

    it("is exactly the transaction the display name gives the catalog's words for", () => {
      for (const description of ['', '   ', 'Cafe', '  Cafe ']) {
        expect(transactionDisplayName(description, t) === 't(transactions.untitledRow)')
          .withContext(JSON.stringify(description))
          .toBe(isUntitled(description));
      }
    });
  });

  // A name only tc quotes takes the description already in the reader's own
  // quotation marks, and the catalog's words for an untitled transaction
  // bare: in quotes they would read as its name. The catalogs are read
  // as literals, so a mark that crept into en or ja fails here too.
  describe('a name only some catalogs quote', () => {
    const marked = (key: string, params?: Record<string, string | number>) =>
      params ? `t(${key}:${JSON.stringify(params)})` : `t(${key})`;

    it("puts a description, trimmed, in the reader's quotation marks", () => {
      expect(quotedTransactionName('  Cafe ', marked)).toBe('t(common.quotedName:{"name":"Cafe"})');
    });

    it("gives an untitled transaction the catalog's words, never quoted", () => {
      expect(['', '   '].map(description => quotedTransactionName(description, marked)))
        .toEqual(['t(transactions.untitledRow)', 't(transactions.untitledRow)']);
    });

    it('quotes only in tc', () => {
      const read = (locale: 'en' | 'ja' | 'tc') =>
        ['Cafe', '', '   '].map(description => quotedTransactionName(description, catalogTranslator(locale, { strict: true })));

      expect(read('en')).toEqual(['Cafe', 'an untitled transaction', 'an untitled transaction']);
      expect(read('ja')).toEqual(['Cafe', '名前のない取引', '名前のない取引']);
      expect(read('tc')).toEqual(['「Cafe」', '未命名的交易', '未命名的交易']);
    });
  });
});
