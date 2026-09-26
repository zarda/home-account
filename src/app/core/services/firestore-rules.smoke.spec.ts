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
import * as lite from '@angular/fire/firestore/lite';
import {
  setDocumentAsOwner,
  patchFieldsAsOwner,
  getDocumentAsOwner,
  deleteDocumentAsOwner,
  integerField,
  timestampField,
  stringField,
  EmulatorField,
  EmulatorValue
} from './testing';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const AUTH_URL = 'http://127.0.0.1:9099';

/**
 * Resolves true when the write was allowed, false on permission-denied.
 *
 * Anything else rethrows. Swallowing every rejection would let an emulator
 * that is down, or a path typo, answer "denied" for its own reasons, and
 * every case below would report the rules holding without having reached
 * them.
 */
async function allowed(write: Promise<unknown>): Promise<boolean> {
  try {
    await write;
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'permission-denied') {
      return false;
    }
    throw error;
  }
}

async function expectAllowed(write: Promise<unknown>, what: string): Promise<void> {
  expect(await allowed(write)).toBe(true, `expected ${what} to be allowed`);
}

async function expectDenied(write: Promise<unknown>, what: string): Promise<void> {
  expect(await allowed(write)).toBe(false, `expected ${what} to be denied`);
}

/**
 * Makes the timestamps a fixture carries. A client serialises only its own
 * SDK's Timestamp class, so the full-SDK suite and the Lite suite below each
 * pass their own.
 */
type Stamp = () => unknown;

type Overrides = Record<string, unknown>;

// One well-formed document of each kind a household shares, as its owner
// writes it.
const transactionFixture = (userId: string, now: Stamp, overrides: Overrides = {}) => ({
  userId,
  type: 'expense',
  amount: 12.5,
  currency: 'USD',
  amountInBaseCurrency: 12.5,
  exchangeRate: 1,
  categoryId: 'food_groceries',
  description: 'rules smoke',
  date: now(),
  createdAt: now(),
  updatedAt: now(),
  isRecurring: false,
  ...overrides
});

const budgetFixture = (userId: string, now: Stamp, overrides: Overrides = {}) => ({
  userId,
  categoryId: 'food',
  name: 'Groceries',
  amount: 400,
  currency: 'USD',
  period: 'monthly',
  startDate: now(),
  spent: 0,
  isActive: true,
  alertThreshold: 80,
  ...overrides
});

const categoryFixture = (userId: string, overrides: Overrides = {}) => ({
  userId,
  name: 'Custom',
  icon: 'star',
  color: '#FF0000',
  type: 'expense',
  order: 1,
  isActive: true,
  isDefault: false,
  ...overrides
});

const goalFixture = (userId: string, overrides: Overrides = {}) => ({
  userId,
  kind: 'saving',
  name: 'Emergency fund',
  targetAmount: 3000,
  contributedAmount: 0,
  currency: 'USD',
  isActive: true,
  ...overrides
});

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
  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let otherUid: string;

  const now = () => Timestamp.now();
  const validTransaction = (overrides: Overrides = {}) => transactionFixture(uid, now, overrides);
  const validBudget = (overrides: Overrides = {}) => budgetFixture(uid, now, overrides);
  const validCategory = (overrides: Overrides = {}) => categoryFixture(uid, overrides);
  const validGoal = (overrides: Overrides = {}) => goalFixture(uid, overrides);

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

    it('accepts a transaction carrying a split group id', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({ splitGroupId: 'tx-1' })),
        'create with splitGroupId'
      );
    });

    it('rejects a split group id that is not a string', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ splitGroupId: 7 })),
        'numeric splitGroupId'
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

    it('accepts a location carrying only a country', async () => {
      // 0068: a receipt can name its country through a tax number, a phone
      // format or its own script and print no address at all.
      await expectAllowed(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { country: 'KR' }
        })),
        'country-only location'
      );
    });

    it('rejects an empty location map', async () => {
      // A map that says nothing is not a location. It passed the truthy
      // spread and the old rule alike.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: {}
        })),
        'empty location map'
      );
    });

    it('rejects a location with only coordinates', async () => {
      // Nothing renders a bare fix, and locationSlot refuses to build one.
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { lat: 35.66, lng: 139.71 }
        })),
        'coordinates without a place'
      );
    });

    it('rejects a blank location name', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: '' }
        })),
        'blank location name'
      );
    });

    it('rejects a non-string location name', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 42 }
        })),
        'location name as a number'
      );
    });

    it('rejects a non-numeric coordinate', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({
          location: { name: 'Aoyama Market', lat: '35.66', lng: 139.71 }
        })),
        'latitude as a string'
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

    // A category id is required on create and may never be blanked. An empty
    // string passed the type check, and every category reader then buckets the
    // row under '' — a category that cannot be named, edited or filtered on.
    // The update clause sits inside the touched() guard on purpose: a row that
    // somehow already carries '' stays editable for every other field rather
    // than becoming permanently unwritable.
    it('rejects an empty categoryId', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('transactions')), validTransaction({ categoryId: '' })),
        'empty categoryId on create'
      );
    });

    it('rejects an update that blanks the categoryId', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectDenied(updateDoc(doc(firestore, p), { categoryId: '' }), 'blanked categoryId');
    });

    it('accepts an update that repoints the categoryId at a named category', async () => {
      const p = path('transactions');
      await setDoc(doc(firestore, p), validTransaction());
      await expectAllowed(updateDoc(doc(firestore, p), { categoryId: 'food_dining' }), 'repointed categoryId');
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

    // A category id is required on create and may never be blanked. The update
    // clause sits inside the touched() guard on purpose: a row that somehow
    // already carries '' stays editable for every other field.
    it('rejects an empty categoryId', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('budgets')), validBudget({ categoryId: '' })),
        'empty categoryId on create'
      );
    });

    it('rejects an update that blanks the categoryId', async () => {
      const p = path('budgets');
      await setDoc(doc(firestore, p), validBudget());
      await expectDenied(updateDoc(doc(firestore, p), { categoryId: '' }), 'blanked categoryId');
    });

    it('accepts an update that repoints the categoryId at a named category', async () => {
      const p = path('budgets');
      await setDoc(doc(firestore, p), validBudget());
      await expectAllowed(updateDoc(doc(firestore, p), { categoryId: 'transport' }), 'repointed categoryId');
    });
  });

  describe('goals', () => {
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

    // Rewriting an unreadable pointer touches neither the posting stamp nor
    // anything else: a rule left inert by a bad restore is repaired by this
    // write alone, so the rules have to accept it on its own.
    it('allows an update touching only nextOccurrence', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring());
      await expectAllowed(
        updateDoc(doc(firestore, p), {
          nextOccurrence: Timestamp.now(),
          updatedAt: Timestamp.now()
        }),
        'pointer repair'
      );
    });

    it('accepts a reminder lead time', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('recurring')), validRecurring({ remindDaysBefore: 3 })),
        'reminder lead'
      );
    });

    // Zero is "remind me on the day" — a lead like any other, and the one a
    // rule with no notice at all shares a shape with.
    it('accepts a zero reminder lead time', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('recurring')), validRecurring({ remindDaysBefore: 0 })),
        'zero reminder lead'
      );
    });

    it('rejects a fractional reminder lead time', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ remindDaysBefore: 2.5 })),
        'fractional reminder lead'
      );
    });

    it('rejects a negative reminder lead time', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ remindDaysBefore: -1 })),
        'negative reminder lead'
      );
    });

    it('accepts adding a reminder lead time to an existing rule', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring());
      await expectAllowed(
        updateDoc(doc(firestore, p), { remindDaysBefore: 7 }),
        'reminder lead added'
      );
    });

    it('accepts clearing the reminder lead time', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring({ remindDaysBefore: 3 }));
      await expectAllowed(
        updateDoc(doc(firestore, p), { remindDaysBefore: deleteField() }),
        'reminder lead deletion'
      );
    });

    it('accepts clearing the optional endDate', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring({ endDate: Timestamp.now() }));
      await expectAllowed(updateDoc(doc(firestore, p), { endDate: deleteField() }), 'endDate deletion');
    });

    // A category id is required on create and may never be blanked. The update
    // clause sits inside the touched() guard on purpose: a row that somehow
    // already carries '' stays editable for every other field.
    it('rejects an empty categoryId', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('recurring')), validRecurring({ categoryId: '' })),
        'empty categoryId on create'
      );
    });

    it('rejects an update that blanks the categoryId', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring());
      await expectDenied(updateDoc(doc(firestore, p), { categoryId: '' }), 'blanked categoryId');
    });

    it('accepts an update that repoints the categoryId at a named category', async () => {
      const p = path('recurring');
      await setDoc(doc(firestore, p), validRecurring());
      await expectAllowed(
        updateDoc(doc(firestore, p), { categoryId: 'employment_bonus' }),
        'repointed categoryId'
      );
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
    // A filter record: the question and its scope, and none of the figures.
    const validFilter = (overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      schemaVersion: 2,
      kind: 'filter',
      query: 'coffee last month',
      scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
      pinned: false,
      computedAt: Timestamp.now(),
      lastUsedAt: Timestamp.now(),
      ...overrides,
    });

    const validAnswer = (overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      schemaVersion: 1,
      kind: 'aggregate',
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

    it('accepts a create carrying the pin', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({ pinned: false })),
        'create with pinned'
      );
    });

    it('rejects a pin that is not a boolean', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validAnswer({ pinned: 'yes' })),
        'non-boolean pinned'
      );
    });

    // Pinning is a decision about the record, not part of the identity a
    // refresh must not disturb, so unlike query/scope it stays writable.
    it('accepts toggling the pin on an existing record', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validAnswer({ pinned: false }));
      await expectAllowed(updateDoc(doc(firestore, p), { pinned: true }), 'pin toggle');
    });

    it('rejects toggling the pin to a non-boolean', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validAnswer({ pinned: false }));
      await expectDenied(updateDoc(doc(firestore, p), { pinned: 1 }), 'non-boolean pin toggle');
    });

    // The required set is the kind's, which is the part only the emulator can
    // check: a mistake here rejects every filter write silently in production.
    it('accepts a filter record with no figures', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('searchAnswers')), validFilter()),
        'filter create'
      );
    });

    it('rejects a filter record carrying a value', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validFilter({ value: 42 })),
        'filter with a figure'
      );
    });

    it('rejects a filter record carrying an operation', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validFilter({ operation: 'sum', limit: 3 })),
        'filter with an operation'
      );
    });

    it('rejects an aggregate record missing its figures', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validFilter({ kind: 'aggregate' })),
        'aggregate with no figures'
      );
    });

    it('rejects a kind outside the two', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), validFilter({ kind: 'something' })),
        'unknown kind'
      );
    });

    it('rejects a create with no kind at all', async () => {
      const noKind: Record<string, unknown> = validFilter();
      delete noKind['kind'];
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')), noKind),
        'missing kind'
      );
    });

    it('rejects rewriting what kind of record it is', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validFilter());
      await expectDenied(updateDoc(doc(firestore, p), { kind: 'aggregate' }), 'kind rewrite');
    });

    it('accepts pinning and touching a filter record', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validFilter());
      await expectAllowed(updateDoc(doc(firestore, p), { pinned: true }), 'pin a filter');
      await expectAllowed(
        updateDoc(doc(firestore, p), { lastUsedAt: Timestamp.now() }),
        'touch a filter'
      );
    });

    // #250: a filter question that names no dates stores a scope with none.
    // The bounds requirement is the aggregate's; a present bound must still
    // be a day key for either kind.
    it('accepts a dateless filter scope', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('searchAnswers')),
          validFilter({ scope: { categoryId: 'food_coffee' } })),
        'dateless filter scope'
      );
    });

    it('accepts a filter scope with only a start date', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('searchAnswers')),
          validFilter({ scope: { startDate: '2026-08-01' } })),
        'half-bounded filter scope'
      );
    });

    it('still rejects a malformed bound on a filter scope', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('searchAnswers')),
          validFilter({ scope: { startDate: '2026-08-01T00:00:00Z' } })),
        'timestamp-shaped filter scope date'
      );
    });

    // #275: the update rule re-checks the pairing the create rule enforces,
    // so a filter record cannot grow figures after the fact.
    it('rejects an update that adds figures to a filter record', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validFilter());
      await expectDenied(
        updateDoc(doc(firestore, p), { value: 421.5, transactionCount: 17, baseCurrency: 'USD' }),
        'figures onto a filter'
      );
    });

    it('rejects an update that adds a lone currency to a filter record', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validFilter());
      await expectDenied(updateDoc(doc(firestore, p), { currency: 'USD' }), 'currency onto a filter');
    });

    it('rejects an update that adds an extreme-row id to a filter record', async () => {
      const p = path('searchAnswers');
      await setDoc(doc(firestore, p), validFilter());
      await expectDenied(
        updateDoc(doc(firestore, p), { extremeTransactionId: 'tx-1' }),
        'extreme row onto a filter'
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

  describe('tagMemory', () => {
    // Same key-as-document-id contract as category memory, so the paths are
    // built by hand here too rather than through path().
    const tagPath = (key: string, owner = uid) => `users/${owner}/tagMemory/${key}`;
    const validTagMemory = (overrides: Record<string, unknown> = {}) => ({
      merchantKey: 'starbucks',
      tags: ['coffee'],
      suppressed: [],
      sampleDescription: 'STARBUCKS #123',
      count: 1,
      ...overrides,
    });

    it('accepts a well-formed entry', async () => {
      await expectAllowed(
        setDoc(doc(firestore, tagPath('starbucks')), validTagMemory()),
        'valid create'
      );
    });

    it('accepts an entry that keeps nothing and refuses nothing yet', async () => {
      // Both lists are allowed to be empty: a merchant can be remembered for
      // its refusals alone, and a confirm can strip the last kept tag.
      await expectAllowed(
        setDoc(doc(firestore, tagPath('costa')), validTagMemory({ merchantKey: 'costa', tags: [] })),
        'entry with empty lists'
      );
    });

    it('rejects an entry filed under a different merchant than it claims', async () => {
      // Otherwise a row could be written under one key while claiming another,
      // and the lookup map would answer for a merchant it was never taught.
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks')), validTagMemory({ merchantKey: 'costa' })),
        'merchantKey disagreeing with the document id'
      );
    });

    it('rejects tags that are not a list', async () => {
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks')), validTagMemory({ tags: 'coffee' })),
        'a single string in place of the tag list'
      );
    });

    it('rejects refusals that are not a list', async () => {
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks')), validTagMemory({ suppressed: 'lunch' })),
        'a single string in place of the refusal list'
      );
    });

    it('rejects a missing refusal list', async () => {
      // Both lists are required, so an entry cannot leave the refusals off
      // and have them read as "none refused".
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks')), {
          merchantKey: 'starbucks',
          tags: ['coffee'],
          sampleDescription: 'STARBUCKS #123',
          count: 1,
        }),
        'entry with no suppressed field'
      );
    });

    it('rejects a non-positive count', async () => {
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks')), validTagMemory({ count: 0 })),
        'zero count'
      );
    });

    it('rejects an undeclared field', async () => {
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks')), validTagMemory({ note: 'extra' })),
        'field outside the closed set'
      );
    });

    it('accepts a repeat confirmation raising the count', async () => {
      const p = tagPath('starbucks');
      await setDoc(doc(firestore, p), validTagMemory());
      await expectAllowed(
        setDoc(doc(firestore, p), validTagMemory({ count: 2, suppressed: ['lunch'] })),
        'reinforced entry'
      );
    });

    it("denies writing to another user's memory", async () => {
      await expectDenied(
        setDoc(doc(firestore, tagPath('starbucks', otherUid)), validTagMemory()),
        "stranger's tag memory"
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

    it('accepts the receipt-attempt slots on a failed record', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('imports')), validImport({
          source: 'image', fileType: 'receipt_image', fileName: 'r.jpg', status: 'failed',
          door: 'camera', engine: 'cloud', fellBackFrom: 'native', provider: 'gemini',
          errorType: 'timeout', durationMs: 4200,
        })),
        'failed attempt with diagnostics'
      );
    });

    it('accepts a cut-off answer as a failure class of its own', async () => {
      // Added with the class itself (#331): the enumeration is duplicated in
      // the rules, and a value the app writes but the rules do not list fails
      // the write silently — the record simply never appears.
      await expectAllowed(
        setDoc(doc(firestore, path('imports')), validImport({
          source: 'image', fileType: 'receipt_image', fileName: 'r.jpg', status: 'failed',
          door: 'wizard', engine: 'cloud', provider: 'claude',
          errorType: 'incomplete', durationMs: 3100,
        })),
        'failed attempt with an incomplete answer'
      );
    });

    it('accepts the photo counters a photo-less save records', async () => {
      // Both figures mean "the row saved, its photo did not" — one for the
      // account's image quota, one for an upload that failed (#334).
      await expectAllowed(
        setDoc(doc(firestore, path('imports')), validImport({
          source: 'image', fileType: 'receipt_image', fileName: 'r.jpg',
          receiptsSkipped: 1, receiptsFailed: 2,
        })),
        'import with photo counters'
      );
    });

    it('rejects a photo counter that is not a count', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ receiptsFailed: -1 })),
        'negative photo counter'
      );
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ receiptsFailed: 'two' })),
        'photo counter as prose'
      );
    });

    it('rejects a failure class the enumeration does not list', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ errorType: 'truncated' })),
        'unknown failure class'
      );
    });

    it('rejects an engine outside the pair', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ engine: 'abacus' })),
        'unknown engine'
      );
    });

    it('rejects a negative duration', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ durationMs: -1 })),
        'negative duration'
      );
    });

    it('accepts the created-transaction ids on a completed record', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('imports')), validImport({
          transactionIds: ['txn-1', 'txn-2'],
        })),
        'import with transaction ids'
      );
    });

    it('rejects transactionIds that is not a list', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ transactionIds: 'txn-1' })),
        'transactionIds as a string'
      );
    });

    it('accepts the per-currency totals on a completed record', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('imports')), validImport({
          totalsByCurrency: [{ currency: 'USD', income: 0, expenses: 4.53 }],
        })),
        'import with per-currency totals'
      );
    });

    it('rejects totalsByCurrency that is not a list', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('imports')), validImport({ totalsByCurrency: 'USD' })),
        'totalsByCurrency as a string'
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

    it('accepts a dotted update of the accessibility preference fields', async () => {
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), {
          'preferences.fontScale': 1.15,
          'preferences.highContrast': true,
          'preferences.reducedMotion': true,
        }),
        'accessibility preferences dotted update'
      );
    });

    it('accepts the dotted update the weekly-recap toggle writes', async () => {
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), { 'preferences.enableWeeklyRecap': true }),
        'enableWeeklyRecap dotted update'
      );
    });

    it('accepts the dotted update the dashboard editor writes', async () => {
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), {
          'preferences.dashboardLayout': {
            order: ['budgets', 'chart', 'recent', 'upcoming', 'insights'],
            hidden: ['insights'],
          },
        }),
        'dashboardLayout dotted update'
      );
    });

    it('accepts the field delete a dashboard reset writes', async () => {
      // The seeded profile has no layout, so a bare delete would touch
      // nothing and prove nothing — write one first, then delete it.
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), {
          'preferences.dashboardLayout': {
            order: ['budgets', 'chart', 'recent', 'upcoming', 'insights'],
            hidden: ['insights'],
          },
        }),
        'dashboardLayout write before reset'
      );
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), { 'preferences.dashboardLayout': deleteField() }),
        'dashboardLayout field delete'
      );
    });

    it('accepts the whole provider map the note-translation picker writes', async () => {
      // The shape the picker really sends: it hands updateUserPreferences the
      // entire llmProviderPreferences object, which becomes one dotted update
      // of that field carrying every feature's provider, not just the one the
      // user touched. Proven rather than assumed — the picker writes through
      // updateDoc and a rule that refused a nested map would fail silently.
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), {
          'preferences.llmProviderPreferences': {
            receiptScanning: 'gemini',
            categorization: 'gemini',
            insights: 'gemini',
            search: 'gemini',
            translation: 'claude',
          },
        }),
        'llmProviderPreferences dotted update'
      );
    });

    it('accepts a dotted update reaching one provider field two levels down', async () => {
      // No caller writes this today. It is here so the rules are known to be
      // indifferent to the depth of the path rather than to the one depth the
      // app happens to use.
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), {
          'preferences.llmProviderPreferences.translation': 'claude',
        }),
        'translation provider dotted update'
      );
    });

    it('accepts the dotted update that closes the first-run welcome', async () => {
      await expectAllowed(
        updateDoc(doc(firestore, `users/${uid}`), { 'preferences.onboardingCompleted': true }),
        'onboardingCompleted dotted update'
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

  describe('feedback (immutable, owner-erasable)', () => {
    const validFeedback = (overrides: Record<string, unknown> = {}) => ({
      userId: uid,
      category: 'bug',
      message: 'rules smoke',
      appVersion: '1.23.129',
      platform: 'web',
      locale: 'en',
      ...overrides
    });

    it('accepts a well-formed entry', async () => {
      await expectAllowed(setDoc(doc(firestore, path('feedback')), validFeedback()), 'valid create');
    });

    it('accepts the createdAt/updatedAt stamps addDocument adds', async () => {
      await expectAllowed(
        setDoc(
          doc(firestore, path('feedback')),
          validFeedback({ createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
        ),
        'create with service stamps'
      );
    });

    it('accepts every declared category', async () => {
      await expectAllowed(
        setDoc(doc(firestore, path('feedback')), validFeedback({ category: 'idea' })),
        'idea category'
      );
      await expectAllowed(
        setDoc(doc(firestore, path('feedback')), validFeedback({ category: 'other' })),
        'other category'
      );
    });

    it('rejects a category outside the enum', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('feedback')), validFeedback({ category: 'rant' })),
        'unknown category'
      );
    });

    it('rejects an empty message', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('feedback')), validFeedback({ message: '' })),
        'empty message'
      );
    });

    it('rejects a message over the cap', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('feedback')), validFeedback({ message: 'x'.repeat(2001) })),
        'oversized message'
      );
    });

    it('rejects an entry missing its message', async () => {
      const withoutMessage: Record<string, unknown> = { ...validFeedback() };
      delete withoutMessage['message'];
      await expectDenied(
        setDoc(doc(firestore, path('feedback')), withoutMessage),
        'missing message'
      );
    });

    // The account email rides in the mail the function composes, never in
    // the stored record; anything outside the closed set could smuggle it.
    it('rejects extra fields outside the closed set', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('feedback')), validFeedback({ email: 'x@example.com' })),
        'extra field'
      );
    });

    it('rejects an entry attributed to another user', async () => {
      await expectDenied(
        setDoc(doc(firestore, path('feedback')), validFeedback({ userId: otherUid })),
        'foreign userId'
      );
    });

    // The operator is mailed a copy on create, so a rewrite would make the
    // stored record diverge from the mail already sent.
    it('denies updating an existing entry', async () => {
      const p = path('feedback');
      await setDoc(doc(firestore, p), validFeedback());
      await expectDenied(updateDoc(doc(firestore, p), { message: 'edited' }), 'entry update');
    });

    it('denies overwriting an existing entry', async () => {
      const p = path('feedback');
      await setDoc(doc(firestore, p), validFeedback());
      await expectDenied(
        setDoc(doc(firestore, p), validFeedback({ message: 'rewritten' })),
        'entry overwrite'
      );
    });

    it('allows the owner to delete an entry', async () => {
      const p = path('feedback');
      await setDoc(doc(firestore, p), validFeedback());
      await expectAllowed(deleteDoc(doc(firestore, p)), 'owner delete');
    });

    it("denies writing into another user's list", async () => {
      await expectDenied(
        setDoc(doc(firestore, path('feedback', otherUid)), validFeedback({ userId: otherUid })),
        "write to stranger's list"
      );
    });

    it("denies deleting an entry in another user's list", async () => {
      await expectDenied(
        deleteDoc(doc(firestore, path('feedback', otherUid))),
        "delete in stranger's list"
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

  describe('receipt image quota', () => {
    // Written only by the storage triggers, through the Admin SDK, which
    // bypasses rules. The owner may read the figure enforced against them;
    // no client may write it, or the limit would be a number the client
    // picks. Seeded here through the emulator's owner credential, since the
    // rules under test are exactly what stops the SDK from doing it.
    const quotaPath = (owner = uid) => `users/${owner}/quota/receiptImages`;

    const seed = (owner = uid) =>
      setDocumentAsOwner(quotaPath(owner), {
        count: integerField(7),
        limit: integerField(200),
        updatedAt: timestampField()
      });

    // Seeded through a door the rules cannot close, so nothing here removes
    // itself: both accounts' documents are swept by hand, the stranger's
    // included — it belongs to a uid no other case owns.
    afterAll(async () => {
      await deleteDocumentAsOwner(quotaPath()).catch(() => undefined);
      await deleteDocumentAsOwner(quotaPath(otherUid)).catch(() => undefined);
    });

    it('lets the owner read the count enforced against them', async () => {
      await seed();
      const snapshot = await getDoc(doc(firestore, quotaPath()));

      expect(snapshot.exists()).toBe(true);
      expect(snapshot.get('count')).toBe(7);
      expect(snapshot.get('limit')).toBe(200);
    });

    it("denies reading another user's count", async () => {
      await seed(otherUid);
      await expectDenied(getDoc(doc(firestore, quotaPath(otherUid))), "stranger's quota read");
    });

    it('denies a client create', async () => {
      await deleteDocumentAsOwner(quotaPath());
      await expectDenied(
        setDoc(doc(firestore, quotaPath()), {
          count: 0,
          limit: 0,
          updatedAt: Timestamp.now()
        }),
        'client create of the quota document'
      );
    });

    it('denies a client update', async () => {
      await seed();
      await expectDenied(
        updateDoc(doc(firestore, quotaPath()), { count: 0 }),
        'client update of the count'
      );
    });

    it('denies raising the limit', async () => {
      // The whole point of moving the figure server-side: a client that can
      // rewrite its own ceiling is not subject to one.
      await seed();
      await expectDenied(
        updateDoc(doc(firestore, quotaPath()), { limit: 0 }),
        'client raising its own limit'
      );
    });

    it('denies a client delete', async () => {
      // Deleting is as good as raising the limit — a missing document is the
      // bootstrap case, which storage.rules deliberately fails open on.
      await seed();
      await expectDenied(deleteDoc(doc(firestore, quotaPath())), 'client delete of the quota');
    });
  });

  describe('catch-all carve-out', () => {
    // Rules are additive, so the catch-all must exclude every validated
    // collection. Without the exclusion list these writes succeed and every
    // field validator above becomes decorative.
    const validated = [
      'transactions', 'budgets', 'categories', 'goals',
      'recurring', 'savedSearches', 'imports', 'securityEvents', 'secrets',
      'insightSnapshots', 'categoryMemory', 'tagMemory', 'searchAnswers', 'feedback',
      'quota'
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

/**
 * Households (#71): a member reads the other members' transactions,
 * categories, budgets and goals, and nothing else of theirs.
 *
 * Three accounts, each signed in through its own app, rather than the suite
 * above's single app, which signs its anonymous stranger out and cannot sign
 * it back in. Every case here needs all three signed in at once: one forms
 * the household, one joins it, one stays outside. Specs run in random order,
 * so every case starts from pointer-free profiles and builds the state it
 * needs. Households are keyed by fresh ids, so whatever an earlier case left
 * behind is never in the way.
 *
 * Every membership write goes through the client SDK as one commit of the
 * shape the rules require, so an allowed case proves that exact commit is
 * admissible, not just that some write is.
 *
 * The three clients use Firestore Lite: one request per call, no streams.
 * A full client holds a listen and a write stream open against the emulator,
 * and Chrome allows six connections per host, so three of them fill the pool
 * and the next request — the admin REST seeding, or a client's own send —
 * waits until a stream's long poll lapses, tens of seconds later. The rules
 * evaluate a Lite request exactly as they do a full client's.
 */
describe('firestore.rules households (emulator smoke test)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  interface Account {
    name: string;
    app: FirebaseApp;
    db: lite.Firestore;
    uid: string;
  }

  let owner: Account;
  let peer: Account;
  let stranger: Account;

  const SHARED_KINDS = ['transactions', 'categories', 'budgets', 'goals'] as const;
  type SharedKind = (typeof SHARED_KINDS)[number];

  const profile = (account: Pick<Account, 'name'>) => ({
    email: `${account.name}@example.test`,
    displayName: account.name,
    createdAt: lite.Timestamp.now(),
    lastLoginAt: lite.Timestamp.now(),
    preferences: { baseCurrency: 'USD', language: 'en' }
  });

  async function signIn(name: string): Promise<Account> {
    const app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `household-rules-${name}-${Date.now()}`
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    const db = lite.getFirestore(app);
    lite.connectFirestoreEmulator(db, FIRESTORE_HOST, FIRESTORE_PORT);
    const credential = await signInAnonymously(auth);
    const account: Account = { name, app, db, uid: credential.user.uid };
    await lite.setDoc(lite.doc(db, `users/${account.uid}`), profile(account));
    return account;
  }

  /** One row of each kind a household shares, written by its own account. */
  async function seedSharedKinds(account: Account): Promise<void> {
    const base = `users/${account.uid}`;
    const now = () => lite.Timestamp.now();
    await lite.setDoc(
      lite.doc(account.db, `${base}/transactions/household-smoke`),
      transactionFixture(account.uid, now, { description: 'household smoke' })
    );
    await lite.setDoc(lite.doc(account.db, `${base}/categories/household-smoke`), categoryFixture(account.uid));
    await lite.setDoc(lite.doc(account.db, `${base}/budgets/household-smoke`), budgetFixture(account.uid, now));
    await lite.setDoc(lite.doc(account.db, `${base}/goals/household-smoke`), goalFixture(account.uid));
  }

  const householdRef = (account: Account, householdId: string) =>
    lite.doc(account.db, `households/${householdId}`);
  const memberRef = (account: Account, householdId: string, memberUid = account.uid) =>
    lite.doc(account.db, `households/${householdId}/members/${memberUid}`);
  const membersOf = (account: Account, householdId: string) =>
    lite.collection(account.db, `households/${householdId}/members`);
  /**
   * The members query a client makes: one generation's documents only, which
   * is the only list the rules can prove holds no orphans.
   */
  const membersSince = (account: Account, householdId: string, since: lite.Timestamp) =>
    lite.query(membersOf(account, householdId), lite.where('since', '==', since));
  const profileRef = (account: Account) => lite.doc(account.db, `users/${account.uid}`);
  const inviteRef = (account: Account, inviteId: string) =>
    lite.doc(account.db, `householdInvites/${inviteId}`);
  const newHouseholdId = () => lite.doc(lite.collection(owner.db, 'households')).id;

  const householdBody = (account: Account, overrides: Record<string, unknown> = {}) => ({
    name: 'Home',
    ownerId: account.uid,
    createdAt: lite.serverTimestamp(),
    updatedAt: lite.serverTimestamp(),
    ...overrides
  });

  const ownerMemberBody = (account: Account, overrides: Record<string, unknown> = {}) => ({
    uid: account.uid,
    displayName: account.name,
    role: 'owner',
    since: lite.serverTimestamp(),
    joinedAt: lite.serverTimestamp(),
    ...overrides
  });

  interface CreateParts {
    household?: Record<string, unknown>;
    /** null leaves the owner's member document out of the commit. */
    member?: Record<string, unknown> | null;
    /** false leaves the profile pointer out of the commit. */
    pointer?: boolean;
    extra?: (batch: lite.WriteBatch) => void;
  }

  /** The create commit: household, the owner's member document, the pointer. */
  function createCommit(account: Account, householdId: string, parts: CreateParts = {}): Promise<void> {
    const batch = lite.writeBatch(account.db);
    batch.set(householdRef(account, householdId), householdBody(account, parts.household));
    if (parts.member !== null) {
      batch.set(memberRef(account, householdId), ownerMemberBody(account, parts.member));
    }
    if (parts.pointer !== false) {
      batch.update(profileRef(account), { householdId });
    }
    parts.extra?.(batch);
    return batch.commit();
  }

  async function formHousehold(account: Account): Promise<string> {
    const householdId = newHouseholdId();
    await createCommit(account, householdId);
    return householdId;
  }

  /** An owner member document written past the rules, for a household not yet formed. */
  function seedOwnerDocument(account: Account, householdId: string): Promise<void> {
    return setDocumentAsOwner(`households/${householdId}/members/${account.uid}`, {
      uid: stringField(account.uid),
      displayName: stringField(account.name),
      role: stringField('owner'),
      since: timestampField(),
      joinedAt: timestampField()
    });
  }

  /** The stored value, passed through untouched: it keeps its microseconds. */
  function timestampOf(fields: Record<string, EmulatorValue>, key: string): EmulatorField {
    const value = fields[key]?.['timestampValue'];
    if (typeof value !== 'string') {
      throw new Error(`${key} is not a stored timestamp`);
    }
    return { timestampValue: value };
  }

  async function storedHousehold(householdId: string): Promise<Record<string, EmulatorValue>> {
    const fields = await getDocumentAsOwner(`households/${householdId}`);
    if (!fields) {
      throw new Error(`households/${householdId} does not exist`);
    }
    return fields;
  }

  /**
   * The invite the callable writes, written the only way a test can: as the
   * Admin SDK does, past the rules that refuse every client create. The
   * generation it admits to is the household's stored `createdAt` read back
   * over REST, never rebuilt from a Date, which would drop the microseconds
   * the join rule compares.
   */
  async function seedInvite(
    householdId: string,
    invitee: Account,
    overrides: Record<string, EmulatorField> = {},
    inviteId = `${householdId}_${invitee.uid}`
  ): Promise<string> {
    const household = await storedHousehold(householdId);
    await setDocumentAsOwner(`householdInvites/${inviteId}`, {
      householdId: stringField(householdId),
      householdCreatedAt: timestampOf(household, 'createdAt'),
      householdName: stringField('Home'),
      inviterUid: stringField(String(household['ownerId']?.['stringValue'])),
      inviterName: stringField('Inviter'),
      inviterEmail: stringField('inviter@example.test'),
      inviteeUid: stringField(invitee.uid),
      inviteeEmail: stringField(`${invitee.name}@example.test`),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent'),
      ...overrides
    });
    return inviteId;
  }

  interface JoinParts {
    member?: Record<string, unknown>;
    /** false leaves the invite in place. */
    consume?: boolean;
    /** false leaves the profile pointer out of the commit. */
    pointer?: boolean;
  }

  /**
   * The accept commit. It reads only the invite and copies its
   * householdCreatedAt into `since`, so a joiner never reads the household
   * before it is a member of it.
   */
  async function joinCommit(account: Account, householdId: string, parts: JoinParts = {}): Promise<void> {
    const inviteId = `${householdId}_${account.uid}`;
    const invite = await lite.getDoc(inviteRef(account, inviteId));
    const batch = lite.writeBatch(account.db);
    batch.set(memberRef(account, householdId), {
      uid: account.uid,
      displayName: account.name,
      role: 'member',
      since: invite.get('householdCreatedAt'),
      joinedAt: lite.serverTimestamp(),
      inviteId,
      ...parts.member
    });
    if (parts.consume !== false) {
      batch.delete(inviteRef(account, inviteId));
    }
    if (parts.pointer !== false) {
      batch.update(profileRef(account), { householdId });
    }
    return batch.commit();
  }

  function leaveCommit(account: Account, householdId: string): Promise<void> {
    const batch = lite.writeBatch(account.db);
    batch.delete(memberRef(account, householdId));
    batch.update(profileRef(account), { householdId: lite.deleteField() });
    return batch.commit();
  }

  /** One removal chunk of at most four deletes, the most the per-commit lookup budget allows. */
  function removeCommit(account: Account, householdId: string, memberUids: string[]): Promise<void> {
    const batch = lite.writeBatch(account.db);
    for (const memberUid of memberUids) {
      batch.delete(memberRef(account, householdId, memberUid));
    }
    return batch.commit();
  }

  /** The final dissolve commit, once every other member is removed. */
  function dissolveCommit(account: Account, householdId: string): Promise<void> {
    const batch = lite.writeBatch(account.db);
    batch.delete(householdRef(account, householdId));
    batch.delete(memberRef(account, householdId));
    batch.update(profileRef(account), { householdId: lite.deleteField() });
    return batch.commit();
  }

  /** The owner forms a household and the peer joins it, both through the rules. */
  async function formWithPeer(): Promise<string> {
    const householdId = await formHousehold(owner);
    await seedInvite(householdId, peer);
    await joinCommit(peer, householdId);
    return householdId;
  }

  /** A peer's list queries: transactions over a date range, the other kinds whole. */
  function readKind(reader: Account, ownerUid: string, kind: SharedKind) {
    const rows = lite.collection(reader.db, `users/${ownerUid}/${kind}`);
    if (kind !== 'transactions') {
      return lite.getDocs(rows);
    }
    const now = Date.now();
    return lite.getDocs(lite.query(
      rows,
      lite.where('date', '>=', lite.Timestamp.fromMillis(now - 31 * DAY_MS)),
      lite.where('date', '<=', lite.Timestamp.fromMillis(now + DAY_MS))
    ));
  }

  async function liveCreatedAt(reader: Account, householdId: string): Promise<lite.Timestamp> {
    return (await lite.getDoc(householdRef(reader, householdId))).get('createdAt') as lite.Timestamp;
  }

  beforeAll(async () => {
    owner = await signIn('owner');
    peer = await signIn('peer');
    stranger = await signIn('stranger');
    for (const account of [owner, peer, stranger]) {
      await seedSharedKinds(account);
    }
  }, 30000);

  afterAll(async () => {
    for (const account of [owner, peer, stranger]) {
      await deleteApp(account.app).catch(() => undefined);
    }
  });

  // A pointer is only clearable through the rules once its membership is
  // gone, so the reset goes around them. The profile is then rewritten
  // through the client, which also restores one a case deleted.
  beforeEach(async () => {
    for (const account of [owner, peer, stranger]) {
      await patchFieldsAsOwner(`users/${account.uid}`, { householdId: null });
      await lite.setDoc(profileRef(account), profile(account));
    }
  });

  describe('forming and joining', () => {
    it('lets an account form a household: the household, its owner document and the pointer in one commit', async () => {
      await expectAllowed(createCommit(owner, newHouseholdId()), 'the create commit');
    });

    it('accepts a name of 60 characters, a display name of 100 and a photo URL of 2048', async () => {
      const photoHost = 'https://lh3.googleusercontent.com/a/';
      await expectAllowed(
        createCommit(owner, newHouseholdId(), {
          household: { name: 'n'.repeat(60) },
          member: { displayName: 'd'.repeat(100), photoURL: photoHost + 'p'.repeat(2048 - photoHost.length) }
        }),
        'a create at the length limits'
      );
    });

    it('lets an invited account join with since copied from the invite, consuming it', async () => {
      const householdId = await formHousehold(owner);
      const inviteId = await seedInvite(householdId, peer);

      await expectAllowed(joinCommit(peer, householdId), 'the join commit');

      expect(await getDocumentAsOwner(`householdInvites/${inviteId}`)).toBeNull();
      const member = await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`);
      expect(timestampOf(member ?? {}, 'since'))
        .toEqual(timestampOf(await storedHousehold(householdId), 'createdAt'));
    });

    it('lets a removed member whose pointer is stale accept an invite elsewhere', async () => {
      const first = await formWithPeer();
      await removeCommit(owner, first, [peer.uid]);
      const second = await formHousehold(stranger);
      await seedInvite(second, peer);

      await expectAllowed(joinCommit(peer, second), 'a join that moves a stale pointer');
    });
  });

  describe('reading as a member', () => {
    let householdId: string;

    beforeEach(async () => {
      householdId = await formWithPeer();
    });

    for (const kind of SHARED_KINDS) {
      it(`lets the peer list the owner's ${kind}`, async () => {
        const rows = await readKind(peer, owner.uid, kind);
        expect(rows.size).toBeGreaterThan(0);
      });

      it(`lets the owner list the peer's ${kind}`, async () => {
        const rows = await readKind(owner, peer.uid, kind);
        expect(rows.size).toBeGreaterThan(0);
      });
    }

    it("lets a member get the household, list this generation's members and read each member document", async () => {
      for (const account of [owner, peer]) {
        const household = await lite.getDoc(householdRef(account, householdId));
        expect(household.get('name')).toBe('Home');
        const members = await lite.getDocs(
          membersSince(account, householdId, household.get('createdAt') as lite.Timestamp)
        );
        expect(members.docs.map(entry => entry.id).sort()).toEqual([owner.uid, peer.uid].sort());
        for (const memberUid of [owner.uid, peer.uid]) {
          expect((await lite.getDoc(memberRef(account, householdId, memberUid))).exists()).toBe(true);
        }
      }
    });

    it('answers a removed member document with not-found, not a refusal, to it and to the owner', async () => {
      await removeCommit(owner, householdId, [peer.uid]);
      expect((await lite.getDoc(memberRef(peer, householdId))).exists()).toBe(false);
      expect((await lite.getDoc(memberRef(owner, householdId, peer.uid))).exists()).toBe(false);
    });
  });

  describe('managing and leaving', () => {
    it('lets the owner rename the household', async () => {
      const householdId = await formHousehold(owner);
      await expectAllowed(
        lite.updateDoc(householdRef(owner, householdId), { name: 'Renamed', updatedAt: lite.serverTimestamp() }),
        'a rename'
      );
    });

    it('lets a member update its own display name and photo', async () => {
      const householdId = await formWithPeer();
      await expectAllowed(
        lite.updateDoc(memberRef(peer, householdId), {
          displayName: 'Peer again',
          photoURL: 'https://lh4.googleusercontent.com/a/peer'
        }),
        'a self-update of the display fields'
      );
    });

    it('lets a member drop its own photo, as the app does when the profile has none the rules take', async () => {
      const householdId = await formWithPeer();
      await lite.updateDoc(memberRef(peer, householdId), { photoURL: 'https://lh4.googleusercontent.com/a/peer' });
      await expectAllowed(
        lite.updateDoc(memberRef(peer, householdId), { displayName: 'Peer again', photoURL: lite.deleteField() }),
        'a self-update removing the photo'
      );
    });

    it('lets the owner remove members, several in one commit', async () => {
      const householdId = await formWithPeer();
      await seedInvite(householdId, stranger);
      await joinCommit(stranger, householdId);

      await expectAllowed(
        removeCommit(owner, householdId, [peer.uid, stranger.uid]),
        'a removal chunk'
      );
    });

    it('lets a member leave: its member document and its pointer in one commit', async () => {
      const householdId = await formWithPeer();
      await expectAllowed(leaveCommit(peer, householdId), 'the leave commit');
    });

    it('lets a removed member clear its stale pointer on its own', async () => {
      const householdId = await formWithPeer();
      await removeCommit(owner, householdId, [peer.uid]);

      await expectAllowed(
        lite.updateDoc(profileRef(peer), { householdId: lite.deleteField() }),
        'a lone stale-pointer clear'
      );
    });

    it('lets the owner dissolve: the others removed, then the household, its own document and its pointer', async () => {
      const householdId = await formWithPeer();

      await expectAllowed(removeCommit(owner, householdId, [peer.uid]), 'the removal chunk');
      await expectAllowed(dissolveCommit(owner, householdId), 'the final dissolve commit');

      expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
      expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    });

    it('lets anyone tidy a member document once its household is gone', async () => {
      const householdId = await formWithPeer();
      await deleteDocumentAsOwner(`households/${householdId}`);

      await expectAllowed(
        lite.deleteDoc(memberRef(stranger, householdId, peer.uid)),
        'a stranger deleting an orphaned member document'
      );
    });

    it('lets a member that has left delete its profile, stale pointer and all', async () => {
      const householdId = await formWithPeer();
      await lite.deleteDoc(memberRef(peer, householdId));

      await expectAllowed(lite.deleteDoc(profileRef(peer)), 'a profile delete after leaving');
    });
  });

  describe('invites', () => {
    let householdId: string;
    let inviteId: string;

    beforeEach(async () => {
      householdId = await formHousehold(owner);
      inviteId = await seedInvite(householdId, peer);
    });

    it('lets the inviter and the invitee read the invite, and each list their own', async () => {
      await expectAllowed(lite.getDoc(inviteRef(owner, inviteId)), 'the inviter reading');
      await expectAllowed(lite.getDoc(inviteRef(peer, inviteId)), 'the invitee reading');

      const sent = await lite.getDocs(lite.query(
        lite.collection(owner.db, 'householdInvites'),
        lite.where('inviterUid', '==', owner.uid)
      ));
      expect(sent.docs.map(entry => entry.id)).toContain(inviteId);
      const received = await lite.getDocs(lite.query(
        lite.collection(peer.db, 'householdInvites'),
        lite.where('inviteeUid', '==', peer.uid)
      ));
      expect(received.docs.map(entry => entry.id)).toContain(inviteId);
    });

    it('lets the inviter revoke the invite', async () => {
      await expectAllowed(lite.deleteDoc(inviteRef(owner, inviteId)), 'a revoke');
    });

    it('lets the invitee decline the invite', async () => {
      await expectAllowed(lite.deleteDoc(inviteRef(peer, inviteId)), 'a decline');
    });

    it('lets the invitee delete an expired invite', async () => {
      await seedInvite(householdId, peer, {
        expiresAt: timestampField(new Date(Date.now() - DAY_MS))
      });
      await expectAllowed(lite.deleteDoc(inviteRef(peer, inviteId)), 'deleting an expired invite');
    });

    it('refuses any client create of an invite', async () => {
      await deleteDocumentAsOwner(`householdInvites/${inviteId}`);
      await expectDenied(
        lite.setDoc(inviteRef(owner, inviteId), {
          householdId,
          householdCreatedAt: await liveCreatedAt(owner, householdId),
          householdName: 'Home',
          inviterUid: owner.uid,
          inviterName: 'owner',
          inviterEmail: 'owner@example.test',
          inviteeUid: peer.uid,
          inviteeEmail: 'peer@example.test',
          locale: 'en',
          createdAt: lite.Timestamp.now(),
          expiresAt: lite.Timestamp.fromMillis(Date.now() + 7 * DAY_MS),
          mail: 'sent'
        }),
        'the inviter writing its own invite'
      );
    });

    it('refuses any client update of an invite, by the inviter or the invitee', async () => {
      const later = lite.Timestamp.fromMillis(Date.now() + 30 * DAY_MS);
      await expectDenied(lite.updateDoc(inviteRef(owner, inviteId), { expiresAt: later }), 'the inviter extending it');
      await expectDenied(lite.updateDoc(inviteRef(peer, inviteId), { expiresAt: later }), 'the invitee extending it');
    });

    it('refuses a third party reading an invite', async () => {
      await expectDenied(lite.getDoc(inviteRef(stranger, inviteId)), 'a stranger reading an invite');
    });

    it('refuses a third party deleting an invite', async () => {
      await expectDenied(lite.deleteDoc(inviteRef(stranger, inviteId)), 'a stranger deleting an invite');
    });

    it('refuses listing invites by household alone', async () => {
      await expectDenied(
        lite.getDocs(lite.query(lite.collection(owner.db, 'householdInvites'), lite.where('householdId', '==', householdId))),
        'an invite list filtered only by household'
      );
    });
  });

  describe('callable-only documents', () => {
    const quotaPath = () => `inviteQuotas/${owner.uid}`;
    const budgetPath = 'mailBudget/daily';

    beforeEach(async () => {
      await setDocumentAsOwner(quotaPath(), {
        windowStart: timestampField(),
        count: integerField(3),
        inboundWindowStart: timestampField(),
        inbound: integerField(1)
      });
      await setDocumentAsOwner(budgetPath, { day: stringField('2026-09-25'), count: integerField(4) });
    });

    it("refuses every client access to one's own invite quota", async () => {
      const ref = lite.doc(owner.db, quotaPath());
      await expectDenied(lite.getDoc(ref), 'reading the quota');
      await expectDenied(lite.setDoc(ref, { windowStart: lite.Timestamp.now(), count: 0 }), 'replacing the quota');
      await expectDenied(lite.updateDoc(ref, { count: 0 }), 'resetting the count');
      await expectDenied(lite.deleteDoc(ref), 'deleting the quota');
    });

    it('refuses every client access to the mail budget', async () => {
      const ref = lite.doc(owner.db, budgetPath);
      await expectDenied(lite.getDoc(ref), 'reading the budget');
      await expectDenied(lite.setDoc(ref, { day: '2026-09-25', count: 0 }), 'replacing the budget');
      await expectDenied(lite.updateDoc(ref, { count: 0 }), 'resetting the budget');
      await expectDenied(lite.deleteDoc(ref), 'deleting the budget');
    });
  });

  describe('creating, refused', () => {
    // The next three commit the household alone, with what the rest of the
    // create commit would write already in place past the rules, so the one
    // missing or wrong part is all that is left to refuse it.

    it('refuses a household with no owner member document', async () => {
      const householdId = newHouseholdId();
      await patchFieldsAsOwner(`users/${owner.uid}`, { householdId: stringField(householdId) });
      await expectDenied(
        createCommit(owner, householdId, { member: null, pointer: false }),
        'a create without a member document'
      );
    });

    it("refuses a household naming someone else's ownerId", async () => {
      const householdId = newHouseholdId();
      await seedOwnerDocument(owner, householdId);
      await patchFieldsAsOwner(`users/${owner.uid}`, { householdId: stringField(householdId) });
      await expectDenied(
        createCommit(owner, householdId, { household: { ownerId: peer.uid }, member: null, pointer: false }),
        'a create for another owner'
      );
    });

    it('refuses a createdAt that is not the request time', async () => {
      // The member document carries the same client stamp, so its own
      // since-check passes and only the household's generation rule is left.
      const stamp = lite.Timestamp.now();
      await expectDenied(
        createCommit(owner, newHouseholdId(), { household: { createdAt: stamp }, member: { since: stamp } }),
        'a client-chosen createdAt'
      );
    });

    it('refuses a household without the pointer write', async () => {
      const householdId = newHouseholdId();
      await seedOwnerDocument(owner, householdId);
      await expectDenied(
        createCommit(owner, householdId, { member: null, pointer: false }),
        'a create without the pointer'
      );
    });

    it('refuses an owner member document for another uid', async () => {
      const householdId = newHouseholdId();
      await expectDenied(
        createCommit(owner, householdId, {
          extra: batch => batch.set(memberRef(owner, householdId, peer.uid), ownerMemberBody(peer))
        }),
        "a create that writes the peer's member document"
      );
    });

    it("refuses an owner member document whose since is not the household's createdAt", async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { member: { since: lite.Timestamp.fromMillis(0) } }),
        'a mismatched since'
      );
    });

    it('refuses an owner member document in a household that already exists', async () => {
      const householdId = await formHousehold(owner);
      const createdAt = await liveCreatedAt(owner, householdId);
      // Everything else about the write holds (pointer, since, ownerId), so
      // the only clause left to refuse it is "the household is new".
      await deleteDocumentAsOwner(`households/${householdId}/members/${owner.uid}`);

      await expectDenied(
        lite.setDoc(memberRef(owner, householdId), ownerMemberBody(owner, { since: createdAt })),
        'an owner document written into a live household'
      );
    });

    it("refuses a stranger's owner member document in someone else's household", async () => {
      const householdId = await formHousehold(owner);
      const createdAt = await liveCreatedAt(owner, householdId);
      const batch = lite.writeBatch(stranger.db);
      batch.set(memberRef(stranger, householdId), ownerMemberBody(stranger, { since: createdAt }));
      batch.update(profileRef(stranger), { householdId });

      await expectDenied(batch.commit(), 'a stranger claiming ownership');
    });

    it('refuses a live member starting a second household', async () => {
      await formWithPeer();
      await expectDenied(createCommit(peer, newHouseholdId()), 'a second household');
    });
  });

  describe('joining, refused', () => {
    let householdId: string;

    beforeEach(async () => {
      householdId = await formHousehold(owner);
    });

    it('refuses an invite made out to another account', async () => {
      // Filed under the stranger's id and deletable by it as the inviter, so
      // the invite's own rules pass; only the named invitee is wrong.
      await seedInvite(householdId, stranger, {
        inviteeUid: stringField(peer.uid),
        inviterUid: stringField(stranger.uid)
      });
      await expectDenied(joinCommit(stranger, householdId), "a join on someone else's invite");
    });

    it('refuses an invite made out for another household', async () => {
      const elsewhere = await formHousehold(stranger);
      await seedInvite(elsewhere, peer, { householdId: stringField(householdId) });
      await expectDenied(joinCommit(peer, elsewhere), 'a join on an invite naming another household');
    });

    it('refuses a member document citing an invite other than its own', async () => {
      await seedInvite(householdId, peer);
      await expectDenied(
        joinCommit(peer, householdId, { member: { inviteId: `${householdId}_${stranger.uid}` } }),
        'a join citing the wrong invite id'
      );
    });

    it('refuses an expired invite', async () => {
      await seedInvite(householdId, peer, { expiresAt: timestampField(new Date(Date.now() - DAY_MS)) });
      await expectDenied(joinCommit(peer, householdId), 'a join on an expired invite');
    });

    it('refuses a join that leaves the invite in place', async () => {
      await seedInvite(householdId, peer);
      await expectDenied(joinCommit(peer, householdId, { consume: false }), 'a join that keeps its invite');
    });

    it('refuses a join without the pointer write', async () => {
      await seedInvite(householdId, peer);
      await expectDenied(joinCommit(peer, householdId, { pointer: false }), 'a join without the pointer');
    });

    it('refuses a join while a live member elsewhere', async () => {
      const elsewhere = await formHousehold(stranger);
      await seedInvite(elsewhere, peer);
      await joinCommit(peer, elsewhere);
      await seedInvite(householdId, peer);

      await expectDenied(joinCommit(peer, householdId), 'a join that abandons a live membership');
    });

    it('refuses a join into a household that is gone', async () => {
      await seedInvite(householdId, peer);
      await dissolveCommit(owner, householdId);

      await expectDenied(joinCommit(peer, householdId), 'a join into a dissolved household');
    });

    it("refuses a stranger's member document with no invite", async () => {
      const createdAt = await liveCreatedAt(owner, householdId);
      const batch = lite.writeBatch(stranger.db);
      batch.set(memberRef(stranger, householdId), {
        uid: stranger.uid,
        displayName: stranger.name,
        role: 'member',
        since: createdAt,
        joinedAt: lite.serverTimestamp(),
        inviteId: `${householdId}_${stranger.uid}`
      });
      batch.update(profileRef(stranger), { householdId });

      await expectDenied(batch.commit(), 'an uninvited join');
    });

    it('refuses since stamped by the server rather than copied from the invite', async () => {
      await seedInvite(householdId, peer);
      await expectDenied(
        joinCommit(peer, householdId, { member: { since: lite.serverTimestamp() } }),
        'a join stamping its own since'
      );
    });

    it('refuses an invite stamped for an earlier generation, even when since names the live one', async () => {
      const earlier = timestampOf(await storedHousehold(householdId), 'createdAt');
      await dissolveCommit(owner, householdId);
      await createCommit(owner, householdId);
      const live = await liveCreatedAt(owner, householdId);
      expect(timestampOf(await storedHousehold(householdId), 'createdAt')).not.toEqual(earlier);
      await seedInvite(householdId, peer, { householdCreatedAt: earlier });

      await expectDenied(
        joinCommit(peer, householdId, { member: { since: live } }),
        'a join on a dead generation'
      );
    });
  });

  describe('pointer, refused', () => {
    it('refuses a pointer at a household the account has no member document in', async () => {
      const householdId = await formHousehold(owner);
      await expectDenied(lite.updateDoc(profileRef(peer), { householdId }), 'a pointer with no membership');
    });

    it('refuses an empty pointer', async () => {
      await expectDenied(lite.updateDoc(profileRef(peer), { householdId: '' }), 'an empty pointer');
    });

    it('refuses clearing the pointer while still a member', async () => {
      await formWithPeer();
      await expectDenied(
        lite.updateDoc(profileRef(peer), { householdId: lite.deleteField() }),
        'a pointer clear that keeps the membership'
      );
    });

    it('refuses householdId on a profile create', async () => {
      await deleteDocumentAsOwner(`users/${stranger.uid}`);
      await expectDenied(
        lite.setDoc(profileRef(stranger), { ...profile(stranger), householdId: newHouseholdId() }),
        'a profile born with a pointer'
      );
    });

    it('refuses deleting the profile while a live member', async () => {
      await formWithPeer();
      await expectDenied(lite.deleteDoc(profileRef(peer)), "a live member's profile delete");
      await expectDenied(lite.deleteDoc(profileRef(owner)), "a live owner's profile delete");
    });
  });

  describe('reading, refused', () => {
    for (const kind of SHARED_KINDS) {
      it(`refuses the stranger listing a member's ${kind}`, async () => {
        await formWithPeer();
        await expectDenied(readKind(stranger, owner.uid, kind), `a stranger reading ${kind}`);
      });
    }

    it('refuses a stranger whose own pointer names the household', async () => {
      // The pointer is the one field an account writes about itself, so it
      // proves nothing: the stranger's missing member document decides.
      const householdId = await formWithPeer();
      await patchFieldsAsOwner(`users/${stranger.uid}`, { householdId: stringField(householdId) });

      for (const kind of SHARED_KINDS) {
        await expectDenied(readKind(stranger, owner.uid, kind), `a self-pointed stranger reading ${kind}`);
      }
    });

    it('refuses the stranger getting the household, listing its members or reading one', async () => {
      const householdId = await formWithPeer();
      const live = await liveCreatedAt(owner, householdId);
      await expectDenied(lite.getDoc(householdRef(stranger, householdId)), 'a stranger getting the household');
      await expectDenied(lite.getDocs(membersSince(stranger, householdId, live)), 'a stranger listing members');
      await expectDenied(lite.getDoc(memberRef(stranger, householdId, peer.uid)), 'a stranger reading a member');
    });

    const ownerOnly = [
      'recurring', 'savedSearches', 'searchAnswers', 'imports', 'secrets', 'feedback',
      'categoryMemory', 'tagMemory', 'insightSnapshots', 'securityEvents', 'quota',
      'unvalidatedProbe'
    ];

    for (const kind of ownerOnly) {
      it(`refuses the peer reading the owner's ${kind}`, async () => {
        await formWithPeer();
        await expectDenied(
          lite.getDocs(lite.collection(peer.db, `users/${owner.uid}/${kind}`)),
          `the peer listing ${kind}`
        );
      });
    }

    it("refuses the peer reading the owner's profile", async () => {
      await formWithPeer();
      await expectDenied(lite.getDoc(lite.doc(peer.db, `users/${owner.uid}`)), "the peer reading the owner's profile");
    });

    async function expectCutOff(householdId: string): Promise<void> {
      const live = await liveCreatedAt(owner, householdId);
      for (const kind of SHARED_KINDS) {
        await expectDenied(readKind(peer, owner.uid, kind), `the former peer reading ${kind}`);
        await expectDenied(readKind(owner, peer.uid, kind), `the owner reading the former peer's ${kind}`);
      }
      await expectDenied(lite.getDoc(householdRef(peer, householdId)), 'the former peer getting the household');
      await expectDenied(lite.getDocs(membersSince(peer, householdId, live)), 'the former peer listing members');
    }

    it('refuses reads both ways after the peer is removed', async () => {
      const householdId = await formWithPeer();
      await removeCommit(owner, householdId, [peer.uid]);
      await expectCutOff(householdId);
    });

    it('refuses reads both ways after the peer leaves', async () => {
      const householdId = await formWithPeer();
      await leaveCommit(peer, householdId);
      await expectCutOff(householdId);
    });

    it('refuses every read across a dissolve and a re-create under the same id', async () => {
      const householdId = await formWithPeer();
      const earlier = timestampOf(await storedHousehold(householdId), 'createdAt');
      await removeCommit(owner, householdId, [peer.uid]);
      await dissolveCommit(owner, householdId);

      // What an interrupted sweep leaves: both member documents of the dead
      // generation, and both pointers still naming its id.
      for (const account of [owner, peer]) {
        await setDocumentAsOwner(`households/${householdId}/members/${account.uid}`, {
          uid: stringField(account.uid),
          displayName: stringField(account.name),
          role: stringField(account === owner ? 'owner' : 'member'),
          since: earlier,
          joinedAt: earlier
        });
        await patchFieldsAsOwner(`users/${account.uid}`, { householdId: stringField(householdId) });
      }

      // A new generation under the same id.
      await createCommit(stranger, householdId);
      expect(timestampOf(await storedHousehold(householdId), 'createdAt')).not.toEqual(earlier);
      const live = await liveCreatedAt(stranger, householdId);

      for (const kind of SHARED_KINDS) {
        await expectDenied(readKind(peer, owner.uid, kind), `orphan reading orphan's ${kind}`);
        await expectDenied(readKind(owner, peer.uid, kind), `orphan owner reading orphan's ${kind}`);
        await expectDenied(readKind(peer, stranger.uid, kind), `orphan reading the new owner's ${kind}`);
        await expectDenied(readKind(stranger, peer.uid, kind), `the new owner reading an orphan's ${kind}`);
      }
      for (const account of [owner, peer]) {
        await expectDenied(lite.getDoc(householdRef(account, householdId)), `${account.name} getting the new generation`);
        await expectDenied(
          lite.getDocs(membersSince(account, householdId, live)),
          `${account.name} listing its members`
        );
      }

      // The new owner is a live member, yet the orphans stay out of its
      // sight: a list that does not filter on its generation, or a get of an
      // orphan's document, is refused, and the filtered list holds only itself.
      await expectDenied(lite.getDocs(membersOf(stranger, householdId)), 'the new owner listing every generation');
      await expectDenied(
        lite.getDoc(memberRef(stranger, householdId, peer.uid)),
        "the new owner reading an orphan's member document"
      );
      const members = await lite.getDocs(membersSince(stranger, householdId, live));
      expect(members.docs.map(entry => entry.id)).toEqual([stranger.uid]);

      // The new generation itself still reads, so the refusals above are
      // about the orphans, not about the id.
      await expectAllowed(lite.getDoc(householdRef(stranger, householdId)), 'the new owner getting its household');
    }, 30000);
  });

  describe('changing, refused', () => {
    it('refuses the owner deleting the household while its own member document survives', async () => {
      const householdId = await formHousehold(owner);
      await expectDenied(lite.deleteDoc(householdRef(owner, householdId)), 'a dissolve that keeps the owner document');
    });

    it('refuses the owner leaving a household it still owns', async () => {
      const householdId = await formHousehold(owner);
      await expectDenied(lite.deleteDoc(memberRef(owner, householdId)), "the owner deleting its own document");
      await expectDenied(leaveCommit(owner, householdId), 'the owner leaving');
    });

    it('refuses a member deleting the household', async () => {
      const householdId = await formWithPeer();
      const batch = lite.writeBatch(peer.db);
      batch.delete(householdRef(peer, householdId));
      batch.delete(memberRef(peer, householdId));

      await expectDenied(batch.commit(), 'a member dissolving');
    });

    it('refuses an owner update touching ownerId', async () => {
      const householdId = await formWithPeer();
      await expectDenied(
        lite.updateDoc(householdRef(owner, householdId), { ownerId: peer.uid }),
        'handing the household over'
      );
    });

    it('refuses an owner update touching createdAt', async () => {
      const householdId = await formHousehold(owner);
      await expectDenied(
        lite.updateDoc(householdRef(owner, householdId), { createdAt: lite.serverTimestamp() }),
        'restamping the generation'
      );
    });

    it('refuses a member renaming the household', async () => {
      const householdId = await formWithPeer();
      await expectDenied(
        lite.updateDoc(householdRef(peer, householdId), { name: 'Mine now', updatedAt: lite.serverTimestamp() }),
        'a member renaming'
      );
    });

    const frozen: [string, () => unknown][] = [
      ['role', () => 'owner'],
      ['since', () => lite.Timestamp.now()],
      ['uid', () => stranger.uid],
      ['inviteId', () => 'another-invite'],
      ['joinedAt', () => lite.Timestamp.now()]
    ];

    for (const [field, value] of frozen) {
      it(`refuses a member rewriting its own ${field}`, async () => {
        const householdId = await formWithPeer();
        await expectDenied(
          lite.updateDoc(memberRef(peer, householdId), { [field]: value() }),
          `a self-update of ${field}`
        );
      });
    }

    it("refuses a stale member rewriting its orphan's since to a re-created household's createdAt", async () => {
      const householdId = await formWithPeer();
      await deleteDocumentAsOwner(`households/${householdId}`);
      await createCommit(stranger, householdId);
      const live = await liveCreatedAt(stranger, householdId);

      await expectDenied(
        lite.updateDoc(memberRef(peer, householdId), { since: live }),
        'an orphan adopting the new generation'
      );
    });

    it('refuses a member removing another member', async () => {
      const householdId = await formWithPeer();
      await seedInvite(householdId, stranger);
      await joinCommit(stranger, householdId);

      await expectDenied(
        lite.deleteDoc(memberRef(peer, householdId, stranger.uid)),
        'a member removing a member'
      );
    });

    it("refuses a stranger deleting a live member's document", async () => {
      const householdId = await formWithPeer();
      await expectDenied(
        lite.deleteDoc(memberRef(stranger, householdId, peer.uid)),
        'a stranger removing a member'
      );
    });

    it('refuses an owner deleting a member document in a household it does not own', async () => {
      await formHousehold(owner);
      const elsewhere = await formHousehold(stranger);
      await seedInvite(elsewhere, peer);
      await joinCommit(peer, elsewhere);

      await expectDenied(
        lite.deleteDoc(memberRef(owner, elsewhere, peer.uid)),
        "an owner removing a member of another household"
      );
    });
  });

  describe('shapes, refused', () => {
    it('refuses a role outside owner and member', async () => {
      // Through the join, where a valid invite satisfies everything but the
      // enum: an owner create would also fail the founding-owner clause.
      const householdId = await formHousehold(owner);
      await seedInvite(householdId, peer);
      await expectDenied(joinCommit(peer, householdId, { member: { role: 'admin' } }), 'role admin');
    });

    it('refuses a display name over 100 characters', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { member: { displayName: 'd'.repeat(101) } }),
        'a 101-character display name'
      );
    });

    it('refuses a photo URL that is not https', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { member: { photoURL: 'http://lh3.googleusercontent.com/a/me' } }),
        'an http photo'
      );
    });

    it("refuses a photo URL on any host but Google's account-picture hosts", async () => {
      // Every member's browser loads the picture: its host would learn each
      // viewer's address and when they open the household page.
      for (const photoURL of [
        'https://example.test/me.png',
        'https://lh3.googleusercontent.com.example.test/a/me',
        'https://lh7.googleusercontent.com/a/me'
      ]) {
        await expectDenied(createCommit(owner, newHouseholdId(), { member: { photoURL } }), photoURL);
      }
    });

    it('refuses a photo URL over 2048 characters', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), {
          member: { photoURL: `https://lh3.googleusercontent.com/${'p'.repeat(2048)}` }
        }),
        'an oversized photo URL'
      );
    });

    it('refuses an empty name', async () => {
      await expectDenied(createCommit(owner, newHouseholdId(), { household: { name: '' } }), 'an empty name');
    });

    it('refuses a name over 60 characters', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { household: { name: 'n'.repeat(61) } }),
        'a 61-character name'
      );
    });

    it('refuses an extra key on the household', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { household: { plan: 'premium' } }),
        'an extra household key'
      );
    });

    it('refuses an invite id on the owner member document', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { member: { inviteId: 'anything' } }),
        'an owner document citing an invite'
      );
    });

    it('refuses an invite id on the owner member document even in the joining form', async () => {
      const householdId = newHouseholdId();
      await expectDenied(
        createCommit(owner, householdId, { member: { inviteId: `${householdId}_${owner.uid}` } }),
        'an owner document citing its own invite id'
      );
    });

    it('refuses an extra key on a member document', async () => {
      await expectDenied(
        createCommit(owner, newHouseholdId(), { member: { admin: true } }),
        'an extra member key'
      );
    });

    it('refuses a rename to an empty name', async () => {
      const householdId = await formHousehold(owner);
      await expectDenied(lite.updateDoc(householdRef(owner, householdId), { name: '' }), 'renaming to nothing');
    });

    it('refuses a self-update to an oversized display name, an http photo or a photo on another host', async () => {
      const householdId = await formWithPeer();
      await expectDenied(
        lite.updateDoc(memberRef(peer, householdId), { displayName: 'd'.repeat(101) }),
        'a 101-character display name update'
      );
      await expectDenied(
        lite.updateDoc(memberRef(peer, householdId), { photoURL: 'http://lh3.googleusercontent.com/a/p' }),
        'an http photo update'
      );
      await expectDenied(
        lite.updateDoc(memberRef(peer, householdId), { photoURL: 'https://example.test/p.png' }),
        'a photo update to another host'
      );
    });
  });
});
