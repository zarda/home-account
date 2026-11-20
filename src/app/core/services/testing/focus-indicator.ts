/// <reference types="jasmine" />
import type { Rgb } from '../../utils/color-contrast.utils';
import { settleAnimations } from './axe';
import { PALETTES, channels, inPalette, paintedBackground, ratio, tokenValue } from './painted-contrast';

/**
 * The focus indicator a keyboard-focused Material button shows (styles.scss),
 * read off the button where it stands, for specs that hold it to 3:1 on the
 * surface the button sits on: focus-indicator.spec.ts on its own host, and a
 * component's spec on its real template.
 *
 * It is Material's own indicator, the `::before` of the `.mat-focus-indicator`
 * span inside each button. A scripted focus is no reliable :focus-visible, so
 * nothing here focuses a button: the indicator is read off its `::before`,
 * whose border, margin and display the cascade resolves whether the button
 * has focus or not, as only its `content` waits for :focus-visible. What it
 * is drawn over is read with Material's keyboard-focus class on the button,
 * so the state layer Material lays under a focused button is counted.
 */

/** `ink` at `alpha` over the opaque `under`, rounded the way the page is painted. */
function laidOver(ink: Rgb, alpha: number, under: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2) => Math.round(ink[i] * alpha + under[i] * (1 - alpha));
  return [mix(0), mix(1), mix(2)];
}

/** What a button's focus indicator shows, and what it is drawn over. */
export interface IndicatorReading {
  readonly display: string;
  readonly style: string;
  readonly width: string;
  readonly colour: string;
  /** The button's own computed text colour. */
  readonly textColour: string;
  readonly margin: string;
  readonly corner: string;
  /** The opacity of the state layer Material lays under a keyboard-focused button. */
  readonly layerOpacity: number;
  /** The indicator on what it is drawn over, the worse side where it straddles the button's edge. */
  readonly ratio: number;
  /** The ancestors whose overflow, clip-path or paint containment cuts the indicator off, by class. */
  readonly clippedBy: string[];
}

/**
 * Reads `button`'s indicator. Inside the button, it is drawn over the
 * button's own fill (whatever is under a transparent one) with the focus
 * state layer laid on it; a negative margin takes it past the button's edge,
 * over what the button stands on.
 */
export function readIndicator(button: HTMLElement): IndicatorReading {
  const indicator = button.querySelector(':scope > .mat-focus-indicator');
  const ripple = button.querySelector(':scope > .mat-mdc-button-persistent-ripple');
  if (!indicator || !ripple) throw new Error('focus-indicator: the button holds no focus indicator or state layer');
  // A button already keyboard-focused keeps the class: the reading leaves
  // the button as it found it.
  const hadFocusClass = button.classList.contains('cdk-keyboard-focused');
  button.classList.add('cdk-keyboard-focused');
  try {
    settleAnimations(document);
    const before = getComputedStyle(indicator, '::before');
    const layer = getComputedStyle(ripple, '::before');
    const width = parseFloat(before.borderTopWidth);
    const margin = parseFloat(before.marginTop);
    const ink = channels(before.borderTopColor);
    const layerInk = channels(layer.backgroundColor);
    const layerOpacity = Number(layer.opacity);
    const inside = laidOver(layerInk.rgb, layerInk.alpha * layerOpacity, paintedBackground(button));
    const outside = paintedBackground(button.parentElement as Element);
    const surfaces = [...(margin + width > 0 ? [inside] : []), ...(margin < 0 ? [outside] : [])];
    const ratios = surfaces.map(surface => ratio(laidOver(ink.rgb, ink.alpha, surface), surface));
    return {
      display: before.display,
      style: before.borderTopStyle,
      width: before.borderTopWidth,
      colour: before.borderTopColor,
      textColour: getComputedStyle(button).color,
      margin: before.margin,
      corner: before.borderTopLeftRadius,
      layerOpacity,
      // A line of no width is drawn over nothing, and reads as nothing.
      ratio: ratios.length ? Math.min(...ratios) : 1,
      clippedBy: clippersOf(indicator, margin),
    };
  } finally {
    if (!hadFocusClass) button.classList.remove('cdk-keyboard-focused');
  }
}

/**
 * The ancestors between the indicator and the body, the button included,
 * that cut the indicator's box off: the span's box, which its `::before`
 * fills, grown by a negative margin. An ancestor cuts it when its overflow
 * is not visible or it contains its paint, and its padding box does not
 * hold that box; or when it has a clip-path and its border box does not
 * hold it. A clip-path's own shape is not read: one that keeps less than
 * the border box is held to the border box.
 */
function clippersOf(indicator: Element, margin: number): string[] {
  const span = indicator.getBoundingClientRect();
  const box = {
    left: span.left + margin,
    top: span.top + margin,
    right: span.right - margin,
    bottom: span.bottom - margin,
  };
  const cut: string[] = [];
  for (let node = indicator.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const byPaddingBox =
      !(style.overflowX === 'visible' && style.overflowY === 'visible') ||
      /\b(paint|strict|content)\b/.test(style.contain);
    const byBorderBox = style.clipPath !== 'none';
    if (!byPaddingBox && !byBorderBox) continue;
    const rect = node.getBoundingClientRect();
    const edge = byPaddingBox
      ? {
          left: rect.left + node.clientLeft,
          top: rect.top + node.clientTop,
          right: rect.left + node.clientLeft + node.clientWidth,
          bottom: rect.top + node.clientTop + node.clientHeight,
        }
      : rect;
    const holds =
      box.left >= edge.left - 0.5 &&
      box.top >= edge.top - 0.5 &&
      box.right <= edge.right + 0.5 &&
      box.bottom <= edge.bottom + 0.5;
    if (!holds) cut.push(`${node.tagName.toLowerCase()}.${Array.from(node.classList).join('.')}`);
  }
  return cut;
}

/**
 * Holds `button`'s indicator, read in every palette, to the design: shown,
 * a solid line 2px wide (3px under high contrast) in the button's own text
 * colour, or in `colourToken` where it is not drawn in that (a held
 * button's), drawn inside the button, 3:1 or better on what it is drawn
 * over, and cut off by nothing. An icon button lays no focus state layer
 * under it. `label` names the button in a failure.
 */
export function expectIndicatorInEveryPalette(button: HTMLElement | null, label: string, colourToken?: string): void {
  expect(button).withContext(label).toBeTruthy();
  if (!button) return;
  const iconButton = button.classList.contains('mat-mdc-icon-button');
  for (const palette of PALETTES) {
    inPalette(palette.classes, () => {
      const at = `${label}, ${palette.name}`;
      const reading = readIndicator(button);
      expect(reading.display).withContext(`${at}: shown`).toBe('block');
      expect(reading.style).withContext(`${at}: a solid line`).toBe('solid');
      expect(reading.width)
        .withContext(`${at}: its width`)
        .toBe(palette.classes.includes('high-contrast') ? '3px' : '2px');
      if (colourToken) {
        expect(reading.colour).withContext(`${at}: in ${colourToken}`).toBe(tokenValue(colourToken));
      } else {
        expect(reading.colour).withContext(`${at}: in the button's own text colour`).toBe(reading.textColour);
      }
      expect(reading.margin).withContext(`${at}: drawn inside the button`).toBe('0px');
      expect(reading.ratio).withContext(`${at}: on what it is drawn over`).toBeGreaterThanOrEqual(3);
      expect(reading.clippedBy).withContext(`${at}: what cuts it off`).toEqual([]);
      if (iconButton) {
        expect(reading.layerOpacity).withContext(`${at}: no focus state layer under it`).toBe(0);
      }
    });
  }
}
