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
import { Transaction, User } from '../../../models';
import { createTimestamp, createTransaction, createUser } from '../../../core/services/testing/test-data';
import {
  PeriodSelection,
} from '../../../shared/components/period-selector/period-selector.component';

describe('InsightsTabComponent', () => {
  let component: InsightsTabComponent;
  let fixture: ComponentFixture<InsightsTabComponent>;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let currentUser: ReturnType<typeof signal<User | null>>;

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

    transactionService = jasmine.createSpyObj<TransactionService>(
      'TransactionService', ['getTransactionsInRange']);
    transactionService.getTransactionsInRange.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [InsightsTabComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: transactionService },
        { provide: AuthService, useValue: { currentUser } },
        { provide: PwaService, useValue: { isOnline: signal(true) } },
        {
          provide: InsightSnapshotService,
          useValue: {
            generateClosedMonths: jasmine.createSpy('generateClosedMonths')
              .and.returnValue(Promise.resolve([])),
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
});
