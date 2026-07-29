import { firstReceiptSlot, receiptImageCount, receiptImageUrls } from './transaction.model';

describe('receiptImageCount', () => {
  it('counts the live entries of the array when there is one', () => {
    expect(receiptImageCount({ receiptUrl: 'u0', receiptUrls: ['u0', 'u1'], receiptCount: 2 })).toBe(2);
  });

  it('excludes tombstoned slots from the count', () => {
    expect(receiptImageCount({ receiptUrl: 'u0', receiptUrls: ['u0', '', 'u2'], receiptCount: 2 })).toBe(2);
    expect(receiptImageCount({ receiptUrls: ['', ''] })).toBe(0);
  });

  it('prefers the array over a drifted denormalized count', () => {
    // Every reader that has the count also has the whole document, so the
    // array is ground truth and the count is a denormalization that can lag.
    expect(receiptImageCount({ receiptUrls: ['u0'], receiptCount: 3 })).toBe(1);
  });

  it('reads the stored count when there is no array', () => {
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
    // removeReceiptAt writes the count to 0 and deletes the url in one
    // update; a reader that saw a stale url must still count nothing.
    expect(receiptImageCount({ receiptCount: 0, receiptUrl: 'u' })).toBe(0);
  });
});

describe('receiptImageUrls', () => {
  it('returns the live entries in slot order', () => {
    expect(receiptImageUrls({ receiptUrls: ['u0', '', 'u2'] })).toEqual(['u0', 'u2']);
  });

  it('wraps a legacy single-image row as one entry', () => {
    expect(receiptImageUrls({ receiptUrl: 'u' })).toEqual(['u']);
  });

  it('returns nothing for an imageless row', () => {
    expect(receiptImageUrls({})).toEqual([]);
    expect(receiptImageUrls(null)).toEqual([]);
    expect(receiptImageUrls({ receiptUrls: [] })).toEqual([]);
  });
});

describe('firstReceiptSlot', () => {
  it('skips leading tombstones', () => {
    expect(firstReceiptSlot({ receiptUrls: ['', 'u1'] })).toBe(1);
    expect(firstReceiptSlot({ receiptUrls: ['u0', 'u1'] })).toBe(0);
  });

  it('defaults to slot 0 without an array', () => {
    // A legacy row's single image lives at the bare storage key.
    expect(firstReceiptSlot({ receiptUrl: 'u' })).toBe(0);
    expect(firstReceiptSlot(null)).toBe(0);
    expect(firstReceiptSlot({ receiptUrls: [] })).toBe(0);
  });
});
