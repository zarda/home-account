import {
  countryDisplayName,
  localeRegion,
  suggestCurrency,
} from './currency-suggestion.utils';

describe('suggestCurrency', () => {
  const base = { datedToday: true, currentCurrency: 'USD' };

  it('answers from the receipt first', () => {
    expect(suggestCurrency({ ...base, receiptCountry: 'KR' }))
      .toEqual({ code: 'KRW', country: 'KR', reason: 'receipt' });
  });

  it('answers from the position when the receipt is silent and the receipt is from today', () => {
    expect(suggestCurrency({ ...base, positionCountry: 'JP' }))
      .toEqual({ code: 'JPY', country: 'JP', reason: 'position' });
  });

  it('never answers from the position for a receipt that is not from today', () => {
    // A fix taken at home says nothing about where last week's receipt was
    // paid; the form skips the fetch entirely, and the ladder skips the rung
    // even when handed a country.
    expect(suggestCurrency({ ...base, positionCountry: 'JP', datedToday: false })).toBeNull();
  });

  it('answers from the session choice with no country attached', () => {
    expect(suggestCurrency({ ...base, sessionCurrency: 'THB' }))
      .toEqual({ code: 'THB', reason: 'session' });
  });

  it('answers from the device locale last', () => {
    expect(suggestCurrency({ ...base, localeRegion: 'TW' }))
      .toEqual({ code: 'TWD', country: 'TW', reason: 'locale' });
  });

  it('lets the first rung that speaks win over every lower one', () => {
    expect(suggestCurrency({
      ...base, receiptCountry: 'KR', positionCountry: 'JP', sessionCurrency: 'THB', localeRegion: 'TW',
    })?.reason).toBe('receipt');
    expect(suggestCurrency({
      ...base, positionCountry: 'JP', sessionCurrency: 'THB', localeRegion: 'TW',
    })?.reason).toBe('position');
    expect(suggestCurrency({ ...base, sessionCurrency: 'THB', localeRegion: 'TW' })?.reason)
      .toBe('session');
  });

  it('suppresses a suggestion equal to what is already in the field', () => {
    expect(suggestCurrency({ ...base, receiptCountry: 'US' })).toBeNull();
    expect(suggestCurrency({ ...base, sessionCurrency: 'USD' })).toBeNull();
    expect(suggestCurrency({ ...base, localeRegion: 'US' })).toBeNull();
  });

  it('is silent on a rung whose country the table does not cover, and falls through', () => {
    // Greenland is a real country the table has no currency for: that rung
    // says nothing, and the next one is asked rather than the ladder giving up.
    expect(suggestCurrency({ ...base, receiptCountry: 'GL' })).toBeNull();
    expect(suggestCurrency({ ...base, receiptCountry: 'GL', localeRegion: 'JP' }))
      .toEqual({ code: 'JPY', country: 'JP', reason: 'locale' });
  });

  it('treats malformed evidence as absent', () => {
    expect(suggestCurrency({ ...base, receiptCountry: '', positionCountry: 'Japan', sessionCurrency: '', localeRegion: 'zz' }))
      .toBeNull();
    expect(suggestCurrency({ ...base, receiptCountry: 'kr' }))
      .toEqual({ code: 'KRW', country: 'KR', reason: 'receipt' });
  });

  it('is silent with no evidence at all', () => {
    expect(suggestCurrency(base)).toBeNull();
  });
});

describe('localeRegion', () => {
  it('reads the region off a tag that carries one', () => {
    expect(localeRegion('en-SG')).toBe('SG');
    expect(localeRegion('zh-Hant-TW')).toBe('TW');
  });

  it('maximizes a bare language to its likely region', () => {
    expect(localeRegion('ja')).toBe('JP');
  });

  it('is undefined for a tag Intl cannot read', () => {
    expect(localeRegion('')).toBeUndefined();
    expect(localeRegion('not a tag!')).toBeUndefined();
  });
});

describe('countryDisplayName', () => {
  it('names the country in the asked-for locale', () => {
    expect(countryDisplayName('KR', 'en-US')).toBe('South Korea');
    expect(countryDisplayName('JP', 'ja-JP')).toBe('日本');
    expect(countryDisplayName('JP', 'zh-Hant-TW')).toBe('日本');
  });

  it('falls back to the code for something it cannot name', () => {
    expect(countryDisplayName('AA', 'en-US')).toBe('AA');
  });
});
