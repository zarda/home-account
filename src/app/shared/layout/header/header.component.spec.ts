import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject } from 'rxjs';
import { HeaderComponent } from './header.component';
import { AuthService } from '../../../core/services/auth.service';
import { AiSearchDialogComponent } from '../../components/ai-search-dialog/ai-search-dialog.component';
import { User } from '../../../models';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing';

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

/**
 * Every case above compiles the header with `{ imports: [], template: '' }`,
 * so the bar itself has never rendered: the menu button's icon flip, the
 * search button, the avatar's fallback when the photo 404s, and the user menu
 * behind it. The avatar fallback in particular is only reachable through a
 * real `<img>` firing a real `error` event.
 *
 * Full render: the header's own children are all Material or directives, so
 * nothing needs excusing. `provideRouter([])` stands in for `routerLink` on
 * the settings item.
 */
describe('HeaderComponent, through its own template', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let component: HeaderComponent;
  let auth: { currentUser: ReturnType<typeof signal<User | null>>; signOut: jasmine.Spy };
  let dialog: jasmine.SpyObj<MatDialog>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;

  /** The user menu renders into the CDK overlay, outside the fixture. */
  function openUserMenu(): HTMLElement {
    (el().querySelector('.user-menu-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    return document.querySelector('.mat-mdc-menu-panel') as HTMLElement;
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  beforeEach(async () => {
    auth = {
      currentUser: signal<User | null>({
        id: 'u1', displayName: 'Tester', email: 'tester@example.com',
      } as User),
      signOut: jasmine.createSpy('signOut').and.resolveTo(undefined),
    };
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [HeaderComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: MatDialog, useValue: dialog },
        {
          provide: BreakpointObserver,
          useValue: { observe: () => new BehaviorSubject<BreakpointState>({ matches: false, breakpoints: {} }).asObservable() },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
  });

  it('names the app and labels its two always-present controls', () => {
    fixture.detectChanges();

    expect(text('.app-title')).toBe('app.title');
    expect(el().querySelector('.menu-button')?.getAttribute('aria-label')).toBe('common.toggleSidebar');
    expect(el().querySelector('[aria-label="aiSearch.title"]')).not.toBeNull();
  });

  it('flips the menu icon to match the sidebar it controls', () => {
    fixture.componentRef.setInput('isSidebarOpen', false);
    fixture.detectChanges();
    expect(text('.menu-button mat-icon')).toBe('menu');

    fixture.componentRef.setInput('isSidebarOpen', true);
    fixture.detectChanges();
    expect(text('.menu-button mat-icon')).toBe('menu_open');
  });

  it('emits the sidebar toggle from its own button', () => {
    let toggled = 0;
    component.toggleSidebar.subscribe(() => (toggled += 1));
    fixture.detectChanges();

    (el().querySelector('.menu-button') as HTMLButtonElement).click();

    expect(toggled).toBe(1);
  });

  it('opens the search dialog from its own button', () => {
    fixture.detectChanges();

    (el().querySelector('[aria-label="aiSearch.title"]') as HTMLButtonElement).click();

    expect(dialog.open).toHaveBeenCalledWith(AiSearchDialogComponent, jasmine.anything());
  });

  it('falls back to a generic icon when the avatar photo fails to load', () => {
    // The fallback is only reachable through a real <img> error event; the
    // stubbed template could never have exercised it.
    auth.currentUser.set({
      id: 'u1', displayName: 'Tester', email: 'tester@example.com',
      photoURL: 'https://example.invalid/missing.png',
    } as User);
    fixture.detectChanges();

    const avatar = el().querySelector('img.user-avatar') as HTMLImageElement;
    expect(avatar).not.toBeNull();
    expect(avatar.alt).toBe('Tester');

    avatar.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el().querySelector('img.user-avatar')).toBeNull();
    expect(text('.user-menu-button mat-icon')).toBe('account_circle');
  });

  it('shows the generic icon when the account carries no photo at all', () => {
    fixture.detectChanges();

    expect(el().querySelector('img.user-avatar')).toBeNull();
    expect(text('.user-menu-button mat-icon')).toBe('account_circle');
  });

  it('drops the whole user menu when nobody is signed in', () => {
    auth.currentUser.set(null);
    fixture.detectChanges();

    expect(el().querySelector('.user-menu-button')).toBeNull();
    // The search and the sidebar toggle stay: they are not account-scoped.
    expect(el().querySelector('.menu-button')).not.toBeNull();
  });

  it('carries the account into the menu, with settings and sign-out', () => {
    fixture.detectChanges();

    const panel = openUserMenu();
    expect(panel.querySelector('.user-name')?.textContent?.trim()).toBe('Tester');
    expect(panel.querySelector('.user-email')?.textContent?.trim()).toBe('tester@example.com');

    const items = Array.from(panel.querySelectorAll('button[mat-menu-item]')) as HTMLButtonElement[];
    expect(items.map(b => b.textContent?.trim())).toEqual([
      'settingscommon.settings',
      'logoutauth.signOut',
    ]);
    expect(items[0].getAttribute('routerlink')).toBe('/settings');
  });

  it('signs out from the menu item a user actually clicks', () => {
    fixture.detectChanges();

    const panel = openUserMenu();
    (Array.from(panel.querySelectorAll('button[mat-menu-item]')) as HTMLButtonElement[])[1].click();

    expect(auth.signOut).toHaveBeenCalled();
  });
});
