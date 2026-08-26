import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LocationLabelPipe } from './location-label.pipe';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';

describe('LocationLabelPipe', () => {
  let pipe: LocationLabelPipe;
  let locale: ReturnType<typeof signal<string>>;

  beforeEach(() => {
    locale = signal('en');
    const translation = {
      currentLocale: locale,
      getIntlLocale: () => (locale() === 'ja' ? 'ja-JP' : 'en-US'),
    };

    TestBed.configureTestingModule({
      providers: [
        LocationLabelPipe,
        LocaleFormatService,
        { provide: TranslationService, useValue: translation },
      ],
    });
    pipe = TestBed.inject(LocationLabelPipe);
  });

  it('renders the place name when there is one', () => {
    expect(pipe.transform({ name: 'Myeongdong' })).toBe('Myeongdong');
  });

  it('renders a country-only location as the country name', () => {
    expect(pipe.transform({ country: 'KR' })).toBe('South Korea');
  });

  it('renames the country when the language changes', () => {
    // The whole reason the pipe is impure: the locale is not an input, so a
    // pure pipe would keep the boot language's answer after a switch.
    expect(pipe.transform({ country: 'KR' })).toBe('South Korea');
    locale.set('ja');
    expect(pipe.transform({ country: 'KR' })).toBe('韓国');
  });

  it('memoizes on the location identity, which transactions replace rather than mutate', () => {
    const location = { country: 'KR' };
    expect(pipe.transform(location)).toBe('South Korea');
    expect(pipe.transform(location)).toBe('South Korea');
    expect(pipe.transform({ country: 'JP' })).toBe('Japan');
  });

  it('answers nothing for an absent location', () => {
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform(null)).toBe('');
  });
});
