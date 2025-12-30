import { Injectable, inject, signal, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import {
  CurrencyInfo,
  ExchangeRates,
  CachedRates,
  SUPPORTED_CURRENCIES
} from '../../models';
import { environment } from '../../../environments/environment';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const CURRENCY_API_URL = 'https://api.freecurrencyapi.com/v1/latest';

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private firestoreService = inject(FirestoreService);

  // Signals
  currencies = signal<CurrencyInfo[]>(SUPPORTED_CURRENCIES);
  exchangeRates = signal<Map<string, number>>(new Map([['USD', 1]]));
  baseCurrency = signal<string>('USD');
  isLoading = signal<boolean>(false);
  lastUpdated = signal<Date | null>(null);

  // Computed signals
  supportedCurrencyCodes = computed(() =>
    this.currencies().map(c => c.code)
  );

  constructor() {
    this.initializeRates();
  }

  // Initialize exchange rates from cache or API
  private async initializeRates(): Promise<void> {
    try {
      // Try to load from Firestore cache first
      const cached = await this.getCachedRates();

      if (cached && !this.isExpired(cached.lastUpdated)) {
        this.setRatesFromCache(cached);
        return;
      }

      // Fetch fresh rates if cache is expired or doesn't exist
      await this.refreshRates();
    } catch (error) {
      console.error('Failed to initialize exchange rates:', error);
      // Use default rates (1:1 with USD)
      this.setDefaultRates();
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

  // Refresh exchange rates from API
  async refreshRates(): Promise<void> {
    this.isLoading.set(true);

    try {
      const apiKey = environment.currencyApiKey;

      if (!apiKey || apiKey.startsWith('${')) {
        console.warn('Currency API key not configured, using default rates');
        this.setDefaultRates();
        return;
      }

      const currencies = this.supportedCurrencyCodes().join(',');
      const response = await fetch(
        `${CURRENCY_API_URL}?apikey=${apiKey}&base_currency=USD&currencies=${currencies}`
      );

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.data) {
        const rates = new Map<string, number>(Object.entries(data.data));
        rates.set('USD', 1); // Ensure USD is in the map
        this.exchangeRates.set(rates);
        this.lastUpdated.set(new Date());

        // Cache rates in Firestore
        await this.cacheRates(data.data);
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
    const currency = this.currencies().find(c => c.code === currencyCode);

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: currencyCode === 'JPY' || currencyCode === 'KRW' ? 0 : 2,
        maximumFractionDigits: currencyCode === 'JPY' || currencyCode === 'KRW' ? 0 : 2
      }).format(amount);
    } catch {
      // Fallback formatting
      const symbol = currency?.symbol ?? currencyCode;
      return `${symbol}${amount.toFixed(2)}`;
    }
  }

  // Get currency info by code
  getCurrencyInfo(code: string): CurrencyInfo | undefined {
    return this.currencies().find(c => c.code === code);
  }

  // Set the base currency for conversions
  setBaseCurrency(code: string): void {
    if (this.supportedCurrencyCodes().includes(code)) {
      this.baseCurrency.set(code);
    }
  }

  // Cache rates in Firestore
  private async cacheRates(rates: ExchangeRates): Promise<void> {
    try {
      await this.firestoreService.setDocument('currencies/rates', {
        ...rates,
        lastUpdated: Timestamp.now()
      });
    } catch (error) {
      console.error('Failed to cache rates:', error);
    }
  }

  // Get cached rates from Firestore
  private async getCachedRates(): Promise<CachedRates | null> {
    try {
      const doc = await this.firestoreService.getDocument<CachedRates & { lastUpdated: Timestamp }>(
        'currencies/rates'
      );

      if (doc) {
        const { lastUpdated, ...rates } = doc;
        return {
          rates: rates as unknown as ExchangeRates,
          lastUpdated
        };
      }
      return null;
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

  // Set default rates (all 1:1 with USD for development)
  private setDefaultRates(): void {
    const defaultRates = new Map<string, number>();

    // Set some approximate rates for development
    const approximateRates: Record<string, number> = {
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

    for (const [code, rate] of Object.entries(approximateRates)) {
      defaultRates.set(code, rate);
    }

    this.exchangeRates.set(defaultRates);
    this.lastUpdated.set(new Date());
  }

  // Convert amount to base currency
  convertToBaseCurrency(amount: number, fromCurrency: string): number {
    return this.convert(amount, fromCurrency, this.baseCurrency());
  }

  // Convert amount from base currency
  convertFromBaseCurrency(amount: number, toCurrency: string): number {
    return this.convert(amount, this.baseCurrency(), toCurrency);
  }
}
