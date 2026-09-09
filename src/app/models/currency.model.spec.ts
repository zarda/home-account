import { roundToMinorUnit } from './currency.model';

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
