import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { LocaleDatePipe } from './locale-date.pipe';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';

/**
 * The reason this pipe exists rather than Angular's `date`: LOCALE_ID is
 * resolved once at bootstrap, so the built-in pipe can never follow a
 * language switch made in the running app (#84).
 */
describe('LocaleDatePipe', () => {
  let pipe: LocaleDatePipe;
  let locale: ReturnType<typeof signal<string>>;

  beforeEach(() => {
    locale = signal('en');
    const translation = {
      currentLocale: locale,
      getIntlLocale: () => (locale() === 'ja' ? 'ja-JP' : 'en-US'),
    };

    TestBed.configureTestingModule({
      providers: [
        LocaleDatePipe,
        LocaleFormatService,
        { provide: TranslationService, useValue: translation },
      ],
    });
    pipe = TestBed.inject(LocaleDatePipe);
  });

  const day = new Date(2026, 7, 19);

  it('formats in the active locale', () => {
    expect(pipe.transform(day, 'medium')).toBe(
      new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        .format(day));
  });

  // The regression a pure pipe would reintroduce.
  it('re-renders after a language switch', () => {
    const before = pipe.transform(day, 'long');

    locale.set('ja');

    expect(pipe.transform(day, 'long')).not.toBe(before);
  });

  it('serves the memo while the key is unchanged', () => {
    const format = spyOn(TestBed.inject(LocaleFormatService), 'formatDate').and.returnValue('x');

    pipe.transform(day, 'medium');
    pipe.transform(day, 'medium');
    pipe.transform(day, 'medium');

    expect(format).toHaveBeenCalledTimes(1);
  });

  // Timestamps are rebuilt on every snapshot and Dates are mutable, so
  // caching on object identity would either never hit or go stale.
  it('keys the memo on the instant, not the object', () => {
    const format = spyOn(TestBed.inject(LocaleFormatService), 'formatDate').and.returnValue('x');

    pipe.transform(new Date(2026, 7, 19), 'medium');
    pipe.transform(Timestamp.fromDate(new Date(2026, 7, 19)), 'medium');

    expect(format).toHaveBeenCalledTimes(1);
  });

  it('re-renders when the requested style changes', () => {
    const short = pipe.transform(day, 'short');

    expect(pipe.transform(day, 'long')).not.toBe(short);
  });

  it('renders nothing for a missing value', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
