import { countryOptions } from './country-options.utils';
import { COUNTRY_CURRENCY } from './country-bounds';

describe('countryOptions', () => {
  it('offers the whole bundled table, named in the active language', () => {
    const options = countryOptions('en-US');

    expect(options.length).withContext('every country the box table covers').toBe(79);
    expect(options.length).toBe(Object.keys(COUNTRY_CURRENCY).length);
    expect(options.find(option => option.code === 'KR')?.name).toBe('South Korea');
  });

  it('orders by the name it just resolved, not by the code', () => {
    const options = countryOptions('en-US');
    const names = options.map(option => option.name);

    expect([...names].sort((a, b) => a.localeCompare(b, 'en-US'))).toEqual(names);
    expect(options[0].code).withContext('sorted by name, so JP does not lead').not.toBe('JP');
  });

  it('reorders when the language names the countries differently', () => {
    // The reason the list is built per call rather than once: a menu opened
    // after a language switch has to read in the new one, and its order is
    // part of that.
    const options = countryOptions('ja-JP');
    const names = options.map(option => option.name);

    expect(options.find(option => option.code === 'KR')?.name).toBe('韓国');
    expect([...names].sort((a, b) => a.localeCompare(b, 'ja-JP'))).toEqual(names);
  });

  it('appends a selected country the table does not cover, once', () => {
    // readCountryCode admits any region CLDR names, so a receipt can carry
    // one the bounding-box table has no box for. It must still be offered,
    // or the value on the row cannot be rendered as the current choice.
    const options = countryOptions('en-US', 'VA');

    expect(options.length).toBe(80);
    expect(options.filter(option => option.code === 'VA').length).toBe(1);
  });

  it('breaks a tie on the code when two entries resolve to one name', () => {
    // Intl names a deprecated region as the one that replaced it, so a code
    // like BU arriving on a row reads exactly as the table's MM. Left to the
    // name alone the comparator returns 0 there and the order falls to the
    // engine's sort stability — the appended code trailing the table's —
    // rather than to anything this function decides.
    const options = countryOptions('en-US', 'BU');
    const deprecated = options.findIndex(option => option.code === 'BU');
    const current = options.findIndex(option => option.code === 'MM');

    expect(options[deprecated].name)
      .withContext('the tie this case rests on')
      .toBe(options[current].name);
    expect(deprecated).withContext('only the code decides between them').toBeLessThan(current);
  });

  it('does not repeat a selected country the table already covers', () => {
    const options = countryOptions('en-US', 'KR');

    expect(options.length).toBe(79);
    expect(options.filter(option => option.code === 'KR').length).toBe(1);
  });
});
