import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { RecurringService } from './recurring.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
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
  let mockTransactionService: jasmine.SpyObj<TransactionService>;

  const DAY = 24 * 60 * 60 * 1000;

  const monthly: RecurringFrequency = { type: 'monthly', interval: 1 };

  const createRecurring = (overrides: Partial<RecurringTransaction> = {}): RecurringTransaction => ({
    id: 'rec1',
    userId: 'user123',
    name: 'Monthly Salary',
    type: 'income',
    amount: 5000,
    currency: 'USD',
    categoryId: 'employment_salary',
    description: 'Salary',
    frequency: monthly,
    startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
    nextOccurrence: Timestamp.fromDate(new Date(2024, 1, 1)),
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  });

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'subscribeToDocument',
      'addDocument',
      'updateDocument',
      'deleteDocument',
      'getDocument',
      'dateToTimestamp',
      'getTimestamp'
    ]);

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      userId: jasmine.createSpy('userId').and.returnValue('user123')
    });

    mockTransactionService = jasmine.createSpyObj('TransactionService', ['addTransaction']);

    mockFirestoreService.subscribeToCollection.and.returnValue(of([]));
    mockFirestoreService.subscribeToDocument.and.returnValue(of(null));
    mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-rec-id'));
    mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));
    mockFirestoreService.getTimestamp.and.returnValue(Timestamp.now());
    mockFirestoreService.dateToTimestamp.and.callFake((date: Date) => Timestamp.fromDate(date));
    mockTransactionService.addTransaction.and.returnValue(Promise.resolve('txn-id'));

    TestBed.configureTestingModule({
      providers: [
        RecurringService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: TransactionService, useValue: mockTransactionService }
      ]
    });

    service = TestBed.inject(RecurringService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
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

    it('should reset isLoading after completion', async () => {
      await service.updateRecurring('rec1', { name: 'x' });
      expect(service.isLoading()).toBeFalse();
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
      expect(mockTransactionService.addTransaction).not.toHaveBeenCalled();
    });

    it('should pause due transactions whose end date has passed', async () => {
      const due = new Date(Date.now() - 5 * DAY);
      const ended = new Date(Date.now() - 1 * DAY);
      service.recurringTransactions.set([
        createRecurring({
          id: 'ended',
          nextOccurrence: Timestamp.fromDate(due),
          endDate: Timestamp.fromDate(ended)
        })
      ]);

      const result = await service.processRecurringTransactions();

      expect(result).toEqual([]);
      expect(mockTransactionService.addTransaction).not.toHaveBeenCalled();
      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/recurring/ended',
        { isActive: false }
      );
    });

    it('should create a transaction and advance next occurrence for due recurring', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      const createdTxn = { id: 'txn-id', amount: 5000 } as unknown as Transaction;
      service.recurringTransactions.set([
        createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) })
      ]);
      mockTransactionService.addTransaction.and.returnValue(Promise.resolve('txn-id'));
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(createdTxn));

      const result = await service.processRecurringTransactions();

      expect(mockTransactionService.addTransaction).toHaveBeenCalled();
      const dto = mockTransactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.isRecurring).toBeTrue();
      expect(dto.recurringId).toBe('due1');
      // The recurring doc should be updated with new nextOccurrence + lastProcessed
      const updateCall = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect(updateCall[0]).toBe('users/user123/recurring/due1');
      expect((updateCall[1] as Record<string, unknown>)['nextOccurrence']).toBeDefined();
      expect((updateCall[1] as Record<string, unknown>)['lastProcessed']).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0]).toBe(createdTxn);
    });

    it('should skip pushing a created transaction that cannot be fetched back', async () => {
      const due = new Date(Date.now() - 3 * DAY);
      service.recurringTransactions.set([
        createRecurring({ id: 'due1', nextOccurrence: Timestamp.fromDate(due) })
      ]);
      mockFirestoreService.getDocument.and.returnValue(Promise.resolve(null));

      const result = await service.processRecurringTransactions();

      expect(mockTransactionService.addTransaction).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should reset isLoading after completion', async () => {
      await service.processRecurringTransactions();
      expect(service.isLoading()).toBeFalse();
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
      // Day must be valid (never rolls into the following month)
      expect(next.getDate()).toBeLessThanOrEqual(31);
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
