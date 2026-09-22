import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, WritableSignal, signal } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { BehaviorSubject } from 'rxjs';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { KeyboardShortcutService } from '../../../core/services/keyboard-shortcut.service';
import { MainLayoutComponent } from './main-layout.component';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { createTranslationStub } from '../../../core/services/testing';

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
    keyboardShortcuts = jasmine.createSpyObj('KeyboardShortcutService', [
      'handleAddHotkey',
      'handlePaletteHotkey',
    ]);

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

  describe('status-bar band (#426 part 1)', () => {
    // The header hides on scroll and takes its own painted band with it
    // (transform: translateY(-100%)); this host paints a second, fixed band
    // that never moves, so the shell keeps covering the notch/clock while
    // the header is off-screen.
    it('paints a fixed band sized to --safe-top, one z-index under the header', () => {
      const hostEl = fixture.nativeElement as HTMLElement;
      hostEl.style.setProperty('--safe-top', '44px');
      fixture.detectChanges();

      expect(hostEl.isConnected).toBeTrue();
      const before = getComputedStyle(hostEl, '::before');
      const expectedZIndex = String(
        Number(getComputedStyle(document.documentElement).getPropertyValue('--z-header').trim()) -
          1,
      );

      expect(before.position).toBe('fixed');
      expect(before.height).toBe('44px');
      expect(before.pointerEvents).toBe('none');
      expect(before.top).toBe('0px');
      expect(before.zIndex).toBe(expectedZIndex);
    });

    it('collapses to zero height when --safe-top is unset (web)', () => {
      const hostEl = fixture.nativeElement as HTMLElement;
      hostEl.style.removeProperty('--safe-top');
      fixture.detectChanges();

      const before = getComputedStyle(hostEl, '::before');
      expect(before.height).toBe('0px');
    });
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

  describe('command palette hotkey (#80)', () => {
    // Two host lines, one per platform convention, both dispatched for real:
    // a binding that never matched would leave the palette unreachable on
    // whichever platform it belonged to.
    it('reaches the service on ctrl+k', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handlePaletteHotkey).toHaveBeenCalledTimes(1);
    });

    it('reaches the service on meta+k', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handlePaletteHotkey).toHaveBeenCalledTimes(1);
    });

    it('ignores a bare "k" being typed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handlePaletteHotkey).not.toHaveBeenCalled();
    });

    it('does not reach the add hotkey', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      fixture.detectChanges();

      expect(keyboardShortcuts.handleAddHotkey).not.toHaveBeenCalled();
    });
  });
});

/**
 * Every case above overrides the template with the harsher
 * `{ imports: [], template: '<div></div>' }` form, and the two DOM reads it
 * does make reach only the host's `::before` band. So the shell's actual job
 * — which of the docked sidebar, the modal drawer and the bottom nav exists
 * at each breakpoint — has never been rendered. `sidebarOpen()` and
 * `showDockedSidebar()` being right is not the same statement as the drawer
 * being in the document, and the drawer's `role`/`aria-modal`/focus-trap are
 * template-only.
 *
 * Partial render: the component's own `imports` are narrowed so
 * `app-header`, `app-sidebar`, `app-bottom-nav` and `router-outlet` are left
 * unresolved. None of them is asserted about here — the assertions are all
 * about this component's own wrappers, classes and ARIA.
 */
describe('MainLayoutComponent, through its own template', () => {
  let fixture: ComponentFixture<MainLayoutComponent>;
  let component: MainLayoutComponent;
  let breakpoint$: BehaviorSubject<BreakpointState>;

  const el = () => fixture.nativeElement as HTMLElement;
  const at = (active: string[]) => {
    breakpoint$.next(state(active));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    localStorage.removeItem('homeaccount.sidebar-collapsed');
    breakpoint$ = new BehaviorSubject<BreakpointState>(state([DESKTOP]));

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        { provide: BreakpointObserver, useValue: { observe: () => breakpoint$.asObservable() } },
        {
          provide: OnboardingService,
          useValue: { shouldShow: signal(false), show: jasmine.createSpy('show') },
        },
        {
          provide: KeyboardShortcutService,
          useValue: jasmine.createSpyObj('KeyboardShortcutService', [
            'handleAddHotkey', 'handlePaletteHotkey',
          ]),
        },
        { provide: TranslationService, useValue: createTranslationStub() },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(MainLayoutComponent, {
        set: {
          imports: [A11yModule, TranslatePipe],
          // A standalone component's template is governed by its own schemas,
          // not the TestBed's, so the four child elements need excusing here.
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => localStorage.removeItem('homeaccount.sidebar-collapsed'));

  it('docks the sidebar on desktop and opens no modal drawer', () => {
    fixture.detectChanges();

    expect(el().querySelector('.sidebar-docked')).not.toBeNull();
    expect(el().querySelector('.sidebar-drawer')).toBeNull();
    expect(el().querySelector('.sidebar-backdrop')).toBeNull();
    expect(el().querySelector('.main-container')?.classList).toContain('with-docked-sidebar');
  });

  it('shows no sidebar at all on mobile until one is asked for', () => {
    fixture.detectChanges();
    at([MOBILE]);

    expect(el().querySelector('.sidebar-docked')).toBeNull();
    expect(el().querySelector('.sidebar-drawer')).toBeNull();
    expect(el().querySelector('.main-container')?.classList).not.toContain('with-docked-sidebar');
  });

  it('puts the modal drawer and its backdrop in the document once opened on mobile', () => {
    fixture.detectChanges();
    at([MOBILE]);

    component.toggleSidebar();
    fixture.detectChanges();

    const drawer = el().querySelector('.sidebar-drawer') as HTMLElement;
    expect(drawer).not.toBeNull();
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.getAttribute('aria-label')).toBe('common.navigation');
    // The drawer is modal, so focus must not be able to walk out behind it.
    expect(drawer.hasAttribute('cdktrapfocus')).toBeTrue();
  });

  it('closes the drawer from its backdrop, by click and by key', () => {
    fixture.detectChanges();
    at([MOBILE]);
    component.toggleSidebar();
    fixture.detectChanges();

    const backdrop = el().querySelector('.sidebar-backdrop') as HTMLElement;
    expect(backdrop.getAttribute('role')).toBe('button');
    expect(backdrop.getAttribute('tabindex')).toBe('0');
    expect(backdrop.getAttribute('aria-label')).toBe('common.closeSidebar');

    backdrop.click();
    fixture.detectChanges();
    expect(el().querySelector('.sidebar-drawer')).toBeNull();

    component.toggleSidebar();
    fixture.detectChanges();
    (el().querySelector('.sidebar-backdrop') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(el().querySelector('.sidebar-drawer')).toBeNull();
  });

  it('makes room for the bottom nav on mobile and not on desktop', () => {
    fixture.detectChanges();
    expect(el().querySelector('.main-container')?.classList).not.toContain('with-bottom-nav');
    expect(el().querySelector('.bottom-nav-container')?.classList).not.toContain('visible');

    at([MOBILE]);
    expect(el().querySelector('.main-container')?.classList).toContain('with-bottom-nav');
    expect(el().querySelector('.bottom-nav-container')?.classList).toContain('visible');
  });

  it('takes the docked sidebar out of the layout when it is collapsed', () => {
    fixture.detectChanges();
    component.toggleSidebar();
    fixture.detectChanges();

    expect(el().querySelector('.sidebar-docked')).toBeNull();
    expect(el().querySelector('.main-container')?.classList).not.toContain('with-docked-sidebar');
    // Collapsing is not opening a drawer: desktop never gets a modal.
    expect(el().querySelector('.sidebar-drawer')).toBeNull();
  });

  it('removes an open drawer from the document when growing into desktop', () => {
    fixture.detectChanges();
    at([MOBILE]);
    component.toggleSidebar();
    fixture.detectChanges();
    expect(el().querySelector('.sidebar-drawer')).not.toBeNull();

    at([DESKTOP]);

    expect(el().querySelector('.sidebar-drawer')).toBeNull();
    expect(el().querySelector('.sidebar-docked')).not.toBeNull();
  });
});
