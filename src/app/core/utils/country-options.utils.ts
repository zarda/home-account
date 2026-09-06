import { COUNTRY_CURRENCY } from './country-bounds';
import { countryDisplayName } from './currency-suggestion.utils';

/**
 * The countries a picker offers, named in the active language and ordered by
 * that name.
 *
 * The domain is the bundled bounding-box table's own country set — the same
 * list the currency ladder places a coordinate in — rather than every region
 * CLDR knows, because ADR 0008's discipline is that no country list ships
 * for the model to be steered by, and this one already exists for another
 * reason. It is travel-destination coverage, which is exactly when a country
 * gets recorded.
 *
 * A receipt can still name a region outside that set, so a selected value
 * that is not in it is appended rather than dropped — the goal picker's rule,
 * for the same reason: an arriving value must render and stay clearable.
 * Listing the whole domain rather than only the countries in use follows the
 * currency filter beside it.
 *
 * Built per call rather than memoized: the names and their order are the
 * active language's, and both have to change under a switch.
 */
export function countryOptions(locale: string, selected?: string): { code: string; name: string }[] {
  const codes = new Set(Object.keys(COUNTRY_CURRENCY));
  if (selected) codes.add(selected);
  return [...codes]
    .map(code => ({ code, name: countryDisplayName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale) || a.code.localeCompare(b.code));
}
