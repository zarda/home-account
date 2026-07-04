import { Component, computed, effect, inject, signal } from '@angular/core';

import { RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { A11yModule } from '@angular/cdk/a11y';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';

/** localStorage key for the user's docked-sidebar collapse preference. */
const SIDEBAR_COLLAPSED_KEY = 'homeaccount.sidebar-collapsed';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, A11yModule, HeaderComponent, SidebarComponent, BottomNavComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class MainLayoutComponent {
  private breakpointObserver = inject(BreakpointObserver);

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
