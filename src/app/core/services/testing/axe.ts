import axe, { type AxeResults, type RunOptions, type Result } from 'axe-core';

/**
 * An axe-core pass a Karma spec can run over one rendered route.
 *
 * Every accessibility rule in this repo is a hand-written assertion: a label
 * this component must carry, a hit box that must reach 40px, an
 * `aria-current` the router must move. Each was written after somebody found
 * the defect by reading, and none of them sweeps for the next instance of
 * its own class — docs/accessibility.md's Known gaps has said "no automated
 * accessibility check in CI" since it was written. This is that sweep, run
 * over the seven routes `app.smoke.spec.ts` already boots against the
 * emulators.
 *
 * Three constraints bound what it can honestly assert, and all three are
 * properties of the harness rather than of axe:
 *
 *   - **i18n is not served.** Karma's asset config does not publish the
 *     catalogs, so `| translate` renders the raw key. Every accessible name
 *     on screen is therefore a non-empty string like
 *     `transactions.title` — which is exactly what a presence rule needs, and
 *     useless to a rule about content. Contrast is unaffected.
 *   - **Karma's window is 756px** (docs/ui-overflow.md). This is a phone and
 *     small-tablet audit; a rule that only fires on a desktop layout is not
 *     reached.
 *   - **The run is scoped to the routed element**, never `document`. Karma's
 *     debug.html owns `<html lang>`, a banner, its own headings and its own
 *     controls, so a document-wide run audits the test runner's chrome and
 *     reports failures nobody can fix in this repo.
 *
 * That scoping is what forces DISABLED_RULES below: a rule about the page as
 * a whole has no meaning when the thing being audited is a fragment of one.
 * Each is disabled by name rather than by dropping a whole tag, so everything
 * else in wcag2a/wcag2aa still runs — and the list is short enough to read.
 *
 * What is deliberately NOT disabled:
 *   - **color-contrast.** `src/styles.scss` is in the Karma test target and
 *     component styles compile, so the computed colours are the real ones.
 *     It is the rule with the most to say here and the slowest to run; the
 *     walkthrough's timeout is raised for it.
 *
 * What is deliberately not included:
 *   - **wcag22aa.** Its headline rule is `target-size`, and at an 800×600
 *     headless window on a mobile-first layout that measures the viewport
 *     rather than the markup. The 40px hit boxes are pinned by
 *     `transaction-list.component.spec.ts` and friends, at the widths they
 *     were designed for.
 *   - **best-practice.** Not a conformance level; it would make this a
 *     matter of opinion.
 */
export const DISABLED_RULES = [
  // Karma's debug.html is the document: these all judge a whole page.
  'html-has-lang',
  'document-title',
  'landmark-one-main',
  'landmark-unique',
  'landmark-banner-is-top-level',
  'page-has-heading-one',
  'bypass',
  // `region` wants every node inside a landmark. The routed element IS the
  // main region's content, so its children are outside one by construction.
  'region',
] as const;

/**
 * Why each rule frozen in KNOWN_VIOLATIONS is allowed to fire, keyed by rule
 * id. They are debts with names, not exemptions — the point of freezing them
 * is that the NEXT violation fails, on any route, without anybody
 * remembering to look.
 *
 * Empty is the goal state, not a special case: nothing here means nothing is
 * tolerated, and two tests in axe.spec.ts hold that shape rather than
 * assuming it — a route added to KNOWN_VIOLATIONS with no matching
 * reason, or a reason left behind for a rule nobody freezes any more, fails
 * either way.
 */
export const KNOWN_VIOLATION_REASONS: Readonly<Record<string, string>> = {};

/**
 * The violations the pass tolerates, per route: where one found later is
 * frozen, with its reason in KNOWN_VIOLATION_REASONS, until its fix lands.
 * Anything not listed here fails, which is the whole point: a debt is frozen
 * and visible, and the next regression is loud.
 *
 * Rule ids, not node counts. Counts would be a tighter ratchet, but a
 * loading spinner is on screen only while a page is still fetching — a
 * count, or a requirement that a listed rule still fire, would make this
 * spec race the emulator. So a fixed violation does not fail here; it is
 * simply removed from the table when its fix lands, and the table is short
 * enough to read.
 */
export const KNOWN_VIOLATIONS: Readonly<Record<string, readonly string[]>> = {};

/** The options every pass shares, so the smoke run and the fixture agree. */
export function axeOptions(): RunOptions {
  return {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: Object.fromEntries(DISABLED_RULES.map(id => [id, { enabled: false }])),
    resultTypes: ['violations'],
  };
}

/** Runs the shared pass over one element. */
export function runAxe(element: Element): Promise<AxeResults> {
  return axe.run(element, axeOptions());
}

/**
 * One line per violation: the rule, how many nodes broke it, and the first
 * few of their selectors. A failing expectation prints this list, so the
 * message names what to fix rather than "expected 3 to equal 0".
 */
export function summarizeViolations(results: AxeResults): string[] {
  return results.violations
    .map((violation: Result) => {
      const targets = violation.nodes
        .slice(0, 3)
        .map(node => node.target.join(' '))
        .join(', ');
      const more = violation.nodes.length > 3 ? `, +${violation.nodes.length - 3} more` : '';
      return `${violation.id} (${violation.nodes.length}): ${targets}${more}`;
    })
    .sort();
}

/** The same lines, with every violation this route already carried dropped. */
export function unexpectedViolations(
  results: AxeResults,
  route: string,
  known: Readonly<Record<string, readonly string[]>> = KNOWN_VIOLATIONS
): string[] {
  const frozen = known[route] ?? [];
  return summarizeViolations(results).filter(line => !frozen.includes(line.split(' ')[0]));
}
