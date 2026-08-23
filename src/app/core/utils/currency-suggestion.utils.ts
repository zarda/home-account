/**
 * Which currency to offer for a row whose currency nobody read.
 *
 * A ladder, not a vote: the first rung that speaks wins. Top to bottom — the
 * country the receipt itself was issued in, then where the phone is (only
 * for a receipt dated today; an old receipt was not paid where the phone is
 * now), then the last currency the user chose for such a row this session,
 * then the device locale's region. Every rung is *offered*, never applied
 * (ADR 0062), and a rung whose country the currency table does not cover is
 * silent on that rung rather than ending the ladder.
 *
 * "Silent" and "answered" are different states. A rung with no usable
 * evidence (no country, or one the table does not cover) is silent and the
 * ladder asks the next rung down. A rung that *answers* ends the ladder
 * there, even when that answer equals what the field already holds — a
 * lower rung knows less about this receipt than a higher one that already
 * spoke, so it must never be asked to break the tie (see #156).
 */
import type { CurrencySuggestion } from '../../models';
import { currencyForCountry } from './country-bounds';
import { readCountryCode } from './receipt-extraction.utils';

export interface CurrencyEvidence {
  /** ISO 3166-1 alpha-2 the reader concluded the receipt was issued in. */
  receiptCountry?: string;
  /** Alpha-2 the device's coordinates resolved to. */
  positionCountry?: string;
  /** Whether the row is dated today; the position rung speaks only then. */
  datedToday: boolean;
  /** The currency the user last chose for a fallen-back row this session. */
  sessionCurrency?: string;
  /** The device locale's region, from `localeRegion()`. */
  localeRegion?: string;
  /** What is in the field now; an equal suggestion is not worth a chip. */
  currentCurrency: string;
}

function fromCountry(
  country: string | undefined,
  reason: 'receipt' | 'position' | 'locale'
): CurrencySuggestion | null {
  const code = readCountryCode(country);
  const currency = currencyForCountry(code);
  return code && currency ? { code: currency, country: code, reason } : null;
}

export function suggestCurrency(evidence: CurrencyEvidence): CurrencySuggestion | null {
  const rungs: (CurrencySuggestion | null)[] = [
    fromCountry(evidence.receiptCountry, 'receipt'),
    evidence.datedToday ? fromCountry(evidence.positionCountry, 'position') : null,
    evidence.sessionCurrency ? { code: evidence.sessionCurrency, reason: 'session' } : null,
    fromCountry(evidence.localeRegion, 'locale'),
  ];
  const first = rungs.find((rung): rung is CurrencySuggestion => rung !== null);
  // `!first` is silence: no rung had usable evidence, so there is nothing to
  // offer. `first.code === currentCurrency` is different — a rung answered,
  // and a lower rung must not be given the chance to contradict it with
  // weaker evidence, so the ladder stops here and offers nothing rather than
  // falling through.
  if (!first || first.code === evidence.currentCurrency) {
    return null;
  }
  return first;
}

/**
 * The region the device locale implies — `en-SG` says SG outright, and a bare
 * `ja` maximizes to JP. The app's own language switch reads only the language
 * half of this tag (translation.service.ts); this reads the other half.
 */
export function localeRegion(language: string = navigator.language): string | undefined {
  try {
    return new Intl.Locale(language).maximize().region;
  } catch {
    return undefined;
  }
}

/** The country's name in the active locale, or the code when the runtime has none. */
export function countryDisplayName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code) ?? code;
  } catch {
    return code;
  }
}
