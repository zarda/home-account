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
  name: string;
  symbol: string;
}

// Commonly used currencies
export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
];

export type ExchangeRates = Record<string, number>;

export interface CachedRates {
  rates: ExchangeRates;
  lastUpdated: Timestamp;
}
