import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject } from 'rxjs';
import { HeaderComponent } from './header.component';
import { AuthService } from '../../../core/services/auth.service';
import { AiSearchDialogComponent } from '../../components/ai-search-dialog/ai-search-dialog.component';
import { User } from '../../../models';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let routerEvents: Subject<unknown>;
  let mockRouter: { events: Subject<unknown>; navigate: jasmine.Spy };
  let mockAuth: { currentUser: ReturnType<typeof signal<User | null>>; signOut: jasmine.Spy };
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let viewport$: BehaviorSubject<BreakpointState>;

  const mobileViewport = (matches: boolean): BreakpointState => ({ matches, breakpoints: {} });

  function addScrollContainer(): { el: HTMLElement; setScrollTop: (v: number) => void } {
    const el = document.createElement('div');
    el.className = 'main-container';
    let value = 0;
    Object.defineProperty(el, 'scrollTop', {
      get: () => value,
      set: (v: number) => (value = v),
      configurable: true,
    });
    document.body.appendChild(el);
    return { el, setScrollTop: (v) => (value = v) };
  }

  beforeEach(async () => {
    routerEvents = new Subject<unknown>();
    mockRouter = { events: routerEvents, navigate: jasmine.createSpy('navigate') };
    mockAuth = {
      currentUser: signal<User | null>({ id: 'u1', displayName: 'Tester' } as User),
      signOut: jasmine.createSpy('signOut').and.resolveTo(undefined),
    };
    // Auto-hide only applies on mobile; tests opt in per case.
    viewport$ = new BehaviorSubject<BreakpointState>(mobileViewport(true));
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: AuthService, useValue: mockAuth },
        { provide: MatDialog, useValue: mockDialog },
        { provide: BreakpointObserver, useValue: { observe: () => viewport$.asObservable() } },
      ],
    })
      .overrideComponent(HeaderComponent, { set: { imports: [], template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    document.querySelectorAll('.main-container').forEach((el) => el.remove());
  });

  it('should create and expose the current user', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.currentUser()?.displayName).toBe('Tester');
  });

  it('opens the smart-search dialog', () => {
    component.openSearchDialog();
    expect(mockDialog.open).toHaveBeenCalledWith(AiSearchDialogComponent, {
      width: '520px',
      maxWidth: '95vw',
    });
  });

  it('isHidden reflects the inverse of visibility', () => {
    component.isVisible.set(true);
    expect(component.isHidden).toBeFalse();
    component.isVisible.set(false);
    expect(component.isHidden).toBeTrue();
  });

  it('resets visibility on navigation end', () => {
    const { el } = addScrollContainer();
    fixture.detectChanges(); // ngOnInit
    component.ngAfterViewInit();
    el.scrollTop = 200;
    component.isVisible.set(false);

    routerEvents.next(new NavigationEnd(1, '/dashboard', '/dashboard'));

    expect(component.isVisible()).toBeTrue();
    expect(el.scrollTop).toBe(0);
  });

  it('hides on scroll down and shows on scroll up (mobile)', () => {
    const { setScrollTop } = addScrollContainer();
    fixture.detectChanges();
    component.ngAfterViewInit();

    setScrollTop(100);
    component.evaluateScrollFrame();
    expect(component.isVisible()).toBeFalse();

    setScrollTop(50);
    component.evaluateScrollFrame();
    expect(component.isVisible()).toBeTrue();

    setScrollTop(5);
    component.evaluateScrollFrame();
    expect(component.isVisible()).toBeTrue();
  });

  it('never hides on tablet/desktop viewports', () => {
    viewport$.next(mobileViewport(false));
    const { setScrollTop } = addScrollContainer();
    fixture.detectChanges();
    component.ngAfterViewInit();

    setScrollTop(500);
    component.evaluateScrollFrame();
    expect(component.isVisible()).toBeTrue();
  });

  it('coalesces bursts of scroll events into one animation frame', () => {
    const { el, setScrollTop } = addScrollContainer();
    const rafSpy = spyOn(window, 'requestAnimationFrame').and.returnValue(1);
    fixture.detectChanges();
    component.ngAfterViewInit();

    setScrollTop(100);
    el.dispatchEvent(new Event('scroll'));
    el.dispatchEvent(new Event('scroll'));
    el.dispatchEvent(new Event('scroll'));

    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it('ngAfterViewInit is a no-op when there is no scroll container', () => {
    fixture.detectChanges();
    expect(() => component.ngAfterViewInit()).not.toThrow();
  });

  it('logout signs out and routes to login', async () => {
    fixture.detectChanges();
    await component.logout();
    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('cleans up subscriptions and listeners on destroy', () => {
    const { el } = addScrollContainer();
    fixture.detectChanges();
    component.ngAfterViewInit();
    const removeSpy = spyOn(el, 'removeEventListener').and.callThrough();

    fixture.destroy();

    expect(removeSpy).toHaveBeenCalledWith('scroll', jasmine.any(Function));
  });
});
