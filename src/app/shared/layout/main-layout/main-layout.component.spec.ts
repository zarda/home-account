import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { BreakpointObserver, BreakpointState, Breakpoints } from '@angular/cdk/layout';
import { MainLayoutComponent } from './main-layout.component';

function state(active: string[]): BreakpointState {
  const breakpoints: Record<string, boolean> = {};
  for (const bp of [
    Breakpoints.XSmall,
    Breakpoints.Small,
    Breakpoints.Medium,
    Breakpoints.Large,
    Breakpoints.XLarge,
  ]) {
    breakpoints[bp] = active.includes(bp);
  }
  return { matches: active.length > 0, breakpoints };
}

describe('MainLayoutComponent', () => {
  let component: MainLayoutComponent;
  let fixture: ComponentFixture<MainLayoutComponent>;
  let breakpoint$: BehaviorSubject<BreakpointState>;

  beforeEach(async () => {
    localStorage.removeItem('homeaccount.sidebar-collapsed');
    breakpoint$ = new BehaviorSubject<BreakpointState>(state([Breakpoints.Large]));
    const observer = { observe: () => breakpoint$.asObservable() };

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [{ provide: BreakpointObserver, useValue: observer }],
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
    breakpoint$.next(state([Breakpoints.XSmall]));
    fixture.detectChanges();
    expect(component.isMobile()).toBeTrue();
    expect(component.isOverlayMode()).toBeTrue();
    expect(component.sidebarOpen()).toBeFalse();
    expect(component.showDockedSidebar()).toBeFalse();
  });

  it('treats tablet breakpoints as overlay mode', () => {
    breakpoint$.next(state([Breakpoints.Medium]));
    fixture.detectChanges();
    expect(component.isTablet()).toBeTrue();
    expect(component.isOverlayMode()).toBeTrue();
  });

  it('closes an open overlay drawer when growing into desktop', () => {
    breakpoint$.next(state([Breakpoints.XSmall]));
    fixture.detectChanges();
    component.toggleSidebar();
    expect(component.sidebarOpen()).toBeTrue();

    breakpoint$.next(state([Breakpoints.Large]));
    fixture.detectChanges();
    expect(component.sidebarOpen()).toBeFalse();
    expect(component.showDockedSidebar()).toBeTrue();
  });

  describe('toggleSidebar', () => {
    it('toggles the overlay drawer in overlay mode', () => {
      breakpoint$.next(state([Breakpoints.XSmall]));
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
    breakpoint$.next(state([Breakpoints.XSmall]));
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
    breakpoint$.next(state([Breakpoints.XSmall]));
    fixture.detectChanges();
    component.toggleSidebar();
    component.onEscape();
    expect(component.sidebarOpen()).toBeFalse();
  });

  it('onNavItemClicked closes the drawer only in overlay mode', () => {
    // Desktop: docked sidebar unaffected.
    component.onNavItemClicked();
    expect(component.showDockedSidebar()).toBeTrue();

    // Mobile: closes the drawer.
    breakpoint$.next(state([Breakpoints.XSmall]));
    fixture.detectChanges();
    component.toggleSidebar();
    component.onNavItemClicked();
    expect(component.sidebarOpen()).toBeFalse();
  });
});
