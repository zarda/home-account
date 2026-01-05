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
