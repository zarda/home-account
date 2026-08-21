import { pinLeadingMinus, snapDisplayZero } from './money-display.utils';

describe('snapDisplayZero', () => {
  // JPY has 0 decimals: -0.4 would format as the contradiction "−¥0".
  it('snaps a sub-unit negative to unsigned zero for zero-decimal currencies', () => {
    expect(Object.is(snapDisplayZero(-0.4, 'JPY'), 0)).toBeTrue();
  });

  it('keeps a half-unit-or-more negative', () => {
    expect(snapDisplayZero(-0.6, 'JPY')).toBe(-0.6);
  });

  it('snaps sub-cent dust for two-decimal currencies', () => {
    expect(Object.is(snapDisplayZero(-0.004, 'USD'), 0)).toBeTrue();
  });

  it('keeps a real cent', () => {
    expect(snapDisplayZero(-0.01, 'USD')).toBe(-0.01);
  });

  it('passes positive values through untouched', () => {
    expect(snapDisplayZero(12.34, 'USD')).toBe(12.34);
  });

  it('leaves an exact zero unsigned', () => {
    expect(Object.is(snapDisplayZero(-0, 'USD'), 0)).toBeTrue();
  });
});

describe('pinLeadingMinus', () => {
  it('joins an ASCII minus to the first digit', () => {
    expect(pinLeadingMinus('-$400.00')).toBe('-\u2060$400.00');
  });

  it('joins U+2212 the same way', () => {
    expect(pinLeadingMinus('−¥400')).toBe('−\u2060¥400');
  });

  it('leaves unsigned values alone', () => {
    expect(pinLeadingMinus('$400.00')).toBe('$400.00');
  });

  it('leaves the empty string alone', () => {
    expect(pinLeadingMinus('')).toBe('');
  });
});
