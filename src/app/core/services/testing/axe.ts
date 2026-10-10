import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import axe, { type AxeResults, type RunOptions, type Result } from 'axe-core';
import type { EffectiveTheme, ThemeService } from '../theme.service';

/**
 * An axe-core pass a Karma spec can run over one rendered route.
 *
 * Every accessibility rule in this repo is a hand-written assertion: a label
 * this component must carry, a hit box that must reach 40px, an
 * `aria-current` the router must move. Each was written after somebody found
 * the defect by reading, and none of them sweeps for the next instance of
 * its own class — docs/accessibility.md's Known gaps has said "no automated
 * accessibility check in CI" since it was written. This is that sweep, run
 * over the routes `app.smoke.spec.ts` visits against the emulators; that
 * spec's `expectNoAxeViolations` keeps the list, and the routes it never
 * reaches.
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
 * Two more limits would make a pass read clean where it never looked, and
 * each has a helper below rather than a caveat:
 *
 *   - **The fold.** Every page renders inside the shell's fixed scroller,
 *     and under a fixed ancestor axe skips whatever starts at or below the
 *     viewport's bottom. Karma's frame is a few hundred pixels tall.
 *     `auditInView` scrolls a node into the band axe can score first.
 *   - **The scheme.** A pass renders the host's `prefers-color-scheme`:
 *     dark on a dark Mac, light on CI. `withScheme` forces each of
 *     `AUDIT_SCHEMES` through the real ThemeService.
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

/**
 * Jumps every running transition and finite animation in the document to
 * its end, so `color-contrast` scores the colours the page rests on.
 *
 * `provideNoMotion` stops Material's and the CDK's animations, not plain CSS
 * ones, and headless Chrome need not paint a frame between a class landing and
 * the pass — so a transition can sit on its first colours for the whole run. The
 * transactions quick filters mark "This month" after first render and carry
 * `transition: all 0.15s`; audited mid-flight, their active button read as
 * the inactive one, and a 3.45:1 dark pair passed every run but one.
 *
 * An animation with no end (a spinner, a skeleton pulse) cannot be finished —
 * `finish()` throws on it — and is left running.
 */
export function settleAnimations(doc: Document): void {
  for (const animation of doc.getAnimations()) {
    if (Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))) {
      animation.finish();
    }
  }
}

/** Runs the shared pass over one element, once its motion has settled. */
export function runAxe(element: Element): Promise<AxeResults> {
  settleAnimations(element.ownerDocument);
  return axe.run(element, axeOptions());
}

/** header.component.scss's toolbar height; the header is fixed over the viewport's top. */
const HEADER_PX = 64;

/**
 * Scrolls `node` to the middle of the viewport, waits a frame, and runs the
 * shared pass over it.
 *
 * A plain pass never scores a page's lower cards. Every routed page renders
 * inside the shell's `.main-container`, a fixed scroller, and axe treats a
 * node under a fixed ancestor as offscreen once its top reaches the
 * viewport's bottom: it is skipped outright, not even reported
 * `incomplete`. Karma's frame is a few hundred pixels tall (413px where
 * ADR 0151 measured it), so most of a long page is never looked at.
 *
 * Throws before auditing unless the whole node lies in the band between the
 * header and the viewport's bottom. Text under the header is overlapped,
 * which axe reports as `incomplete`, and a descendant past the bottom is
 * skipped as offscreen; either way part of the node would read as clean
 * without having been scored. A node too tall for the band, or one no
 * scroll can move, is audited as smaller nodes instead.
 */
export async function auditInView(node: Element): Promise<AxeResults> {
  const view = node.ownerDocument.defaultView ?? window;
  // `instant`: a stylesheet's `scroll-behavior: smooth` would otherwise
  // leave the node still travelling when the band is measured.
  node.scrollIntoView({ block: 'center', behavior: 'instant' });
  await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()));

  const rect = node.getBoundingClientRect();
  const bottom = view.innerHeight;
  if (rect.top < HEADER_PX || rect.bottom > bottom) {
    const name = node.tagName.toLowerCase() + [...node.classList].map(c => `.${c}`).join('');
    const spans = `${Math.round(rect.top)}–${Math.round(rect.bottom)}px`;
    throw new Error(
      `auditInView: ${name} spans ${spans} once scrolled, outside the band axe can score ` +
        `(${HEADER_PX}–${bottom}px, from under the header to the viewport's bottom)`
    );
  }
  return runAxe(node);
}

/** The schemes every sweep runs under, in the order it runs them. */
export const AUDIT_SCHEMES: readonly EffectiveTheme[] = ['light', 'dark'];

/**
 * `TestBed.tick()`, run inside the Angular zone.
 *
 * ThemeService's effect is flushed in a run of the zone the service was
 * created in, and a component that reads the theme creates it inside the
 * Angular zone. Ticked from outside it, as a spec calls withScheme, leaving
 * that run empties the zone, and the zone scheduler starts a tick while this
 * one is still running: Angular refuses it as NG0101 and only logs it. Inside
 * the zone the effect's run is nested, so nothing is asked for until this
 * tick has finished.
 */
function tickInZone(): void {
  TestBed.inject(NgZone).run(() => TestBed.tick());
}

/**
 * Runs `fn` with the app forced into `scheme` through the real ThemeService,
 * as the theme choice in Settings does, then restores the preference and
 * both theme classes on `<html>`. When `fn` returns a promise, the restore
 * waits for it to settle.
 *
 * Without it a pass renders one scheme, the host's, so a pair that fails
 * only in the other passes wherever it is run. `withTheme`
 * (painted-contrast.ts) stamps the classes alone, which leaves anything that
 * reads `effectiveTheme()` (the category chip, the chart palette) on the
 * host's scheme.
 *
 * The preference is restored and flushed before the classes are. The
 * service's effect stamps a class whenever the effective theme changes, so
 * classes put back first would be overwritten on the next tick, leaking a
 * theme into whichever spec runs next (ADR 0151).
 */
export function withScheme<T>(themeService: ThemeService, scheme: EffectiveTheme, fn: () => T): T {
  const root = document.documentElement;
  const other: EffectiveTheme = scheme === 'dark' ? 'light' : 'dark';
  const stamped = () =>
    root.classList.contains(`${scheme}-theme`) && !root.classList.contains(`${other}-theme`);
  const had = {
    light: root.classList.contains('light-theme'),
    dark: root.classList.contains('dark-theme'),
  };
  const preference = themeService.theme();
  const restore = () => {
    try {
      themeService.setTheme(preference);
      tickInZone();
    } finally {
      root.classList.toggle('light-theme', had.light);
      root.classList.toggle('dark-theme', had.dark);
    }
  };

  let pending = false;
  try {
    themeService.setTheme(scheme);
    tickInZone();
    // The service stamps a class only when the effective theme changes. A
    // restore, or a spec's own cleanup, can have taken off the class it last
    // stamped while it still resolves to `scheme`; passing through the other
    // scheme makes it stamp again.
    if (!stamped()) {
      themeService.setTheme(other);
      tickInZone();
      themeService.setTheme(scheme);
      tickInZone();
    }
    // A stubbed service, or one given a fake DOCUMENT, leaves the host's
    // scheme on screen, and the pass would score it under the other's name.
    if (!stamped()) {
      throw new Error(`withScheme: ThemeService did not put .${scheme}-theme alone on <html>`);
    }
    const result = fn();
    if (result instanceof Promise) {
      pending = true;
      return result.finally(restore) as T;
    }
    return result;
  } finally {
    if (!pending) restore();
  }
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
