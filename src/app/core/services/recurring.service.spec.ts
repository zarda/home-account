import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp, FieldValue, deleteField } from '@angular/fire/firestore';
import { of } from 'rxjs';
import {
  RecurringService,
  MAX_OCCURRENCES_PER_CLAIM,
  INVALID_FREQUENCY_ERROR,
  UNREADABLE_SCHEDULE_ERROR,
  RULE_ENDED_ERROR,
  recurringPostingId
} from './recurring.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { findSerializationIssues } from '../utils/firestore-value.utils';
import { addDays, dayKey, startOfDay } from '../utils/transaction-date.utils';
import { isSeed, opaqueRowId } from '../utils/opaque-id.utils';
import {
  RecurringTransaction,
  RecurringFrequency,
  CreateRecurringDTO,
  RecurringOccurrence,
  Transaction,
  UpcomingSchedule
} from '../../models';

describe('RecurringService', () => {
  let service: RecurringService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockBudgetService: jasmine.SpyObj<BudgetService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

  const DAY = 24 * 60 * 60 * 1000;

  const monthly: RecurringFrequency = { type: 'monthly', interval: 1 };
  // 32 lower-case hex characters, a salt the claim keeps. Anything else it
  // replaces with a fresh draw, and no spec could name the ids that follow.
  const FIXTURE_SALT = '00112233445566778899aabbccddeeff';

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
      // Before the overrides, so { salt: undefined } is a rule written before
      // rules held a salt.
      salt: FIXTURE_SALT,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides
    };
  };

  // Firestore-transaction stub: getDocRef returns path-carrying refs and
  // runTransaction hands the callback a tx whose get() serves docs from
  // serverDocs, mirroring the fresh server read of a real transaction. Like
  // the SDK's, that tx refuses a read once it has written.
  interface FakeDocRef { path: string }
  let serverDocs: Map<string, RecurringTransaction>;
  // Every other document a claim may read: a posted occurrence, a history
  // line. serverDocs keeps the rules, typed as rules, so a spec that reads a
  // rule back needs no cast.
  let serverRows: Map<string, unknown>;
  // The path of every read a transaction was served, across all of them.
  let txGetPaths: string[];
  let txSet: jasmine.Spy;
  let txUpdate: jasmine.Spy;

  const seedServerRule = (rule: RecurringTransaction): void => {
    serverDocs.set(`users/user123/recurring/${rule.id}`, rule);
  };

  const seedServerDoc = (path: string, data: unknown): void => {
    serverRows.set(path, data);
  };

  const READ_AFTER_WRITE_ERROR =
    'Firestore transactions require all reads to be executed before all writes.';

  /**
   * The tx one runTransaction call hands its callback. The SDK rejects a read
   * issued after a write, so a claim that wrote before it read would fail
   * against the server and pass against a fake that allowed it. `written`
   * lives here, one per call, and is never derived from the shared txSet and
   * txUpdate spies: a drain runs several claims, and a later claim's first read
   * must not see an earlier claim's writes. `commit` is how a stub writes an
   * update back into serverDocs.
   */
  const newTransaction = (commit?: (ref: FakeDocRef, update: Record<string, unknown>) => void) => {
    let written = false;
    return {
      get: (ref: FakeDocRef) => {
        if (written) {
          return Promise.reject(new Error(READ_AFTER_WRITE_ERROR));
        }
        txGetPaths.push(ref.path);
        const doc = (serverDocs.get(ref.path) ?? serverRows.get(ref.path)) as
          RecurringTransaction | undefined;
        return Promise.resolve({
          exists: () => doc !== undefined,
          id: ref.path.split('/').pop(),
          data: () => doc
        });
      },
      set: (...args: unknown[]) => {
        written = true;
        return txSet(...args);
      },
      update: (ref: FakeDocRef, update: Record<string, unknown>) => {
        written = true;
        txUpdate(ref, update);
        commit?.(ref, update);
      }
    };
  };

  const txSetPaths = (): string[] =>
    txSet.calls.allArgs().map(args => (args[0] as FakeDocRef).path);

  /**
   * Where a claim posts the occurrence of `ruleId` falling due at `when`, keyed
   * by the salt the rule holds. Every fixture rule holds FIXTURE_SALT.
   */
  const occurrencePath = async (
    ruleId: string,
    when: Date,
    salt: string = FIXTURE_SALT
  ): Promise<string> =>
    `users/user123/transactions/${await recurringPostingId({ id: ruleId, salt }, when.getTime())}`;

  /** Where a build before the salt posted the same occurrence: a digest with no key. */
  const unsaltedOccurrencePath = async (ruleId: string, when: Date): Promise<string> =>
    `users/user123/transactions/${await opaqueRowId('rec', ruleId, when.getTime())}`;

  /** Where an older build posted the same occurrence: the rule and the time, in clear. */
  const legacyOccurrencePath = (ruleId: string, when: Date): string =>
    `users/user123/transactions/rec-${ruleId}-${when.getTime()}`;

  /**
   * Every read a claim of a rule stalled on `when` is served, in order: the
   * rule, then each id the stuck occurrence may already stand under. A rule
   * holding a well-formed salt adds the salted id to the two older ones.
   */
  const stalledReads = async (ruleId: string, when: Date, salt?: string): Promise<string[]> => [
    `users/user123/recurring/${ruleId}`,
    legacyOccurrencePath(ruleId, when),
    await unsaltedOccurrencePath(ruleId, when),
    ...(salt === undefined ? [] : [await occurrencePath(ruleId, when, salt)])
  ];

  const installTransactionStub = (): void => {
    serverDocs = new Map();
    serverRows = new Map();
    txGetPaths = [];
    txSet = jasmine.createSpy('tx.set');
    txUpdate = jasmine.createSpy('tx.update');

    mockFirestoreService.getDocRef.and.callFake(
      ((path: string) => ({ path })) as unknown as FirestoreService['getDocRef']
    );
    mockFirestoreService.runTransaction.and.callFake(updateFn => {
      const tx = newTransaction();
      return updateFn(tx as unknown as Parameters<typeof updateFn>[0]);
    });
  };

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'subscribeToDocument',
      'addDocument',
      'setDocument',
      'updateDocument',
      'deleteDocument',
      'getDocument',
      'getCollection',
      'getCollectionFromServer',
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
    mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([]));
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

    it('stores the reminder lead time when one is set', async () => {
      await service.createRecurring({ ...dto, remindDaysBefore: 3 });

      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['remindDaysBefore']).toBe(3);
    });

    it('writes no reminder lead time when none is set', async () => {
      await service.createRecurring(dto);

      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect('remindDaysBefore' in (data as Record<string, unknown>)).toBeFalse();
    });

    // Zero is "remind me on the day", not "no reminder". The truthiness
    // spread the end date uses reads it as the second and drops it, which is
    // exactly the lead time a bill due today needs.
    it('stores a zero reminder lead time', async () => {
      await service.createRecurring({ ...dto, remindDaysBefore: 0 });

      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['remindDaysBefore']).toBe(0);
    });

    it('should reset isLoading after completion', async () => {
      await service.createRecurring(dto);
      expect(service.isLoading()).toBeFalse();
    });

    // #486: the salt keys the ids a rule's postings take, so every new rule
    // holds one from its first write, on whichever path writes it.
    describe('the salt', () => {
      const HANDED = '0123456789abcdef0123456789abcdef';

      it('gives a rule written by addDocument a seed', async () => {
        await service.createRecurring(dto);

        const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
        expect(isSeed((data as Record<string, unknown>)['salt'])).toBeTrue();
      });

      it('gives a rule written at a chosen id a seed', async () => {
        await service.createRecurring(dto, { id: 'chosen' });

        const [path, data] = mockFirestoreService.setDocument.calls.mostRecent().args;
        expect(path).toBe('users/user123/recurring/chosen');
        expect(isSeed((data as Record<string, unknown>)['salt'])).toBeTrue();
      });

      it('draws a different seed for each rule', async () => {
        await service.createRecurring(dto);
        await service.createRecurring(dto);

        const salts = mockFirestoreService.addDocument.calls.allArgs()
          .map(args => (args[1] as Record<string, unknown>)['salt']);
        expect(salts.length).toBe(2);
        expect(salts[0]).not.toBe(salts[1]);
      });

      it('keeps a well-formed salt it is handed', async () => {
        await service.createRecurring(dto, { id: 'chosen', salt: HANDED });

        const [, data] = mockFirestoreService.setDocument.calls.mostRecent().args;
        expect((data as Record<string, unknown>)['salt']).toBe(HANDED);
      });

      it('keeps a well-formed salt it is handed on the addDocument path', async () => {
        await service.createRecurring(dto, { salt: HANDED });

        const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
        expect((data as Record<string, unknown>)['salt']).toBe(HANDED);
      });

      for (const [label, bad] of [
        ['an upper-case one', HANDED.toUpperCase()],
        ['a short one', 'abc123'],
        ['an empty one', ''],
        ['one with a non-hex character', 'g'.repeat(32)]
      ] as const) {
        it(`replaces ${label} with a fresh seed`, async () => {
          await service.createRecurring(dto, { id: 'chosen', salt: bad });

          const [, data] = mockFirestoreService.setDocument.calls.mostRecent().args;
          const salt = (data as Record<string, unknown>)['salt'];
          expect(isSeed(salt)).toBeTrue();
          expect(salt).not.toBe(bad);
        });
      }
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

    it('should map a reminder lead time when provided', async () => {
      await service.updateRecurring('rec1', { remindDaysBefore: 7 });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['remindDaysBefore']).toBe(7);
    });

    it('should map a zero reminder lead time', async () => {
      await service.updateRecurring('rec1', { remindDaysBefore: 0 });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['remindDaysBefore']).toBe(0);
    });

    it('should delete the stored reminder lead time when remindDaysBefore is null', async () => {
      await service.updateRecurring('rec1', { remindDaysBefore: null });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      const lead = (data as Record<string, unknown>)['remindDaysBefore'] as FieldValue;
      expect(lead).toBeDefined();
      expect(lead.isEqual(deleteField())).toBeTrue();
    });

    it('should leave the stored reminder lead time alone when it is not supplied', async () => {
      await service.updateRecurring('rec1', { name: 'New name' });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect('remindDaysBefore' in (data as Record<string, unknown>)).toBeFalse();
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

    it("drops the stored dayOfMonth when the update's frequency omits it", async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 19));
        const current = createRecurring({
          startDate: Timestamp.fromDate(new Date(2024, 0, 20)),
          nextOccurrence: Timestamp.fromDate(new Date(2024, 0, 20)),
          frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 }
        });
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(current));

        await service.updateRecurring('rec1', { frequency: { type: 'monthly', interval: 1 } });

        const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
        const record = data as Record<string, unknown>;
        expect(record['frequency']).toEqual({ type: 'monthly', interval: 1 });
        // The dropped dayOfMonth must not linger: the recompute lands on the
        // start's own day (the 20th), not the discarded 15th.
        expect((record['nextOccurrence'] as Timestamp).toDate()).toEqual(new Date(2026, 8, 20));
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('recalculates from a submitted start date on a rule whose stored start cannot be read', async () => {
      // A submitted startDate is the repair itself, so it must not be
      // refused for the unreadable value it is about to overwrite.
      spyOn(console, 'warn');
      const unreadable = { toDate: () => new Date(NaN) } as unknown as Timestamp;
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
        createRecurring({ startDate: unreadable })
      ));

      await service.updateRecurring('rec1', { startDate: new Date(2024, 6, 1) });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      const record = data as Record<string, unknown>;
      expect((record['startDate'] as Timestamp).toDate()).toEqual(new Date(2024, 6, 1));
      expect(record['nextOccurrence']).toBeDefined();
    });

    it('rejects a recalculation when the stored start date cannot be read and none is submitted', async () => {
      spyOn(console, 'warn');
      const unreadable = { toDate: () => new Date(NaN) } as unknown as Timestamp;
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
        createRecurring({ startDate: unreadable })
      ));

      await expectAsync(
        service.updateRecurring('rec1', { frequency: { type: 'monthly', interval: 2 } })
      ).toBeRejectedWithError(UNREADABLE_SCHEDULE_ERROR);

      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
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

    it('refuses to resume a rule whose interval cannot advance', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
        createRecurring({ id: 'r1', frequency: { type: 'daily', interval: 0 } })
      ));

      await expectAsync(service.resumeRecurring('r1')).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    it('refuses to resume a rule whose interval is not finite', async () => {
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
        createRecurring({ id: 'r1', frequency: { type: 'daily', interval: NaN } })
      ));

      await expectAsync(service.resumeRecurring('r1')).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    it('refuses to resume a rule whose frequency type cannot advance', async () => {
      // validateFrequency only checks the interval; a type outside the four
      // known kinds is the other way a stored frequency can never advance,
      // and it slips past that guard.
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 19));
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
          createRecurring({
            id: 'r1',
            frequency: { type: 'fortnightly' as never, interval: 1 },
            startDate: Timestamp.fromDate(new Date(2024, 0, 15))
          })
        ));

        await expectAsync(service.resumeRecurring('r1')).toBeRejectedWithError(INVALID_FREQUENCY_ERROR);

        expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it("anchors the resumed pointer on the rule's start date, not today", async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 19));
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
          createRecurring({
            id: 'r1',
            frequency: { type: 'monthly', interval: 1 },
            startDate: Timestamp.fromDate(new Date(2024, 0, 15))
          })
        ));

        await service.resumeRecurring('r1');

        const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
        expect(path).toBe('users/user123/recurring/r1');
        const record = data as Record<string, unknown>;
        expect(record['isActive']).toBeTrue();
        expect((record['nextOccurrence'] as Timestamp).toDate()).toEqual(new Date(2026, 9, 15));
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('resumes a rule whose start is in the future onto the start', async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 19));
        const futureStart = new Date(2027, 0, 1);
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
          createRecurring({
            id: 'r1',
            frequency: { type: 'monthly', interval: 1 },
            startDate: Timestamp.fromDate(futureStart)
          })
        ));

        await service.resumeRecurring('r1');

        const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
        const record = data as Record<string, unknown>;
        expect((record['nextOccurrence'] as Timestamp).toDate()).toEqual(futureStart);
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it("clamps the day the rule names to the month's last day", async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 19));
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
          createRecurring({
            id: 'r1',
            frequency: { type: 'monthly', interval: 1, dayOfMonth: 31 },
            startDate: Timestamp.fromDate(new Date(2024, 0, 31))
          })
        ));

        await service.resumeRecurring('r1');

        const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
        const record = data as Record<string, unknown>;
        expect((record['nextOccurrence'] as Timestamp).toDate()).toEqual(new Date(2026, 8, 30));
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('refuses to resume a rule it cannot read', async () => {
      spyOn(console, 'warn');
      const unreadable = { toDate: () => new Date(NaN) } as unknown as Timestamp;
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
        createRecurring({ id: 'r1', startDate: unreadable })
      ));

      await expectAsync(service.resumeRecurring('r1')).toBeRejectedWithError(UNREADABLE_SCHEDULE_ERROR);

      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
    });

    it('refuses to resume a rule whose end date has passed', async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 20));
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
          createRecurring({
            id: 'r1',
            frequency: { type: 'monthly', interval: 1, dayOfMonth: 6 },
            startDate: Timestamp.fromDate(new Date(2026, 0, 5)),
            endDate: Timestamp.fromDate(new Date(2026, 2, 18))
          })
        ));

        await expectAsync(service.resumeRecurring('r1')).toBeRejectedWithError(RULE_ENDED_ERROR);

        expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('resumes a rule whose end date is still ahead', async () => {
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(new Date(2026, 8, 20));
        mockFirestoreService.getDocument.and.returnValue(Promise.resolve(
          createRecurring({
            id: 'r1',
            frequency: { type: 'monthly', interval: 1, dayOfMonth: 6 },
            startDate: Timestamp.fromDate(new Date(2026, 0, 5)),
            endDate: Timestamp.fromDate(new Date(2027, 0, 1))
          })
        ));

        await service.resumeRecurring('r1');

        const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
        expect(path).toBe('users/user123/recurring/r1');
        const record = data as Record<string, unknown>;
        expect(record['isActive']).toBeTrue();
        expect((record['nextOccurrence'] as Timestamp).toDate()).toEqual(new Date(2026, 9, 6));
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  // #486: the id a posting takes. The known answer is the salted pin in
  // opaque-id.utils.spec.ts, so the argument order is checked here too.
  describe('recurringPostingId', () => {
    it('keys the digest by the rule\'s salt, a key no call site can leave out', async () => {
      expect(await recurringPostingId({ id: 'rule1', salt: FIXTURE_SALT }, 1))
        .toBe('e3e86f902d84ead0754cf709449f6596');
      // @ts-expect-error salt is a required key, so a call site cannot reach the unsalted digest by omission
      await recurringPostingId({ id: 'rule1' }, 1);
    });
  });

  // The real SDK rejects a read issued after a write in the same transaction.
  // A fake that allowed it would let a claim read in the wrong place and still
  // pass every unit case, so the fakes enforce the order themselves. These
  // cases drive the stub directly, with no claim in between.
  describe('the claim transaction stub', () => {
    const READ_AFTER_WRITE =
      'Firestore transactions require all reads to be executed before all writes.';
    const rowPath = 'users/user123/transactions/seeded';

    it('refuses a read after a write in one transaction, with the SDK message', async () => {
      seedServerDoc(rowPath, { amount: 1 });
      const ref = mockFirestoreService.getDocRef(rowPath);

      await expectAsync(
        mockFirestoreService.runTransaction(async tx => {
          tx.set(ref, { amount: 2 });
          await tx.get(ref);
        })
      ).toBeRejectedWithError(READ_AFTER_WRITE);

      // The write did go through the stub and the refused read was not served,
      // so the rejection came from the ordering and from nothing else.
      expect(txSet).toHaveBeenCalledTimes(1);
      expect(txGetPaths).toEqual([]);
    });

    it('lets a second transaction read after the first wrote', async () => {
      seedServerDoc(rowPath, { amount: 1 });
      const ref = mockFirestoreService.getDocRef(rowPath);

      await expectAsync(
        mockFirestoreService.runTransaction(async tx => {
          tx.set(ref, { amount: 2 });
          await tx.get(ref);
        })
      ).toBeRejectedWithError(READ_AFTER_WRITE);

      // txSet has been called by now. The order is a property of one
      // transaction and not of the shared spies, or this read would be
      // refused and a multi-claim drain would swallow it as offline.
      const seen = await mockFirestoreService.runTransaction(async tx => (await tx.get(ref)).exists());

      expect(seen).toBeTrue();
      expect(txGetPaths).toEqual([rowPath]);
    });

    it('serves a rule from serverDocs and any other path from serverRows', async () => {
      seedServerRule(createRecurring({ id: 'ruleA' }));
      seedServerDoc(rowPath, { amount: 1 });
      const rulePath = 'users/user123/recurring/ruleA';

      const seen = await mockFirestoreService.runTransaction(async tx => [
        (await tx.get(mockFirestoreService.getDocRef(rulePath))).exists(),
        (await tx.get(mockFirestoreService.getDocRef(rowPath))).exists(),
        (await tx.get(mockFirestoreService.getDocRef('users/user123/transactions/absent'))).exists()
      ]);

      expect(seen).toEqual([true, true, false]);
      expect(txGetPaths).toEqual([rulePath, rowPath, 'users/user123/transactions/absent']);
    });
  });

  describe('processRecurringTransactions', () => {
    it('should return empty array when not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      const result = await service.processRecurringTransactions([]);
      expect(result).toEqual([]);
    });

    it('should not process recurring transactions that are not yet due', async () => {
      const future = new Date(Date.now() + 10 * DAY);
      const rules = [
        createRecurring({ nextOccurrence: Timestamp.fromDate(future) })
      ];

      const result = await service.processRecurringTransactions(rules);

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
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      // The occurrence at `due` came due BEFORE the end date: it must post.
      expect(txSetPaths()).toEqual([await occurrencePath('ended', due)]);
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
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      expect(txSetPaths()).toEqual([
        await occurrencePath('weekly1', first),
        await occurrencePath('weekly1', second),
        await occurrencePath('weekly1', third)
      ]);
      const [, data] = txUpdate.calls.mostRecent().args;
      const record = data as { isActive: boolean; nextOccurrence: Timestamp };
      expect(record.isActive).toBeFalse();
      expect(record.nextOccurrence.toDate()).toEqual(fourth);
    });

    // The default stub never commits tx.update back to serverDocs, which is
    // fine for single-claim tests but would make a drain loop re-read the
    // unadvanced pointer forever. This variant commits updates and counts
    // occurrence writes per transaction, like the real server would. Updates
    // are buffered and committed only when the callback resolves: like the
    // SDK, a rejected callback commits nothing.
    function installCommittingTransactionStub(): number[] {
      const setsPerClaim: number[] = [];
      mockFirestoreService.runTransaction.and.callFake(async updateFn => {
        const before = txSet.calls.count();
        const pending: [FakeDocRef, Record<string, unknown>][] = [];
        const tx = newTransaction((ref, update) => {
          pending.push([ref, update]);
        });
        const result = await updateFn(tx as unknown as Parameters<typeof updateFn>[0]);
        for (const [ref, update] of pending) {
          const doc = serverDocs.get(ref.path);
          if (doc) {
            serverDocs.set(ref.path, { ...doc, ...update } as RecurringTransaction);
          }
        }
        setsPerClaim.push(txSet.calls.count() - before);
        return result;
      });
      return setsPerClaim;
    }

    it('the committing stub refuses a read after a write too, and a later transaction reads', async () => {
      installCommittingTransactionStub();
      seedServerRule(createRecurring({ id: 'ordered' }));
      const path = 'users/user123/recurring/ordered';
      const ref = mockFirestoreService.getDocRef(path);

      await expectAsync(
        mockFirestoreService.runTransaction(async tx => {
          tx.update(ref, { isActive: false });
          await tx.get(ref);
        })
      ).toBeRejectedWithError(
        'Firestore transactions require all reads to be executed before all writes.'
      );

      // The update reached the stub, but the rejected transaction committed
      // nothing: the next transaction reads the rule unchanged, and its read
      // succeeds, so the flag is per transaction here as well.
      expect(txUpdate).toHaveBeenCalledTimes(1);
      const seen = await mockFirestoreService.runTransaction(async tx => (await tx.get(ref)).data());
      expect((seen as RecurringTransaction).isActive).toBeTrue();
      expect(txGetPaths).toEqual([path]);
    });

    it('drains a daily rule dormant for years across capped claims', async () => {
      const setsPerClaim = installCommittingTransactionStub();
      const start = new Date(Date.now() - 1500 * DAY);
      const rule = createRecurring({
        id: 'dormant',
        frequency: { type: 'daily', interval: 1 },
        nextOccurrence: Timestamp.fromDate(start)
      });
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      // No single transaction exceeded the write cap, and the backlog fully
      // drained in one catch-up run across successive claims.
      expect(setsPerClaim.every(n => n <= MAX_OCCURRENCES_PER_CLAIM)).toBeTrue();
      const total = txSetPaths().length;
      expect(total).toBeGreaterThanOrEqual(1500);
      expect(setsPerClaim.length).toBe(Math.ceil(total / MAX_OCCURRENCES_PER_CLAIM));

      // Deterministic ids and a monotonically advancing pointer: no
      // occurrence was posted twice across the claims.
      expect(new Set(txSetPaths()).size).toBe(total);

      // Pin: the cap ends each walk on its count and not on a stall, so no claim
      // looked up an earlier row; every read was the rule's.
      expect(txGetPaths.length).toBe(setsPerClaim.length);
      expect(txGetPaths.every(path => path === 'users/user123/recurring/dormant')).toBeTrue();

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
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

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
      seedServerRule(rule);

      const result = await service.processRecurringTransactions([rule]);

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
      seedServerRule(rule);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createdTxn));

      const result = await service.processRecurringTransactions([rule]);

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
        await occurrencePath('due1', due)
      );
      expect(result.length).toBe(1);
      expect(result[0]).toBe(createdTxn);
      // A readable pointer is claimed on the server, never repaired.
      expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
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
      seedServerRule(rule);
      mockCurrencyService.getExchangeRate.and.returnValue(1.1);

      await service.processRecurringTransactions([rule]);

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
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      expect(mockBudgetService.recalculateBudgetsForCategory)
        .toHaveBeenCalledWith('food_groceries');
    });

    it('should not recalculate budgets for income rules', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'inc1', nextOccurrence: Timestamp.fromDate(due) });
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      expect(txSet).toHaveBeenCalled();
      expect(mockBudgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
    });

    it('should skip pushing a created transaction that cannot be fetched back', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      seedServerRule(rule);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));

      const result = await service.processRecurringTransactions([rule]);

      expect(txSet).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should not touch the recurring document when nothing is due', async () => {
      const future = new Date(Date.now() + 10 * DAY);
      const rules = [
        createRecurring({ nextOccurrence: Timestamp.fromDate(future) })
      ];

      const result = await service.processRecurringTransactions(rules);

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('should post exactly one occurrence with a deterministic id for one missed period', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'rec1', nextOccurrence: Timestamp.fromDate(due) });
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      expect(txSet).toHaveBeenCalledTimes(1);
      expect(txSetPaths()).toEqual([await occurrencePath('rec1', due)]);
      const doc = txSet.calls.mostRecent().args[1] as { date: Timestamp };
      expect(doc.date.toDate()).toEqual(due);

      expect(txUpdate).toHaveBeenCalledTimes(1);
      const [ref, data] = txUpdate.calls.mostRecent().args;
      expect((ref as FakeDocRef).path).toBe('users/user123/recurring/rec1');
      const record = data as { nextOccurrence: Timestamp; lastProcessed: Timestamp };
      expect(record.nextOccurrence.toDate().getTime()).toBeGreaterThan(Date.now());
      expect(record.lastProcessed).toBeDefined();
    });

    // A shared row's household copy carries the row's id, so the id must not
    // tell a member which rule posted it or when it fell due (#466), nor be
    // one a member who has seen the rule's id can rebuild from the copy's date
    // (#486).
    it('posts at an opaque id that names neither the rule nor the due time, the same on every claim', async () => {
      installCommittingTransactionStub();
      const due = new Date(Date.now() - 3 * DAY);
      const rulePath = 'users/user123/recurring/rent-rule';
      const rule = createRecurring({
        id: 'rent-rule',
        nextOccurrence: Timestamp.fromDate(due),
        salt: undefined
      });
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

      // The first claim drew the rule a salt and committed it with the pointer.
      const committed = serverDocs.get(rulePath)!.salt as string;
      expect(isSeed(committed)).toBeTrue();

      // Put the pointer back and keep the salt, as a retried or racing claim
      // finds the rule. Without this the second claim reads the advanced
      // pointer and answers null.
      serverDocs.set(rulePath, {
        ...serverDocs.get(rulePath)!,
        nextOccurrence: Timestamp.fromDate(due)
      });

      await service.processRecurringTransactions([rule]);

      const ids = txSetPaths().map(path => path.split('/').pop()!);
      expect(ids.length).toBe(2);
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe(await recurringPostingId({ id: 'rent-rule', salt: committed }, due.getTime()));
      expect(ids[0]).not.toBe(await opaqueRowId('rec', 'rent-rule', due.getTime()));
      // The salt is written once, by the claim that drew it.
      const updates = txUpdate.calls.allArgs().map(args => args[1] as Record<string, unknown>);
      expect(updates.length).toBe(2);
      expect(updates[0]['salt']).toBe(committed);
      expect('salt' in updates[1]).toBeFalse();
      expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
      expect(ids[0]).not.toContain('rent-rule');
      expect(ids[0]).not.toContain(String(due.getTime()));
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
      seedServerRule(rule);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createdTxn));

      const result = await service.processRecurringTransactions([rule]);

      // 2.5 days late on a daily rule => the 3 occurrences at due, due+1d, due+2d
      expect(txSetPaths()).toEqual([
        await occurrencePath('daily1', due),
        await occurrencePath('daily1', second),
        await occurrencePath('daily1', third)
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
        seedServerRule(rule);

        await service.processRecurringTransactions([rule]);

        expect(txSetPaths()).toEqual([
          await occurrencePath('anchored', february),
          await occurrencePath('anchored', march)
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
      seedServerRule(rule);

      const result = await service.processRecurringTransactions([rule]);

      expect(txSet).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
      // The stuck date is looked up at every id it may already stand under,
      // after the rule is read and before anything is written.
      expect(txGetPaths).toEqual(await stalledReads('stuck', due, FIXTURE_SALT));
    });

    describe('a rule whose walk cannot advance', () => {
      const rulePath = (id: string): string => `users/user123/recurring/${id}`;
      const lastClaim = () => mockFirestoreService.runTransaction.calls.mostRecent().returnValue;

      const stuckRule = (id: string, due: Date, overrides: Partial<RecurringTransaction> = {}) =>
        createRecurring({
          id,
          frequency: { type: 'daily', interval: 0 },
          nextOccurrence: Timestamp.fromDate(due),
          ...overrides
        });

      // A rule stalled on its second step: the walk posts 1 March, steps to 21
      // March, and finds the step after that lands on 21 March again. Interval
      // 1 and a now past 21 March are what end the walk on the break and not on
      // the date it is posting until.
      const march = new Date(2026, 2, 1, 9);
      const twentyFirst = new Date(2026, 2, 21, 9);
      const advancingRule = () =>
        createRecurring({
          id: 'adv',
          frequency: { type: 'monthly', interval: 1, dayOfMonth: -10 },
          startDate: Timestamp.fromDate(march),
          nextOccurrence: Timestamp.fromDate(march)
        });

      const withAprilNow = async (run: () => Promise<void>): Promise<void> => {
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(new Date(2026, 3, 15));
          await run();
        } finally {
          jasmine.clock().uninstall();
        }
      };

      it('skips an occurrence already posted at its earlier id', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due);
        seedServerRule(rule);
        seedServerDoc(legacyOccurrencePath('stuck', due), {});

        const result = await service.processRecurringTransactions([rule]);

        // A skip behind the claim's swallowing catch looks the same as a claim
        // that threw, so the claim's own answer and the reads it was served
        // prove it ran and found the row.
        await expectAsync(lastClaim()).toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
        expect(txGetPaths).toEqual(await stalledReads('stuck', due, FIXTURE_SALT));
        expect(txSet).not.toHaveBeenCalled();
        expect(txUpdate).not.toHaveBeenCalled();
        expect(result).toEqual([]);
      });

      it('skips an occurrence already posted at the unsalted digest', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due);
        seedServerRule(rule);
        seedServerDoc(await unsaltedOccurrencePath('stuck', due), {});

        const result = await service.processRecurringTransactions([rule]);

        await expectAsync(lastClaim()).toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
        expect(txGetPaths).toEqual(await stalledReads('stuck', due, FIXTURE_SALT));
        expect(txSet).not.toHaveBeenCalled();
        expect(txUpdate).not.toHaveBeenCalled();
        expect(result).toEqual([]);
      });

      // #486: a rule holding a salt posted its stuck date under the salted id,
      // so that is a third place the date may already stand.
      it('skips an occurrence already posted at its salted id, after three distinct lookups', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due);
        seedServerRule(rule);
        seedServerDoc(await occurrencePath('stuck', due), {});

        const result = await service.processRecurringTransactions([rule]);

        await expectAsync(lastClaim()).toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
        expect(txGetPaths).toEqual(await stalledReads('stuck', due, FIXTURE_SALT));
        expect(new Set(txGetPaths.slice(1)).size).toBe(3);
        expect(txSet).not.toHaveBeenCalled();
        expect(txUpdate).not.toHaveBeenCalled();
        expect(result).toEqual([]);
      });

      // Pin: a claim that posts nothing writes nothing, a drawn salt included.
      // A saltless rule keeps no salt until something posts under one.
      it('writes no salt to a saltless rule whose stuck date is already posted', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due, { salt: undefined });
        seedServerRule(rule);
        seedServerDoc(legacyOccurrencePath('stuck', due), {});

        await service.processRecurringTransactions([rule]);

        await expectAsync(lastClaim()).toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
        expect(txGetPaths).toEqual(await stalledReads('stuck', due));
        expect(txSet).not.toHaveBeenCalled();
        expect(txUpdate).not.toHaveBeenCalled();
      });

      // Pin: a malformed salt keys nothing, so it adds no lookup, and it is not
      // replaced by a claim that posts nothing.
      it('writes no salt over a malformed one when the stuck date is already posted', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due, { salt: 'NOT-HEX' });
        seedServerRule(rule);
        seedServerDoc(legacyOccurrencePath('stuck', due), {});

        await service.processRecurringTransactions([rule]);

        await expectAsync(lastClaim()).toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
        expect(txGetPaths).toEqual(await stalledReads('stuck', due));
        expect(txSet).not.toHaveBeenCalled();
        expect(txUpdate).not.toHaveBeenCalled();
      });

      // Pin: nothing stands under any of its ids, so the stuck date posts once,
      // as it did before the lookup existed.
      it('posts a stalled occurrence once when no earlier row exists', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due);
        seedServerRule(rule);

        await service.processRecurringTransactions([rule]);

        const posted = await occurrencePath('stuck', due);
        await expectAsync(lastClaim()).toBeResolvedTo(
          jasmine.objectContaining({ postedIds: [posted.split('/').pop()!] })
        );
        expect(txSetPaths()).toEqual([posted]);
        expect(txUpdate).toHaveBeenCalledTimes(1);
        const [, data] = txUpdate.calls.mostRecent().args;
        expect((data as { nextOccurrence: Timestamp }).nextOccurrence.toDate()).toEqual(due);
      });

      it('posts what advanced and skips only the stuck date that is already posted', async () => {
        await withAprilNow(async () => {
          const rule = advancingRule();
          seedServerRule(rule);
          seedServerDoc(legacyOccurrencePath('adv', twentyFirst), {});

          await service.processRecurringTransactions([rule]);

          await expectAsync(lastClaim()).toBeResolvedTo(
            jasmine.objectContaining({
              postedIds: [(await occurrencePath('adv', march)).split('/').pop()!]
            })
          );
          expect(txGetPaths).toEqual(await stalledReads('adv', twentyFirst, FIXTURE_SALT));
          expect(txSetPaths()).toEqual([await occurrencePath('adv', march)]);
          // The pointer still lands on the stuck date, which is where the next
          // claim finds the walk stalled again.
          const [, data] = txUpdate.calls.mostRecent().args;
          expect((data as { nextOccurrence: Timestamp }).nextOccurrence.toDate())
            .toEqual(twentyFirst);
        });
      });

      it('posts both dates when nothing stands under the stuck date', async () => {
        await withAprilNow(async () => {
          const rule = advancingRule();
          seedServerRule(rule);

          await service.processRecurringTransactions([rule]);

          expect(txGetPaths).toEqual(await stalledReads('adv', twentyFirst, FIXTURE_SALT));
          expect(txSetPaths()).toEqual([
            await occurrencePath('adv', march),
            await occurrencePath('adv', twentyFirst)
          ]);
        });
      });

      it('still deactivates an ended rule whose stuck date is already posted', async () => {
        const due = new Date(Date.now() - 3 * DAY);
        const rule = stuckRule('stuck', due, {
          endDate: Timestamp.fromDate(new Date(Date.now() - 1 * DAY))
        });
        seedServerRule(rule);
        seedServerDoc(legacyOccurrencePath('stuck', due), {});

        await service.processRecurringTransactions([rule]);

        await expectAsync(lastClaim()).toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
        expect(txGetPaths).toEqual(await stalledReads('stuck', due, FIXTURE_SALT));
        expect(txSet).not.toHaveBeenCalled();
        expect(txUpdate).toHaveBeenCalledTimes(1);
        const [ref, data] = txUpdate.calls.mostRecent().args;
        expect((ref as FakeDocRef).path).toBe(rulePath('stuck'));
        // Nothing posted, so the pointer and the processed stamp stay where
        // they were; the pause is the one change the claim makes.
        expect(Object.keys(data as object).sort()).toEqual(['isActive', 'updatedAt']);
        expect((data as { isActive: boolean }).isActive).toBeFalse();
      });

      // Pin: a walk that ends on the date it posts until reads the rule and
      // nothing else, so only a stalled walk pays for the lookups.
      it('reads only the rule when the walk advances', async () => {
        const rule = createRecurring({
          id: 'daily',
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(new Date(Date.now() - 2 * DAY))
        });
        seedServerRule(rule);

        await service.processRecurringTransactions([rule]);

        expect(txSet).toHaveBeenCalled();
        expect(txGetPaths).toEqual([rulePath('daily')]);
      });
    });

    // #486: a posting's id is keyed by a salt only its rule holds. The claim
    // settles the salt from its own read of the rule, and writes one only in
    // the update that moves the pointer, so only when something posts.
    describe('the salt a posting is keyed by', () => {
      const OTHER_SEED = 'ffeeddccbbaa99887766554433221100';

      /** A daily rule 2.5 days late: three occurrences, at due, due+1d and due+2d. */
      const lateDailyRule = (id: string, overrides: Partial<RecurringTransaction> = {}) => {
        const due = new Date(Date.now() - 2.5 * DAY);
        const rule = createRecurring({
          id,
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(due),
          ...overrides
        });
        return { rule, dates: [due, addDays(due, 1), addDays(due, 2)] };
      };

      it('draws a saltless rule a salt and writes it with the pointer it moves', async () => {
        const { rule, dates } = lateDailyRule('bare', { salt: undefined });
        seedServerRule(rule);

        await service.processRecurringTransactions([rule]);

        expect(txUpdate).toHaveBeenCalledTimes(1);
        const update = txUpdate.calls.mostRecent().args[1] as Record<string, unknown>;
        const salt = update['salt'] as string;
        expect(isSeed(salt)).toBeTrue();
        expect(update['nextOccurrence']).toBeDefined();
        expect(txSetPaths()).toEqual(
          await Promise.all(dates.map(date => occurrencePath('bare', date, salt)))
        );
      });

      it('posts under a stored well-formed salt and writes the rule no salt', async () => {
        const { rule, dates } = lateDailyRule('salted');
        seedServerRule(rule);

        await service.processRecurringTransactions([rule]);

        expect(txSetPaths()).toEqual(
          await Promise.all(dates.map(date => occurrencePath('salted', date, FIXTURE_SALT)))
        );
        expect(txUpdate).toHaveBeenCalledTimes(1);
        const update = txUpdate.calls.mostRecent().args[1] as Record<string, unknown>;
        expect(update['nextOccurrence']).toBeDefined();
        expect('salt' in update).toBeFalse();
      });

      it('replaces a malformed stored salt on a rule that posts', async () => {
        const { rule, dates } = lateDailyRule('bad-salt', { salt: 'NOT-HEX' });
        seedServerRule(rule);

        await service.processRecurringTransactions([rule]);

        expect(txUpdate).toHaveBeenCalledTimes(1);
        const update = txUpdate.calls.mostRecent().args[1] as Record<string, unknown>;
        const salt = update['salt'] as string;
        expect(isSeed(salt)).toBeTrue();
        expect(update['nextOccurrence']).toBeDefined();
        expect(txSetPaths()).toEqual(
          await Promise.all(dates.map(date => occurrencePath('bad-salt', date, salt)))
        );
      });

      // The work list can be older than the rule: another device may have
      // posted under a salt it drew since. The claim's own read is the copy
      // the salt comes from, whatever the work list held.
      ([
        ['no salt', { salt: undefined }],
        ['the fixture salt', {}]
      ] as const).forEach(([label, overrides]) => {
        it(`takes the salt from the claim's own read when the work list holds ${label}`, async () => {
          const due = new Date(Date.now() - 3 * DAY);
          const listed = createRecurring({
            id: 'raced-salt',
            nextOccurrence: Timestamp.fromDate(due),
            ...overrides
          });
          seedServerRule(createRecurring({
            id: 'raced-salt',
            nextOccurrence: Timestamp.fromDate(due),
            salt: OTHER_SEED
          }));

          await service.processRecurringTransactions([listed]);

          expect(txSetPaths()).toEqual([await occurrencePath('raced-salt', due, OTHER_SEED)]);
          expect(txUpdate).toHaveBeenCalledTimes(1);
          const update = txUpdate.calls.mostRecent().args[1] as Record<string, unknown>;
          expect('salt' in update).toBeFalse();
        });
      });
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
      seedServerRule(rule);

      await service.processRecurringTransactions([rule]);

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
      const rules = [
        createRecurring({ id: 'raced', nextOccurrence: Timestamp.fromDate(due) })
      ];
      seedServerRule(createRecurring({
        id: 'raced',
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 27 * DAY))
      }));

      const result = await service.processRecurringTransactions(rules);

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockBudgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
    });

    it('should no-op when the rule was paused on the server', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rules = [
        createRecurring({ id: 'paused', nextOccurrence: Timestamp.fromDate(due) })
      ];
      seedServerRule(createRecurring({
        id: 'paused',
        nextOccurrence: Timestamp.fromDate(due),
        isActive: false
      }));

      const result = await service.processRecurringTransactions(rules);

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('should no-op when the rule was deleted on the server', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rules = [
        createRecurring({ id: 'gone', nextOccurrence: Timestamp.fromDate(due) })
      ];
      // Nothing seeded: the server copy no longer exists.

      const result = await service.processRecurringTransactions(rules);

      expect(result).toEqual([]);
      expect(txSet).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('should skip silently when the claim transaction rejects (offline)', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rules = [
        createRecurring({ id: 'offline1', nextOccurrence: Timestamp.fromDate(due) })
      ];
      mockFirestoreService.runTransaction.and.callFake(() =>
        Promise.reject(new Error('unavailable: failed to get documents from server'))
      );

      const result = await service.processRecurringTransactions(rules);

      expect(result).toEqual([]);
      expect(mockBudgetService.recalculateBudgetsForCategory).not.toHaveBeenCalled();
      expect(service.isLoading()).toBeFalse();
    });

    it('should reset isLoading after completion', async () => {
      await service.processRecurringTransactions([]);
      expect(service.isLoading()).toBeFalse();
    });

    // A stored rule need not honour its declared type. A restore, an older
    // build or a hand edit can leave either date holding something `.toDate()`
    // is not a method on, and the engine read both of them straight: one such
    // document took the whole catch-up down, so every other rule the user owns
    // stopped posting too.
    describe('a rule whose stored dates cannot be read', () => {
      /** The shape a `Timestamp` field takes when what it holds is not a date. */
      const unreadable = { toDate: () => new Date(NaN) } as unknown as Timestamp;

      /** 15 January 2024: a past anchor the monthly walk can count from. */
      const anchor = (): Timestamp => Timestamp.fromDate(new Date(2024, 0, 15));

      it('skips a rule with no readable start date, warns with its id, and still claims the others', async () => {
        const warn = spyOn(console, 'warn');
        const due = new Date(Date.now() - 3 * DAY);
        const bad = createRecurring({
          id: 'bad',
          startDate: undefined as unknown as Timestamp,
          nextOccurrence: Timestamp.fromDate(due)
        });
        const ok = createRecurring({ id: 'ok', nextOccurrence: Timestamp.fromDate(due) });
        seedServerRule(ok);

        await service.processRecurringTransactions([bad, ok]);

        // The bad rule never reaches a claim: it used to pass the due filter
        // and spend a whole server transaction discovering nothing to do.
        expect(mockFirestoreService.runTransaction).toHaveBeenCalledTimes(1);
        expect(txSetPaths()).toEqual([await occurrencePath('ok', due)]);
        expect(warn).toHaveBeenCalledWith(jasmine.stringContaining('[Recurring]'), 'bad');
        // The anchor is never invented (ADR 0014), so nothing is written.
        expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
      });

      it('a rule whose pointer is not a timestamp does not stop the run', async () => {
        spyOn(console, 'warn');
        const due = new Date(Date.now() - 3 * DAY);
        const bad = createRecurring({
          id: 'bad',
          startDate: anchor(),
          nextOccurrence: 'soon' as unknown as Timestamp
        });
        const ok = createRecurring({ id: 'ok', nextOccurrence: Timestamp.fromDate(due) });
        seedServerRule(ok);

        await expectAsync(service.processRecurringTransactions([bad, ok])).toBeResolved();

        expect(txSetPaths()).toEqual([await occurrencePath('ok', due)]);
      });

      it('repairs a malformed pointer to the first future occurrence without claiming it', async () => {
        spyOn(console, 'warn');
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(new Date(2026, 8, 19));
          const rule = createRecurring({
            id: 'stale',
            startDate: anchor(),
            nextOccurrence: unreadable
          });

          const result = await service.processRecurringTransactions([rule]);

          expect(mockFirestoreService.updateDocument).toHaveBeenCalledTimes(1);
          const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
          expect(path).toBe('users/user123/recurring/stale');
          // `updatedAt` is FirestoreService's to stamp, and the repair says
          // nothing about whether the rule has run: only the pointer moves.
          const record = data as Record<string, Timestamp>;
          expect(Object.keys(record)).toEqual(['nextOccurrence']);
          expect(record['nextOccurrence'].toDate()).toEqual(new Date(2026, 9, 15));

          // The repaired pointer is in the future by construction, so this run
          // posts nothing from the rule — the next one finds it healthy.
          expect(mockFirestoreService.runTransaction).not.toHaveBeenCalled();
          expect(result).toEqual([]);
        } finally {
          jasmine.clock().uninstall();
        }
      });

      // Every other case here anchors in the past, where a computed date that
      // does not move past the start means a frequency that cannot advance. A
      // start still ahead of today comes back unmoved because nothing was
      // skipped, and it is the rule's real next occurrence.
      it('repairs the pointer of a healthy rule whose start date has not arrived', async () => {
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(new Date(2026, 8, 19));
          const rule = createRecurring({
            id: 'not-yet',
            startDate: Timestamp.fromDate(new Date(2026, 11, 1)),
            nextOccurrence: unreadable
          });

          await service.processRecurringTransactions([rule]);

          expect(mockFirestoreService.updateDocument).toHaveBeenCalledTimes(1);
          const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
          expect(path).toBe('users/user123/recurring/not-yet');
          const record = data as Record<string, Timestamp>;
          expect(Object.keys(record)).toEqual(['nextOccurrence']);
          expect(record['nextOccurrence'].toDate()).toEqual(new Date(2026, 11, 1));
        } finally {
          jasmine.clock().uninstall();
        }
      });

      it('leaves a rule whose frequency cannot advance unrepaired and says so', async () => {
        const warn = spyOn(console, 'warn');
        const rule = createRecurring({
          id: 'stuck',
          frequency: { type: 'daily', interval: 0 },
          startDate: anchor(),
          nextOccurrence: unreadable
        });

        await service.processRecurringTransactions([rule]);

        // Recomputing from a frequency that cannot advance answers the start
        // date itself: storing it would make the rule due forever.
        expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args.slice(0, 2))
          .toEqual([jasmine.stringContaining('[Recurring]'), 'stuck']);
      });

      it('leaves a rule whose frequency type cannot advance unrepaired and says so', async () => {
        const warn = spyOn(console, 'warn');
        const rule = createRecurring({
          id: 'unknown-type',
          frequency: { type: 'fortnightly' as never, interval: 1 },
          startDate: anchor(),
          nextOccurrence: unreadable
        });

        await service.processRecurringTransactions([rule]);

        // validateFrequency only names the interval refusal; an unknown
        // `type` passes it and falls through calculateNextOccurrenceFromDate's
        // switch unchanged, so the computed result has to be checked too.
        expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args.slice(0, 2))
          .toEqual([jasmine.stringContaining('[Recurring]'), 'unknown-type']);
      });

      it('leaves a frequency that cannot advance unrepaired however far off its start is', async () => {
        const warn = spyOn(console, 'warn');
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(new Date(2026, 8, 19));
          const rule = createRecurring({
            id: 'unknown-type-ahead',
            frequency: { type: 'fortnightly' as never, interval: 1 },
            startDate: Timestamp.fromDate(new Date(2026, 11, 1)),
            nextOccurrence: unreadable
          });

          await service.processRecurringTransactions([rule]);

          // The start is a date the rule really does fall due on, but it is
          // also the only one it will ever reach: storing it buys one
          // occurrence and leaves the rule due forever after it.
          expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.calls.mostRecent().args.slice(0, 2))
            .toEqual([jasmine.stringContaining('[Recurring]'), 'unknown-type-ahead']);
        } finally {
          jasmine.clock().uninstall();
        }
      });

      it('deactivates an ended rule instead of repairing its pointer past the end date', async () => {
        spyOn(console, 'warn');
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(new Date(2026, 8, 19));
          const rule = createRecurring({
            id: 'over',
            startDate: anchor(),
            endDate: Timestamp.fromDate(new Date(2025, 11, 31)),
            nextOccurrence: unreadable
          });

          await service.processRecurringTransactions([rule]);

          expect(mockFirestoreService.updateDocument).toHaveBeenCalledTimes(1);
          const [path, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
          expect(path).toBe('users/user123/recurring/over');
          expect(data).toEqual({ isActive: false });
        } finally {
          jasmine.clock().uninstall();
        }
      });

      // The claim reads `endDate` through the same seam as the walk above,
      // but on the fresh server document rather than the enumerated copy —
      // an unreadable bound there must not stop the backlog from posting.
      it('posts the backlog through a claim whose end date cannot be read', async () => {
        spyOn(console, 'warn');
        const due = new Date(Date.now() - 3 * DAY);
        const rule = createRecurring({
          id: 'bad-end',
          startDate: anchor(),
          endDate: { seconds: 1, nanoseconds: 0 } as unknown as Timestamp,
          nextOccurrence: Timestamp.fromDate(due)
        });
        seedServerRule(rule);

        await expectAsync(service.processRecurringTransactions([rule])).toBeResolved();

        expect(txSetPaths()).toEqual([await occurrencePath('bad-end', due)]);
        expect(mockFirestoreService.updateDocument).not.toHaveBeenCalled();
      });

      it('a repair that does not land leaves the rule for the next run', async () => {
        const warn = spyOn(console, 'warn');
        mockFirestoreService.updateDocument.and.returnValue(
          Promise.reject(new Error('unavailable: failed to get documents from server'))
        );
        const due = new Date(Date.now() - 3 * DAY);
        const bad = createRecurring({
          id: 'bad',
          startDate: anchor(),
          nextOccurrence: unreadable
        });
        const ok = createRecurring({ id: 'ok', nextOccurrence: Timestamp.fromDate(due) });
        seedServerRule(ok);

        await expectAsync(service.processRecurringTransactions([bad, ok])).toBeResolved();

        expect(txSetPaths()).toEqual([await occurrencePath('ok', due)]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args.slice(0, 2))
          .toEqual([jasmine.stringContaining('[Recurring]'), 'bad']);
      });

      // The claim re-reads the rule fresh from the server, so it meets shapes
      // the enumerated copy never showed. A rejection out of that callback is
      // indistinguishable from being offline — the caller breaks out of the
      // drain loop either way — so the claim has to answer null instead.
      it('the claim answers null, not a rejection, for a fresh document it cannot read', async () => {
        const warn = spyOn(console, 'warn');
        const due = new Date(Date.now() - 3 * DAY);
        const rule = createRecurring({ id: 'half', nextOccurrence: Timestamp.fromDate(due) });
        seedServerRule(createRecurring({
          id: 'half',
          startDate: undefined as unknown as Timestamp,
          nextOccurrence: Timestamp.fromDate(due)
        }));

        await service.processRecurringTransactions([rule]);

        await expectAsync(mockFirestoreService.runTransaction.calls.mostRecent().returnValue)
          .toBeResolvedTo(null);
        expect(warn).toHaveBeenCalledWith(jasmine.stringContaining('[Recurring]'), 'half');
        expect(txSet).not.toHaveBeenCalled();
      });
    });
  });

  describe('catchUpRecurringTransactions', () => {
    it('should resolve empty and touch nothing when not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      const result = await service.catchUpRecurringTransactions();

      expect(result).toEqual([]);
      expect(mockCurrencyService.ensureRatesLoaded).not.toHaveBeenCalled();
      expect(mockBudgetService.getBudgets).not.toHaveBeenCalled();
      expect(mockFirestoreService.getCollectionFromServer).not.toHaveBeenCalled();
      expect(mockFirestoreService.subscribeToCollection).not.toHaveBeenCalled();
    });

    it('should load rates and fresh recurring rules before processing, without warming budgets', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([rule]));
      seedServerRule(rule);

      await service.catchUpRecurringTransactions();

      expect(mockCurrencyService.ensureRatesLoaded).toHaveBeenCalled();
      // The recalculation enumerates the budgets collection itself, so the
      // catch-up no longer subscribes just to populate the signal for it.
      expect(mockBudgetService.getBudgets).not.toHaveBeenCalled();
      expect(mockFirestoreService.getCollectionFromServer).toHaveBeenCalledWith(
        'users/user123/recurring',
        { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] }
      );
      expect(txSet).toHaveBeenCalledTimes(1);
    });

    it('should share a single run between concurrent triggers', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([rule]));
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
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([rule]));
      seedServerRule(rule);

      await service.catchUpRecurringTransactions();
      expect(txSet).toHaveBeenCalledTimes(1);

      // A fresh enumeration now returns the advanced (future) nextOccurrence,
      // exactly as Firestore would after the first run persisted it.
      const advanced = createRecurring({
        id: 'due1',
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 27 * DAY))
      });
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([advanced]));
      seedServerRule(advanced);

      const result = await service.catchUpRecurringTransactions();

      expect(result).toEqual([]);
      expect(txSet).toHaveBeenCalledTimes(1);
    });

    it('should not post from a stale work list when the server copy has advanced', async () => {
      // Another device claims the rule between this device's enumeration and
      // its claim: the claim's own fresh server read is still the guard.
      const due = new Date(Date.now() - 3 * DAY);
      mockFirestoreService.getCollectionFromServer.and.returnValue(
        Promise.resolve([createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) })])
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

    // Prove the source, not just the result (docs/one-shot-reads.md): the
    // work list comes from the collection enumeration, and the signal —
    // which a listener's first emission used to feed — plays no part.
    it('posts a due rule from the enumeration with the signal left empty', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'cold1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([rule]));
      seedServerRule(rule);

      const result = await service.catchUpRecurringTransactions();

      // The signal was empty before the run — the cold-start shape that
      // used to make the engine decide there was nothing to do.
      expect(service.recurringTransactions()).toEqual([]);
      expect(txSetPaths()).toEqual([await occurrencePath('cold1', due)]);
      expect(result.length).toBe(0); // getDocument default resolves null
    });

    it('never opens a listener and leaves the signal alone', async () => {
      const marker = [createRecurring({
        id: 'page-owned',
        nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 5 * DAY))
      })];
      service.recurringTransactions.set(marker);

      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([rule]));
      seedServerRule(rule);

      await service.catchUpRecurringTransactions();

      // The engine neither reads the signal (the due rule posted anyway)
      // nor writes it (the page-owned value survives by reference).
      expect(mockFirestoreService.subscribeToCollection).not.toHaveBeenCalled();
      expect(service.recurringTransactions()).toBe(marker);
      expect(txSet).toHaveBeenCalledTimes(1);
    });

    it('propagates the server-read rejection and clears the in-flight run', async () => {
      mockFirestoreService.getCollectionFromServer.and.rejectWith(
        new Error('unavailable')
      );

      // Offline the read is answered by the server or not at all: the run
      // rejects instead of resolving as an empty success.
      await expectAsync(service.catchUpRecurringTransactions())
        .toBeRejectedWithError('unavailable');
      expect(mockFirestoreService.runTransaction).not.toHaveBeenCalled();

      // The failed run is not cached as the shared in-flight promise: the
      // next trigger runs the engine again.
      const due = new Date(Date.now() - 3 * DAY);
      const rule = createRecurring({ id: 'retry1', nextOccurrence: Timestamp.fromDate(due) });
      mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([rule]));
      seedServerRule(rule);

      await service.catchUpRecurringTransactions();

      expect(txSet).toHaveBeenCalledTimes(1);
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

    // The occurrence carries the rule's lead so a consumer can decide when to
    // warn without joining back to the rule collection. Zero is a lead like
    // any other and must survive the trip.
    it('carries the rule reminder lead time onto every occurrence', (done) => {
      mockFirestoreService.subscribeToCollection.and.returnValue(of([
        createRecurring({
          id: 'reminded',
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 1 * DAY)),
          remindDaysBefore: 0
        })
      ]));

      service.getNextOccurrences(5).subscribe(occurrences => {
        expect(occurrences.length).toBeGreaterThan(0);
        for (const occurrence of occurrences) {
          expect(occurrence.remindDaysBefore).toBe(0);
        }
        done();
      });
    });

    it('leaves the lead time off occurrences of a rule without one', (done) => {
      mockFirestoreService.subscribeToCollection.and.returnValue(of([
        createRecurring({
          id: 'unreminded',
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(new Date(Date.now() + 1 * DAY))
        })
      ]));

      service.getNextOccurrences(5).subscribe(occurrences => {
        expect(occurrences.length).toBeGreaterThan(0);
        for (const occurrence of occurrences) {
          expect('remindDaysBefore' in occurrence).toBeFalse();
        }
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
     * The walk used to start at the stored pointer with no lower bound, so a
     * rule that stopped paying years ago handed the card one row per day from
     * then to the horizon. The floor mirrors the horizon: as many whole local
     * days behind today as the window draws ahead of it.
     */
    describe('window floor', () => {
      const TODAY = new Date(2027, 4, 20, 9, 30);

      /**
       * A daily rule whose pointer stands `back` whole days behind today, run
       * through both readers with the clock frozen so the floor and the
       * horizon are fixed rather than taken from the day the suite runs.
       */
      const walk = (
        back: number,
        days: number,
        overrides: Partial<RecurringTransaction> = {}
      ): { schedule: UpcomingSchedule; occurrences: RecurringOccurrence[] } => {
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(TODAY);
          const pointer = addDays(startOfDay(TODAY), -back);
          mockFirestoreService.subscribeToCollection.and.returnValue(of([
            createRecurring({
              id: 'dormant',
              frequency: { type: 'daily', interval: 1 },
              startDate: Timestamp.fromDate(pointer),
              nextOccurrence: Timestamp.fromDate(pointer),
              ...overrides
            })
          ]));

          let schedule: UpcomingSchedule = { occurrences: [], olderCount: -1 };
          service.getUpcomingSchedule(days).subscribe(s => (schedule = s));
          let occurrences: RecurringOccurrence[] = [];
          service.getNextOccurrences(days).subscribe(o => (occurrences = o));
          return { schedule, occurrences };
        } finally {
          jasmine.clock().uninstall();
        }
      };

      const keyAt = (offset: number): string => dayKey(addDays(startOfDay(TODAY), offset));

      it('counts the occurrences older than the floor instead of returning them', () => {
        const { schedule } = walk(20, 14);

        // Days -20 to -15 are below the floor; -14 to +14 are the 29 rows
        // the card draws.
        expect(schedule.olderCount).toBe(6);
        expect(schedule.occurrences.length).toBe(29);
        expect(dayKey(schedule.occurrences[0].date)).toBe(keyAt(-14));
        expect(dayKey(schedule.occurrences[28].date)).toBe(keyAt(14));
      });

      // A few days overdue is the ordinary failed-catch-up case the card
      // exists to surface, so the floor must not swallow it (ADR 0091).
      it('still returns an overdue occurrence inside the floor', () => {
        const { schedule } = walk(3, 14);

        expect(schedule.olderCount).toBe(0);
        expect(dayKey(schedule.occurrences[0].date)).toBe(keyAt(-3));
      });

      it('getNextOccurrences keeps its shape and takes the floor', () => {
        const { schedule, occurrences } = walk(20, 14);

        expect(occurrences).toEqual(schedule.occurrences);
      });

      // A bill link sends the user away on the card's answer, once, so its
      // check is the same walk over what the server holds, never the cache.
      it('getUpcomingScheduleFromServer walks what the server holds, the same way', async () => {
        const { schedule } = walk(20, 14);
        const pointer = addDays(startOfDay(TODAY), -20);
        mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.resolve([
          createRecurring({
            id: 'dormant',
            frequency: { type: 'daily', interval: 1 },
            startDate: Timestamp.fromDate(pointer),
            nextOccurrence: Timestamp.fromDate(pointer)
          })
        ]));
        mockFirestoreService.subscribeToCollection.calls.reset();

        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(TODAY);
          expect(await service.getUpcomingScheduleFromServer(14)).toEqual(schedule);
        } finally {
          jasmine.clock().uninstall();
        }
        expect(mockFirestoreService.getCollectionFromServer).toHaveBeenCalledOnceWith(
          'users/user123/recurring',
          { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] }
        );
        expect(mockFirestoreService.subscribeToCollection).not.toHaveBeenCalled();
      });

      it('getUpcomingScheduleFromServer answers empty without a user, reading nothing', async () => {
        (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

        expect(await service.getUpcomingScheduleFromServer(14)).toEqual({ occurrences: [], olderCount: 0 });
        expect(mockFirestoreService.getCollectionFromServer).not.toHaveBeenCalled();
      });

      it('getUpcomingScheduleFromServer rejects when the server cannot answer', async () => {
        mockFirestoreService.getCollectionFromServer.and.returnValue(Promise.reject(new Error('offline')));

        await expectAsync(service.getUpcomingScheduleFromServer(14)).toBeRejectedWithError('offline');
      });

      // The count is exact and uncapped: a cap that stopped the walk would
      // leave the pointer below the floor and drop the in-window rows too.
      it('counts exactly, however far back the pointer is', () => {
        const { schedule } = walk(800, 14);

        expect(schedule.olderCount).toBe(786);
        expect(schedule.occurrences.length).toBe(29);
        expect(dayKey(schedule.occurrences[0].date)).toBe(keyAt(-14));
      });

      // The walk-break cases below `getNextOccurrences` (`stops collecting
      // occurrences when the frequency cannot advance`, `stops collecting
      // when a negative interval walks backwards`) all pin a pointer ahead of
      // today, so they exercise the break in the collecting loop only. This
      // one starts the pointer behind the floor so the count loop hits the
      // same break: it counts the pointer once, cannot advance, and stops —
      // never reaching the collecting loop at all.
      it('stops the count loop when the frequency cannot advance', () => {
        const { schedule } = walk(800, 14, {
          frequency: { type: 'daily', interval: 0 }
        });

        expect(schedule.olderCount).toBe(1);
        expect(schedule.occurrences).toEqual([]);
      });

      it('stops counting at an end date older than the floor', () => {
        const { schedule } = walk(20, 14, {
          endDate: Timestamp.fromDate(addDays(startOfDay(TODAY), -18))
        });

        expect(schedule.olderCount).toBe(3);
        expect(schedule.occurrences).toEqual([]);
      });

      // An end date is read through the same seam as the rest of the rule's
      // dates, so a malformed one leaves the rule running rather than
      // throwing out of the walk. `toDate` returns null for a shape that has
      // no `toDate` method at all — the old direct `.toDate()` call threw on
      // exactly this shape, taking the whole walk down with it.
      it('walks a rule whose end date cannot be read as one with no end', () => {
        const { schedule } = walk(3, 14, {
          endDate: { seconds: 1, nanoseconds: 0 } as unknown as Timestamp
        });

        expect(schedule.olderCount).toBe(0);
        expect(schedule.occurrences.length).toBe(18);
      });
    });

    // The forecast walks whatever the listener hands it. One rule stored in a
    // state its own writes could never produce used to error the stream, so
    // the chart went blank for every rule the user owns.
    it('the schedule walker skips an unreadable rule instead of erroring the stream', (done) => {
      const warn = spyOn(console, 'warn');
      const soon = new Date(Date.now() + 1 * DAY);
      mockFirestoreService.subscribeToCollection.and.returnValue(of([
        createRecurring({
          id: 'nostart',
          startDate: undefined as unknown as Timestamp,
          nextOccurrence: Timestamp.fromDate(soon)
        }),
        createRecurring({
          id: 'nopointer',
          startDate: Timestamp.fromDate(new Date(2024, 0, 15)),
          nextOccurrence: { toDate: () => new Date(NaN) } as unknown as Timestamp
        }),
        createRecurring({
          id: 'healthy',
          frequency: { type: 'daily', interval: 1 },
          nextOccurrence: Timestamp.fromDate(soon)
        })
      ]));

      service.getNextOccurrences(14).subscribe({
        next: occurrences => {
          expect(occurrences.length).toBeGreaterThan(0);
          expect([...new Set(occurrences.map(o => o.recurringId))]).toEqual(['healthy']);
          expect(warn).toHaveBeenCalledWith(jasmine.stringContaining('[Recurring]'), 'nostart');
          done();
        },
        error: (error: unknown) => done.fail(error as Error)
      });
    });

    /**
     * The window used to close `days × 24h` from the current instant, while the
     * chart draws `days` whole calendar days. Everything from the current time
     * of day to the end of the final day fell in the gap, so an occurrence
     * stamped later in the day than "now" was dropped: the last tick rendered
     * flat and projectedNet understated the horizon by that rule's amount.
     * Open the same page after that time of day and it reappeared.
     *
     * Non-midnight stamps are ordinary. The recurring form defaults its start
     * date to the current instant, and resumeRecurring recomputes the pointer
     * from `new Date()`, so a rule resumed at 15:00 carries 15:00 forever.
     *
     * None of the specs below this could see it: `occurrencesFrom` pins today
     * to midnight, the one moment of the day at which a raw-millisecond window
     * and a whole-day window coincide.
     */
    describe('horizon boundary', () => {
      const HORIZON = 30;

      /** One yearly rule, so only the boundary decides what comes back. */
      const occurrencesAt = (now: Date, occurrence: Date, days = HORIZON): Date[] => {
        jasmine.clock().install();
        try {
          jasmine.clock().mockDate(now);
          mockFirestoreService.subscribeToCollection.and.returnValue(of([
            createRecurring({
              id: 'boundary',
              frequency: { type: 'yearly', interval: 1 },
              startDate: Timestamp.fromDate(occurrence),
              nextOccurrence: Timestamp.fromDate(occurrence)
            })
          ]));

          let dates: Date[] = [];
          service.getNextOccurrences(days).subscribe(o => {
            dates = o.map(occ => occ.date);
          });
          return dates;
        } finally {
          jasmine.clock().uninstall();
        }
      };

      it('returns an occurrence later in the day than now on the final charted day', () => {
        const now = new Date(2026, 7, 10, 10, 0);
        const lastDay = addDays(startOfDay(now), HORIZON);
        const occurrence = new Date(
          lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 15, 0);

        expect(occurrencesAt(now, occurrence).map(dayKey)).toEqual([dayKey(occurrence)]);
      });

      it('returns the same occurrences whatever time of day the tab is opened', () => {
        const day = new Date(2026, 7, 10);
        const lastDay = addDays(day, HORIZON);
        const occurrence = new Date(
          lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 15, 0);

        const morning = occurrencesAt(new Date(2026, 7, 10, 10, 0), occurrence).map(dayKey);
        const afternoon = occurrencesAt(new Date(2026, 7, 10, 16, 0), occurrence).map(dayKey);

        expect(morning).toEqual(afternoon);
      });

      /**
       * Worse variant, and it needs no non-midnight stamp: across a DST
       * fall-back `now + N × 24h` lands an hour earlier in local wall clock
       * than N calendar days later, so opening the tab between 00:00 and 01:00
       * excluded the entire final day. Asia/Tokyo has no DST, so there the
       * same assertion is simply the ordinary midnight case — true in both
       * zones, only reachable through the fall-back in America/New_York.
       */
      it('returns a midnight occurrence on the final day when the horizon spans a DST change', () => {
        const now = new Date(2026, 9, 20, 0, 30);
        const occurrence = addDays(startOfDay(now), HORIZON);

        expect(occurrencesAt(now, occurrence).map(dayKey)).toEqual([dayKey(occurrence)]);
      });

      it('still excludes an occurrence one calendar day past the horizon', () => {
        const now = new Date(2026, 7, 10, 10, 0);
        const occurrence = addDays(startOfDay(now), HORIZON + 1);

        expect(occurrencesAt(now, occurrence)).toEqual([]);
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

  describe('deleteAll', () => {
    const path = 'users/user123/recurring';

    it('deletes every document and resets the signal', async () => {
      mockFirestoreService.getCollection.and.resolveTo([{ id: 'r1' }, { id: 'r2' }]);
      mockFirestoreService.deleteDocument.and.resolveTo(undefined);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestoreService.deleteDocument.calls.allArgs()).toEqual([
        [`${path}/r1`],
        [`${path}/r2`]
      ]);
      expect(service.recurringTransactions()).toEqual([]);
    });

    it('enumerates the collection rather than the signal', async () => {
      mockFirestoreService.getCollection.and.resolveTo([{ id: 'r1' }, { id: 'r2' }]);
      mockFirestoreService.deleteDocument.and.resolveTo(undefined);
      service.recurringTransactions.set([]);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestoreService.getCollection).toHaveBeenCalledWith(path);
      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledTimes(2);
    });
  });

  describe('listAll and exportAll', () => {
    const path = 'users/user123/recurring';
    const options = { orderBy: [{ field: 'nextOccurrence', direction: 'asc' as const }] };

    it('listAll still reads the cache-capable collection', async () => {
      mockFirestoreService.getCollection.and.resolveTo([{ id: 'r1' }]);

      const result = await service.listAll();

      expect(result).toEqual([{ id: 'r1' }] as unknown as RecurringTransaction[]);
      expect(mockFirestoreService.getCollection).toHaveBeenCalledWith(path, options);
      expect(mockFirestoreService.getCollectionFromServer).not.toHaveBeenCalled();
    });

    it('exportAll reads the server, not the cache', async () => {
      mockFirestoreService.getCollectionFromServer.and.resolveTo([{ id: 'r1' }]);

      const result = await service.exportAll();

      expect(result).toEqual([{ id: 'r1' }] as unknown as RecurringTransaction[]);
      expect(mockFirestoreService.getCollectionFromServer).toHaveBeenCalledWith(path, options);
      expect(mockFirestoreService.getCollection).not.toHaveBeenCalled();
    });
  });
});
