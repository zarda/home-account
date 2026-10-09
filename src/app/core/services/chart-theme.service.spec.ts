import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CHART_TOKEN_FALLBACKS, ChartPalette, ChartThemeService, hexToRgba } from './chart-theme.service';
import { ThemeService } from './theme.service';
import { AccessibilityService } from './accessibility.service';
import { AUDIT_SCHEMES, channels, ratio, settleAnimations, withScheme } from './testing';

describe('ChartThemeService', () => {
  let service: ChartThemeService;
  let themeService: ThemeService;
  let reducedMotion: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    reducedMotion = signal(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: AccessibilityService, useValue: { reducedMotion, highContrast: signal(false) } },
      ],
    });
    service = TestBed.inject(ChartThemeService);
    themeService = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    // ThemeService keeps the real DOCUMENT here — readTokens() needs live
    // computed styles — so setTheme() below stamps dark-theme/light-theme
    // straight onto document.documentElement, which outlives this file's
    // own TestBed teardown and would otherwise leak into whichever spec
    // runs next.
    document.documentElement.classList.remove('dark-theme', 'light-theme');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('palette', () => {
    it('should provide non-empty colors and the PT Sans stack', () => {
      const palette = service.palette();

      expect(palette.text).not.toBe('');
      expect(palette.textMuted).not.toBe('');
      expect(palette.grid).not.toBe('');
      expect(palette.fontFamily).toContain('PT Sans');
    });

    it('should recompute when the effective theme flips', () => {
      themeService.setTheme('light');
      const before = service.palette();

      themeService.setTheme('dark');
      const after = service.palette();

      // New snapshot object per flip — ng2-charts sees an options change.
      expect(after).not.toBe(before);
    });

    it('should not recompute while the theme is unchanged', () => {
      themeService.setTheme('light');
      const first = service.palette();
      const second = service.palette();

      expect(second).toBe(first);
    });
  });

  describe('option partials', () => {
    it('axis() should color ticks and grid from the palette', () => {
      const palette = service.palette();
      const axis = service.axis();

      expect(axis.ticks.color).toBe(palette.textMuted);
      expect(axis.ticks.font.family).toBe(palette.fontFamily);
      expect(axis.grid.color).toBe(palette.grid);
    });

    it('legendLabels() should color legend text from the palette', () => {
      const palette = service.palette();
      const labels = service.legendLabels();

      expect(labels.color).toBe(palette.text);
      expect(labels.font.family).toBe(palette.fontFamily);
    });
  });

  describe('animation', () => {
    it('runs a 400ms animation when the accessibility signal is not reduced', () => {
      reducedMotion.set(false);

      expect(service.animation()).toEqual({ duration: 400 });
    });

    it('disables animation when the accessibility signal prefers reduced motion', () => {
      reducedMotion.set(true);

      expect(service.animation()).toBeFalse();
    });
  });
});

describe('hexToRgba', () => {
  it('spells out six-digit and three-digit hex at the alpha it is given', () => {
    expect(hexToRgba('#22c55e', 0.8)).toBe('rgba(34, 197, 94, 0.8)');
    expect(hexToRgba('#FCA5A5', 0.1)).toBe('rgba(252, 165, 165, 0.1)');
    expect(hexToRgba('#fff', 0.35)).toBe('rgba(255, 255, 255, 0.35)');
  });

  it('hands back a value it cannot read unchanged', () => {
    for (const value of ['', 'var(--color-income)', 'not a colour']) {
      expect(hexToRgba(value, 0.5)).withContext(JSON.stringify(value)).toBe(value);
    }
  });
});

/**
 * The palette on the real ThemeService and AccessibilityService. Both stamp
 * their classes on <html> from an effect, and the palette is a computed over
 * their signals, so a class swapped by hand moves neither and proves nothing.
 */
describe('ChartThemeService, on the real theme and accessibility services', () => {
  type PaletteColour = Exclude<keyof ChartPalette, 'fontFamily'>;

  /** The token each palette colour is read from. */
  const TOKENS: Readonly<Record<PaletteColour, string>> = {
    text: '--text-secondary',
    textMuted: '--text-muted',
    grid: '--border-primary',
    income: '--color-income',
    incomeEdge: '--color-income-text',
    expense: '--color-expense',
    expenseEdge: '--color-expense-text',
    accent: '--color-accent',
    accentEdge: '--color-accent',
  };
  const EDGES = ['incomeEdge', 'expenseEdge', 'accentEdge'] as const;

  let service: ChartThemeService;
  let themeService: ThemeService;
  let accessibility: AccessibilityService;

  /** What `<property>: <value>` computes to under the classes on <html> now. */
  function computed(value: string, property = 'color'): string {
    const probe = document.createElement('span');
    probe.style.setProperty(property, value);
    document.body.appendChild(probe);
    try {
      settleAnimations(document);
      return getComputedStyle(probe).getPropertyValue(property);
    } finally {
      probe.remove();
    }
  }

  const tokenValue = (token: string) => computed(`var(${token})`);

  /** The surface Material paints a mat-card on, which every report chart sits in. */
  const card = () => channels(tokenValue('--mat-sys-surface-container-low')).rgb;

  function setHighContrast(enabled: boolean): void {
    accessibility.setHighContrast(enabled);
    TestBed.tick();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChartThemeService);
    themeService = TestBed.inject(ThemeService);
    accessibility = TestBed.inject(AccessibilityService);
  });

  afterEach(() => {
    try {
      setHighContrast(false);
    } finally {
      document.documentElement.classList.remove('high-contrast', 'dark-theme', 'light-theme');
    }
  });

  it('reads every colour from its token, and re-reads them when ThemeService flips the theme', () => {
    const seen: Partial<Record<(typeof AUDIT_SCHEMES)[number], ChartPalette>> = {};
    for (const scheme of AUDIT_SCHEMES) {
      withScheme(themeService, scheme, () => {
        const palette = service.palette();
        for (const [colour, token] of Object.entries(TOKENS) as [PaletteColour, string][]) {
          expect(computed(palette[colour]))
            .withContext(`${scheme} ${colour} is ${token}`)
            .toBe(tokenValue(token));
        }
        seen[scheme] = palette;
      });
    }

    expect(seen.dark!.incomeEdge).not.toBe(seen.light!.incomeEdge);
    expect(seen.dark!.expense).not.toBe(seen.light!.expense);
    expect(seen.dark!.accent).not.toBe(seen.light!.accent);
  });

  it('re-reads the palette when high contrast is set and cleared through AccessibilityService, in both themes', () => {
    for (const scheme of AUDIT_SCHEMES) {
      withScheme(themeService, scheme, () => {
        const before = service.palette();

        setHighContrast(true);
        const raised = service.palette();
        expect(raised).withContext(`${scheme} high contrast is a new snapshot`).not.toBe(before);
        expect(raised.grid).withContext(`${scheme} high-contrast grid moved`).not.toBe(before.grid);
        expect(computed(raised.grid))
          .withContext(`${scheme} high-contrast grid`)
          .toBe(tokenValue('--border-primary'));
        expect(computed(raised.textMuted))
          .withContext(`${scheme} high-contrast ticks`)
          .toBe(tokenValue('--text-muted'));

        setHighContrast(false);
        expect(service.palette().grid).withContext(`${scheme} grid after high contrast`).toBe(before.grid);
      });
    }
  });

  it('gives every series an edge at 3:1 or better on the M3 card, in both themes, with and without high contrast', () => {
    for (const scheme of AUDIT_SCHEMES) {
      for (const highContrast of [false, true]) {
        withScheme(themeService, scheme, () => {
          setHighContrast(highContrast);
          const palette = service.palette();
          for (const edge of EDGES) {
            expect(ratio(channels(computed(palette[edge])).rgb, card()))
              .withContext(`${scheme}${highContrast ? ' high-contrast' : ''} ${edge} on the card`)
              .toBeGreaterThanOrEqual(3);
          }
          setHighContrast(false);
        });
      }
    }
  });

  it("falls back to light's own value for every token it reads", () => {
    expect(Object.keys(CHART_TOKEN_FALLBACKS).sort())
      .withContext('one fallback per token read')
      .toEqual([...new Set(Object.values(TOKENS))].sort());

    withScheme(themeService, 'light', () => {
      for (const [token, fallback] of Object.entries(CHART_TOKEN_FALLBACKS)) {
        expect(computed(fallback)).withContext(token).toBe(tokenValue(token));
      }
    });
  });
});
