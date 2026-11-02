import { transactionDisplayName } from './transaction-display.utils';

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
});
