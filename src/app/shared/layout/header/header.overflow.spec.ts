import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';

import { HeaderComponent } from './header.component';
import { AuthService } from '../../../core/services/auth.service';
import { SupportedLocale, TranslationService } from '../../../core/services/translation.service';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { createTranslationStub } from '../../../core/services/testing';
import { User } from '../../../models';
import en from '../../../../assets/i18n/en.json';
import ja from '../../../../assets/i18n/ja.json';
import tc from '../../../../assets/i18n/tc.json';

/**
 * `header.component.spec.ts` blanks the template (`overrideComponent` ->
 * `template: ''`), so it cannot host this proof: the real avatar `<img>`
 * has to be in the DOM for its error event to mean anything. Providers
 * mirror that spec's AuthService/BreakpointObserver/MatDialog shape, plus a
 * real TranslationService stub and `provideRouter([])` — the real template
 * puts a `routerLink` inside the user menu, which needs an `ActivatedRoute`
 * that spec's hand-rolled Router mock never had to supply.
 */
describe('overflow guard: the header avatar', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let host: HTMLElement;
  let mockAuth: { currentUser: ReturnType<typeof signal<User | null>> };

  const userWith = (photoURL: string): User => ({
    id: 'u1',
    displayName: 'Tester',
    photoURL,
  } as User);

  beforeEach(async () => {
    mockAuth = { currentUser: signal<User | null>(userWith('https://example.com/a.png')) };
    const viewport$ = new BehaviorSubject<BreakpointState>({ matches: false, breakpoints: {} });
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [HeaderComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuth },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: BreakpointObserver, useValue: { observe: () => viewport$.asObservable() } },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
  });

  afterEach(() => {
    host?.remove();
  });

  const avatarImg = (): HTMLImageElement | null => host.querySelector('.user-menu-button img.user-avatar');
  const avatarIcon = (): Element | null => host.querySelector('.user-menu-button mat-icon');

  it('falls back to the placeholder icon when the photo fails to load, and recovers on a new URL', () => {
    fixture.detectChanges();

    expect(avatarImg()).withContext('avatar img before any error').toBeTruthy();
    expect(avatarIcon()).withContext('placeholder icon before any error').toBeFalsy();

    avatarImg()!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(avatarImg()).withContext('avatar img after the photo fails').toBeFalsy();
    expect(avatarIcon()).withContext('placeholder icon after the photo fails').toBeTruthy();

    mockAuth.currentUser.set(userWith('https://example.com/b.png'));
    fixture.detectChanges();

    expect(avatarImg()).withContext('avatar img after a new photo URL arrives').toBeTruthy();
    expect(avatarIcon()).withContext('placeholder icon after a new photo URL arrives').toBeFalsy();
  });
});

/**
 * The header at the narrowest desktop width, 1024 px, where the '?' hint
 * first shows, in each catalog's own words. The palette button joins the
 * toolbar's row, and the hint hangs off the button's start side inside the
 * toolbar's band, outside the row's flow: it may not push the row, run under
 * the wordmark or the button, or spill out of the band onto the page.
 *
 * Real catalog strings, not keys: a raw key is one unbreakable word, and the
 * ja and tc sentences are the long ones. Verdana is pinned on the host and on
 * Material's font tokens because Karma serves none of the app's fonts.
 */
describe('overflow guard: the header with the ? hint at 1024 px', () => {
  const DESKTOP_WIDTH = 1024;
  const HINT_KEY = 'homeaccount.shortcuts-hint-dismissed';
  const CATALOGS: Record<SupportedLocale, unknown> = { en, ja, tc };

  let fixture: ComponentFixture<HeaderComponent>;
  let host: HTMLElement;

  /** The catalog's own string for a dotted key, or the key when it has none. */
  function lookup(catalog: unknown, key: string): string {
    const found = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
    return typeof found === 'string' ? found : key;
  }

  async function setUp(locale: SupportedLocale): Promise<void> {
    localStorage.removeItem(HINT_KEY);
    const desktop = { matches: true, breakpoints: { [APP_BREAKPOINTS.desktop]: true } };
    const narrower = { matches: false, breakpoints: {} };

    await TestBed.configureTestingModule({
      imports: [HeaderComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { currentUser: signal<User | null>({ id: 'u1', displayName: 'Tester' } as User) },
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open'], { openDialogs: [] }) },
        {
          provide: BreakpointObserver,
          useValue: {
            observe: (query: string) =>
              new BehaviorSubject<BreakpointState>(query === APP_BREAKPOINTS.desktop ? desktop : narrower),
          },
        },
        {
          provide: TranslationService,
          useValue: createTranslationStub({
            t: (key: string) => lookup(CATALOGS[locale], key),
            currentLocale: signal<string>(locale),
          }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    host = fixture.nativeElement as HTMLElement;
    host.style.width = `${DESKTOP_WIDTH}px`;
    const face = "Verdana, 'DejaVu Sans', sans-serif";
    host.style.fontFamily = face;
    for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
      host.style.setProperty(token, face);
    }
    document.body.appendChild(host);
    fixture.detectChanges();
  }

  afterEach(() => {
    host?.remove();
    localStorage.removeItem(HINT_KEY);
  });

  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`keeps the toolbar and the hint inside the header in the ${locale} catalog`, async () => {
      await setUp(locale);

      const toolbar = host.querySelector('.header-toolbar') as HTMLElement;
      const hint = host.querySelector('.shortcuts-hint') as HTMLElement | null;
      expect(hint).withContext('the hint at desktop').not.toBeNull();
      expect(hint!.textContent).withContext('the catalog sentence').toContain(lookup(CATALOGS[locale], 'shortcuts.hint'));

      expect(toolbar.scrollWidth).withContext('toolbar scrollWidth vs clientWidth').toBeLessThanOrEqual(toolbar.clientWidth + 1);
      expect(toolbar.getBoundingClientRect().height).withContext('the toolbar keeps its height').toBeCloseTo(64, 0);

      const bar = toolbar.getBoundingClientRect();
      const box = hint!.getBoundingClientRect();
      const title = (host.querySelector('.app-title') as HTMLElement).getBoundingClientRect();
      const button = (host.querySelector('.palette-button') as HTMLElement).getBoundingClientRect();
      expect(box.top).withContext('hint top vs the toolbar band').toBeGreaterThanOrEqual(bar.top - 1);
      expect(box.bottom).withContext('hint bottom vs the toolbar band').toBeLessThanOrEqual(bar.bottom + 1);
      expect(box.left).withContext('hint left edge vs the wordmark').toBeGreaterThanOrEqual(title.right - 1);
      expect(box.right).withContext('hint right edge vs the palette button').toBeLessThanOrEqual(button.left + 1);
      expect(hint!.scrollWidth).withContext('hint scrollWidth vs clientWidth').toBeLessThanOrEqual(hint!.clientWidth + 1);

      const text = hint!.querySelector('.shortcuts-hint-text') as HTMLElement;
      expect(text.scrollWidth).withContext('the sentence fits inside the hint').toBeLessThanOrEqual(text.clientWidth + 1);

      const dismiss = (hint!.querySelector('.shortcuts-hint-dismiss') as HTMLElement).getBoundingClientRect();
      expect(dismiss.left).withContext('dismiss left vs the hint').toBeGreaterThanOrEqual(box.left - 1);
      expect(dismiss.right).withContext('dismiss right vs the hint').toBeLessThanOrEqual(box.right + 1);
    });
  }
});
