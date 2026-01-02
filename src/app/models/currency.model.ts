import { Timestamp } from '@angular/fire/firestore';

export type SymbolPosition = 'before' | 'after';

export interface Currency {
  code: string;                  // ISO 4217 (e.g., 'USD')
  name: string;                  // 'US Dollar'
  symbol: string;                // '$'
  symbolPosition: SymbolPosition;
  decimalPlaces: number;
  exchangeRate: number;          // Rate to base currency (USD)
  lastUpdated: Timestamp;
}

export interface CurrencyInfo {
  code: string;
  nameKey: string;  // Translation key, e.g., 'currencies.usd'
  symbol: string;
}

// All currencies available in the app (ExchangeRate-API supports all these)
export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', nameKey: 'currencies.usd', symbol: '$' },
  { code: 'EUR', nameKey: 'currencies.eur', symbol: '€' },
  { code: 'GBP', nameKey: 'currencies.gbp', symbol: '£' },
  { code: 'THB', nameKey: 'currencies.thb', symbol: '฿' },
  { code: 'JPY', nameKey: 'currencies.jpy', symbol: '¥' },
  { code: 'CNY', nameKey: 'currencies.cny', symbol: '¥' },
  { code: 'KRW', nameKey: 'currencies.krw', symbol: '₩' },
  { code: 'SGD', nameKey: 'currencies.sgd', symbol: 'S$' },
  { code: 'AUD', nameKey: 'currencies.aud', symbol: 'A$' },
  { code: 'INR', nameKey: 'currencies.inr', symbol: '₹' },
  { code: 'TWD', nameKey: 'currencies.twd', symbol: 'NT$' },
  { code: 'HKD', nameKey: 'currencies.hkd', symbol: 'HK$' },
  { code: 'MYR', nameKey: 'currencies.myr', symbol: 'RM' },
  { code: 'PHP', nameKey: 'currencies.php', symbol: '₱' },
  { code: 'IDR', nameKey: 'currencies.idr', symbol: 'Rp' },
  { code: 'VND', nameKey: 'currencies.vnd', symbol: '₫' },
  { code: 'CAD', nameKey: 'currencies.cad', symbol: 'C$' },
  { code: 'CHF', nameKey: 'currencies.chf', symbol: 'CHF' },
  { code: 'NZD', nameKey: 'currencies.nzd', symbol: 'NZ$' },
];

export type ExchangeRates = Record<string, number>;

export interface CachedRates {
  rates: ExchangeRates;
  lastUpdated: Timestamp;
}
