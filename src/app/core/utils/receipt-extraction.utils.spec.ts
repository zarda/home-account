import {
  printedLocationSlot,
  readConfidence,
  readCurrencyCode,
  readFieldConfidence,
  readPrintedLocation,
  readReceiptTotal,
} from './receipt-extraction.utils';

describe('readCurrencyCode', () => {
  it('accepts a code the ISO table knows', () => {
    expect(readCurrencyCode('KRW')).toBe('KRW');
    expect(readCurrencyCode('USD')).toBe('USD');
  });

  it('accepts a currency nobody added to the app by hand', () => {
    // The point of validating against the runtime's table rather than a list
    // kept in the repo: a receipt from somewhere unanticipated still reads.
    expect(readCurrencyCode('PLN')).toBe('PLN');
    expect(readCurrencyCode('BRL')).toBe('BRL');
  });

  it('normalizes case and surrounding space', () => {
    expect(readCurrencyCode(' krw ')).toBe('KRW');
  });

  it('rejects a word or a symbol the model wrote instead of a code', () => {
    expect(readCurrencyCode('Won')).toBe('');
    expect(readCurrencyCode('₩')).toBe('');
    expect(readCurrencyCode('dollars')).toBe('');
  });

  it('rejects a three-letter string that is not a currency', () => {
    expect(readCurrencyCode('ABC')).toBe('');
  });

  it('reports nothing rather than guessing when the model said nothing', () => {
    // Empty is load-bearing: the caller substitutes the account's own base
    // currency, which beats any constant this layer could pick.
    expect(readCurrencyCode('')).toBe('');
    expect(readCurrencyCode(undefined)).toBe('');
    expect(readCurrencyCode(null)).toBe('');
    expect(readCurrencyCode(42)).toBe('');
  });
});

describe('readReceiptTotal', () => {
  it('passes a positive number through', () => expect(readReceiptTotal(16.2)).toBe(16.2));
  it('coerces a numeric string', () => expect(readReceiptTotal('16.2')).toBe(16.2));
  it('takes the magnitude of a negative report', () => expect(readReceiptTotal(-16.2)).toBe(16.2));
  it('rejects zero, garbage and absence', () => {
    expect(readReceiptTotal(0)).toBeUndefined();
    expect(readReceiptTotal('n/a')).toBeUndefined();
    expect(readReceiptTotal(undefined)).toBeUndefined();
    expect(readReceiptTotal(null)).toBeUndefined();
    expect(readReceiptTotal('')).toBeUndefined();
  });

  it('rejects types that Number() would silently coerce', () => {
    expect(readReceiptTotal(true)).toBeUndefined();
    expect(readReceiptTotal([16.2])).toBeUndefined();
  });
});

describe('readConfidence', () => {
  it('keeps a reported confidence', () => {
    expect(readConfidence(0.85)).toBe(0.85);
  });

  it('keeps zero, which is a real answer and not an absence', () => {
    expect(readConfidence(0)).toBe(0);
  });

  it('accepts a numeric string', () => {
    expect(readConfidence('0.4')).toBe(0.4);
  });

  it('clamps a model that answered outside the range', () => {
    expect(readConfidence(1.4)).toBe(1);
    expect(readConfidence(-2)).toBe(0);
  });

  it('returns undefined when nothing usable was reported', () => {
    expect(readConfidence(undefined)).toBeUndefined();
    expect(readConfidence(null)).toBeUndefined();
    expect(readConfidence('')).toBeUndefined();
    expect(readConfidence('very sure')).toBeUndefined();
    expect(readConfidence(NaN)).toBeUndefined();
  });
});

describe('readFieldConfidence', () => {
  it('carries both confidences when both were reported', () => {
    expect(readFieldConfidence({ amountConfidence: 0.9, dateConfidence: 0.5 }))
      .toEqual({ amount: 0.9, date: 0.5 });
  });

  it('carries whichever one was reported', () => {
    expect(readFieldConfidence({ amountConfidence: 0.3 })).toEqual({ amount: 0.3 });
    expect(readFieldConfidence({ dateConfidence: 0.3 })).toEqual({ date: 0.3 });
  });

  it('is undefined when neither was reported, so a source that cannot know stays distinguishable', () => {
    expect(readFieldConfidence({})).toBeUndefined();
    expect(readFieldConfidence({ amountConfidence: 'nope' })).toBeUndefined();
  });

  it('keeps a reported zero rather than dropping the field', () => {
    expect(readFieldConfidence({ amountConfidence: 0 })).toEqual({ amount: 0 });
  });
});

describe('readPrintedLocation', () => {
  it('keeps a printed address, whitespace collapsed', () => {
    expect(readPrintedLocation(' 渋谷店\n東京都渋谷区 1-2-3 ', 'Tully\'s')).toBe('渋谷店 東京都渋谷区 1-2-3');
  });

  it('reads nothing from an empty, missing or non-string value', () => {
    expect(readPrintedLocation('', 'X')).toBeUndefined();
    expect(readPrintedLocation(undefined, 'X')).toBeUndefined();
    expect(readPrintedLocation({ name: 'Y' }, 'X')).toBeUndefined();
  });

  it('drops a value that is only the merchant name — a name is not a place', () => {
    expect(readPrintedLocation('Starbucks', 'STARBUCKS ')).toBeUndefined();
  });

  it('recognizes the echo however either side was spaced', () => {
    // The value is collapsed before the comparison, so the merchant has to be
    // too — otherwise a name printed with padded spacing slips past the guard.
    expect(readPrintedLocation('Cafe Tokyo', '  Cafe   Tokyo ')).toBeUndefined();
  });

  it('drops a value too long to be an address', () => {
    expect(readPrintedLocation('x'.repeat(121), 'X')).toBeUndefined();
  });
});

describe('printedLocationSlot', () => {
  it('wraps a name into the location slot and is empty otherwise', () => {
    expect(printedLocationSlot('Shibuya')).toEqual({ location: { name: 'Shibuya' } });
    expect(printedLocationSlot(undefined)).toEqual({});
  });
});
