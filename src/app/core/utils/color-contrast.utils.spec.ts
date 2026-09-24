import {
  WCAG_AA_TEXT,
  compositeOver,
  contrastRatio,
  ensureContrast,
  parseHexColor,
  relativeLuminance,
  toHexColor,
} from './color-contrast.utils';

describe('parseHexColor', () => {
  it('reads six-digit and three-digit hex, in either case', () => {
    expect(parseHexColor('#ff9800')).toEqual([255, 152, 0]);
    expect(parseHexColor('#FF9800')).toEqual([255, 152, 0]);
    expect(parseHexColor('#666')).toEqual([102, 102, 102]);
  });

  it('tolerates a missing hash and surrounding space', () => {
    expect(parseHexColor('ff9800')).toEqual([255, 152, 0]);
    expect(parseHexColor(' #fff ')).toEqual([255, 255, 255]);
  });

  it('returns null for anything it cannot read as opaque hex', () => {
    for (const value of ['red', 'rgb(1, 2, 3)', '#ff980080', '#ggg', '', 'transparent']) {
      expect(parseHexColor(value)).withContext(value).toBeNull();
    }
  });
});

describe('toHexColor', () => {
  it('writes lower-case six-digit hex', () => {
    expect(toHexColor([255, 152, 0])).toBe('#ff9800');
  });

  it('rounds and clamps each channel', () => {
    expect(toHexColor([256, -1, 12.6])).toBe('#ff000d');
  });
});

describe('relativeLuminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
  });

  it('weights green over red over blue', () => {
    const red = relativeLuminance([255, 0, 0]);
    const green = relativeLuminance([0, 255, 0]);
    const blue = relativeLuminance([0, 0, 255]);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6);
    expect(contrastRatio([255, 152, 0], [255, 152, 0])).toBe(1);
  });

  it('does not care which side is the foreground', () => {
    expect(contrastRatio([119, 119, 119], [255, 255, 255]))
      .toBe(contrastRatio([255, 255, 255], [119, 119, 119]));
  });

  it('puts #777 on white just under AA', () => {
    const ratio = contrastRatio([119, 119, 119], [255, 255, 255]);
    expect(ratio).toBeLessThan(WCAG_AA_TEXT);
    expect(ratio).toBeGreaterThan(4.4);
  });
});

describe('compositeOver', () => {
  it('is the surface at alpha 0 and the colour at alpha 1', () => {
    expect(compositeOver([255, 152, 0], 0, [30, 30, 30])).toEqual([30, 30, 30]);
    expect(compositeOver([255, 152, 0], 1, [30, 30, 30])).toEqual([255, 152, 0]);
  });

  it('blends to whole channels, the way a browser paints a translucent fill', () => {
    // #ff9800 at alpha 0x20 on white is the #fff2df axe measured under the
    // transaction row's icon.
    expect(compositeOver([255, 152, 0], 0x20 / 0xff, [255, 255, 255])).toEqual([255, 242, 223]);
  });
});

describe('ensureContrast', () => {
  it('returns a colour that already clears the target as it is, normalised', () => {
    expect(ensureContrast('#3F51B5', '#ffffff', WCAG_AA_TEXT, 'darken')).toBe('#3f51b5');
  });

  it('darkens a light colour until it clears the target, and no further than it must', () => {
    const result = ensureContrast('#ff9800', '#fff2df', WCAG_AA_TEXT, 'darken');
    const rgb = parseHexColor(result)!;
    const ratio = contrastRatio(rgb, [255, 242, 223]);

    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    expect(ratio).toBeLessThan(WCAG_AA_TEXT + 0.2);
    // Darkening scales every channel together, so the hue survives: still
    // red over green over blue, blue still empty.
    expect(rgb[0]).toBeLessThan(255);
    expect(rgb[0]).toBeGreaterThan(rgb[1]);
    expect(rgb[2]).toBe(0);
    expect(rgb[1] / rgb[0]).toBeCloseTo(152 / 255, 1);
  });

  it('lightens a dark colour until it clears the target on a dark background', () => {
    const result = ensureContrast('#3f51b5', '#2e3240', WCAG_AA_TEXT, 'lighten');
    const rgb = parseHexColor(result)!;

    expect(contrastRatio(rgb, [46, 50, 64])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    expect(rgb[0]).toBeGreaterThanOrEqual(63);
    expect(rgb[1]).toBeGreaterThanOrEqual(81);
    expect(rgb[2]).toBeGreaterThanOrEqual(181);
    // Still the bluest channel: the hue is kept, only the lightness moved.
    expect(rgb[2]).toBeGreaterThan(rgb[0]);
  });

  it('lightens black past a dark background it starts out darker than', () => {
    const result = ensureContrast('#000000', '#171717', WCAG_AA_TEXT, 'lighten');
    expect(contrastRatio(parseHexColor(result)!, [23, 23, 23])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });

  it('falls back to black when lightening cannot get there', () => {
    expect(ensureContrast('#ffff00', '#ffffff', WCAG_AA_TEXT, 'lighten')).toBe('#000000');
  });

  it('falls back to white when darkening cannot get there', () => {
    expect(ensureContrast('#0000ff', '#000000', WCAG_AA_TEXT, 'darken')).toBe('#ffffff');
  });

  it('terminates on a target nothing can reach, with the stronger extreme', () => {
    expect(ensureContrast('#ff9800', '#ffffff', 22, 'lighten')).toBe('#000000');
    expect(ensureContrast('#ff9800', '#000000', 22, 'darken')).toBe('#ffffff');
  });

  it('passes a colour it cannot read through unchanged', () => {
    expect(ensureContrast('rebeccapurple', '#ffffff', WCAG_AA_TEXT, 'darken')).toBe('rebeccapurple');
    expect(ensureContrast('#ff9800', 'transparent', WCAG_AA_TEXT, 'darken')).toBe('#ff9800');
  });
});
