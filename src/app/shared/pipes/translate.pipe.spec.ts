import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TranslatePipe } from './translate.pipe';
import { TranslationService } from '../../core/services/translation.service';

describe('TranslatePipe', () => {
  let pipe: TranslatePipe;
  let currentLocale: ReturnType<typeof signal<string>>;
  let translationsVersion: ReturnType<typeof signal<number>>;
  let tSpy: jasmine.Spy;

  beforeEach(() => {
    currentLocale = signal('en');
    translationsVersion = signal(0);
    tSpy = jasmine
      .createSpy('t')
      .and.callFake(
        (key: string, params?: Record<string, string | number>) =>
          `${currentLocale()}:${key}${params ? ':' + JSON.stringify(params) : ''}`
      );

    TestBed.configureTestingModule({
      providers: [
        TranslatePipe,
        { provide: TranslationService, useValue: { currentLocale, translationsVersion, t: tSpy } },
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

  it('re-resolves when the translations version changes without a locale change', () => {
    pipe.transform('nav.dashboard');
    translationsVersion.set(1);
    pipe.transform('nav.dashboard');
    expect(tSpy).toHaveBeenCalledTimes(2);
  });
});

describe('TranslatePipe with the real TranslationService', () => {
  let pipe: TranslatePipe;
  let service: TranslationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TranslatePipe],
    });
    pipe = TestBed.inject(TranslatePipe);
    service = TestBed.inject(TranslationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('re-resolves a raw key memoized before the catalog finished loading', async () => {
    // A view instantiated before the async catalog arrives misses in t()
    // and memoizes the raw key under the already-active locale.
    expect(pipe.transform('nav.dashboard')).toBe('nav.dashboard');

    const load = service.setLocale('en');
    httpMock.expectOne('/assets/i18n/en.json').flush({ nav: { dashboard: 'Dashboard' } });
    await load;

    // 'en' → 'en': the locale never changed, so the catalog arrival itself
    // must invalidate the memo.
    expect(pipe.transform('nav.dashboard')).toBe('Dashboard');
  });
});
