// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';

/**
 * Enforcement tests for firestore.rules against the Firestore emulator.
 *
 * Two things make these worth having. First, the rules validate field shapes,
 * and a validator that is too strict breaks the app while a validator that is
 * too loose fails to protect it — so every collection asserts both a rejected
 * malformed write AND an accepted legitimate one, including the partial
 * updates the services actually issue. Second, rules are additive: the
 * catch-all under /users/{userId} would re-grant write access to collections
 * the explicit blocks validate, so the carve-out has its own regression test.
 *
 * Runs only under the emulators:
 *   npm run smoke
 */
describe('firestore.rules (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let otherUid: string;

  /** Resolves true when the write was allowed, false on permission-denied. */
  async function allowed(write: Promise<unknown>): Promise<boolean> {
    try {
      await write;
      return true;
    } catch {
      return false;
    }
  }

  async function expectAllowed(write: Promise<unknown>, what: string): Promise<void> {
    expect(await allowed(write)).toBe(true, `expected ${what} to be allowed`);
  }

  async function expectDenied(write: Promise<unknown>, what: string): Promise<void> {
    expect(await allowed(write)).toBe(false, `expected ${what} to be denied`);
  }

  const validTransaction = (overrides: Record<string, unknown> = {}) => ({
    userId: uid,
    type: 'expense',
    amount: 12.5,
    currency: 'USD',
    amountInBaseCurrency: 12.5,
    exchangeRate: 1,
    categoryId: 'food_groceries',
    description: 'rules smoke',
    date: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false,
    ...overrides
  });

  const validBudget = (overrides: Record<string, unknown> = {}) => ({
    userId: uid,
    categoryId: 'food',
    name: 'Groceries',
    amount: 400,
    currency: 'USD',
    period: 'monthly',
    startDate: Timestamp.now(),
    spent: 0,
    isActive: true,
    alertThreshold: 80,
    ...overrides
  });

  const validCategory = (overrides: Record<string, unknown> = {}) => ({
    userId: uid,
    name: 'Custom',
    icon: 'star',
    color: '#FF0000',
    type: 'expense',
    order: 1,
    isActive: true,
    isDefault: false,
    ...overrides
  });

  const validRecurring = (overrides: Record<string, unknown> = {}) => ({
    userId: uid,
    name: 'Salary',
    type: 'income',
    amount: 1000,
    currency: 'USD',
    categoryId: 'employment_salary',
    description: 'monthly salary',
    frequency: { type: 'monthly', interval: 1 },
    startDate: Timestamp.now(),
    nextOccurrence: Timestamp.now(),
    isActive: true,
    ...overrides
  });

  const validSearch = (overrides: Record<string, unknown> = {}) => ({
    userId: uid,
    query: 'coffee',
    pinned: false,
    lastUsedAt: Timestamp.now(),
    ...overrides
  });

  const validImport = (overrides: Record<string, unknown> = {}) => ({
    userId: uid,
    importedAt: Timestamp.now(),
    source: 'csv',
    fileType: 'bank_csv',
    fileName: 'statement.csv',
    status: 'completed',
    ...overrides
  });

  /** Unique document path per case so cases never collide. */
  let counter = 0;
  function path(collection: string, owner = uid): string {
    counter += 1;
    return `users/${owner}/${collection}/rules-smoke-${counter}`;
  }

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `firestore-rules-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    // A second anonymous account, captured before signing in as the account
    // every test runs as. Its uid is what the cross-tenant cases write.
    const stranger = await signInAnonymously(auth);
    otherUid = stranger.user.uid;

    await auth.signOut();
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  describe('transactions', () => {
    it('accepts a well-formed transaction', async () => {
      await expectAllowed(setDoc(doc(firestore, path('transactions')), validTransaction()), 'valid create');
    });

    it('accepts a transaction without the optional baseCurrency stamp', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction()),
        'create without baseCurrency'
      );
    });

    it('rejects a zero amount', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ amount: 0 })),
        'zero amount'
      );
    });

    it('rejects a negative amount', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ amount: -5 })),
        'negative amount'
      );
    });

    it('rejects an amount that is not a number', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ amount: '10' })),
        'string amount'
      );
    });

    it('rejects a type outside income/expense', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ type: 'transfer' })),
        'unknown type'
      );
    });

    it('rejects a missing required field', async () => {
      const payload = validTransaction();
      delete (payload as Record<string, unknown>)['categoryId'];
      await expectDenied(setDoc(doc(firestore, path('transactions')), payload), 'missing categoryId');
    });

    it('rejects a date that is not a timestamp', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ date: '2026-01-01' })),
        'string date'
      );
    });

    it("rejects writing another user's id into an owned document", async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ userId: otherUid })),
        'foreign userId'
      );
    });

    it('accepts the partial update the receipt flow issues', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction({ receiptUrl: 'https://example.test/r.png' }));
      await expectAllowed(
        updateDoc(doc(firestore, p), { receiptUrl: deleteField() }),
        'receiptUrl deletion'
      );
    });

    it('accepts the base-currency re-snapshot update', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          exchangeRate: 1.1,
          amountInBaseCurrency: 13.75,
          baseCurrency: 'EUR'
        }),
        'resnapshot update'
      );
    });

    it('rejects an update that zeroes the amount', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectDenied(updateDoc(doc(firestore, p), { amount: 0 }), 'update to zero amount');
    });

    it('rejects an update that repoints userId', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectDenied(updateDoc(doc(firestore, p), { userId: otherUid }), 'update to foreign userId');
    });

    it('allows the owner to delete', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectAllowed(deleteDoc(doc(firestore, p)), 'owner delete');
    });
  });

  describe('budgets', () => {
    it('accepts a well-formed budget', async () => {
      await expectAllowed(setDoc(doc(firestore, path('budgets')), validBudget()), 'valid create');
    });

    it('rejects an unknown period', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('budgets')), validBudget({ period: 'fortnightly' })),
        'unknown period'
      );
    });

    it('rejects a non-positive amount', async () => {
      await expectDenied(setDoc(doc(firestore, path('budgets')), validBudget({ amount: 0 })), 'zero amount');
    });

    // recalculateBudgetSpent writes this after every expense.
    it('accepts the { spent } partial update', async () => {
      const p = path('budgets');
      await setDoc(doc(firestore, p), validBudget());
      await expectAllowed(updateDoc(doc(firestore, p), { spent: 120 }), 'spent update');
    });

    it('accepts the { isActive } partial update', async () => {
      const p = path('budgets');
      await setDoc(doc(firestore, p), validBudget());
      await expectAllowed(updateDoc(doc(firestore, p), { isActive: false }), 'isActive update');
    });
  });

  describe('categories', () => {
    it('accepts a well-formed custom category', async () => {
      await expectAllowed(setDoc(doc(firestore, path('categories')), validCategory()), 'valid create');
    });

    // initializeDefaultCategories copies the document id into the body.
    it('tolerates the id copy that seeded defaults carry', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('categories')), validCategory({ id: 'food_groceries' })),
        'create with id field'
      );
    });

    it('rejects an unknown category type', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('categories')), validCategory({ type: 'savings' })),
        'unknown type'
      );
    });

    it('rejects a non-numeric order', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('categories')), validCategory({ order: 'first' })),
        'string order'
      );
    });

    it('accepts the { isActive } soft delete', async () => {
      const p = path('categories');
      await setDoc(doc(firestore, p), validCategory());
      await expectAllowed(updateDoc(doc(firestore, p), { isActive: false }), 'soft delete');
    });

    it('accepts the { order } reorder write', async () => {
      const p = path('categories');
      await setDoc(doc(firestore, p), validCategory());
      await expectAllowed(updateDoc(doc(firestore, p), { order: 4 }), 'reorder');
    });
  });

  describe('recurring', () => {
    it('accepts a well-formed recurring transaction', async () => {
      await expectAllowed(setDoc(doc(firestore, path('recurring')), validRecurring()), 'valid create');
    });

    it('rejects a malformed frequency', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ frequency: { type: 'hourly', interval: 1 } })),
        'unknown frequency type'
      );
    });

    it('rejects a frequency that is not a map', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ frequency: 'monthly' })),
        'string frequency'
      );
    });

    // The occurrence claim runs inside a transaction; a rejection there would
    // stall recurring posting rather than fail a single row.
    it('accepts the occurrence claim update', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring());
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          updatedAt: Timestamp.now(),
          nextOccurrence: Timestamp.now(),
          lastProcessed: Timestamp.now()
        }),
        'occurrence claim'
      );
    });

    it('accepts clearing the optional endDate', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring({ endDate: Timestamp.now() }));
      await expectAllowed(updateDoc(doc(firestore, p), { endDate: deleteField() }), 'endDate deletion');
    });
  });

  describe('savedSearches', () => {
    it('accepts a well-formed search', async () => {
      await expectAllowed(setDoc(doc(firestore, path('savedSearches')), validSearch()), 'valid create');
    });

    it('rejects a non-boolean pinned flag', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('savedSearches')), validSearch({ pinned: 'yes' })),
        'string pinned'
      );
    });

    it('accepts the { lastUsedAt } touch', async () => {
      const p = path('savedSearches');
      await setDoc(doc(firestore, p), validSearch());
      await expectAllowed(updateDoc(doc(firestore, p), { lastUsedAt: Timestamp.now() }), 'touch');
    });
  });

  describe('imports', () => {
    it('accepts a well-formed import record', async () => {
      await expectAllowed(setDoc(doc(firestore, path('imports')), validImport()), 'valid create');
    });

    it('rejects an unknown source', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ source: 'email' })),
        'unknown source'
      );
    });

    it('rejects an unknown status', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ status: 'halfway' })),
        'unknown status'
      );
    });

    it('accepts the status/errors progress update', async () => {
      const p = path('imports');
      await setDoc(doc(firestore, p), validImport({ status: 'processing' }));
      await expectAllowed(
        updateDoc(doc(firestore, p), { status: 'partial', errors: [{ message: 'row 3 skipped' }] }),
        'progress update'
      );
    });
  });

  describe('user profile', () => {
    const profile = () => ({
      email: 'smoke@example.test',
      displayName: 'Smoke',
      createdAt: Timestamp.now(),
      lastLoginAt: Timestamp.now(),
      preferences: { baseCurrency: 'USD', language: 'en' }
    });

    // An update against a document that does not exist evaluates the update
    // rule with no `resource`, so touched() errors and the write is denied.
    // Specs run in random order, so every update case seeds the profile first.
    beforeEach(async () => {
      await setDoc(doc(firestore, `users/${uid}`), profile());
    });

    it('accepts the profile shape sign-in creates', async () => {
      await expectAllowed(setDoc(doc(firestore, `users/${uid}`), profile()), 'profile create');
    });

    it('accepts the { lastLoginAt } touch every sign-in issues', async () => {
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), { lastLoginAt: Timestamp.now() }),
        'lastLoginAt touch'
      );
    });

    it('accepts a preferences update', async () => {
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), { preferences: { baseCurrency: 'EUR' } }),
        'preferences update'
      );
    });

    it('rejects replacing preferences with a non-map', async () => {
      await expectDenied(
        updateDoc(doc(firestore, `users/${uid}`), { preferences: 'none' }),
        'string preferences'
      );
    });
  });

  describe('cross-tenant isolation', () => {
    it("denies writing into another user's subcollection", async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions', otherUid)), validTransaction({ userId: otherUid })),
        "write to stranger's transactions"
      );
    });

    it("denies reading another user's document", async () => {
      await expectDenied(getDoc(doc(firestore, `users/${otherUid}`)), "read of stranger's profile");
    });

    it("denies writing another user's profile", async () => {
      await expectDenied(
        setDoc(doc(firestore, `users/${otherUid}`), {
          email: 'takeover@example.test',
          displayName: 'Takeover',
          createdAt: Timestamp.now(),
          lastLoginAt: Timestamp.now(),
          preferences: {}
        }),
        "write to stranger's profile"
      );
    });
  });

  describe('shared currencies collection', () => {
    it('denies writing the retired shared rate cache', async () => {
      await expectDenied(
        setDoc(doc(firestore, 'currencies/rates'), { USD: 1, JPY: 0.0001, lastUpdated: Timestamp.now() }),
        'rate poisoning'
      );
    });

    it('denies reading the retired shared rate cache', async () => {
      await expectDenied(getDoc(doc(firestore, 'currencies/rates')), 'shared rate read');
    });
  });

  describe('catch-all carve-out', () => {
    // Rules are additive, so the catch-all must exclude every validated
    // collection. Without the exclusion list these writes succeed and every
    // field validator above becomes decorative.
    const validated = ['transactions', 'budgets', 'categories', 'recurring', 'savedSearches', 'imports'];

    for (const collection of validated) {
      it(`does not let the catch-all bypass ${collection} validation`, async () => {
        await expectDenied(
          setDoc(doc(firestore, path(collection)), { junk: true }),
          `unvalidated write to ${collection}`
        );
      });
    }

    it('still allows owner writes to collections with no validator', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('insightSnapshots')), { anything: true }),
        'write to an unvalidated subcollection'
      );
    });

    it('denies unvalidated subcollection writes for a different user', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('insightSnapshots', otherUid)), { anything: true }),
        "write to stranger's unvalidated subcollection"
      );
    });
  });
});
