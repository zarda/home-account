// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of } from 'rxjs';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  deleteDoc,
  getDocs,
  query,
  where,
  Firestore
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';

import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { FirestoreService } from '../../core/services/firestore.service';
import { StorageService } from '../../core/services/storage.service';
import { TransactionService } from '../../core/services/transaction.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { BudgetService } from '../../core/services/budget.service';
import { ReceiptQuotaService } from '../../core/services/receipt-quota.service';
import { AIStrategyService } from '../../core/services/ai-strategy.service';
import { AIImportService } from '../../core/services/ai-import.service';
import { ReceiptToNoteService } from '../../core/services/receipt-to-note.service';
import { Transaction } from '../../models';

/**
 * Integration smoke test for the transaction form's tag and location fields
 * against the emulators: the real component driving the real
 * TransactionService/FirestoreService, with firestore.rules live.
 *
 * The unit spec mocks TransactionService, so nothing there proves the
 * form → DTO → Firestore → rules chain actually accepts tags and location —
 * which is the whole point of surfacing fields that were persisted-only.
 *
 * The component renders headlessly (template overridden), as its unit spec
 * does: the chip input and the geolocation button are unit-tested; what only
 * the emulator can prove is what lands in the document.
 *
 * Note: `| translate` renders raw keys under Karma because src/assets/i18n
 * is not served by the test asset config.
 *
 * Teardown follows app.smoke.spec.ts: the SDK is terminated (deleteApp)
 * inside the LAST spec while its injector is alive, and the test module is
 * kept undestroyed — @angular/fire routes Firestore's late async callbacks
 * through the injector captured at call time, and a destroyed one turns
 * those no-op callbacks into NG0205 crashes in afterAll.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
// Declaration order matters: the last spec tears the shared SDK down.
jasmine.getEnv().configure({ random: false });

describe('TransactionFormComponent tags and location (emulator smoke test)', () => {
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

  const createdDescriptions: string[] = [];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `transaction-form-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  /** Runs at the tail of the LAST spec, while its injector is alive. */
  async function teardownFirebase(): Promise<void> {
    // Sweep every row this suite wrote, looked up by description.
    for (const description of createdDescriptions) {
      const snapshot = await getDocs(
        query(
          collection(firestore, `users/${uid}/transactions`),
          where('description', '==', description)
        )
      ).catch(() => null);
      for (const row of snapshot?.docs ?? []) {
        await deleteDoc(doc(firestore, `users/${uid}/transactions/${row.id}`)).catch(() => undefined);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await deleteApp(app).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionFormComponent],
      providers: [
        provideHttpClient(),
        provideNoopAnimations(),
        provideNativeDateAdapter(),
        TransactionService,
        FirestoreService,
        StorageService,
        { provide: Firestore, useValue: firestore },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // Rates play no part; the real service fetches in its constructor.
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: async () => undefined,
            getExchangeRate: () => 1,
            amountInBase: (t: Transaction) => t.amountInBaseCurrency,
            getSupportedCurrencies: () => [{ code: 'USD', name: 'US Dollar', symbol: '$' }]
          }
        },
        { provide: BudgetService, useValue: { recalculateBudgetsForCategory: async () => undefined } },
        {
          provide: ReceiptQuotaService,
          useValue: {
            canAddImages: async () => true,
            noteImagesAdded: () => undefined,
            noteImagesRemoved: () => undefined
          }
        },
        // AI stays inert: this suite is about what the form persists. The real
        // AIStrategyService would pull in the provider-key read, the native
        // plugins and a constructor effect over the stubbed AuthService, none
        // of which this suite has any use for.
        {
          provide: AIStrategyService,
          useValue: {
            hasAnyEngine: () => false,
            canProcessNow: () => false,
            canUseCloud: () => false,
            processReceipt: async () => { throw new Error('AI is inert in this suite'); },
            suggestCategory: async () => null,
          }
        },
        { provide: AIImportService, useValue: {} },
        { provide: ReceiptToNoteService, useValue: {} },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(false) }) } },
        {
          provide: MatDialogRef,
          useValue: { close: () => undefined, afterClosed: () => of(undefined) }
        },
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'add' } }
      ],
      // Keep the module (and its injector) alive after each spec — see the
      // header note on NG0205.
      teardown: { destroyAfterEach: false }
    })
      .overrideComponent(TransactionFormComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  const readBack = async (description: string): Promise<Record<string, unknown>> => {
    const snapshot = await getDocs(
      query(
        collection(firestore, `users/${uid}/transactions`),
        where('description', '==', description)
      )
    );
    expect(snapshot.size).toBe(1);
    return snapshot.docs[0].data() as Record<string, unknown>;
  };

  it('persists typed tags and location through the real write path', async () => {
    const description = `smoke-tags-location-${Date.now()}`;
    createdDescriptions.push(description);

    const fixture = TestBed.createComponent(TransactionFormComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    component.form.patchValue({
      type: 'expense',
      amount: '12.5',
      currency: 'USD',
      categoryId: 'food_groceries',
      description,
      date: new Date(),
      locationName: 'Aoyama Market'
    });
    const chipInput = { clear: () => undefined };
    component.addTag({ value: 'Groceries', chipInput } as never);
    component.addTag({ value: 'reimbursable', chipInput } as never);
    component.locationCoords.set({ lat: 35.66, lng: 139.71 });

    await component.onSubmit();

    // The document made it through firestore.rules with both fields intact.
    const row = await readBack(description);
    expect(row['tags']).toEqual(['groceries', 'reimbursable']);
    expect(row['location']).toEqual({ name: 'Aoyama Market', lat: 35.66, lng: 139.71 });

    fixture.destroy();
  }, 20000);

  it('degrades to a name-only location when geolocation is denied', async () => {
    const description = `smoke-location-denied-${Date.now()}`;
    createdDescriptions.push(description);

    const fixture = TestBed.createComponent(TransactionFormComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((success, error) => {
      (error as PositionErrorCallback)({ code: 1 } as GeolocationPositionError);
    });
    component.useMyLocation();

    component.form.patchValue({
      type: 'expense',
      amount: '8',
      currency: 'USD',
      categoryId: 'food_groceries',
      description,
      date: new Date(),
      locationName: 'Aoyama Market'
    });

    await component.onSubmit();

    const row = await readBack(description);
    const location = row['location'] as Record<string, unknown>;
    expect(location['name']).toBe('Aoyama Market');
    // Denial leaves no coordinates behind — name-only, exactly as typed.
    expect('lat' in location).toBeFalse();
    expect('lng' in location).toBeFalse();

    // Last spec: terminate the SDK while this injector is still alive.
    fixture.destroy();
    await teardownFirebase();
  }, 30000);
});
