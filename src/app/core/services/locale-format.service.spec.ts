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
    translation = jasmine.createSpyObj('TranslationService', ['getIntlLocale']);
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
