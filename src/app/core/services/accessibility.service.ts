import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  UserPreferences,
  DEFAULT_FONT_SCALE,
  effectiveFontScale,
  highContrastEnabled,
  reducedMotionRequested,
} from '../../models';

/**
 * Carries the three accessibility preferences (user.model.ts: fontScale,
 * highContrast, reducedMotion) from the signed-in account down to the
 * document root, the same way ThemeService carries the theme preference.
 */
@Injectable({ providedIn: 'root' })
export class AccessibilityService {
  private document = inject(DOCUMENT);

  // Stored account preferences
  private _fontScale = signal<number>(DEFAULT_FONT_SCALE);
  private _highContrast = signal<boolean>(false);
  private _reducedMotionPref = signal<boolean>(false);

  // System preference from the OS
  private _systemReducedMotion = signal<boolean>(false);

  // Media query for the system preference
  private mediaQuery: MediaQueryList | null = null;

  // Public readonly signals
  readonly fontScale = this._fontScale.asReadonly();
  readonly highContrast = this._highContrast.asReadonly();

  // Reduced motion is honored whether the account asked for it or the OS did.
  readonly reducedMotion = computed(() => this._reducedMotionPref() || this._systemReducedMotion());

  // Tab-switch (and similar) animation length; collapses to instant when
  // motion should be reduced.
  readonly tabAnimationDuration = computed(() => (this.reducedMotion() ? '0ms' : '200ms'));

  constructor() {
    // Initialize system preference detection
    this.initSystemPreferenceListener();

    // Apply the font-scale variable whenever it changes
    effect(() => {
      this.applyFontScale(this._fontScale());
    });

    // Apply the high-contrast class whenever it changes
    effect(() => {
      this.applyHighContrast(this._highContrast());
    });

    // Apply the reduced-motion class whenever the resolved value changes
    effect(() => {
      this.applyReducedMotion(this.reducedMotion());
    });
  }

  /**
   * Initialize the service from the signed-in account's preferences.
   * Called during app initialization and again on every preferences sync,
   * so an account switch that carries none of these keys must reset every
   * setting rather than leave the previous account's values in place —
   * each resolver already returns its default for absent/invalid input.
   */
  init(prefs: UserPreferences | null | undefined): void {
    this._fontScale.set(effectiveFontScale(prefs));
    this._highContrast.set(highContrastEnabled(prefs));
    this._reducedMotionPref.set(reducedMotionRequested(prefs));
  }

  /**
   * Update the stored font-scale preference and re-apply it immediately —
   * the settings UI calls this before persisting, the same way
   * ThemeService.setTheme() takes effect before the write to Firestore
   * returns.
   */
  setFontScale(scale: number): void {
    this._fontScale.set(scale);
  }

  /** Update the stored high-contrast preference and re-apply it immediately. */
  setHighContrast(enabled: boolean): void {
    this._highContrast.set(enabled);
  }

  /**
   * Update the account's stored reduced-motion preference. Leaves the system
   * preference signal untouched, so `reducedMotion()` stays the OR of both —
   * this setter only ever changes the account's own half of that.
   */
  setReducedMotion(enabled: boolean): void {
    this._reducedMotionPref.set(enabled);
  }

  /**
   * Initialize listener for system reduced-motion preference
   */
  private initSystemPreferenceListener(): void {
    if (typeof window === 'undefined') return;

    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Set initial value
    this._systemReducedMotion.set(this.mediaQuery.matches);

    // Listen for changes
    this.mediaQuery.addEventListener('change', (event) => {
      this._systemReducedMotion.set(event.matches);
    });
  }

  /**
   * Apply the --app-font-scale variable that styles.scss's html rule reads
   * (`font-size: calc(100% * var(--app-font-scale, 1))`). The default scale
   * removes the variable entirely rather than setting it to 1, so the CSS
   * fallback stays in control.
   */
  private applyFontScale(scale: number): void {
    const htmlElement = this.document.documentElement;

    if (scale === DEFAULT_FONT_SCALE) {
      htmlElement.style.removeProperty('--app-font-scale');
    } else {
      htmlElement.style.setProperty('--app-font-scale', String(scale));
    }
  }

  /**
   * Toggle the high-contrast class on the document root.
   */
  private applyHighContrast(enabled: boolean): void {
    const htmlElement = this.document.documentElement;

    if (enabled) {
      htmlElement.classList.add('high-contrast');
    } else {
      htmlElement.classList.remove('high-contrast');
    }
  }

  /**
   * Toggle the reduced-motion class on the document root.
   */
  private applyReducedMotion(enabled: boolean): void {
    const htmlElement = this.document.documentElement;

    if (enabled) {
      htmlElement.classList.add('reduced-motion');
    } else {
      htmlElement.classList.remove('reduced-motion');
    }
  }
}
