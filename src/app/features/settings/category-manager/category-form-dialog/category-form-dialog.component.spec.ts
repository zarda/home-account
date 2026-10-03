import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { CategoryFormDialogComponent } from './category-form-dialog.component';
import { TranslationService } from '../../../../core/services/translation.service';
import { ThemeService } from '../../../../core/services/theme.service';
import {
  AUDIT_SCHEMES,
  GLYPH_PROBE_COLOURS,
  channels,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withScheme,
  withTheme,
} from '../../../../core/services/testing';
import type { Rgb } from '../../../../core/utils/color-contrast.utils';
import {
  CATEGORY_FALLBACK_COLOR,
  CATEGORY_PALETTE,
  Category,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS,
} from '../../../../models';

describe('CategoryFormDialogComponent', () => {
  let fixture: ComponentFixture<CategoryFormDialogComponent>;
  let component: CategoryFormDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CategoryFormDialogComponent>>;

  // Sentinels rather than the English catalog text: if the template ever goes
  // back to hard-coding "Category Name", asserting the sentinel fails, where
  // asserting the English string would keep passing for the wrong reason.
  const translations: Record<string, string> = {
    'settings.categoryName': 'name-label-t',
    'settings.categoryNamePlaceholder': 'name-placeholder-t',
    'settings.icon': 'icon-label-t',
    'settings.color': 'color-label-t',
    'settings.preview': 'preview-label-t',
    'settings.saveChanges': 'save-changes-t',
    'settings.createCategory': 'create-category-t',
    'settings.iconSelection': 'icon-group-t',
    'settings.colorSelection': 'color-group-t',
    'common.cancel': 'cancel-t',
  };

  async function setup(data: { category?: Category; type: 'expense' | 'income' }): Promise<void> {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => translations[key] ?? key);

    await TestBed.configureTestingModule({
      imports: [CategoryFormDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: TranslationService, useValue: translationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('translated rendering', () => {
    it('renders every label and section heading through the catalog', async () => {
      await setup({ type: 'expense' });
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('name-label-t');
      expect(text).toContain('icon-label-t');
      expect(text).toContain('color-label-t');
      expect(text).toContain('preview-label-t');
      expect(text).toContain('cancel-t');
    });

    it('translates the name input placeholder', async () => {
      await setup({ type: 'expense' });
      const input = fixture.nativeElement.querySelector('input[matInput]') as HTMLInputElement;
      expect(input.getAttribute('placeholder')).toBe('name-placeholder-t');
    });

    it('gives both radiogroups translated aria-labels', async () => {
      await setup({ type: 'expense' });
      const groups = fixture.nativeElement.querySelectorAll('[role="radiogroup"]');
      const labels = Array.from(groups, (el: Element) => el.getAttribute('aria-label'));
      expect(labels).toEqual(['icon-group-t', 'color-group-t']);
    });

    it('falls back to the translated name label in the preview when the name is empty', async () => {
      await setup({ type: 'expense' });
      expect(
        (fixture.nativeElement.querySelector('.preview-name') as HTMLElement).textContent!.trim()
      ).toBe('name-label-t');
    });

    it('shows the typed name in the preview once there is one', async () => {
      await setup({ type: 'expense' });
      component.name = 'Coffee';
      fixture.detectChanges();
      expect(
        (fixture.nativeElement.querySelector('.preview-name') as HTMLElement).textContent!.trim()
      ).toBe('Coffee');
    });

    it('labels the submit button per mode: create', async () => {
      await setup({ type: 'expense' });
      expect(fixture.nativeElement.textContent).toContain('create-category-t');
      expect(fixture.nativeElement.textContent).not.toContain('save-changes-t');
    });

    it('labels the submit button per mode: edit', async () => {
      await setup({
        type: 'expense',
        category: { id: 'c1', name: 'Food', icon: 'restaurant', color: '#ef4444', type: 'expense' } as Category,
      });
      expect(fixture.nativeElement.textContent).toContain('save-changes-t');
    });
  });

  describe('save and cancel', () => {
    it('refuses to save a blank name', async () => {
      await setup({ type: 'expense' });
      component.name = '   ';
      component.save();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('closes with the trimmed name and the selected icon and color', async () => {
      await setup({ type: 'expense' });
      component.name = '  Coffee  ';
      component.selectIcon('local_cafe');
      component.selectColor('#f97316');
      component.save();
      expect(dialogRef.close).toHaveBeenCalledWith({
        name: 'Coffee',
        icon: 'local_cafe',
        color: '#f97316',
      });
    });

    it('cancel closes without a result', async () => {
      await setup({ type: 'expense' });
      component.cancel();
      expect(dialogRef.close).toHaveBeenCalledWith();
    });
  });

  describe('colours, as painted', () => {
    const THEMES = ['light', 'dark'] as const;
    const el = () => fixture.nativeElement as HTMLElement;
    const part = (selector: string) => el().querySelector(selector) as HTMLElement;
    const iconButton = (icon: string) =>
      (Array.from(el().querySelectorAll('.icon-btn')) as HTMLElement[]).find(
        button => button.textContent?.trim() === icon
      ) as HTMLElement;

    /**
     * The form, painted with the surface Material gives the dialog container
     * (`dialog-container-color` is `surface` in M3), which is what it sits on
     * in the app.
     */
    beforeEach(async () => {
      await setup({ type: 'expense' });
      el().style.display = 'block';
      el().style.background = 'var(--mat-sys-surface)';
    });

    /** What `<property>: var(token)` computes to under the theme on <html> now. */
    function tokenValue(token: string, property = 'color'): string {
      const probe = document.createElement('span');
      probe.style.setProperty(property, `var(${token})`);
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).getPropertyValue(property);
      } finally {
        probe.remove();
      }
    }

    /** `node` is `token`, and reads at `floor` or better on what is painted behind it. */
    function expectPainted(node: HTMLElement, token: string, label: string, floor = 4.5): void {
      expect(node).withContext(label).toBeTruthy();
      expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
      expect(ratio(paintedColor(node), paintedBackground(node)))
        .withContext(`${label} on what it sits on`)
        .toBeGreaterThanOrEqual(floor);
    }

    /** A computed colour as the whole channels it is painted in. */
    function rounded(computed: string): Rgb {
      const [r, g, b] = channels(computed).rgb.map(Math.round);
      return [r, g, b];
    }

    /** Each colour of a computed `box-shadow` list, in the order the layers are declared. */
    const shadowColours = (shadow: string): string[] =>
      Array.from(shadow.matchAll(/(?:rgba?|color)\([^)]*\)/g), match => match[0]);

    it('paints the section labels, the preview name and the preview rule in the theme tokens, in both themes', () => {
      const labels = Array.from(el().querySelectorAll('.section-label')) as HTMLElement[];
      expect(labels.length).withContext('icon, colour and preview').toBe(3);

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          labels.forEach((label, i) => expectPainted(label, '--text-secondary', `${theme} section label ${i}`));
          expectPainted(part('.preview-name'), '--text-primary', `${theme} preview name`);
          expect(getComputedStyle(part('.preview-section')).borderTopColor)
            .withContext(`${theme} preview rule`)
            .toBe(tokenValue('--border-primary'));
        });
      }
    });

    // A glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11).
    it('draws each icon choice on --surface-card behind an edge in --border-primary, its glyph in --text-muted at 3:1 or better at rest and hovered, in both themes', () => {
      const button = iconButton('restaurant');
      const glyph = button.querySelector('mat-icon') as HTMLElement;
      const hovered = hoverValue(button, '.icon-btn', 'background-color');
      expect(hovered).withContext('the hover rule').toBe('var(--surface-icon-selected)');

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          expect(getComputedStyle(button).backgroundColor)
            .withContext(`${theme} fill at rest`)
            .toBe(tokenValue('--surface-card', 'background-color'));
          expect(getComputedStyle(button).borderTopColor)
            .withContext(`${theme} edge at rest`)
            .toBe(tokenValue('--border-primary'));
          expectPainted(glyph, '--text-muted', `${theme} glyph at rest`, 3);

          button.style.backgroundColor = hovered;
          try {
            expectPainted(glyph, '--text-muted', `${theme} glyph hovered`, 3);
          } finally {
            button.style.backgroundColor = '';
          }
        });
      }
    });

    it('fills the chosen icon with --surface-icon-selected, as painted, in both themes', () => {
      iconButton('restaurant').click();
      fixture.detectChanges();
      const chosen = el().querySelector('.icon-btn.selected') as HTMLElement;
      expect(chosen?.textContent?.trim()).withContext('the clicked icon is the chosen one').toBe('restaurant');

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          const token = tokenValue('--surface-icon-selected', 'background-color');
          expect(getComputedStyle(chosen).backgroundColor).withContext(`${theme} its own fill`).toBe(token);
          expect(paintedBackground(chosen)).withContext(`${theme} as painted`).toEqual(rounded(token));
        });
      }
    });

    /**
     * Every colour a category can take: the picker's palette (a new
     * category's default among them), and the seeded colours and the
     * fallback, which an edited category can carry.
     */
    const everyCategoryColour = (): string[] => [
      ...new Set(
        [
          ...[...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].map(group => group.color),
          ...CATEGORY_PALETTE,
          CATEGORY_FALLBACK_COLOR,
        ].map(color => color.toLowerCase())
      ),
    ];

    /** Opens the dialog afresh on a category of `color`, the path that reaches every colour. */
    const setupIn = async (color: string): Promise<void> => {
      TestBed.resetTestingModule();
      await setup({
        type: 'expense',
        category: { id: 'c1', name: 'Food', icon: 'restaurant', color, type: 'expense' } as Category,
      });
    };

    it('draws the preview glyph at AA or better on its tile for every colour a category can take, in both themes', async () => {
      const colours = everyCategoryColour();
      expect(colours.length).toBe(31);
      expect(colours).withContext("a new category's colour").toContain(component.selectedColor.toLowerCase());

      for (const color of colours) {
        await setupIn(color);
        for (const scheme of AUDIT_SCHEMES) {
          withScheme(TestBed.inject(ThemeService), scheme, () => {
            fixture.detectChanges();
            const glyph = part('.preview-item mat-icon');
            const tile = paintedBackground(glyph.parentElement as HTMLElement);
            // The tile is redrawn for the scheme, so the dark pass is not the light one again.
            expect(scheme === 'dark' ? Math.max(...tile) < 128 : Math.min(...tile) > 128)
              .withContext(`${scheme} ${color} tile drawn for the scheme`)
              .toBeTrue();
            expect(ratio(paintedColor(glyph), tile))
              .withContext(`${scheme} ${color} preview glyph on its tile`)
              .toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    });

    // The chosen icon is drawn in the chosen colour on its
    // --surface-icon-selected fill, corrected for it.
    it('draws the chosen icon at AA or better on --surface-icon-selected for every colour a category can take, in both themes', async () => {
      const colours = everyCategoryColour();
      expect(colours).toContain(GLYPH_PROBE_COLOURS.light.toLowerCase());
      expect(colours).toContain(GLYPH_PROBE_COLOURS.dark.toLowerCase());

      for (const color of colours) {
        await setupIn(color);
        for (const scheme of AUDIT_SCHEMES) {
          withScheme(TestBed.inject(ThemeService), scheme, () => {
            fixture.detectChanges();
            const chosen = el().querySelector('.icon-btn.selected') as HTMLElement;
            expect(chosen?.textContent?.trim()).withContext(`${scheme} ${color} the chosen icon`).toBe('restaurant');
            const glyph = chosen.querySelector('mat-icon') as HTMLElement;
            expect(paintedBackground(glyph))
              .withContext(`${scheme} ${color} on --surface-icon-selected`)
              .toEqual(rounded(tokenValue('--surface-icon-selected', 'background-color')));
            expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
              .withContext(`${scheme} ${color} chosen icon`)
              .toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    });

    /** `color` as the browser computes a background in it. */
    function computedFill(color: string): string {
      const probe = document.createElement('span');
      probe.style.backgroundColor = color;
      document.body.appendChild(probe);
      try {
        return getComputedStyle(probe).backgroundColor;
      } finally {
        probe.remove();
      }
    }

    // The check sits on the colour its swatch offers, which no theme changes.
    it('draws the check on each chosen swatch at AA or better on the colour it offers, in both themes', () => {
      const swatches = Array.from(el().querySelectorAll('.color-btn')) as HTMLElement[];
      expect(swatches.length).withContext('one swatch per palette colour').toBe(CATEGORY_PALETTE.length);

      swatches.forEach((swatch, i) => {
        const color = CATEGORY_PALETTE[i];
        swatch.click();
        fixture.detectChanges();
        expect(component.selectedColor).withContext(`${color} chosen`).toBe(color);
        const check = swatch.querySelector('mat-icon') as HTMLElement;
        expect(check?.textContent?.trim()).withContext(`${color} check`).toBe('check');

        for (const scheme of AUDIT_SCHEMES) {
          withScheme(TestBed.inject(ThemeService), scheme, () => {
            fixture.detectChanges();
            expect(paintedBackground(check))
              .withContext(`${scheme} ${color} swatch fill`)
              .toEqual(rounded(computedFill(color)));
            expect(ratio(paintedColor(check), paintedBackground(check)))
              .withContext(`${scheme} ${color} check on its swatch`)
              .toBeGreaterThanOrEqual(4.5);
          });
        }
      });
    });

    /**
     * The chosen swatch is marked by an edge, a gap and an outer halo. The
     * halo and the edge are what tell the chosen colour from the others, so
     * each is held to 3:1 against the dialog (WCAG 1.4.11); the gap is the
     * dialog's own surface, so it reads as space rather than as a third
     * colour. (The word for the halo is kept off Tailwind's utility names:
     * the content scan reads specs, and a bare utility name here would ship
     * its CSS in the initial bundle.)
     */
    it('marks the chosen swatch with an edge and a halo in --text-primary at 3:1 or better on the dialog, with a gap of the dialog surface, in both themes', () => {
      const chosen = el().querySelector('.color-btn.selected') as HTMLElement;
      expect(chosen).withContext("a new category's colour is one of the swatches").toBeTruthy();

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          const dialog = paintedBackground(part('.colors-grid'));
          const style = getComputedStyle(chosen);
          const [gap, halo] = shadowColours(style.boxShadow);

          expect(gap).withContext(`${theme} gap`).toBe(tokenValue('--mat-sys-surface'));
          expect(halo).withContext(`${theme} halo`).toBe(tokenValue('--text-primary'));
          expect(ratio(channels(halo).rgb, dialog))
            .withContext(`${theme} halo on the dialog`)
            .toBeGreaterThanOrEqual(3);
          expect(style.borderTopColor).withContext(`${theme} edge`).toBe(tokenValue('--text-primary'));
          expect(ratio(channels(style.borderTopColor).rgb, dialog))
            .withContext(`${theme} edge against the gap`)
            .toBeGreaterThanOrEqual(3);
        });
      }
    });
  });
});
