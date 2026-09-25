// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  deleteDoc,
  Firestore
} from '@angular/fire/firestore';

import { ExportDialogComponent } from './export-dialog.component';
import { ExportService, ReportData } from '../../../core/services/export.service';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { StorageService } from '../../../core/services/storage.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { Transaction, Category } from '../../../models';
import { silenceFirebaseWarnings } from '../../../core/services/testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for the export dialog's report PDF against the
 * Firestore emulator.
 *
 * #429 P1: the dialog used to convert every past transaction at whatever
 * rate happened to be loaded when it opened (a live `convert()`), so the
 * report PDF and the summary PDF of the same period could print different
 * totals. The unit spec proves this with a mocked CurrencyService; this
 * suite proves it against a real write: two transactions land through the
 * real TransactionService (so the base-currency snapshot is stamped by the
 * production write path, at whatever rate is loaded at that moment), the
 * live rate table is then moved, and the dialog's report totals must still
 * equal the snapshots read back off the emulator.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('ExportDialogComponent report PDF (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  const createdTransactions: string[] = [];

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `export-dialog-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await Promise.all(
      createdTransactions.map(id =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  it("prints the stamped snapshots' totals even after the live rate moves", async () => {
    // Mutated in place below, after the write, so MAT_DIALOG_DATA's value
    // carries the real written rows by the time the component is created.
    const dialogData: {
      transactions: Transaction[];
      categories: Category[];
      dateRange: { start: Date; end: Date };
      currency: string;
    } = {
      transactions: [],
      categories: [],
      dateRange: { start: new Date(2026, 5, 1), end: new Date(2026, 5, 30) },
      currency: 'USD',
    };

    const dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const exportService = jasmine.createSpyObj('ExportService', ['exportToPDF']);
    exportService.exportToPDF.and.returnValue(Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })));
    exportService.downloadBlobWithPicker =
      jasmine.createSpy('downloadBlobWithPicker').and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [ExportDialogComponent],
      providers: [
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        {
          provide: AuthService,
          useValue: { userId: () => uid, currentUser: () => ({ preferences: { baseCurrency: 'USD' } }) }
        },
        // Receipts and quota play no part in these writes.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } },
        CurrencyService,
        { provide: TranslationService, useValue: { t: (key: string) => key, getIntlLocale: () => 'en-US' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: ExportService, useValue: exportService },
      ],
    });

    const transactionService = TestBed.inject(TransactionService);
    const currencyService = TestBed.inject(CurrencyService);
    await currencyService.ensureRatesLoaded();
    // The rate the two rows below are stamped against.
    currencyService.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.5]]));

    const expenseId = await transactionService.addTransaction({
      type: 'expense',
      amount: 100,
      currency: 'EUR',
      categoryId: 'cat-food',
      description: 'Dinner in Lyon',
      date: new Date(2026, 5, 15, 12),
    });
    createdTransactions.push(expenseId);

    const incomeId = await transactionService.addTransaction({
      type: 'income',
      amount: 200,
      currency: 'EUR',
      categoryId: 'cat-salary',
      description: 'Freelance payment',
      date: new Date(2026, 5, 10, 12),
    });
    createdTransactions.push(incomeId);

    const expenseDoc = (await getDoc(doc(firestore, `users/${uid}/transactions/${expenseId}`))).data() as Transaction;
    const incomeDoc = (await getDoc(doc(firestore, `users/${uid}/transactions/${incomeId}`))).data() as Transaction;

    // The live table moves after both snapshots were stamped. A regression
    // that converts live here would report a different total from this point
    // on; only the stamped snapshot survives this move.
    currencyService.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.2]]));

    dialogData.transactions = [
      { ...expenseDoc, id: expenseId },
      { ...incomeDoc, id: incomeId },
    ];

    const fixture = TestBed.createComponent(ExportDialogComponent);
    fixture.componentInstance.selectedFormat = 'pdf';
    await fixture.componentInstance.export();

    const reportData: ReportData = exportService.exportToPDF.calls.mostRecent().args[0];
    expect(reportData.summary.expense).toBe(expenseDoc.amountInBaseCurrency);
    expect(reportData.summary.income).toBe(incomeDoc.amountInBaseCurrency);
    expect(reportData.summary.byCategory).toEqual([
      { categoryId: 'cat-food', total: expenseDoc.amountInBaseCurrency },
    ]);
  }, 20000);
});
