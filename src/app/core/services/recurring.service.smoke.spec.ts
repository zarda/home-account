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
  updateDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { firstValueFrom, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { RecurringService, MAX_OCCURRENCES_PER_CLAIM, recurringPostingId } from './recurring.service';
import { addDays, dayKey, startOfDay } from '../utils/transaction-date.utils';
import { isSeed, opaqueRowId } from '../utils/opaque-id.utils';
import { prefillFromGroup } from '../utils/recurring-conversion.utils';
import { StorableRecurringGroup } from '../../models';
import { integerField, patchFieldsAsOwner } from './testing/emulator-admin';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for the recurring catch-up loop against the Firestore
 * emulator.
 *
 * The unit suite stubs `runTransaction`, so it can prove which occurrence dates
 * the loop computes but not that each one becomes its own document. The
 * idempotency key is a digest of the rule's salt, the rule and the occurrence
 * date (`recurringPostingId`), which means a date bug and a duplicate-posting
 * bug are the same bug: two occurrences that collapse onto one date collapse
 * onto one document, and the month in between is simply never written. Only a
 * real commit shows that. The id names neither, so these cases find a rule's
 * rows by the `recurringId` each one stores.
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
  /** The rule the bad-state cases seed whole and then break. */
  const BAD_ID = 'smoke-bad-state';
  /** The rule whose one occurrence is claimed twice. */
  const DOUBLE_ID = 'smoke-double-claim';
  /** The stalled rule whose stuck occurrence an older build already posted. */
  const STUCK_ID = 'smoke-stalled-legacy';
  /** The stalled rule whose stuck occurrence nothing has posted yet. */
  const STUCK_FRESH_ID = 'smoke-stalled-fresh';
  /** The rule seeded the way a build before #486 wrote it: with no salt. */
  const SALTLESS_ID = 'smoke-saltless';
  const IDS = [RULE_ID, BAD_ID, DOUBLE_ID, STUCK_ID, STUCK_FRESH_ID, SALTLESS_ID];

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
    for (const id of IDS) {
      await deleteDoc(doc(firestore, `users/${uid}/recurring/${id}`)).catch(() => undefined);
    }
    const posted = await getDocs(collection(firestore, `users/${uid}/transactions`));
    await Promise.all(
      posted.docs
        .filter(d => IDS.includes(d.data()['recurringId']))
        .map(d => deleteDoc(d.ref).catch(() => undefined))
    );
  });

  const postedDayKeys = async (): Promise<string[]> => {
    const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
    return snapshot.docs
      .filter(d => d.data()['recurringId'] === RULE_ID)
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
      const posted = snapshot.docs.filter(d => d.data()['recurringId'] === DRAIN_ID);

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
          .filter(d => d.data()['recurringId'] === DRAIN_ID)
          .map(d => deleteDoc(d.ref).catch(() => undefined))
      );
    }
  }, 120000);

  /**
   * The horizon the Forecast tab asks for, against a real stored Timestamp.
   *
   * The unit spec proves which bound `getNextOccurrences` computes, but it
   * compares a Date the test built to a Date the service built — the
   * comparison that cannot fail. What decides whether an occurrence is inside
   * the horizon in production is a `Timestamp` that went through Firestore and
   * came back through `.toDate()`, which is what this seeds.
   *
   * The clock is not mocked here: `jasmine.clock()` replaces setTimeout, and
   * the Firestore SDK needs real timers. Instead the occurrence is stamped
   * late in the day, so it is later than "now" for every run except one inside
   * the final minute of the day — which is exactly the band the raw
   * millisecond window used to drop.
   */
  it('returns an occurrence late on the last day of the horizon', async () => {
    const EDGE_ID = 'smoke-horizon-edge';
    const HORIZON = 30;
    const lastDay = addDays(startOfDay(new Date()), HORIZON);
    const lateOnLastDay = new Date(
      lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 0);
    const pastHorizon = addDays(lateOnLastDay, 1);

    const seed = (id: string, when: Date) =>
      setDoc(doc(firestore, `users/${uid}/recurring/${id}`), {
        userId: uid,
        name: 'Edge rule',
        type: 'expense',
        amount: 12,
        currency: 'USD',
        categoryId: 'food_coffee',
        description: 'Edge',
        // Yearly, so exactly one occurrence can land inside a 30-day horizon
        // and the boundary is the only thing under test.
        frequency: { type: 'yearly', interval: 1 },
        startDate: Timestamp.fromDate(when),
        nextOccurrence: Timestamp.fromDate(when),
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

    try {
      await seed(EDGE_ID, lateOnLastDay);
      await seed(`${EDGE_ID}-past`, pastHorizon);

      const occurrences = await firstValueFrom(service.getNextOccurrences(HORIZON));
      const edges = occurrences.filter(o => o.recurringId.startsWith(EDGE_ID));

      expect(edges.map(o => o.recurringId)).toEqual([EDGE_ID]);
      expect(dayKey(edges[0].date)).toBe(dayKey(lateOnLastDay));
    } finally {
      await deleteDoc(doc(firestore, `users/${uid}/recurring/${EDGE_ID}`)).catch(() => undefined);
      await deleteDoc(doc(firestore, `users/${uid}/recurring/${EDGE_ID}-past`)).catch(() => undefined);
    }
  }, 60000);

  it('is idempotent: a second catch-up adds no documents', async () => {
    await service.catchUpRecurringTransactions();
    const first = await postedDayKeys();

    await service.catchUpRecurringTransactions();

    expect(await postedDayKeys()).toEqual(first);
  }, 60000);

  /**
   * Two claims of one occurrence: the pointer is put back on a date already
   * posted, as a racing device or a retried claim would find it. The id is a
   * digest of the rule's salt, the rule and the date, so the second claim
   * lands on the document the first one wrote. That id names neither the rule
   * nor the date (#466), and is not the digest a member holding the rule's id
   * could rebuild from the date alone (#486).
   */
  it('a second claim of one occurrence leaves one row, at an opaque id', async () => {
    const due = new Date();
    due.setHours(9, 0, 0, 0);
    due.setDate(due.getDate() - 3);
    const rulePath = `users/${uid}/recurring/${DOUBLE_ID}`;
    await setDoc(doc(firestore, rulePath), {
      userId: uid,
      name: 'Double claim',
      type: 'expense',
      amount: 9,
      currency: 'USD',
      categoryId: 'food_coffee',
      description: 'Double claim',
      // Yearly, so exactly one occurrence is due and the next is a year out.
      frequency: { type: 'yearly', interval: 1 },
      startDate: Timestamp.fromDate(due),
      nextOccurrence: Timestamp.fromDate(due),
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    await service.catchUpRecurringTransactions();
    await updateDoc(doc(firestore, rulePath), { nextOccurrence: Timestamp.fromDate(due) });
    await service.catchUpRecurringTransactions();

    // The second claim committed: its pointer advance rides in the same
    // transaction as its write.
    const rule = (await getDoc(doc(firestore, rulePath))).data()!;
    expect((rule['nextOccurrence'] as Timestamp).toDate().getTime()).toBeGreaterThan(Date.now());
    // The salt the first claim drew survived the rewind, so the second claim
    // computed the same id from it.
    const salt = rule['salt'] as string;
    expect(isSeed(salt)).toBeTrue();

    const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
    const ids = snapshot.docs.filter(d => d.data()['recurringId'] === DOUBLE_ID).map(d => d.id);
    expect(ids).toEqual([await recurringPostingId({ id: DOUBLE_ID, salt }, due.getTime())]);
    expect(ids).not.toContain(await opaqueRowId('rec', DOUBLE_ID, due.getTime()));
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[0]).not.toContain('rec-');
  }, 60000);

  /**
   * #486: a rule written before salts existed draws one on its first posting,
   * and the rules let the claim store it with the pointer. Only a real commit
   * shows both, and that what lands is a row a member holding the rule's id
   * cannot find by hashing that id with the row's date.
   */
  it('gives a saltless rule a salt on its first catch-up, and keys its row by it', async () => {
    const due = new Date();
    due.setHours(9, 0, 0, 0);
    due.setDate(due.getDate() - 3);
    const rulePath = `users/${uid}/recurring/${SALTLESS_ID}`;
    await setDoc(doc(firestore, rulePath), {
      userId: uid,
      name: 'Saltless',
      type: 'expense',
      amount: 4,
      currency: 'USD',
      categoryId: 'food_coffee',
      description: 'Saltless',
      // Yearly, so exactly one occurrence is due and the next is a year out.
      frequency: { type: 'yearly', interval: 1 },
      startDate: Timestamp.fromDate(due),
      nextOccurrence: Timestamp.fromDate(due),
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    await service.catchUpRecurringTransactions();

    const salt = (await getDoc(doc(firestore, rulePath))).data()!['salt'] as string;
    expect(isSeed(salt)).toBeTrue();

    const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
    const rows = snapshot.docs.filter(d => d.data()['recurringId'] === SALTLESS_ID);
    expect(rows.map(d => d.id)).toEqual([await recurringPostingId({ id: SALTLESS_ID, salt }, due.getTime())]);

    // What a member holding the rule's id would compute from the copy's date.
    const rowDate = (rows[0].data()['date'] as Timestamp).toMillis();
    const unsalted = await opaqueRowId('rec', SALTLESS_ID, rowDate);
    expect(snapshot.docs.map(d => d.id)).not.toContain(unsalted);
  }, 60000);

  /**
   * The contract from ADR 0044: the work list is enumerated through a server
   * read, with the signal playing no part. The emulator has no persistent
   * cache, so the trigger itself — a warm cache serving a short first
   * emission — cannot be reproduced here; what a real commit can prove is
   * the fix's shape: the catch-up posts with `recurringTransactions`
   * deliberately never populated, and leaves it that way afterwards (the
   * pages' own subscriptions fill it, never the engine).
   */
  it('enumerates the work list with the signal deliberately never populated', async () => {
    expect(service.recurringTransactions()).toEqual([]);

    await service.catchUpRecurringTransactions();

    expect((await postedDayKeys()).length).toBeGreaterThan(0);
    expect(service.recurringTransactions()).toEqual([]);
  }, 60000);

  // A rule born from a detected group must round-trip the full validation
  // stack — the DTO shape, the service's frequency guards (ADR 0014), and
  // firestore.rules — none of which the pure mapping spec exercises.
  it('creates a valid rule from a detected-group prefill', async () => {
    const detected: StorableRecurringGroup = {
      key: 'rec:detected:entertainment:netflix',
      source: 'detected',
      categoryId: 'entertainment',
      label: 'NETFLIX.COM',
      cadence: 'monthly',
      medianIntervalDays: 30,
      occurrenceCount: 4,
      medianAmount: 15.99,
      monthlyEquivalent: 15.99,
      firstSeen: '2026-03-15',
      lastSeen: '2026-07-15',
      priceIncreased: false,
      userFlaggedCount: 0
    };

    const id = await service.createRecurring(prefillFromGroup(detected, 'USD'));
    try {
      const stored = await getDoc(doc(firestore, `users/${uid}/recurring/${id}`));
      expect(stored.exists()).toBeTrue();

      const data = stored.data()!;
      expect(data['name']).toBe('NETFLIX.COM');
      expect(data['frequency']).toEqual({ type: 'monthly', interval: 1, dayOfMonth: 15 });
      expect((data['startDate'] as Timestamp).toDate()).toEqual(new Date(2026, 6, 15));
      // The engine derived the next occurrence from the anchor rather than
      // storing the past date as-is.
      const next = (data['nextOccurrence'] as Timestamp).toDate();
      expect(next.getTime()).toBeGreaterThan(new Date(2026, 6, 15).getTime());
      expect(next.getDate()).toBe(15);
    } finally {
      await deleteDoc(doc(firestore, `users/${uid}/recurring/${id}`)).catch(() => undefined);
    }
  }, 30000);

  /**
   * A rule can reach the engine in a state no client write could produce: a
   * restore, an older build, a hand edit. Both cases below write the rule
   * whole through the SDK and only then break it through the owner REST
   * route — firestore.rules refuses the broken shape, and the fields they
   * break are the two the engine reads on every pass.
   *
   * The pointer is broken to an integer rather than removed: every
   * enumeration orders by `nextOccurrence`, and a document without it is
   * never returned at all, so the shape a reader can actually meet is a
   * value of the wrong type.
   */
  describe('a rule stored in a bad state', () => {
    /** Far enough in the past that it was stamped by nothing in this run. */
    const SEEDED_AT = new Date(2026, 0, 2, 3, 4, 5);

    const badPath = (): string => `users/${uid}/recurring/${BAD_ID}`;

    /** Three months back on a day every month has, so the cadence is exact. */
    const badStart = (): Date => {
      const start = new Date();
      start.setHours(9, 0, 0, 0);
      start.setDate(15);
      start.setMonth(start.getMonth() - 3);
      return start;
    };

    const seedBadRule = (start: Date): Promise<void> =>
      setDoc(doc(firestore, badPath()), {
        userId: uid,
        name: 'Bad state',
        type: 'expense',
        amount: 7,
        currency: 'USD',
        categoryId: 'food_coffee',
        description: 'Bad state',
        frequency: { type: 'monthly', interval: 1 },
        startDate: Timestamp.fromDate(start),
        nextOccurrence: Timestamp.fromDate(start),
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.fromDate(SEEDED_AT)
      });

    const badRuleOccurrences = async (): Promise<string[]> => {
      const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
      return snapshot.docs
        .filter(d => d.data()['recurringId'] === BAD_ID)
        .map(d => d.id);
    };

    it('a rule whose start date is gone is skipped by name and the next rule posts', async () => {
      const warn = spyOn(console, 'warn');
      await seedBadRule(badStart());
      await patchFieldsAsOwner(badPath(), { startDate: null });

      await expectAsync(service.catchUpRecurringTransactions()).toBeResolved();

      // The healthy rule from beforeEach posted its whole backlog regardless.
      expect((await postedDayKeys()).length).toBeGreaterThan(0);

      const stored = (await getDoc(doc(firestore, badPath()))).data()!;
      expect('startDate' in stored).toBeFalse();
      // The anchor is never invented (ADR 0014): the document is untouched,
      // which the seeded updatedAt still standing is the proof of.
      expect((stored['updatedAt'] as Timestamp).toDate()).toEqual(SEEDED_AT);
      expect(await badRuleOccurrences()).toEqual([]);

      // Skipped by name: without this the rule is silently inert forever.
      expect(warn.calls.allArgs().some(args => args.includes(BAD_ID))).toBeTrue();
    }, 60000);

    it('a rule whose pointer is malformed is repaired on the next catch-up and posts nothing', async () => {
      spyOn(console, 'warn');
      const start = badStart();
      await seedBadRule(start);
      await patchFieldsAsOwner(badPath(), { nextOccurrence: integerField(0) });

      await expectAsync(service.catchUpRecurringTransactions()).toBeResolved();

      const stored = (await getDoc(doc(firestore, badPath()))).data()!;
      expect(stored['nextOccurrence'] instanceof Timestamp).toBeTrue();
      const next = (stored['nextOccurrence'] as Timestamp).toDate();
      expect(next.getTime()).toBeGreaterThan(Date.now());
      // Recomputed from the rule's own start date, so it lands on the cadence.
      expect(next.getDate()).toBe(start.getDate());

      // The repaired pointer is in the future, so this run claims nothing.
      expect(await badRuleOccurrences()).toEqual([]);
    }, 60000);
  });

  /**
   * A rule whose walk cannot advance stands on its pointer: the step after the
   * stuck date does not land past it, so every claim walks to the same date.
   * Day -60 of a month is the shape that does it and that the rules accept
   * (they pin the interval, not the day). The claim has to ask the server
   * whether that date is already posted before it posts it again, and what it
   * asks is not visible from the rows alone: a claim that threw looks the same
   * as one that found the row. The spy on the claim supplies what each one
   * resolved to.
   */
  describe('a rule whose walk cannot advance', () => {
    /** Far enough in the past that it was stamped by nothing in this run. */
    const SEEDED_AT = new Date(2026, 0, 2, 3, 4, 5);

    interface Claimer {
      claimDueOccurrences: (
        recurringId: string,
        userId: string,
        now: Date
      ) => Promise<{ postedIds: string[] } | null>;
    }

    /** Yesterday at nine: due in every time zone, and the date the walk stalls on. */
    const stuckDue = (): Date => {
      const due = new Date();
      due.setHours(9, 0, 0, 0);
      due.setDate(due.getDate() - 1);
      return due;
    };

    const rulePath = (id: string): string => `users/${uid}/recurring/${id}`;

    const seedStalledRule = (id: string, due: Date): Promise<void> =>
      setDoc(doc(firestore, rulePath(id)), {
        userId: uid,
        name: 'Stalled',
        type: 'expense',
        amount: 5,
        currency: 'USD',
        categoryId: 'food_coffee',
        description: 'Stalled',
        frequency: { type: 'monthly', interval: 1, dayOfMonth: -60 },
        startDate: Timestamp.fromDate(due),
        nextOccurrence: Timestamp.fromDate(due),
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.fromDate(SEEDED_AT)
      });

    /** The rows of the rule `id`, by their ids. */
    const rowsOf = async (id: string): Promise<string[]> => {
      const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
      return snapshot.docs.filter(d => d.data()['recurringId'] === id).map(d => d.id);
    };

    const updatedAtOf = async (id: string): Promise<Date> =>
      ((await getDoc(doc(firestore, rulePath(id)))).data()!['updatedAt'] as Timestamp).toDate();

    it('does not post the occurrence an older build already posted under its own id', async () => {
      const claim = spyOn(service as unknown as Claimer, 'claimDueOccurrences').and.callThrough();
      const due = stuckDue();
      await seedStalledRule(STUCK_ID, due);
      // A whole row, as the older build wrote it: the rules refuse a bare
      // { recurringId }, and txCreateValid names what a row cannot lack.
      const legacyId = `rec-${STUCK_ID}-${due.getTime()}`;
      await setDoc(doc(firestore, `users/${uid}/transactions/${legacyId}`), {
        userId: uid,
        type: 'expense',
        amount: 5,
        currency: 'USD',
        amountInBaseCurrency: 5,
        exchangeRate: 1,
        baseCurrency: 'USD',
        categoryId: 'food_coffee',
        description: 'Stalled',
        date: Timestamp.fromDate(due),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isRecurring: true,
        recurringId: STUCK_ID
      });

      await service.catchUpRecurringTransactions();

      // The claim ran, and found the row: a swallowed rejection would leave
      // the same single row behind.
      const claims = claim.calls.all().filter(call => call.args[0] === STUCK_ID);
      expect(claims.length).toBe(1);
      await expectAsync(claims[0].returnValue)
        .toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
      expect(await rowsOf(STUCK_ID)).toEqual([legacyId]);
      // Nothing posted and nothing paused, so the rule was not written at all:
      // not even the salt the claim drew, which keyed nothing.
      expect(await updatedAtOf(STUCK_ID)).toEqual(SEEDED_AT);
      expect('salt' in (await getDoc(doc(firestore, rulePath(STUCK_ID)))).data()!).toBeFalse();
    }, 60000);

    it('posts the stuck occurrence once and leaves the rule alone on the next catch-up', async () => {
      const claim = spyOn(service as unknown as Claimer, 'claimDueOccurrences').and.callThrough();
      const due = stuckDue();
      await seedStalledRule(STUCK_FRESH_ID, due);

      await service.catchUpRecurringTransactions();

      // The rule was seeded without a salt, so the claim drew one and stored
      // it with the pointer; the row is keyed by it (#486). The second claim
      // below finds the row only by asking under that salted id.
      const salt = (await getDoc(doc(firestore, rulePath(STUCK_FRESH_ID)))).data()!['salt'] as string;
      expect(isSeed(salt)).toBeTrue();
      const postedId = await recurringPostingId({ id: STUCK_FRESH_ID, salt }, due.getTime());

      const first = claim.calls.all().filter(call => call.args[0] === STUCK_FRESH_ID);
      expect(first.length).toBe(1);
      await expectAsync(first[0].returnValue)
        .toBeResolvedTo(jasmine.objectContaining({ postedIds: [postedId] }));
      expect(await rowsOf(STUCK_FRESH_ID)).toEqual([postedId]);
      const stamped = await updatedAtOf(STUCK_FRESH_ID);
      expect(stamped.getTime()).toBeGreaterThan(SEEDED_AT.getTime());

      await service.catchUpRecurringTransactions();

      const second = claim.calls.all().filter(call => call.args[0] === STUCK_FRESH_ID);
      expect(second.length).toBe(2);
      await expectAsync(second[1].returnValue)
        .toBeResolvedTo(jasmine.objectContaining({ postedIds: [] }));
      expect(await rowsOf(STUCK_FRESH_ID)).toEqual([postedId]);
      expect(await updatedAtOf(STUCK_FRESH_ID)).toEqual(stamped);
    }, 60000);
  });
});
