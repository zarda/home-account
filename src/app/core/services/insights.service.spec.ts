import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { INSIGHT_WINDOW_MONTHS, InsightsService, insightWindow } from './insights.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { TransactionService } from './transaction.service';
import { Transaction, User } from '../../models';
import { createTimestamp, createTransaction, createUser } from './testing/test-data';
import {
  PeriodSelection,
} from '../../shared/components/period-selector/period-selector.component';

describe('InsightsService', () => {
  let service: InsightsService;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let isOnline: ReturnType<typeof signal<boolean>>;
  let currentUser: ReturnType<typeof signal<User | null>>;

  function selection(start: Date, end: Date, option: PeriodSelection['option'] = 'custom'): PeriodSelection {
    return { option, start, end, label: 'test' };
  }

  function expense(date: Date, amount: number, overrides: Partial<Transaction> = {}): Transaction {
    return createTransaction({
      type: 'expense', amount, amountInBaseCurrency: amount,
      date: createTimestamp(date), ...overrides,
    });
  }

  /** Enough history that several detectors have something to report. */
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

  beforeEach(() => {
    sessionStorage.clear();
    isOnline = signal(true);
    currentUser = signal<User | null>(createUser());

    transactionService = jasmine.createSpyObj<TransactionService>(
      'TransactionService',
      ['getTransactionsInRange', 'getByDateRange', 'getTransactions', 'getMonthlyTotals',
        'getExpensesInRange', 'getAllTransactions']);
    transactionService.getTransactionsInRange.and.returnValue(of([]));

    currencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', ['amountInBase']);
    currencyService.amountInBase.and.callFake(
      (t: Transaction) => t.amountInBaseCurrency ?? t.amount);

    TestBed.configureTestingModule({
      providers: [
        InsightsService,
        { provide: TransactionService, useValue: transactionService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: AuthService, useValue: { currentUser } },
        { provide: PwaService, useValue: { isOnline } },
      ],
    });
    service = TestBed.inject(InsightsService);
  });

  afterEach(() => sessionStorage.clear());

  describe('insightWindow', () => {
    const now = new Date(2026, 6, 15, 10, 0);

    it('widens a single-month selection to the trailing window', () => {
      const window = insightWindow(
        selection(new Date(2026, 6, 1), new Date(2026, 6, 31, 23, 59, 59, 999), 'thisMonth'),
        now);
      expect(window.start.getTime()).toBe(new Date(2026, 0, 1).getTime());
      expect(INSIGHT_WINDOW_MONTHS).toBe(6);
    });

    it('clamps an end that runs past today', () => {
      const window = insightWindow(
        selection(new Date(2026, 6, 1), new Date(2026, 6, 31, 23, 59, 59, 999), 'thisMonth'),
        now);
      expect(window.end.getTime()).toBe(new Date(2026, 6, 15, 23, 59, 59, 999).getTime());
    });

    it('drops an incomplete final month from the trend series', () => {
      const window = insightWindow(
        selection(new Date(2026, 6, 1), new Date(2026, 6, 31, 23, 59, 59, 999), 'thisMonth'),
        now);
      expect(window.endsMidMonth).toBeTrue();
      expect(window.months).toEqual(
        ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
      expect(window.months).not.toContain('2026-07');
    });

    it('keeps a complete final month', () => {
      const window = insightWindow(
        selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999), 'lastMonth'),
        now);
      expect(window.endsMidMonth).toBeFalse();
      expect(window.months[window.months.length - 1]).toBe('2026-06');
    });

    it('never narrows a selection wider than the trailing window', () => {
      const window = insightWindow(
        selection(new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59, 59, 999), 'thisYear'),
        now);
      expect(window.start.getTime()).toBe(new Date(2026, 0, 1).getTime());
    });

    it('looks back from a past custom month, not from today', () => {
      const window = insightWindow(
        selection(new Date(2026, 2, 1), new Date(2026, 2, 31, 23, 59, 59, 999)), now);
      expect(window.end.getTime()).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).getTime());
      expect(window.months[window.months.length - 1]).toBe('2026-03');
    });
  });

  describe('data fetching', () => {
    it('uses only the non-mutating range query', () => {
      service.load(selection(new Date(2026, 0, 1), new Date(2026, 5, 30)));

      expect(transactionService.getTransactionsInRange).toHaveBeenCalledTimes(1);
      // These three all overwrite the shared transactions signal that the other
      // three report tabs render from, so the insights tab must never call them.
      expect(transactionService.getByDateRange).not.toHaveBeenCalled();
      expect(transactionService.getTransactions).not.toHaveBeenCalled();
      expect(transactionService.getMonthlyTotals).not.toHaveBeenCalled();
    });

    it('requests both transaction types, since payday needs income', () => {
      service.load(selection(new Date(2026, 0, 1), new Date(2026, 5, 30)));
      expect(transactionService.getExpensesInRange).not.toHaveBeenCalled();
    });

    it('computes cards from the fetched window', () => {
      transactionService.getTransactionsInRange.and.returnValue(of(history()));
      service.load(
        selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999)),
        new Date(2026, 6, 15));

      expect(service.isLoading()).toBeFalse();
      expect(service.facts()).not.toBeNull();
      expect(service.cards().length).toBeGreaterThan(0);
      expect(service.windowTransactionCount()).toBe(66);
    });

    it('exposes the window it settled on', () => {
      service.load(
        selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999)),
        new Date(2026, 6, 15));
      expect(service.window()?.months.length).toBe(7);
    });

    it('yields no cards for an empty window', () => {
      service.load(selection(new Date(2026, 0, 1), new Date(2026, 5, 30)));
      expect(service.cards()).toEqual([]);
      expect(service.facts()).not.toBeNull();
    });
  });

  describe('failure and offline handling', () => {
    it('reports a failure without throwing', () => {
      transactionService.getTransactionsInRange.and.returnValue(
        throwError(() => new Error('permission-denied')));
      service.load(selection(new Date(2026, 0, 1), new Date(2026, 5, 30)));

      expect(service.hasFailed()).toBeTrue();
      expect(service.isLoading()).toBeFalse();
      expect(service.cards()).toEqual([]);
    });

    it('distinguishes offline-with-no-data from having no data', () => {
      service.load(selection(new Date(2026, 0, 1), new Date(2026, 5, 30)));
      expect(service.isOfflineWithoutData()).toBeFalse();

      isOnline.set(false);
      expect(service.isOfflineWithoutData()).toBeTrue();
    });

    it('does not claim offline when data did arrive', () => {
      transactionService.getTransactionsInRange.and.returnValue(of(history()));
      service.load(
        selection(new Date(2026, 5, 1), new Date(2026, 5, 30)), new Date(2026, 6, 15));
      isOnline.set(false);
      expect(service.isOfflineWithoutData()).toBeFalse();
    });
  });

  describe('caching', () => {
    it('serves a second identical load from the cache', () => {
      transactionService.getTransactionsInRange.and.returnValue(of(history()));
      const period = selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999));
      const now = new Date(2026, 6, 15);

      service.load(period, now);
      const first = service.fingerprint();
      currencyService.amountInBase.calls.reset();

      service.load(period, now);
      expect(service.fingerprint()).toBe(first);
      // A cache hit skips the detectors entirely, so no conversion happens.
      expect(currencyService.amountInBase).not.toHaveBeenCalled();
    });

    it('recomputes when a transaction changes', () => {
      const period = selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999));
      const now = new Date(2026, 6, 15);
      const base = history();

      transactionService.getTransactionsInRange.and.returnValue(of(base));
      service.load(period, now);
      const first = service.fingerprint();

      transactionService.getTransactionsInRange.and.returnValue(
        of([...base, expense(new Date(2026, 5, 9), 900)]));
      service.load(period, now);
      expect(service.fingerprint()).not.toBe(first);
    });

    it('recomputes when the base currency changes', () => {
      // The transactions are untouched, but every money figure would differ.
      const period = selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999));
      const now = new Date(2026, 6, 15);
      transactionService.getTransactionsInRange.and.returnValue(of(history()));

      service.load(period, now);
      currencyService.amountInBase.calls.reset();

      currentUser.set(createUser({
        preferences: { ...createUser().preferences, baseCurrency: 'JPY' },
      }));
      service.load(period, now);
      expect(currencyService.amountInBase).toHaveBeenCalled();
      expect(service.facts()?.baseCurrency).toBe('JPY');
    });

    it('recomputes after refresh discards the cached entry', () => {
      const period = selection(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59, 59, 999));
      const now = new Date(2026, 6, 15);
      transactionService.getTransactionsInRange.and.returnValue(of(history()));

      service.load(period, now);
      currencyService.amountInBase.calls.reset();

      service.refresh(period, now);
      expect(currencyService.amountInBase).toHaveBeenCalled();
    });

    it('survives an unusable session store', () => {
      const setItem = spyOn(sessionStorage, 'setItem').and.throwError('quota');
      transactionService.getTransactionsInRange.and.returnValue(of(history()));

      expect(() => service.load(
        selection(new Date(2026, 5, 1), new Date(2026, 5, 30)), new Date(2026, 6, 15)))
        .not.toThrow();
      expect(service.cards().length).toBeGreaterThan(0);
      expect(setItem).toHaveBeenCalled();
    });
  });
});
