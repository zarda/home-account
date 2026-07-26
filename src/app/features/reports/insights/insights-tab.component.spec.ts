import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { InsightsTabComponent } from './insights-tab.component';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { PwaService } from '../../../core/services/pwa.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MatDialog } from '@angular/material/dialog';
import { InsightSnapshot, Transaction, User } from '../../../models';
import { createTimestamp, createTransaction, createUser } from '../../../core/services/testing/test-data';
import {
  PeriodSelection,
} from '../../../shared/components/period-selector/period-selector.component';

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

  it('creates and loads on init', async () => {
    await build(history());
    expect(component).toBeTruthy();
    expect(transactionService.getTransactionsInRange).toHaveBeenCalled();
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
