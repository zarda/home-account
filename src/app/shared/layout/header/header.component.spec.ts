import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject, map } from 'rxjs';
import { HeaderComponent } from './header.component';
import { AuthService } from '../../../core/services/auth.service';
import { AiSearchDialogComponent } from '../../components/ai-search-dialog/ai-search-dialog.component';
import { CommandPaletteComponent } from '../../components/command-palette/command-palette.component';
import { User } from '../../../models';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslationService } from '../../../core/services/translation.service';
import { KeyboardShortcutService } from '../../../core/services/keyboard-shortcut.service';
import { APP_BREAKPOINTS, AppBreakpointName } from '../../../core/layout/breakpoints';
import {
  AUDIT_SCHEMES,
  createTranslationStub,
  runAxe,
  summarizeViolations,
  withTheme,
} from '../../../core/services/testing';

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

/**
 * The palette button and the one-time '?' hint (#446), through the real
 * template.
 *
 * The BreakpointObserver double answers each query for one width at a time,
 * as CDK does, so the header's two observations (mobile for auto-hide,
 * desktop for the hint) never both match. The shortcut service is the real
 * one over a MatDialog double: what the button must reach is the service's
 * tracked palette, the one Ctrl/Cmd+K toggles closed, not a dialog of its
 * own.
 */
describe('HeaderComponent, the palette button and the ? hint (#446)', () => {
  const HINT_KEY = 'homeaccount.shortcuts-hint-dismissed';

  let fixture: ComponentFixture<HeaderComponent>;
  let width$: BehaviorSubject<AppBreakpointName>;
  let dialog: { openDialogs: unknown[]; open: jasmine.Spy };
  let paletteRef: { close: jasmine.Spy; afterClosed: () => Subject<undefined> };

  const el = () => fixture.nativeElement as HTMLElement;
  const hint = () => el().querySelector<HTMLElement>('.shortcuts-hint');
  const paletteButton = () => el().querySelector<HTMLButtonElement>('.palette-button');
  const dismissButton = () => el().querySelector<HTMLButtonElement>('.shortcuts-hint-dismiss');

  function observe(query: string | string[]) {
    const queries = Array.isArray(query) ? query : [query];
    return width$.pipe(
      map(width => {
        const breakpoints = Object.fromEntries(queries.map(q => [q, q === APP_BREAKPOINTS[width]]));
        return { matches: Object.values(breakpoints).some(Boolean), breakpoints };
      })
    );
  }

  function create(): void {
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  }

  /** Destroys the header and mounts a new one, as a reload would. */
  function recreate(): void {
    fixture.destroy();
    create();
  }

  function at(width: AppBreakpointName): void {
    width$.next(width);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.removeItem(HINT_KEY);
    width$ = new BehaviorSubject<AppBreakpointName>('desktop');
    const closed$ = new Subject<undefined>();
    paletteRef = { close: jasmine.createSpy('close'), afterClosed: () => closed$ };
    dialog = {
      openDialogs: [],
      open: jasmine.createSpy('open').and.callFake(() => {
        dialog.openDialogs = [paletteRef];
        return paletteRef;
      }),
    };

    await TestBed.configureTestingModule({
      imports: [HeaderComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal<User | null>({ id: 'u1', displayName: 'Tester' } as User),
            signOut: jasmine.createSpy('signOut'),
          },
        },
        { provide: MatDialog, useValue: dialog },
        { provide: BreakpointObserver, useValue: { observe } },
        { provide: TranslationService, useValue: createTranslationStub() },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem(HINT_KEY);
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  it('opens the plain palette through the shortcut service', () => {
    create();
    const shortcuts = TestBed.inject(KeyboardShortcutService);
    const open = spyOn(shortcuts, 'openPalette').and.callThrough();

    expect(paletteButton()?.getAttribute('aria-label')).toBe('palette.title');
    expect(paletteButton()?.getAttribute('aria-haspopup')).toBe('dialog');
    paletteButton()!.click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(dialog.open).toHaveBeenCalledOnceWith(CommandPaletteComponent, {
      width: '520px',
      maxWidth: '95vw',
    });
    // The service's own palette: Ctrl/Cmd+K closes it rather than opening a
    // second one.
    shortcuts.handlePaletteHotkey(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(paletteRef.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the button at every width: it is the only door a touch screen has', () => {
    create();
    for (const width of ['mobile', 'tablet', 'desktop'] as const) {
      at(width);
      expect(paletteButton()).withContext(width).not.toBeNull();
    }
  });

  it('shows the hint at desktop while its key is absent', () => {
    create();

    expect(hint()).not.toBeNull();
    expect(hint()!.textContent).toContain('shortcuts.hint');
    expect(dismissButton()?.getAttribute('aria-label')).toBe('shortcuts.hintDismiss');
  });

  it('hides the hint at tablet and phone widths without retiring it', () => {
    create();

    at('tablet');
    expect(hint()).withContext('tablet').toBeNull();
    at('mobile');
    expect(hint()).withContext('phone').toBeNull();
    at('desktop');
    expect(hint()).withContext('back at desktop').not.toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('retires the hint for good when it is dismissed', () => {
    create();

    dismissButton()!.click();
    fixture.detectChanges();

    expect(hint()).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBe('true');
    recreate();
    expect(hint()).withContext('after a re-create').toBeNull();
  });

  it('hands focus to the palette button when the hint is dismissed, so a keyboard keeps its place', () => {
    create();

    dismissButton()!.focus();
    dismissButton()!.click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(paletteButton());
  });

  it('retires the hint for good once the button opens the palette', () => {
    create();

    paletteButton()!.click();
    fixture.detectChanges();

    expect(hint()).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBe('true');
    recreate();
    expect(hint()).withContext('after a re-create').toBeNull();
  });

  it('retires the hint once ? opens the palette, too', () => {
    create();
    const question = new KeyboardEvent('keydown', { key: '?', shiftKey: true, cancelable: true });
    Object.defineProperty(question, 'target', { value: document.body });

    TestBed.inject(KeyboardShortcutService).handleHelpHotkey(question);
    fixture.detectChanges();

    expect(hint()).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).toBe('true');
  });

  it('shows no hint, and still renders, when storage throws on read', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError(new DOMException('denied', 'SecurityError'));

    expect(() => create()).not.toThrow();
    expect(hint()).toBeNull();
    expect(paletteButton()).not.toBeNull();
  });

  it('still hides a dismissed hint when storage throws on write', () => {
    create();
    spyOn(Storage.prototype, 'setItem').and.throwError(new DOMException('full', 'QuotaExceededError'));

    expect(() => {
      dismissButton()!.click();
      fixture.detectChanges();
    }).not.toThrow();
    expect(hint()).toBeNull();
  });

  it('passes the axe sweep with the hint showing, in both schemes', async () => {
    create();
    document.body.appendChild(el());
    expect(hint()).withContext('the hint under audit').not.toBeNull();

    try {
      for (const scheme of AUDIT_SCHEMES) {
        await withTheme(scheme, async () => {
          expect(summarizeViolations(await runAxe(el())))
            .withContext(`${scheme} scheme`)
            .toEqual([]);
        });
      }
    } finally {
      el().remove();
    }
  });
});

describe("HeaderComponent, focus after a palette opened from the hint's own dismiss (#446)", () => {
  const HINT_KEY = 'homeaccount.shortcuts-hint-dismissed';

  let fixture: ComponentFixture<HeaderComponent>;

  const el = () => fixture.nativeElement as HTMLElement;
  const hint = () => el().querySelector<HTMLElement>('.shortcuts-hint');
  const paletteButton = () => el().querySelector<HTMLButtonElement>('.palette-button');
  const dismissButton = () => el().querySelector<HTMLButtonElement>('.shortcuts-hint-dismiss');

  /** A key the layout's host listener would hand on, as the dismiss received it. */
  function pressedOnDismiss(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: dismissButton() });
    return event;
  }

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.removeItem(HINT_KEY);
    // The real MatDialog: restoring focus as a dialog closes is the CDK's.
    await TestBed.configureTestingModule({
      imports: [HeaderComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal<User | null>({ id: 'u1', displayName: 'Tester' } as User),
            signOut: jasmine.createSpy('signOut'),
          },
        },
        {
          provide: BreakpointObserver,
          useValue: {
            observe: (query: string | string[]) => {
              const queries = Array.isArray(query) ? query : [query];
              const matches = queries.includes(APP_BREAKPOINTS.desktop);
              return new BehaviorSubject<BreakpointState>({ matches, breakpoints: {} });
            },
          },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    localStorage.removeItem(HINT_KEY);
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  const doors: [string, (shortcuts: KeyboardShortcutService) => void][] = [
    ['?', shortcuts => shortcuts.handleHelpHotkey(pressedOnDismiss({ key: '?', shiftKey: true }))],
    ['Ctrl+K', shortcuts => shortcuts.handlePaletteHotkey(pressedOnDismiss({ key: 'k', ctrlKey: true }))],
  ];

  for (const [door, press] of doors) {
    it(`hands focus to the palette button when ${door} on the dismiss opens a palette that then closes`, async () => {
      expect(hint()).withContext('the hint at desktop').not.toBeNull();
      dismissButton()!.focus();

      press(TestBed.inject(KeyboardShortcutService));
      await render();
      expect(hint()).withContext('retired as the palette opened, and its dismiss with it').toBeNull();

      TestBed.inject(MatDialog).closeAll();
      await render();

      expect(document.activeElement).toBe(paletteButton());
    });
  }

  it('leaves focus to return where it was when the palette opens from anywhere else', async () => {
    const menuButton = el().querySelector<HTMLButtonElement>('.menu-button')!;
    menuButton.focus();
    const chord = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(chord, 'target', { value: menuButton });

    TestBed.inject(KeyboardShortcutService).handlePaletteHotkey(chord);
    await render();
    TestBed.inject(MatDialog).closeAll();
    await render();

    expect(document.activeElement).toBe(menuButton);
  });
});
