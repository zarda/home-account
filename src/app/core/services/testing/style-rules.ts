/// <reference types="jasmine" />

/** A style rule of the document's stylesheets, with the media query it sits under. */
export interface SheetStyleRule {
  /** The condition of the innermost `@media` around the rule, as the CSSOM writes it; null under none. */
  media: string | null;
  rule: CSSStyleRule;
}

/**
 * Every top-level or grouped style rule in a document's stylesheets (the
 * test page's, unless a caller names its element's), in sheet order, with
 * the condition of the innermost media query around it.
 *
 * Karma's window is 756px (docs/ui-overflow.md), so a rule keyed to another
 * viewport width never applies there as layout. Its declarations can still
 * be read here: a spec pins them, or lays them on the rendered nodes the
 * rule styles and measures what they do (`rulesUnder`, `expectOneRule`,
 * `underRule` and `withInlineStyle` below). A component's styles are in the
 * CSSOM once its fixture has rendered, and emulated encapsulation writes
 * its attributes into each selector (`.chip[_ngcontent-…]`), so a spec
 * matches a selector by its parts.
 *
 * `@supports`, `@container` and `@layer` blocks are walked into, but only a
 * media query is recorded; a spec that needs the others reads
 * `rule.parentRule`. A cross-origin sheet refuses to be read and is skipped,
 * and nothing this app injects is one.
 *
 * Two kinds are not walked: a rule nested inside a style rule (CSS nesting,
 * whose selector is relative to its parent's) and a sheet pulled in by
 * `@import`. Compiled SCSS emits neither.
 */
export function styleRules(doc: Document = document): SheetStyleRule[] {
  const found: SheetStyleRule[] = [];
  const walk = (rules: CSSRuleList, media: string | null): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        found.push({ media, rule });
      } else if (rule instanceof CSSGroupingRule) {
        walk(rule.cssRules, rule instanceof CSSMediaRule ? rule.conditionText : media);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    walk(rules, null);
  }
  return found;
}

/**
 * The style rules under a media query whose condition holds `media` (as the
 * CSSOM writes it, `max-width: 480px`), with a selector that `selector`
 * matches: a pattern searched for in `selectorText`, or a test of its own
 * for a selector read by its parts. In sheet order, so a stylesheet the
 * CSSOM holds twice gives its rule twice.
 */
export function rulesUnder(
  media: string,
  selector: RegExp | ((selectorText: string) => boolean),
  doc: Document = document
): CSSStyleRule[] {
  // `search` ignores a pattern's `lastIndex`, so a global one reads every rule alike.
  const matches = typeof selector === 'function' ? selector : (text: string) => text.search(selector) !== -1;
  return styleRules(doc)
    .filter(({ media: condition, rule }) => condition !== null && condition.includes(media) && matches(rule.selectorText))
    .map(({ rule }) => rule);
}

/**
 * Fails the case unless `rules` holds a rule and every copy of it declares
 * the same. Copies are fine; two rules that differ under one query are not,
 * since a case lays only the first (`underRule`).
 */
export function expectOneRule(rules: readonly CSSStyleRule[]): void {
  expect(rules.length).withContext('at least one').toBeGreaterThan(0);
  expect(new Set(rules.map(rule => rule.cssText)).size).withContext('one rule, however many copies').toBe(1);
}

/**
 * Runs `fn` with `cssText` as the inline style of every node in `nodes`,
 * then puts back the inline style each node had, whether `fn` passed,
 * failed or threw.
 */
export async function withInlineStyle(nodes: readonly HTMLElement[], cssText: string, fn: () => unknown): Promise<void> {
  const before = nodes.map(node => node.style.cssText);
  nodes.forEach(node => (node.style.cssText = cssText));
  try {
    await fn();
  } finally {
    nodes.forEach((node, i) => (node.style.cssText = before[i]));
  }
}

/**
 * Runs `fn` with `rule`'s declarations laid inline on `nodes`, through
 * `withInlineStyle`: a viewport rule Karma's window never reaches, read as
 * the rule declares it. Inline declarations skip the cascade, so a case
 * proves what the rule declares, and a window of the rule's width is what
 * proves the cascade. With no rule, or no node to lay it on, the case fails
 * under `context` and `fn` does not run.
 */
export async function underRule(
  rule: CSSStyleRule | undefined,
  nodes: readonly HTMLElement[],
  context: string,
  fn: () => unknown
): Promise<void> {
  expect(rule).withContext(context).toBeDefined();
  expect(nodes.length).withContext(`${context}: the nodes it styles`).toBeGreaterThan(0);
  if (!rule || nodes.length === 0) return;
  await withInlineStyle(nodes, rule.style.cssText, fn);
}
