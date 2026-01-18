import { TestBed } from '@angular/core/testing';
import { PaddleOCRService } from './paddle-ocr.service';

describe('PaddleOCRService', () => {
  let service: PaddleOCRService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PaddleOCRService],
    });

    service = TestBed.inject(PaddleOCRService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should not be ready initially', () => {
      expect(service.isReady()).toBeFalse();
    });

    it('should not be loading initially', () => {
      expect(service.isLoading()).toBeFalse();
    });

    it('should have 0 progress initially', () => {
      expect(service.progress()).toBe(0);
    });

    it('should have no error initially', () => {
      expect(service.error()).toBeNull();
    });

    it('should return "Not loaded" for model size', () => {
      expect(service.getModelSizeFormatted()).toBe('Not loaded');
    });
  });

  describe('detectTraditionalChinese', () => {
    it('should detect Traditional Chinese characters', () => {
      expect(PaddleOCRService.detectTraditionalChinese('這是國學經濟')).toBeTrue();
    });

    it('should detect Taiwan specific terms', () => {
      expect(PaddleOCRService.detectTraditionalChinese('臺灣發票')).toBeTrue();
    });

    it('should detect Taiwan invoice number pattern', () => {
      expect(PaddleOCRService.detectTraditionalChinese('統一編號12345678')).toBeTrue();
    });

    it('should detect ROC date format', () => {
      expect(PaddleOCRService.detectTraditionalChinese('民國113年')).toBeTrue();
    });

    it('should detect NT$ currency', () => {
      expect(PaddleOCRService.detectTraditionalChinese('NT$500')).toBeTrue();
    });

    it('should detect HK$ currency', () => {
      expect(PaddleOCRService.detectTraditionalChinese('HK$100')).toBeTrue();
    });

    it('should detect Hong Kong terms', () => {
      expect(PaddleOCRService.detectTraditionalChinese('香港收據')).toBeTrue();
    });

    it('should return false for English text', () => {
      expect(PaddleOCRService.detectTraditionalChinese('This is English text')).toBeFalse();
    });

    it('should return false for Japanese text', () => {
      expect(PaddleOCRService.detectTraditionalChinese('これは日本語です')).toBeFalse();
    });

    it('should return false for empty string', () => {
      expect(PaddleOCRService.detectTraditionalChinese('')).toBeFalse();
    });
  });

  describe('containsChineseCharacters', () => {
    it('should return true for text with significant Chinese', () => {
      expect(PaddleOCRService.containsChineseCharacters('這是中文文字')).toBeTrue();
    });

    it('should return true for mixed text with >20% Chinese', () => {
      // "中文" is 2 chars, total is 8 chars = 25%
      expect(PaddleOCRService.containsChineseCharacters('中文text')).toBeTrue();
    });

    it('should return false for text with <20% Chinese', () => {
      // "中" is 1 char, total is 20 chars = 5%
      expect(PaddleOCRService.containsChineseCharacters('中 this is English text')).toBeFalse();
    });

    it('should return false for pure English text', () => {
      expect(PaddleOCRService.containsChineseCharacters('This is English text')).toBeFalse();
    });

    it('should return false for empty string', () => {
      expect(PaddleOCRService.containsChineseCharacters('')).toBeFalse();
    });

    it('should return true for Traditional Chinese', () => {
      expect(PaddleOCRService.containsChineseCharacters('臺灣國學經濟')).toBeTrue();
    });

    it('should return true for Simplified Chinese', () => {
      expect(PaddleOCRService.containsChineseCharacters('这是简体中文')).toBeTrue();
    });
  });

  describe('terminate', () => {
    it('should handle terminate when not initialized', async () => {
      await expectAsync(service.terminate()).toBeResolved();
      expect(service.isReady()).toBeFalse();
    });
  });
});
