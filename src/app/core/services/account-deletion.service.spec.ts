import { TestBed } from '@angular/core/testing';
import { AccountDeletionService, DeletionStep } from './account-deletion.service';
import { AuthService } from './auth.service';
import { AppLockService } from './app-lock.service';
import { OfflineQueueService } from './offline-queue.service';
import { TransactionService } from './transaction.service';
import { CategoryService } from './category.service';
import { BudgetService } from './budget.service';
import { RecurringService } from './recurring.service';
import { SearchHistoryService } from './search-history.service';
import { SearchAnswerHistoryService } from './search-answer-history.service';
import { CategoryMemoryService } from './category-memory.service';
import { TagMemoryService } from './tag-memory.service';
import { GoalService } from './goal.service';
import { ImportHistoryService } from './import-history.service';
import { InsightSnapshotService } from './insight-snapshot.service';
import { ProviderKeyService } from './provider-key.service';
import { FeedbackService } from './feedback.service';
import { SecurityLogService } from './security-log.service';
import { ShareIntakeService } from './share-intake.service';
import { FirestoreService } from './firestore.service';
import { reminderSentStorageKey } from './reminder.service';
import { weeklyRecapStorageKeys } from '../utils/weekly-recap.utils';

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  let mockAuth: jasmine.SpyObj<AuthService>;
  let mockAppLock: jasmine.SpyObj<AppLockService>;
  let mockQueue: jasmine.SpyObj<OfflineQueueService>;
  let mockTransactions: jasmine.SpyObj<TransactionService>;
  let mockCategories: jasmine.SpyObj<CategoryService>;
  let mockBudgets: jasmine.SpyObj<BudgetService>;
  let mockRecurring: jasmine.SpyObj<RecurringService>;
  let mockSearches: jasmine.SpyObj<SearchHistoryService>;
  let mockAnswers: jasmine.SpyObj<SearchAnswerHistoryService>;
  let mockCategoryMemory: jasmine.SpyObj<CategoryMemoryService>;
  let mockTagMemory: jasmine.SpyObj<TagMemoryService>;
  let mockGoals: jasmine.SpyObj<GoalService>;
  let mockImports: jasmine.SpyObj<ImportHistoryService>;
  let mockSnapshots: jasmine.SpyObj<InsightSnapshotService>;
  let mockProviderKeys: jasmine.SpyObj<ProviderKeyService>;
  let mockFeedback: jasmine.SpyObj<FeedbackService>;
  let mockSecurityLog: jasmine.SpyObj<SecurityLogService>;
  let mockShareIntake: jasmine.SpyObj<ShareIntakeService>;
  let mockFirestore: jasmine.SpyObj<FirestoreService>;

  /** Step names in the order the cascade actually invoked them. */
  let order: string[];

  function track(spy: jasmine.Spy, name: string, result: unknown = undefined): void {
    spy.and.callFake(() => {
      order.push(name);
      return Promise.resolve(result);
    });
  }

  beforeEach(() => {
    order = [];

    mockAuth = jasmine.createSpyObj('AuthService', ['reauthenticate', 'deleteFirebaseUser'], {
      userId: jasmine.createSpy('userId').and.returnValue('user123')
    });
    mockAppLock = jasmine.createSpyObj('AppLockService', ['clearCredential']);
    mockQueue = jasmine.createSpyObj('OfflineQueueService', ['clearAll']);
    mockTransactions = jasmine.createSpyObj('TransactionService', ['deleteAllTransactions']);
    mockCategories = jasmine.createSpyObj('CategoryService', ['deleteAll']);
    mockBudgets = jasmine.createSpyObj('BudgetService', ['deleteAll']);
    mockRecurring = jasmine.createSpyObj('RecurringService', ['deleteAll']);
    mockSearches = jasmine.createSpyObj('SearchHistoryService', ['deleteAll']);
    mockAnswers = jasmine.createSpyObj('SearchAnswerHistoryService', ['deleteAll']);
    mockCategoryMemory = jasmine.createSpyObj('CategoryMemoryService', ['deleteAll']);
    mockTagMemory = jasmine.createSpyObj('TagMemoryService', ['deleteAll']);
    mockGoals = jasmine.createSpyObj('GoalService', ['deleteAll']);
    mockImports = jasmine.createSpyObj('ImportHistoryService', ['clearImportHistory']);
    mockSnapshots = jasmine.createSpyObj('InsightSnapshotService', ['deleteAll']);
    mockProviderKeys = jasmine.createSpyObj('ProviderKeyService', ['deleteAll']);
    mockFeedback = jasmine.createSpyObj('FeedbackService', ['deleteAll']);
    mockSecurityLog = jasmine.createSpyObj('SecurityLogService', ['deleteAll']);
    mockShareIntake = jasmine.createSpyObj('ShareIntakeService', ['clearAll']);
    mockFirestore = jasmine.createSpyObj('FirestoreService', ['deleteDocument']);

    track(mockAuth.reauthenticate, 'reauth');
    track(mockAuth.deleteFirebaseUser, 'authUser');
    track(mockAppLock.clearCredential, 'appLock');
    track(mockQueue.clearAll, 'offlineQueue');
    track(mockShareIntake.clearAll, 'shareStash');
    track(mockTransactions.deleteAllTransactions, 'transactions', 3);
    track(mockCategories.deleteAll, 'categories', 2);
    track(mockBudgets.deleteAll, 'budgets', 1);
    track(mockRecurring.deleteAll, 'recurring', 1);
    track(mockSearches.deleteAll, 'savedSearches', 1);
    track(mockAnswers.deleteAll, 'searchAnswers', 1);
    track(mockCategoryMemory.deleteAll, 'categoryMemory', 1);
    track(mockTagMemory.deleteAll, 'tagMemory', 1);
    track(mockGoals.deleteAll, 'goals', 1);
    track(mockImports.clearImportHistory, 'imports');
    track(mockSnapshots.deleteAll, 'insightSnapshots');
    track(mockProviderKeys.deleteAll, 'secrets');
    track(mockFeedback.deleteAll, 'feedback', 1);
    track(mockSecurityLog.deleteAll, 'securityEvents', 4);
    track(mockFirestore.deleteDocument, 'userDoc');

    TestBed.configureTestingModule({
      providers: [
        AccountDeletionService,
        { provide: AuthService, useValue: mockAuth },
        { provide: AppLockService, useValue: mockAppLock },
        { provide: OfflineQueueService, useValue: mockQueue },
        { provide: TransactionService, useValue: mockTransactions },
        { provide: CategoryService, useValue: mockCategories },
        { provide: BudgetService, useValue: mockBudgets },
        { provide: RecurringService, useValue: mockRecurring },
        { provide: SearchHistoryService, useValue: mockSearches },
        { provide: SearchAnswerHistoryService, useValue: mockAnswers },
        { provide: CategoryMemoryService, useValue: mockCategoryMemory },
        { provide: TagMemoryService, useValue: mockTagMemory },
        { provide: GoalService, useValue: mockGoals },
        { provide: ImportHistoryService, useValue: mockImports },
        { provide: InsightSnapshotService, useValue: mockSnapshots },
        { provide: ProviderKeyService, useValue: mockProviderKeys },
        { provide: FeedbackService, useValue: mockFeedback },
        { provide: SecurityLogService, useValue: mockSecurityLog },
        { provide: ShareIntakeService, useValue: mockShareIntake },
        { provide: FirestoreService, useValue: mockFirestore }
      ]
    });

    service = TestBed.inject(AccountDeletionService);
  });

  afterEach(() => {
    // The device-local cases seed real keys, and one that outlives its spec
    // would answer another file's read.
    for (const userId of ['user123', 'user456']) {
      localStorage.removeItem(reminderSentStorageKey(userId));
      localStorage.removeItem(weeklyRecapStorageKeys(userId).dismissed);
      localStorage.removeItem(weeklyRecapStorageKeys(userId).narrative);
    }
  });

  it('reports ok and deletes the auth user on a clean run', async () => {
    const report = await service.deleteAccount();

    expect(report.ok).toBeTrue();
    expect(report.failed).toEqual([]);
    expect(mockAuth.deleteFirebaseUser).toHaveBeenCalledTimes(1);
    expect(mockFirestore.deleteDocument).toHaveBeenCalledWith('users/user123');
    expect(mockSecurityLog.deleteAll).toHaveBeenCalledWith('user123');
  });

  it('runs reauthentication before any destructive step', async () => {
    await service.deleteAccount();

    expect(order[0]).toBe('reauth');
  });

  it('aborts with nothing deleted when reauthentication fails', async () => {
    mockAuth.reauthenticate.and.rejectWith(new Error('popup closed'));

    const report = await service.deleteAccount();

    expect(report.ok).toBeFalse();
    expect(report.failed.map(f => f.step)).toEqual(['reauth']);
    expect(order).toEqual([]);
    expect(mockTransactions.deleteAllTransactions).not.toHaveBeenCalled();
    expect(mockAuth.deleteFirebaseUser).not.toHaveBeenCalled();
  });

  it('continues past a failing step and reports it', async () => {
    mockBudgets.deleteAll.and.rejectWith(new Error('offline'));

    const report = await service.deleteAccount();

    expect(report.ok).toBeFalse();
    expect(report.failed.map(f => f.step)).toEqual(['budgets']);
    expect(mockRecurring.deleteAll).toHaveBeenCalled();
    expect(mockSecurityLog.deleteAll).toHaveBeenCalled();
    expect(mockFirestore.deleteDocument).toHaveBeenCalled();
  });

  it('keeps the auth user while any firestore step failed', async () => {
    mockCategories.deleteAll.and.rejectWith(new Error('offline'));

    await service.deleteAccount();

    expect(mockAuth.deleteFirebaseUser).not.toHaveBeenCalled();
  });

  it('deletes security events after the other collections and the user doc after all of them', async () => {
    await service.deleteAccount();

    const collectionSteps: DeletionStep[] = [
      'transactions', 'categories', 'budgets', 'recurring', 'goals', 'savedSearches',
      'searchAnswers', 'categoryMemory', 'tagMemory', 'imports', 'insightSnapshots',
      'secrets', 'feedback'
    ];
    const securityIndex = order.indexOf('securityEvents');
    const userDocIndex = order.indexOf('userDoc');

    for (const step of collectionSteps) {
      expect(order.indexOf(step)).toBeLessThan(securityIndex, `${step} should run before securityEvents`);
    }
    expect(securityIndex).toBeLessThan(userDocIndex);
    expect(userDocIndex).toBeLessThan(order.indexOf('authUser'));
  });

  it('still deletes the auth user when only device-local cleanup failed', async () => {
    mockQueue.clearAll.and.rejectWith(new Error('idb unavailable'));

    const report = await service.deleteAccount();

    expect(report.ok).toBeFalse();
    expect(report.failed.map(f => f.step)).toEqual(['offlineQueue']);
    expect(mockAuth.deleteFirebaseUser).toHaveBeenCalledTimes(1);
  });

  it('clears the share stash between the offline queue and the cloud steps', async () => {
    await service.deleteAccount();

    const shareIndex = order.indexOf('shareStash');
    expect(order.indexOf('offlineQueue')).toBeLessThan(shareIndex);
    expect(shareIndex).toBeLessThan(order.indexOf('transactions'));
  });

  it('still deletes the auth user when only the share stash cleanup failed', async () => {
    mockShareIntake.clearAll.and.rejectWith(new Error('idb unavailable'));

    const report = await service.deleteAccount();

    expect(report.ok).toBeFalse();
    expect(report.failed.map(f => f.step)).toEqual(['shareStash']);
    expect(mockAuth.deleteFirebaseUser).toHaveBeenCalledTimes(1);
  });

  it('drops this device\'s reminder and recap state for the erased account only', async () => {
    const other = 'user456';
    const keys = [
      reminderSentStorageKey('user123'),
      weeklyRecapStorageKeys('user123').dismissed,
      weeklyRecapStorageKeys('user123').narrative
    ];
    const survivors = [
      reminderSentStorageKey(other),
      weeklyRecapStorageKeys(other).dismissed,
      weeklyRecapStorageKeys(other).narrative
    ];
    for (const key of [...keys, ...survivors]) {
      localStorage.setItem(key, 'x');
    }

    const report = await service.deleteAccount();

    expect(report.ok).toBeTrue();
    for (const key of keys) {
      expect(localStorage.getItem(key)).withContext(`${key} should be gone`).toBeNull();
    }
    for (const key of survivors) {
      expect(localStorage.getItem(key)).withContext(`${key} should survive`).toBe('x');
    }
  });

  it('can be re-run after a partial failure', async () => {
    mockBudgets.deleteAll.and.rejectWith(new Error('offline'));
    const first = await service.deleteAccount();
    expect(first.ok).toBeFalse();
    expect(mockAuth.deleteFirebaseUser).not.toHaveBeenCalled();

    track(mockBudgets.deleteAll, 'budgets', 0);
    const second = await service.deleteAccount();

    expect(second.ok).toBeTrue();
    expect(second.failed).toEqual([]);
    expect(mockAuth.deleteFirebaseUser).toHaveBeenCalledTimes(1);
  });

  it('throws when nobody is signed in', async () => {
    (mockAuth.userId as unknown as jasmine.Spy).and.returnValue(null);

    await expectAsync(service.deleteAccount()).toBeRejected();
    expect(mockAuth.reauthenticate).not.toHaveBeenCalled();
  });
});
