import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { LocaleFormatService } from './locale-format.service';
import { TranslationService } from './translation.service';

/**
 * The one place user-facing dates and numbers are formatted. The point of
 * every case here is that the output follows the *chosen language*, not the
 * browser's locale and not a hardcoded en-US pattern — the three ways the app
 * used to disagree with itself (#84).
 *
 * These assertions read the runtime's own CLDR data rather than hardcoding
 * expected strings, because the exact glyphs shift between ICU versions. What
 * is pinned is that the service agrees with Intl for the active locale, and
 * that two locales genuinely differ.
 */
describe('LocaleFormatService', () => {
  let service: LocaleFormatService;
  let translation: jasmine.SpyObj<TranslationService>;

  function useLocale(tag: string): void {
    translation.getIntlLocale.and.returnValue(tag);
  }

  beforeEach(() => {
    translation = jasmine.createSpyObj('TranslationService', ['getIntlLocale', 't']);
    translation.getIntlLocale.and.returnValue('en-US');

    TestBed.configureTestingModule({
      providers: [
        LocaleFormatService,
        { provide: TranslationService, useValue: translation },
      ],
    });
    service = TestBed.inject(LocaleFormatService);
  });

  describe('dates', () => {
    const day = new Date(2026, 7, 19);

    it('formats in the active locale', () => {
      useLocale('ja-JP');

      expect(service.formatDate(day, 'medium')).toBe(
        new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
          .format(day));
    });

    // The whole defect: one binding, two languages, two different renderings.
    it('renders the same day differently in different languages', () => {
      useLocale('en-US');
      const english = service.formatDate(day, 'long');
      useLocale('ja-JP');
      const japanese = service.formatDate(day, 'long');

      expect(english).not.toBe(japanese);
    });

    it('accepts a Firestore Timestamp as well as a Date', () => {
      expect(service.formatDate(Timestamp.fromDate(day), 'medium'))
        .toBe(service.formatDate(day, 'medium'));
    });

    it('defaults to the medium style', () => {
      expect(service.formatDate(day)).toBe(service.formatDate(day, 'medium'));
    });

    // A binding is not the place to surface bad data as "Invalid Date".
    it('returns an empty string for a missing or unparseable value', () => {
      expect(service.formatDate(null)).toBe('');
      expect(service.formatDate(undefined)).toBe('');
      expect(service.formatDate('not a date')).toBe('');
    });
  });

  // The order a reader writes the day's fields in, read off the same `short`
  // style `formatDate` prints on auto. The typed-date reader takes it, so what
  // a picker shows and what it accepts are one convention (#500).
  describe('fieldOrder', () => {
    it('is month, day, year in en-US', () => {
      useLocale('en-US');

      expect(service.fieldOrder()).toBe('mdy');
    });

    it('is year, month, day in ja-JP and zh-Hant-TW', () => {
      useLocale('ja-JP');
      expect(service.fieldOrder()).toBe('ymd');

      useLocale('zh-Hant-TW');
      expect(service.fieldOrder()).toBe('ymd');
    });

    it('is day, month, year in en-GB', () => {
      useLocale('en-GB');

      expect(service.fieldOrder()).toBe('dmy');
    });

    it('follows a locale switch', () => {
      useLocale('en-US');
      const english = service.fieldOrder();
      useLocale('ja-JP');
      const japanese = service.fieldOrder();
      useLocale('en-US');

      expect([english, japanese, service.fieldOrder()]).toEqual(['mdy', 'ymd', 'mdy']);
    });

    it('agrees with the text formatDate prints on the short style', () => {
      // 2026-08-19 has no field that reads the same as another, so the first
      // number of the printed date names the first field of the order.
      const day = new Date(2026, 7, 19);
      const first: Record<string, string> = { ymd: '2026', mdy: '8', dmy: '19' };

      for (const tag of ['en-US', 'ja-JP', 'zh-Hant-TW', 'en-GB', 'de-DE']) {
        useLocale(tag);
        const printed = service.formatDate(day, 'short');

        expect(printed.startsWith(first[service.fieldOrder()]))
          .withContext(`${tag}: ${printed}`).toBeTrue();
      }
    });

    // Reached on every keystroke of a typed date, so the Intl read happens once
    // per locale.
    it('reads the locale once and answers from memory after', () => {
      const spy = spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').and.callThrough();

      service.fieldOrder();
      service.fieldOrder();
      service.fieldOrder();
      useLocale('ja-JP');
      service.fieldOrder();
      service.fieldOrder();

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('time', () => {
    const moment = new Date(2026, 7, 19, 14, 5);

    const expected = (locale: string) =>
      new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(moment);

    it('formats hour and minute in English', () => {
      useLocale('en-US');
      expect(service.formatTime(moment)).toBe(expected('en-US'));
    });

    it('follows the locale\'s own clock, not a fixed one, in Japanese', () => {
      useLocale('ja-JP');
      expect(service.formatTime(moment)).toBe(expected('ja-JP'));
    });

    it('follows the locale\'s own clock in Traditional Chinese', () => {
      useLocale('zh-Hant-TW');
      expect(service.formatTime(moment)).toBe(expected('zh-Hant-TW'));
    });

    it('accepts a Firestore Timestamp as well as a Date', () => {
      expect(service.formatTime(Timestamp.fromDate(moment))).toBe(service.formatTime(moment));
    });

    it('returns an empty string for a missing or unparseable value', () => {
      expect(service.formatTime(null)).toBe('');
      expect(service.formatTime(undefined)).toBe('');
      expect(service.formatTime('not a date')).toBe('');
    });
  });

  describe('ranges', () => {
    const from = new Date(2026, 7, 1);
    const to = new Date(2026, 7, 19);

    // Same contract as the dates block: agree with the runtime's own CLDR
    // for the active locale rather than pinning glyphs that shift between
    // ICU versions.
    const expected = (locale: string, a: Date, b: Date) =>
      new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
        .formatRange(a, b);

    it('formats a range in the active locale', () => {
      useLocale('en-US');
      expect(service.formatRange(from, to)).toBe(expected('en-US', from, to));
    });

    it('follows the chosen language, not the browser', () => {
      useLocale('ja-JP');
      expect(service.formatRange(from, to)).toBe(expected('ja-JP', from, to));
    });

    it('renders the same range differently in different languages', () => {
      useLocale('en-US');
      const english = service.formatRange(from, to);
      useLocale('ja-JP');
      const japanese = service.formatRange(from, to);
      expect(english).not.toBe(japanese);
    });

    it('collapses a same-day range to the single date', () => {
      expect(service.formatRange(from, from)).toBe(service.formatDate(from, 'medium'));
    });

    it('formats a cross-year range', () => {
      const a = new Date(2025, 11, 15);
      const b = new Date(2026, 0, 10);
      expect(service.formatRange(a, b)).toBe(expected('en-US', a, b));
    });

    it('orders swapped inputs instead of throwing', () => {
      expect(service.formatRange(to, from)).toBe(service.formatRange(from, to));
    });

    it('accepts Firestore Timestamps on both sides', () => {
      expect(service.formatRange(Timestamp.fromDate(from), Timestamp.fromDate(to)))
        .toBe(service.formatRange(from, to));
    });

    it('returns an empty string when either side is absent or unparseable', () => {
      expect(service.formatRange(null, to)).toBe('');
      expect(service.formatRange(from, undefined)).toBe('');
      expect(service.formatRange('not a date', to)).toBe('');
    });
  });

  describe('numbers', () => {
    it('applies the digitsInfo bounds', () => {
      expect(service.formatNumber(1234.5678, '1.1-1')).toBe('1,234.6');
      expect(service.formatNumber(2, '1.2-2')).toBe('2.00');
    });

    // Grouping and decimal separators are locale properties even where the
    // digits are identical.
    it('groups in the active locale', () => {
      useLocale('de-DE');

      expect(service.formatNumber(1234567.5, '1.1-1')).toBe(
        new Intl.NumberFormat('de-DE', {
          minimumIntegerDigits: 1, minimumFractionDigits: 1, maximumFractionDigits: 1,
        }).format(1234567.5));
    });

    it('formats without bounds when no digitsInfo is given', () => {
      expect(service.formatNumber(1234)).toBe('1,234');
    });

    it('ignores a malformed digitsInfo rather than throwing', () => {
      expect(() => service.formatNumber(12, 'nonsense')).not.toThrow();
      expect(service.formatNumber(12, 'nonsense')).toBe('12');
    });

    it('returns an empty string for a missing or non-finite value', () => {
      expect(service.formatNumber(null)).toBe('');
      expect(service.formatNumber(undefined)).toBe('');
      expect(service.formatNumber(Number.NaN)).toBe('');
      expect(service.formatNumber(Number.POSITIVE_INFINITY)).toBe('');
    });
  });

  describe('file sizes', () => {
    /** What Intl writes for `value` of `unit` in `tag`, asked the way the service asks. */
    const unitIn = (tag: string, unit: string, value: number) =>
      new Intl.NumberFormat(tag, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(value);

    beforeEach(() => {
      translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
        params ? `${key}:${JSON.stringify(params)}` : key);
    });

    // Red by mutation, as main has no formatFileSize.
    // Mutation: unitDisplay 'long' ("10 megabytes").
    it('writes the dropzone\'s 10 MB limit as Intl writes it in each language', () => {
      expect(service.formatFileSize(10 * 1024 * 1024)).withContext('en').toBe('10 MB');
      for (const tag of ['ja-JP', 'zh-Hant-TW']) {
        useLocale(tag);
        expect(service.formatFileSize(10 * 1024 * 1024)).withContext(tag).toBe(unitIn(tag, 'megabyte', 10));
      }
    });

    // Red by mutation, as main has no formatFileSize.
    // Mutation: steps of 1000, or two fraction digits.
    it('steps by 1024 and keeps one decimal place', () => {
      expect(service.formatFileSize(1024)).toBe(unitIn('en-US', 'kilobyte', 1));
      expect(service.formatFileSize(1_000_000)).toBe(unitIn('en-US', 'kilobyte', 976.6));
      expect(service.formatFileSize(1500 * 1024)).toBe(unitIn('en-US', 'megabyte', 1.5));
      expect(service.formatFileSize(1024 ** 3)).toBe(unitIn('en-US', 'gigabyte', 1));
      expect(service.formatFileSize(1024 ** 4)).toBe(unitIn('en-US', 'gigabyte', 1024));
    });

    // Mutation: the loop steps on the raw value, and 1,048,525 B reads 1,024 kB.
    it('steps up where the figure would be written as 1,024 of its unit', () => {
      expect(service.formatFileSize(1_048_524)).withContext('below the boundary').toBe(unitIn('en-US', 'kilobyte', 1023.9));
      expect(service.formatFileSize(1_048_525)).withContext('kB to MB').toBe(unitIn('en-US', 'megabyte', 1));
      expect(service.formatFileSize(1024 ** 3 - 50_000)).withContext('MB to GB').toBe(unitIn('en-US', 'gigabyte', 1));
    });

    // CLDR writes the byte in English for zh-Hant, and "281 byte" in short en.
    // Red by mutation, as main has no formatFileSize.
    // Mutation: the byte step through Intl's 'byte' unit.
    it('reads the byte step from the catalog, its figure grouped in the active locale', () => {
      expect(service.formatFileSize(0)).toBe('common.fileSizeBytes:{"size":"0"}');
      expect(service.formatFileSize(281)).toBe('common.fileSizeBytes:{"size":"281"}');
      expect(service.formatFileSize(1023)).toBe('common.fileSizeBytes:{"size":"1,023"}');
    });

    // Red by mutation, as main has no formatFileSize.
    // Mutation: the absent-value guard removed.
    it('writes nothing for an absent or non-finite size', () => {
      expect(service.formatFileSize(null)).toBe('');
      expect(service.formatFileSize(undefined)).toBe('');
      expect(service.formatFileSize(Number.NaN)).toBe('');
    });

    // Red by mutation, as main has no formatFileSize.
    // Mutation: the unit formatter's memo keyed on the unit alone.
    it('follows a locale switch', () => {
      expect(service.formatFileSize(1536)).withContext('en').toBe(unitIn('en-US', 'kilobyte', 1.5));
      useLocale('ja-JP');
      expect(service.formatFileSize(1536)).withContext('ja').toBe(unitIn('ja-JP', 'kilobyte', 1.5));
    });
  });

  describe('formatter reuse', () => {
    // These are reached from impure pipes, so a fresh Intl formatter per
    // binding per change-detection cycle is the cost being avoided.
    it('reuses one formatter per locale and option set', () => {
      const spy = spyOn(Intl, 'DateTimeFormat').and.callThrough();

      service.formatDate(new Date(2026, 7, 19), 'medium');
      service.formatDate(new Date(2026, 7, 20), 'medium');
      service.formatDate(new Date(2026, 7, 21), 'medium');

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('builds a separate formatter once the locale changes', () => {
      const spy = spyOn(Intl, 'NumberFormat').and.callThrough();

      service.formatNumber(1, '1.0-0');
      useLocale('ja-JP');
      service.formatNumber(1, '1.0-0');
      service.formatNumber(2, '1.0-0');

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('reuses one time formatter per locale', () => {
      const spy = spyOn(Intl, 'DateTimeFormat').and.callThrough();

      service.formatTime(new Date(2026, 7, 19, 9, 0));
      service.formatTime(new Date(2026, 7, 19, 10, 30));

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // Many specs stub TranslationService with t() alone; a formatter reached
  // through a shared template must not be what makes them fail.
  it('falls back to the default locale when the mock has no resolver', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LocaleFormatService,
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
    });

    const bare = TestBed.inject(LocaleFormatService);

    expect(bare.locale).toBe('en-US');
    expect(bare.formatNumber(1234, '1.0-0')).toBe('1,234');
  });
});
