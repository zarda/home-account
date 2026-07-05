import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslatePipe } from './translate.pipe';
import { TranslationService } from '../../core/services/translation.service';

describe('TranslatePipe', () => {
  let pipe: TranslatePipe;
  let currentLocale: ReturnType<typeof signal<string>>;
  let tSpy: jasmine.Spy;

  beforeEach(() => {
    currentLocale = signal('en');
    tSpy = jasmine
      .createSpy('t')
      .and.callFake(
        (key: string, params?: Record<string, string | number>) =>
          `${currentLocale()}:${key}${params ? ':' + JSON.stringify(params) : ''}`
      );

    TestBed.configureTestingModule({
      providers: [
        TranslatePipe,
        { provide: TranslationService, useValue: { currentLocale, t: tSpy } },
      ],
    });
    pipe = TestBed.inject(TranslatePipe);
  });

  it('resolves a key through the translation service', () => {
    expect(pipe.transform('nav.dashboard')).toBe('en:nav.dashboard');
    expect(tSpy).toHaveBeenCalledWith('nav.dashboard', undefined);
  });

  it('memoizes repeated calls with the same key, params, and locale', () => {
    pipe.transform('nav.dashboard');
    pipe.transform('nav.dashboard');
    pipe.transform('nav.dashboard');
    expect(tSpy).toHaveBeenCalledTimes(1);
  });

  it('re-resolves when the key changes', () => {
    pipe.transform('a');
    pipe.transform('b');
    pipe.transform('a');
    expect(tSpy).toHaveBeenCalledTimes(3);
  });

  it('re-resolves when params change', () => {
    expect(pipe.transform('greeting', { name: 'Ada' })).toBe('en:greeting:{"name":"Ada"}');
    expect(pipe.transform('greeting', { name: 'Grace' })).toBe('en:greeting:{"name":"Grace"}');
    // Same params object shape → cache hit, no extra call.
    pipe.transform('greeting', { name: 'Grace' });
    expect(tSpy).toHaveBeenCalledTimes(2);
  });

  it('re-resolves when the locale changes (impure reactivity preserved)', () => {
    expect(pipe.transform('nav.dashboard')).toBe('en:nav.dashboard');
    currentLocale.set('ja');
    expect(pipe.transform('nav.dashboard')).toBe('ja:nav.dashboard');
    expect(tSpy).toHaveBeenCalledTimes(2);
  });
});
