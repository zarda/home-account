import type { TransactionLocation } from '../../models';
import { countryDisplayName } from './currency-suggestion.utils';

/**
 * What to show for a transaction's location.
 *
 * A location map carries at least one of a name or a country, so this answers
 * for both shapes: the place someone typed or the receipt printed, and — when
 * that is all the receipt gave — the country's own name in the active
 * language.
 *
 * The country is resolved at render rather than stored as text. A display
 * name baked into the document would be one language's answer forever: a row
 * written on a Japanese phone would read 韓国 on an English one, and it would
 * be indistinguishable from a name the user typed, which is the provenance
 * `location.name` carries everywhere else (0068).
 */
export function locationLabel(
  location: TransactionLocation | null | undefined,
  locale: string
): string {
  const name = location?.name?.trim();
  if (name) return name;
  const country = location?.country?.trim();
  return country ? countryDisplayName(country, locale) : '';
}
