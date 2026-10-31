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
 * rule styles and measures what they do. A component's styles are in the
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
