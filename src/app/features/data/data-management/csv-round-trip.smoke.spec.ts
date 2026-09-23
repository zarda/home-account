// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// The unit specs mock both ExportService.importFromCSV and parseImportedData,
// so nothing in that suite can prove the actual write: that a CSV round trip
// through this door keeps a row's real category and a tag containing the
// join separator. Only a real parse against a real, emulator-backed catalog
// — the shape CategoryService actually loads it in, not a fixture with
// predictable ids — can show that.
//
// Runs only under the emulators:
//   npx firebase emulators:exec --only auth,storage,firestore --project demo-home-account \
//     "npx ng test --watch=false --browsers=ChromeHeadless --include='**/csv-round-trip.smoke.spec.ts'"
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  doc,
  getDoc,
  deleteDoc,
  Firestore,
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';

import { DataManagementComponent } from './data-management.component';
import { ExportService } from '../../../core/services/export.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { BudgetService } from '../../../core/services/budget.service';
import { GoalService } from '../../../core/services/goal.service';
import { RecurringService } from '../../../core/services/recurring.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { ImportHistoryService } from '../../../core/services/import-history.service';
import { BackupRestoreService } from '../../../core/services/backup-restore.service';
import { AccountDeletionService } from '../../../core/services/account-deletion.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { MatDialog } from '@angular/material/dialog';
import { MockAuthService, createMockUser } from '../../../core/services/testing/mock-auth.service';
import { createTranslationStub, createLocaleFormatStub } from '../../../core/services/testing/translation-stub';
import { silenceFirebaseWarnings } from '../../../core/services/testing/silence-firebase-warnings';

silenceFirebaseWarnings();

describe('CSV round trip through the data-management door (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let expenseCategoryId: string;
  let incomeCategoryId: string;

  const run = `${Date.now()}`;
  const createdTransactionIds: string[] = [];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com',
      },
      `csv-round-trip-smoke-${run}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Real, emulator-assigned ids — not the predictable fixture ids a unit
    // spec's CategoryService stub hands out — so a name collision with a
    // shipped default can't hide a resolver bug that only shows up once ids
    // stop lining up with names by construction.
    const expenseCategory = await addDoc(collection(firestore, `users/${uid}/categories`), {
      userId: uid,
      name: `Ramen Shops ${run}`,
      icon: 'ramen_dining',
      color: '#FF7043',
      type: 'expense',
      order: 100,
      isActive: true,
      isDefault: false,
    });
    expenseCategoryId = expenseCategory.id;

    const incomeCategory = await addDoc(collection(firestore, `users/${uid}/categories`), {
      userId: uid,
      name: `Freelance Gig ${run}`,
      icon: 'work',
      color: '#66BB6A',
      type: 'income',
      order: 101,
      isActive: true,
      isDefault: false,
    });
    incomeCategoryId = incomeCategory.id;
  });

  afterAll(async () => {
    await deleteDoc(doc(firestore, `users/${uid}/categories/${expenseCategoryId}`)).catch(() => undefined);
    await deleteDoc(doc(firestore, `users/${uid}/categories/${incomeCategoryId}`)).catch(() => undefined);
    await Promise.all(
      createdTransactionIds.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  let component: DataManagementComponent;
  let transactionService: TransactionService;
  let categoryService: CategoryService;

  beforeEach(() => {
    const mockAuth = new MockAuthService();
    mockAuth.setMockUser(createMockUser(uid));

    // The template that would read `imageCount` is never rendered here, so
    // the stub only has to answer what the constructor's best-effort refresh
    // reaches — but that call chains `.catch` straight off the return value
    // with no `await`, so an unresolved spy throws synchronously before the
    // component even finishes constructing.
    const receiptQuota = jasmine.createSpyObj('ReceiptQuotaService', [
      'refreshCount', 'hasUnlimitedImages', 'imageLimit',
      'canAddImages', 'noteImagesAdded', 'noteImagesRemoved', 'invalidateCount',
    ]);
    receiptQuota.refreshCount.and.resolveTo(0);

    TestBed.configureTestingModule({
      imports: [DataManagementComponent],
      providers: [
        provideRouter([]),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth },
        // Every row here is USD-in-USD; stubbed the same way the backup
        // restore smoke test stubs it, purely to keep the rates fetch off
        // the network rather than to test any conversion.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: { amountInBaseCurrency?: number; amount: number }) =>
              t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1,
            convert: (amount: number) => amount,
          },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: BudgetService, useValue: jasmine.createSpyObj('BudgetService', ['recalculateBudgetsForCategory']) },
        { provide: GoalService, useValue: jasmine.createSpyObj('GoalService', ['exportAll']) },
        { provide: RecurringService, useValue: jasmine.createSpyObj('RecurringService', ['exportAll']) },
        { provide: InsightSnapshotService, useValue: jasmine.createSpyObj('InsightSnapshotService', ['exportAll', 'deleteAll']) },
        { provide: SearchHistoryService, useValue: jasmine.createSpyObj('SearchHistoryService', ['exportAll']) },
        { provide: SearchAnswerHistoryService, useValue: jasmine.createSpyObj('SearchAnswerHistoryService', ['exportAll']) },
        { provide: CategoryMemoryService, useValue: jasmine.createSpyObj('CategoryMemoryService', ['exportAll']) },
        { provide: TagMemoryService, useValue: jasmine.createSpyObj('TagMemoryService', ['exportAll']) },
        { provide: ImportHistoryService, useValue: jasmine.createSpyObj('ImportHistoryService', ['exportAll']) },
        { provide: BackupRestoreService, useValue: jasmine.createSpyObj('BackupRestoreService', ['parse', 'describe', 'restore']) },
        { provide: AccountDeletionService, useValue: jasmine.createSpyObj('AccountDeletionService', ['deleteAccount']) },
        { provide: ReceiptQuotaService, useValue: receiptQuota },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
      ],
    });

    // Every other dependency — ExportService, TransactionService,
    // CategoryService, their own FirestoreService/StorageService — is
    // root-provided and constructed for real against the emulator instances
    // above: this suite is about what the real parse and the real write do.
    component = TestBed.createComponent(DataManagementComponent).componentInstance;
    transactionService = TestBed.inject(TransactionService);
    categoryService = TestBed.inject(CategoryService);
  });

  /** Steps until `predicate` holds, rather than sleeping a guessed span. */
  async function until(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error('the import never reached the expected state');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  it('keeps both categories and a tag containing the join separator through export and reimport', async () => {
    // DataManagementComponent never calls loadCategories itself (unlike the
    // routes that render categories), so nothing else in this run would put
    // the two docs written above onto the shared signal parseCSV reads. A
    // one-shot server read, not the live listener: nothing here needs to
    // react to a later write.
    categoryService.categories.set(await categoryService.exportAll());

    const exportService = TestBed.inject(ExportService);

    const sourceExpenseId = await transactionService.addTransaction({
      type: 'expense',
      amount: 18.5,
      currency: 'USD',
      categoryId: expenseCategoryId,
      description: `Tonkotsu ${run}`,
      date: new Date(2026, 5, 1),
    });
    const sourceIncomeId = await transactionService.addTransaction({
      type: 'income',
      amount: 450,
      currency: 'USD',
      categoryId: incomeCategoryId,
      description: `Logo design ${run}`,
      date: new Date(2026, 5, 2),
      tags: ['a; b'],
    });
    createdTransactionIds.push(sourceExpenseId, sourceIncomeId);

    // Read back what was actually stored — the export has to reflect the
    // written documents, not the in-memory DTOs used to create them.
    const [expenseSource, incomeSource] = await Promise.all([
      transactionService.getTransactionOnce(sourceExpenseId),
      transactionService.getTransactionOnce(sourceIncomeId),
    ]);
    if (!expenseSource || !incomeSource) {
      throw new Error('the source transactions were not written');
    }

    const blob = exportService.exportToCSV([expenseSource, incomeSource]);
    const csvText = await blob.text();
    const file = new File([csvText], 'export.csv', { type: 'text/csv' });

    const addSpy = spyOn(transactionService, 'addTransaction').and.callThrough();

    component.onFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    await until(() => component.showImportPreview());
    expect(component.unmatchedCategoryCount()).toBe(0);

    component.confirmImport();
    await until(() => addSpy.calls.count() >= 2);

    const newIds = await Promise.all(addSpy.calls.all().map(call => call.returnValue));
    createdTransactionIds.push(...newIds);

    const written = await Promise.all(
      newIds.map(id => getDoc(doc(firestore, `users/${uid}/transactions/${id}`)))
    );
    const byCategory = (categoryId: string) =>
      written.find(snapshot => snapshot.data()?.['categoryId'] === categoryId)?.data();

    expect(byCategory(expenseCategoryId)).toBeTruthy();
    const incomeDoc = byCategory(incomeCategoryId);
    expect(incomeDoc).toBeTruthy();
    expect(incomeDoc?.['tags']).toEqual(['a; b']);
  }, 30000);
});
