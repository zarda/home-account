import {
  countryForCoordinates,
  currencyForCoordinates,
  currencyForCountry,
} from './country-bounds';

describe('countryForCoordinates', () => {
  it('places a capital in its own country', () => {
    expect(countryForCoordinates(37.5665, 126.978)).toBe('KR');   // Seoul
    expect(countryForCoordinates(35.6762, 139.6503)).toBe('JP');  // Tokyo
    expect(countryForCoordinates(25.033, 121.5654)).toBe('TW');   // Taipei
    expect(countryForCoordinates(48.8566, 2.3522)).toBe('FR');    // Paris
    expect(countryForCoordinates(-33.8688, 151.2093)).toBe('AU'); // Sydney
  });

  it('prefers the smaller box where two overlap', () => {
    // Hong Kong sits inside the box drawn around all of China. Resolving by
    // area rather than by table order is what keeps this from depending on
    // which entry happens to come first.
    expect(countryForCoordinates(22.3193, 114.1694)).toBe('HK');
    expect(countryForCoordinates(39.9042, 116.4074)).toBe('CN');
  });

  it('handles a box that crosses the antimeridian', () => {
    // Fiji straddles 180°, so its east edge is numerically west of its west
    // edge and the longitude test has to wrap.
    expect(countryForCoordinates(-18.1416, 178.4419)).toBe('FJ');
    expect(countryForCoordinates(-17.0, -179.9)).toBe('FJ');
  });

  it('returns nothing in open ocean', () => {
    expect(countryForCoordinates(0, -140)).toBeNull();     // mid-Pacific
    expect(countryForCoordinates(-40, -20)).toBeNull();    // South Atlantic
  });

  it('returns nothing for land no box covers', () => {
    // Coverage is travel destinations, not every state. Unlisted means no
    // suggestion, which leaves the existing base-currency fallback in place.
    expect(countryForCoordinates(72.0, -40.0)).toBeNull();  // central Greenland
    expect(countryForCoordinates(21.0, 10.0)).toBeNull();   // central Sahara
  });

  it('resolves an unlisted country to whichever box swallows it', () => {
    // The documented cost of bounding boxes, pinned so it is a known
    // limitation rather than a surprise: Rwanda is not in the table and sits
    // inside the box drawn around Tanzania. The answer is only ever a
    // suggestion the user accepts, which is what makes this tolerable.
    expect(countryForCoordinates(-1.9403, 29.8739)).toBe('TZ');
  });

  it('rejects coordinates that are not coordinates', () => {
    expect(countryForCoordinates(NaN, 10)).toBeNull();
    expect(countryForCoordinates(10, NaN)).toBeNull();
    expect(countryForCoordinates(Infinity, 0)).toBeNull();
    expect(countryForCoordinates(91, 0)).toBeNull();
    expect(countryForCoordinates(0, 181)).toBeNull();
  });

  it('accepts the extremes of the valid range', () => {
    expect(() => countryForCoordinates(-90, -180)).not.toThrow();
    expect(() => countryForCoordinates(90, 180)).not.toThrow();
  });
});

describe('currencyForCountry', () => {
  it('maps a covered country to its currency', () => {
    expect(currencyForCountry('KR')).toBe('KRW');
    expect(currencyForCountry('JP')).toBe('JPY');
  });

  it('is case-insensitive', () => {
    expect(currencyForCountry('kr')).toBe('KRW');
  });

  it('maps every eurozone entry to the one currency', () => {
    // This is why border imprecision is tolerable here: the largest cluster of
    // adjacent boxes in the table cannot produce a wrong currency.
    for (const c of ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'IE', 'GR', 'FI', 'HR']) {
      expect(currencyForCountry(c)).toBe('EUR');
    }
  });

  it('returns nothing for an unknown or absent country', () => {
    expect(currencyForCountry('ZZ')).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
    expect(currencyForCountry(undefined)).toBeNull();
    expect(currencyForCountry('')).toBeNull();
  });

  it('names a currency the ISO table recognises', () => {
    // A typo here would be invisible until a receipt landed in it, and
    // readCurrencyCode would then reject the app's own suggestion.
    const known = new Set(Intl.supportedValuesOf('currency'));
    for (const country of ['KR', 'JP', 'TW', 'FR', 'GB', 'US', 'BR', 'ZA', 'FJ', 'MO']) {
      expect(known.has(currencyForCountry(country)!)).toBeTrue();
    }
  });
});

describe('currencyForCoordinates', () => {
  it('goes from a coordinate to money in one step', () => {
    expect(currencyForCoordinates(37.5665, 126.978)).toBe('KRW');
  });

  it('returns nothing where the coordinate cannot be placed', () => {
    expect(currencyForCoordinates(0, -140)).toBeNull();
  });
});
