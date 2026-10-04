/**
 * The in-app paths a tap on a reminder opens.
 *
 * Every builder returns a root-relative path, never a URL: the route rides in
 * a notification's payload and comes back from the worker or the operating
 * system as plain data, so anything that reads one passes it through
 * `safeAppRoute` before navigating.
 */

/** The dashboard, asked to bring one upcoming bill into view. */
export function billRoute(ruleId: string): string {
  return `/dashboard?bill=${encodeURIComponent(ruleId)}`;
}

/** The budgets tab, where an alert's budget is listed. */
export function budgetRoute(): string {
  return '/budgets?tab=budgets';
}

/**
 * The dashboard, asked to bring the recap for one week into view.
 *
 * Takes the week's key rather than a moment, so the route is fixed when the
 * nudge is booked and reads the same in whatever zone the tap lands.
 */
export function recapRoute(weekKey: string): string {
  return `/dashboard?recap=${encodeURIComponent(weekKey)}`;
}

/**
 * C0 controls, DEL and C1 controls. A URL parser strips tab and newline before
 * it reads anything, so `/\t/host` opens as the protocol-relative `//host`.
 */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * The candidate when it is a path on this origin, otherwise null.
 *
 * A path is accepted only when it starts with exactly one `/` and carries no
 * backslash and no control character. `//host` is protocol-relative, a URL
 * parser reads `\` as `/` (so `/\host` is `//host` too), and the controls are
 * stripped before parsing; anything with a scheme fails the leading `/`.
 */
export function safeAppRoute(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;
  if (candidate.includes('\\')) return null;
  if (CONTROL_CHARACTER.test(candidate)) return null;
  return candidate;
}
