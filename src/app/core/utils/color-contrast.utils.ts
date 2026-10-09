import type { EffectiveTheme } from '../services/theme.service';

/** Red, green and blue, 0–255 each. */
export type Rgb = readonly [number, number, number];

/** WCAG 2.1 AA for normal-size text (1.4.3); an icon glyph is measured the same way. */
export const WCAG_AA_TEXT = 4.5;

/**
 * Mixing steps between a colour and black or white. Each step moves a channel
 * by at most 2.55, so the first shade that clears a target overshoots it by
 * a hair at most, and the search is bounded whatever the input.
 */
const STEPS = 100;

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function channelwise(channel: (index: 0 | 1 | 2) => number): Rgb {
  return [channel(0), channel(1), channel(2)];
}

/**
 * `#rgb` or `#rrggbb` (the hash optional) to its channels, or null for
 * anything else: a named colour, `rgb()`, or hex whose alpha is translucent,
 * whose painted value depends on what is under it. An alpha of `f` or `ff`
 * is fully opaque, so `#rgbf` and `#rrggbbff` paint exactly what `#rgb` and
 * `#rrggbb` paint and are read as those.
 */
export function parseHexColor(color: string): Rgb | null {
  const hex = (color ?? '').trim().replace(/^#/, '');
  const match = /^(?:([0-9a-f]{3})f?|([0-9a-f]{6})(?:ff)?)$/i.exec(hex);
  if (!match) return null;
  const full = match[2] ?? match[1].split('').map(c => c + c).join('');
  return channelwise(i => parseInt(full.slice(i * 2, i * 2 + 2), 16));
}

/** Channels to lower-case `#rrggbb`, each rounded and clamped to 0–255. */
export function toHexColor(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map(value => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * WCAG relative luminance. The linear-segment threshold is sRGB's 0.04045,
 * the value axe-core uses; no 8-bit channel falls between it and WCAG 2.1's
 * older 0.03928, so the two agree on every colour a page can paint.
 */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21, unrounded; the order of the two does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `color` at `alpha` painted over an opaque `surface`, rounded to whole
 * channels because that is what a browser paints and what a contrast check
 * then measures.
 */
export function compositeOver(color: Rgb, alpha: number, surface: Rgb): Rgb {
  return channelwise(i => Math.round(color[i] * alpha + surface[i] * (1 - alpha)));
}

/**
 * The shade of `color` nearest to it that reaches `target` against
 * `background`, as `#rrggbb`.
 *
 * `darken` mixes towards black and `lighten` towards white. Mixing scales the
 * distance to black or white equally on every channel, so the hue stays and
 * only the lightness moves; the first step that clears the target wins, which
 * leaves a colour that already clears it untouched. When the whole way to
 * black (or white) is not enough, the answer is `readableOn(background)`,
 * which always reaches 4.58:1, so AA never goes unmet.
 *
 * A colour or background that is not opaque hex cannot be measured, and the
 * colour is returned exactly as given.
 */
export function ensureContrast(
  color: string,
  background: string,
  target: number,
  direction: 'darken' | 'lighten'
): string {
  const rgb = parseHexColor(color);
  const bg = parseHexColor(background);
  if (!rgb || !bg) return color;

  const toward = direction === 'darken' ? BLACK : WHITE;
  for (let step = 0; step <= STEPS; step++) {
    const t = step / STEPS;
    const candidate = channelwise(i => Math.round(rgb[i] + (toward[i] - rgb[i]) * t));
    if (contrastRatio(candidate, bg) >= target) return toHexColor(candidate);
  }

  return readableOn(background);
}

/**
 * Black or white, whichever contrasts more with `fill`, as `#rrggbb`: the
 * glyph for a tile or swatch painted in a category's own colour.
 *
 * On a fill of luminance L, black scores (L + 0.05) / 0.05 and white
 * 1.05 / (L + 0.05). The two multiply to 21, so the better of them is never
 * under sqrt(21) ≈ 4.58:1, whatever the fill.
 *
 * A fill that is not opaque hex cannot be measured, so it gets white, the
 * usual glyph on a coloured tile.
 */
export function readableOn(fill: string): string {
  const rgb = parseHexColor(fill);
  if (!rgb) return toHexColor(WHITE);
  return contrastRatio(BLACK, rgb) >= contrastRatio(WHITE, rgb) ? toHexColor(BLACK) : toHexColor(WHITE);
}

/** A surface a category's glyph is painted on, in its own colour, outside the chip. */
export type CategorySurface =
  | 'dialog'
  | 'panel'
  | 'menu'
  | 'subtle'
  | 'reviewCard'
  | 'suggestionChip'
  | 'iconGrid';

// colors:allow-start(token-mirror) the tones a category glyph sits on, which the glyph pipe's spec holds to the stylesheet
/**
 * A select panel's tones: at rest, an option hovered, an option active (the
 * keyboard's, and the one the panel opens on) and an option selected.
 */
const SELECT_PANEL = {
  light: ['#efedf6', '#dedce5', '#d5d4dd', '#dee0ff'],
  dark: ['#1f1f26', '#2f2f36', '#37363e', '#3e446b'],
} as const;

/**
 * Every tone each surface takes under a glyph, in each theme, as the
 * stylesheet paints it. A glyph corrected against the hardest of them
 * clears AA on all of them (see categoryGlyphColor).
 *
 * The tones are literals because a pipe cannot read the cascade, so
 * category-glyph.pipe.spec.ts holds every one to its source: Material's
 * system colours under each scheme, the named --surface-* tokens, Material's
 * state layers, and a rendered stroked button's hover and focus layers.
 *
 *   - dialog: a dialog's own surface, under a select's closed trigger.
 *   - panel: SELECT_PANEL.
 *   - menu: a menu panel's tones, the same as a select's (a keyboard-focused
 *     item takes the active option's layer), and the current item's
 *     --surface-menu-current.
 *   - subtle: --surface-subtle, under each budget in the dashboard's Budget
 *     Progress widget.
 *   - reviewCard: the import review card's category button, on the card
 *     checked, unchecked, hovered and flagged as a duplicate; each at rest,
 *     then under the button's hover and keyboard-focus layers.
 *   - suggestionChip: the transaction form's suggested category, at rest
 *     and hovered.
 *   - iconGrid: the chosen icon in the category form's picker.
 */
export const CATEGORY_SURFACES: Readonly<
  Record<CategorySurface, Readonly<Record<EffectiveTheme, readonly string[]>>>
> = {
  dialog: { light: ['#fbf8ff'], dark: ['#121319'] },
  panel: SELECT_PANEL,
  menu: {
    light: [...SELECT_PANEL.light, '#ddddf0'],
    dark: [...SELECT_PANEL.dark, '#282936'],
  },
  subtle: { light: ['#f9fafb'], dark: ['#242424'] },
  reviewCard: {
    // Checked, unchecked, hovered, duplicate: each at rest, hovered, focused.
    light: [
      '#f3f5fb', '#e5e8f6', '#dee2f3',
      '#f5f5f5', '#e7e8f0', '#e0e2ee',
      '#f9fafb', '#eaedf6', '#e3e6f3',
      '#fefaf0', '#efedec', '#e8e6e9',
    ],
    dark: [
      '#292a33', '#353643', '#3a3c4b',
      '#121212', '#1f2025', '#26272e',
      '#3d3d3d', '#47484d', '#4c4d54',
      '#2b281d', '#36342f', '#3c3b38',
    ],
  },
  suggestionChip: { light: ['#e8e7f8', '#c6c9ea'], dark: ['#202332', '#2b2f44'] },
  iconGrid: { light: ['#f0f1f9'], dark: ['#2b2d36'] },
};
// colors:allow-end

/**
 * The tone of `tones` a glyph finds hardest to clear: the darkest in light,
 * where a glyph is darkened against the surface, and the lightest in dark,
 * where it is lightened.
 *
 * Every light tone in CATEGORY_SURFACES is light enough that a glyph which
 * clears AA on it is darker than all of them, and every dark tone the
 * mirror image. Such a glyph loses contrast as a tone moves toward it, so
 * clearing the one nearest it clears the rest.
 *
 * Throws on an empty list or a tone that is not opaque hex: a surface whose
 * tones cannot all be measured cannot promise a readable glyph.
 */
export function hardestTone(tones: readonly string[], theme: EffectiveTheme): string {
  if (tones.length === 0) throw new Error('hardestTone: a surface with no tone');
  let hardest = '';
  let hardestLuminance = theme === 'dark' ? -1 : 2;
  for (const tone of tones) {
    const rgb = parseHexColor(tone);
    if (!rgb) throw new Error(`hardestTone: cannot measure the tone "${tone}"`);
    const luminance = relativeLuminance(rgb);
    if (theme === 'dark' ? luminance > hardestLuminance : luminance < hardestLuminance) {
      hardest = tone;
      hardestLuminance = luminance;
    }
  }
  return hardest;
}

/**
 * A category's colour for a glyph on `surface`, moved only as far as it must
 * be to reach AA on every tone that surface takes: darker in light, lighter
 * in dark, same hue, as the chip moves its own glyph.
 *
 * A colour that is not opaque hex, an empty one included, is returned as
 * given, the way ensureContrast returns it.
 */
export function categoryGlyphColor(color: string, surface: CategorySurface, theme: EffectiveTheme): string {
  return ensureContrast(
    color,
    hardestTone(CATEGORY_SURFACES[surface][theme], theme),
    WCAG_AA_TEXT,
    theme === 'dark' ? 'lighten' : 'darken'
  );
}
