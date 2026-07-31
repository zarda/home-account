import { Injectable, inject, signal, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { TranslationService } from './translation.service';
import {
  CurrencyInfo,
  ExchangeRates,
  CachedRates,
  SUPPORTED_CURRENCIES,
  currencyDecimalPlaces,
  currencyInfoFor,
  isCurrencyCode
} from '../../models';

const CACHE_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours
// Using ExchangeRate-API (free, no API key required, supports TWD/VND)
const CURRENCY_API_URL = 'https://open.er-api.com/v6/latest/USD';
// Rates were cached in a shared /currencies/rates document that every signed-in
// user could write, which let one account rewrite the rates converting every
// other account's amounts. The cache is per-device now and that collection is
// closed (firestore.rules); rates are global data, so there is nothing to gain
// from storing them per account.
const RATES_CACHE_KEY = 'home-account.exchangeRates';

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private translationService = inject(TranslationService);

  // Signals
  currencies = signal<CurrencyInfo[]>(SUPPORTED_CURRENCIES);
  exchangeRates = signal<Map<string, number>>(new Map([['USD', 1]]));
  isLoading = signal<boolean>(false);
  lastUpdated = signal<Date | null>(null);
  private ratesInitialized = signal<boolean>(false);
  private initPromise: Promise<void> | null = null;

  // Computed signals
  supportedCurrencyCodes = computed(() =>
    this.currencies().map(c => c.code)
  );

  constructor() {
    this.initPromise = this.initializeRates();
  }

  // Initialize exchange rates from cache or API
  private async initializeRates(): Promise<void> {
    try {
      // Try to load from the device cache first
      const cached = this.getCachedRates();

      if (cached && !this.isExpired(cached.lastUpdated)) {
        this.setRatesFromCache(cached);
        this.ratesInitialized.set(true);
        return;
      }

      // Fetch fresh rates if cache is expired or doesn't exist
      await this.refreshRates();
      this.ratesInitialized.set(true);
    } catch (error) {
      console.error('Failed to initialize exchange rates:', error);
      // Use default rates (1:1 with USD)
      this.setDefaultRates();
      this.ratesInitialized.set(true);
    }
  }

  // Wait for exchange rates to be initialized
  async ensureRatesLoaded(): Promise<void> {
    if (this.ratesInitialized()) {
      return;
    }
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  // Load currencies (returns supported currencies list)
  loadCurrencies(): Observable<CurrencyInfo[]> {
    return of(SUPPORTED_CURRENCIES);
  }

  // Get exchange rate between two currencies
  getExchangeRate(from: string, to: string): number {
    if (from === to) return 1;

    const rates = this.exchangeRates();
    const fromRate = rates.get(from) ?? 1;
    const toRate = rates.get(to) ?? 1;

    // Convert through USD (base currency)
    return toRate / fromRate;
  }

  // Convert amount from one currency to another
  convert(amount: number, from: string, to: string): number {
    const rate = this.getExchangeRate(from, to);
    return amount * rate;
  }

  // Base-currency value of a transaction for aggregation. Prefers the
  // exchange-rate snapshot stored at write time so totals are deterministic
  // (independent of whether live rates have finished loading), but only when
  // the snapshot is trustworthy; otherwise converts live:
  //  - no snapshot (legacy rows written before it existed);
  //  - snapshot stamped against a different base currency (the preference
  //    changed since the row was written);
  //  - corrupt cross-currency snapshot: a 1:1 rate between two different
  //    currencies can only come from unloaded rates at write time or a
  //    since-changed base currency, never from a real market rate.
  amountInBase(
    transaction: {
      amount: number;
      currency: string;
      amountInBaseCurrency?: number;
      exchangeRate?: number;
      baseCurrency?: string;
    },
    baseCurrency: string
  ): number {
    const snapshot = transaction.amountInBaseCurrency;
    const liveConvert = () =>
      this.convert(transaction.amount, transaction.currency, baseCurrency);

    if (snapshot == null) return liveConvert();

    const stampMismatch =
      transaction.baseCurrency != null && transaction.baseCurrency !== baseCurrency;

    const looksUnconverted =
      transaction.exchangeRate != null
        ? transaction.exchangeRate === 1
        : snapshot === transaction.amount;
    const corrupt = transaction.currency !== baseCurrency && looksUnconverted;

    return stampMismatch || corrupt ? liveConvert() : snapshot;
  }

  // Refresh exchange rates from ExchangeRate-API (free, no key required)
  async refreshRates(): Promise<void> {
    this.isLoading.set(true);

    try {
      const response = await fetch(CURRENCY_API_URL);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();

      // ExchangeRate-API returns { result: "success", rates: { USD: 1, EUR: 0.92, ... } }
      if (data.result === 'success' && data.rates) {
        const rates = new Map<string, number>(Object.entries(data.rates));
        this.exchangeRates.set(rates);
        this.lastUpdated.set(new Date());

        this.cacheRates(data.rates);
      }
    } catch (error) {
      console.error('Failed to refresh exchange rates:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Format currency amount for display
  formatCurrency(amount: number, currencyCode: string): string {
    const locale = this.translationService.getIntlLocale();
    const digits = currencyDecimalPlaces(currencyCode);

    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(amount);
    } catch {
      // Fallback formatting
      const symbol = this.getCurrencyInfo(currencyCode)?.symbol ?? currencyCode;
      return `${symbol}${amount.toFixed(digits)}`;
    }
  }

  /**
   * Plain-digit amount for machine-facing text (LLM prompts, exports): no
   * symbol, no grouping; sub-digits only for currencies that use them.
   */
  formatAmount(amount: number, currencyCode: string): string {
    return amount.toFixed(currencyDecimalPlaces(currencyCode));
  }

  // Get currency info by code. Falls back to an ISO-code descriptor for the
  // currencies the picker does not carry: extraction can hand back any of the
  // 160+ codes the rates endpoint knows, and those must still render.
  getCurrencyInfo(code: string): CurrencyInfo | undefined {
    return this.currencies().find(c => c.code === code) ?? currencyInfoFor(code);
  }

  /**
   * Whether an amount in this code can be stored and converted. The seam
   * between what extraction may produce and what the picker offers: a receipt
   * in a currency nobody translated still belongs under its own code, so this
   * is the check import paths want, not membership of SUPPORTED_CURRENCIES.
   */
  canRepresentCurrency(code: string): boolean {
    if (!isCurrencyCode(code)) {
      return false;
    }
    const normalized = code.toUpperCase();
    // The curated list stays representable before the first rates fetch lands.
    return this.exchangeRates().has(normalized)
      || this.supportedCurrencyCodes().includes(normalized);
  }

  // Get list of supported currencies (the picker's curated list)
  getSupportedCurrencies(): CurrencyInfo[] {
    return this.currencies();
  }

  // Cache rates on the device
  private cacheRates(rates: ExchangeRates): void {
    try {
      localStorage.setItem(
        RATES_CACHE_KEY,
        JSON.stringify({ rates, lastUpdatedMs: Date.now() })
      );
    } catch (error) {
      // Private browsing and full quotas both throw here; the API fetch still
      // populated the live rates, so a failed cache write is not fatal.
      console.error('Failed to cache rates:', error);
    }
  }

  // Get cached rates from the device
  private getCachedRates(): CachedRates | null {
    try {
      const raw = localStorage.getItem(RATES_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as { rates?: unknown; lastUpdatedMs?: unknown };
      if (typeof parsed?.lastUpdatedMs !== 'number' || !parsed.rates) {
        return null;
      }

      const rates: ExchangeRates = {};
      for (const [code, value] of Object.entries(parsed.rates as Record<string, unknown>)) {
        // Only include numeric values (exchange rates), skip anything else
        if (typeof value === 'number') {
          rates[code] = value;
        }
      }

      return { rates, lastUpdated: Timestamp.fromMillis(parsed.lastUpdatedMs) };
    } catch (error) {
      console.error('Failed to get cached rates:', error);
      return null;
    }
  }

  // Check if cached rates are expired
  private isExpired(lastUpdated: Timestamp): boolean {
    const updatedTime = lastUpdated.toDate().getTime();
    const now = Date.now();
    return now - updatedTime > CACHE_DURATION_MS;
  }

  // Set rates from cache
  private setRatesFromCache(cached: CachedRates): void {
    const rates = new Map<string, number>(Object.entries(cached.rates));
    rates.set('USD', 1);
    this.exchangeRates.set(rates);
    this.lastUpdated.set(cached.lastUpdated.toDate());
  }

  // Get default rates as object (fallback when API is unavailable)
  private getDefaultRatesObject(): Record<string, number> {
    return {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      THB: 34.5,
      JPY: 149.5,
      CNY: 7.25,
      KRW: 1320,
      SGD: 1.34,
      AUD: 1.53,
      INR: 83.2,
      TWD: 31.5,
      HKD: 7.82,
      MYR: 4.7,
      PHP: 56.2,
      IDR: 15700,
      VND: 24500,
      CAD: 1.36,
      CHF: 0.88,
      NZD: 1.64
    };
  }

  // Set default rates (all 1:1 with USD for development)
  private setDefaultRates(): void {
    const approximateRates = this.getDefaultRatesObject();
    const defaultRates = new Map<string, number>(Object.entries(approximateRates));
    this.exchangeRates.set(defaultRates);
    this.lastUpdated.set(new Date());
  }
}
