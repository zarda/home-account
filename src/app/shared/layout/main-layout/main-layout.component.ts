import { Component, computed, effect, inject, signal } from '@angular/core';

import { RouterOutlet } from '@angular/router';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, BottomNavComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
})
export class MainLayoutComponent {
  private breakpointObserver = inject(BreakpointObserver);

  sidebarOpen = signal(false); // Start closed, will open on desktop

  constructor() {
    // Auto-close sidebar on tablet/mobile, auto-open on desktop
    effect(() => {
      if (this.isOverlayMode()) {
        this.sidebarOpen.set(false);
      } else {
        this.sidebarOpen.set(true);
      }
    });
  }

  private breakpoint$ = this.breakpointObserver.observe([
    Breakpoints.XSmall,
    Breakpoints.Small,
    Breakpoints.Medium,
    Breakpoints.Large,
    Breakpoints.XLarge,
  ]);

  private breakpointSignal = toSignal(
    this.breakpoint$.pipe(
      map((result) => ({
        isMobile: result.breakpoints[Breakpoints.XSmall],
        isTablet:
          result.breakpoints[Breakpoints.Small] || result.breakpoints[Breakpoints.Medium],
        isDesktop:
          result.breakpoints[Breakpoints.Large] || result.breakpoints[Breakpoints.XLarge],
      }))
    ),
    { initialValue: { isMobile: false, isTablet: false, isDesktop: true } }
  );

  isMobile = computed(() => this.breakpointSignal().isMobile);
  isTablet = computed(() => this.breakpointSignal().isTablet);
  isDesktop = computed(() => this.breakpointSignal().isDesktop);

  // Sidebar should be overlay mode on tablet and mobile
  isOverlayMode = computed(() => this.isMobile() || this.isTablet());

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onNavItemClicked(): void {
    // On tablet/mobile, close sidebar after navigation
    if (this.isOverlayMode()) {
      this.closeSidebar();
    }
  }
}
