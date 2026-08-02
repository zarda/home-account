import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

import { ReportsComponent } from './reports.component';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { PendingFiltersService } from '../../core/services/pending-filters.service';
import { Transaction } from '../../models';
import { addMonths, clampToEndOfToday } from '../../core/utils/transaction-date.utils';

import {
  PeriodSelection,
  defaultPeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';

function selection(option: PeriodSelection['option'], start: Date, end: Date): PeriodSelection {
  return { option, start, end, label: '' };
}

function txn(id: string, date: Date): Transaction {
  return {
    id,
    userId: 'user1',
    type: 'expense',
    amount: 10,
    amountInBaseCurrency: 10,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: id,
    date: Timestamp.fromDate(date),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false,
  };
}


describe('ReportsComponent', () => {
  let component: ReportsComponent;
  let fixture: ComponentFixture<ReportsComponent>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockPendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let mockRouter: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    mockTransactionService = jasmine.createSpyObj(
      'TransactionService',
      ['getByDateRange', 'getTransactionsInRange'],
      { transactions: signal<Transaction[]>([]) }
    );
    mockTransactionService.getByDateRange.and.returnValue(of([]));
    mockTransactionService.getTransactionsInRange.and.returnValue(of([]));

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories'], {
      categories: signal([])
    });
    mockCategoryService.loadCategories.and.returnValue(of([]));

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({ preferences: { baseCurrency: 'USD' } })
    });

    const mockCurrencyService = {
      currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      amountInBase: (t: { amount: number; amountInBaseCurrency?: number }) =>
        t.amountInBaseCurrency ?? t.amount
    };

    mockPendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply', 'consume']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockRouter.navigate.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [ReportsComponent, NoopAnimationsModule],
      providers: [
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: PendingFiltersService, useValue: mockPendingFilters },
        { provide: Router, useValue: mockRouter }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(ReportsComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ReportsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should start on the default This Month range', () => {
      const expected = defaultPeriodSelection();
      expect(component.dateRange().start.getTime()).toBe(expected.start.getTime());
      expect(component.dateRange().end.getTime()).toBe(expected.end.getTime());
    });

    it('should load data on init', () => {
      expect(mockTransactionService.getByDateRange).toHaveBeenCalled();
      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
    });

    it('should have default tab index of 0', () => {
      expect(component.selectedTabIndex).toBe(0);
    });

    it('subscribes to categories once, not again on each period change', () => {
      component.onPeriodSelection(selection('custom', new Date(2024, 5, 1), new Date(2024, 5, 30)));
      component.onPeriodSelection(selection('custom', new Date(2024, 6, 1), new Date(2024, 6, 31)));
      expect(mockCategoryService.loadCategories).toHaveBeenCalledTimes(1);
    });

    it('releases the window and category listeners on destroy', () => {
      const range$ = new Subject<never[]>();
      const categories$ = new Subject<never[]>();
      mockTransactionService.getByDateRange.and.returnValue(range$);
      mockCategoryService.loadCategories.and.returnValue(categories$);

      const freshFixture = TestBed.createComponent(ReportsComponent);
      freshFixture.detectChanges();
      expect(range$.observed).toBeTrue();
      expect(categories$.observed).toBeTrue();

      freshFixture.destroy();
      expect(range$.observed).toBeFalse();
      expect(categories$.observed).toBeFalse();
    });

    it('supersedes the previous window listener on a period change', () => {
      const created: Subject<never[]>[] = [];
      mockTransactionService.getByDateRange.and.callFake(() => {
        const stream = new Subject<never[]>();
        created.push(stream);
        return stream;
      });

      component.onPeriodSelection(selection('custom', new Date(2024, 5, 1), new Date(2024, 5, 30)));
      component.onPeriodSelection(selection('custom', new Date(2024, 6, 1), new Date(2024, 6, 31)));

      expect(created.length).toBe(2);
      expect(created[0].observed).toBeFalse();
      expect(created[1].observed).toBeTrue();
    });
  });

  describe('period selection', () => {
    it('should update the date range and reload from a selector emission', () => {
      mockTransactionService.getByDateRange.calls.reset();
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);

      component.onPeriodSelection(selection('custom', start, end));

      expect(component.dateRange()).toEqual({ start, end });
      expect(mockTransactionService.getByDateRange).toHaveBeenCalledWith(start, end);
    });

    it('should retain the selected option, which the insights tab needs', () => {
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);

      component.onPeriodSelection(selection('custom', start, end));

      // dateRange used to be the only thing kept, which dropped the option the
      // trailing insight window is derived from.
      expect(component.selectedPeriod().option).toBe('custom');
      expect(component.selectedPeriod().start).toBe(start);
    });
  });

  describe('prior-year window', () => {
    it('should fetch the same window shifted back twelve months on init', () => {
      const expected = defaultPeriodSelection();
      const [start, end] = mockTransactionService.getTransactionsInRange.calls.mostRecent().args;

      expect(start.getTime()).toBe(addMonths(expected.start, -12).getTime());
      // Clamped: "This Month" runs to the end of the calendar month, and a
      // whole month a year ago is not comparable with a month-to-date one.
      expect(end.getTime()).toBe(
        addMonths(clampToEndOfToday(expected.end, new Date()), -12).getTime()
      );
    });

    it('should stop the prior-year window at today when the period runs past it', () => {
      mockTransactionService.getTransactionsInRange.calls.reset();
      const now = new Date();
      const endOfToday = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const futureEnd = new Date(now.getFullYear() + 1, 0, 31, 23, 59, 59);

      component.onPeriodSelection(selection('custom', start, futureEnd));

      const [, end] = mockTransactionService.getTransactionsInRange.calls.mostRecent().args;
      // Unclamped, months that have not happened yet compare an empty bucket
      // against a full year-ago one and render a green "-100%".
      expect(end.getTime()).toBe(addMonths(endOfToday, -12).getTime());
    });

    it('should refetch the shifted window when the period changes', () => {
      mockTransactionService.getTransactionsInRange.calls.reset();
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);

      component.onPeriodSelection(selection('custom', start, end));

      expect(mockTransactionService.getTransactionsInRange).toHaveBeenCalledWith(
        addMonths(start, -12),
        addMonths(end, -12)
      );
    });

    it('should fill priorYearTransactions without disturbing the shared signal', () => {
      const seeded = [txn('current-row', new Date(2024, 5, 10))];
      (mockTransactionService.transactions as WritableSignal<Transaction[]>).set(seeded);
      const priorRows = [txn('prior-row', new Date(2023, 5, 10))];
      mockTransactionService.getTransactionsInRange.and.returnValue(of(priorRows));

      component.onPeriodSelection(
        selection('custom', new Date(2024, 5, 1), new Date(2024, 5, 30))
      );

      expect(component.priorYearTransactions()).toEqual(priorRows);
      // The shared signal feeds every report tab; the prior-year fetch must
      // not have written to it.
      expect(mockTransactionService.transactions()).toEqual(seeded);
    });

    it('should clear the prior-year rows before the new window arrives', () => {
      mockTransactionService.getTransactionsInRange.and.returnValue(
        of([txn('prior-june', new Date(2023, 5, 10))])
      );
      component.onPeriodSelection(
        selection('custom', new Date(2024, 5, 1), new Date(2024, 5, 30))
      );
      expect(component.priorYearTransactions().length).toBe(1);

      const pending = new Subject<Transaction[]>();
      mockTransactionService.getTransactionsInRange.and.returnValue(pending);
      component.onPeriodSelection(
        selection('custom', new Date(2024, 6, 1), new Date(2024, 6, 31))
      );

      // Stale year-ago figures next to a new period would read as real data.
      expect(component.priorYearTransactions()).toEqual([]);

      pending.next([txn('prior-july', new Date(2023, 6, 10))]);
      expect(component.priorYearTransactions().map(t => t.id)).toEqual(['prior-july']);
    });

    it('should stop listening to the prior-year window once destroyed', () => {
      const pending = new Subject<Transaction[]>();
      mockTransactionService.getTransactionsInRange.and.returnValue(pending);
      component.onPeriodSelection(
        selection('custom', new Date(2024, 5, 1), new Date(2024, 5, 30))
      );

      fixture.destroy();
      pending.next([txn('late-row', new Date(2023, 5, 10))]);

      // The Firestore wrapper never completes, so an unmanaged subscription
      // would leave a listener behind for the life of the session.
      expect(component.priorYearTransactions()).toEqual([]);
      expect(pending.observed).toBeFalse();
    });
  });

  describe('category drill-down', () => {
    it('should hand the selected window and category to the transactions page', () => {
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);
      component.onPeriodSelection(selection('custom', start, end));

      component.onCategoryDrillDown({ categoryId: 'cat1', type: 'expense' });

      expect(mockPendingFilters.apply).toHaveBeenCalledWith({
        categoryId: 'cat1',
        type: 'expense',
        startDate: start,
        endDate: end
      });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/transactions']);
    });

    it('should follow the breakdown onto the income side of the toggle', () => {
      const start = new Date(2024, 5, 1);
      const end = new Date(2024, 5, 30, 23, 59, 59);
      component.onPeriodSelection(selection('custom', start, end));

      component.onCategoryDrillDown({ categoryId: 'cat3', type: 'income' });

      // Forcing expense here would open a list that cannot contain the income
      // slice the user just clicked.
      expect(mockPendingFilters.apply).toHaveBeenCalledWith({
        categoryId: 'cat3',
        type: 'income',
        startDate: start,
        endDate: end
      });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/transactions']);
    });
  });

  describe('computed values', () => {
    it('should return baseCurrency from user preferences', () => {
      expect(component.baseCurrency()).toBe('USD');
    });

    it('should compute totalIncome as 0 with no transactions', () => {
      expect(component.totalIncome()).toBe(0);
    });

    it('should compute totalExpenses as 0 with no transactions', () => {
      expect(component.totalExpenses()).toBe(0);
    });

    it('should compute balance as 0 with no transactions', () => {
      expect(component.balance()).toBe(0);
    });
  });

});
