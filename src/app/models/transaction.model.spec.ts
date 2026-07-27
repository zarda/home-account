import { receiptImageCount } from './transaction.model';

describe('receiptImageCount', () => {
  it('reads the stored count when there is one', () => {
    expect(receiptImageCount({ receiptCount: 3, receiptUrl: 'u' })).toBe(3);
    expect(receiptImageCount({ receiptCount: 0 })).toBe(0);
  });

  it('treats a row with an image but no count as holding one', () => {
    // Rows written before receiptCount existed. Reading them as zero would
    // let the quota be exceeded and would charge a second slot to replace an
    // image that was already stored.
    expect(receiptImageCount({ receiptUrl: 'https://example.test/r.jpg' })).toBe(1);
  });

  it('treats a row with neither as empty', () => {
    expect(receiptImageCount({})).toBe(0);
    expect(receiptImageCount(null)).toBe(0);
    expect(receiptImageCount(undefined)).toBe(0);
  });

  it('prefers an explicit zero over the presence of a url', () => {
    // removeReceipt writes the count to 0 and deletes the url in one update;
    // a reader that saw a stale url must still count nothing.
    expect(receiptImageCount({ receiptCount: 0, receiptUrl: 'u' })).toBe(0);
  });
});
