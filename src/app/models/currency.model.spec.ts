import { roundToMinorUnit, sanitizeRates } from './currency.model';

describe('roundToMinorUnit', () => {
  it('rounds down to the whole yen for a currency with no minor unit', () => {
    expect(roundToMinorUnit(179.33, 'JPY')).toBe(179);
  });

  it('rounds up to the whole yen for a currency with no minor unit', () => {
    expect(roundToMinorUnit(179.5, 'JPY')).toBe(180);
  });

  it('rounds to three places for a currency whose minor unit is thousandths', () => {
    expect(roundToMinorUnit(1.2345, 'KWD')).toBe(1.235);
  });

  it('rounds to two places for an ordinary cent-based currency', () => {
    expect(roundToMinorUnit(4.126, 'USD')).toBe(4.13);
  });

  it('rounds to zero places for TWD, the deliberate override', () => {
    expect(roundToMinorUnit(120.5, 'TWD')).toBe(121);
  });

  it('rounds to two places for a code it does not recognize, the same default currencyDecimalPlaces falls back to', () => {
    expect(roundToMinorUnit(4.567, 'ZZZ')).toBe(4.57);
  });

  it('rounds a sub-half-yen figure to zero', () => {
    expect(roundToMinorUnit(0.4, 'JPY')).toBe(0);
  });

  it('folds a negative sub-half-yen figure to unsigned zero, not -0', () => {
    // Math.round(-0.4) is -0, and a signed zero has no business surviving
    // into a stored amount — `Object.is` is what would actually notice.
    const result = roundToMinorUnit(-0.4, 'JPY');
    expect(Object.is(result, 0)).toBe(true);
  });
});

describe('sanitizeRates', () => {
  it('keeps finite positive numbers', () => {
    expect(sanitizeRates({ USD: 1, JPY: 149.5 })).toEqual({ USD: 1, JPY: 149.5 });
  });

  it('drops a string rate', () => {
    expect(sanitizeRates({ USD: 1, EUR: 0.9, JPY: '149.5' })).toEqual({ USD: 1, EUR: 0.9 });
  });

  it('drops a NaN rate', () => {
    expect(sanitizeRates({ USD: 1, EUR: 0.9, JPY: NaN })).toEqual({ USD: 1, EUR: 0.9 });
  });

  it('drops a zero rate', () => {
    expect(sanitizeRates({ USD: 1, EUR: 0.9, JPY: 0 })).toEqual({ USD: 1, EUR: 0.9 });
  });

  it('drops a negative rate', () => {
    expect(sanitizeRates({ USD: 1, EUR: 0.9, JPY: -149.5 })).toEqual({ USD: 1, EUR: 0.9 });
  });

  it('drops an Infinity rate', () => {
    expect(sanitizeRates({ USD: 1, EUR: 0.9, JPY: Infinity })).toEqual({ USD: 1, EUR: 0.9 });
  });

  it('returns null when fewer than two rates survive', () => {
    expect(sanitizeRates({ USD: 1, JPY: 'bad', EUR: -1 })).toBeNull();
  });

  it('returns null for an empty table', () => {
    expect(sanitizeRates({})).toBeNull();
  });

  it('returns null for null', () => {
    expect(sanitizeRates(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(sanitizeRates(undefined)).toBeNull();
  });

  it('returns null for a string', () => {
    expect(sanitizeRates('USD:1,JPY:149.5')).toBeNull();
  });

  it('returns null for an array', () => {
    expect(sanitizeRates([1, 2, 3])).toBeNull();
  });
});
