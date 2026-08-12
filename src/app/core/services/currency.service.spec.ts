import { TestBed } from '@angular/core/testing';
import { CurrencyService } from './currency.service';
import { FirestoreService } from './firestore.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import {
  SUPPORTED_CURRENCIES,
  currencyDecimalPlaces,
  currencyInfoFor,
  isCurrencyCode
} from '../../models';

describe('CurrencyService', () => {
  let service: CurrencyService;
  let mockFirestore: MockFirestoreService;

  beforeEach(() => {
    // A rates cache leaked from another spec file would win over the
    // constants under the initialization ladder and clobber the seeded
    // table below a microtask after the seed. Start clean.
    localStorage.removeItem('home-account.exchangeRates');

    // The constructor starts a rates refresh; on CI runners the fetch can
    // succeed and overwrite the seeded rate table below with live values
    // (and write cached rates through the Firestore mock) mid-test.
    // Reject it so specs stay deterministic.
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

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

  describe('amountInBase', () => {
    it('prefers the stored write-time snapshot over live conversion', () => {
      const result = service.amountInBase(
        { amount: 3800, currency: 'JPY', amountInBaseCurrency: 25.42 },
        'USD'
      );
      expect(result).toBe(25.42);
    });

    it('keeps a stored snapshot of zero', () => {
      const result = service.amountInBase(
        { amount: 0, currency: 'JPY', amountInBaseCurrency: 0 },
        'USD'
      );
      expect(result).toBe(0);
    });

    it('falls back to live conversion for legacy rows without a snapshot', () => {
      const result = service.amountInBase({ amount: 100, currency: 'EUR' }, 'USD');
      expect(result).toBeCloseTo(100 / 0.92, 1);
    });

    it('keeps a snapshot stamped against the current base currency', () => {
      const result = service.amountInBase(
        { amount: 3800, currency: 'JPY', amountInBaseCurrency: 25.42, exchangeRate: 1 / 149.5, baseCurrency: 'USD' },
        'USD'
      );
      expect(result).toBe(25.42);
    });

    it('reconverts live when the snapshot was stamped against another base', () => {
      // Written while base was USD, then the user switched base to JPY.
      const result = service.amountInBase(
        { amount: 100, currency: 'USD', amountInBaseCurrency: 100, exchangeRate: 1, baseCurrency: 'USD' },
        'JPY'
      );
      expect(result).toBeCloseTo(100 * 149.5, 0);
    });

    it('reconverts a corrupt cross-currency snapshot with a 1:1 rate', () => {
      // Written against unloaded rates: USD row snapshotted 1:1 into a JPY base.
      const result = service.amountInBase(
        { amount: 100, currency: 'USD', amountInBaseCurrency: 100, exchangeRate: 1 },
        'JPY'
      );
      expect(result).toBeCloseTo(100 * 149.5, 0);
    });

    it('reconverts a corrupt unstamped snapshot equal to the raw amount', () => {
      // No exchangeRate field either — detect via snapshot === amount.
      const result = service.amountInBase(
        { amount: 3800, currency: 'JPY', amountInBaseCurrency: 3800 },
        'USD'
      );
      expect(result).toBeCloseTo(3800 / 149.5, 1);
    });

    it('keeps a same-currency snapshot equal to the raw amount', () => {
      const result = service.amountInBase(
        { amount: 100, currency: 'USD', amountInBaseCurrency: 100, exchangeRate: 1 },
        'USD'
      );
      expect(result).toBe(100);
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

    it('should format TWD without decimals', () => {
      const result = service.formatCurrency(1234, 'TWD');
      expect(result).not.toContain('.');
      expect(result).toContain('1,234');
    });

    it('should format VND without decimals', () => {
      const result = service.formatCurrency(1234, 'VND');
      expect(result).not.toContain('.');
      expect(result).toContain('1,234');
    });

    it('should handle zero amount', () => {
      const result = service.formatCurrency(0, 'USD');
      expect(result).toContain('0');
    });
  });

  describe('formatAmount', () => {
    it('drops sub-digits for zero-decimal currencies', () => {
      expect(service.formatAmount(1500, 'JPY')).toBe('1500');
      expect(service.formatAmount(1500, 'TWD')).toBe('1500');
      expect(service.formatAmount(1500, 'KRW')).toBe('1500');
    });

    it('rounds fractional amounts in zero-decimal currencies', () => {
      expect(service.formatAmount(1500.4, 'JPY')).toBe('1500');
      expect(service.formatAmount(1500.6, 'TWD')).toBe('1501');
    });

    it('keeps two decimals for decimal currencies', () => {
      expect(service.formatAmount(12.34, 'USD')).toBe('12.34');
      expect(service.formatAmount(1234.5, 'EUR')).toBe('1234.50');
    });

    it('emits plain digits with no symbol or grouping', () => {
      expect(service.formatAmount(1234567, 'JPY')).toBe('1234567');
      expect(service.formatAmount(1234567.891, 'USD')).toBe('1234567.89');
    });

    it('gets sub-digits right for currencies the picker never listed', () => {
      expect(service.formatAmount(1500, 'CLP')).toBe('1500');
      expect(service.formatAmount(1500, 'IDR')).toBe('1500');
      expect(service.formatAmount(1.2345, 'BHD')).toBe('1.234');
      expect(service.formatAmount(12.345, 'MXN')).toBe('12.35');
    });

    it('falls back to two decimals for a code Intl rejects', () => {
      expect(service.formatAmount(12.345, 'DOLLARS')).toBe('12.35');
    });
  });

  describe('currencyDecimalPlaces', () => {
    it('reads sub-digits out of Intl rather than a maintained list', () => {
      expect(currencyDecimalPlaces('USD')).toBe(2);
      expect(currencyDecimalPlaces('JPY')).toBe(0);
      expect(currencyDecimalPlaces('KRW')).toBe(0);
      expect(currencyDecimalPlaces('VND')).toBe(0);
      expect(currencyDecimalPlaces('IDR')).toBe(0);
      expect(currencyDecimalPlaces('BHD')).toBe(3);
    });

    it('keeps TWD whole where Intl says two decimals', () => {
      expect(currencyDecimalPlaces('TWD')).toBe(0);
    });

    it('accepts a lowercase code', () => {
      expect(currencyDecimalPlaces('jpy')).toBe(0);
      expect(currencyDecimalPlaces('twd')).toBe(0);
    });

    it('falls back to two decimals when Intl throws on the code', () => {
      expect(() => currencyDecimalPlaces('')).not.toThrow();
      expect(currencyDecimalPlaces('')).toBe(2);
      expect(currencyDecimalPlaces('US')).toBe(2);
      expect(currencyDecimalPlaces('日本円')).toBe(2);
    });

    it('falls back to two decimals for a well-formed code Intl does not know', () => {
      expect(currencyDecimalPlaces('ZZZ')).toBe(2);
    });
  });

  describe('isCurrencyCode', () => {
    it('accepts any ISO-shaped code, not just the picker list', () => {
      expect(isCurrencyCode('USD')).toBeTrue();
      expect(isCurrencyCode('MXN')).toBeTrue();
      expect(isCurrencyCode('mxn')).toBeTrue();
    });

    it('rejects anything that is not a three-letter code', () => {
      expect(isCurrencyCode('INVALID')).toBeFalse();
      expect(isCurrencyCode('US')).toBeFalse();
      expect(isCurrencyCode('US1')).toBeFalse();
      expect(isCurrencyCode('')).toBeFalse();
    });
  });

  describe('currencyInfoFor', () => {
    it('returns the curated entry when there is one', () => {
      expect(currencyInfoFor('USD')?.symbol).toBe('$');
      expect(currencyInfoFor('usd')?.code).toBe('USD');
    });

    it('describes an untranslated currency by its ISO code', () => {
      expect(currencyInfoFor('MXN')).toEqual({ code: 'MXN', nameKey: 'MXN', symbol: 'MXN' });
    });

    it('returns nothing for a code that cannot be represented', () => {
      expect(currencyInfoFor('INVALID')).toBeUndefined();
    });
  });

  describe('canRepresentCurrency', () => {
    it('accepts a currency the rates table knows but the picker does not', () => {
      service.exchangeRates.set(new Map([['USD', 1], ['MXN', 17.2]]));
      expect(service.canRepresentCurrency('MXN')).toBeTrue();
      expect(service.canRepresentCurrency('mxn')).toBeTrue();
    });

    it('accepts a picker currency before rates have loaded', () => {
      service.exchangeRates.set(new Map([['USD', 1]]));
      expect(service.canRepresentCurrency('THB')).toBeTrue();
    });

    it('rejects a code no rates table carries', () => {
      service.exchangeRates.set(new Map([['USD', 1]]));
      expect(service.canRepresentCurrency('ZZZ')).toBeFalse();
    });

    it('rejects a malformed code', () => {
      expect(service.canRepresentCurrency('INVALID')).toBeFalse();
      expect(service.canRepresentCurrency('')).toBeFalse();
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

    it('describes a currency outside the picker by its ISO code', () => {
      const info = service.getCurrencyInfo('MXN');
      expect(info?.code).toBe('MXN');
      expect(info?.symbol).toBe('MXN');
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
});

// Sibling block on purpose: these specs build the service themselves, under
// their own fetch stub and their own device-cache state, because the thing
// under test is the initialization ladder the shared beforeEach gets out of
// the way of (rejected fetch, hand-seeded table).
describe('CurrencyService rate initialization', () => {
  // Not exported by the service; re-declared literal, the same way the
  // cloud-llm-provider smoke suite keeps itself off the network.
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const HOUR_MS = 60 * 60 * 1000;

  // Probe values differ from every compiled-in constant (JPY is 149.5 there)
  // and include a code the constants do not carry (MXN), so assertions can
  // tell the cached, fetched and constant tables apart.
  const CACHED_RATES = { USD: 1, JPY: 157, MXN: 17.2 };
  const FETCHED_RATES = { USD: 1, JPY: 151.25, MXN: 16.9 };

  // The provider reports failures in band: HTTP 200 carrying an error body.
  const ERROR_BODY = { result: 'error', 'error-type': 'rate-limited' };

  function stubFetch(body: unknown): jasmine.Spy {
    const spy = spyOn(window, 'fetch');
    if (body === 'reject') {
      spy.and.rejectWith(new Error('network down in specs'));
    } else {
      // A fresh Response per call: json() is single-use, and one spec drives
      // two fetches (constructor init, then an explicit refreshRates).
      spy.and.callFake(async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }
    return spy;
  }

  /** Seeds the device cache and returns the stamp it wrote. */
  function seedCache(rates: Record<string, number>, ageMs: number): number {
    const lastUpdatedMs = Date.now() - ageMs;
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ rates, lastUpdatedMs }));
    return lastUpdatedMs;
  }

  async function buildService(): Promise<CurrencyService> {
    TestBed.configureTestingModule({
      providers: [
        CurrencyService,
        { provide: FirestoreService, useClass: MockFirestoreService }
      ]
    });
    const service = TestBed.inject(CurrencyService);
    // The constructor kicked the initialization chain off; settle it so every
    // assertion sees the table the ladder actually chose.
    await service.ensureRatesLoaded();
    return service;
  }

  beforeEach(() => localStorage.removeItem(RATES_CACHE_KEY));
  afterEach(() => localStorage.removeItem(RATES_CACHE_KEY));

  it('falls back past a 200 response whose body reports an error', async () => {
    stubFetch(ERROR_BODY);
    const service = await buildService();

    expect(service.exchangeRates().size).toBeGreaterThan(1);
    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(149.5, 4);
  });

  it('leaves the device cache unwritten on an error body', async () => {
    stubFetch(ERROR_BODY);
    await buildService();

    expect(localStorage.getItem(RATES_CACHE_KEY)).toBeNull();
  });

  it('rejects refreshRates on an error body without touching the loaded table', async () => {
    stubFetch(ERROR_BODY);
    const service = await buildService();

    await expectAsync(service.refreshRates()).toBeRejected();
    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(149.5, 4);
    expect(service.isLoading()).toBeFalse();
  });

  it('treats a success body without rates as a failure', async () => {
    // The shape a provider-side field rename would produce.
    stubFetch({ result: 'success', conversion_rates: FETCHED_RATES });
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(149.5, 4);
  });

  it('treats a success body with an empty table as a failure', async () => {
    stubFetch({ result: 'success', rates: {} });
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(149.5, 4);
    expect(localStorage.getItem(RATES_CACHE_KEY)).toBeNull();
  });

  it('serves the expired cache when the fetch fails', async () => {
    const stamp = seedCache(CACHED_RATES, 13 * HOUR_MS);
    stubFetch('reject');
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(157, 4);
    expect(service.exchangeRates().has('MXN')).toBeTrue();
    // The stamp is the cache's own write time, not the fallback's wall clock.
    expect(service.lastUpdated()?.getTime()).toBe(stamp);
  });

  it('serves the expired cache when the API answers with an error body', async () => {
    seedCache(CACHED_RATES, 13 * HOUR_MS);
    stubFetch(ERROR_BODY);
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(157, 4);
  });

  it('falls back to the constants only when nothing was ever cached', async () => {
    stubFetch('reject');
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(149.5, 4);
    expect(service.exchangeRates().has('MXN')).toBeFalse();
  });

  it('reports no update time when only constants are loaded', async () => {
    stubFetch('reject');
    const service = await buildService();

    expect(service.lastUpdated()).toBeNull();
  });

  it('uses a fresh cache without fetching', async () => {
    seedCache(CACHED_RATES, HOUR_MS);
    const fetchSpy = stubFetch({ result: 'success', rates: FETCHED_RATES });
    const service = await buildService();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(157, 4);
  });

  it('installs and caches the table from a success body', async () => {
    stubFetch({ result: 'success', rates: FETCHED_RATES });
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(151.25, 4);
    const cached = JSON.parse(localStorage.getItem(RATES_CACHE_KEY) ?? '{}') as {
      rates?: Record<string, number>;
    };
    expect(cached.rates?.['JPY']).toBe(151.25);
    expect(service.lastUpdated()).toBeInstanceOf(Date);
  });

  it('refuses a cached table with a single entry', async () => {
    // Indistinguishable from the constructor's USD-only placeholder — even
    // fresh, it must lose to the constants.
    seedCache({ USD: 1 }, 0);
    stubFetch('reject');
    const service = await buildService();

    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(149.5, 4);
  });

  it('pins USD to 1 when restoring from the cache', async () => {
    seedCache({ JPY: 157, MXN: 17.2 }, 13 * HOUR_MS);
    stubFetch('reject');
    const service = await buildService();

    expect(service.exchangeRates().get('USD')).toBe(1);
    expect(service.getExchangeRate('USD', 'JPY')).toBeCloseTo(157, 4);
  });
});
