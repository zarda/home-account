import {
  computeInsightFacts,
  diffInsightFacts,
  hasMaterialChange,
  insightFactsFingerprint,
  transactionFingerprint,
} from './insight-facts.utils';
import { DetectorWindow } from './spending-pattern.types';
import { findSerializationIssues } from './firestore-value.utils';
import { InsightFacts, Transaction } from '../../models';
import { createTimestamp, createTransaction } from '../services/testing/test-data';

describe('insight-facts.utils', () => {
  const toBase = (t: Transaction) => t.amount;
  const window: DetectorWindow = {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 5, 30, 23, 59, 59, 999),
  };
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

  function expense(
    date: Date,
    amount: number,
    overrides: Partial<Transaction> = {},
  ): Transaction {
    return createTransaction({
      type: 'expense', amount, date: createTimestamp(date), ...overrides,
    });
  }

  /** A history rich enough that every detector has something to say. */
  function richHistory(): Transaction[] {
    const transactions: Transaction[] = [];

    // A monthly subscription.
    for (let month = 0; month < 6; month += 1) {
      transactions.push(expense(new Date(2026, month, 5), 15.99, {
        description: 'Netflix', categoryId: 'subscriptions_streaming_services',
      }));
    }
    // A rising grocery bill, several transactions a month.
    for (let month = 0; month < 6; month += 1) {
      for (let i = 0; i < 4; i += 1) {
        transactions.push(expense(new Date(2026, month, 3 + i * 6), 40 + month * 12, {
          description: 'Supermarket', categoryId: 'food_groceries',
        }));
      }
    }
    // A drip of small coffees.
    for (let month = 0; month < 6; month += 1) {
      for (let day = 1; day <= 10; day += 1) {
        transactions.push(expense(new Date(2026, month, day * 2), 3.5, {
          description: 'Coffee', categoryId: 'food_restaurants',
        }));
      }
    }
    // Salary, so the payday detector has a basis.
    for (let month = 0; month < 6; month += 1) {
      transactions.push(createTransaction({
        type: 'income', amount: 4000, recurringId: 'salary',
        date: createTimestamp(new Date(2026, month, 25)),
      }));
    }
    return transactions;
  }

  function compute(transactions: Transaction[]): ReturnType<typeof computeInsightFacts> {
    return computeInsightFacts({
      transactions, toBase, window, months,
      baseCurrency: 'USD', timeZone: 'Asia/Taipei',
    });
  }

  describe('serialization safety', () => {
    it('produces facts Firestore will accept', () => {
      // The single most valuable assertion in this file: mocked unit tests
      // elsewhere cannot see undefined, NaN or a nested array escaping a
      // detector, and any one of them fails an entire snapshot write.
      expect(findSerializationIssues(compute(richHistory()).facts)).toEqual([]);
    });

    it('produces safe facts from an empty history too', () => {
      expect(findSerializationIssues(compute([]).facts)).toEqual([]);
    });

    it('produces safe facts from a single transaction', () => {
      const facts = compute([expense(new Date(2026, 0, 5), 10)]).facts;
      expect(findSerializationIssues(facts)).toEqual([]);
    });

    it('keeps every number finite', () => {
      const { facts } = compute(richHistory());
      const walk = (value: unknown): void => {
        if (typeof value === 'number') {
          expect(Number.isFinite(value)).toBeTrue();
        } else if (Array.isArray(value)) {
          value.forEach(walk);
        } else if (value !== null && typeof value === 'object') {
          Object.values(value as Record<string, unknown>).forEach(walk);
        }
      };
      walk(facts);
    });

    it('strips the drill-down ids out of the facts', () => {
      const { facts, drillDownIds } = compute(richHistory());
      expect(JSON.stringify(facts)).not.toContain('transactionIds');
      // They are still available to the live tab.
      expect(Object.keys(drillDownIds).length).toBeGreaterThan(0);
    });

    it('records the window, base currency and time zone', () => {
      const { facts } = compute(richHistory());
      expect(facts.window).toEqual({ start: '2026-01-01', end: '2026-06-30', months });
      expect(facts.baseCurrency).toBe('USD');
      expect(facts.timeZone).toBe('Asia/Taipei');
      expect(facts.detectorVersion).toBe(1);
    });
  });

  describe('composition', () => {
    it('runs every detector', () => {
      const { facts } = compute(richHistory());
      expect(facts.recurring.groupCount).toBeGreaterThan(0);
      expect(facts.trends.length).toBeGreaterThan(0);
      expect(facts.rhythms.hasEnoughData).toBeTrue();
      expect(facts.drip.count).toBeGreaterThan(0);
      expect(facts.totals.expense).toBeGreaterThan(0);
      expect(facts.byCategory.length).toBeGreaterThan(0);
    });

    it('counts income in the totals but not in the expense breakdown', () => {
      const { facts } = compute(richHistory());
      expect(facts.totals.income).toBe(24_000);
      expect(facts.byCategory.every(entry => entry.categoryId !== 'employment_salary'))
        .toBeTrue();
    });

    it('ignores transactions outside the window', () => {
      const { facts } = compute([
        ...richHistory(),
        expense(new Date(2025, 0, 5), 99_999),
      ]);
      expect(facts.totals.expense).toBe(compute(richHistory()).facts.totals.expense);
    });

    it('yields an empty but well-formed bundle with no transactions', () => {
      const { facts } = compute([]);
      expect(facts.totals).toEqual({ income: 0, expense: 0, balance: 0, count: 0 });
      expect(facts.recurring.groupCount).toBe(0);
      expect(facts.trends).toEqual([]);
      expect(facts.rhythms.hasEnoughData).toBeFalse();
      expect(facts.drip.isNotable).toBeFalse();
    });
  });

  describe('determinism', () => {
    it('produces identical facts for shuffled input', () => {
      const transactions = richHistory();
      const forward = compute(transactions).facts;
      const reversed = compute([...transactions].reverse()).facts;
      expect(reversed).toEqual(forward);
      expect(insightFactsFingerprint(reversed)).toBe(insightFactsFingerprint(forward));
    });

    it('produces the same fingerprint when recomputed', () => {
      const transactions = richHistory();
      expect(insightFactsFingerprint(compute(transactions).facts))
        .toBe(insightFactsFingerprint(compute(transactions).facts));
    });

    it('changes the fingerprint when a number moves', () => {
      const transactions = richHistory();
      const changed = [...transactions.slice(1), expense(new Date(2026, 0, 5), 999)];
      expect(insightFactsFingerprint(compute(changed).facts))
        .not.toBe(insightFactsFingerprint(compute(transactions).facts));
    });
  });

  describe('transactionFingerprint', () => {
    function row(id: string, updatedAt: Date): Transaction {
      return createTransaction({ id, updatedAt: createTimestamp(updatedAt) });
    }

    it('is stable under reordering', () => {
      const rows = [
        row('a', new Date(2026, 0, 1)),
        row('b', new Date(2026, 0, 2)),
        row('c', new Date(2026, 0, 3)),
      ];
      expect(transactionFingerprint([...rows].reverse()))
        .toBe(transactionFingerprint(rows));
    });

    it('changes when one row is edited', () => {
      const before = [row('a', new Date(2026, 0, 1)), row('b', new Date(2026, 0, 2))];
      const after = [row('a', new Date(2026, 0, 1)), row('b', new Date(2026, 0, 9))];
      expect(transactionFingerprint(after)).not.toBe(transactionFingerprint(before));
    });

    it('changes when a row is deleted, via the count suffix', () => {
      const rows = [row('a', new Date(2026, 0, 1)), row('b', new Date(2026, 0, 2))];
      expect(transactionFingerprint(rows.slice(0, 1)))
        .not.toBe(transactionFingerprint(rows));
    });

    it('exposes the count so a deletion can never be hidden by a collision', () => {
      expect(transactionFingerprint([row('a', new Date(2026, 0, 1))])).toMatch(/:1$/);
      expect(transactionFingerprint([])).toMatch(/:0$/);
    });

    it('falls back to the transaction date on a row with no updatedAt', () => {
      const legacy = createTransaction({ id: 'legacy', date: createTimestamp(new Date(2026, 0, 4)) });
      delete (legacy as unknown as Record<string, unknown>)['updatedAt'];
      expect(() => transactionFingerprint([legacy])).not.toThrow();
      expect(transactionFingerprint([legacy])).toMatch(/:1$/);
    });
  });

  describe('diffInsightFacts', () => {
    it('is empty for identical facts', () => {
      const facts = compute(richHistory()).facts;
      expect(diffInsightFacts(facts, facts)).toEqual([]);
    });

    it('reports a changed number with its ratio', () => {
      const previous = { ...compute([]).facts };
      const current: InsightFacts = {
        ...previous,
        totals: { income: 0, expense: 200, balance: -200, count: 2 },
      };
      const deltas = diffInsightFacts(previous, current);
      const expense = deltas.find(delta => delta.path === 'totals.expense');
      expect(expense?.previous).toBe(0);
      expect(expense?.current).toBe(200);
      // No comparable base at zero, so no ratio rather than Infinity.
      expect(expense?.changeRatio).toBeNull();
    });

    it('computes a ratio when both sides are positive', () => {
      const base = compute([]).facts;
      const previous: InsightFacts = {
        ...base, totals: { income: 0, expense: 100, balance: -100, count: 1 },
      };
      const current: InsightFacts = {
        ...base, totals: { income: 0, expense: 118, balance: -118, count: 1 },
      };
      const expense = diffInsightFacts(previous, current)
        .find(delta => delta.path === 'totals.expense');
      expect(expense?.changeRatio).toBe(0.18);
    });

    it('reports a path that exists on only one side', () => {
      const base = compute([]).facts;
      const withTrend = compute(richHistory()).facts;
      const deltas = diffInsightFacts(base, withTrend);
      expect(deltas.some(delta => delta.path.startsWith('trends['))).toBeTrue();
    });
  });

  describe('hasMaterialChange', () => {
    it('is false for no deltas', () => {
      expect(hasMaterialChange([])).toBeFalse();
    });

    it('is false for a move under the threshold', () => {
      expect(hasMaterialChange(
        [{ path: 'a', previous: 100, current: 102, changeRatio: 0.02 }])).toBeFalse();
    });

    it('is true for a move at the threshold', () => {
      expect(hasMaterialChange(
        [{ path: 'a', previous: 100, current: 105, changeRatio: 0.05 }])).toBeTrue();
    });

    it('treats an appearing or vanishing finding as material regardless of size', () => {
      expect(hasMaterialChange(
        [{ path: 'a', previous: null, current: 1, changeRatio: null }])).toBeTrue();
    });
  });
});
