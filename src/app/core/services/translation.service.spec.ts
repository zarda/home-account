import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  let service: TranslationService;
  let httpMock: HttpTestingController;

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
