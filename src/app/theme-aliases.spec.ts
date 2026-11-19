import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { PALETTES, channels, inPalette, styleRules, withTheme } from './core/services/testing';

/**
 * The colour utilities in tailwind.config.js that follow the theme, the
 * tokens in styles.scss under them, and the two global rules there that paint
 * with those tokens (a raw field's placeholder, a destructive menu item).
 *
 * Each alias is `var(--token)`, so it paints whatever that token resolves to
 * on <html>, and a probe that declares `<property>: var(<token>)` has to paint
 * the same thing. One palette is not enough to show that: two tokens can share
 * a value in light and part in dark or under high contrast, so an alias
 * pointed at the wrong one agrees with its probe in one palette only. Each row
 * is therefore read in all four palettes the app renders.
 *
 * The container carries a sentinel colour. A utility Tailwind never generated
 * then inherits the sentinel instead of the body's text colour, which would
 * otherwise match the `--text-primary` probe and pass.
 */

const SENTINEL = 'rgb(1, 2, 3)';

/** The utility prefix decides the property its colour lands on. */
function propertyOf(utility: string): 'color' | 'border-top-color' | 'background-color' {
  if (utility.startsWith('text-')) return 'color';
  if (utility.startsWith('border-')) return 'border-top-color';
  if (utility.startsWith('bg-')) return 'background-color';
  throw new Error(`theme-aliases: no property for ${utility}`);
}

/**
 * Every alias, as the utility its consumers reach for. Tailwind does not read
 * specs (tailwind.config.js), so spelling a class here generates nothing: each
 * ships because a template names it or the config's safelist holds it. A row
 * whose utility does neither fails against its probe: a text row inherits the
 * sentinel, a background row stays transparent, and a border row keeps
 * preflight's gray, which none of the border tokens holds in all four
 * palettes.
 */
const ALIASES: readonly { utility: string; token: string }[] = [
  { utility: 'text-fg', token: '--text-primary' },
  { utility: 'text-fg-secondary', token: '--text-secondary' },
  { utility: 'text-fg-muted', token: '--text-muted' },
  { utility: 'text-fg-disabled', token: '--text-disabled' },
  { utility: 'text-fg-inverse', token: '--text-inverse' },
  { utility: 'bg-surface-background', token: '--surface-background' },
  { utility: 'bg-surface-card', token: '--surface-card' },
  { utility: 'bg-surface-elevated', token: '--surface-elevated' },
  { utility: 'bg-surface-hover', token: '--surface-hover' },
  { utility: 'bg-surface-hover-active', token: '--surface-hover-active' },
  { utility: 'bg-surface-active', token: '--surface-active' },
  { utility: 'bg-surface-subtle', token: '--surface-subtle' },
  { utility: 'bg-surface-muted', token: '--surface-muted' },
  { utility: 'bg-surface-strong', token: '--surface-strong' },
  { utility: 'bg-surface-sunken', token: '--surface-sunken' },
  { utility: 'border-line', token: '--border-primary' },
  { utility: 'border-line-subtle', token: '--border-secondary' },
  { utility: 'border-line-strong', token: '--border-strong' },
  { utility: 'text-brand', token: '--color-primary' },
  { utility: 'bg-brand-soft', token: '--color-primary-light' },
  { utility: 'text-brand-text', token: '--color-primary-text' },
  { utility: 'text-accent', token: '--color-accent' },
  { utility: 'border-accent-light', token: '--color-accent-light' },
  { utility: 'text-error-text', token: '--color-error-text' },
  { utility: 'text-warning-text', token: '--color-warning-text' },
  { utility: 'text-success-text', token: '--color-success-text' },
  { utility: 'text-ai', token: '--color-ai' },
];

/** The surfaces a category glyph is measured against (#461), each a tint mixed into what it covers. */
const NAMED_SURFACES = [
  '--surface-suggestion',
  '--surface-suggestion-hover',
  '--surface-icon-selected',
  '--surface-review-selected',
  '--surface-review-duplicate',
  '--surface-menu-current',
];

describe('theme-following colours', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.color = SENTINEL;
    document.body.appendChild(container);
  });

  afterEach(() => container.remove());

  /** An element carrying `className`, or `style`, inside the sentinel container. */
  function element(className: string, style = ''): HTMLElement {
    const node = document.createElement('div');
    node.className = className;
    node.style.cssText = style;
    container.appendChild(node);
    return node;
  }

  describe('the utility aliases', () => {
    for (const { utility, token } of ALIASES) {
      const property = propertyOf(utility);

      it(`${utility} paints ${token} as its ${property} in every palette`, () => {
        const subject = element(utility);
        const probe = element('', `${property}: var(${token})`);

        for (const palette of PALETTES) {
          inPalette(palette.classes, () => {
            const declared = getComputedStyle(document.documentElement)
              .getPropertyValue(token)
              .trim();
            expect(declared).withContext(`${token} declared, ${palette.name}`).not.toBe('');
            expect(getComputedStyle(subject).getPropertyValue(property))
              .withContext(palette.name)
              .toBe(getComputedStyle(probe).getPropertyValue(property));
          });
        }
      });
    }

    it('gives --border-strong its own value under high contrast, in both themes', () => {
      const probe = element('', 'border-top-color: var(--border-strong)');
      const read = (classes: readonly string[]) =>
        inPalette(classes, () => getComputedStyle(probe).borderTopColor);

      expect(read(['light-theme', 'high-contrast'])).not.toBe(read(['light-theme']));
      expect(read(['dark-theme', 'high-contrast'])).not.toBe(read(['dark-theme']));
    });
  });

  describe('the tinted surfaces', () => {
    for (const token of NAMED_SURFACES) {
      it(`${token} is an opaque colour that follows the theme`, () => {
        const probe = element('', `background-color: var(${token})`);
        const read = (theme: 'light' | 'dark') =>
          withTheme(theme, () => getComputedStyle(probe).backgroundColor);

        const light = read('light');
        const dark = read('dark');
        expect(channels(light).alpha).withContext('light').toBe(1);
        expect(channels(dark).alpha).withContext('dark').toBe(1);
        expect(dark).not.toBe(light);
      });
    }
  });

  describe("a raw field's placeholder", () => {
    for (const tag of ['input', 'textarea'] as const) {
      it(`paints a raw ${tag}'s placeholder in --text-muted in every palette`, () => {
        const field = document.createElement(tag);
        field.placeholder = 'placeholder';
        container.appendChild(field);
        const probe = element('', 'color: var(--text-muted)');

        for (const palette of PALETTES) {
          inPalette(palette.classes, () => {
            expect(getComputedStyle(field, '::placeholder').color)
              .withContext(palette.name)
              .toBe(getComputedStyle(probe).color);
          });
        }
      });
    }
  });
});

describe('the stylesheet', () => {
  /**
   * Tailwind's `content` leaves specs out (tailwind.config.js), so a word
   * that only a spec holds generates nothing. *ring*, the name of Tailwind's
   * bare focus-halo utility, is such a word: this case spells it, comments in
   * other specs use it, and no file Tailwind's content reads holds it
   * standing alone. Were specs read again, `.ring` would be generated and
   * this case would fail. The Karma page's stylesheet comes from the same
   * config as the shipped one.
   *
   * An absence proves nothing about a sheet that was never read, and
   * `styleRules` skips a sheet whose rules cannot be read. So the case first
   * finds `.text-fg-disabled`, which only the safelist ships, in what it read.
   */
  it('ships no rule for a utility that only a spec names', () => {
    const selectors = styleRules().map(({ rule }) => rule.selectorText);

    expect(selectors.some(selector => selector === '.text-fg-disabled'))
      .withContext('the Tailwind sheet is read: a safelisted alias is in it')
      .toBeTrue();
    expect(selectors.filter(selector => /\.ring(?![\w-])/.test(selector))).toEqual([]);
  });
});

@Component({
  selector: 'app-destructive-menu-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatMenuModule, MatIconModule],
  template: `
    <button type="button" [matMenuTriggerFor]="menu">open</button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item type="button" class="menu-item-destructive">
        <mat-icon>delete</mat-icon>
        <span>Delete</span>
      </button>
    </mat-menu>
  `,
})
class DestructiveMenuHostComponent {}

describe('.menu-item-destructive', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  /**
   * Material paints a menu item's label and icon from its own tokens, in
   * rules that outrank a utility class on the item, so the label and icon are
   * read where they are painted rather than off the item.
   */
  it('paints the label and the icon of a menu item in --color-error-text, in both themes', () => {
    const fixture = TestBed.createComponent(DestructiveMenuHostComponent);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    fixture.detectChanges();

    const panel = document.querySelector('.mat-mdc-menu-panel')!;
    const label = panel.querySelector('.mat-mdc-menu-item-text')!;
    const icon = panel.querySelector('mat-icon')!;
    const probe = document.createElement('div');
    probe.style.color = 'var(--color-error-text)';
    panel.appendChild(probe);

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        const expected = getComputedStyle(probe).color;
        expect(getComputedStyle(label).color).withContext(`label, ${theme}`).toBe(expected);
        expect(getComputedStyle(icon).color).withContext(`icon, ${theme}`).toBe(expected);
      });
    }
  });
});
