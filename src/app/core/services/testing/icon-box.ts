/**
 * A mat-icon's geometry in px: the size its ligature is drawn at, the line
 * box the ligature is set in, and the box the icon is laid out in.
 *
 * The glyph is one em square. It fills its box, and so sits wherever the box
 * sits in its row, only when all four agree. A type utility that sets a line
 * height above its font size drops the glyph below the middle of the box,
 * and Material's overflow on the icon then cuts its foot off.
 */
export interface IconBox {
  fontSize: number;
  lineHeight: number;
  width: number;
  height: number;
}

const px = (value: string): number => Math.round(parseFloat(value) * 100) / 100;

/** `icon`'s geometry as laid out now. */
export function iconBox(icon: Element): IconBox {
  const style = getComputedStyle(icon);
  const rect = icon.getBoundingClientRect();
  return {
    fontSize: px(style.fontSize),
    lineHeight: px(style.lineHeight),
    width: px(`${rect.width}`),
    height: px(`${rect.height}`),
  };
}

/** The geometry of an icon sized by the font-size token `token`: all four are that size. */
export function iconSquare(token: string): IconBox {
  const probe = document.createElement('span');
  probe.style.fontSize = `var(${token})`;
  document.body.appendChild(probe);
  try {
    const size = px(getComputedStyle(probe).fontSize);
    return { fontSize: size, lineHeight: size, width: size, height: size };
  } finally {
    probe.remove();
  }
}
