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
 * black (or white) is not enough, the answer is whichever of black and white
 * contrasts more with the background: one of the two always reaches 4.58:1,
 * so AA never goes unmet.
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

  return contrastRatio(BLACK, bg) >= contrastRatio(WHITE, bg) ? toHexColor(BLACK) : toHexColor(WHITE);
}
