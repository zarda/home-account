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

    it('accepts a budget period from the enum the picker offers', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({ period: 'monthly' })),
        'period monthly'
      );
    });

    it('accepts a goal link: the id with its converted-figure snapshot', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')),
          validTransaction({ goalId: 'g1', goalAmount: 12.5 })),
        'linked create'
      );
    });

    it('rejects a goalId that is not a string', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')),
          validTransaction({ goalId: 7, goalAmount: 12.5 })),
        'numeric goalId'
      );
    });

    it('rejects a goalAmount without its goalId', async () => {
      // An orphan figure has nothing to be backed out of.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ goalAmount: 12.5 })),
        'orphan goalAmount'
      );
    });

    it('rejects a negative or non-numeric goalAmount', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')),
          validTransaction({ goalId: 'g1', goalAmount: -1 })),
        'negative goalAmount'
      );
      await expectDenied(
        setDoc(doc(firestore, path('transactions')),
          validTransaction({ goalId: 'g1', goalAmount: '12.5' })),
        'string goalAmount'
      );
    });

    it('accepts clearing a stored link, which is how unlinking commits', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction({ goalId: 'g1', goalAmount: 12.5 }));
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          goalId: deleteField(),
          goalAmount: deleteField(),
          updatedAt: Timestamp.now()
        }),
        'link clearing'
      );
    });

    it('rejects a budget period outside that enum', async () => {
      // The field reached no write until now, so the rule accepted anything a
      // client cared to put there while budgets pinned the same enum.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ period: 'quarterly' })),
        'period quarterly'
      );
    });

    it('accepts clearing a stored budget period', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction({ period: 'monthly' }));
      await expectAllowed(
        updateDoc(doc(firestore, p), { period: deleteField() }),
        'period deletion'
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

    // The rollover freshen path stamps spent with the period it was computed for.
    it('accepts the { spent, spentPeriod } partial update', async () => {
      const p = path('budgets');
      await setDoc(doc(firestore, p), validBudget());
      await expectAllowed(
        updateDoc(doc(firestore, p), { spent: 120, spentPeriod: '2026-08-01' }),
        'stamped spent update'
      );
    });

    it('rejects a non-string spentPeriod', async () => {
      const p = path('budgets');
      await setDoc(doc(firestore, p), validBudget());
      await expectDenied(
        updateDoc(doc(firestore, p), { spent: 120, spentPeriod: 20260801 }),
        'numeric spentPeriod'
      );
    });
  });

  describe('goals', () => {
    const validGoal = (overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 0,
      currency: 'USD',
      isActive: true,
      ...overrides
    });

    it('accepts a valid saving goal', async () => {
      await expectAllowed(setDoc(doc(firestore, path('goals')), validGoal()), 'valid create');
    });

    it('accepts a project goal with items', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('goals')), validGoal({
          kind: 'project',
          name: 'Japan trip',
          items: [
            { name: 'Flights', amount: 800, done: false },
            { name: 'Hotel', amount: 1200, done: false }
          ],
          targetDate: Timestamp.now()
        })),
        'project with items'
      );
    });

    // This is also the carve-out regression: without the goals entry in the
    // catch-all exclusion list, an invalid kind sails through the catch-all.
    it('rejects a kind outside the enum', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ kind: 'wishlist' })),
        'unknown kind'
      );
    });

    it('rejects a non-positive target', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ targetAmount: 0 })),
        'zero target'
      );
    });

    it('rejects a negative contributed amount', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ contributedAmount: -5 })),
        'negative contributions'
      );
    });

    it('accepts a linked-transactions counter and the update that moves it', async () => {
      const p = path('goals');
      await expectAllowed(
        setDoc(doc(firestore, p), validGoal({ linkedAmount: 0 })),
        'create with linkedAmount'
      );
      await expectAllowed(
        updateDoc(doc(firestore, p), { linkedAmount: 92, updatedAt: Timestamp.now() }),
        'counter update'
      );
    });

    it('rejects a negative or non-numeric linkedAmount', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ linkedAmount: -5 })),
        'negative linkedAmount'
      );
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ linkedAmount: '92' })),
        'string linkedAmount'
      );
    });

    it("rejects a goal attributed to another user", async () => {
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ userId: otherUid })),
        'foreign userId'
      );
    });

    it('rejects items that are not a list', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('goals')), validGoal({ items: 'flights' })),
        'string items'
      );
    });

    it('allows the owner to delete a goal', async () => {
      const p = path('goals');
      await setDoc(doc(firestore, p), validGoal());
      await expectAllowed(deleteDoc(doc(firestore, p)), 'owner delete');
    });
  });

  describe('categories', () => {
    it('accepts a well-formed custom category', async () => {
      await expectAllowed(setDoc(doc(firestore, path('categories')), validCategory()), 'valid create');
    });

    // Materializing a built-in spreads the in-memory row, which carries id.
    it('tolerates the id copy that materialized defaults carry', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('categories')), validCategory({ id: 'food_groceries' })),
        'create with id field'
      );
    });

    // The first edit of a built-in category is a merge write onto a document
    // that does not exist yet — a create to the rules, which demand the full
    // field set plus the owner stamp. These two cases pin why
    // materializeDefaultWith must send the whole row, not just the edits.
    it('accepts a full-row merge create for a built-in id', async () => {
      await expectAllowed(
        setDoc(
          doc(firestore, path('categories')),
          validCategory({ id: 'food_groceries', name: 'Renamed Groceries', isDefault: true }),
          { merge: true }
        ),
        'materializing merge create'
      );
    });

    it('rejects a partial merge create onto a missing document', async () => {
      await expectDenied(
        setDoc(
          doc(firestore, path('categories')),
          { name: 'Renamed Groceries' },
          { merge: true }
        ),
        'partial merge create'
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

    // An interval below one schedules nothing: it asks for a date no further
    // on than the one before it, which is what turned a rule's occurrence
    // walk into a loop with no exit. The client refuses it, but a restore, an
    // older build or a raw SDK call all reach this document directly.
    it('rejects a zero interval', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ frequency: { type: 'monthly', interval: 0 } })),
        'zero interval'
      );
    });

    it('rejects a negative interval', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ frequency: { type: 'monthly', interval: -1 } })),
        'negative interval'
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

  describe('searchAnswers', () => {
    const validAnswer = (overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      schemaVersion: 1,
      query: 'how much on food in august',
      operation: 'sum',
      limit: 3,
      scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
      baseCurrency: 'USD',
      value: 421.5,
      currency: 'USD',
      transactionCount: 17,
      computedAt: Timestamp.now(),
      lastUsedAt: Timestamp.now(),
      ...overrides,
    });

    it('accepts a well-formed answer', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer()),
        'valid create'
      );
    });

    it('rejects an operation outside the aggregate set', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({ operation: 'median' })),
        'unknown operation'
      );
    });

    it('rejects a scope with no end date', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({ scope: { startDate: '2026-08-01' } })),
        'unresolved scope'
      );
    });

    it('rejects a scope date that is not a day key', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({
          scope: { startDate: '2026-08-01T00:00:00Z', endDate: '2026-08-31' }
        })),
        'timestamp-shaped scope date'
      );
    });

    it('rejects a field outside the closed set', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({ extremeTransaction: { id: 'tx-1' } })),
        'embedded transaction'
      );
    });

    it('accepts a goal-scoped answer', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({
          scope: { startDate: '2026-08-01', endDate: '2026-08-31', goalId: 'g1' }
        })),
        'goal scope'
      );
    });

    it('rejects a non-string goalId in the scope', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({
          scope: { startDate: '2026-08-01', endDate: '2026-08-31', goalId: 7 }
        })),
        'numeric goalId'
      );
    });

    it('still rejects an unknown scope key, so the allowlist widened by one', async () => {
      // A budget never reaches the stored scope — it resolves to a category
      // and a window first — so budgetId must remain unwritable.
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({
          scope: { startDate: '2026-08-01', endDate: '2026-08-31', budgetId: 'b1' }
        })),
        'budgetId in scope'
      );
    });

    it('accepts the { lastUsedAt } touch', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validAnswer());
      await expectAllowed(updateDoc(doc(firestore, p), { lastUsedAt: Timestamp.now() }), 'touch');
    });

    // The exact shape SearchAnswerHistoryService issues on refresh: figures
    // replaced, vanished optionals cleared with deleteField sentinels.
    it('accepts the refresh update with cleared optionals', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validAnswer({ operation: 'max', extremeTransactionId: 'tx-1' }));
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          value: 0,
          transactionCount: 0,
          baseCurrency: 'USD',
          currency: 'USD',
          extremeTransactionId: deleteField(),
          groups: deleteField(),
          computedAt: Timestamp.now(),
          lastUsedAt: Timestamp.now()
        }),
        'refresh with cleared optionals'
      );
    });

    it('rejects rewriting the resolved scope', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validAnswer());
      await expectDenied(
        updateDoc(doc(firestore, p), { scope: { startDate: '2026-09-01', endDate: '2026-09-30' } }),
        'scope rewrite'
      );
    });

    it('rejects rewriting the question', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validAnswer());
      await expectDenied(
        updateDoc(doc(firestore, p), { query: 'a different question' }),
        'query rewrite'
      );
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

    // Deletes carry no request.resource, so they need their own grant —
    // account deletion purges the key document through this path.
    it('allows the owner to delete a key document', async () => {
      const p = `users/${uid}/secrets/providers-delete-probe`;
      await setDoc(doc(firestore, p), { gemini: 'g-key' });
      await expectAllowed(deleteDoc(doc(firestore, p)), 'owner delete of keys');
    });

    it("denies deleting another user's keys", async () => {
      await expectDenied(
        deleteDoc(doc(firestore, `users/${otherUid}/secrets/providers`)),
        "delete of stranger's keys"
      );
    });
  });

  describe('securityEvents (unrewritable, owner-erasable)', () => {
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

    // The log stays unrewritable: whoever holds the credentials must not be
    // able to change what their own sign-in record says.
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

    // Deletion is the one exception: account deletion has to be able to empty
    // the log, and a rule cannot tell "delete my account" apart from "delete
    // one event". A credential thief gains nothing new here — the whole
    // account was already theirs to delete.
    it('allows the owner to delete an entry', async () => {
      const p = path('securityEvents');
      await setDoc(doc(firestore, p), validEvent());
      await expectAllowed(deleteDoc(doc(firestore, p)), 'owner delete');
    });

    it("denies deleting an entry in another user's log", async () => {
      await expectDenied(
        deleteDoc(doc(firestore, path('securityEvents', otherUid))),
        "delete in stranger's log"
      );
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
      'transactions', 'budgets', 'categories', 'goals',
      'recurring', 'savedSearches', 'imports', 'securityEvents', 'secrets',
      'insightSnapshots', 'categoryMemory', 'searchAnswers'
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
