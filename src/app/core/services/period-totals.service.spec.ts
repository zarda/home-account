import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { AUTO_SWEEP_LIMIT, PeriodTotalsService } from './period-totals.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { MockAuthService, MockFirestoreService, createTransaction } from './testing';
import { createMockUser } from './testing/mock-auth.service';
import { Transaction } from '../../models';
import { applyClientTransactionFilters, buildTransactionWhere } from '../utils/transaction-query.utils';
import { sumByType } from '../utils/transaction-aggregation.utils';

const PATH = 'users/test-user-123/transactions';

/**
 * The exact-or-absent contract: totals come from a completed sweep of the
 * whole filtered set, never from a partial read, never folded before rates,
 * and never re-read when only a client-side filter or a fold input moved.
 */
describe('PeriodTotalsService', () => {
  let service: PeriodTotalsService;
  let mockFirestore: MockFirestoreService;
  let mockAuth: MockAuthService;

  // Fold inputs the specs can move: a live rate for rows without a stored
  // snapshot, and a distinctive multiplier for a non-USD base. Distinct from
  // 1 and from any compiled-in constant, so a fold that bypasses them shows.
  let rate: ReturnType<typeof signal<number>>;

  // Seeded newest-first, matching the sweep's fixed date-desc order.
  function seedTransactions(rows: Partial<Transaction>[]): Transaction[] {
    const base = new Date(2026, 5, 30, 12).getTime();
    const transactions = rows.map((overrides, i) =>
      createTransaction({
        id: `txn-${String(i).padStart(4, '0')}`,
        date: Timestamp.fromMillis(base - i * 60 * 60 * 1000),
        ...overrides
      })
    );
    mockFirestore.setMockCollection(PATH, transactions);
    return transactions;
  }

  beforeEach(() => {
    rate = signal(3);
    TestBed.configureTestingModule({
      providers: [
        PeriodTotalsService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: () => Promise.resolve(),
            amountInBase: (t: Transaction, base: string) =>
              t.amountInBaseCurrency ?? t.amount * (base === 'USD' ? rate() : 10)
          }
        }
      ]
    });
    service = TestBed.inject(PeriodTotalsService);
    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    mockAuth = TestBed.inject(AuthService) as unknown as MockAuthService;
    mockAuth.setAuthenticated(true);
    service.retryBaseDelayMs = 0;
    service.sweepPageSize = 2;
  });

  function currencyStub(): CurrencyService {
    return TestBed.inject(CurrencyService);
  }

  it('sweeps every page to completion and reports exact totals', async () => {
    const seeded = seedTransactions([
      { amount: 10 }, { amount: 20 }, { amount: 30 }, { amount: 40 },
      { type: 'income', amount: 500 }
    ]);

    const pending = service.reset({});
    expect(service.status().kind).toBe('computing');
    expect(service.totals()).toBeNull();
    await pending;

    // 5 rows at page size 2: three pages, each continuing after the last
    // snapshot of the page before.
    const pageCalls = mockFirestore.getPageSpy.calls;
    expect(pageCalls.length).toBe(3);
    expect((pageCalls[1].args[1] as { startAfterDoc: { id: string } }).startAfterDoc.id)
      .toBe(seeded[1].id);
    expect((pageCalls[2].args[1] as { startAfterDoc: { id: string } }).startAfterDoc.id)
      .toBe(seeded[3].id);

    expect(service.status().kind).toBe('ready');
    expect(service.totals()).toEqual(
      sumByType(seeded, t => currencyStub().amountInBase(t, 'USD'))
    );
  });

  it('issues the same server constraints as the list, at a fixed sort', async () => {
    seedTransactions([{ amount: 10 }]);
    const filters = {
      type: 'expense' as const,
      startDate: new Date(2026, 5, 1),
      endDate: new Date(2026, 5, 30)
    };

    await service.reset(filters);

    const options = mockFirestore.getPageSpy.mostRecent()!.args[1] as {
      where: unknown;
      orderBy: unknown;
    };
    expect(options.where).toEqual(buildTransactionWhere(filters));
    // The list's sort is never consulted: sums are order-independent, and a
    // constant direction keeps the sweep on the same composite indexes.
    expect(options.orderBy).toEqual([{ field: 'date', direction: 'desc' }]);
  });

  it('applies client-only filters once over the whole swept set', async () => {
    // Page 1 holds only the near-miss; the exact match sits on page 2. A
    // per-page application would find page 1's exact pass empty, fire the
    // fuzzy fallback there, and sum a row no view shows.
    const seeded = seedTransactions([
      { amount: 11, description: 'espressa bar' },
      { amount: 13, description: 'groceries' },
      { amount: 17, description: 'espresso bar' },
      { amount: 19, description: 'transport' }
    ]);

    // The counterfactual, proven: on an isolated page the fallback would
    // have admitted the near-miss.
    expect(
      applyClientTransactionFilters([seeded[0]], { searchQuery: 'espresso' }, {}).length
    ).toBe(1);

    await service.reset({ searchQuery: 'espresso' });

    expect(service.totals()!.expense).toBe(17);
    expect(service.totals()!.count).toBe(1);
  });

  it('answers an empty set with exact zeros and no page reads', async () => {
    mockFirestore.setMockCollection(PATH, []);

    await service.reset({});

    expect(service.status().kind).toBe('ready');
    expect(service.totals()).toEqual({ income: 0, expense: 0, balance: 0, count: 0 });
    expect(mockFirestore.getPageSpy.calls.length).toBe(0);
  });

  it('holds an over-cap set behind an explicit ask', async () => {
    seedTransactions([{ amount: 10 }, { amount: 20 }]);
    spyOn(mockFirestore, 'countDocuments').and.resolveTo(AUTO_SWEEP_LIMIT + 1);

    await service.reset({});

    expect(service.status()).toEqual({ kind: 'over-cap', serverCount: AUTO_SWEEP_LIMIT + 1 });
    expect(mockFirestore.getPageSpy.calls.length).toBe(0);
    expect(service.totals()).toBeNull();

    await expectAsync(service.calculate()).toBeResolvedTo(true);
    expect(service.status().kind).toBe('ready');
    expect(service.totals()!.expense).toBe(30);

    // Not over-cap any more: a second ask has nothing to consent to.
    await expectAsync(service.calculate()).toBeResolvedTo(false);
  });

  it('reports unavailable when the count fails, without paging', async () => {
    seedTransactions([{ amount: 10 }]);
    spyOn(mockFirestore, 'countDocuments').and.rejectWith(new Error('offline'));

    await service.reset({});

    expect(service.status().kind).toBe('unavailable');
    expect(mockFirestore.getPageSpy.calls.length).toBe(0);
  });

  it('retries transient page failures, but never a missing index', async () => {
    seedTransactions([{ amount: 10 }]);
    const getPage = spyOn(mockFirestore, 'getPage').and.rejectWith(new Error('transient'));

    await service.reset({});
    expect(service.status().kind).toBe('unavailable');
    expect(getPage.calls.count()).toBe(3);

    getPage.calls.reset();
    getPage.and.rejectWith(
      Object.assign(new Error('needs an index'), { code: 'failed-precondition' })
    );
    await service.refresh();
    expect(service.status().kind).toBe('unavailable');
    expect(getPage.calls.count()).toBe(1);
  });

  it('discards a superseded sweep through the generation guard', async () => {
    seedTransactions([{ amount: 10 }]);
    let resolveFirstCount!: (count: number) => void;
    const counts: Promise<number>[] = [
      new Promise<number>(resolve => (resolveFirstCount = resolve)),
      Promise.resolve(1)
    ];
    spyOn(mockFirestore, 'countDocuments').and.callFake(() => counts.shift()!);

    const first = service.reset({ type: 'expense' });
    const second = service.reset({ type: 'income' });
    await second;
    expect(service.status().kind).toBe('ready');
    const settled = service.totals();

    // The first reset's count lands late; the guard must drop it rather
    // than let it restart a sweep under the abandoned filters.
    resolveFirstCount(1);
    await first;
    expect(service.status().kind).toBe('ready');
    expect(service.totals()).toBe(settled);
  });

  it('never pages before the rates have settled', async () => {
    seedTransactions([{ amount: 10, amountInBaseCurrency: undefined }]);
    let resolveRates!: () => void;
    const currency = currencyStub() as unknown as { ensureRatesLoaded: () => Promise<void> };
    currency.ensureRatesLoaded = () => new Promise<void>(resolve => (resolveRates = resolve));

    const pending = service.reset({});
    await Promise.resolve();
    await Promise.resolve();

    // getExchangeRate would answer 1 for every pair right now; nothing may
    // be read, let alone folded.
    expect(service.status().kind).toBe('computing');
    expect(mockFirestore.getPageSpy.calls.length).toBe(0);
    expect(service.totals()).toBeNull();

    resolveRates();
    await pending;
    expect(service.status().kind).toBe('ready');
    expect(service.totals()!.expense).toBe(30); // 10 × the seeded live rate
  });

  it('refolds a client-only filter change from the cached sweep, read-free', async () => {
    seedTransactions([
      { amount: 11, description: 'coffee' },
      { amount: 13, description: 'groceries' },
      { amount: 17, description: 'coffee beans' }
    ]);
    await service.reset({ startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 30) });
    const countCalls = mockFirestore.getCollectionSpy.calls.length;
    const pageCalls = mockFirestore.getPageSpy.calls.length;

    await service.reset({
      startDate: new Date(2026, 5, 1),
      endDate: new Date(2026, 5, 30),
      searchQuery: 'coffee'
    });

    // Same server constraints: no recount, no repage, no computing beat —
    // the fold recomputes over the rows already swept.
    expect(mockFirestore.getCollectionSpy.calls.length).toBe(countCalls);
    expect(mockFirestore.getPageSpy.calls.length).toBe(pageCalls);
    expect(service.status().kind).toBe('ready');
    expect(service.totals()!.expense).toBe(28);
    expect(service.totals()!.count).toBe(2);
  });

  it('re-reads on refresh, passing through computing rather than showing stale figures', async () => {
    seedTransactions([{ amount: 10 }]);
    await service.reset({});
    expect(service.totals()!.expense).toBe(10);

    seedTransactions([{ amount: 10 }, { amount: 25 }]);
    const pending = service.refresh();
    expect(service.status().kind).toBe('computing');
    expect(service.totals()).toBeNull();
    await pending;

    expect(service.status().kind).toBe('ready');
    expect(service.totals()!.expense).toBe(35);
  });

  it('keeps over-cap consent across mutations and drops it on new filters', async () => {
    seedTransactions([{ amount: 10 }, { amount: 20 }]);
    spyOn(mockFirestore, 'countDocuments').and.resolveTo(AUTO_SWEEP_LIMIT + 1);

    await service.reset({});
    expect(service.status().kind).toBe('over-cap');

    // Unarmed: a mutation refresh re-asks rather than silently sweeping.
    await service.refresh();
    expect(service.status().kind).toBe('over-cap');

    await service.calculate();
    expect(service.status().kind).toBe('ready');

    // Armed: the user already consented to this filter set's cost.
    await service.refresh();
    expect(service.status().kind).toBe('ready');

    // New filters, new consent.
    await service.reset({ type: 'expense' });
    expect(service.status().kind).toBe('over-cap');
  });

  it('refolds when the base currency changes, read-free', async () => {
    seedTransactions([{ amount: 10, amountInBaseCurrency: undefined }]);
    await service.reset({});
    expect(service.totals()!.expense).toBe(30); // USD base: 10 × rate 3
    const pageCalls = mockFirestore.getPageSpy.calls.length;

    mockAuth.currentUser.set(
      createMockUser('test-user-123', {
        preferences: { ...mockAuth.currentUser()!.preferences, baseCurrency: 'EUR' }
      })
    );

    expect(service.totals()!.expense).toBe(100); // EUR base: 10 × 10
    expect(mockFirestore.getPageSpy.calls.length).toBe(pageCalls);
  });

  it('refolds when the live rate moves, read-free', async () => {
    seedTransactions([{ amount: 10, amountInBaseCurrency: undefined }]);
    await service.reset({});
    expect(service.totals()!.expense).toBe(30);
    const pageCalls = mockFirestore.getPageSpy.calls.length;

    rate.set(5);

    expect(service.totals()!.expense).toBe(50);
    expect(mockFirestore.getPageSpy.calls.length).toBe(pageCalls);
  });
});
