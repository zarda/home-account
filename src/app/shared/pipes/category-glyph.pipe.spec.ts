import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { CategoryGlyphPipe } from './category-glyph.pipe';
import { EffectiveTheme, ThemeService } from '../../core/services/theme.service';
import {
  CATEGORY_SURFACES,
  CategorySurface,
  Rgb,
  categoryGlyphColor,
} from '../../core/utils/color-contrast.utils';
import {
  AUDIT_SCHEMES,
  channels,
  hoverValue,
  paintedBackground,
  ratio,
  withScheme,
  withTheme,
} from '../../core/services/testing';
import {
  CATEGORY_FALLBACK_COLOR,
  CATEGORY_PALETTE,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS,
} from '../../models';

/** Lower-case `#rrggbb` to channels, written out here so the pipe is not measured by the parser it uses. */
function rgbOf(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!match) throw new Error(`not lower-case #rrggbb: "${hex}"`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function hexOf(rgb: Rgb): string {
  return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
}

/** The sixteen seeded colours, the picker's fifteen and the fallback grey among them. */
const CATEGORY_COLOURS = [
  ...new Set(
    [
      ...[...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].map(group => group.color),
      ...CATEGORY_PALETTE,
      CATEGORY_FALLBACK_COLOR,
    ].map(color => color.toLowerCase())
  ),
];

/**
 * Colours no category ships with but a user's data can hold: the extremes,
 * the greys either side of where black and white trade places, the surfaces
 * themselves, and the short and opaque-alpha spellings.
 */
const HOSTILE = [
  '#ffffff',
  '#000000',
  '#ffff00',
  '#0000ff',
  '#00ff00',
  '#ff00ff',
  '#757575',
  '#767676',
  '#808080',
  '#f43f5e',
  '#fbf8ff',
  '#121319',
  '#fff',
  '#ff9800ff',
];

const SURFACES = Object.keys(CATEGORY_SURFACES) as CategorySurface[];

describe('CategoryGlyphPipe', () => {
  let pipe: CategoryGlyphPipe;
  let theme: ThemeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CategoryGlyphPipe] });
    pipe = TestBed.inject(CategoryGlyphPipe);
    theme = TestBed.inject(ThemeService);
  });

  it('answers categoryGlyphColor for the theme in effect', () => {
    for (const scheme of AUDIT_SCHEMES) {
      withScheme(theme, scheme, () => {
        expect(pipe.transform('#8BC34A', 'panel'))
          .withContext(scheme)
          .toBe(categoryGlyphColor('#8BC34A', 'panel', scheme));
      });
    }
  });

  it('works the colour out again when only the theme changes', () => {
    // The theme is not an argument, so a memo that left it out would keep
    // the first theme's answer after a switch.
    const light = withScheme(theme, 'light', () => pipe.transform('#3F51B5', 'panel'));
    const dark = withScheme(theme, 'dark', () => pipe.transform('#3F51B5', 'panel'));

    expect(light).toBe(categoryGlyphColor('#3F51B5', 'panel', 'light'));
    expect(dark).toBe(categoryGlyphColor('#3F51B5', 'panel', 'dark'));
    expect(dark).not.toBe(light);
  });

  it('memoises on the colour, the surface and the theme together', () => {
    withScheme(theme, 'light', () => {
      // Every contrast measurement goes through Math.pow, so a repeat that
      // calls it was worked out again rather than remembered.
      const pow = spyOn(Math, 'pow').and.callThrough();

      const first = pipe.transform('#8BC34A', 'panel');
      const worked = pow.calls.count();
      expect(worked).withContext('the first call measures').toBeGreaterThan(0);

      expect(pipe.transform('#8BC34A', 'panel')).toBe(first);
      expect(pow.calls.count()).withContext('a repeat is remembered').toBe(worked);

      expect(pipe.transform('#8BC34A', 'subtle')).toBe(categoryGlyphColor('#8BC34A', 'subtle', 'light'));
      expect(pow.calls.count()).withContext('another surface is measured').toBeGreaterThan(worked);

      expect(pipe.transform('#FF9800', 'subtle')).toBe(categoryGlyphColor('#FF9800', 'subtle', 'light'));
    });
  });

  it('passes a colour it cannot read through, and paints nothing for an absent one', () => {
    withScheme(theme, 'light', () => {
      for (const color of ['', 'rebeccapurple', '#ff980080', 'var(--color-primary)']) {
        expect(pipe.transform(color, 'panel')).withContext(color).toBe(color);
      }
      expect(pipe.transform(null, 'panel')).toBe('');
      expect(pipe.transform(undefined, 'menu')).toBe('');
    });
  });

  it('puts every category colour, and hostile ones, at 4.5:1 or more on every tone of every surface', () => {
    expect(CATEGORY_COLOURS.length).toBe(31);
    const failures: string[] = [];
    for (const scheme of AUDIT_SCHEMES) {
      withScheme(theme, scheme, () => {
        for (const surface of SURFACES) {
          for (const color of [...CATEGORY_COLOURS, ...HOSTILE]) {
            const glyph = pipe.transform(color, surface);
            for (const tone of CATEGORY_SURFACES[surface][scheme]) {
              const measured = ratio(rgbOf(glyph), rgbOf(tone));
              if (measured < 4.5) {
                failures.push(`${scheme} ${surface}: ${color} → ${glyph} on ${tone} is ${measured.toFixed(3)}`);
              }
            }
          }
        }
      });
    }
    expect(failures).toEqual([]);
  });
});

@Component({
  selector: 'app-glyph-host',
  standalone: true,
  imports: [CategoryGlyphPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="glyph" [style.color]="color() | categoryGlyph: 'panel'">restaurant</span>`,
})
class GlyphHostComponent {
  readonly color = signal<string | null>('#3F51B5');
}

describe('CategoryGlyphPipe in a template', () => {
  it('repaints the glyph on a theme switch, with nothing else marking the view', () => {
    TestBed.configureTestingModule({ imports: [GlyphHostComponent] });
    const fixture = TestBed.createComponent(GlyphHostComponent);
    // Attached to the application, so a tick refreshes the view only when
    // something it read has changed: here, the theme the pipe reads.
    fixture.autoDetectChanges();
    const theme = TestBed.inject(ThemeService);
    const glyph = () => fixture.nativeElement.querySelector('.glyph') as HTMLElement;

    for (const scheme of AUDIT_SCHEMES) {
      withScheme(theme, scheme, () => {
        expect(channels(getComputedStyle(glyph()).color).rgb)
          .withContext(scheme)
          .toEqual(rgbOf(categoryGlyphColor('#3F51B5', 'panel', scheme)));
      });
    }
  });

  it('removes the colour for an empty or absent one, so the glyph inherits', () => {
    TestBed.configureTestingModule({ imports: [GlyphHostComponent] });
    const fixture = TestBed.createComponent(GlyphHostComponent);
    fixture.autoDetectChanges();
    const glyph = () => fixture.nativeElement.querySelector('.glyph') as HTMLElement;
    expect(glyph().style.color).not.toBe('');

    for (const empty of ['', null]) {
      fixture.componentInstance.color.set(empty);
      TestBed.tick();
      expect(glyph().style.color).withContext(String(empty)).toBe('');
      fixture.componentInstance.color.set('#3F51B5');
      TestBed.tick();
    }
  });
});

@Component({
  selector: 'app-stroked-host',
  standalone: true,
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="base"><button mat-stroked-button type="button">restaurant</button></div>`,
})
class StrokedHostComponent {}

/**
 * The tones in CATEGORY_SURFACES are literals, so each is held here to what
 * the stylesheet paints: Material's system colours under the scheme, the
 * named --surface-* tokens under the theme's class, Material's state layers
 * composited the way its rules paint them, and the stroked button's layers
 * read off a rendered button. A token, a mix or a Material update that moves
 * a tone fails here, before a glyph is corrected against a surface that is
 * no longer there.
 */
describe('CATEGORY_SURFACES, held to the stylesheet', () => {
  /** A state layer: `colour` at `opacity`, the shape every Material state rule falls back to. */
  const layer = (colour: string, opacity: string) =>
    `color-mix(in srgb, var(${colour}) calc(var(${opacity}) * 100%), transparent)`;

  // Each is the value Material's own rule paints, its component token and
  // the system fallback alike.
  const DIALOG = 'var(--mat-dialog-container-color, var(--mat-sys-surface))';
  const PANEL = 'var(--mat-select-panel-background-color, var(--mat-sys-surface-container))';
  const OPTION_HOVER = `var(--mat-option-hover-state-layer-color, ${layer('--mat-sys-on-surface', '--mat-sys-hover-state-layer-opacity')})`;
  const OPTION_ACTIVE = `var(--mat-option-focus-state-layer-color, ${layer('--mat-sys-on-surface', '--mat-sys-focus-state-layer-opacity')})`;
  const OPTION_SELECTED = 'var(--mat-option-selected-state-layer-color, var(--mat-sys-secondary-container))';
  const MENU = 'var(--mat-menu-container-color, var(--mat-sys-surface-container))';
  const MENU_HOVER = `var(--mat-menu-item-hover-state-layer-color, ${layer('--mat-sys-on-surface', '--mat-sys-hover-state-layer-opacity')})`;
  const MENU_FOCUS = `var(--mat-menu-item-focus-state-layer-color, ${layer('--mat-sys-on-surface', '--mat-sys-focus-state-layer-opacity')})`;

  /** The import review card's backgrounds under its category button: checked, unchecked, hovered, duplicate. */
  const REVIEW_CARD = [
    '--surface-review-selected',
    '--surface-background',
    '--surface-hover',
    '--surface-review-duplicate',
  ];

  afterEach(() => {
    document.querySelectorAll('.surface-probe').forEach(node => node.remove());
  });

  /**
   * What `background-color: value` paints under `scheme`, laid over an
   * opaque `under` when one is given, as `#rrggbb`.
   */
  function painted(scheme: EffectiveTheme, value: string, under?: string): string {
    const root = document.createElement('div');
    root.className = 'surface-probe';
    root.style.colorScheme = scheme;
    root.style.backgroundColor = under ?? value;
    const top = document.createElement('div');
    top.style.height = '1px';
    if (under) top.style.backgroundColor = value;
    root.appendChild(top);
    document.body.appendChild(root);
    try {
      return hexOf(paintedBackground(under ? top : root));
    } finally {
      root.remove();
    }
  }

  const token = (scheme: EffectiveTheme, name: string) => painted(scheme, `var(${name})`);

  function panelTones(scheme: EffectiveTheme): string[] {
    return [
      painted(scheme, PANEL),
      painted(scheme, OPTION_HOVER, PANEL),
      painted(scheme, OPTION_ACTIVE, PANEL),
      painted(scheme, OPTION_SELECTED),
    ];
  }

  /** `ink` at `alpha` over `under`, rounded the way a browser paints it. */
  function over(ink: Rgb, alpha: number, under: Rgb): Rgb {
    const mix = (i: 0 | 1 | 2) => Math.round(ink[i] * alpha + under[i] * (1 - alpha));
    return [mix(0), mix(1), mix(2)];
  }

  /**
   * A rendered stroked button on `base`: the base at rest, then with the
   * button's hover and keyboard-focus state layers (its `::before`) over it.
   */
  function strokedTones(base: string): string[] {
    const fixture = TestBed.createComponent(StrokedHostComponent);
    fixture.detectChanges();
    try {
      const surface = fixture.nativeElement.querySelector('.base') as HTMLElement;
      surface.style.backgroundColor = `var(${base})`;
      const button = surface.querySelector('button') as HTMLElement;
      const ripple = button.querySelector('.mat-mdc-button-persistent-ripple') as HTMLElement;
      const rest = paintedBackground(button);
      const ink = channels(getComputedStyle(ripple, '::before').backgroundColor).rgb;

      // Karma cannot hover, so the :hover opacity is read from the rule and
      // resolved on a probe; keyboard focus is a class, so it is applied.
      const probe = document.createElement('span');
      probe.style.opacity = hoverValue(ripple, '.mat-mdc-outlined-button', 'opacity', '::before');
      ripple.appendChild(probe);
      const hover = Number(getComputedStyle(probe).opacity);
      probe.remove();
      button.classList.add('cdk-keyboard-focused');
      const focus = Number(getComputedStyle(ripple, '::before').opacity);
      button.classList.remove('cdk-keyboard-focused');

      expect(hover).withContext(`${base} hover layer`).toBeGreaterThan(0);
      expect(focus).withContext(`${base} focus layer`).toBeGreaterThan(0);
      return [rest, over(ink, hover, rest), over(ink, focus, rest)].map(hexOf);
    } finally {
      fixture.destroy();
    }
  }

  const MEASURED: Record<CategorySurface, (scheme: EffectiveTheme) => string[]> = {
    dialog: scheme => [painted(scheme, DIALOG)],
    panel: scheme => panelTones(scheme),
    menu: scheme => [...panelTones(scheme), token(scheme, '--surface-menu-current')],
    subtle: scheme => [token(scheme, '--surface-subtle')],
    reviewCard: () => REVIEW_CARD.flatMap(strokedTones),
    suggestionChip: scheme => [token(scheme, '--surface-suggestion'), token(scheme, '--surface-suggestion-hover')],
    iconGrid: scheme => [token(scheme, '--surface-icon-selected')],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StrokedHostComponent] });
  });

  it('measures every surface it lists, and lists every surface it measures', () => {
    expect(Object.keys(CATEGORY_SURFACES).sort()).toEqual(Object.keys(MEASURED).sort());
  });

  it('writes every tone as lower-case #rrggbb, so it can be measured', () => {
    for (const surface of SURFACES) {
      for (const scheme of AUDIT_SCHEMES) {
        const tones = CATEGORY_SURFACES[surface][scheme];
        expect(tones.length).withContext(`${surface} ${scheme}`).toBeGreaterThan(0);
        for (const tone of tones) {
          expect(tone).withContext(`${surface} ${scheme}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  for (const surface of SURFACES) {
    it(`holds ${surface} to what the stylesheet paints, in both themes`, () => {
      for (const scheme of AUDIT_SCHEMES) {
        withTheme(scheme, () => {
          expect([...CATEGORY_SURFACES[surface][scheme]])
            .withContext(scheme)
            .toEqual(MEASURED[surface](scheme));
        });
      }
    });
  }

  it('covers the menu\'s own rest, hover and keyboard focus with the tones it lists', () => {
    for (const scheme of AUDIT_SCHEMES) {
      withTheme(scheme, () => {
        const own = [painted(scheme, MENU), painted(scheme, MENU_HOVER, MENU), painted(scheme, MENU_FOCUS, MENU)];
        for (const tone of own) {
          expect(CATEGORY_SURFACES.menu[scheme]).withContext(`${scheme} ${tone}`).toContain(tone);
        }
      });
    }
  });
});
