// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { TranslationService } from './translation.service';
import { TransactionWindowService } from './transaction-window.service';

/**
 * Integration smoke test for the transaction search path against the
 * Firestore emulator.
 *
 * The windowed transaction list resolves search queries client-side over the
 * fetched window, including fields a transaction row does not carry itself:
 * the category display name (joined through CategoryService) and the saved
 * location name. This exercises that join with real Firestore documents,
 * real server-side where clauses, and the real CategoryService merge of
 * user categories over defaults.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('TransactionWindowService search (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  const BASE = Date.UTC(2026, 5, 30, 12);
  const HOUR = 60 * 60 * 1000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let service: TransactionWindowService;

  const txn = (
    id: string,
    overrides: Partial<{
      description: string;
      categoryId: string;
      type: 'expense' | 'income';
      hoursAgo: number;
      location: { name: string };
      note: string;
    }>
  ) => ({
    id,
    description: overrides.description ?? 'row',
    categoryId: overrides.categoryId ?? 'cat-transport',
    type: overrides.type ?? 'expense',
    amount: 10,
    currency: 'USD',
    amountInBaseCurrency: 10,
    exchangeRate: 1,
    date: Timestamp.fromMillis(BASE - (overrides.hoursAgo ?? 0) * HOUR),
    isRecurring: false,
    ...(overrides.location ? { location: overrides.location } : {}),
    ...(overrides.note ? { note: overrides.note } : {})
  });

  const SEEDED = [
    txn('txn-espresso', { description: 'Morning espresso', categoryId: 'cat-coffee', hoursAgo: 0 }),
    txn('txn-bus', { description: 'Bus ticket', hoursAgo: 1 }),
    txn('txn-market', { description: 'Fruit', hoursAgo: 2, location: { name: 'Aoyama Market' } }),
    txn('txn-salary', { description: 'Salary', categoryId: 'cat-salary', type: 'income', hoursAgo: 3 }),
    txn('txn-old', { description: 'Old espresso machine', hoursAgo: 24 * 40 })
  ];

  const CATEGORIES = [
    { id: 'cat-coffee', name: 'Coffee & Tea', type: 'expense' },
    { id: 'cat-transport', name: 'Getting Around', type: 'expense' },
    { id: 'cat-salary', name: 'Salary', type: 'income' }
  ];

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `transaction-window-search-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded with the raw SDK: the TestBed cannot be configured here, because
    // beforeAll runs before the framework's per-test auto-reset.
    await Promise.all([
      ...SEEDED.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      ),
      ...CATEGORIES.map(({ id, ...data }, i) =>
        setDoc(doc(firestore, `users/${uid}/categories/${id}`), {
          ...data,
          userId: uid,
          icon: 'category',
          color: '#FF5722',
          order: i,
          isActive: true,
          isDefault: false
        })
      )
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      ...SEEDED.map(t =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${t.id}`)).catch(() => undefined)
      ),
      ...CATEGORIES.map(c =>
        deleteDoc(doc(firestore, `users/${uid}/categories/${c.id}`)).catch(() => undefined)
      )
    ]);
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        TransactionWindowService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid } },
        // Custom category names are literal strings; defaults pass through
        // as their translation keys.
        { provide: TranslationService, useValue: { t: (key: string) => key } }
      ]
    });
    service = TestBed.inject(TransactionWindowService);
    await firstValueFrom(TestBed.inject(CategoryService).loadCategories());
  });

  it('loads the seeded window', async () => {
    await service.reset();
    expect(service.visibleWindow().map(t => t.id)).toEqual([
      'txn-espresso',
      'txn-bus',
      'txn-market',
      'txn-salary',
      'txn-old'
    ]);
  });

  it('matches transactions by their category display name', async () => {
    await service.reset({ searchQuery: 'coffee' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso']);
  });

  it('matches transactions by location name', async () => {
    await service.reset({ searchQuery: 'aoyama' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-market']);
  });

  it('keeps server-side filters constraining the window alongside search', async () => {
    await service.reset({
      type: 'expense',
      startDate: new Date(BASE - 12 * HOUR),
      endDate: new Date(BASE),
      searchQuery: 'espresso'
    });

    // txn-old (out of range) and txn-salary (income) are excluded server-side;
    // search narrows the rest to the espresso purchase.
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso']);

    await Promise.resolve();
    expect(service.totalCount()).toBe(3);
  });
});
