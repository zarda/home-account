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
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { RecurringService, MAX_OCCURRENCES_PER_CLAIM } from './recurring.service';
import { dayKey } from '../utils/transaction-date.utils';

/**
 * Integration smoke test for the recurring catch-up loop against the Firestore
 * emulator.
 *
 * The unit suite stubs `runTransaction`, so it can prove which occurrence dates
 * the loop computes but not that each one becomes its own document. The
 * idempotency key is derived from the occurrence date — `rec-<rule>-<time>` —
 * which means a date bug and a duplicate-posting bug are the same bug: two
 * occurrences that collapse onto one date collapse onto one document, and the
 * month in between is simply never written. Only a real commit shows that.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('RecurringService catch-up (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: RecurringService;

  const RULE_ID = 'smoke-rent-31st';

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `recurring-catchup-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  // A rule due on the 31st of every month, first occurrence 31 January of the
  // year before last, so a single catch-up has to walk it through two Februarys
  // and every other short month on the way to today.
  const FIRST = new Date(new Date().getFullYear() - 2, 0, 31, 9);

  beforeEach(async () => {
    await setDoc(doc(firestore, `users/${uid}/recurring/${RULE_ID}`), {
      userId: uid,
      name: 'Rent',
      type: 'expense',
      amount: 1000,
      currency: 'USD',
      categoryId: 'housing_rent',
      description: 'Rent',
      frequency: { type: 'monthly', interval: 1, dayOfMonth: 31 },
      startDate: Timestamp.fromDate(FIRST),
      nextOccurrence: Timestamp.fromDate(FIRST),
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    TestBed.configureTestingModule({
      providers: [
        RecurringService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // Rates and budgets are loaded before the claim runs but play no part
        // in which occurrences it posts; stubs keep the suite hermetic.
        {
          provide: CurrencyService,
          useValue: {
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1
          }
        },
        {
          provide: BudgetService,
          useValue: {
            getBudgets: () => of([]),
            recalculateBudgetsForCategory: () => Promise.resolve()
          }
        },
        { provide: TranslationService, useValue: { t: (key: string) => key } }
      ]
    });
    service = TestBed.inject(RecurringService);
  });

  afterEach(async () => {
    await deleteDoc(doc(firestore, `users/${uid}/recurring/${RULE_ID}`)).catch(() => undefined);
    const posted = await getDocs(collection(firestore, `users/${uid}/transactions`));
    await Promise.all(
      posted.docs
        .filter(d => d.id.startsWith(`rec-${RULE_ID}-`))
        .map(d => deleteDoc(d.ref).catch(() => undefined))
    );
  });

  const postedDayKeys = async (): Promise<string[]> => {
    const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
    return snapshot.docs
      .filter(d => d.id.startsWith(`rec-${RULE_ID}-`))
      .map(d => dayKey((d.data()['date'] as Timestamp).toDate()))
      .sort();
  };

  it('posts one document per month, including every month shorter than 31 days', async () => {
    await service.catchUpRecurringTransactions();

    const days = await postedDayKeys();

    // Two full years of a monthly rule, so every month must appear exactly
    // once. February, April, June, September and November were all missing
    // while the month was shifted before the day was clamped.
    const months = days.map(d => d.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);

    const monthNumbers = new Set(months.map(m => m.slice(5)));
    expect([...monthNumbers].sort()).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
    );
  }, 60000);

  it('lands each occurrence on the last day its month actually has', async () => {
    await service.catchUpRecurringTransactions();

    for (const day of await postedDayKeys()) {
      const [year, month, date] = day.split('-').map(Number);
      const lastDayOfThatMonth = new Date(year, month, 0).getDate();
      expect(date).toBe(Math.min(31, lastDayOfThatMonth));
    }
  }, 60000);

  it('drains a daily backlog past the per-claim cap without exceeding the write limit', async () => {
    const DRAIN_ID = 'smoke-daily-dormant';
    // One full claim plus a remainder, so the drain loop must commit at
    // least two real transactions — the case the unbounded claim could
    // never commit at all.
    const daysBack = MAX_OCCURRENCES_PER_CLAIM + 50;
    const first = new Date();
    first.setHours(9, 0, 0, 0);
    first.setDate(first.getDate() - daysBack);

    await setDoc(doc(firestore, `users/${uid}/recurring/${DRAIN_ID}`), {
      userId: uid,
      name: 'Daily dormant',
      type: 'expense',
      amount: 3,
      currency: 'USD',
      categoryId: 'food_coffee',
      description: 'Coffee',
      frequency: { type: 'daily', interval: 1 },
      startDate: Timestamp.fromDate(first),
      nextOccurrence: Timestamp.fromDate(first),
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    try {
      await service.catchUpRecurringTransactions();

      const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const posted = snapshot.docs.filter(d => d.id.startsWith(`rec-${DRAIN_ID}-`));

      // Every due day posted exactly once across the claims.
      expect(posted.length).toBeGreaterThanOrEqual(daysBack);
      expect(new Set(posted.map(d => d.id)).size).toBe(posted.length);

      // The rule ends drained: pointer past now, still active.
      const rule = await getDoc(doc(firestore, `users/${uid}/recurring/${DRAIN_ID}`));
      const next = (rule.data()!['nextOccurrence'] as Timestamp).toDate();
      expect(next.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(rule.data()!['isActive']).toBeTrue();
    } finally {
      await deleteDoc(doc(firestore, `users/${uid}/recurring/${DRAIN_ID}`)).catch(() => undefined);
      const leftovers = await getDocs(collection(firestore, `users/${uid}/transactions`));
      await Promise.all(
        leftovers.docs
          .filter(d => d.id.startsWith(`rec-${DRAIN_ID}-`))
          .map(d => deleteDoc(d.ref).catch(() => undefined))
      );
    }
  }, 120000);

  it('is idempotent: a second catch-up adds no documents', async () => {
    await service.catchUpRecurringTransactions();
    const first = await postedDayKeys();

    await service.catchUpRecurringTransactions();

    expect(await postedDayKeys()).toEqual(first);
  }, 60000);
});
