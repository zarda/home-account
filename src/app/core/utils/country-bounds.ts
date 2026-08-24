/**
 * Where a coordinate is, and what money is spent there.
 *
 * Deliberately a bundled table rather than a lookup service: the case this
 * exists for is a receipt photographed abroad, which is exactly when the
 * connection is roaming, metered or absent. It also means the coordinate never
 * leaves the device.
 *
 * The cost is precision. These are bounding boxes, not borders, so a point
 * within roughly 50km of a land border can resolve to the neighbour, and a
 * point in the sea usually resolves to nothing. That is acceptable because of
 * what the answer is used for — a *suggested* currency the user accepts or
 * ignores, never a stored value — and because the largest cluster of adjacent
 * countries here shares one currency, so imprecision inside the eurozone
 * cannot produce a wrong answer at all.
 *
 * Coverage is the destinations people travel to rather than every state that
 * exists. An unlisted coordinate returns null, and the caller falls back to
 * the account's base currency exactly as it did before this existed.
 */

/** A box in degrees. `east` < `west` means the box crosses the antimeridian. */
interface CountryBox {
  country: string;
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Ordered by nothing in particular — overlaps are resolved by area, not by
 * position, so adding a country here cannot change an existing answer unless
 * its box is smaller than the one that used to win.
 */
const COUNTRY_BOXES: readonly CountryBox[] = [
  // Asia
  { country: 'JP', south: 24.0, west: 122.9, north: 45.6, east: 145.9 },
  { country: 'KR', south: 33.1, west: 125.0, north: 38.6, east: 129.6 },
  { country: 'KP', south: 37.7, west: 124.2, north: 43.0, east: 130.7 },
  { country: 'CN', south: 18.2, west: 73.5, north: 53.6, east: 134.8 },
  { country: 'TW', south: 21.9, west: 119.5, north: 25.3, east: 122.0 },
  { country: 'HK', south: 22.15, west: 113.83, north: 22.56, east: 114.44 },
  { country: 'MO', south: 22.11, west: 113.53, north: 22.22, east: 113.60 },
  { country: 'SG', south: 1.16, west: 103.6, north: 1.47, east: 104.1 },
  { country: 'MY', south: 0.85, west: 99.6, north: 7.4, east: 119.3 },
  { country: 'TH', south: 5.6, west: 97.3, north: 20.5, east: 105.6 },
  { country: 'VN', south: 8.2, west: 102.1, north: 23.4, east: 109.5 },
  { country: 'PH', south: 4.6, west: 116.9, north: 21.1, east: 126.6 },
  { country: 'ID', south: -11.0, west: 95.0, north: 6.1, east: 141.0 },
  { country: 'KH', south: 10.4, west: 102.3, north: 14.7, east: 107.6 },
  { country: 'LA', south: 13.9, west: 100.1, north: 22.5, east: 107.7 },
  { country: 'MM', south: 9.8, west: 92.2, north: 28.5, east: 101.2 },
  { country: 'IN', south: 6.7, west: 68.1, north: 35.5, east: 97.4 },
  { country: 'NP', south: 26.3, west: 80.0, north: 30.5, east: 88.2 },
  { country: 'LK', south: 5.9, west: 79.6, north: 9.9, east: 81.9 },
  { country: 'BD', south: 20.6, west: 88.0, north: 26.6, east: 92.7 },
  { country: 'PK', south: 23.6, west: 60.8, north: 37.1, east: 77.8 },
  { country: 'MN', south: 41.5, west: 87.7, north: 52.2, east: 119.9 },
  { country: 'KZ', south: 40.6, west: 46.5, north: 55.4, east: 87.3 },
  { country: 'AE', south: 22.6, west: 51.5, north: 26.1, east: 56.4 },
  { country: 'SA', south: 16.3, west: 34.5, north: 32.2, east: 55.7 },
  { country: 'QA', south: 24.5, west: 50.7, north: 26.2, east: 51.7 },
  { country: 'IL', south: 29.5, west: 34.2, north: 33.3, east: 35.9 },
  { country: 'JO', south: 29.2, west: 34.9, north: 33.4, east: 39.3 },

  // Europe — the eurozone entries below all resolve to EUR, so a box that
  // strays across one of these borders cannot produce a wrong currency.
  { country: 'GB', south: 49.9, west: -8.6, north: 60.9, east: 1.8 },
  { country: 'IE', south: 51.4, west: -10.5, north: 55.4, east: -5.9 },
  { country: 'FR', south: 41.3, west: -5.1, north: 51.1, east: 9.6 },
  { country: 'ES', south: 36.0, west: -9.3, north: 43.8, east: 3.3 },
  { country: 'PT', south: 36.9, west: -9.5, north: 42.2, east: -6.2 },
  { country: 'IT', south: 36.6, west: 6.6, north: 47.1, east: 18.5 },
  { country: 'DE', south: 47.3, west: 5.9, north: 55.1, east: 15.0 },
  { country: 'NL', south: 50.8, west: 3.4, north: 53.6, east: 7.2 },
  { country: 'BE', south: 49.5, west: 2.5, north: 51.5, east: 6.4 },
  { country: 'AT', south: 46.4, west: 9.5, north: 49.0, east: 17.2 },
  { country: 'GR', south: 34.8, west: 19.4, north: 41.8, east: 28.2 },
  { country: 'FI', south: 59.8, west: 20.6, north: 70.1, east: 31.6 },
  { country: 'CH', south: 45.8, west: 5.96, north: 47.8, east: 10.5 },
  { country: 'NO', south: 57.9, west: 4.6, north: 71.2, east: 31.1 },
  { country: 'SE', south: 55.3, west: 11.1, north: 69.1, east: 24.2 },
  { country: 'DK', south: 54.6, west: 8.1, north: 57.8, east: 15.2 },
  { country: 'PL', south: 49.0, west: 14.1, north: 54.9, east: 24.2 },
  { country: 'CZ', south: 48.6, west: 12.1, north: 51.1, east: 18.9 },
  { country: 'HU', south: 45.7, west: 16.1, north: 48.6, east: 22.9 },
  { country: 'RO', south: 43.6, west: 20.3, north: 48.3, east: 29.7 },
  { country: 'BG', south: 41.2, west: 22.4, north: 44.2, east: 28.6 },
  { country: 'HR', south: 42.4, west: 13.5, north: 46.6, east: 19.4 },
  { country: 'TR', south: 35.8, west: 26.0, north: 42.1, east: 44.8 },
  { country: 'UA', south: 44.4, west: 22.1, north: 52.4, east: 40.2 },
  { country: 'RU', south: 41.2, west: 19.6, north: 77.7, east: 180.0 },
  { country: 'IS', south: 63.3, west: -24.6, north: 66.6, east: -13.5 },

  // Americas
  { country: 'US', south: 24.5, west: -125.0, north: 49.4, east: -66.9 },
  { country: 'CA', south: 41.7, west: -141.0, north: 70.0, east: -52.6 },
  { country: 'MX', south: 14.5, west: -118.4, north: 32.7, east: -86.7 },
  { country: 'BR', south: -33.8, west: -74.0, north: 5.3, east: -34.8 },
  { country: 'AR', south: -55.1, west: -73.6, north: -21.8, east: -53.6 },
  { country: 'CL', south: -55.9, west: -75.7, north: -17.5, east: -66.4 },
  { country: 'CO', south: -4.2, west: -79.0, north: 12.5, east: -66.9 },
  { country: 'PE', south: -18.4, west: -81.3, north: -0.04, east: -68.7 },
  { country: 'UY', south: -35.0, west: -58.5, north: -30.1, east: -53.1 },
  { country: 'CR', south: 8.0, west: -85.9, north: 11.2, east: -82.6 },
  { country: 'PA', south: 7.2, west: -83.0, north: 9.6, east: -77.2 },
  { country: 'GT', south: 13.7, west: -92.2, north: 17.8, east: -88.2 },
  { country: 'DO', south: 17.5, west: -72.0, north: 19.9, east: -68.3 },

  // Oceania — FJ is the antimeridian case: its east edge is west of its west.
  { country: 'AU', south: -43.7, west: 113.2, north: -10.1, east: 153.6 },
  { country: 'NZ', south: -47.3, west: 166.4, north: -34.4, east: 178.6 },
  { country: 'FJ', south: -19.2, west: 177.0, north: -16.1, east: -179.8 },

  // Africa
  { country: 'ZA', south: -34.9, west: 16.4, north: -22.1, east: 32.9 },
  { country: 'EG', south: 22.0, west: 24.7, north: 31.7, east: 36.9 },
  { country: 'MA', south: 27.7, west: -13.2, north: 35.9, east: -1.0 },
  { country: 'KE', south: -4.7, west: 33.9, north: 5.0, east: 41.9 },
  { country: 'TZ', south: -11.7, west: 29.3, north: -0.99, east: 40.4 },
  { country: 'NG', south: 4.3, west: 2.7, north: 13.9, east: 14.6 },
  { country: 'GH', south: 4.7, west: -3.3, north: 11.2, east: 1.2 },
  { country: 'TN', south: 30.2, west: 7.5, north: 37.5, east: 11.6 },
  { country: 'ET', south: 3.4, west: 33.0, north: 14.9, east: 48.0 },
];

/**
 * The currency each listed country actually charges in.
 *
 * A country is here only if it is in the table above; the pairing is what
 * makes a location useful, and a country with no entry yields no suggestion.
 */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  JP: 'JPY', KR: 'KRW', KP: 'KPW', CN: 'CNY', TW: 'TWD', HK: 'HKD', MO: 'MOP',
  SG: 'SGD', MY: 'MYR', TH: 'THB', VN: 'VND', PH: 'PHP', ID: 'IDR', KH: 'KHR',
  LA: 'LAK', MM: 'MMK', IN: 'INR', NP: 'NPR', LK: 'LKR', BD: 'BDT', PK: 'PKR',
  MN: 'MNT', KZ: 'KZT', AE: 'AED', SA: 'SAR', QA: 'QAR', IL: 'ILS', JO: 'JOD',

  GB: 'GBP', IE: 'EUR', FR: 'EUR', ES: 'EUR', PT: 'EUR', IT: 'EUR', DE: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', GR: 'EUR', FI: 'EUR', HR: 'EUR',
  CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF',
  RO: 'RON', BG: 'BGN', TR: 'TRY', UA: 'UAH', RU: 'RUB', IS: 'ISK',

  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP',
  PE: 'PEN', UY: 'UYU', CR: 'CRC', PA: 'PAB', GT: 'GTQ', DO: 'DOP',

  AU: 'AUD', NZ: 'NZD', FJ: 'FJD',

  ZA: 'ZAR', EG: 'EGP', MA: 'MAD', KE: 'KES', TZ: 'TZS', NG: 'NGN', GH: 'GHS',
  TN: 'TND', ET: 'ETB',
};

/** Degrees squared, used only to prefer the more specific of two matches. */
function boxArea(box: CountryBox): number {
  const width = box.east >= box.west
    ? box.east - box.west
    : 360 - box.west + box.east;
  return (box.north - box.south) * width;
}

function contains(box: CountryBox, lat: number, lng: number): boolean {
  if (lat < box.south || lat > box.north) {
    return false;
  }
  // A box crossing the antimeridian wraps: its east edge is numerically west
  // of its west edge, so the longitude test becomes an "or" rather than an
  // "and". Fiji is the entry that exercises this.
  return box.east >= box.west
    ? lng >= box.west && lng <= box.east
    : lng >= box.west || lng <= box.east;
}

/**
 * The ISO 3166-1 alpha-2 country a coordinate falls in, or null.
 *
 * Where boxes overlap — and several do, because a bounding box around a country
 * with distant islands is enormous — the smallest wins. That is what makes
 * Hong Kong resolve to HK rather than to the box around all of China, and it
 * makes the result independent of the order of the table.
 */
export function countryForCoordinates(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  let best: CountryBox | null = null;
  for (const box of COUNTRY_BOXES) {
    if (contains(box, lat, lng) && (!best || boxArea(box) < boxArea(best))) {
      best = box;
    }
  }
  return best ? best.country : null;
}

/** The currency a country charges in, or null when it is not one we cover. */
export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country) {
    return null;
  }
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? null;
}

/** The currency spent at a coordinate, or null when it cannot be placed. */
export function currencyForCoordinates(lat: number, lng: number): string | null {
  return currencyForCountry(countryForCoordinates(lat, lng));
}
