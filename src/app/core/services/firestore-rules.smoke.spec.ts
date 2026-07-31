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

    it('accepts a location carrying the country its coordinates fall in', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71, country: 'JP' }
        })),
        'location with country'
      );
    });

    it('accepts a location with no country, which is what open water gives', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 'Somewhere', lat: 0, lng: -140 }
        })),
        'location without country'
      );
    });

    it('rejects a country that is not a two-letter code', async () => {
      // The rule used to accept any map at all, so nothing stopped a client
      // writing prose into a field the reports will later group by.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 'Aoyama Market', country: 'Japan' }
        })),
        'country as a name'
      );
    });

    it('rejects a non-string country', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 'Aoyama Market', country: 81 }
        })),
        'country as a number'
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

    it('accepts a transaction carrying an array of receipt URLs', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: 'https://example.test/r0.png',
          receiptUrls: ['https://example.test/r0.png', 'https://example.test/r1.png'],
          receiptCount: 2
        })),
        'multi-image create'
      );
    });

    it('rejects a receiptUrls that is not a list', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrls: 'https://example.test/r0.png'
        })),
        'string receiptUrls'
      );
    });

    it('rejects a receiptUrl that is not a string', async () => {
      // The whole image quota rests on this: the count query filters on
      // `receiptUrl > ''`, and Firestore range filters only match values of
      // the operand's type — an array smuggled into this field would drop
      // the row out of the count entirely, and multi-image users would sail
      // past the limit with nothing throwing.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: ['https://example.test/r0.png']
        })),
        'array receiptUrl'
      );
    });

    it('accepts the tombstoned array a middle removal leaves', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction({
        receiptUrl: 'https://example.test/r0.png',
        receiptUrls: [
          'https://example.test/r0.png',
          'https://example.test/r1.png',
          'https://example.test/r2.png'
        ],
        receiptCount: 3
      }));
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          receiptUrls: ['https://example.test/r0.png', '', 'https://example.test/r2.png'],
          receiptCount: 2
        }),
        'tombstoned removal update'
      );
    });

    it('accepts clearing every image', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction({
        receiptUrl: 'https://example.test/r0.png',
        receiptUrls: ['https://example.test/r0.png'],
        receiptCount: 1
      }));
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          receiptUrl: deleteField(),
          receiptUrls: deleteField(),
          receiptCount: 0
        }),
        'clearing every image'
      );
    });

    it('rejects a negative receiptCount', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ receiptCount: -1 })),
        'negative receiptCount'
      );
    });

    it('rejects a receiptUrls array past the per-transaction cap', async () => {
      // Client code caps at MAX_RECEIPTS_PER_TRANSACTION; this asserts the
      // cap holds server-side, so a direct SDK write cannot walk past it.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: 'https://example.test/r0.png',
          receiptUrls: Array.from({ length: 6 }, (_, i) => `https://example.test/r${i}.png`),
          receiptCount: 6
        })),
        'six receipt urls'
      );
    });

    it('constrains the receiptUrl scheme in both directions', async () => {
      // javascript: and data: payloads are stopped at the boundary rather
      // than relying solely on Angular's URL sanitizer.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: 'javascript:alert(1)'
        })),
        'javascript: receiptUrl'
      );
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: 'data:image/png;base64,AAAA'
        })),
        'data: receiptUrl'
      );
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: 'https://example.test/r.png'
        })),
        'https receiptUrl'
      );
      // Plain http must stay allowed: the storage emulator issues
      // http://127.0.0.1:9199 download URLs and this same rules file runs
      // against it.
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: 'http://127.0.0.1:9199/v0/b/demo/o/receipt.png?alt=media'
        })),
        'emulator http receiptUrl'
      );
    });

    it('rejects a receiptUrl past the length cap', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          receiptUrl: `https://example.test/${'r'.repeat(3000)}.png`
        })),
        'oversized receiptUrl'
      );
    });

    it('accepts a tags list and rejects a non-list', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          tags: ['groceries', 'reimbursable']
        })),
        'tags list'
      );
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ tags: 'groceries' })),
        'string tags'
      );
    });

    it('accepts a location map and rejects a non-map', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 }
        })),
        'location map'
      );
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ location: 'Aoyama Market' })),
        'string location'
      );
    });

    it('accepts the partial update the tag and location editor issues', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          tags: ['groceries'],
          location: { name: 'Aoyama Market' }
        }),
        'tags and location partial update'
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

  describe('categoryMemory', () => {
    // The document id is the merchant key, so these build paths by hand rather
    // than using path(), which mints an arbitrary id.
    const memoryPath = (key: string, owner = uid) => `users/${owner}/categoryMemory/${key}`;
    const validMemory = (overrides: Record<string, unknown> = {}) => ({
      merchantKey: 'starbucks',
      categoryId: 'food_coffee',
      sampleDescription: 'STARBUCKS #123',
      count: 1,
      ...overrides,
    });

    it('accepts a well-formed entry', async () => {
      await expectAllowed(
        setDoc(doc(firestore, memoryPath('starbucks')), validMemory()),
        'valid create'
      );
    });

    it('rejects an entry filed under a different merchant than it claims', async () => {
      // Otherwise a row could be written under one key while claiming another,
      // and the lookup map would answer for a merchant it was never taught.
      await expectDenied(
        setDoc(doc(firestore, memoryPath('starbucks')), validMemory({ merchantKey: 'costa' })),
        'merchantKey disagreeing with the document id'
      );
    });

    it('rejects an empty category', async () => {
      await expectDenied(
        setDoc(doc(firestore, memoryPath('starbucks')), validMemory({ categoryId: '' })),
        'empty categoryId'
      );
    });

    it('rejects a non-positive count', async () => {
      await expectDenied(
        setDoc(doc(firestore, memoryPath('starbucks')), validMemory({ count: 0 })),
        'zero count'
      );
    });

    it('rejects an undeclared field', async () => {
      await expectDenied(
        setDoc(doc(firestore, memoryPath('starbucks')), validMemory({ note: 'extra' })),
        'field outside the closed set'
      );
    });

    it('accepts a repeat confirmation raising the count', async () => {
      const p = memoryPath('starbucks');
      await setDoc(doc(firestore, p), validMemory());
      await expectAllowed(
        setDoc(doc(firestore, p), validMemory({ count: 2 })),
        'reinforced entry'
      );
    });

    it("denies writing to another user's memory", async () => {
      await expectDenied(
        setDoc(doc(firestore, memoryPath('starbucks', otherUid)), validMemory()),
        "stranger's category memory"
      );
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

  describe('provider secrets', () => {
    it('accepts a well-formed key document', async () => {
      await expectAllowed(
        setDoc(doc(firestore, `users/${uid}/secrets/providers`), { gemini: 'g-key' }),
        'valid create'
      );
    });

    it('accepts all three providers at once', async () => {
      await expectAllowed(
        setDoc(doc(firestore, `users/${uid}/secrets/providers`), {
          gemini: 'g-key',
          openai: 'o-key',
          claude: 'c-key'
        }),
        'all providers'
      );
    });

    it('rejects a key that is not a string', async () => {
      await expectDenied(
        setDoc(doc(firestore, `users/${uid}/secrets/providers`), { gemini: 42 }),
        'numeric key'
      );
    });

    it('rejects fields outside the closed set', async () => {
      await expectDenied(
        setDoc(doc(firestore, `users/${uid}/secrets/providers`), { gemini: 'g', smuggled: 'x' }),
        'extra field'
      );
    });

    it("denies reading another user's keys", async () => {
      await expectDenied(
        getDoc(doc(firestore, `users/${otherUid}/secrets/providers`)),
        "read of stranger's keys"
      );
    });

    it("denies writing another user's keys", async () => {
      await expectDenied(
        setDoc(doc(firestore, `users/${otherUid}/secrets/providers`), { gemini: 'g-key' }),
        "write to stranger's keys"
      );
    });
  });

  describe('securityEvents (append-only)', () => {
    const validEvent = (overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      type: 'signIn',
      occurredAt: Timestamp.now(),
      platform: 'web',
      ...overrides
    });

    it('accepts a well-formed sign-in entry', async () => {
      await expectAllowed(setDoc(doc(firestore, path('securityEvents')), validEvent()), 'valid create');
    });

    it('accepts the createdAt/updatedAt stamps addDocument adds', async () => {
      await expectAllowed(
        setDoc(
          doc(firestore, path('securityEvents')),
          validEvent({ createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
        ),
        'create with service stamps'
      );
    });

    it('rejects an unknown event type', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('securityEvents')), validEvent({ type: 'passwordChange' })),
        'unknown type'
      );
    });

    it("rejects an entry attributed to another user", async () => {
      await expectDenied(
        setDoc(doc(firestore, path('securityEvents')), validEvent({ userId: otherUid })),
        'foreign userId'
      );
    });

    // Anything not in the closed set could be used to smuggle in a field the
    // log is specifically meant not to carry.
    it('rejects extra fields outside the closed set', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('securityEvents')), validEvent({ ipAddress: '203.0.113.4' })),
        'extra field'
      );
    });

    // The point of the log: whoever holds the credentials must not be able to
    // erase the record of their own sign-in.
    it('denies updating an existing entry', async () => {
      const p = path('securityEvents');
      await setDoc(doc(firestore, p), validEvent());
      await expectDenied(updateDoc(doc(firestore, p), { platform: 'ios' }), 'entry update');
    });

    it('denies overwriting an existing entry', async () => {
      const p = path('securityEvents');
      await setDoc(doc(firestore, p), validEvent());
      await expectDenied(setDoc(doc(firestore, p), validEvent({ platform: 'ios' })), 'entry overwrite');
    });

    it('denies deleting an entry', async () => {
      const p = path('securityEvents');
      await setDoc(doc(firestore, p), validEvent());
      await expectDenied(deleteDoc(doc(firestore, p)), 'entry delete');
    });

    it("denies writing into another user's log", async () => {
      await expectDenied(
        setDoc(doc(firestore, path('securityEvents', otherUid)), validEvent({ userId: otherUid })),
        "write to stranger's log"
      );
    });
  });

  describe('insightSnapshots', () => {
    /**
     * Snapshots are keyed by `yyyy-MM`, so they need their own path helper —
     * the shared one appends a counter, which no month key can match.
     */
    const snapshotPath = (monthKey: string, owner = uid): string =>
      `users/${owner}/insightSnapshots/${monthKey}`;

    const validSnapshot = (monthKey: string, overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      monthKey,
      detectorVersion: 1,
      schemaVersion: 1,
      status: 'complete',
      fingerprint: {
        tx: 'abcd1234:10',
        count: 10,
        timeZone: 'Asia/Taipei',
        baseCurrency: 'USD'
      },
      totals: { income: 4000, expense: 1200, balance: 2800, count: 10 },
      byCategory: [{ categoryId: 'food_groceries', total: 800, count: 6 }],
      facts: { detectorVersion: 1, baseCurrency: 'USD' },
      cards: [],
      generatedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      revision: 1,
      ...overrides
    });

    it('accepts a well-formed snapshot', async () => {
      await expectAllowed(
        setDoc(doc(firestore, snapshotPath('2026-01')), validSnapshot('2026-01')),
        'valid create'
      );
    });

    it('accepts the updatedAt stamp setDocument adds', async () => {
      await expectAllowed(
        setDoc(
          doc(firestore, snapshotPath('2026-02')),
          validSnapshot('2026-02', { updatedAt: Timestamp.now() })
        ),
        'create with the service stamp'
      );
    });

    // The month key is both the document id and a stored field; if they can
    // disagree, a snapshot can be filed under the wrong month.
    it('rejects a monthKey that disagrees with the document id', async () => {
      await expectDenied(
        setDoc(doc(firestore, snapshotPath('2026-03')), validSnapshot('2026-04')),
        'mismatched month key'
      );
    });

    it('rejects document ids that are not yyyy-MM', async () => {
      for (const badId of ['2026-13', '2026-00', '2026-1', 'march', '2026-01-01']) {
        await expectDenied(
          setDoc(doc(firestore, snapshotPath(badId)), validSnapshot(badId)),
          `bad month id ${badId}`
        );
      }
    });

    it('rejects an unknown extra field', async () => {
      await expectDenied(
        setDoc(
          doc(firestore, snapshotPath('2026-05')),
          validSnapshot('2026-05', { narrative: 'a written summary' })
        ),
        'extra field'
      );
    });

    it('rejects a snapshot missing its fingerprint', async () => {
      const payload = validSnapshot('2026-06') as Record<string, unknown>;
      delete payload['fingerprint'];
      await expectDenied(
        setDoc(doc(firestore, snapshotPath('2026-06')), payload),
        'missing fingerprint'
      );
    });

    it('rejects a malformed fingerprint', async () => {
      await expectDenied(
        setDoc(
          doc(firestore, snapshotPath('2026-07')),
          validSnapshot('2026-07', { fingerprint: { tx: 'abc', count: 'ten' } })
        ),
        'malformed fingerprint'
      );
    });

    it('rejects a snapshot attributed to another user', async () => {
      await expectDenied(
        setDoc(
          doc(firestore, snapshotPath('2026-08')),
          validSnapshot('2026-08', { userId: otherUid })
        ),
        'foreign userId'
      );
    });

    it('rejects a zero or negative revision', async () => {
      await expectDenied(
        setDoc(doc(firestore, snapshotPath('2026-09')), validSnapshot('2026-09', { revision: 0 })),
        'revision 0'
      );
    });

    // A regeneration has to be recorded rather than history being silently
    // amended, so a rewrite must advance the revision.
    it('denies an overwrite that does not advance the revision', async () => {
      const p = snapshotPath('2026-10');
      await setDoc(doc(firestore, p), validSnapshot('2026-10'));
      await expectDenied(
        setDoc(doc(firestore, p), validSnapshot('2026-10', { revision: 1 })),
        'overwrite at the same revision'
      );
    });

    it('allows a regeneration that advances the revision', async () => {
      const p = snapshotPath('2026-11');
      await setDoc(doc(firestore, p), validSnapshot('2026-11'));
      await expectAllowed(
        setDoc(doc(firestore, p), validSnapshot('2026-11', { revision: 2 })),
        'regeneration'
      );
    });

    // Deliberately allowed, unlike securityEvents: account deletion has to
    // remove these, and a rule cannot tell that apart from deleting one.
    it('allows the owner to delete a snapshot', async () => {
      const p = snapshotPath('2026-12');
      await setDoc(doc(firestore, p), validSnapshot('2026-12'));
      await expectAllowed(deleteDoc(doc(firestore, p)), 'owner delete');
    });

    it("denies writing into another user's snapshots", async () => {
      await expectDenied(
        setDoc(
          doc(firestore, snapshotPath('2026-01', otherUid)),
          validSnapshot('2026-01', { userId: otherUid })
        ),
        "write to stranger's snapshots"
      );
    });

    it("denies reading another user's snapshots", async () => {
      await expectDenied(
        getDoc(doc(firestore, snapshotPath('2026-01', otherUid))),
        "read of stranger's snapshot"
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
    const validated = [
      'transactions', 'budgets', 'categories',
      'recurring', 'savedSearches', 'imports', 'securityEvents', 'secrets',
      'insightSnapshots', 'categoryMemory'
    ];

    for (const collection of validated) {
      it(`does not let the catch-all bypass ${collection} validation`, async () => {
        await expectDenied(
          setDoc(doc(firestore, path(collection)), { junk: true }),
          `unvalidated write to ${collection}`
        );
      });
    }

    // Deliberately a name that will never become a real feature: this case has
    // to keep testing the catch-all itself, and it previously used
    // insightSnapshots, which then became a validated collection.
    it('still allows owner writes to collections with no validator', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('unvalidatedProbe')), { anything: true }),
        'write to an unvalidated subcollection'
      );
    });

    it('denies unvalidated subcollection writes for a different user', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('unvalidatedProbe', otherUid)), { anything: true }),
        "write to stranger's unvalidated subcollection"
      );
    });
  });
});
