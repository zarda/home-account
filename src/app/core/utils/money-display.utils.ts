import { currencyDecimalPlaces } from '../../models';

/**
 * Snaps a value that would format as a signed zero to unsigned zero.
 * −0.4 JPY rounds to "−¥0" at 0 decimals — a sign on a zero is a wrong
 * figure, so anything below half of the currency's smallest display unit
 * collapses to 0 before formatting.
 */
export function snapDisplayZero(value: number, currencyCode: string): number {
  const factor = 10 ** currencyDecimalPlaces(currencyCode);
  // Math.round(-0.4 * factor) is -0, and -0 === 0, so the sign is dropped.
  return Math.round(value * factor) === 0 ? 0 : value;
}

/**
 * Pins a WORD JOINER after a leading minus. UAX-14 permits a line break
 * between a sign and a currency symbol ("-" + "$"), so when a long negative
 * amount wraps, WebKit can strand the sign on its own line and the amount
 * below reads as positive. Chromium tailors that break away; the joiner
 * closes it everywhere.
 */
export function pinLeadingMinus(value: string): string {
  return /^[-\u2212]/.test(value) ? `${value[0]}\u2060${value.slice(1)}` : value;
}
