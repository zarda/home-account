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
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { InsightCard, InsightFacts, Transaction } from '../../models';
import { buildInsightCards, toStorableCards } from '../utils/insight-card.utils';
import { computeInsightFacts, transactionFingerprint } from '../utils/insight-facts.utils';
import { findSerializationIssues, stableStringify } from '../utils/firestore-value.utils';
import {
  groupExpensesByCategoryWithCounts,
  sumByType,
} from '../utils/transaction-aggregation.utils';
import { monthKeysBetween } from '../utils/transaction-date.utils';
import { createTimestamp, createTransaction } from './testing/test-data';

/**
 * Round-trip test for a real insight-snapshot document against the emulator.
 *
 * This exists because the unit specs mock Firestore, and a mock cannot see the
 * constraints that actually break this feature. What the emulator establishes
 * here, rather than what was assumed:
 *
 * - `undefined` IS rejected, and the SDK throws synchronously from setDoc rather
 *   than returning a rejected promise;
 * - nested arrays ARE rejected, likewise synchronously;
 * - **NaN is ACCEPTED** — Firestore stores it as a valid double. Nothing at the
 *   storage layer guards against a 0/0 ratio, so the detectors have to null it
 *   themselves;
 * - a written Date returns as a Timestamp, so ISO strings stay strings only
 *   because they are stored as strings.
 *
 * Crucially the payload here is produced by the real detectors rather than
 * hand-written, so it is the actual output shape that gets asserted — including
 * whether firestore.rules accepts what the client genuinely produces.
 *
 * Runs only under the emulators:
 *   npm run smoke
 */
describe('insight snapshots (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;

  const monthStart = new Date(2026, 5, 1);
  const monthEnd = new Date(2026, 5, 30, 23, 59, 59, 999);
  const windowStart = new Date(2026, 0, 1);

  function expense(date: Date, amount: number, overrides: Partial<Transaction> = {}): Transaction {
    return createTransaction({
      type: 'expense', amount, amountInBaseCurrency: amount,
      date: createTimestamp(date), ...overrides,
    });
  }

  /**
   * A history rich enough that every detector contributes: a monthly
   * subscription, a rising category, a small-amount drip, and salary so the
   * payday detector has a basis.
   */
  function history(): Transaction[] {
    const transactions: Transaction[] = [];
    for (let month = 0; month < 6; month += 1) {
      transactions.push(expense(new Date(2026, month, 5), 15.99, {
        description: 'Netflix', categoryId: 'subscriptions_streaming_services',
      }));
      for (let i = 0; i < 4; i += 1) {
        transactions.push(expense(new Date(2026, month, 3 + i * 6), 40 + month * 12, {
          description: 'Supermarket', categoryId: 'food_groceries',
        }));
      }
      for (let day = 1; day <= 10; day += 1) {
        transactions.push(expense(new Date(2026, month, day * 2), 3.5, {
          description: 'Coffee', categoryId: 'food_restaurants',
        }));
      }
      transactions.push(createTransaction({
        type: 'income', amount: 4000, amountInBaseCurrency: 4000,
        recurringId: 'salary', date: createTimestamp(new Date(2026, month, 25)),
      }));
    }
    return transactions;
  }

  function computeFor(transactions: Transaction[]): {
    facts: InsightFacts;
    cards: InsightCard[];
  } {
    const { facts, drillDownIds, dripTruncated } = computeInsightFacts({
      transactions,
      toBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
      window: { start: windowStart, end: monthEnd },
      months: monthKeysBetween(windowStart, monthEnd),
      baseCurrency: 'USD',
      timeZone: 'Asia/Taipei',
    });
    return {
      facts,
      cards: toStorableCards(buildInsightCards(facts, drillDownIds, dripTruncated)),
    };
  }

  /** The document the service would write, built the same way it builds it. */
  function payloadFor(
    monthKey: string,
    transactions: Transaction[],
    revision = 1,
  ): Record<string, unknown> {
    const monthTransactions = transactions.filter(t => {
      const date = t.date.toDate();
      return date >= monthStart && date <= monthEnd;
    });
    const { facts, cards } = computeFor(transactions);
    const toBase = (t: Transaction) => t.amountInBaseCurrency ?? t.amount;

    return {
      userId: uid,
      monthKey,
      detectorVersion: facts.detectorVersion,
      schemaVersion: 1,
      status: 'complete',
      fingerprint: {
        tx: transactionFingerprint(monthTransactions),
        count: monthTransactions.length,
        timeZone: 'Asia/Taipei',
        baseCurrency: 'USD',
      },
      totals: sumByType(monthTransactions, toBase),
      byCategory: groupExpensesByCategoryWithCounts(
        monthTransactions.filter(t => t.type === 'expense'), toBase),
      facts,
      cards,
      generatedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      revision,
    };
  }

  const snapshotPath = (monthKey: string): string =>
    `users/${uid}/insightSnapshots/${monthKey}`;

  /**
   * Takes a thunk, not a promise. The SDK's own value validation throws
   * *synchronously* from setDoc, so passing an already-invoked call would let
   * that throw escape past the helper entirely.
   */
  async function allowed(write: () => Promise<unknown>): Promise<boolean> {
    try {
      await write();
      return true;
    } catch {
      return false;
    }
  }

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `insight-snapshot-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it('accepts a document built by the real detectors', async () => {
    // The assertion this whole file exists for. A mocked test cannot catch an
    // undefined field, a NaN ratio or a nested array escaping a detector, and
    // any one of them fails the entire write.
    const payload = payloadFor('2026-06', history());
    expect(findSerializationIssues({
      ...payload, generatedAt: null, createdAt: null,
    })).toEqual([]);

    await expectAllowed(
      () => setDoc(doc(firestore, snapshotPath('2026-06')), payload),
      'real detector output'
    );
  });

  it('round-trips facts and cards unchanged', async () => {
    const payload = payloadFor('2026-05', history());
    await setDoc(doc(firestore, snapshotPath('2026-05')), payload);

    const read = await getDoc(doc(firestore, snapshotPath('2026-05')));
    const stored = read.data() as Record<string, unknown>;

    expect(stableStringify(stored['facts']))
      .toBe(stableStringify(payload['facts']));
    expect(stableStringify(stored['cards']))
      .toBe(stableStringify(payload['cards']));
  });

  it('keeps ISO date strings as strings, not Timestamps', async () => {
    const payload = payloadFor('2026-04', history());
    await setDoc(doc(firestore, snapshotPath('2026-04')), payload);

    const read = await getDoc(doc(firestore, snapshotPath('2026-04')));
    const facts = (read.data() as Record<string, unknown>)['facts'] as InsightFacts;

    // A written Date returns as a Timestamp; the window is stored as strings
    // precisely so this cannot happen.
    expect(typeof facts.window.start).toBe('string');
    expect(facts.window.start).toBe('2026-01-01');
    expect(Array.isArray(facts.window.months)).toBeTrue();
  });

  it('regenerating over unchanged data changes only the revision', async () => {
    // #117's headline acceptance criterion, and only an emulator can assert it
    // end to end.
    const transactions = history();
    const first = payloadFor('2026-03', transactions, 1);
    await setDoc(doc(firestore, snapshotPath('2026-03')), first);
    const before = (await getDoc(doc(firestore, snapshotPath('2026-03')))).data()!;

    const second = payloadFor('2026-03', [...transactions].reverse(), 2);
    await setDoc(doc(firestore, snapshotPath('2026-03')), second);
    const after = (await getDoc(doc(firestore, snapshotPath('2026-03')))).data()!;

    expect(after['revision']).toBe(2);
    for (const field of ['facts', 'cards', 'totals', 'byCategory', 'fingerprint']) {
      expect(stableStringify(after[field]))
        .toBe(stableStringify(before[field]), `${field} should be identical`);
    }
  });

  it('rejects a payload with an undefined optional field', async () => {
    // Proves the conditional-spread discipline in the card builder is
    // load-bearing rather than stylistic.
    const payload = payloadFor('2026-02', history());
    const cards = (payload['cards'] as InsightCard[]).map(
      card => ({ ...card, series: undefined }));

    await expectDenied(
      () => setDoc(doc(firestore, snapshotPath('2026-02')), { ...payload, cards }),
      'undefined inside a card'
    );
  });

  it('ACCEPTS NaN, which is why the detectors have to null ratios themselves', async () => {
    // Verified against the emulator rather than assumed: Firestore stores NaN as
    // a valid double and does not reject it. So nothing at the storage layer
    // protects a snapshot from a 0/0 ratio — finiteOrNull in the aggregation
    // helpers is the only guard, and it has to be applied before the value gets
    // this far. A stored NaN would then render as "NaN" and poison every
    // comparison drawn from that month.
    const payload = payloadFor('2026-01', history());
    const facts = payload['facts'] as InsightFacts;
    const poisoned = {
      ...facts,
      drip: { ...facts.drip, shareOfSpending: 0 / 0 },
    };

    await expectAllowed(
      () => setDoc(doc(firestore, snapshotPath('2026-01')), { ...payload, facts: poisoned }),
      'NaN inside the facts'
    );

    // And the real payload never contains one.
    const issues = findSerializationIssues({
      ...payload, generatedAt: null, createdAt: null,
    });
    expect(issues.filter(issue => issue.reason.includes('NaN'))).toEqual([]);
  });

  it('rejects a payload carrying a nested array', async () => {
    const payload = payloadFor('2025-12', history());
    const facts = payload['facts'] as unknown as Record<string, unknown>;

    await expectDenied(
      () => setDoc(doc(firestore, snapshotPath('2025-12')), {
        ...payload,
        facts: { ...facts, series: [[1, 2], [3, 4]] },
      }),
      'nested array inside the facts'
    );
  });

  it('deletes every snapshot, as account deletion will need to', async () => {
    const months = ['2025-10', '2025-11'];
    for (const month of months) {
      await setDoc(doc(firestore, snapshotPath(month)), payloadFor(month, history()));
    }
    for (const month of months) {
      await expectAllowed(() => deleteDoc(doc(firestore, snapshotPath(month))), `delete ${month}`);
      expect((await getDoc(doc(firestore, snapshotPath(month)))).exists()).toBeFalse();
    }
  });

  async function expectAllowed(write: () => Promise<unknown>, what: string): Promise<void> {
    expect(await allowed(write)).toBe(true, `expected ${what} to be allowed`);
  }

  async function expectDenied(write: () => Promise<unknown>, what: string): Promise<void> {
    expect(await allowed(write)).toBe(false, `expected ${what} to be rejected`);
  }
});
