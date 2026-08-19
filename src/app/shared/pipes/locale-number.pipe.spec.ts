import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LocaleNumberPipe } from './locale-number.pipe';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';

/** Same contract as LocaleDatePipe, for grouping and decimal separators. */
describe('LocaleNumberPipe', () => {
  let pipe: LocaleNumberPipe;
  let locale: ReturnType<typeof signal<string>>;

  beforeEach(() => {
    locale = signal('en');
    const translation = {
      currentLocale: locale,
      getIntlLocale: () => (locale() === 'de' ? 'de-DE' : 'en-US'),
    };

    TestBed.configureTestingModule({
      providers: [
        LocaleNumberPipe,
        LocaleFormatService,
        { provide: TranslationService, useValue: translation },
      ],
    });
    pipe = TestBed.inject(LocaleNumberPipe);
  });

  it('honours Angular digitsInfo', () => {
    expect(pipe.transform(1234.5678, '1.1-1')).toBe('1,234.6');
  });

  it('re-renders after a language switch', () => {
    expect(pipe.transform(1234567.5, '1.1-1')).toBe('1,234,567.5');

    locale.set('de');

    expect(pipe.transform(1234567.5, '1.1-1')).toBe('1.234.567,5');
  });

  it('serves the memo while the key is unchanged', () => {
    const format = spyOn(TestBed.inject(LocaleFormatService), 'formatNumber').and.returnValue('x');

    pipe.transform(42, '1.0-0');
    pipe.transform(42, '1.0-0');

    expect(format).toHaveBeenCalledTimes(1);
  });

  it('re-renders when the value or the bounds change', () => {
    expect(pipe.transform(42, '1.0-0')).toBe('42');
    expect(pipe.transform(43, '1.0-0')).toBe('43');
    expect(pipe.transform(43, '1.2-2')).toBe('43.00');
  });

  it('renders nothing for a missing value', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
