// The add affordance must exist at every width. The transactions header FAB
// and the bottom-nav "+" are two halves of one promise — each hides itself
// where the other is supposed to take over — and they used to disagree about
// what "mobile" means: the header asked the user agent, the bottom nav asked
// the viewport. A phone turned sideways satisfied neither, and the app had no
// way to add a transaction until it was turned back.
//
// So both halves are driven here from ONE fake BreakpointObserver. That
// sharing is the point: it is what proves the two gates answer the same
// question. transactions.component.spec.ts covers the class with an empty
// template and cannot see any of this.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, Subject, of } from 'rxjs';

import { APP_BREAKPOINTS } from '../../core/layout/breakpoints';
import { TransactionsComponent } from './transactions.component';
import { MainLayoutComponent } from '../../shared/layout/main-layout/main-layout.component';
import { TransactionService } from '../../core/services/transaction.service';
import { TransactionWindowService } from '../../core/services/transaction-window.service';
import { PeriodTotalsService, PeriodTotalsStatus } from '../../core/services/period-totals.service';
import { AuthService } from '../../core/services/auth.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { DeviceService } from '../../core/services/device.service';
import { LocaleFormatService } from '../../core/services/locale-format.service';
import { TranslationService } from '../../core/services/translation.service';
import { NotificationService } from '../../core/services/notification.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { FitTextDirective } from '../../shared/directives/fit-text.directive';
import { FitTextRegistry } from '../../shared/directives/fit-text.registry';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { Transaction, User } from '../../models';
import { TypeTotals } from '../../core/utils/transaction-aggregation.utils';
import { createCategory } from '../../core/services/testing';

const MOBILE = APP_BREAKPOINTS.mobile;
const TABLET = APP_BREAKPOINTS.tablet;
const DESKTOP = APP_BREAKPOINTS.desktop;

type Width = 'mobile' | 'tablet' | 'desktop';

/**
 * One viewport in the shape both observers read: `matches` answers the single
 * mobile query (all injectIsMobileViewport asks for), and `breakpoints` is the
 * map MainLayout reads for its three-way split.
 */
function viewport(width: Width): BreakpointState {
  return {
    matches: width === 'mobile',
    breakpoints: {
      [MOBILE]: width === 'mobile',
      [TABLET]: width === 'tablet',
      [DESKTOP]: width === 'desktop',
    },
  };
}

describe('Add affordance (transactions header FAB + bottom nav)', () => {
  let viewport$: BehaviorSubject<BreakpointState>;
  let page: ComponentFixture<TransactionsComponent>;
  let layout: ComponentFixture<MainLayoutComponent>;
  let periodTotals: {
    status: ReturnType<typeof signal<PeriodTotalsStatus>>;
    totals: ReturnType<typeof signal<TypeTotals | null>>;
    reset: jasmine.Spy;
    refresh: jasmine.Spy;
    calculate: jasmine.Spy;
  };

  function at(width: Width): void {
    viewport$.next(viewport(width));
    page.detectChanges();
    layout.detectChanges();
  }

  function headerFab(): HTMLElement | null {
    return page.nativeElement.querySelector('button[mat-fab]');
  }

  function bottomNavVisible(): boolean {
    const container = layout.nativeElement.querySelector('.bottom-nav-container') as HTMLElement;
    return getComputedStyle(container).display !== 'none';
  }

  beforeEach(async () => {
    localStorage.removeItem('homeaccount.sidebar-collapsed');
    viewport$ = new BehaviorSubject<BreakpointState>(viewport('desktop'));

    periodTotals = {
      status: signal<PeriodTotalsStatus>({ kind: 'idle' }),
      totals: signal<TypeTotals | null>(null),
      reset: jasmine.createSpy('reset').and.resolveTo(undefined),
      refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
      calculate: jasmine.createSpy('calculate').and.resolveTo(true),
    };

    const windowSource = {
      window: signal<Transaction[]>([]),
      visibleWindow: signal<Transaction[]>([]),
      isInitialLoading: signal(false),
      reachedStart: signal(true),
      reachedEnd: signal(true),
      totalCount: signal<number | null>(null),
      resetSeq: signal(0),
      reset: jasmine.createSpy('reset').and.resolveTo(undefined),
      refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
      jumpTo: jasmine.createSpy('jumpTo').and.resolveTo(undefined),
      isInLoadedRange: jasmine.createSpy('isInLoadedRange').and.returnValue(true),
      requestScrollTo: jasmine.createSpy('requestScrollTo'),
    };

    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    const dialog = jasmine.createSpyObj('MatDialog', ['open', 'closeAll']);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

    await TestBed.configureTestingModule({
      imports: [TransactionsComponent, MainLayoutComponent],
      providers: [
        provideNoopAnimations(),
        { provide: BreakpointObserver, useValue: { observe: () => viewport$.asObservable() } },
        // A phone: the user agent says mobile at every width. Kept
        // deliberately — the page must never consult it again, and this is
        // what fails if it does.
        {
          provide: DeviceService,
          useValue: { isMobile: () => true, supportsCameraCapture: () => true },
        },
        {
          provide: TransactionService,
          useValue: {
            transactions: signal<Transaction[]>([]),
            isLoading: signal(false),
            lastMutation: signal(null),
            deleteTransaction: jasmine.createSpy('deleteTransaction').and.resolveTo(undefined),
          },
        },
        {
          provide: CategoryService,
          useValue: {
            expenseCategories: signal<unknown[]>([]),
            incomeCategories: signal<unknown[]>([]),
            categories: signal([createCategory({ id: 'c1' })]),
            loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal<User | null>({ preferences: { baseCurrency: 'USD' } } as User),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            // Long enough to crowd the row, unlike the `USD 300` used
            // elsewhere: the squeeze only exists when the figures are wide.
            formatCurrency: (value: number, code: string) =>
              `${code} ${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          },
        },
        {
          provide: LocaleFormatService,
          useValue: { formatRange: jasmine.createSpy('formatRange').and.returnValue('RANGE') },
        },
        { provide: TranslationService, useValue: translation },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']),
        },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: { get: () => null } },
            queryParams: new Subject<Record<string, string>>().asObservable(),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      // `set` merges per key, so the real templateUrl/styleUrl survive — that
      // is the whole point here. Only the child imports are narrowed to what
      // this file measures; the list, filters and chips stay unknown elements.
      .overrideComponent(TransactionsComponent, {
        set: {
          imports: [
            PageHeaderComponent,
            MatButtonModule,
            MatIconModule,
            MatMenuModule,
            FitTextDirective,
            TranslatePipe,
          ],
          schemas: [NO_ERRORS_SCHEMA],
          // This override replaces the component's own providers array.
          providers: [
            { provide: TransactionWindowService, useValue: windowSource },
            { provide: PeriodTotalsService, useValue: periodTotals },
          ],
        },
      })
      .overrideComponent(MainLayoutComponent, {
        set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    page = TestBed.createComponent(TransactionsComponent);
    layout = TestBed.createComponent(MainLayoutComponent);

    // Creating a fixture evicts the previous one's root element, and a
    // detached tree has no computed style — these assertions measure real
    // layout, so both hosts go back into the document explicitly.
    document.body.appendChild(page.nativeElement);
    document.body.appendChild(layout.nativeElement);

    page.detectChanges();
    layout.detectChanges();
  });

  afterEach(() => {
    page.nativeElement.remove();
    layout.nativeElement.remove();
    localStorage.removeItem('homeaccount.sidebar-collapsed');
  });

  // The bug, stated once. Before the fix this is 0 at tablet and desktop: the
  // header FAB is gated away by the user agent while the bottom nav is
  // display:none at the same width.
  it('puts the add affordance in exactly one place at every width', () => {
    for (const width of ['mobile', 'tablet', 'desktop'] as const) {
      at(width);

      const present = [headerFab() !== null, bottomNavVisible()].filter(Boolean).length;
      expect(present).withContext(`${width}: exactly one add affordance`).toBe(1);
    }
  });

  // A phone rotating into landscape — the reported symptom. The bottom bar
  // goes away at that width, so the header must pick the "+" up in the same
  // change detection pass.
  it('hands the add button from the bottom nav to the header when a phone turns sideways', () => {
    at('mobile');
    expect(bottomNavVisible()).withContext('portrait: bottom nav').toBeTrue();
    expect(headerFab()).withContext('portrait: no header FAB').toBeNull();

    at('tablet');
    expect(bottomNavVisible()).withContext('landscape: bottom nav is gone').toBeFalse();
    expect(headerFab()).withContext('landscape: header FAB takes over').not.toBeNull();
  });

  // The two gates live in different projection slots and cannot be one
  // @else, so this is what keeps them exact negations of each other.
  it('shows the period totals in exactly one place, on the same gate as the FAB', () => {
    periodTotals.totals.set({ income: 500, expense: 300, balance: 200 } as TypeTotals);
    periodTotals.status.set({ kind: 'ready' } as PeriodTotalsStatus);

    at('desktop');
    expect(page.nativeElement.querySelector('.page-header-actions .period-totals')).not.toBeNull();
    expect(page.nativeElement.querySelector('.period-totals-line')).toBeNull();

    at('mobile');
    expect(page.nativeElement.querySelector('.period-totals-line')).not.toBeNull();
    expect(page.nativeElement.querySelector('.page-header-actions .period-totals')).toBeNull();
  });

  // An invariant, not a regression: Material's own .mat-mdc-fab-base already
  // sets flex-shrink: 0, so this passes with or without the .add-fab rule
  // beside it. It is here because `!min-w-0` on the host strips the button's
  // automatic minimum size, leaving that one Material declaration as all that
  // keeps the only route to Add from collapsing into a sliver — so the day an
  // upgrade or an override takes it away, this is what says so.
  it('keeps the add button whole when the totals crowd the row', () => {
    periodTotals.totals.set({
      income: 12345678.9,
      expense: 9876543.21,
      balance: 2469135.69,
    } as TypeTotals);
    periodTotals.status.set({ kind: 'ready' } as PeriodTotalsStatus);
    at('desktop');

    // A hostile width: the arithmetic is what generalizes, not the number.
    page.nativeElement.style.display = 'block';
    page.nativeElement.style.width = '320px';
    page.detectChanges();
    TestBed.inject(FitTextRegistry).flush();

    const button = headerFab()!;
    const actions = page.nativeElement.querySelector('.page-header-actions') as HTMLElement;

    expect(getComputedStyle(button).flexShrink).withContext('the button does not yield').toBe('0');
    expect(Math.round(button.getBoundingClientRect().width))
      .withContext('48px, the size !w-12 asks for')
      .toBe(48);
    expect(button.getBoundingClientRect().right)
      .withContext('and it stays inside the row it belongs to')
      .toBeLessThanOrEqual(actions.getBoundingClientRect().right + 1);
  });
});
