import { TestBed } from '@angular/core/testing';
import { CurrencyService } from './currency.service';
import { FirestoreService } from './firestore.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { SUPPORTED_CURRENCIES } from '../../models';

describe('CurrencyService', () => {
  let service: CurrencyService;
  let mockFirestore: MockFirestoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CurrencyService,
        { provide: FirestoreService, useClass: MockFirestoreService }
      ]
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    service = TestBed.inject(CurrencyService);

    // Set default exchange rates for testing
    service.exchangeRates.set(new Map([
      ['USD', 1],
      ['EUR', 0.92],
      ['GBP', 0.79],
      ['JPY', 149.5],
      ['THB', 34.5],
      ['KRW', 1320]
    ]));
  });

  afterEach(() => {
    mockFirestore.clearMocks();
  });

  describe('getExchangeRate', () => {
    it('should return 1 for same currency', () => {
      expect(service.getExchangeRate('USD', 'USD')).toBe(1);
      expect(service.getExchangeRate('EUR', 'EUR')).toBe(1);
      expect(service.getExchangeRate('JPY', 'JPY')).toBe(1);
    });

    it('should calculate rate from USD to other currency', () => {
      const rate = service.getExchangeRate('USD', 'EUR');
      expect(rate).toBeCloseTo(0.92, 2);
    });

    it('should calculate rate from other currency to USD', () => {
      const rate = service.getExchangeRate('EUR', 'USD');
      expect(rate).toBeCloseTo(1 / 0.92, 2);
    });

    it('should calculate rate between two non-USD currencies', () => {
      // EUR to GBP: (GBP rate) / (EUR rate) = 0.79 / 0.92
      const rate = service.getExchangeRate('EUR', 'GBP');
      expect(rate).toBeCloseTo(0.79 / 0.92, 4);
    });

    it('should return 1 for unknown currencies', () => {
      const rate = service.getExchangeRate('UNKNOWN', 'USD');
      expect(rate).toBe(1);
    });
  });

  describe('convert', () => {
    it('should convert amount correctly', () => {
      const result = service.convert(100, 'USD', 'EUR');
      expect(result).toBeCloseTo(92, 0);
    });

    it('should return same amount for same currency', () => {
      const result = service.convert(100, 'USD', 'USD');
      expect(result).toBe(100);
    });

    it('should handle zero amount', () => {
      const result = service.convert(0, 'USD', 'EUR');
      expect(result).toBe(0);
    });

    it('should handle negative amounts', () => {
      const result = service.convert(-100, 'USD', 'EUR');
      expect(result).toBeCloseTo(-92, 0);
    });
  });

  describe('formatCurrency', () => {
    it('should format USD correctly', () => {
      const result = service.formatCurrency(1234.56, 'USD');
      expect(result).toContain('1,234.56');
      expect(result).toContain('$');
    });

    it('should format EUR correctly', () => {
      const result = service.formatCurrency(1234.56, 'EUR');
      expect(result).toContain('1,234.56');
      expect(result).toContain('€');
    });

    it('should format JPY without decimals', () => {
      const result = service.formatCurrency(1234, 'JPY');
      expect(result).not.toContain('.');
      expect(result).toContain('¥');
    });

    it('should format KRW without decimals', () => {
      const result = service.formatCurrency(1234, 'KRW');
      expect(result).not.toContain('.');
      expect(result).toContain('₩');
    });

    it('should handle zero amount', () => {
      const result = service.formatCurrency(0, 'USD');
      expect(result).toContain('0');
    });
  });

  describe('setBaseCurrency', () => {
    it('should set base currency for valid code', () => {
      service.setBaseCurrency('EUR');
      expect(service.baseCurrency()).toBe('EUR');
    });

    it('should not change for invalid currency code', () => {
      const originalBase = service.baseCurrency();
      service.setBaseCurrency('INVALID');
      expect(service.baseCurrency()).toBe(originalBase);
    });

    it('should accept all supported currencies', () => {
      SUPPORTED_CURRENCIES.forEach(currency => {
        service.setBaseCurrency(currency.code);
        expect(service.baseCurrency()).toBe(currency.code);
      });
    });
  });

  describe('getCurrencyInfo', () => {
    it('should return info for valid currency', () => {
      const info = service.getCurrencyInfo('USD');
      expect(info).toBeDefined();
      expect(info?.code).toBe('USD');
      expect(info?.nameKey).toBe('currencies.usd');
      expect(info?.symbol).toBe('$');
    });

    it('should return undefined for invalid currency', () => {
      const info = service.getCurrencyInfo('INVALID');
      expect(info).toBeUndefined();
    });
  });

  describe('supportedCurrencyCodes', () => {
    it('should return array of currency codes', () => {
      const codes = service.supportedCurrencyCodes();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
      expect(codes).toContain('USD');
      expect(codes).toContain('EUR');
    });
  });

  describe('loadCurrencies', () => {
    it('should return observable of supported currencies', (done) => {
      service.loadCurrencies().subscribe(currencies => {
        expect(currencies.length).toBe(SUPPORTED_CURRENCIES.length);
        expect(currencies[0].code).toBe('USD');
        done();
      });
    });
  });

  describe('convertToBaseCurrency', () => {
    it('should convert to current base currency', () => {
      service.setBaseCurrency('USD');
      const result = service.convertToBaseCurrency(100, 'EUR');
      expect(result).toBeCloseTo(100 / 0.92, 2);
    });
  });

  describe('convertFromBaseCurrency', () => {
    it('should convert from current base currency', () => {
      service.setBaseCurrency('USD');
      const result = service.convertFromBaseCurrency(100, 'EUR');
      expect(result).toBeCloseTo(92, 0);
    });
  });
});
