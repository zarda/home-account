import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { KeyboardShortcutService } from '../../../core/services/keyboard-shortcut.service';
import { MainLayoutComponent } from './main-layout.component';

const MOBILE = APP_BREAKPOINTS.mobile;
const TABLET = APP_BREAKPOINTS.tablet;
const DESKTOP = APP_BREAKPOINTS.desktop;

function state(active: string[]): BreakpointState {
  const breakpoints: Record<string, boolean> = {};
  for (const bp of [MOBILE, TABLET, DESKTOP]) {
    breakpoints[bp] = active.includes(bp);
  }
  return { matches: active.length > 0, breakpoints };
}

describe('MainLayoutComponent', () => {
  let component: MainLayoutComponent;
  let fixture: ComponentFixture<MainLayoutComponent>;
  let breakpoint$: BehaviorSubject<BreakpointState>;
  let shouldShowOnboarding: WritableSignal<boolean>;
  let onboarding: { shouldShow: WritableSignal<boolean>; show: jasmine.Spy };
  let keyboardShortcuts: jasmine.SpyObj<KeyboardShortcutService>;

  beforeEach(async () => {
    localStorage.removeItem('homeaccount.sidebar-collapsed');
    breakpoint$ = new BehaviorSubject<BreakpointState>(state([DESKTOP]));
    const observer = { observe: () => breakpoint$.asObservable() };
    shouldShowOnboarding = signal(false);
    onboarding = { shouldShow: shouldShowOnboarding, show: jasmine.createSpy('show') };
    keyboardShortcuts = jasmine.createSpyObj('KeyboardShortcutService', ['handleAddHotkey']);

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        { provide: BreakpointObserver, useValue: observer },
        { provide: OnboardingService, useValue: onboarding },
        { provide: KeyboardShortcutService, useValue: keyboardShortcuts },
      ],
    })
      // Isolate from the real header/sidebar/bottom-nav child components.
      .overrideComponent(MainLayoutComponent, { set: { imports: [], template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('homeaccount.sidebar-collapsed');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('docks the sidebar on desktop without opening a modal drawer', () => {
    expect(component.isDesktop()).toBeTrue();
    expect(component.isOverlayMode()).toBeFalse();
    // The single highest-impact layout fix: no auto-opened overlay on load.
    expect(component.sidebarOpen()).toBeFalse();
    expect(component.showDockedSidebar()).toBeTrue();
    expect(component.sidebarVisible()).toBeTrue();
  });

  it('keeps the overlay drawer closed when switching to mobile', () => {
    breakpoint$.next(state([MOBILE]));
    fixture.detectChanges();
    expect(component.isMobile()).toBeTrue();
    expect(component.isOverlayMode()).toBeTrue();
    expect(component.sidebarOpen()).toBeFalse();
    expect(component.showDockedSidebar()).toBeFalse();
  });

  it('treats tablet breakpoints as overlay mode', () => {
    breakpoint$.next(state([TABLET]));
    fixture.detectChanges();
    expect(component.isTablet()).toBeTrue();
    expect(component.isOverlayMode()).toBeTrue();
  });

  it('closes an open overlay drawer when growing into desktop', () => {
    breakpoint$.next(state([MOBILE]));
    fixture.detectChanges();
    component.toggleSidebar();
    expect(component.sidebarOpen()).toBeTrue();

    breakpoint$.next(state([DESKTOP]));
    fixture.detectChanges();
    expect(component.sidebarOpen()).toBeFalse();
    expect(component.showDockedSidebar()).toBeTrue();
  });

  describe('toggleSidebar', () => {
    it('toggles the overlay drawer in overlay mode', () => {
      breakpoint$.next(state([MOBILE]));
      fixture.detectChanges();

      component.toggleSidebar();
      expect(component.sidebarOpen()).toBeTrue();
      component.toggleSidebar();
      expect(component.sidebarOpen()).toBeFalse();
    });

    it('collapses/expands the docked sidebar on desktop and persists the choice', () => {
      component.toggleSidebar();
      expect(component.sidebarCollapsed()).toBeTrue();
      expect(component.showDockedSidebar()).toBeFalse();
      expect(localStorage.getItem('homeaccount.sidebar-collapsed')).toBe('true');

      component.toggleSidebar();
      expect(component.showDockedSidebar()).toBeTrue();
      expect(localStorage.getItem('homeaccount.sidebar-collapsed')).toBe('false');
    });
  });

  it('restores the persisted collapse preference on creation', () => {
    localStorage.setItem('homeaccount.sidebar-collapsed', 'true');
    const collapsedFixture = TestBed.createComponent(MainLayoutComponent);
    collapsedFixture.detectChanges();

    expect(collapsedFixture.componentInstance.sidebarCollapsed()).toBeTrue();
    expect(collapsedFixture.componentInstance.showDockedSidebar()).toBeFalse();
  });

  it('closeSidebar always closes the overlay drawer', () => {
    breakpoint$.next(state([MOBILE]));
    fixture.detectChanges();
    component.toggleSidebar();
    component.closeSidebar();
    expect(component.sidebarOpen()).toBeFalse();
  });

  it('onEscape closes the overlay drawer but leaves the docked sidebar alone', () => {
    // Desktop: escape is a no-op for the docked sidebar.
    component.onEscape();
    expect(component.showDockedSidebar()).toBeTrue();

    // Mobile with open drawer: escape closes it.
    breakpoint$.next(state([MOBILE]));
    fixture.detectChanges();
    component.toggleSidebar();
    component.onEscape();
    expect(component.sidebarOpen()).toBeFalse();
  });

  describe('first-run onboarding', () => {
    it('leaves the welcome closed when the service says not to show it', () => {
      expect(onboarding.show).not.toHaveBeenCalled();
    });

    // An effect rather than a one-shot: the authed shell is already mounted
    // when a degraded profile recovers and the account becomes eligible.
    it('shows the welcome as soon as the service says to', () => {
      shouldShowOnboarding.set(true);
      fixture.detectChanges();

      expect(onboarding.show).toHaveBeenCalledTimes(1);
    });
  });

  it('onNavItemClicked closes the drawer only in overlay mode', () => {
    // Desktop: docked sidebar unaffected.
    component.onNavItemClicked();
    expect(component.showDockedSidebar()).toBeTrue();

    // Mobile: closes the drawer.
    breakpoint$.next(state([MOBILE]));
    fixture.detectChanges();
    component.toggleSidebar();
    component.onNavItemClicked();
    expect(component.sidebarOpen()).toBeFalse();
  });

  describe('add-transaction hotkey (#80)', () => {
    // The host map binds `(document:keydown.n)`, not @HostListener — this
    // dispatches a real event on document to prove the binding is wired,
    // not just that the delegating method works in isolation.
    it('reaches the keyboard shortcut service on a bare "n" keydown', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handleAddHotkey).toHaveBeenCalledTimes(1);
    });

    // Angular's KeyEventsPlugin folds every active modifier into the
    // matched key string for a `keydown.n` binding (e.g. "shift.n"), so a
    // modified keydown never matches a bare `.n` binding. Pinned here with
    // real dispatched events rather than assumed from the framework source.
    it('does not fire on shift+n (a capital "N" being typed anywhere)', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', shiftKey: true }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handleAddHotkey).not.toHaveBeenCalled();
    });

    it('does not fire on ctrl+n', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handleAddHotkey).not.toHaveBeenCalled();
    });

    it('does not fire on meta+n', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handleAddHotkey).not.toHaveBeenCalled();
    });
  });
});
