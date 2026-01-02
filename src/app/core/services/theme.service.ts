import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type ThemePreference = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private document = inject(DOCUMENT);

  // Current theme preference (what user selected)
  private _theme = signal<ThemePreference>('system');

  // System preference from OS
  private _systemPreference = signal<EffectiveTheme>('light');

  // Media query for system preference
  private mediaQuery: MediaQueryList | null = null;

  // Public readonly signals
  readonly theme = this._theme.asReadonly();

  // Computed effective theme (resolves 'system' to actual theme)
  readonly effectiveTheme = computed<EffectiveTheme>(() => {
    const preference = this._theme();
    if (preference === 'system') {
      return this._systemPreference();
    }
    return preference;
  });

  // Whether dark mode is active
  readonly isDark = computed(() => this.effectiveTheme() === 'dark');

  constructor() {
    // Initialize system preference detection
    this.initSystemPreferenceListener();

    // Apply theme class whenever effective theme changes
    effect(() => {
      this.applyTheme(this.effectiveTheme());
    });
  }

  /**
   * Initialize the theme service
   * Called during app initialization to restore saved preference
   */
  init(savedTheme?: ThemePreference): void {
    if (savedTheme) {
      this._theme.set(savedTheme);
    }
  }

  /**
   * Set the theme preference
   */
  setTheme(theme: ThemePreference): void {
    this._theme.set(theme);
  }

  /**
   * Toggle between light and dark modes
   * If current is 'system', switches to the opposite of current effective theme
   */
  toggle(): void {
    const current = this.effectiveTheme();
    this._theme.set(current === 'light' ? 'dark' : 'light');
  }

  /**
   * Initialize listener for system color scheme preference
   */
  private initSystemPreferenceListener(): void {
    if (typeof window === 'undefined') return;

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Set initial value
    this._systemPreference.set(this.mediaQuery.matches ? 'dark' : 'light');

    // Listen for changes
    this.mediaQuery.addEventListener('change', (event) => {
      this._systemPreference.set(event.matches ? 'dark' : 'light');
    });
  }

  /**
   * Apply theme class to document element
   */
  private applyTheme(theme: EffectiveTheme): void {
    const htmlElement = this.document.documentElement;

    if (theme === 'dark') {
      htmlElement.classList.add('dark-theme');
      htmlElement.classList.remove('light-theme');
    } else {
      htmlElement.classList.add('light-theme');
      htmlElement.classList.remove('dark-theme');
    }
  }
}
