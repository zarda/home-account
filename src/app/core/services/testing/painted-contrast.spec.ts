import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Rgb, contrastRatio } from '../../utils/color-contrast.utils';
import {
  channels,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  withTheme,
} from './painted-contrast';

/**
 * A component whose stylesheet goes through emulated encapsulation, so the
 * hover rule reaches the CSSOM rewritten (`.chip[_ngcontent-…]:hover`)
 * exactly as every component's does.
 */
@Component({
  selector: 'app-painted-hover-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<button type="button" class="chip">chip</button><span class="other">other</span>',
  styles: [
    `
      .chip {
        background-color: #ffffff;
      }
      .chip:hover {
        background-color: var(--pc-hover-fill);
        color: rgb(1, 2, 3);
      }
    `,
  ],
})
class HoverFixtureComponent {}

describe('painted-contrast', () => {
  const made: HTMLElement[] = [];

  /** A div with an inline style, under `parent` (the body by default). */
  function box(style: string, parent: HTMLElement = document.body): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('style', style);
    parent.appendChild(el);
    if (parent === document.body) made.push(el);
    return el;
  }

  afterEach(() => {
    made.splice(0).forEach(el => el.remove());
  });

  describe('channels', () => {
    it('reads rgb() and rgba()', () => {
      expect(channels('rgb(63, 81, 181)')).toEqual({ rgb: [63, 81, 181], alpha: 1 });
      expect(channels('rgba(0, 0, 0, 0.6)')).toEqual({ rgb: [0, 0, 0], alpha: 0.6 });
      expect(channels('rgba(0, 0, 0, 0)')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
    });

    it('reads color(srgb …), with and without an alpha', () => {
      const translucent = channels('color(srgb 0.247059 0.317647 0.709804 / 0.06)');
      expect(translucent.alpha).toBe(0.06);
      translucent.rgb.forEach((value, i) => expect(value).toBeCloseTo([63, 81, 181][i], 3));

      expect(channels('color(srgb 1 0.5 0)')).toEqual({ rgb: [255, 127.5, 0], alpha: 1 });
    });

    it('throws on anything else, rather than guessing', () => {
      for (const value of [
        '',
        'red',
        'transparent',
        '#ffffff',
        'oklch(0.6 0.1 250)',
        'color(display-p3 1 0 0)',
        'rgb(none 0 0)',
      ]) {
        expect(() => channels(value))
          .withContext(value)
          .toThrowError(/cannot read the colour/);
      }
    });
  });

  describe('paintedBackground', () => {
    it('composites a color-mix() tint over the opaque parent', () => {
      const parent = box('background-color: #ffffff');
      const child = box('background-color: color-mix(in srgb, #3f51b5 6%, transparent)', parent);

      // Chrome keeps the mix in its own space: the computed value is not an
      // rgba() a naive parser would read.
      expect(getComputedStyle(child).backgroundColor.startsWith('color(srgb')).toBeTrue();
      expect(paintedBackground(child)).toEqual([243, 245, 251]);
    });

    it('reads through a transparent element to the nearest painted ancestor', () => {
      const parent = box('background-color: #3f51b5');
      const child = box('', parent);
      expect(paintedBackground(child)).toEqual([63, 81, 181]);
    });

    it("composites an ancestor's opacity over what is under it", () => {
      const outer = box('background-color: #fafafa');
      const faded = box('background-color: #3f51b5; opacity: 0.7', outer);
      const child = box('', faded);

      // 0.7 × #3f51b5 + 0.3 × #fafafa, whole channels.
      expect(paintedBackground(child)).toEqual([119, 132, 202]);
    });

    it('throws when nothing under the element is opaque', () => {
      const html = document.documentElement;
      const before = {
        html: html.style.backgroundColor,
        body: document.body.style.backgroundColor,
      };
      html.style.backgroundColor = 'transparent';
      document.body.style.backgroundColor = 'transparent';
      try {
        const child = box('background-color: rgba(0, 0, 0, 0.5)');
        expect(() => paintedBackground(child)).toThrowError(/no opaque background/);
      } finally {
        html.style.backgroundColor = before.html;
        document.body.style.backgroundColor = before.body;
      }
    });

    it('throws for an element that is not in the document', () => {
      const detached = document.createElement('div');
      expect(() => paintedBackground(detached)).toThrowError(/not in the document/);
    });

    it('reads the colour a running transition will rest on', () => {
      const el = box('background-color: #ffffff; transition: background-color 60s linear');
      expect(paintedBackground(el)).toEqual([255, 255, 255]);
      el.style.backgroundColor = '#000000';

      expect(el.getAnimations().length).withContext('the transition is running').toBe(1);
      expect(paintedBackground(el)).toEqual([0, 0, 0]);
    });
  });

  describe('paintedColor', () => {
    it('composites a translucent text colour over the painted background', () => {
      const parent = box('background-color: #ffffff');
      const child = box('color: rgba(0, 0, 0, 0.6)', parent);
      expect(paintedColor(child)).toEqual([102, 102, 102]);
    });

    it("fades the text with an ancestor's opacity, the same as its background", () => {
      const outer = box('background-color: #fafafa');
      const faded = box('background-color: #3f51b5; opacity: 0.7', outer);
      const child = box('color: #000000', faded);

      expect(paintedColor(child)).toEqual([75, 75, 75]);
      expect(paintedBackground(child)).toEqual([119, 132, 202]);
    });
  });

  describe('ratio', () => {
    it('gives black on white 21, in either order', () => {
      expect(ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
      expect(ratio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 10);
      expect(ratio([119, 119, 119], [119, 119, 119])).toBe(1);
    });

    it('agrees with contrastRatio on every 8-bit channel ramp', () => {
      const disagreements: string[] = [];
      const check = (a: Rgb, b: Rgb) => {
        if (Math.abs(ratio(a, b) - contrastRatio(a, b)) > 1e-12) {
          disagreements.push(`${a} on ${b}`);
        }
      };
      for (let v = 0; v <= 255; v++) {
        for (const against of [
          [255, 255, 255],
          [0, 0, 0],
          [119, 119, 119],
        ] as Rgb[]) {
          check([v, v, v], against);
          check([v, 0, 0], against);
          check([0, v, 0], against);
          check([0, 0, v], against);
        }
      }
      expect(disagreements).toEqual([]);
    });
  });

  describe('withTheme', () => {
    const root = document.documentElement;
    let before: { light: boolean; dark: boolean };

    beforeEach(() => {
      before = {
        light: root.classList.contains('light-theme'),
        dark: root.classList.contains('dark-theme'),
      };
    });

    afterEach(() => {
      root.classList.toggle('light-theme', before.light);
      root.classList.toggle('dark-theme', before.dark);
    });

    it('flips the Material system tokens with the html classes', () => {
      const el = box('background-color: var(--mat-sys-secondary-container)');
      expect(withTheme('dark', () => paintedBackground(el))).toEqual([0x3e, 0x44, 0x6b]);
      expect(withTheme('light', () => paintedBackground(el))).toEqual([0xde, 0xe0, 0xff]);
    });

    it('stamps exactly one theme class while it runs', () => {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme');
      const during = withTheme('dark', () => [...root.classList].filter(c => c.endsWith('-theme')));
      expect(during).toEqual(['dark-theme']);
    });

    it('restores both html classes when the callback throws', () => {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme');
      expect(() =>
        withTheme('dark', () => {
          throw new Error('inside');
        })
      ).toThrowError('inside');
      expect(root.classList.contains('light-theme')).toBeTrue();
      expect(root.classList.contains('dark-theme')).toBeFalse();
    });

    it('holds the theme until an async callback settles', async () => {
      root.classList.remove('light-theme', 'dark-theme');
      let release!: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      const run = withTheme('dark', () => gate);

      expect(root.classList.contains('dark-theme')).toBeTrue();
      release();
      await run;
      expect(root.classList.contains('dark-theme')).toBeFalse();
      expect(root.classList.contains('light-theme')).toBeFalse();
    });
  });

  describe('hoverValue', () => {
    let button: HTMLElement;
    let other: HTMLElement;

    beforeEach(() => {
      const fixture = TestBed.createComponent(HoverFixtureComponent);
      fixture.detectChanges();
      button = fixture.nativeElement.querySelector('.chip');
      other = fixture.nativeElement.querySelector('.other');
    });

    it('returns the declared value of a :hover rule rewritten by encapsulation', () => {
      expect(hoverValue(button, '.chip', 'background-color')).toBe('var(--pc-hover-fill)');
      expect(hoverValue(button, '.chip', 'color')).toBe('rgb(1, 2, 3)');
    });

    it('returns a value that measures once applied to the element', () => {
      button.style.setProperty('--pc-hover-fill', '#3f51b5');
      button.style.setProperty('background-color', hoverValue(button, '.chip', 'background-color'));
      expect(paintedBackground(button)).toEqual([63, 81, 181]);
    });

    it('throws when no :hover rule declares the property for that element', () => {
      expect(() => hoverValue(button, '.nowhere', 'background-color')).toThrowError(
        /no :hover rule/
      );
      expect(() => hoverValue(button, '.chip', 'border-color')).toThrowError(/no :hover rule/);
      expect(() => hoverValue(other, '.chip', 'background-color')).toThrowError(/no :hover rule/);
    });
  });

  /**
   * Global and Material stylesheets are not rewritten by encapsulation, so a
   * `:hover` can stand alone as a compound, and a state layer is a rule on a
   * pseudo-element.
   */
  describe('hoverValue on unencapsulated selectors', () => {
    let sheet: HTMLStyleElement;

    /** A div carrying `className`, under `parent`. */
    function classed(className: string, parent?: HTMLElement): HTMLElement {
      const el = box('', parent);
      el.className = className;
      return el;
    }

    beforeEach(() => {
      sheet = document.createElement('style');
      sheet.textContent = `
        .pc-list :hover { color: rgb(4, 5, 6); }
        :hover > .pc-child { outline-color: rgb(7, 8, 9); }
        .pc-button:hover > .pc-ripple::before { opacity: 0.08; }
        .pc-button:hover > .pc-ripple:after { opacity: 0.12; }
      `;
      document.head.appendChild(sheet);
    });

    afterEach(() => sheet.remove());

    it('reads a :hover that is a compound of its own as any hovered element', () => {
      const list = classed('pc-list');
      const item = classed('', list);

      expect(hoverValue(item, '.pc-list', 'color')).toBe('rgb(4, 5, 6)');
      // The rule styles what is hovered inside the list, not the list itself.
      expect(() => hoverValue(list, '.pc-list', 'color')).toThrowError(/no :hover rule/);
    });

    it('reads a selector that opens with a bare :hover', () => {
      const child = classed('pc-child', classed(''));
      expect(hoverValue(child, '.pc-child', 'outline-color')).toBe('rgb(7, 8, 9)');
    });

    it('names the pseudo-element rules it found when asked about the element itself', () => {
      const ripple = classed('pc-ripple', classed('pc-button'));
      expect(() => hoverValue(ripple, '.pc-button', 'opacity')).toThrowError(
        /no :hover rule .*declares opacity for this element.*::before.*::after/
      );
    });

    it('reads a rule that paints a pseudo-element when asked for that pseudo-element', () => {
      const ripple = classed('pc-ripple', classed('pc-button'));
      expect(hoverValue(ripple, '.pc-button', 'opacity', '::before')).toBe('0.08');
      // Written `:after`, the legacy form, which the CSSOM serialises as `::after`.
      expect(hoverValue(ripple, '.pc-button', 'opacity', '::after')).toBe('0.12');

      const item = classed('', classed('pc-list'));
      expect(() => hoverValue(item, '.pc-list', 'color', '::before')).toThrowError(
        /for this element's ::before.*for the element itself/
      );
    });
  });
});
