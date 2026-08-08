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
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { TransactionService } from './transaction.service';
import { insightWindow } from './insights.service';
import {
  budgetPeriodWindow,
  clampWindowToNow,
  monthWindow,
  periodWindow,
} from '../utils/transaction-date.utils';
import { buildTransactionWhere } from '../utils/transaction-query.utils';
import { Transaction } from '../../models';

/**
 * Integration smoke test for the shared period windows against the Firestore
 * emulator.
 *
 * The unit specs compare Dates to Dates, which is exactly the comparison that
 * cannot fail. Firestore compares real Timestamps written by the client and
 * read back through the query engine, and the whole point of #201 is that
 * every consumer of a named period has to select the same rows. Both of those
 * are only observable here.
 *
 * The seed is deliberately millisecond-tight: one row on the first millisecond
 * of a month, one on the last (23:59:59.999) and one a single millisecond
 * later. The old boundaries closed at 23:59:59 flat, so the middle row sat
 * outside the month it belongs to — a real transaction, in the last second of
 * the month, counted against nothing. Every query path below has to return the
 * first two and never the third.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 *
 * Every bound is computed from local date parts, so this file is also run
 * under TZ=Asia/Tokyo.
 */
describe('period windows (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: TransactionService;

  // September 2026 for the boundary rows, February 2026 for the budget anchor
  // case. Both are in the past relative to any plausible run date, so the
  // to-date clamp leaves them whole.
  const MONTH = { year: 2026, month: 8 };
  const FIRST_MS = new Date(2026, 8, 1, 0, 0, 0, 0);
  const LAST_MS = new Date(2026, 8, 30, 23, 59, 59, 999);
  const ONE_MS_LATER = new Date(2026, 9, 1, 0, 0, 0, 0);

  const row = (id: string, date: Date, categoryId = 'cat-food') => ({
    id,
    type: 'expense' as const,
    amount: 100,
    amountInBaseCurrency: 100,
    exchangeRate: 1,
    currency: 'USD',
    categoryId,
    description: id,
    date: Timestamp.fromDate(date),
    isRecurring: false
  });

  const SEEDED = [
    row('window-first-ms', FIRST_MS),
    row('window-mid-month', new Date(2026, 8, 15, 12)),
    row('window-last-ms', LAST_MS),
    row('window-one-ms-later', ONE_MS_LATER),
    // The #171 case: a day the old budget arithmetic left in no period at all.
    row('budget-short-month-tail', new Date(2026, 1, 28, 9, 30), 'cat-budgeted')
  ];

  /** The rows a named period must contain, newest first as the query orders. */
  const INSIDE_THE_MONTH = ['window-last-ms', 'window-mid-month', 'window-first-ms'];

  async function idsIn(start: Date, end: Date): Promise<string[]> {
    const rows = await firstValueFrom(service.getTransactionsInRange(start, end));
    return rows.map(t => t.id);
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `period-window-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded with the raw SDK: the TestBed cannot be configured here, because
    // beforeAll runs before the framework's per-test auto-reset.
    await Promise.all(
      SEEDED.map(({ id, ...data }) =>
        setDoc(doc(firestore, `users/${uid}/transactions/${id}`), { ...data, userId: uid })
      )
    );
  });

  afterAll(async () => {
    await Promise.all(
      SEEDED.map(t =>
        deleteDoc(doc(firestore, `users/${uid}/transactions/${t.id}`)).catch(() => undefined)
      )
    );
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TransactionService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        // Rates play no part in a range read; a stub keeps the suite hermetic.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            ensureRatesLoaded: () => Promise.resolve(),
            getExchangeRate: () => 1
          }
        },
        // Neither is reachable from the read paths under test.
        { provide: StorageService, useValue: {} },
        { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } }
      ]
    });
    service = TestBed.inject(TransactionService);
  });

  it('holds a row posted on the last millisecond of the month, and not the next one', async () => {
    const { start, end } = monthWindow(MONTH);

    expect(await idsIn(start, end)).toEqual(INSIDE_THE_MONTH);
  }, 20000);

  it('excludes a row one millisecond past the end against a real Timestamp', async () => {
    // The bound is `<=` on a stored Timestamp, so this is where the 999 ms
    // widening either holds or does not. A window ending at 23:59:59.000 drops
    // window-last-ms; one ending at 00:00:00.000 the next day picks up
    // window-one-ms-later.
    const { end } = monthWindow(MONTH);
    expect(end.getTime() + 1).toBe(ONE_MS_LATER.getTime());

    const ids = await idsIn(monthWindow(MONTH).start, end);
    expect(ids).not.toContain('window-one-ms-later');
    expect(ids).toContain('window-last-ms');
  }, 20000);

  it('gives every consumer of the same named period the same rows', async () => {
    // #201's acceptance criterion, and the only place it can actually be
    // checked: the selector's custom month, the calendar month behind the
    // insight snapshots, the dashboard's clamped window and the insights
    // trailing window all have to agree on which transactions are in
    // September 2026.
    //
    // `now` is fixed rather than read from the clock. The to-date clamp is a
    // function of the clock by definition, and a wall-clock read would make
    // this assertion mean something different on either side of the seeded
    // month.
    const now = new Date(2026, 9, 15, 12, 0);
    const selector = periodWindow('custom', now, { type: 'month', ...MONTH });
    const snapshot = monthWindow(MONTH);
    const dashboard = clampWindowToNow(selector, now);

    for (const window of [selector, snapshot, dashboard]) {
      expect(await idsIn(window.start, window.end)).toEqual(INSIDE_THE_MONTH);
    }

    // The insights window reaches months further back, but has to stop on the
    // same millisecond — a trailing window that ended a second earlier would
    // drop window-last-ms from every detector.
    const insights = insightWindow({ option: 'custom', ...selector, label: '' }, now);
    expect(insights.end.getTime()).toBe(snapshot.end.getTime());
    expect(insights.start.getTime()).toBeLessThan(snapshot.start.getTime());

    const trailing = await idsIn(insights.start, insights.end);
    expect(trailing).toEqual(jasmine.arrayContaining(INSIDE_THE_MONTH));
    expect(trailing).not.toContain('window-one-ms-later');
  }, 30000);

  it('agrees with the filter query builder on the same bounds', async () => {
    // The transaction list reaches Firestore through buildTransactionWhere
    // rather than through a range reader, and it used to coerce the end date
    // itself. Both paths now widen to the same last millisecond.
    const { start, end } = monthWindow(MONTH);
    const rows = await TestBed.inject(FirestoreService).getCollection<Transaction>(
      `users/${uid}/transactions`,
      {
        where: buildTransactionWhere({ startDate: start, endDate: end }),
        orderBy: [{ field: 'date', direction: 'desc' }]
      }
    );

    expect(rows.map(t => t.id)).toEqual(INSIDE_THE_MONTH);
  }, 20000);

  it('regression #171: a budget anchored on the 31st counts the 28th of February', async () => {
    // The old arithmetic compared today against a raw day 31, rolled the
    // period back to January and ended it on Feb 27 23:59:59.999 — so an
    // expense on Feb 28 was queried out of the budget it belonged to and
    // `spent` came back short. Asserted against the query the recalculation
    // actually runs.
    const window = budgetPeriodWindow(
      'monthly', new Date(2026, 0, 31), new Date(2026, 1, 28, 12, 0));

    const rows = await firstValueFrom(
      service.getExpensesInRange(window.start, window.end, 'cat-budgeted'));

    expect(rows.map(t => t.id)).toEqual(['budget-short-month-tail']);
  }, 20000);

  it('leaves no day between one budget period and the next', async () => {
    const anchor = new Date(2026, 0, 31);
    const closing = budgetPeriodWindow('monthly', anchor, new Date(2026, 1, 27, 12, 0));
    const opening = budgetPeriodWindow('monthly', anchor, new Date(2026, 1, 28, 12, 0));

    expect(opening.start.getTime()).toBe(closing.end.getTime() + 1);

    // And the row falls on exactly one side of the seam, per Firestore.
    const before = await firstValueFrom(
      service.getExpensesInRange(closing.start, closing.end, 'cat-budgeted'));
    const after = await firstValueFrom(
      service.getExpensesInRange(opening.start, opening.end, 'cat-budgeted'));

    expect(before.map(t => t.id)).toEqual([]);
    expect(after.map(t => t.id)).toEqual(['budget-short-month-tail']);
  }, 30000);
});
