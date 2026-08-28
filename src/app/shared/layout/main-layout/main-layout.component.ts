import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { A11yModule } from '@angular/cdk/a11y';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { KeyboardShortcutService } from '../../../core/services/keyboard-shortcut.service';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

/** localStorage key for the user's docked-sidebar collapse preference. */
const SIDEBAR_COLLAPSED_KEY = 'homeaccount.sidebar-collapsed';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, A11yModule, HeaderComponent, SidebarComponent, BottomNavComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:keydown.n)': 'onAddHotkey($event)',
    // Two lines because Angular matches the modifier by name, not by
    // platform: Ctrl+K is the Windows/Linux chord, Cmd+K the macOS one.
    '(document:keydown.control.k)': 'onPaletteHotkey($event)',
    '(document:keydown.meta.k)': 'onPaletteHotkey($event)',
  },
})
export class MainLayoutComponent {
  private breakpointObserver = inject(BreakpointObserver);
  private onboarding = inject(OnboardingService);
  private keyboardShortcuts = inject(KeyboardShortcutService);

  /**
   * Overlay-drawer open state (tablet/mobile only). Never auto-opens:
   * desktop uses the docked sidebar instead of a modal drawer.
   */
  sidebarOpen = signal(false);

  /** Docked-sidebar collapse preference (desktop only), persisted. */
  sidebarCollapsed = signal(this.readCollapsePreference());

  constructor() {
    // The overlay drawer only exists in overlay mode; close it when the
    // viewport grows into the docked-desktop range.
    effect(() => {
      if (!this.isOverlayMode()) {
        this.sidebarOpen.set(false);
      }
    });

    // The first-run welcome belongs to the authed shell: /login and /lock
    // live outside this layout, and authGuard has already waited out
    // AuthService.isLoading before routing here. An effect rather than a
    // one-shot, because a launch that started on a degraded profile becomes
    // eligible only when the real profile arrives, with the shell already
    // mounted. OnboardingService owns the once-per-account guard.
    effect(() => {
      if (this.onboarding.shouldShow()) {
        this.onboarding.show();
      }
    });
  }

  // The app's one breakpoint scale (core/layout/breakpoints.ts):
  // <600 mobile · 600–1023 tablet (overlay drawer) · ≥1024 docked sidebar.
  private breakpoint$ = this.breakpointObserver.observe([
    APP_BREAKPOINTS.mobile,
    APP_BREAKPOINTS.tablet,
    APP_BREAKPOINTS.desktop,
  ]);

  private breakpointSignal = toSignal(
    this.breakpoint$.pipe(
      map((result) => ({
        isMobile: result.breakpoints[APP_BREAKPOINTS.mobile],
        isTablet: result.breakpoints[APP_BREAKPOINTS.tablet],
        isDesktop: result.breakpoints[APP_BREAKPOINTS.desktop],
      }))
    ),
    { initialValue: { isMobile: false, isTablet: false, isDesktop: true } }
  );

  isMobile = computed(() => this.breakpointSignal().isMobile);
  isTablet = computed(() => this.breakpointSignal().isTablet);
  isDesktop = computed(() => this.breakpointSignal().isDesktop);

  // Sidebar should be overlay mode on tablet and mobile
  isOverlayMode = computed(() => this.isMobile() || this.isTablet());

  /** Docked (non-modal) sidebar: desktop width and not collapsed away. */
  showDockedSidebar = computed(() => this.isDesktop() && !this.sidebarCollapsed());

  /** Whether any sidebar surface is currently visible (drives the header icon). */
  sidebarVisible = computed(() => this.showDockedSidebar() || this.sidebarOpen());

  toggleSidebar(): void {
    if (this.isOverlayMode()) {
      this.sidebarOpen.update((open) => !open);
      return;
    }

    const collapsed = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(collapsed);
    this.persistCollapsePreference(collapsed);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onEscape(): void {
    if (this.isOverlayMode() && this.sidebarOpen()) {
      this.closeSidebar();
    }
  }

  // A host binding's `$event` is typed `Event` however specific the key
  // qualifier is, so these take `Event` and narrow. Declaring KeyboardEvent
  // here compiles under the test tsconfig and fails `ng build`, which is how
  // it got missed the first time.
  onAddHotkey(event: Event): void {
    this.keyboardShortcuts.handleAddHotkey(event as KeyboardEvent);
  }

  onPaletteHotkey(event: Event): void {
    this.keyboardShortcuts.handlePaletteHotkey(event as KeyboardEvent);
  }

  onNavItemClicked(): void {
    // On tablet/mobile, close sidebar after navigation
    if (this.isOverlayMode()) {
      this.closeSidebar();
    }
  }

  private readCollapsePreference(): boolean {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private persistCollapsePreference(collapsed: boolean): void {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Storage unavailable (private mode) — the preference is session-only.
    }
  }
}
