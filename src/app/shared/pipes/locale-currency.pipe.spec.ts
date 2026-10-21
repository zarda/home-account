import { TestBed } from '@angular/core/testing';
import { LocaleCurrencyPipe } from './locale-currency.pipe';
import { CurrencyService } from '../../core/services/currency.service';
import { TranslationService } from '../../core/services/translation.service';

/**
 * Against the real CurrencyService, so the output is the service's own
 * formatting: the account's language and the currency's own decimals.
 */
describe('LocaleCurrencyPipe', () => {
  let pipe: LocaleCurrencyPipe;
  let service: CurrencyService;
  let translation: TranslationService;

  beforeEach(() => {
    // A rates cache leaked from another spec file would be read by the
    // constructor's initialization ladder. Start clean.
    localStorage.removeItem('home-account.exchangeRates');
    // Before the first inject: the constructor starts a rates refresh, and a
    // successful live fetch would leak a cache into later specs.
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    TestBed.configureTestingModule({
      providers: [LocaleCurrencyPipe],
    });
    service = TestBed.inject(CurrencyService);
    translation = TestBed.inject(TranslationService);
    pipe = TestBed.inject(LocaleCurrencyPipe);
  });

  it('formats an amount in the default language', () => {
    expect(pipe.transform(1234.5, 'USD')).toBe('$1,234.50');
  });

  it('re-renders after a language switch', () => {
    expect(pipe.transform(1234.5, 'USD')).toBe('$1,234.50');

    translation.currentLocale.set('tc');

    expect(pipe.transform(1234.5, 'USD')).toBe('US$1,234.50');
  });

  it("keeps the currency's own decimals: a yen amount has none", () => {
    translation.currentLocale.set('ja');

    expect(pipe.transform(1234.5, 'JPY')).toBe('￥1,235');
  });

  describe('a figure that rounds to zero', () => {
    it('reads unsigned for float residue left by a subtraction', () => {
      // 12.6 - (4.2 + 8.4) is -1.78e-15: a balance that is zero to the cent.
      expect(pipe.transform(12.6 - (4.2 + 8.4), 'USD')).toBe('$0.00');
    });

    it('reads unsigned for a negative zero', () => {
      expect(pipe.transform(-0, 'USD')).toBe('$0.00');
    });

    it("reads unsigned below half of the currency's smallest unit: a yen amount has none", () => {
      translation.currentLocale.set('ja');

      expect(pipe.transform(-0.4, 'JPY')).toBe('￥0');
    });

    it('keeps the sign on a figure that still shows a unit', () => {
      expect(pipe.transform(-0.01, 'USD')).toBe('-$0.01');
    });
  });

  it('renders nothing for a missing value', () => {
    expect(pipe.transform(null, 'USD')).toBe('');
    expect(pipe.transform(undefined, 'USD')).toBe('');
  });

  it('serves the memo while the value, the code and the language are unchanged', () => {
    const format = spyOn(service, 'formatCurrency').and.callThrough();

    const first = pipe.transform(42, 'EUR');
    const second = pipe.transform(42, 'EUR');

    expect(second).toBe(first);
    expect(format).toHaveBeenCalledTimes(1);
  });
});
