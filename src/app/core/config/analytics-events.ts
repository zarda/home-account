import events from './analytics-events.json';

/**
 * The GA4 event taxonomy: every event this app may send, the parameters each
 * one carries, and the complete set of values each parameter may take.
 *
 * It lives in JSON rather than TypeScript so that one file can serve three
 * consumers without any of them drifting: the compiler derives the call
 * signatures from it, AnalyticsService enforces it at runtime, and
 * scripts/check-analytics-registry.mjs reads it with JSON.parse to verify the
 * table in docs/analytics.md. A .ts source would need regex parsing from Node
 * and would break on a formatting change.
 *
 * Every parameter value is enumerated, and that is the privacy boundary rather
 * than a convenience: it is what makes it structurally impossible for an
 * amount, a merchant, a category name, a note or a search term to reach GA4.
 * A parameter whose values cannot be listed in advance does not belong here.
 *
 * Changing this file means updating docs/analytics.md in the same commit; the
 * consistency check enforces that.
 */
export const ANALYTICS_EVENTS = events;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

/** Parameter names and their allowed values, for one event. */
type ParamsOf<E extends AnalyticsEventName> = (typeof ANALYTICS_EVENTS)[E]['params'];

/**
 * The typed payload for an event: each declared parameter, restricted to the
 * literal values the taxonomy lists.
 */
export type AnalyticsEventParams<E extends AnalyticsEventName> = {
  [K in keyof ParamsOf<E>]: ParamsOf<E>[K] extends readonly (infer V)[] ? V : never;
};

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

/**
 * Strip a payload down to what the taxonomy allows, or reject it entirely.
 *
 * Types disappear at runtime, and call sites build these objects from signals
 * and conditionals, so the compiler's guarantee is not the one that matters
 * once the app is running. Returning null rather than a cleaned object for an
 * out-of-range value is deliberate: a value nobody enumerated is a sign the
 * call site is passing something derived from user data, and dropping the
 * parameter while still sending the event would hide that. The offending value
 * is never logged, for the same reason it is not sent.
 */
export function validateAnalyticsParams(
  event: string,
  params: Record<string, unknown>
): Record<string, string> | null {
  const declared = (ANALYTICS_EVENTS as Record<string, { params: Record<string, string[]> }>)[
    event
  ];
  if (!declared) {
    return null;
  }

  const allowed = declared.params;
  const validated: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    const permitted = allowed[key];
    if (!permitted) {
      // A parameter the taxonomy does not declare. Dropping it silently would
      // let an undocumented dimension accumulate in the property.
      return null;
    }
    const asString = typeof value === 'boolean' ? String(value) : value;
    if (typeof asString !== 'string' || !permitted.includes(asString)) {
      return null;
    }
    validated[key] = asString;
  }

  // Every declared parameter must be present: a partially-filled event is a
  // reporting trap, since GA4 shows the gap as a legitimate "(not set)" bucket
  // rather than as an error.
  for (const key of Object.keys(allowed)) {
    if (!(key in validated)) {
      return null;
    }
  }

  return validated;
}
