import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TranslationService, mapLocaleTag } from './translation.service';
import { AppDirectionality } from './app-directionality';

describe('mapLocaleTag', () => {
  it('maps any Chinese tag to the Traditional Chinese catalog', () => {
    expect(mapLocaleTag('zh-TW')).toBe('tc');
    // Lower-cased and Simplified: the only Chinese catalog we ship is tc, and
    // the match must not depend on the casing the tag arrives in — a browser
    // says `zh-TW`, a Google profile says `zh-CN`.
    expect(mapLocaleTag('zh-cn')).toBe('tc');
  });

  it('maps Japanese tags with and without a region', () => {
    expect(mapLocaleTag('ja')).toBe('ja');
    expect(mapLocaleTag('ja-JP')).toBe('ja');
  });

  it('maps a regional English tag to en', () => {
    expect(mapLocaleTag('en-GB')).toBe('en');
  });

  it('returns null for a language we do not ship', () => {
    // Null rather than 'en': the caller has to be able to tell "asked for
    // English" from "asked for something we have no catalog for", because the
    // second is what lets the Google account's language have a turn.
    expect(mapLocaleTag('fr')).toBeNull();
  });

  it('returns null for an empty tag', () => {
    expect(mapLocaleTag('')).toBeNull();
  });
});

describe('TranslationService', () => {
  let service: TranslationService;
  let httpMock: HttpTestingController;
  let setDirection: jasmine.Spy;

  const mockTranslations = {
    common: {
      save: 'Save',
      cancel: 'Cancel',
      greeting: 'Hello, {{name}}!'
    },
    nested: {
      deep: {
        value: 'Deep Value'
      }
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TranslationService]
    });

    service = TestBed.inject(TranslationService);
    httpMock = TestBed.inject(HttpTestingController);
    // The real service would write `dir` on the page Karma is running in;
    // spying on it keeps every locale switch below off the real document.
    setDirection = spyOn(TestBed.inject(AppDirectionality), 'setDirection');
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should default to en locale', () => {
      expect(service.currentLocale()).toBe('en');
    });

    it('should not be loaded initially', () => {
      expect(service.isLoaded()).toBeFalse();
    });

    it('should have available languages', () => {
      expect(service.languages.length).toBe(3);
      expect(service.languages.map(l => l.code)).toEqual(['en', 'tc', 'ja']);
    });
  });

  describe('detectedBrowserLocale', () => {
    /**
     * navigator.language is a prototype accessor, so the spy has to go on
     * Navigator.prototype rather than on the instance.
     */
    const browserSays = (tag: string) =>
      spyOnProperty(Object.getPrototypeOf(navigator) as Navigator, 'language', 'get')
        .and.returnValue(tag);

    it('is null before init runs', () => {
      expect(service.detectedBrowserLocale).toBeNull();
    });

    it('records the language the browser asked for', async () => {
      browserSays('ja-JP');

      const promise = service.init();
      httpMock.expectOne('/assets/i18n/ja.json').flush(mockTranslations);
      await promise;

      expect(service.detectedBrowserLocale).toBe('ja');
      expect(service.currentLocale()).toBe('ja');
    });

    it('stays null when the browser names a language we do not ship', async () => {
      browserSays('fr-FR');

      const promise = service.init();
      httpMock.expectOne('/assets/i18n/en.json').flush(mockTranslations);
      await promise;

      // The UI falls back to English, but nothing detected it — which is the
      // distinction the Google-account fallback hangs on.
      expect(service.currentLocale()).toBe('en');
      expect(service.detectedBrowserLocale).toBeNull();
    });
  });

  describe('setLocale', () => {
    it('should load translations for locale', async () => {
      const promise = service.setLocale('en');

      const req = httpMock.expectOne('/assets/i18n/en.json');
      expect(req.request.method).toBe('GET');
      req.flush(mockTranslations);

      await promise;

      expect(service.currentLocale()).toBe('en');
      expect(service.isLoaded()).toBeTrue();
    });

    it('should fallback to default on error', async () => {
      // Capture console.error to verify it's called
      spyOn(console, 'error');

      const promise = service.setLocale('tc');

      const req = httpMock.expectOne('/assets/i18n/tc.json');
      req.error(new ProgressEvent('error'));

      // Wait a tick for the error handling
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should fallback to en
      const fallbackReq = httpMock.expectOne('/assets/i18n/en.json');
      fallbackReq.flush(mockTranslations);

      await promise;

      expect(console.error).toHaveBeenCalled();
    });

    it('should set document lang attribute', async () => {
      const promise = service.setLocale('tc');

      const req = httpMock.expectOne('/assets/i18n/tc.json');
      req.flush(mockTranslations);

      await promise;

      expect(document.documentElement.lang).toBe('zh-Hant');
      // The direction travels with the language, through the service every
      // Material/CDK component resolves — every locale we ship today is
      // left-to-right, and this is the call an RTL one would ride.
      expect(setDirection).toHaveBeenCalledWith('ltr');
    });

    it('should bump translationsVersion when a catalog loads', async () => {
      expect(service.translationsVersion()).toBe(0);

      const promise = service.setLocale('en');
      httpMock.expectOne('/assets/i18n/en.json').flush(mockTranslations);
      await promise;

      expect(service.translationsVersion()).toBe(1);
    });

    it('should not bump translationsVersion when the default-locale load fails', async () => {
      spyOn(console, 'error');

      const promise = service.setLocale('en');
      httpMock.expectOne('/assets/i18n/en.json').error(new ProgressEvent('error'));
      await promise;

      expect(service.translationsVersion()).toBe(0);
    });
  });

  describe('t (translate)', () => {
    beforeEach(async () => {
      const promise = service.setLocale('en');
      httpMock.expectOne('/assets/i18n/en.json').flush(mockTranslations);
      await promise;
    });

    it('should translate simple key', () => {
      expect(service.t('common.save')).toBe('Save');
    });

    it('should translate nested key', () => {
      expect(service.t('nested.deep.value')).toBe('Deep Value');
    });

    it('should return key if not found', () => {
      expect(service.t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('should interpolate parameters', () => {
      expect(service.t('common.greeting', { name: 'World' })).toBe('Hello, World!');
    });

    it('should keep placeholder if param missing', () => {
      expect(service.t('common.greeting', {})).toBe('Hello, {{name}}!');
    });
  });

  describe('plural entries', () => {
    const enCatalog = {
      aiSearch: {
        matchCount: { one: '{{count}} matching transaction', other: '{{count}} matching transactions' },
      },
    };

    async function load(locale: 'en' | 'ja' | 'tc', body: object): Promise<void> {
      const promise = service.setLocale(locale);
      httpMock.expectOne(`/assets/i18n/${locale}.json`).flush(body);
      await promise;
    }

    it('selects one at 1 and other at 0 and 2 in English', async () => {
      await load('en', enCatalog);
      expect(service.t('aiSearch.matchCount', { count: 0 })).toBe('0 matching transactions');
      expect(service.t('aiSearch.matchCount', { count: 1 })).toBe('1 matching transaction');
      expect(service.t('aiSearch.matchCount', { count: 2 })).toBe('2 matching transactions');
    });

    it('falls back to other when the selected category has no member', async () => {
      await load('en', { insights: { historyCount: { other: '{{count}} months saved' } } });
      expect(service.t('insights.historyCount', { count: 1 })).toBe('1 months saved');
    });

    it('interpolates the other placeholders of the selected member', async () => {
      await load('en', {
        settings: {
          backupRestoredPartial: {
            one: '{{count}} record restored, {{skipped}} skipped',
            other: '{{count}} records restored, {{skipped}} skipped',
          },
        },
      });
      expect(service.t('settings.backupRestoredPartial', { count: 1, skipped: 3 }))
        .toBe('1 record restored, 3 skipped');
    });

    it('returns the key when a plural entry is reached without a numeric count', async () => {
      await load('en', enCatalog);
      expect(service.t('aiSearch.matchCount')).toBe('aiSearch.matchCount');
      expect(service.t('aiSearch.matchCount', { count: '2' })).toBe('aiSearch.matchCount');
    });

    it('still returns the key for a namespace object even with a count', async () => {
      await load('en', enCatalog);
      expect(service.t('aiSearch', { count: 2 })).toBe('aiSearch');
    });

    it('leaves a Japanese plain string untouched at every count', async () => {
      await load('ja', { aiSearch: { matchCount: '該当する取引: {{count}}件' } });
      expect(service.t('aiSearch.matchCount', { count: 1 })).toBe('該当する取引: 1件');
      expect(service.t('aiSearch.matchCount', { count: 2 })).toBe('該当する取引: 2件');
    });

    it('leaves a Traditional Chinese plain string untouched at every count', async () => {
      await load('tc', { aiSearch: { matchCount: '{{count}} 筆符合的交易' } });
      expect(service.t('aiSearch.matchCount', { count: 1 })).toBe('1 筆符合的交易');
    });
  });

  describe('currentLanguage', () => {
    it('should return current language object', async () => {
      const promise = service.setLocale('ja');
      httpMock.expectOne('/assets/i18n/ja.json').flush(mockTranslations);
      await promise;

      const lang = service.currentLanguage();
      expect(lang.code).toBe('ja');
      expect(lang.nativeName).toBe('日本語');
    });
  });

  describe('getIntlLocale', () => {
    it('should return en-US for en', () => {
      expect(service.getIntlLocale()).toBe('en-US');
    });

    it('should return zh-Hant-TW for tc', async () => {
      const promise = service.setLocale('tc');
      httpMock.expectOne('/assets/i18n/tc.json').flush(mockTranslations);
      await promise;

      expect(service.getIntlLocale()).toBe('zh-Hant-TW');
    });

    it('should return ja-JP for ja', async () => {
      const promise = service.setLocale('ja');
      httpMock.expectOne('/assets/i18n/ja.json').flush(mockTranslations);
      await promise;

      expect(service.getIntlLocale()).toBe('ja-JP');
    });
  });

  describe('syncFromDatabase', () => {
    it('should sync valid locale', async () => {
      // Initial load
      let promise = service.setLocale('en');
      httpMock.expectOne('/assets/i18n/en.json').flush(mockTranslations);
      await promise;

      // Sync from database
      promise = service.syncFromDatabase('ja');
      httpMock.expectOne('/assets/i18n/ja.json').flush(mockTranslations);
      await promise;

      expect(service.currentLocale()).toBe('ja');
    });

    it('should not sync if same locale', async () => {
      const promise = service.setLocale('en');
      httpMock.expectOne('/assets/i18n/en.json').flush(mockTranslations);
      await promise;

      await service.syncFromDatabase('en');
      // No additional request should be made - verify still on en
      expect(service.currentLocale()).toBe('en');
    });
  });
});
