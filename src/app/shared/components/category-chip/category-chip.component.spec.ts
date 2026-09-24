import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CHIP_SURFACE, CategoryChipComponent } from './category-chip.component';
import { WCAG_AA_TEXT, contrastRatio, parseHexColor } from '../../../core/utils/color-contrast.utils';
import { ThemeService } from '../../../core/services/theme.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Category, DEFAULT_EXPENSE_GROUPS, DEFAULT_INCOME_GROUPS } from '../../../models';

describe('CategoryChipComponent', () => {
  let component: CategoryChipComponent;
  let fixture: ComponentFixture<CategoryChipComponent>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  const category: Category = {
    id: 'food',
    userId: null,
    name: 'category.food',
    icon: 'restaurant',
    color: '#3366CC',
    type: 'expense',
    order: 0,
    isActive: true,
    isDefault: true,
  };

  beforeEach(async () => {
    mockThemeService = jasmine.createSpyObj('ThemeService', ['effectiveTheme']);
    mockThemeService.effectiveTheme.and.returnValue('light');
    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [CategoryChipComponent],
      providers: [
        { provide: ThemeService, useValue: mockThemeService },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryChipComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a category chip', () => {
    component.category = category;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('restaurant');
  });

  describe('getBackgroundColor', () => {
    it('paints the tint opaque, over the card surface, in light mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      // #FF9800 at alpha 0x20 on #ffffff.
      expect(component.getBackgroundColor('#FF9800')).toBe('#fff2df');
    });

    it('paints a stronger tint over the dark card surface in dark mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('dark');
      // #FF9800 at alpha 0x40 on #1e1e1e.
      expect(component.getBackgroundColor('#FF9800')).toBe('#563d16');
    });

    it('reads three-digit hex, the budget card\'s fallback', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      expect(component.getBackgroundColor('#666')).toBe('#ececec');
    });

    it('falls back to the plain card surface for a colour it cannot tint', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      expect(component.getBackgroundColor('rebeccapurple')).toBe(CHIP_SURFACE.light);
      mockThemeService.effectiveTheme.and.returnValue('dark');
      expect(component.getBackgroundColor('rebeccapurple')).toBe(CHIP_SURFACE.dark);
    });
  });

  describe('getTextColor', () => {
    it('keeps a colour that already clears AA on its tint', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      expect(component.getTextColor('#3F51B5')).toBe('#3f51b5');
    });

    it('darkens a light colour in light mode rather than painting it on its own tint', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      const result = component.getTextColor('#FF9800');
      expect(result).not.toBe('#ff9800');
      expect(contrastRatio(parseHexColor(result)!, [255, 242, 223]))
        .toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    });

    it('lightens a dark colour in dark mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('dark');
      const [r, g, b] = parseHexColor(component.getTextColor('#3F51B5'))!;
      expect(r).toBeGreaterThan(0x3f);
      expect(g).toBeGreaterThan(0x51);
      expect(b).toBeGreaterThan(0xb5);
    });

    it('handles colours without a leading hash', () => {
      mockThemeService.effectiveTheme.and.returnValue('dark');
      expect(component.getTextColor('ffffff')).toBe('#ffffff');
    });

    it('passes a colour it cannot read through unchanged', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      expect(component.getTextColor('rebeccapurple')).toBe('rebeccapurple');
    });
  });

  /**
   * What is measured is what the browser painted: the computed colour of the
   * glyph (and the pill's label) against the computed background of the box
   * it sits in, with the ratio worked out here by the WCAG formula rather
   * than by the utility under test.
   */
  describe('contrast on the painted tint', () => {
    const CATALOGUE = [...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].map(group => group.color);
    const HOSTILE = ['#FFFF00', '#FFFFFF', '#000000', '#777777'];
    const COLOURS = [...new Set([...CATALOGUE, ...HOSTILE])];

    function channels(computed: string): { rgb: [number, number, number]; alpha: number } {
      const parts = computed.match(/[\d.]+/g)!.map(Number);
      return { rgb: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? parts[3] : 1 };
    }

    function wcagRatio(a: [number, number, number], b: [number, number, number]): number {
      const lum = (rgb: [number, number, number]) => {
        const [r, g, bl] = rgb.map(value => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      };
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    }

    function render(theme: 'light' | 'dark', color: string, appearance: 'tile' | 'pill') {
      mockThemeService.effectiveTheme.and.returnValue(theme);
      const host = TestBed.createComponent(CategoryChipComponent);
      host.componentRef.setInput('appearance', appearance);
      host.componentRef.setInput('size', 'sm');
      host.componentRef.setInput('color', color);
      host.componentRef.setInput('icon', 'restaurant');
      host.componentRef.setInput('label', 'category.food');
      host.detectChanges();
      return host;
    }

    it('gives every catalogue and custom colour a tile icon at AA or better, in both themes', () => {
      expect(CATALOGUE.length).toBeGreaterThan(10);
      for (const theme of ['light', 'dark'] as const) {
        for (const color of COLOURS) {
          const host = render(theme, color, 'tile');
          const tile = host.nativeElement.querySelector('.tile') as HTMLElement;
          const icon = tile.querySelector('mat-icon') as HTMLElement;
          const background = channels(getComputedStyle(tile).backgroundColor);
          const glyph = channels(getComputedStyle(icon).color);

          expect(background.alpha).withContext(`${theme} ${color} tile is opaque`).toBe(1);
          expect(wcagRatio(glyph.rgb, background.rgb))
            .withContext(`${theme} ${color} icon on its tile`)
            .toBeGreaterThanOrEqual(4.5);
          host.destroy();
        }
      }
    });

    it('gives the pill\'s label the same, in both themes', () => {
      for (const theme of ['light', 'dark'] as const) {
        for (const color of COLOURS) {
          const host = render(theme, color, 'pill');
          const label = host.nativeElement.querySelector('span.font-medium') as HTMLElement;
          const pill = label.parentElement as HTMLElement;
          const background = channels(getComputedStyle(pill).backgroundColor);
          const text = channels(getComputedStyle(label).color);

          expect(background.alpha).withContext(`${theme} ${color} pill is opaque`).toBe(1);
          expect(wcagRatio(text.rgb, background.rgb))
            .withContext(`${theme} ${color} label on its pill`)
            .toBeGreaterThanOrEqual(4.5);
          host.destroy();
        }
      }
    });

    it('keeps the category\'s hue: a darkened orange is still orange', () => {
      const host = render('light', '#FF9800', 'tile');
      const [r, g, b] = channels(getComputedStyle(host.nativeElement.querySelector('.tile mat-icon')).color).rgb;
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(g / r).toBeCloseTo(152 / 255, 1);
      host.destroy();
    });
  });

  /**
   * The tint is composited over one surface in TypeScript, so the value it
   * assumes has to be the one the stylesheet paints the card with.
   */
  describe('CHIP_SURFACE', () => {
    it('matches the stylesheet\'s --surface-card in both themes', () => {
      const root = document.documentElement;
      const hadDark = root.classList.contains('dark-theme');
      root.classList.remove('dark-theme');
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      try {
        const light = getComputedStyle(probe).getPropertyValue('--surface-card').trim();
        probe.classList.add('dark-theme');
        const dark = getComputedStyle(probe).getPropertyValue('--surface-card').trim();

        expect(light.toLowerCase()).toBe(CHIP_SURFACE.light);
        expect(dark.toLowerCase()).toBe(CHIP_SURFACE.dark);
      } finally {
        probe.remove();
        if (hadDark) root.classList.add('dark-theme');
      }
    });
  });

  describe('tile appearance', () => {
    it('renders an icon-only tile with the category color', () => {
      component.appearance = 'tile';
      component.icon = 'restaurant';
      component.color = '#3366CC';
      fixture.detectChanges();

      const tile: HTMLElement = fixture.nativeElement.querySelector('.tile');
      expect(tile).not.toBeNull();
      expect(tile.querySelector('mat-icon')?.textContent).toContain('restaurant');
      // Tiles never render a text label.
      expect(tile.textContent).not.toContain('Food');
    });

    it('applies the size modifier classes', () => {
      fixture.componentRef.setInput('appearance', 'tile');
      fixture.componentRef.setInput('color', '#3366CC');
      fixture.componentRef.setInput('size', 'sm');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.tile')!.classList).toContain('tile-sm');

      fixture.componentRef.setInput('size', 'lg');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.tile')!.classList).toContain('tile-lg');
    });

    it('falls back to the generic category icon when none is given', () => {
      component.appearance = 'tile';
      component.color = '#3366CC';
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.tile mat-icon')?.textContent)
        .toContain('category');
    });
  });
});
