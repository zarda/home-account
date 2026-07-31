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

// The currencies offered in the pickers: curated and short enough to scroll,
// and the only ones with a translated name. It is NOT the set the app can
// handle — receipt extraction reaches every code the rates endpoint carries
// (see isCurrencyCode / currencyInfoFor).
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

/**
 * Sub-unit digits where the app deliberately disagrees with Intl. TWD is ISO
 * two-decimal and Intl reports it as such, but nobody writes NT$120.00.
 * (IDR used to be listed here for the same reason; Intl already returns 0.)
 */
const DECIMAL_PLACE_OVERRIDES: Readonly<Record<string, number>> = {
  TWD: 0,
};

/** Digits for a code Intl cannot resolve; two covers the overwhelming majority. */
const DEFAULT_DECIMAL_PLACES = 2;

// Digits are a property of the currency, not of who is reading, so the lookup
// is pinned to one locale — a caller's broken locale string cannot turn JPY
// back into a two-decimal currency.
const DECIMAL_PLACE_LOCALE = 'en';

const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

/**
 * Whether an amount in this code can be represented at all: stored, converted
 * and shown. Anything ISO-shaped qualifies, because the rates endpoint carries
 * 160+ currencies while the picker lists nineteen — a receipt in one of the
 * rest has to round-trip under its own code rather than be refused or quietly
 * booked as the base currency.
 */
export function isCurrencyCode(code: string): boolean {
  return typeof code === 'string' && CURRENCY_CODE_PATTERN.test(code);
}

/**
 * Sub-unit digits for a currency, out of Intl's own currency data: JPY, KRW
 * and VND come back as whole-number currencies with nobody maintaining a list.
 * A malformed code makes Intl throw, and a well-formed one it has never heard
 * of resolves to two decimals; both are the sane guess.
 */
export function currencyDecimalPlaces(code: string): number {
  const normalized = typeof code === 'string' ? code.toUpperCase() : '';
  const override = DECIMAL_PLACE_OVERRIDES[normalized];
  if (override !== undefined) {
    return override;
  }

  try {
    const resolved = new Intl.NumberFormat(DECIMAL_PLACE_LOCALE, {
      style: 'currency',
      currency: normalized
    }).resolvedOptions();
    return resolved.maximumFractionDigits ?? DEFAULT_DECIMAL_PLACES;
  } catch {
    return DEFAULT_DECIMAL_PLACES;
  }
}

/**
 * Descriptor for any representable code. Currencies past the curated list have
 * no symbol and no translated name, so they carry their ISO code in both
 * slots: TranslationService echoes an unknown key back, which is exactly the
 * "MXN" we want on screen.
 */
export function currencyInfoFor(code: string): CurrencyInfo | undefined {
  if (!isCurrencyCode(code)) {
    return undefined;
  }
  const normalized = code.toUpperCase();
  return (
    SUPPORTED_CURRENCIES.find(c => c.code === normalized) ??
    { code: normalized, nameKey: normalized, symbol: normalized }
  );
}

export type ExchangeRates = Record<string, number>;

export interface CachedRates {
  rates: ExchangeRates;
  lastUpdated: Timestamp;
}
