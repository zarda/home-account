import type { Rgb } from '../../utils/color-contrast.utils';
import { settleAnimations } from './axe';

/**
 * Contrast measured on what Chrome paints, for specs that hold a colour pair
 * to WCAG.
 *
 * A computed colour is not a painted one. A `color-mix()` with `transparent`
 * computes to `color(srgb … / 0.06)`, which a `[\d.]+` scrape reads as
 * channels 0–1 and an alpha it then drops; a translucent fill takes on
 * whatever is under it; an ancestor's `opacity` fades its whole subtree,
 * text and background alike; and a transition can hold the first colours
 * of a class change for as long as the spec runs. Each function here reads
 * the computed values and does that arithmetic, so a spec asserts on the
 * colour a user sees.
 *
 * What it does not see: background images and gradients, filters, blend
 * modes, and anything painted under the element by a sibling rather than an
 * ancestor. The walk follows the DOM parent chain, which is the painting
 * order for in-flow content and for an overlay pane under
 * `.cdk-overlay-container`, but not for an element positioned over an
 * unrelated one.
 */

/** A parsed CSS colour: channels 0–255, unrounded, and an alpha of 0–1. */
export interface Channels {
  readonly rgb: Rgb;
  readonly alpha: number;
}

const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?`;
const SEPARATOR = String.raw`(?:\s*,\s*|\s+)`;
const ALPHA_SEPARATOR = String.raw`\s*[,/]\s*`;
const RGB_BODY = new RegExp(
  `^(${NUMBER})${SEPARATOR}(${NUMBER})${SEPARATOR}(${NUMBER})(?:${ALPHA_SEPARATOR}(${NUMBER}))?$`,
  'i'
);
const SRGB_BODY = new RegExp(
  `^srgb\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})(?:\\s*/\\s*(${NUMBER}))?$`,
  'i'
);

/** Opaque within float error: `a + 1 × (1 − a)` need not come back as exactly 1. */
const OPAQUE = 1 - 1e-9;

/**
 * A computed colour (`rgb()`, `rgba()` or `color(srgb … / a)`, the three
 * shapes Chrome computes an sRGB colour to) as channels and alpha.
 *
 * Anything else throws, because every other shape — a keyword, hex, a
 * percentage, `none`, a wide-gamut space — means the caller handed over
 * something that is not a computed value, or a colour this arithmetic
 * cannot honestly composite.
 */
export function channels(computed: string): Channels {
  const text = (computed ?? '').trim();
  const call = /^(rgba?|color)\((.*)\)$/i.exec(text);
  const body = call?.[2].trim() ?? '';
  const isColor = call?.[1].toLowerCase() === 'color';
  const match = call ? (isColor ? SRGB_BODY : RGB_BODY).exec(body) : null;
  if (!match) {
    throw new Error(`painted-contrast: cannot read the colour "${computed}"`);
  }
  const scale = isColor ? 255 : 1;
  return {
    rgb: [Number(match[1]) * scale, Number(match[2]) * scale, Number(match[3]) * scale],
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/**
 * WCAG relative luminance, written out here rather than imported so a spec
 * of `color-contrast.utils` is not measured by the code it tests. The
 * linear-segment threshold is sRGB's 0.04045, the value axe-core uses.
 */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21, unrounded; the order of the two does not matter. */
export function ratio(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Porter–Duff source-over, on straight (not premultiplied) channels. */
function over(top: Channels, bottom: Channels): Channels {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
  if (alpha === 0) return { rgb: [0, 0, 0], alpha: 0 };
  const mix = (i: 0 | 1 | 2) =>
    (top.rgb[i] * top.alpha + bottom.rgb[i] * bottom.alpha * (1 - top.alpha)) / alpha;
  return { rgb: [mix(0), mix(1), mix(2)], alpha };
}

/**
 * `top` painted over `el`'s background and every ancestor's, each element's
 * `opacity` fading its own background and everything above it together,
 * as the browser composites a group. Rounded to whole channels at the end,
 * the way the page is painted and then measured.
 */
function composite(el: Element, top: Channels): Rgb {
  let painted = top;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    painted = over(painted, channels(style.backgroundColor));
    painted = { rgb: painted.rgb, alpha: painted.alpha * Number(style.opacity) };
  }
  if (painted.alpha < OPAQUE) {
    throw new Error(
      'painted-contrast: no opaque background under the element, so what shows through is the ' +
        "browser's canvas, which no stylesheet sets"
    );
  }
  const [r, g, b] = painted.rgb.map(value => Math.min(255, Math.max(0, Math.round(value))));
  return [r, g, b];
}

function settled(el: Element): Element {
  if (!el.isConnected) {
    throw new Error('painted-contrast: the element is not in the document, so nothing is painted');
  }
  settleAnimations(el.ownerDocument);
  return el;
}

/**
 * The colour painted behind `el`'s content: its own background over its
 * ancestors', with every translucent fill and `opacity` composited. Throws
 * when the chain has no opaque background, or the element is detached.
 */
export function paintedBackground(el: Element): Rgb {
  return composite(settled(el), { rgb: [0, 0, 0], alpha: 0 });
}

/**
 * The colour `el`'s text is painted in: its computed `color` composited over
 * the same chain, so a translucent colour and a faded ancestor both count.
 */
export function paintedColor(el: Element): Rgb {
  const target = settled(el);
  return composite(target, channels(getComputedStyle(target).color));
}

/**
 * Runs `fn` with `<html>` carrying exactly one of `.light-theme` and
 * `.dark-theme`, then restores both classes as they were — after the
 * returned promise settles, when `fn` is async. A leaked `dark-theme` reads
 * every later spec in the wrong scheme (ADR 0151).
 *
 * This stamps classes only, so it is for probing tokens and stylesheet rules.
 * Anything that reads `ThemeService.effectiveTheme()` has to be driven
 * through the service instead: the classes alone do not change it.
 */
export function withTheme<T>(theme: 'light' | 'dark', fn: () => T): T {
  const root = document.documentElement;
  const had = {
    light: root.classList.contains('light-theme'),
    dark: root.classList.contains('dark-theme'),
  };
  const restore = () => {
    root.classList.toggle('light-theme', had.light);
    root.classList.toggle('dark-theme', had.dark);
  };

  root.classList.toggle('light-theme', theme === 'light');
  root.classList.toggle('dark-theme', theme === 'dark');
  let pending = false;
  try {
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

/** A selector list split at its top-level commas, leaving `:is(a, b)` whole. */
function selectorsOf(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/** A selector's trailing pseudo-element, as `::before`, or '' when it styles the element itself. */
function pseudoElementOf(selector: string): string {
  return /::[\w-]+(?:\([^)]*\))?$/.exec(selector)?.[0] ?? '';
}

/**
 * Whether `el` is what `selector` styles once its `:hover` holds, leaving
 * aside the pseudo-element it may end in, which no element matches.
 *
 * Each `:hover` becomes `:is(*)` rather than nothing, because a `:hover`
 * can be a compound of its own: dropped, `.list :hover` would leave `.list`
 * and match the list instead of what is hovered inside it, and `:hover > .x`
 * would leave a selector that opens on a combinator.
 */
function appliesWhenHovered(el: Element, selector: string): boolean {
  const subject = selector.slice(0, selector.length - pseudoElementOf(selector).length);
  try {
    return el.matches(subject.replace(/:hover/g, ':is(*)'));
  } catch {
    return false;
  }
}

/**
 * The declared value of `prop` in the `:hover` rule that styles `el`, read
 * from the CSSOM, because Karma cannot put the pointer over an element.
 *
 * `selectorPart` is matched with `includes` against each selector in a
 * rule's list, since emulated encapsulation rewrites `.chip:hover` to
 * `.chip[_ngcontent-…]:hover`; a selector counts only if `el` matches it
 * with every `:hover` in it taken to hold, so a rule for another element, or
 * for the other theme's html class, is not returned. The value comes back as
 * declared — `var(--token)` included — for the spec to set on the element
 * and measure.
 *
 * A rule ending in a pseudo-element styles that pseudo-element, not `el`:
 * Material paints a hover state layer as
 * `.mat-mdc-outlined-button:hover > .mat-mdc-button-persistent-ripple::before`.
 * Such a rule is read only when `pseudoElement` names it (`'::before'`, the
 * form `getComputedStyle` takes), and the element's own rules only when it
 * is left out, so the two never compete.
 *
 * Throws when no rule declares the property for that target, naming any
 * rule that declares it for another part of `el`, and when several do with
 * different values: the cascade between them is not computed here, so the
 * spec narrows `selectorPart` until one rule is left. Enclosing `@media` and
 * `@supports` conditions are not evaluated, and a shorthand declared with
 * `var()` has no longhand value to read, so ask for the shorthand.
 */
export function hoverValue(
  el: Element,
  selectorPart: string,
  prop: string,
  pseudoElement = ''
): string {
  const found = new Map<string, string>();
  const elsewhere = new Set<string>();

  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const value = rule.style.getPropertyValue(prop).trim();
        for (const selector of selectorsOf(rule.selectorText)) {
          const applies =
            value !== '' &&
            selector.includes(':hover') &&
            selector.includes(selectorPart) &&
            appliesWhenHovered(el, selector);
          if (!applies) continue;
          if (pseudoElementOf(selector) === pseudoElement) found.set(rule.selectorText, value);
          else elsewhere.add(selector);
        }
      }
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };

  for (const sheet of Array.from(el.ownerDocument.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet refuses to be read; nothing in it can be checked.
      continue;
    }
    visit(rules);
  }

  const values = [...new Set(found.values())];
  const target = pseudoElement ? `this element's ${pseudoElement}` : 'this element';
  if (values.length === 0) {
    const others = [...elsewhere].map(selector => {
      const part = pseudoElementOf(selector);
      return `${selector} declares it for ${part ? `its ${part}` : 'the element itself'}`;
    });
    throw new Error(
      `painted-contrast: no :hover rule matching "${selectorPart}" declares ${prop} for ${target}` +
        (others.length ? ` (${others.join('; ')})` : '')
    );
  }
  if (values.length > 1) {
    const rules = [...found]
      .map(([selector, value]) => `${selector} { ${prop}: ${value} }`)
      .join('; ');
    throw new Error(
      `painted-contrast: several :hover rules declare ${prop} for ${target}: ${rules}`
    );
  }
  return values[0];
}
