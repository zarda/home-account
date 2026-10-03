import { Injectable, computed, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { color } from 'chart.js/helpers';
import { ThemeService } from './theme.service';
import { AccessibilityService } from './accessibility.service';

export interface ChartPalette {
  /** Legend and dataset-label text — --text-secondary. */
  text: string;
  /** Axis tick labels — --text-muted. */
  textMuted: string;
  /** Grid lines — --border-primary. */
  grid: string;
  /** The income series' fill — --color-income. */
  income: string;
  /** The income series' line or bar edge — --color-income-text. */
  incomeEdge: string;
  /** The expense series' fill — --color-expense. */
  expense: string;
  /** The expense series' line or bar edge — --color-expense-text. */
  expenseEdge: string;
  /** A third series (the savings rate, the actual balance) — --color-accent. */
  accent: string;
  /**
   * Its line — --color-accent itself. The income fill falls under 3:1 on the
   * light card, so both series draw their edge in the -text step, which
   * clears 3:1 in both themes. The accent clears 3:1 as it is, and has no
   * -text token.
   */
  accentEdge: string;
  /** App font stack (PT Sans). */
  fontFamily: string;
}

type PaletteColour = Exclude<keyof ChartPalette, 'fontFamily'>;

/** The token each palette colour reads. */
const PALETTE_TOKENS = {
  text: '--text-secondary',
  textMuted: '--text-muted',
  grid: '--border-primary',
  income: '--color-income',
  incomeEdge: '--color-income-text',
  expense: '--color-expense',
  expenseEdge: '--color-expense-text',
  accent: '--color-accent',
  accentEdge: '--color-accent',
} as const satisfies Record<PaletteColour, string>;

type PaletteToken = (typeof PALETTE_TOKENS)[PaletteColour];

/**
 * Light's value of every token the palette reads, for a canvas drawn before
 * the stylesheet loads, when every token reads empty.
 */
// colors:allow-start(token-fallback) light's values, for a canvas drawn before the stylesheet loads
export const CHART_TOKEN_FALLBACKS: Readonly<Record<PaletteToken, string>> = {
  '--text-secondary': '#374151',
  '--text-muted': '#4b5563',
  '--border-primary': '#e5e7eb',
  '--color-income': '#22c55e',
  '--color-income-text': '#15803d',
  '--color-expense': '#ef4444',
  '--color-expense-text': '#b91c1c',
  '--color-accent': '#4f46e5',
};
// colors:allow-end

/**
 * A palette colour at `alpha`, as `rgba()`, for a dataset's fill. A canvas
 * takes one colour string with nothing under it to composite a token
 * against, so the alpha has to be spelled into the string. Read by Chart.js's
 * own colour parser; a value it cannot read comes back unchanged, opaque.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const parsed = color(hex);
  return parsed.valid ? parsed.alpha(alpha).rgbString() : hex;
}

/**
 * One source of chart colors for every Chart.js instance. A canvas paints
 * strings, not var()s, so this reads the app's design tokens from the
 * document and re-reads them whenever the effective theme or high contrast
 * changes the values they hold.
 *
 * Components consume this inside their own computed() chart options and
 * data — reading palette()/axis()/legendLabels() establishes the reactive
 * dependency, and ng2-charts applies the new objects on change.
 */
@Injectable({ providedIn: 'root' })
export class ChartThemeService {
  private themeService = inject(ThemeService);
  private document = inject(DOCUMENT);
  private accessibility = inject(AccessibilityService);

  /** Design-token snapshot; recomputed on every theme or high-contrast flip. */
  readonly palette = computed<ChartPalette>(() => {
    // Signal dependencies: ThemeService and AccessibilityService stamp their
    // classes on <html> from root effects, which run before any view
    // re-renders, so the token re-read below sees the flipped values.
    this.themeService.effectiveTheme();
    this.accessibility.highContrast();
    return this.readTokens();
  });

  /** Scale partial (ticks + grid) to spread into each Chart.js axis. */
  axis(): { ticks: { color: string; font: { family: string } }; grid: { color: string } } {
    const p = this.palette();
    return {
      ticks: { color: p.textMuted, font: { family: p.fontFamily } },
      grid: { color: p.grid },
    };
  }

  /** Legend-labels partial for plugins.legend.labels. */
  legendLabels(): { color: string; font: { family: string } } {
    const p = this.palette();
    return { color: p.text, font: { family: p.fontFamily } };
  }

  /**
   * Chart.js animation config. Canvas animations run off the main thread and
   * so are invisible to the global CSS prefers-reduced-motion kill-switch;
   * disable them here when the user asks for reduced motion. Routed through
   * AccessibilityService so a runtime toggle (not just the OS setting) is
   * honored, same as the account preference.
   */
  animation(): false | { duration: number } {
    return this.accessibility.reducedMotion() ? false : { duration: 400 };
  }

  private readTokens(): ChartPalette {
    const styles = this.document.defaultView?.getComputedStyle(this.document.documentElement);
    const read = (colour: PaletteColour): string => {
      const token = PALETTE_TOKENS[colour];
      return styles?.getPropertyValue(token).trim() || CHART_TOKEN_FALLBACKS[token];
    };

    return {
      text: read('text'),
      textMuted: read('textMuted'),
      grid: read('grid'),
      income: read('income'),
      incomeEdge: read('incomeEdge'),
      expense: read('expense'),
      expenseEdge: read('expenseEdge'),
      accent: read('accent'),
      accentEdge: read('accentEdge'),
      fontFamily: "'PT Sans', system-ui, sans-serif",
    };
  }
}
