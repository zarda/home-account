import { locationLabel } from './location-label.utils';

describe('locationLabel', () => {
  it('prefers the name a receipt printed or a user typed', () => {
    expect(locationLabel({ name: 'Myeongdong', country: 'KR' }, 'en-US')).toBe('Myeongdong');
  });

  it('names the country when that is all the receipt gave', () => {
    expect(locationLabel({ country: 'KR' }, 'en-US')).toBe('South Korea');
  });

  it('names the country in the active language', () => {
    // The reason the name is resolved at render rather than stored: one
    // locale's string baked into the document would be wrong everywhere else.
    expect(locationLabel({ country: 'KR' }, 'ja-JP')).toBe('韓国');
  });

  it('falls back to the code when the runtime cannot name the region', () => {
    // 'XX' is unassigned and CLDR names nothing for it. 'ZZ' would be the
    // wrong probe: CLDR does name it, "Unknown Region", which is why
    // readCountryCode refuses it up front rather than relying on the lookup.
    expect(locationLabel({ country: 'XX' }, 'en-US')).toBe('XX');
  });

  it('labels a macroregion rather than going blank', () => {
    // readCountryCode admits EU and QO because CLDR names them. The rollup
    // shows such a row as a coarser answer, not a broken one.
    expect(locationLabel({ country: 'EU' }, 'en-US')).toBe('European Union');
  });

  it('answers nothing for a location that says nothing', () => {
    expect(locationLabel(undefined, 'en-US')).toBe('');
    expect(locationLabel(null, 'en-US')).toBe('');
    expect(locationLabel({}, 'en-US')).toBe('');
    expect(locationLabel({ name: '   ' }, 'en-US')).toBe('');
  });

  it('ignores coordinates, which name no place on their own', () => {
    expect(locationLabel({ lat: 35.66, lng: 139.71 }, 'en-US')).toBe('');
  });

  it('trims a padded name rather than rendering the padding', () => {
    expect(locationLabel({ name: '  Shibuya  ' }, 'en-US')).toBe('Shibuya');
  });
});
