import type { ConsentSettings, GtagConfigParams } from '@angular/fire/analytics';
import { environment } from '../../../environments/environment';

/**
 * Configuration for the GA4 web data stream. The taxonomy of events lives
 * separately; this file is only about whether analytics runs at all and under
 * what gtag settings.
 */

/**
 * A GA4 measurement id is `G-` followed by the property's short code.
 *
 * Analytics is gated on the *shape* of the value rather than on its presence,
 * because every placeholder in this repository is a non-empty string: the two
 * committed templates ship 'YOUR_MEASUREMENT_ID', and CI writes 'ci-stub' into
 * both generated environment files (.github/workflows/ci.yml). A presence test
 * would let a placeholder build inject gtag and open a dynamic-config request
 * against a property that does not exist — and would make the unit suite talk
 * to the network.
 */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,}$/;

export function isConfiguredMeasurementId(value: string | null | undefined): boolean {
  return typeof value === 'string' && MEASUREMENT_ID_PATTERN.test(value);
}

/**
 * Whether this build was given a real GA4 web data stream.
 *
 * Read defensively: environment.ts is a re-export of a gitignored file with no
 * shared interface, so a local environment written before measurementId
 * existed would otherwise fail to compile rather than simply reporting
 * nothing.
 */
export function analyticsIsConfigured(): boolean {
  const firebase = environment.firebase as { measurementId?: string };
  return isConfiguredMeasurementId(firebase.measurementId);
}

/**
 * Parameters for the single gtag `config` command that creating the Analytics
 * instance issues.
 *
 * send_page_view is off. Navigation is reported as screen_view from the router
 * instead, so the automatic page_view would double-count the first screen and
 * then never fire again — gtag has no idea the URL changed in a single-page
 * app. Reporting screen_view on both platforms also means the web and iOS
 * streams describe a visit the same way.
 *
 * Google signals and ad personalization are off. This property is
 * measurement-only: no remarketing audiences, no demographics, no ads. Setting
 * it here as well as in the console means the browser never contacts the
 * advertising domains at all.
 *
 * anonymize_ip is deliberately absent. It is a Universal Analytics flag, it is
 * not part of GtagConfigParams, and GA4 never records a full address.
 *
 * debug_mode mirrors the build so DebugView works from a dev machine without a
 * browser extension. It is off in production. Development traffic still
 * reaches the live property, so the property carries an internal-traffic
 * filter — see docs/analytics.md.
 */
export const ANALYTICS_GTAG_CONFIG: GtagConfigParams = {
  send_page_view: false,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  debug_mode: !environment.production,
};

/**
 * Consent state pushed before the first gtag command.
 *
 * analytics_storage is granted because the instance is only ever created after
 * the account switched usage statistics on; denying it here would put the tag
 * into cookieless ping mode, which measures nothing useful and is not what was
 * asked for. The three advertising types are denied permanently — nothing in
 * this app has an advertising purpose.
 */
export const ANALYTICS_CONSENT_DEFAULTS: ConsentSettings = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'granted',
};

/**
 * Page fields attached to every event.
 *
 * gtag adds page_location and page_title on its own, and page_location carries
 * the full URL including the query string — a channel no parameter allowlist
 * can police. Overriding both on every event keeps query strings out of the
 * payload even if a future route starts carrying an id or a search term.
 * docs/analytics.md states the matching invariant: no route or query parameter
 * may carry user-entered text.
 */
export function pageFields(location: Location = window.location): {
  page_location: string;
  page_title: string;
} {
  return {
    page_location: `${location.origin}${location.pathname}`,
    page_title: 'HomeAccount',
  };
}
