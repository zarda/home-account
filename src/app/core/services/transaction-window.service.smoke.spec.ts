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
      location: { name: string; lat?: number; lng?: number };
      note: string;
      tags: string[];
      goalId: string;
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
    ...(overrides.note ? { note: overrides.note } : {}),
    ...(overrides.tags ? { tags: overrides.tags } : {}),
    // A link carries its converted figure (ADR 0027); the amount is
    // irrelevant to the filter, the pair is what the rules require.
    ...(overrides.goalId ? { goalId: overrides.goalId, goalAmount: 10 } : {})
  });

  const SEEDED = [
    txn('txn-espresso', {
      description: 'Morning espresso',
      categoryId: 'cat-coffee',
      hoursAgo: 0,
      tags: ['reimbursable'],
      goalId: 'goal-alpha'
    }),
    txn('txn-bus', {
      description: 'Bus ticket',
      hoursAgo: 1,
      tags: ['reimbursable', 'travel'],
      goalId: 'goal-beta'
    }),
    txn('txn-market', {
      description: 'Fruit',
      hoursAgo: 2,
      // Coordinates on the map: searchableFields reads only location.name,
      // so a widened location must not disturb the name match below.
      location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 }
    }),
    txn('txn-salary', { description: 'Salary', categoryId: 'cat-salary', type: 'income', hoursAgo: 3 }),
    txn('txn-toffee', { description: 'Toffee crisps', hoursAgo: 4 }),
    // Forty days back and linked: what proves a goal filter reaches past the
    // page's default this-month window.
    txn('txn-old', {
      description: 'Old espresso machine',
      hoursAgo: 24 * 40,
      tags: ['travel'],
      goalId: 'goal-alpha'
    })
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
      'txn-toffee',
      'txn-old'
    ]);
  });

  it('falls back to typo-tolerant matching when nothing matches exactly', async () => {
    await service.reset({ searchQuery: 'espreso' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso', 'txn-old']);
  });

  it('suppresses fuzzy near-misses when an exact match exists', async () => {
    // "toffee" hits txn-toffee exactly; the one-edit-away category name
    // "Coffee & Tea" must not pull txn-espresso in via the fuzzy fallback.
    await service.reset({ searchQuery: 'toffee' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-toffee']);
  });

  it('matches transactions by their category display name', async () => {
    await service.reset({ searchQuery: 'coffee' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso']);
  });

  it('matches transactions by location name', async () => {
    // The seeded location also carries lat/lng — the name match must not
    // depend on the map holding only a name.
    await service.reset({ searchQuery: 'aoyama' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-market']);
  });

  it('narrows the window to transactions carrying a tag', async () => {
    await service.reset({ tags: ['reimbursable'] });
    // Server date order is preserved through the client-side narrowing.
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso', 'txn-bus']);
  });

  it('requires every selected tag', async () => {
    await service.reset({ tags: ['reimbursable', 'travel'] });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-bus']);
  });

  it('matches a tag through free-text search too', async () => {
    // Tags were already in the searchable field set before they became
    // filterable; the filter must not have displaced the search path.
    await service.reset({ searchQuery: 'reimbursable' });
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso', 'txn-bus']);
  });

  it('keeps server-side filters constraining the window alongside a tag filter', async () => {
    await service.reset({
      type: 'expense',
      startDate: new Date(BASE - 12 * HOUR),
      endDate: new Date(BASE),
      tags: ['travel']
    });

    // txn-old carries the tag but is outside the server-side date range;
    // txn-bus is the only in-range expense with it.
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-bus']);

    // The aggregate total still reports the SERVER count (4 in-range
    // expenses): the tag narrows client-side, which is why the page header
    // must treat a tag filter as client-only and show N+ instead.
    const deadline = Date.now() + 5000;
    while (service.totalCount() === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(service.totalCount()).toBe(4);
  });

  describe('goal filter', () => {
    // NOTE: the emulator does not enforce composite indexes, so these pass
    // whether or not firestore.indexes.json carries the goalId+date pair.
    // The index file is reviewed, not tested; production needs the deploy.

    it('narrows to one goal across every date, the goal-card hand-off shape', async () => {
      // Exactly what the goal card applies: a filter naming only the goal,
      // so nothing windows it to the current month.
      await service.reset({ goalId: 'goal-alpha' });

      // Forty days apart, both present, in server date order.
      expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso', 'txn-old']);
    });

    it('counts the filtered set exactly, because the filter runs server-side', async () => {
      await service.reset({ goalId: 'goal-alpha' });

      const deadline = Date.now() + 5000;
      while (service.totalCount() === null && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      // A client-side goal filter would leave this at the unfiltered 6 and
      // cost the page header its exact count (it would render "2+").
      expect(service.totalCount()).toBe(2);
    });

    it('excludes rows linked to another goal and rows linked to none', async () => {
      await service.reset({ goalId: 'goal-beta' });
      expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-bus']);
    });

    it('composes with a date range, both constraints server-side', async () => {
      await service.reset({
        goalId: 'goal-alpha',
        startDate: new Date(BASE - 12 * HOUR),
        endDate: new Date(BASE)
      });

      // txn-old carries the goal but falls outside the range.
      expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso']);
    });
  });

  it('narrows the window to a category inside a date range (chart drill-down shape)', async () => {
    // Exactly what the spending chart hands over when a slice is clicked.
    await service.reset({
      categoryId: 'cat-transport',
      type: 'expense',
      startDate: new Date(BASE - 12 * HOUR),
      endDate: new Date(BASE)
    });

    // txn-espresso is another category, txn-salary another type, txn-old
    // outside the range — all three excluded server-side.
    expect(service.visibleWindow().map(t => t.id)).toEqual([
      'txn-bus',
      'txn-market',
      'txn-toffee'
    ]);

    const deadline = Date.now() + 5000;
    while (service.totalCount() === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    // Every constraint is server-side here, so the count is exact rather
    // than the N+ a client-side narrowing would force.
    expect(service.totalCount()).toBe(3);
  });

  it('keeps server-side filters constraining the window alongside search', async () => {
    await service.reset({
      type: 'expense',
      startDate: new Date(BASE - 12 * HOUR),
      endDate: new Date(BASE),
      searchQuery: 'espresso'
    });

    // txn-old (out of range) and txn-salary (income) are excluded server-side;
    // search narrows the remaining four to the espresso purchase.
    expect(service.visibleWindow().map(t => t.id)).toEqual(['txn-espresso']);

    // reset() fires the aggregate count without awaiting it; give the
    // emulator round trip a bounded window instead of racing it.
    const deadline = Date.now() + 5000;
    while (service.totalCount() === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(service.totalCount()).toBe(4);
  });
});
