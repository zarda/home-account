import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp, FieldValue, deleteField } from '@angular/fire/firestore';
import { of } from 'rxjs';
import {
  RecurringService,
  MAX_OCCURRENCES_PER_CLAIM,
  INVALID_FREQUENCY_ERROR
} from './recurring.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { findSerializationIssues } from '../utils/firestore-value.utils';
import { dayKey } from '../utils/transaction-date.utils';
import {
  RecurringTransaction,
  RecurringFrequency,
  CreateRecurringDTO,
  Transaction
} from '../../models';

describe('RecurringService', () => {
  let service: RecurringService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockBudgetService: jasmine.SpyObj<BudgetService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

  const DAY = 24 * 60 * 60 * 1000;

  const monthly: RecurringFrequency = { type: 'monthly', interval: 1 };

  const createRecurring = (overrides: Partial<RecurringTransaction> = {}): RecurringTransaction => {
    const nextOccurrence = overrides.nextOccurrence ?? Timestamp.fromDate(new Date(2024, 1, 1));

    return {
      id: 'rec1',
      userId: 'user123',
      name: 'Monthly Salary',
      type: 'income',
      amount: 5000,
      currency: 'USD',
      categoryId: 'employment_salary',
      description: 'Salary',
      frequency: monthly,
      // A rule's first occurrence is its start date, and the monthly and
      // yearly walks take their target day from that start. A fixture that
      // moved the pointer while leaving a fixed start behind would describe a
      // rule anchored on a day none of these specs is about — and one whose
      // schedule shifts with the calendar date the suite happens to run on.
      // Specs that need the two to differ, a rule resumed mid-schedule, say so
      // by passing startDate.
      startDate: nextOccurrence,
      nextOccurrence,
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides
    };
  };

  // Firestore-transaction stub: getDocRef returns path-carrying refs and
  // runTransaction hands the callback a tx whose get() serves docs from
  // serverDocs, mirroring the fresh server read of a real transaction.
  interface FakeDocRef { path: string }
  let serverDocs: Map<string, RecurringTransaction>;
  let txSet: jasmine.Spy;
  let txUpdate: jasmine.Spy;

  const seedServerRule = (rule: RecurringTransaction): void => {
    serverDocs.set(`users/user123/recurring/${rule.id}`, rule);
  };

  const txSetPaths = (): string[] =>
    txSet.calls.allArgs().map(args => (args[0] as FakeDocRef).path);

  const installTransactionStub = (): void => {
    serverDocs = new Map();
    txSet = jasmine.createSpy('tx.set');
    txUpdate = jasmine.createSpy('tx.update');

    mockFirestoreService.getDocRef.and.callFake(
      ((path: string) => ({ path })) as unknown as FirestoreService['getDocRef']
    );
    mockFirestoreService.runTransaction.and.callFake(updateFn => {
      const tx = {
        get: (ref: FakeDocRef) => {
          const doc = serverDocs.get(ref.path);
          return Promise.resolve({
            exists: () => doc !== undefined,
            id: ref.path.split('/').pop(),
            data: () => doc
          });
        },
        set: txSet,
        update: txUpdate
      };
      return updateFn(tx as unknown as Parameters<typeof updateFn>[0]);
    });
  };

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'subscribeToDocument',
      'addDocument',
      'updateDocument',
      'deleteDocument',
      'getDocument',
      'getDocRef',
      'runTransaction',
      'dateToTimestamp',
      'getTimestamp'
    ]);

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      userId: jasmine.createSpy('userId').and.returnValue('user123'),
      currentUser: jasmine.createSpy('currentUser').and.returnValue({
        preferences: { baseCurrency: 'USD' }
      })
    });

    mockBudgetService = jasmine.createSpyObj('BudgetService', [
      'getBudgets',
      'recalculateBudgetsForCategory'
    ]);
    mockCurrencyService = jasmine.createSpyObj('CurrencyService', [
      'ensureRatesLoaded',
      'getExchangeRate'
    ]);

    mockBudgetService.getBudgets.and.returnValue(of([]));
    mockBudgetService.recalculateBudgetsForCategory.and.returnValue(Promise.resolve());
    mockCurrencyService.ensureRatesLoaded.and.returnValue(Promise.resolve());
    mockCurrencyService.getExchangeRate.and.returnValue(1);
    mockFirestoreService.subscribeToCollection.and.returnValue(of([]));
    mockFirestoreService.subscribeToDocument.and.returnValue(of(null));
    mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-rec-id'));
    mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));
    mockFirestoreService.getTimestamp.and.returnValue(Timestamp.now());
    mockFirestoreService.dateToTimestamp.and.callFake((date: Date) => Timestamp.fromDate(date));
    installTransactionStub();

    // Minimal English translation stub so getFrequencyText resolves keys.
    const enFrequency: Record<string, string> = {
      'frequency.daily': 'Daily',
      'frequency.weekly': 'Weekly',
      'frequency.monthly': 'Monthly',
      'frequency.yearly': 'Yearly',
      'frequency.custom': 'Custom',
      'settings.everyNDays': 'Every {{n}} days',
      'settings.everyNWeeks': 'Every {{n}} weeks',
      'settings.everyNMonths': 'Every {{n}} months',
      'settings.everyNYears': 'Every {{n}} years',
    };
    const mockTranslationService = {
      t: (key: string, params?: Record<string, string | number>) => {
        let out = enFrequency[key] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
          }
        }
        return out;
      },
    };

    TestBed.configureTestingModule({
      providers: [
        RecurringService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: mockTranslationService }
      ]
    });

    service = TestBed.inject(RecurringService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('sign-out reset', () => {
    it('clears the cached rules on the signed-out edge', () => {
      // Fresh injector with a signal-backed auth stub: the reset effect
      // tracks userId() reactively, which a jasmine spy cannot express.
      TestBed.resetTestingModule();
      const userId = signal<string | null>('user-1');
      TestBed.configureTestingModule({
        providers: [
          RecurringService,
          { provide: FirestoreService, useValue: {} },
          { provide: BudgetService, useValue: {} },
          { provide: CurrencyService, useValue: {} },
          { provide: TranslationService, useValue: {} },
          { provide: AuthService, useValue: { userId } },
        ],
      });
      const fresh = TestBed.inject(RecurringService);
      fresh.recurringTransactions.set([{ id: 'r1' } as RecurringTransaction]);
      TestBed.tick();
      expect(fresh.recurringTransactions().length).toBe(1);

      userId.set(null);
      TestBed.tick();

      expect(fresh.recurringTransactions()).toEqual([]);
    });
  });

  describe('initial state', () => {
    it('should start with empty recurring transactions', () => {
      expect(service.recurringTransactions()).toEqual([]);
    });

    it('should start with isLoading false', () => {
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('computed signals', () => {
    it('activeRecurring should filter out inactive entries', () => {
      service.recurringTransactions.set([
        createRecurring({ id: 'a', isActive: true }),
        createRecurring({ id: 'b', isActive: false })
      ]);

      const active = service.activeRecurring();
      expect(active.length).toBe(1);
      expect(active[0].id).toBe('a');
    });

    it('upcomingRecurring should include only active entries due within 30 days, sorted', () => {
      const now = new Date();
      const inFive = new Date(now.getTime() + 5 * DAY);
      const inTwenty = new Date(now.getTime() + 20 * DAY);
      const inForty = new Date(now.getTime() + 40 * DAY);
      const inPast = new Date(now.getTime() - 5 * DAY);

      service.recurringTransactions.set([
        createRecurring({ id: 'far', nextOccurrence: Timestamp.fromDate(inForty) }),
        createRecurring({ id: 'soon', nextOccurrence: Timestamp.fromDate(inTwenty) }),
        createRecurring({ id: 'soonest', nextOccurrence: Timestamp.fromDate(inFive) }),
        createRecurring({ id: 'past', nextOccurrence: Timestamp.fromDate(inPast) }),
        createRecurring({ id: 'inactive', isActive: false, nextOccurrence: Timestamp.fromDate(inFive) })
      ]);

      const upcoming = service.upcomingRecurring();
      expect(upcoming.map(r => r.id)).toEqual(['soonest', 'soon']);
    });
  });

  describe('getRecurring', () => {
    it('should return empty array when not authenticated', (done) => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      service.getRecurring().subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('should query firestore with correct path and ordering', (done) => {
      const data = [createRecurring()];
      mockFirestoreService.subscribeToCollection.and.returnValue(of(data));

      service.getRecurring().subscribe(result => {
        expect(mockFirestoreService.subscribeToCollection).toHaveBeenCalledWith(
          'users/user123/recurring',
          { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] }
        );
        expect(result).toEqual(data);
        expect(service.recurringTransactions()).toEqual(data);
        done();
      });
    });
  });

  describe('getRecurringById', () => {
    it('should query firestore document with correct path', (done) => {
      const rec = createRecurring();
      mockFirestoreService.subscribeToDocument.and.returnValue(of(rec));

      service.getRecurringById('rec1').subscribe(result => {
        expect(mockFirestoreService.subscribeToDocument).toHaveBeenCalledWith(
          'users/user123/recurring/rec1'
        );
        expect(result).toEqual(rec);
        done();
      });
    });
  });

  describe('createRecurring', () => {
    const dto: CreateRecurringDTO = {
      name: 'Rent',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      categoryId: 'housing_rent',
      description: 'Monthly rent',
      frequency: monthly,
      startDate: new Date(2024, 0, 1)
    };

    it('should throw when not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      await expectAsync(service.createRecurring(dto)).toBeRejectedWithError('User not authenticated');
    });

    it('should add a recurring document with computed next occurrence', async () => {
      const id = await service.createRecurring(dto);

      expect(id).toBe('new-rec-id');
      const [path, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect(path).toBe('users/user123/recurring');
      const record = data as Record<string, unknown>;
      expect(record['name']).toBe('Rent');
      expect(record['isActive']).toBeTrue();
      expect(record['nextOccurrence']).toBeDefined();
      expect(record['endDate']).toBeUndefined();
    });

    it('should include an end date when supplied', async () => {
      await service.createRecurring({ ...dto, endDate: new Date(2025, 0, 1) });

      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['endDate']).toBeDefined();
    });

    it('should drop a null end date', async () => {
      await service.createRecurring({ ...dto, endDate: null });

      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['endDate']).toBeUndefined();
    });

    // toBeUndefined() above passes whether the key is absent or present with
    // an undefined value, and Firestore rejects only the second. A rule with
    // no end date is the common case, so that write always failed.
    it('writes no undefined values when no end date is set', async () => {
      await service.createRecurring(dto);

      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      // Timestamp fields are legitimate here, so only the undefined issues matter.
      const undefinedFields = findSerializationIssues(data)
        .filter(issue => issue.reason.startsWith('undefined'));
      expect(undefinedFields).toEqual([]);
      expect('endDate' in (data as Record<string, unknown>)).toBeFalse();
    });

    it('should reset isLoading after completion', async () => {
      await service.createRecurring(dto);
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('updateRecurring', () => {
    it('should map only provided fields into the update', async () => {
      await service.updateRecurring('rec1', {
        name: 'New name',
        amount: 999,
        description: 'desc'
      });

      const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect(path).toBe('users/user123/recurring/rec1');
      const record = data as Record<string, unknown>;
      expect(record['name']).toBe('New name');
      expect(record['amount']).toBe(999);
      expect(record['description']).toBe('desc');
      expect(record['type']).toBeUndefined();
    });

    it('should map type, currency, categoryId and startDate when provided', async () => {
      await service.updateRecurring('rec1', {
        type: 'income',
        currency: 'EUR',
        categoryId: 'cat',
        startDate: new Date(2024, 5, 1)
      });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      const record = data as Record<string, unknown>;
      expect(record['type']).toBe('income');
      expect(record['currency']).toBe('EUR');
      expect(record['categoryId']).toBe('cat');
      expect(record['startDate']).toBeDefined();
    });

    it('should map an end date when provided', async () => {
      await service.updateRecurring('rec1', { endDate: new Date(2025, 0, 1) });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['endDate']).toBeDefined();
    });

    it('should delete the stored end date when endDate is null', async () => {
      await service.updateRecurring('rec1', { endDate: null });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      const endDate = (data as Record<string, unknown>)['endDate'] as FieldValue;
      expect(endDate).toBeDefined();
      expect(endDate.isEqual(deleteField())).toBeTrue();
    });

    it('should recalculate next occurrence when frequency changes and current record exists', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createRecurring()));

      await service.updateRecurring('rec1', { frequency: { type: 'weekly', interval: 1 } });

      expect(mockFirestoreService.getDocument).toHaveBeenCalledWith('users/user123/recurring/rec1');
      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['nextOccurrence']).toBeDefined();
    });

    it('should recalculate next occurrence when only start date changes', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createRecurring()));

      await service.updateRecurring('rec1', { startDate: new Date(2024, 6, 1) });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['nextOccurrence']).toBeDefined();
    });

    it('should not set next occurrence when current record is missing', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));

      await service.updateRecurring('rec1', { frequency: { type: 'daily', interval: 2 } });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['nextOccurrence']).toBeUndefined();
    });

    it('should preserve a past-due next occurrence on an amount-only edit', async () => {
      // The edit dialog always submits frequency and startDate; when they are
      // unchanged the pointer must stay put so due-but-unposted occurrences
      // are not silently skipped.
      const pastDue = createRecurring({
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() - 10 * DAY))
      });
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(pastDue));

      await service.updateRecurring('rec1', {
        name: 'Renamed',
        amount: 999,
        frequency: { type: 'monthly', interval: 1 },
        startDate: pastDue.startDate.toDate()
      });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['nextOccurrence']).toBeUndefined();
    });

    it('should recalculate when only the frequency day-of-month changes', async () => {
      const current = createRecurring();
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(current));

      // The start date submitted is the stored one, so the day-of-month is the
      // only thing that moved and the recalculation can only be its doing.
      await service.updateRecurring('rec1', {
        frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 },
        startDate: current.startDate.toDate()
      });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['nextOccurrence']).toBeDefined();
    });

    it('should reset isLoading after completion', async () => {
      await service.updateRecurring('rec1', { name: 'x' });
      expect(service.isLoading()).toBeFalse();
    });
  });

  // A frequency that cannot advance is the interval-0 hang in its stored
  // form: every walk over a rule's occurrences asks for the next date, gets
  // the same one back, and never terminates. The entry points refuse it so it
  // cannot reach storage in the first place.
  describe('frequency validation', () => {
    // The start date is deliberately in the future: createRecurring then
    // returns it unchanged instead of walking towards today, so a pre-fix run
    // fails on the missing rejection rather than hanging on the walk.
    const futureDto = (frequency: RecurringFrequency): CreateRecurringDTO => ({
      name: 'Rent',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      categoryId: 'housing_rent',
      description: 'Monthly rent',
      frequency,
      startDate: new Date(Date.now() + 30 * DAY)
    });

    it('rejects a frequency that cannot advance before writing anything', async () => {
      await expectAsync(
        service.createRecurring(futureDto({ type: 'daily', interval: 0 }))
      ).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
    });

    it('rejects a negative interval', async () => {
      await expectAsync(
        service.createRecurring(futureDto({ type: 'daily', interval: -1 }))
      ).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
    });

    it('rejects a non-finite interval', async () => {
      await expectAsync(
        service.createRecurring(futureDto({ type: 'monthly', interval: NaN }))
      ).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

      expect(mockFirestoreService.addDocument).not.toHaveBeenCalled();
    });

    it('rejects an invalid frequency on update before touching the document', async () => {
      await expectAsync(
        service.updateRecurring('r1', { frequency: { type: 'daily', interval: 0 } })
      ).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('deleteRecurring', () => {
    it('should call deleteDocument with correct path', async () => {
      await service.deleteRecurring('rec1');
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith('users/user123/recurring/rec1');
    });

    it('should reset isLoading after completion', async () => {
      await service.deleteRecurring('rec1');
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('pauseRecurring', () => {
    it('should set isActive to false', async () => {
      await service.pauseRecurring('rec1');
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/recurring/rec1',
        { isActive: false }
      );
    });
  });

  describe('resumeRecurring', () => {
    it('should do nothing when the record does not exist', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));

      await service.resumeRecurring('rec1');

      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    it('should reactivate and recalculate next occurrence from today', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createRecurring()));

      await service.resumeRecurring('rec1');

      const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect(path).toBe('users/user123/recurring/rec1');
      const record = data as Record<string, unknown>;
      expect(record['isActive']).toBeTrue();
      expect(record['nextOccurrence']).toBeDefined();
    });

    // Resume deliberately does not reject a stored frequency the way create
    // and update do — the button has nowhere to show an error, and a rule
    // already saved with a bad interval has to stay recoverable. What it must
    // not do is hang while recalculating the pointer from today.
    it('resumes a rule whose stored frequency cannot advance without spinning', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
        createRecurring({ id: 'r1', frequency: { type: 'daily', interval: 0 } })
      ));

      await service.resumeRecurring('r1');

      const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect(path).toBe('users/user123/recurring/r1');
      const record = data as Record<string, unknown>;
      expect(record['isActive']).toBeTrue();
      expect(record['nextOccurrence']).toEqual(jasmine.any(Timestamp));
    });
  });

  describe('processRecurringTransactions', () => {
    it('should return empty array when not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      const result = await service.processRecurringTransactions();
      expect(result).toEqual([]);
    });

    it('should not process recurring transactions that are not yet due', async () => {
      const future = new Date(Date.now() + 10 * DAY);
      service.recurringTransactions.set([
        createRecurring({ nextOccurrence: Timestamp.fromDate(future) })
      ]);

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(mockFirestoreService.runTransaction).not.toHaveBeenCalled();
    });

    it('should post the occurrence due before a passed end date and then pause', async () => {
      const due = new Date(Date.now() - 5 * DAY);
      const ended = new Date(Date.now() - 1 * DAY);
      const rule = createRecurring({
        id: 'ended',
        nextOccurrence: Timestamp.fromDate(due),
        endDate: Timestamp.fromDate(ended)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      // The occurrence at `due` came due BEFORE the end date: it must post.
      expect(txSetPaths()).toEqual([
        `users/user123/transactions/rec-ended-${due.getTime()}`
      ]);
      const [ref, data] = txUpdate.calls.mostRecent().args;
      expect((ref as FakeDocRef).path).toBe('users/user123/recurring/ended');
      const record = data as Record<string, unknown>;
      expect(record['isActive']).toBeFalse();
      expect(record['nextOccurrence']).toBeDefined();
      expect(record['lastProcessed']).toBeDefined();
    });

    it('should post every occurrence up to the end date before pausing', async () => {
      // Weekly rule reopened long after its end date: the three occurrences
      // that fell before the end date must all post, then the rule pauses.
      const addDays = (date: Date, days: number): Date => {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
      };
      const first = new Date(Date.now() - 31 * DAY);
      const second = addDays(first, 7);
      const third = addDays(first, 14);
      const fourth = addDays(first, 21);
      const endDate = new Date(Date.now() - 12 * DAY);
      const rule = createRecurring({
        id: 'weekly1',
        frequency: { type: 'weekly', interval: 1 },
        nextOccurrence: Timestamp.fromDate(first),
        endDate: Timestamp.fromDate(endDate)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      expect(txSetPaths()).toEqual([
        `users/user123/transactions/rec-weekly1-${first.getTime()}`,
        `users/user123/transactions/rec-weekly1-${second.getTime()}`,
        `users/user123/transactions/rec-weekly1-${third.getTime()}`
      ]);
      const [, data] = txUpdate.calls.mostRecent().args;
      const record = data as { isActive: boolean; nextOccurrence: Timestamp };
      expect(record.isActive).toBeFalse();
      expect(record.nextOccurrence.toDate()).toEqual(fourth);
    });

    // The default stub never commits tx.update back to serverDocs, which is
    // fine for single-claim tests but would make a drain loop re-read the
    // unadvanced pointer forever. This variant commits updates and counts
    // occurrence writes per transaction, like the real server would.
    function installCommittingTransactionStub(): number[] {
      const setsPerClaim: number[] = [];
      mockFirestoreService.runTransaction.and.callFake(async updateFn => {
        const before = txSet.calls.count();
        const tx = {
          get: (ref: FakeDocRef) => {
            const doc = serverDocs.get(ref.path);
            return Promise.resolve({
              exists: () => doc !== undefined,
              id: ref.path.split('/').pop(),
              data: () => doc
            });
          },
          set: txSet,
          update: (ref: FakeDocRef, update: Record<string, unknown>) => {
            txUpdate(ref, update);
            const doc = serverDocs.get(ref.path);
            if (doc) {
              serverDocs.set(ref.path, { ...doc, ...update } as RecurringTransaction);
            }
          }
        };
        const result = await updateFn(tx as unknown as Parameters<typeof updateFn>[0]);
        setsPerClaim.push(txSet.calls.count() - before);
        return result;
      });
      return setsPerClaim;
    }

    it('drains a daily rule dormant for years across capped claims', async () => {
      const setsPerClaim = installCommittingTransactionStub();
      const start = new Date(Date.now() - 1500 * DAY);
      const rule = createRecurring({
        id: 'dormant',
        frequency: { type: 'daily', interval: 1 },
        nextOccurrence: Timestamp.fromDate(start)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      // No single transaction exceeded the write cap, and the backlog fully
      // drained in one catch-up run across successive claims.
      expect(setsPerClaim.every(n => n <= MAX_OCCURRENCES_PER_CLAIM)).toBeTrue();
      const total = txSetPaths().length;
      expect(total).toBeGreaterThanOrEqual(1500);
      expect(setsPerClaim.length).toBe(Math.ceil(total / MAX_OCCURRENCES_PER_CLAIM));

      // Deterministic ids and a monotonically advancing pointer: no
      // occurrence was posted twice across the claims.
      expect(new Set(txSetPaths()).size).toBe(total);

      // The committed pointer ends past now, so the next catch-up no-ops.
      const finalRule = serverDocs.get('users/user123/recurring/dormant')!;
      expect(finalRule.nextOccurrence.toDate().getTime()).toBeGreaterThan(Date.now());
      expect(finalRule.isActive).toBeTrue();
    });

    it('deactivates an ended rule only after its backlog drains', async () => {
      const setsPerClaim = installCommittingTransactionStub();
      const start = new Date(Date.now() - 900 * DAY);
      const ended = new Date(Date.now() - 1 * DAY);
      const rule = createRecurring({
        id: 'endedBacklog',
        frequency: { type: 'daily', interval: 1 },
        nextOccurrence: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(ended)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      // Deactivating on a capped batch would strand the rest of the backlog,
      // because catch-up only claims active rules: only the final, draining
      // claim may pause the rule.
      const deactivations = txUpdate.calls.allArgs()
        .filter(([, data]) => (data as Record<string, unknown>)['isActive'] === false);
      expect(setsPerClaim.length).toBeGreaterThan(1);
      expect(deactivations.length).toBe(1);
      const lastUpdate = txUpdate.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(lastUpdate['isActive']).toBeFalse();
      expect(serverDocs.get('users/user123/recurring/endedBacklog')!.isActive).toBeFalse();
    });

    it('should pause without posting when the rule came due only after its end date', async () => {
      const due = new Date(Date.now() - 5 * DAY);
      const ended = new Date(Date.now() - 7 * DAY);
      const rule = createRecurring({
        id: 'lateEnd',
        nextOccurrence: Timestamp.fromDate(due),
        endDate: Timestamp.fromDate(ended)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      const [, data] = txUpdate.calls.mostRecent().args;
      const record = data as Record<string, unknown>;
      expect(record['isActive']).toBeFalse();
      expect(record['nextOccurrence']).toBeUndefined();
    });

    it('should create a transaction and advance next occurrence for due recurring', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const createdTxn = { id: 'txn-id', amount: 5000 } as unknown as Transaction;
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createdTxn));

      const result = await service.processRecurringTransactions();

      expect(txSet).toHaveBeenCalledTimes(1);
      const doc = txSet.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(doc['isRecurring']).toBeTrue();
      expect(doc['recurringId']).toBe('due1');
      // The recurring doc is updated with new nextOccurrence + lastProcessed
      const [ref, data] = txUpdate.calls.mostRecent().args;
      expect((ref as FakeDocRef).path).toBe('users/user123/recurring/due1');
      expect((data as Record<string, unknown>)['nextOccurrence']).toBeDefined();
      expect((data as Record<string, unknown>)['lastProcessed']).toBeDefined();
      // The created transaction is fetched back and returned
      expect(mockFirestoreService.getDocument).toHaveBeenCalledWith(
        `users/user123/transactions/rec-due1-${due.getTime()}`
      );
      expect(result.length).toBe(1);
      expect(result[0]).toBe(createdTxn);
    });

    it('should build occurrence documents with the addTransaction shape', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({
        id: 'shape',
        type: 'expense',
        amount: 1200,
        currency: 'EUR',
        categoryId: 'housing_rent',
        description: 'Rent',
        nextOccurrence: Timestamp.fromDate(due)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);
      mockCurrencyService.getExchangeRate.and.returnValue(1.1);

      await service.processRecurringTransactions();

      const doc = txSet.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(doc['userId']).toBe('user123');
      expect(doc['type']).toBe('expense');
      expect(doc['amount']).toBe(1200);
      expect(doc['currency']).toBe('EUR');
      expect(mockCurrencyService.getExchangeRate).toHaveBeenCalledWith('EUR', 'USD');
      expect(doc['exchangeRate']).toBe(1.1);
      expect(doc['amountInBaseCurrency']).toBeCloseTo(1320, 5);
      expect(doc['categoryId']).toBe('housing_rent');
      expect(doc['description']).toBe('Rent');
      expect((doc['date'] as Timestamp).toDate()).toEqual(due);
      expect(doc['createdAt']).toBeDefined();
      expect(doc['updatedAt']).toBeDefined();
      expect(doc['isRecurring']).toBeTrue();
      expect(doc['recurringId']).toBe('shape');
    });

    it('should recalculate budgets for expense categories after claiming', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({
        id: 'exp1',
        type: 'expense',
        categoryId: 'food_groceries',
        nextOccurrence: Timestamp.fromDate(due)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      expect(mockBudgetService.recalculateBudgetsForCategory)
        .toHaveBeenCalledWith('food_groceries');
    });

    it('should not recalculate budgets for income rules', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'inc1', nextOccurrence: Timestamp.fromDate(due) });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      expect(txSet).toHaveBeenCalled();
      expect(mockBudgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
    });

    it('should skip pushing a created transaction that cannot be fetched back', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));

      const result = await service.processRecurringTransactions();

      expect(txSet).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should not touch the recurring document when nothing is due', async () => {
      const future = new Date(Date.now() + 10 * DAY);
      service.recurringTransactions.set([
        createRecurring({ nextOccurrence: Timestamp.fromDate(future) })
      ]);

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('should post exactly one occurrence with a deterministic id for one missed period', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'rec1', nextOccurrence: Timestamp.fromDate(due) });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      expect(txSet).toHaveBeenCalledTimes(1);
      expect(txSetPaths()).toEqual([
        `users/user123/transactions/rec-rec1-${due.getTime()}`
      ]);
      const doc = txSet.calls.mostRecent().args[1] as { date: Timestamp };
      expect(doc.date.toDate()).toEqual(due);

      expect(txUpdate).toHaveBeenCalledTimes(1);
      const [ref, data] = txUpdate.calls.mostRecent().args;
      expect((ref as FakeDocRef).path).toBe('users/user123/recurring/rec1');
      const record = data as { nextOccurrence: Timestamp; lastProcessed: Timestamp };
      expect(record.nextOccurrence.toDate().getTime()).toBeGreaterThan(Date.now());
      expect(record.lastProcessed).toBeDefined();
    });

    it('should post one transaction per missed period and advance the rule once atomically', async () => {
      const due = new Date(Date.now() - 2.5 * DAY);
      const second = new Date(due);
      second.setDate(second.getDate() + 1);
      const third = new Date(second);
      third.setDate(third.getDate() + 1);
      const createdTxn = { id: 'txn-id', amount: 5000 } as unknown as Transaction;
      const rule = createRecurring({
        id: 'daily1',
        frequency: { type: 'daily', interval: 1 },
        nextOccurrence: Timestamp.fromDate(due)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createdTxn));

      const result = await service.processRecurringTransactions();

      // 2.5 days late on a daily rule => the 3 occurrences at due, due+1d, due+2d
      expect(txSetPaths()).toEqual([
        `users/user123/transactions/rec-daily1-${due.getTime()}`,
        `users/user123/transactions/rec-daily1-${second.getTime()}`,
        `users/user123/transactions/rec-daily1-${third.getTime()}`
      ]);
      expect(result.length).toBe(3);

      // Posts and pointer advance happen in ONE server transaction: the same
      // transaction object receives all sets and the single rule update.
      expect(mockFirestoreService.runTransaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledTimes(1);
      const [ref, data] = txUpdate.calls.mostRecent().args;
      expect((ref as FakeDocRef).path).toBe('users/user123/recurring/daily1');
      const next = (data as { nextOccurrence: Timestamp }).nextOccurrence.toDate();
      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    // Catch-up walks the backlog with the same routine the preview does, so it
    // needs the same anchor. The rule below resumes from an occurrence that is
    // not on its start day, which is the only shape that tells a claim passing
    // the rule's start date apart from one passing the occurrence it stands on.
    it('claims a monthly rule with no target day back onto the 31st after February', async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 3, 15));
        const february = new Date(2026, 1, 28, 9);
        const march = new Date(2026, 2, 31, 9);
        const rule = createRecurring({
          id: 'anchored',
          frequency: { type: 'monthly', interval: 1 },
          startDate: Timestamp.fromDate(new Date(2026, 0, 31, 9)),
          nextOccurrence: Timestamp.fromDate(february)
        });
        service.recurringTransactions.set([rule]);
        seedServerRule(rule);

        await service.processRecurringTransactions();

        expect(txSetPaths()).toEqual([
          `users/user123/transactions/rec-anchored-${february.getTime()}`,
          `users/user123/transactions/rec-anchored-${march.getTime()}`
        ]);
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should post at most one occurrence when the frequency never advances', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({
        id: 'stuck',
        frequency: { type: 'daily', interval: 0 },
        nextOccurrence: Timestamp.fromDate(due)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      const result = await service.processRecurringTransactions();

      expect(txSet).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
    });

    // The interval never reaches the walk as a plain number here: it reaches
    // it as an Invalid Date, which loses every comparison it is given. The
    // pointer that comes out of that walk is the one the next run starts from,
    // so it has to be a date and not a hole.
    it('commits a real pointer when a stored frequency yields an invalid date', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({
        id: 'invalid',
        frequency: { type: 'daily', interval: NaN },
        nextOccurrence: Timestamp.fromDate(due)
      });
      service.recurringTransactions.set([rule]);
      seedServerRule(rule);

      await service.processRecurringTransactions();

      expect(txSet).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledTimes(1);
      const [, data] = txUpdate.calls.mostRecent().args;
      const record = data as { nextOccurrence: Timestamp };
      expect(record.nextOccurrence.toDate()).toEqual(due);
    });

    it('should no-op when a racing device already advanced the rule on the server', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      // The locally cached rule looks due, but the fresh server read inside
      // the claim transaction shows another device already processed it.
      service.recurringTransactions.set([
        createRecurring({ id: 'raced', nextOccurrence: Timestamp.fromDate(due) })
      ]);
      seedServerRule(createRecurring({
        id: 'raced',
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 27 * DAY))
      }));

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockBudgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
    });

    it('should no-op when the rule was paused on the server', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      service.recurringTransactions.set([
        createRecurring({ id: 'paused', nextOccurrence: Timestamp.fromDate(due) })
      ]);
      seedServerRule(createRecurring({
        id: 'paused',
        nextOccurrence: Timestamp.fromDate(due),
        isActive: false
      }));

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('should no-op when the rule was deleted on the server', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      service.recurringTransactions.set([
        createRecurring({ id: 'gone', nextOccurrence: Timestamp.fromDate(due) })
      ]);
      // Nothing seeded: the server copy no longer exists.

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('should skip silently when the claim transaction rejects (offline)', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      service.recurringTransactions.set([
        createRecurring({ id: 'offline1', nextOccurrence: Timestamp.fromDate(due) })
      ]);
      mockFirestoreService.runTransaction.and.callFake(() =>
        Promise.reject(new Error('unavailable: failed to get documents from server'))
      );

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(mockBudgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
      expect(service.isLoading()).toBeFalse();
    });

    it('should reset isLoading after completion', async () => {
      await service.processRecurringTransactions();
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('catchUpRecurringTransactions', () => {
    it('should resolve empty and touch nothing when not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      const result = await service.catchUpRecurringTransactions();

      expect(result).toEqual([]);
      expect(mockCurrencyService.ensureRatesLoaded).not.toHaveBeenCalled();
      expect(mockBudgetService.getBudgets).not.toHaveBeenCalled();
      expect(mockFirestoreService.subscribeToCollection).not.toHaveBeenCalled();
    });

    it('should load rates, budgets and fresh recurring rules before processing', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.subscribeToCollection.and.returnValue(of([rule]));
      seedServerRule(rule);

      await service.catchUpRecurringTransactions();

      expect(mockCurrencyService.ensureRatesLoaded).toHaveBeenCalled();
      expect(mockBudgetService.getBudgets).toHaveBeenCalled();
      expect(mockFirestoreService.subscribeToCollection).toHaveBeenCalledWith(
        'users/user123/recurring',
        { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] }
      );
      expect(txSet).toHaveBeenCalledTimes(1);
    });

    it('should share a single run between concurrent triggers', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.subscribeToCollection.and.returnValue(of([rule]));
      seedServerRule(rule);

      const first = service.catchUpRecurringTransactions();
      const second = service.catchUpRecurringTransactions();

      expect(second).toBe(first);
      await first;
      expect(mockFirestoreService.runTransaction).toHaveBeenCalledTimes(1);
      expect(txSet).toHaveBeenCalledTimes(1);
    });

    it('should post nothing on a repeated load once nextOccurrence has advanced', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.subscribeToCollection.and.returnValue(of([rule]));
      seedServerRule(rule);

      await service.catchUpRecurringTransactions();
      expect(txSet).toHaveBeenCalledTimes(1);

      // A fresh load now returns the advanced (future) nextOccurrence,
      // exactly as Firestore would after the first run persisted it.
      const advanced = createRecurring({
        id: 'due1',
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 27 * DAY))
      });
      mockFirestoreService.subscribeToCollection.and.returnValue(of([advanced]));
      seedServerRule(advanced);

      const result = await service.catchUpRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).toHaveBeenCalledTimes(1);
    });

    it('should not post from a stale snapshot when the server copy has advanced', async () => {
      // Device B cold-starts on a stale persistent cache that still lists the
      // rule as due, but device A already claimed it on the server.
      const due = new Date(Date.now() - 3 * DAY);
      mockFirestoreService.subscribeToCollection.and.returnValue(
        of([createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) })])
      );
      seedServerRule(createRecurring({
        id: 'due1',
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 27 * DAY))
      }));

      const result = await service.catchUpRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getNextOccurrences', () => {
    it('should skip inactive recurring transactions', (done) => {
      mockFirestoreService.subscribeToCollection.and.returnValue(of([
        createRecurring({ isActive: false, nextOccurrence: Timestamp.fromDate(new Date()) })
      ]));

      service.getNextOccurrences(30).subscribe(occurrences => {
        expect(occurrences).toEqual([]);
        done();
      });
    });

    it('should collect repeated occurrences within the window, sorted by date', (done) => {
      const start = new Date(Date.now() + 1 * DAY);
      mockFirestoreService.subscribeToCollection.and.returnValue(of([
        createRecurring({
          id: 'daily',
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(start)
        })
      ]));

      service.getNextOccurrences(5).subscribe(occurrences => {
        expect(occurrences.length).toBeGreaterThan(1);
        for (let i = 1; i < occurrences.length; i++) {
          expect(occurrences[i].date.getTime()).toBeGreaterThanOrEqual(occurrences[i - 1].date.getTime());
        }
        expect(occurrences[0].recurringId).toBe('daily');
        done();
      });
    });

    it('should stop collecting occurrences once past the end date', (done) => {
      const start = new Date(Date.now() + 1 * DAY);
      const endDate = new Date(Date.now() + 3 * DAY);
      mockFirestoreService.subscribeToCollection.and.returnValue(of([
        createRecurring({
          id: 'capped',
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(endDate)
        })
      ]));

      service.getNextOccurrences(30).subscribe(occurrences => {
        expect(occurrences.length).toBeGreaterThan(0);
        for (const occ of occurrences) {
          expect(occ.date.getTime()).toBeLessThanOrEqual(endDate.getTime());
        }
        done();
      });
    });

    /**
     * The sequence is the thing a day-31 rule breaks, and only a sequence shows
     * it: every individual date the old code produced was a real, in-range date
     * on the 31st. It was the months in between that went missing.
     *
     * `of()` makes the subscription synchronous, so the clock can be restored
     * in a finally rather than in a callback that a failure would skip.
     */
    const occurrencesFrom = (
      first: Date,
      frequency: RecurringFrequency,
      today: Date,
      days: number
    ): string[] => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(today);
        mockFirestoreService.subscribeToCollection.and.returnValue(of([
          createRecurring({
            id: 'anchored',
            frequency,
            // A rule's first occurrence is its start date, and the monthly and
            // yearly walks read their target day off that start. This helper
            // sets startDate to the same value as nextOccurrence explicitly,
            // so these specs pin that relationship themselves rather than
            // depending on how the fixture derives its own default.
            startDate: Timestamp.fromDate(first),
            nextOccurrence: Timestamp.fromDate(first)
          })
        ]));

        let keys: string[] = [];
        service.getNextOccurrences(days).subscribe(o => {
          keys = o.map(occ => dayKey(occ.date));
        });
        return keys;
      } finally {
        jasmine.clock().uninstall();
      }
    };

    it('posts a monthly rule on the 31st in the short months too', () => {
      // Advancing the month before clamping the day sent 31 Jan to 3 Mar, and
      // the clamp then read March's length: February was never scheduled.
      expect(occurrencesFrom(
        new Date(2027, 0, 31, 9),
        { type: 'monthly', interval: 1, dayOfMonth: 31 },
        new Date(2027, 0, 1),
        100
      )).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    });

    it('reaches 29 February in a leap year', () => {
      // 70 days runs to 11 March, so the window holds February's occurrence
      // and stops before March's.
      expect(occurrencesFrom(
        new Date(2028, 0, 31, 9),
        { type: 'monthly', interval: 1, dayOfMonth: 31 },
        new Date(2028, 0, 1),
        70
      )).toEqual(['2028-01-31', '2028-02-29']);
    });

    it('returns a monthly rule with no target day to the 31st after a short month', () => {
      // With no dayOfMonth the target day comes from the rule's start date, not
      // from whichever occurrence the walk is standing on. February's clamp is
      // therefore a detour rather than a new home: March is back on the 31st.
      expect(occurrencesFrom(
        new Date(2027, 0, 31, 9),
        { type: 'monthly', interval: 1 },
        new Date(2027, 0, 1),
        100
      )).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    });

    it('walks twelve months from 31 January without drifting', () => {
      // A full year of a rule that pays on the last day of the month: four
      // short months clamp on the way through and every 31-day month after
      // them recovers the 31st. A single clamped step never becomes the day
      // the rest of the year is measured from.
      expect(occurrencesFrom(
        new Date(2027, 0, 31, 9),
        { type: 'monthly', interval: 1 },
        new Date(2027, 0, 1),
        365
      )).toEqual([
        '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
        '2027-05-31', '2027-06-30', '2027-07-31', '2027-08-31',
        '2027-09-30', '2027-10-31', '2027-11-30', '2027-12-31'
      ]);
    });

    // The preview walks a rule forward one occurrence at a time until it
    // leaves the window. A frequency that hands back the date it was given
    // never leaves it, so the walk has to stop itself.
    it('stops collecting occurrences when the frequency cannot advance', () => {
      expect(occurrencesFrom(
        new Date(2027, 0, 10, 9),
        { type: 'daily', interval: 0 },
        new Date(2027, 0, 1),
        30
      )).toEqual(['2027-01-10']);
    });

    it('stops collecting when a negative interval walks backwards', () => {
      expect(occurrencesFrom(
        new Date(2027, 0, 10, 9),
        { type: 'daily', interval: -1 },
        new Date(2027, 0, 1),
        30
      )).toEqual(['2027-01-10']);
    });

    it('returns a yearly rule to 29 February once the leap year comes round', () => {
      // monthOfYear is deliberately unset: with it, the yearly branch happened
      // to re-land in the target month before clamping and looked correct.
      // The window runs to 2032 because the clamped 28ths in between prove
      // nothing on their own — only the return to the 29th shows each step is
      // measured from the rule's start date and not from its predecessor.
      expect(occurrencesFrom(
        new Date(2028, 1, 29, 9),
        { type: 'yearly', interval: 1 },
        new Date(2028, 0, 1),
        1550
      )).toEqual([
        '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'
      ]);
    });
  });

  describe('calculateNextOccurrence (via createRecurring)', () => {
    const captureNextOccurrence = (): Date => {
      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      return (data as { nextOccurrence: Timestamp }).nextOccurrence.toDate();
    };

    const baseDto: CreateRecurringDTO = {
      name: 'X',
      type: 'expense',
      amount: 1,
      currency: 'USD',
      categoryId: 'c',
      description: 'd',
      frequency: monthly,
      startDate: new Date(2024, 0, 1)
    };

    it('should return the start date unchanged when it is in the future', async () => {
      const future = new Date(Date.now() + 100 * DAY);
      await service.createRecurring({ ...baseDto, startDate: future });

      expect(captureNextOccurrence().getTime()).toBe(future.getTime());
    });

    it('should advance a past daily start into the future', async () => {
      const past = new Date(Date.now() - 100 * DAY);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'daily', interval: 1 }
      });

      expect(captureNextOccurrence().getTime()).toBeGreaterThan(Date.now());
    });

    it('should advance a past weekly start into the future', async () => {
      const past = new Date(Date.now() - 100 * DAY);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'weekly', interval: 2 }
      });

      expect(captureNextOccurrence().getTime()).toBeGreaterThan(Date.now());
    });

    it('should advance a past weekly start with a target day of week', async () => {
      const past = new Date(Date.now() - 100 * DAY);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'weekly', interval: 1, dayOfWeek: 3 }
      });

      expect(captureNextOccurrence().getTime()).toBeGreaterThan(Date.now());
    });

    it('should advance a past monthly start with a target day of month', async () => {
      const past = new Date(Date.now() - 400 * DAY);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 }
      });

      const next = captureNextOccurrence();
      expect(next.getTime()).toBeGreaterThan(Date.now());
      expect(next.getDate()).toBe(15);
    });

    it('should clamp a monthly day-of-month that exceeds the month length', async () => {
      // Start in late January, ask for the 31st → February clamps to 28/29.
      const past = new Date(2020, 0, 31);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'monthly', interval: 1, dayOfMonth: 31 }
      });

      const next = captureNextOccurrence();
      expect(next.getTime()).toBeGreaterThan(Date.now());
      // The day this lands on is the last day of whatever month it lands in,
      // never a day that month does not have. The assertion this replaces was
      // `getDate() <= 31`, which is true of every Date there is and so passed
      // for the whole time the rule was skipping five months a year.
      const lastDayOfItsMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      expect(next.getDate()).toBe(Math.min(31, lastDayOfItsMonth));
    });

    it('should advance a past yearly start with month and day targets', async () => {
      const past = new Date(2010, 0, 1);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'yearly', interval: 1, monthOfYear: 6, dayOfMonth: 10 }
      });

      const next = captureNextOccurrence();
      expect(next.getTime()).toBeGreaterThan(Date.now());
      expect(next.getMonth()).toBe(5); // June (0-based)
      expect(next.getDate()).toBe(10);
    });

    it('should advance a past yearly start without month/day targets', async () => {
      const past = new Date(2010, 3, 15);
      await service.createRecurring({
        ...baseDto,
        startDate: past,
        frequency: { type: 'yearly', interval: 1 }
      });

      expect(captureNextOccurrence().getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('getFrequencyText', () => {
    it('should render singular labels for interval 1', () => {
      expect(service.getFrequencyText({ type: 'daily', interval: 1 })).toBe('Daily');
      expect(service.getFrequencyText({ type: 'weekly', interval: 1 })).toBe('Weekly');
      expect(service.getFrequencyText({ type: 'monthly', interval: 1 })).toBe('Monthly');
      expect(service.getFrequencyText({ type: 'yearly', interval: 1 })).toBe('Yearly');
    });

    it('should render plural "Every N" labels for interval > 1', () => {
      expect(service.getFrequencyText({ type: 'daily', interval: 3 })).toBe('Every 3 days');
      expect(service.getFrequencyText({ type: 'weekly', interval: 2 })).toBe('Every 2 weeks');
      expect(service.getFrequencyText({ type: 'monthly', interval: 4 })).toBe('Every 4 months');
      expect(service.getFrequencyText({ type: 'yearly', interval: 5 })).toBe('Every 5 years');
    });

    it('should fall back to "Custom" for an unknown frequency type', () => {
      expect(service.getFrequencyText({ type: 'unknown' as 'daily', interval: 1 })).toBe('Custom');
    });
  });
});
