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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('opens the sidebar on desktop via the effect', () => {
    expect(component.isDesktop()).toBeTrue();
    expect(component.isOverlayMode()).toBeFalse();
    expect(component.sidebarOpen()).toBeTrue();
  });

  it('closes the sidebar when switching to mobile (overlay mode)', () => {
    breakpoint$.next(state([Breakpoints.XSmall]));
    fixture.detectChanges();
    expect(component.isMobile()).toBeTrue();
    expect(component.isOverlayMode()).toBeTrue();
    expect(component.sidebarOpen()).toBeFalse();
  });

  it('treats tablet breakpoints as overlay mode', () => {
    breakpoint$.next(state([Breakpoints.Medium]));
    fixture.detectChanges();
    expect(component.isTablet()).toBeTrue();
    expect(component.isOverlayMode()).toBeTrue();
  });

  it('toggleSidebar flips the open state', () => {
    component.sidebarOpen.set(false);
    component.toggleSidebar();
    expect(component.sidebarOpen()).toBeTrue();
    component.toggleSidebar();
    expect(component.sidebarOpen()).toBeFalse();
  });

  it('closeSidebar always closes', () => {
    component.sidebarOpen.set(true);
    component.closeSidebar();
    expect(component.sidebarOpen()).toBeFalse();
  });

  it('onNavItemClicked closes the sidebar only in overlay mode', () => {
    // Desktop: stays open.
    component.sidebarOpen.set(true);
    component.onNavItemClicked();
    expect(component.sidebarOpen()).toBeTrue();

    // Mobile: closes.
    breakpoint$.next(state([Breakpoints.XSmall]));
    fixture.detectChanges();
    component.sidebarOpen.set(true);
    component.onNavItemClicked();
    expect(component.sidebarOpen()).toBeFalse();
  });
});
