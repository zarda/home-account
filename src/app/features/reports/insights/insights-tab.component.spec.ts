import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';
import { InsightsTabComponent } from './insights-tab.component';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { PwaService } from '../../../core/services/pwa.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RecurringService } from '../../../core/services/recurring.service';
import { MatDialog } from '@angular/material/dialog';
import { InsightSnapshot, Transaction, User } from '../../../models';
import { createTimestamp, createTransaction, createUser } from '../../../core/services/testing/test-data';
import {
  PeriodSelection,
} from '../../../shared/components/period-selector/period-selector.component';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { createTranslationStub } from '../../../core/services/testing';

function expenseRow(date: Date, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return createTransaction({
    type: 'expense', amount, amountInBaseCurrency: amount,
    date: createTimestamp(date), ...overrides,
  });
}

/** Six months of a subscription and a coffee habit — enough to trip the gates. */
function historyRows(): Transaction[] {
  const rows: Transaction[] = [];
  for (let month = 0; month < 6; month += 1) {
    rows.push(expenseRow(new Date(2026, month, 5), 15.99, {
      description: 'Netflix', categoryId: 'subscriptions_streaming_services',
    }));
    for (let day = 1; day <= 10; day += 1) {
      rows.push(expenseRow(new Date(2026, month, day * 2), 3.5, {
        description: 'Coffee', categoryId: 'food_restaurants',
      }));
    }
  }
  return rows;
}

function storedSnapshotFixture(monthKey: string): InsightSnapshot {
  return {
    id: monthKey, userId: 'u1', monthKey,
    detectorVersion: 1, schemaVersion: 1, status: 'complete',
    fingerprint: { tx: 'x:1', count: 1, timeZone: 'UTC', baseCurrency: 'USD' },
    totals: { income: 0, expense: 0, balance: 0, count: 0 },
    byCategory: [],
    facts: {} as InsightSnapshot['facts'],
    cards: [],
    generatedAt: createTimestamp(new Date(2026, 6, 1)),
    createdAt: createTimestamp(new Date(2026, 6, 1)),
    revision: 1,
  };
}

describe('InsightsTabComponent', () => {
  let component: InsightsTabComponent;
  let fixture: ComponentFixture<InsightsTabComponent>;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let snapshotService: jasmine.SpyObj<InsightSnapshotService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let storedSnapshots: ReturnType<typeof signal<InsightSnapshot[]>>;

  const period: PeriodSelection = {
    option: 'lastMonth',
    start: new Date(2026, 5, 1),
    end: new Date(2026, 5, 30, 23, 59, 59, 999),
    label: 'June 2026',
  };

  function expense(date: Date, amount: number, overrides: Partial<Transaction> = {}): Transaction {
    return createTransaction({
      type: 'expense', amount, amountInBaseCurrency: amount,
      date: createTimestamp(date), ...overrides,
    });
  }

  function history(): Transaction[] {
    const transactions: Transaction[] = [];
    for (let month = 0; month < 6; month += 1) {
      transactions.push(expense(new Date(2026, month, 5), 15.99, {
        description: 'Netflix', categoryId: 'subscriptions_streaming_services',
      }));
      for (let day = 1; day <= 10; day += 1) {
        transactions.push(expense(new Date(2026, month, day * 2), 3.5, {
          description: 'Coffee', categoryId: 'food_restaurants',
        }));
      }
    }
    return transactions;
  }

  async function build(transactions: Transaction[]): Promise<void> {
    transactionService.getTransactionsInRange.and.returnValue(of(transactions));
    fixture = TestBed.createComponent(InsightsTabComponent);
    fixture.componentRef.setInput('period', period);
    fixture.componentRef.setInput('currency', 'USD');
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    sessionStorage.clear();
    currentUser = signal<User | null>(createUser());
    storedSnapshots = signal<InsightSnapshot[]>([]);

    transactionService = jasmine.createSpyObj<TransactionService>(
      'TransactionService', ['getTransactionsInRange']);
    transactionService.getTransactionsInRange.and.returnValue(of([]));

    snapshotService = jasmine.createSpyObj<InsightSnapshotService>(
      'InsightSnapshotService',
      ['generateClosedMonths', 'watch', 'get', 'staleness', 'regenerate'],
      { snapshots: storedSnapshots });
    snapshotService.generateClosedMonths.and.returnValue(Promise.resolve([]));
    snapshotService.watch.and.returnValue(of([]));
    snapshotService.get.and.returnValue(null);
    snapshotService.staleness.and.returnValue(Promise.resolve(null));
    snapshotService.regenerate.and.returnValue(Promise.resolve(null));

    notifications = jasmine.createSpyObj<NotificationService>(
      'NotificationService', ['success', 'error', 'info']);
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

    await TestBed.configureTestingModule({
      imports: [InsightsTabComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: AuthService, useValue: { currentUser } },
        { provide: PwaService, useValue: { isOnline: signal(true) } },
        { provide: InsightSnapshotService, useValue: snapshotService },
        { provide: NotificationService, useValue: notifications },
        { provide: MatDialog, useValue: dialog },
        {
          provide: RecurringService,
          useValue: {
            recurringTransactions: signal([]),
            getRecurring: () => of([]),
            createRecurring: () => Promise.resolve('id'),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
          },
        },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        {
          provide: TranslationService,
          useValue: {
            t: (key: string) => key,
            getIntlLocale: () => 'en-US',
            currentLocale: signal('en'),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(InsightsTabComponent, { set: { template: '<div></div>' } })
      .compileComponents();
  });

  afterEach(() => sessionStorage.clear());

  it('creates and loads exactly once on init', async () => {
    await build(history());
    expect(component).toBeTruthy();
    // The constructor effect owns the initial load; ngOnInit loading as well
    // used to open a second six-month listener on every first render.
    expect(transactionService.getTransactionsInRange).toHaveBeenCalledTimes(1);
  });

  it('releases the previous window listener when the period moves', async () => {
    await build(history());
    const created: Subject<Transaction[]>[] = [];
    transactionService.getTransactionsInRange.and.callFake(() => {
      const stream = new Subject<Transaction[]>();
      created.push(stream);
      return stream;
    });

    fixture.componentRef.setInput('period', {
      ...period,
      option: 'thisYear',
      start: new Date(2026, 0, 1),
    } satisfies PeriodSelection);
    fixture.detectChanges();
    expect(created.length).toBe(1);
    expect(created[0].observed).toBeTrue();

    fixture.componentRef.setInput('period', {
      ...period,
      option: 'lastMonth',
      start: new Date(2026, 4, 1),
    } satisfies PeriodSelection);
    fixture.detectChanges();

    expect(created.length).toBe(2);
    expect(created[0].observed).toBeFalse();
    expect(created[1].observed).toBeTrue();
  });

  it('produces cards from a rich history', async () => {
    await build(history());
    expect(component.hasCards()).toBeTrue();
    expect(component.transactionCount()).toBe(66);
  });

  it('states the window it computed over', async () => {
    await build(history());
    expect(component.windowLabel()).toContain('2026');
    expect(component.windowLabel()).toContain('–');
  });

  it('names what is missing rather than looking empty', async () => {
    // Three transactions: below the habit gate and short of three full months.
    await build([
      expense(new Date(2026, 5, 2), 10),
      expense(new Date(2026, 5, 3), 10),
    ]);
    expect(component.hasCards()).toBeFalse();
    const missing = component.missingRequirements();
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some(text => text.includes('needTransactions'))).toBeTrue();
  });

  it('lists no missing requirements once the gates are met', async () => {
    await build(history());
    expect(component.missingRequirements()).toEqual([]);
  });

  it('exposes the recurring summary only when there is something in it', async () => {
    await build(history());
    expect(component.recurringSummary()).not.toBeNull();

    await build([expense(new Date(2026, 5, 2), 10)]);
    expect(component.recurringSummary()).toBeNull();
  });

  it('reloads when the period input changes', async () => {
    await build(history());
    transactionService.getTransactionsInRange.calls.reset();

    fixture.componentRef.setInput('period', {
      ...period,
      option: 'thisYear',
      start: new Date(2026, 0, 1),
    } satisfies PeriodSelection);
    fixture.detectChanges();

    expect(transactionService.getTransactionsInRange).toHaveBeenCalled();
  });

  it('refresh recomputes', async () => {
    await build(history());
    transactionService.getTransactionsInRange.calls.reset();
    component.refresh();
    expect(transactionService.getTransactionsInRange).toHaveBeenCalled();
  });

  describe('viewing a stored month', () => {
    const archived: InsightSnapshot = {
      id: '2026-03', userId: 'u1', monthKey: '2026-03',
      detectorVersion: 1, schemaVersion: 1, status: 'complete',
      fingerprint: { tx: 'x:4', count: 4, timeZone: 'UTC', baseCurrency: 'JPY' },
      totals: { income: 0, expense: 400, balance: -400, count: 4 },
      byCategory: [],
      facts: {
        recurring: { groups: [], groupCount: 0 },
      } as unknown as InsightSnapshot['facts'],
      cards: [{
        id: 'smallDrip', kind: 'smallDrip',
        titleKey: 'insights.smallDripTitle', bodyKey: 'insights.smallDripBody',
        params: { count: 4, percent: 20, months: 1 },
        metrics: { total: 80 },
        categoryIds: [], transactionCount: 4,
        drillDown: { mode: 'none' }, weight: 50,
      }],
      generatedAt: createTimestamp(new Date(2026, 3, 1)),
      createdAt: createTimestamp(new Date(2026, 3, 1)),
      revision: 1,
    };

    beforeEach(() => {
      snapshotService.get.and.callFake(
        (month: string) => (month === '2026-03' ? archived : null));
    });

    it('renders the stored cards rather than recomputing', async () => {
      await build(history());
      component.onMonthSelected('2026-03');

      expect(component.isViewingArchive()).toBeTrue();
      expect(component.cards().map(card => card.id)).toEqual(['smallDrip']);
    });

    it('shows the currency the month was computed in, not today\'s', async () => {
      // Every money field in that document is in JPY; rendering it as USD would
      // be a silently wrong number.
      await build(history());
      component.onMonthSelected('2026-03');
      expect(component.displayCurrency()).toBe('JPY');
    });

    it('resolves staleness only for the month opened', async () => {
      await build(history());
      expect(snapshotService.staleness).not.toHaveBeenCalled();

      component.onMonthSelected('2026-03');
      expect(snapshotService.staleness).toHaveBeenCalledOnceWith('2026-03');
    });

    it('returns to the live computation', async () => {
      await build(history());
      component.onMonthSelected('2026-03');
      component.onMonthSelected(null);

      expect(component.isViewingArchive()).toBeFalse();
      expect(component.staleness()).toBeNull();
      expect(component.cards().length).toBeGreaterThan(1);
    });

    it('regenerates behind a confirmation', async () => {
      await build(history());
      component.onRegenerate('2026-03');

      expect(dialog.open).toHaveBeenCalled();
      expect(snapshotService.regenerate).toHaveBeenCalledWith('2026-03');

      // The confirm handler is async: regenerate, then re-read staleness.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(notifications.success).toHaveBeenCalled();
      expect(component.isRegenerating()).toBeFalse();
    });

    it('does not regenerate when the confirmation is declined', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      await build(history());
      component.onRegenerate('2026-03');

      expect(snapshotService.regenerate).not.toHaveBeenCalled();
    });

    it('reports a failed regeneration', async () => {
      snapshotService.regenerate.and.returnValue(Promise.reject(new Error('denied')));
      await build(history());
      component.onRegenerate('2026-03');
      await Promise.resolve();
      await Promise.resolve();

      expect(notifications.error).toHaveBeenCalled();
    });
  });
});

/**
 * The cases above override the template to `<div></div>`, so the tab's
 * governing structure — a four-arm `@if` chain at the top and a four-arm one
 * inside it — is proven only as signals. Which arm renders is the template's
 * decision, and the arm that matters most is the third: an offline cold cache
 * returns an empty window, and showing "no patterns" there would tell the
 * user they have no transactions, which would be a lie
 * (`insights-tab.component.html:13-21`).
 *
 * Partial render: the five feature children are left unresolved. Each has its
 * own spec; none is asserted about here beyond being present or absent, which
 * is exactly what the gates decide and what an unresolved element answers the
 * same way a real one would.
 */
describe('InsightsTabComponent, through its own template', () => {
  let fixture: ComponentFixture<InsightsTabComponent>;
  let component: InsightsTabComponent;
  let transactions: jasmine.SpyObj<TransactionService>;
  let snapshots: jasmine.SpyObj<InsightSnapshotService>;
  let stored: ReturnType<typeof signal<InsightSnapshot[]>>;
  let online: ReturnType<typeof signal<boolean>>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const emptyState = () => el().querySelector('app-empty-state') as HTMLElement | null;

  const windowPeriod: PeriodSelection = {
    option: 'lastMonth',
    start: new Date(2026, 5, 1),
    end: new Date(2026, 5, 30, 23, 59, 59, 999),
    label: 'June 2026',
  };

  function render(rows: Transaction[] = []): void {
    transactions.getTransactionsInRange.and.returnValue(of(rows));
    fixture = TestBed.createComponent(InsightsTabComponent);
    fixture.componentRef.setInput('period', windowPeriod);
    fixture.componentRef.setInput('currency', 'USD');
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    sessionStorage.clear();
    stored = signal<InsightSnapshot[]>([]);
    online = signal(true);

    transactions = jasmine.createSpyObj<TransactionService>('TransactionService', ['getTransactionsInRange']);
    transactions.getTransactionsInRange.and.returnValue(of([]));

    snapshots = jasmine.createSpyObj<InsightSnapshotService>(
      'InsightSnapshotService',
      ['generateClosedMonths', 'watch', 'get', 'staleness', 'regenerate'],
      { snapshots: stored });
    snapshots.generateClosedMonths.and.resolveTo([]);
    snapshots.watch.and.returnValue(of([]));
    snapshots.get.and.returnValue(null);
    snapshots.staleness.and.resolveTo(null);
    snapshots.regenerate.and.resolveTo(null);

    await TestBed.configureTestingModule({
      imports: [InsightsTabComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: transactions },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: InsightSnapshotService, useValue: snapshots },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: RecurringService,
          useValue: {
            recurringTransactions: signal([]),
            getRecurring: () => of([]),
            createRecurring: () => Promise.resolve('id'),
          },
        },
        { provide: CurrencyService, useValue: { amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        {
          provide: TranslationService,
          useValue: { ...createTranslationStub(), getIntlLocale: () => 'en-US' },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(InsightsTabComponent, {
        set: {
          imports: [
            MatButtonModule,
            MatExpansionModule,
            MatIconModule,
            EmptyStateComponent,
            LoadingSpinnerComponent,
            TranslatePipe,
          ],
          // A standalone component's template is governed by its own schemas,
          // not the TestBed's, so the five feature children need excusing here.
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
  });

  afterEach(() => sessionStorage.clear());

  it('shows the computing spinner while the window is still being read', () => {
    const pending = new Subject<Transaction[]>();
    transactions.getTransactionsInRange.and.returnValue(pending.asObservable());
    fixture = TestBed.createComponent(InsightsTabComponent);
    fixture.componentRef.setInput('period', windowPeriod);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')?.textContent).toContain('insights.computing');
    expect(emptyState()).toBeNull();
    expect(el().querySelector('.window-banner')).toBeNull();
  });

  it('offers a retry when the window could not be read', () => {
    transactions.getTransactionsInRange.and.returnValue(throwError(() => new Error('offline')));
    fixture = TestBed.createComponent(InsightsTabComponent);
    fixture.componentRef.setInput('period', windowPeriod);
    fixture.componentRef.setInput('currency', 'USD');
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.hasFailed()).toBeTrue();
    expect(emptyState()?.textContent).toContain('insights.errorTitle');
    expect(emptyState()?.textContent).toContain('insights.retry');
    expect(el().querySelector('app-loading-spinner')).toBeNull();
  });

  it('says offline rather than "no data" on a cold cache', () => {
    // The single most important gate in this template: an empty window
    // offline is not the same statement as an empty account.
    online.set(false);
    render([]);

    expect(component.isOfflineWithoutData()).toBeTrue();
    expect(emptyState()?.textContent).toContain('insights.offlineTitle');
    expect(emptyState()?.textContent).toContain('insights.offlineBody');
    expect(el().textContent).not.toContain('insights.noPatternsTitle');
    expect(el().textContent).not.toContain('insights.gettingStartedTitle');
  });

  it('names the window and its count, with a refresh beside them', () => {
    render(historyRows());

    expect(component.windowLabel()).toBeTruthy();
    expect(text('.window-banner span'))
      .toBe(`insights.basedOn:${JSON.stringify({ range: component.windowLabel(), count: component.transactionCount() })}`);

    const refresh = el().querySelector('.refresh-button') as HTMLButtonElement;
    expect(refresh.getAttribute('aria-label')).toBe('insights.retry');
    const refreshed = spyOn(component, 'refresh');
    refresh.click();
    expect(refreshed).toHaveBeenCalled();
  });

  it('names the gaps rather than looking broken on a young account', () => {
    render([expenseRow(new Date(2026, 5, 3), 10)]);

    expect(component.missingRequirements().length).toBeGreaterThan(0);
    expect(el().querySelector('.getting-started')).not.toBeNull();
    expect(emptyState()?.textContent).toContain('insights.gettingStartedTitle');
    expect(Array.from(el().querySelectorAll('.requirement-list li')).map(n => n.textContent?.trim()))
      .toEqual(component.missingRequirements());
  });

  it('renders one card per insight once there are cards', () => {
    render(historyRows());

    expect(component.hasCards()).toBeTrue();
    expect(el().querySelectorAll('.insight-grid app-insight-card').length)
      .toBe(component.cards().length);
    expect(el().querySelector('.getting-started')).toBeNull();
  });

  it('keeps the narrative off a frozen month and on the live view', () => {
    // Describing a frozen month would need the prose stored, and model output
    // is not deterministic enough to belong in a record that must regenerate
    // identically (`insights-tab.component.html:46-48`).
    const frozen = storedSnapshotFixture('2026-05');
    stored.set([frozen]);
    snapshots.get.and.returnValue(frozen);
    render(historyRows());

    expect(el().querySelector('app-insight-narrative')).not.toBeNull();

    component.onMonthSelected('2026-05');
    fixture.detectChanges();

    expect(component.isViewingArchive()).toBeTrue();
    expect(el().querySelector('app-insight-narrative')).toBeNull();
  });

  it('says the archive is empty rather than showing the live empty state', () => {
    const frozen = storedSnapshotFixture('2026-05');
    stored.set([frozen]);
    snapshots.get.and.returnValue(frozen);
    render(historyRows());

    component.onMonthSelected('2026-05');
    fixture.detectChanges();

    // The frozen month carries no cards of its own.
    expect(component.hasCards()).toBeFalse();
    expect(el().textContent).toContain('insights.archiveEmptyTitle');
    expect(el().textContent).not.toContain('insights.gettingStartedTitle');
    expect(el().textContent).not.toContain('insights.noPatternsTitle');
  });

  it('keeps the history accordion out until a month has been stored', () => {
    render(historyRows());
    expect(el().querySelector('.history-accordion')).toBeNull();

    stored.set([storedSnapshotFixture('2026-05'), storedSnapshotFixture('2026-04')]);
    fixture.detectChanges();

    expect(el().querySelector('.history-accordion')).not.toBeNull();
    expect(text('mat-panel-title')).toContain('insights.historyTitle');
    expect(text('mat-panel-description')).toBe('insights.historyCount:{"count":2}');
    expect(el().querySelector('app-snapshot-timeline')).not.toBeNull();
    expect(el().querySelector('app-snapshot-compare')).not.toBeNull();
  });
});
