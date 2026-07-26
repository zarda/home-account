import { Timestamp } from '@angular/fire/firestore';
import {
  compareSnapshotFingerprint,
  compareSnapshots,
  isComparison,
  isFromNewerApp,
  readSnapshot,
  sortSnapshotsDescending,
} from './insight-snapshot.utils';
import {
  INSIGHT_DETECTOR_VERSION,
  INSIGHT_SNAPSHOT_SCHEMA_VERSION,
  InsightSnapshot,
} from '../../models';

describe('insight-snapshot.utils', () => {
  function snapshot(overrides: Partial<InsightSnapshot> = {}): InsightSnapshot {
    const monthKey = overrides.monthKey ?? '2026-06';
    return {
      id: monthKey,
      userId: 'u1',
      monthKey,
      detectorVersion: INSIGHT_DETECTOR_VERSION,
      schemaVersion: INSIGHT_SNAPSHOT_SCHEMA_VERSION,
      status: 'complete',
      fingerprint: { tx: 'abcd1234:10', count: 10, timeZone: 'Asia/Taipei', baseCurrency: 'USD' },
      totals: { income: 4000, expense: 1200, balance: 2800, count: 10 },
      byCategory: [
        { categoryId: 'food_groceries', total: 800, count: 6 },
        { categoryId: 'transport', total: 400, count: 4 },
      ],
      facts: {
        detectorVersion: INSIGHT_DETECTOR_VERSION,
        window: { start: '2026-01-01', end: '2026-06-30', months: ['2026-06'] },
        baseCurrency: 'USD',
        timeZone: 'Asia/Taipei',
        totals: { income: 4000, expense: 1200, balance: 2800, count: 10 },
        byCategory: [],
        recurring: {
          groups: [], groupCount: 2, declaredGroupCount: 1, detectedGroupCount: 1,
          totalMonthlyEquivalent: 50, declaredMonthlyEquivalent: 30,
          detectedMonthlyEquivalent: 20, newGroupCount: 0, increasedGroupCount: 0,
        },
        trends: [],
        rhythms: {
          hasEnoughData: false, transactionCount: 10,
          weekdayWeekend: {
            weekdayTotal: 0, weekendTotal: 0, weekdayCount: 0, weekendCount: 0,
            weekdayDays: 0, weekendDays: 0, weekdayDailyAverage: 0,
            weekendDailyAverage: 0, ratio: null, lean: 'even',
          },
          monthEnd: {
            tailDays: 5, tailTotal: 0, restTotal: 0, tailCount: 0, restCount: 0,
            tailDailyAverage: 0, restDailyAverage: 0, ratio: null, isSpike: false,
          },
          payday: {
            basis: 'none', paydayDayOfMonth: null, windowDays: 3,
            postPaydayTotal: 0, otherTotal: 0, postPaydayCount: 0, otherCount: 0,
            postPaydayDailyAverage: 0, otherDailyAverage: 0, ratio: null, isPresent: false,
          },
        },
        drip: {
          threshold: 0, count: 0, total: 0, monthlyAverage: 0, shareOfSpending: 0,
          medianAmount: 0, byCategory: [], filterSafe: true, isNotable: false,
        },
      },
      cards: [],
      generatedAt: Timestamp.fromDate(new Date(2026, 6, 1)),
      createdAt: Timestamp.fromDate(new Date(2026, 6, 1)),
      revision: 1,
      ...overrides,
    };
  }

  describe('readSnapshot', () => {
    it('accepts a snapshot at the current schema', () => {
      expect(readSnapshot(snapshot())).not.toBeNull();
    });

    it('accepts an older schema', () => {
      expect(readSnapshot(snapshot({ schemaVersion: 0 }))).not.toBeNull();
    });

    it('refuses a schema newer than this build understands', () => {
      // Half-rendering a document whose fields may have changed meaning is
      // worse than saying it came from a newer version.
      const future = snapshot({ schemaVersion: INSIGHT_SNAPSHOT_SCHEMA_VERSION + 1 });
      expect(readSnapshot(future)).toBeNull();
      expect(isFromNewerApp(future)).toBeTrue();
    });

    it('accepts a newer detector version, since cards are stored as computed', () => {
      const newerDetector = snapshot({ detectorVersion: INSIGHT_DETECTOR_VERSION + 1 });
      expect(readSnapshot(newerDetector)).not.toBeNull();
      expect(isFromNewerApp(newerDetector)).toBeFalse();
    });

    it('handles null and undefined', () => {
      expect(readSnapshot(null)).toBeNull();
      expect(readSnapshot(undefined)).toBeNull();
      expect(isFromNewerApp(null)).toBeFalse();
    });
  });

  describe('compareSnapshotFingerprint', () => {
    const current = {
      tx: 'abcd1234:10', count: 10, timeZone: 'Asia/Taipei', baseCurrency: 'USD',
    };

    it('reports nothing when everything matches', () => {
      const result = compareSnapshotFingerprint(snapshot(), current);
      expect(result.isStale).toBeFalse();
      expect(result.reasons).toEqual([]);
      expect(result.currentFingerprint).toBe('abcd1234:10');
    });

    it('flags edited transactions', () => {
      const result = compareSnapshotFingerprint(
        snapshot(), { ...current, tx: 'ffff0000:10' });
      expect(result.isStale).toBeTrue();
      expect(result.reasons).toEqual(['transactionsChanged']);
    });

    it('flags a deletion through the count', () => {
      const result = compareSnapshotFingerprint(
        snapshot(), { ...current, count: 9 });
      expect(result.reasons).toContain('transactionsChanged');
    });

    it('flags a base-currency change, which moves every number', () => {
      const result = compareSnapshotFingerprint(
        snapshot(), { ...current, baseCurrency: 'JPY' });
      expect(result.isStale).toBeTrue();
      expect(result.reasons).toEqual(['baseCurrencyChanged']);
    });

    it('flags a time-zone change, which moves the day-of-week maths', () => {
      const result = compareSnapshotFingerprint(
        snapshot(), { ...current, timeZone: 'America/New_York' });
      expect(result.isStale).toBeTrue();
      expect(result.reasons).toEqual(['timeZoneChanged']);
    });

    it('does NOT mark a detector-version gap as stale', () => {
      // "Your data changed" and "our code changed" are different statements.
      // Tuning a threshold must not light up every month in the timeline.
      const result = compareSnapshotFingerprint(
        snapshot({ detectorVersion: INSIGHT_DETECTOR_VERSION - 1 }), current);
      expect(result.reasons).toEqual(['detectorUpdated']);
      expect(result.isStale).toBeFalse();
    });

    it('reports both a detector gap and a data change together', () => {
      const result = compareSnapshotFingerprint(
        snapshot({ detectorVersion: INSIGHT_DETECTOR_VERSION - 1 }),
        { ...current, tx: 'other:10' });
      expect(result.reasons).toEqual(['detectorUpdated', 'transactionsChanged']);
      expect(result.isStale).toBeTrue();
    });

    it('claims nothing when the current data could not be read', () => {
      const result = compareSnapshotFingerprint(snapshot(), null);
      expect(result.isStale).toBeFalse();
      expect(result.currentFingerprint).toBeNull();
    });

    it('still reports a detector gap with unreadable data', () => {
      const result = compareSnapshotFingerprint(
        snapshot({ detectorVersion: INSIGHT_DETECTOR_VERSION - 1 }), null);
      expect(result.reasons).toEqual(['detectorUpdated']);
    });
  });

  describe('compareSnapshots', () => {
    const from = snapshot({ monthKey: '2026-03' });
    const to = snapshot({
      monthKey: '2026-08',
      totals: { income: 4000, expense: 1416, balance: 2584, count: 12 },
      byCategory: [
        { categoryId: 'food_groceries', total: 944, count: 7 },
        { categoryId: 'transport', total: 405, count: 4 },
        { categoryId: 'pets', total: 67, count: 1 },
      ],
    });

    it('reports the headline expense change', () => {
      const result = compareSnapshots(from, to);
      expect(isComparison(result)).toBeTrue();
      if (isComparison(result)) {
        expect(result.fromMonth).toBe('2026-03');
        expect(result.toMonth).toBe('2026-08');
        expect(result.expenseChange).toBe(216);
        expect(result.expenseChangeRatio).toBe(0.18);
      }
    });

    it('reports per-category moves largest first', () => {
      const result = compareSnapshots(from, to);
      if (isComparison(result)) {
        expect(result.categories[0].categoryId).toBe('food_groceries');
        expect(result.categories[0].changeRatio).toBe(0.18);
      }
    });

    it('marks a small move as unchanged rather than dropping it', () => {
      // Reported with unchanged:true so "subscriptions unchanged" can be said
      // out loud, instead of being an absence the user has to notice.
      const result = compareSnapshots(from, to);
      if (isComparison(result)) {
        const transport = result.categories.find(c => c.categoryId === 'transport')!;
        // 400 -> 405 is 1.25%, under the 2% threshold.
        expect(transport.unchanged).toBeTrue();
        expect(transport.change).toBe(5);
      }
    });

    it('counts a move at the threshold as a change, not as unchanged', () => {
      const atThreshold = snapshot({
        monthKey: '2026-08',
        byCategory: [{ categoryId: 'transport', total: 408, count: 4 }],
      });
      const result = compareSnapshots(from, atThreshold);
      if (isComparison(result)) {
        const transport = result.categories.find(c => c.categoryId === 'transport')!;
        expect(transport.changeRatio).toBe(0.02);
        expect(transport.unchanged).toBeFalse();
      }
    });

    it('reports a category that only exists on one side', () => {
      const result = compareSnapshots(from, to);
      if (isComparison(result)) {
        const pets = result.categories.find(c => c.categoryId === 'pets')!;
        expect(pets.previous).toBe(0);
        expect(pets.current).toBe(67);
        // No comparable base, so a ratio would be Infinity — null instead.
        expect(pets.changeRatio).toBeNull();
      }
    });

    it('reports the recurring portfolio change', () => {
      const result = compareSnapshots(from, snapshot({
        monthKey: '2026-08',
        facts: {
          ...from.facts,
          recurring: { ...from.facts.recurring, totalMonthlyEquivalent: 80, groupCount: 3 },
        },
      }));
      if (isComparison(result)) {
        expect(result.recurringMonthlyChange).toBe(30);
        expect(result.recurringGroupChange).toBe(1);
      }
    });

    it('refuses to compare across base currencies', () => {
      // The money fields are in different units and the historical rates that
      // produced each figure are not stored, so there is no honest conversion.
      const other = snapshot({
        monthKey: '2026-08',
        fingerprint: { ...from.fingerprint, baseCurrency: 'JPY' },
      });
      const result = compareSnapshots(from, other);
      expect(isComparison(result)).toBeFalse();
      if (!isComparison(result)) {
        expect(result.reason).toBe('baseCurrencyMismatch');
      }
    });

    it('refuses to compare a month with itself', () => {
      const result = compareSnapshots(from, snapshot({ monthKey: '2026-03' }));
      if (!isComparison(result)) {
        expect(result.reason).toBe('sameMonth');
      }
    });

    it('caps the category list', () => {
      const result = compareSnapshots(from, to, { categoryCap: 1 });
      if (isComparison(result)) {
        expect(result.categories.length).toBe(1);
      }
    });
  });

  describe('sortSnapshotsDescending', () => {
    it('puts the newest month first', () => {
      const sorted = sortSnapshotsDescending([
        snapshot({ monthKey: '2026-03' }),
        snapshot({ monthKey: '2026-12' }),
        snapshot({ monthKey: '2026-07' }),
        snapshot({ monthKey: '2025-11' }),
      ]);
      expect(sorted.map(s => s.monthKey))
        .toEqual(['2026-12', '2026-07', '2026-03', '2025-11']);
    });

    it('does not mutate the input', () => {
      const input = [snapshot({ monthKey: '2026-03' }), snapshot({ monthKey: '2026-12' })];
      sortSnapshotsDescending(input);
      expect(input[0].monthKey).toBe('2026-03');
    });
  });
});
