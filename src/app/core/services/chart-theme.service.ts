import { Injectable, computed, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ThemeService } from './theme.service';

export interface ChartPalette {
  /** Legend and dataset-label text — --text-secondary. */
  text: string;
  /** Axis tick labels — --text-muted. */
  textMuted: string;
  /** Grid lines — --border-primary. */
  grid: string;
  /** App font stack (PT Sans). */
  fontFamily: string;
}

/**
 * One source of chart colors for every Chart.js instance. Reads the app's
 * design tokens from the document and re-reads them when ThemeService flips
 * the effective theme, so charts stay legible in dark mode instead of
 * keeping light-theme grays.
 *
 * Components consume this inside their own computed() chart options —
 * reading palette()/axis()/legendLabels() establishes the reactive
 * dependency, and ng2-charts applies the new options object on change.
 */
@Injectable({ providedIn: 'root' })
export class ChartThemeService {
  private themeService = inject(ThemeService);
  private document = inject(DOCUMENT);

  /** Design-token snapshot; recomputed on every effective-theme flip. */
  readonly palette = computed<ChartPalette>(() => {
    // Signal dependency: ThemeService stamps the theme class on <html>
    // before consumers re-render, so the token re-read below sees the
    // flipped values.
    this.themeService.effectiveTheme();
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
   * disable them here when the user asks for reduced motion.
   */
  animation(): false | { duration: number } {
    return this.prefersReducedMotion() ? false : { duration: 400 };
  }

  private prefersReducedMotion(): boolean {
    return this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private readTokens(): ChartPalette {
    const styles = this.document.defaultView?.getComputedStyle(this.document.documentElement);
    const read = (token: string, fallback: string): string => {
      const value = styles?.getPropertyValue(token).trim();
      return value || fallback;
    };

    return {
      text: read('--text-secondary', '#374151'),
      textMuted: read('--text-muted', '#6b7280'),
      grid: read('--border-primary', '#e5e7eb'),
      fontFamily: "'PT Sans', system-ui, sans-serif",
    };
  }
}
